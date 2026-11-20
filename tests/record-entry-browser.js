// 新详情、编辑金额和时分的真实页面回归，仅使用隔离合成账本。
async page => {
  const browser = page.context().browser(), results = [], errors = [];
  const fixture = { ...page.__pwaFixture };
  fixture.jizhangben_records_1 = JSON.stringify([
    {id:1,type:'支出',category:'测试自定义小类',account:1,amount:16,amountCents:1600,date:'2026-11-19',note:'晚餐'},
    {id:9,type:'支出',category:'测试自定义小类',account:1,amount:7559.4,amountCents:755940,date:'2026-11-19',time:'12:03',note:'另一笔'}
  ]);
  const assert = (ok, text) => { if (!ok) throw Error(text); };
  let context, target;
  const ready = async () => target.waitForFunction(() => window.PwaLedger ? PwaLedger.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore : dataState.currentBookId !== null && !uiState.recordSaveInFlight);
  async function check(name, action) {
    context = await browser.newContext({serviceWorkers:'block',viewport:{width:393,height:852}});
    context.setDefaultTimeout(7000);
    try {
      await context.addInitScript(seed => { if(!localStorage.getItem('record-test-seeded')) { Object.entries(seed).forEach(([k,v])=>localStorage.setItem(k,v)); localStorage.setItem('record-test-seeded','1'); } }, fixture);
      target = await context.newPage(); target.on('pageerror', e => errors.push(e.message));
      await target.goto(page.__recordEntryBase || 'http://127.0.0.1:4176/ledger-preview/'); await ready();
      await action(); results.push({name,passed:true});
    } catch(e) { results.push({name,passed:false,message:e.message}); }
    finally { await context.close(); }
  }
  await check('首页直接编辑对应金额，保存只修改目标记录并返回首页', async () => {
    await target.evaluate(() => {startEdit(9); startEdit(1);});
    assert(await target.locator('#amount').inputValue()==='16', '键盘沿用上一笔金额');
    await target.evaluate(() => switchTab('home'));
    await target.locator('[data-home-record-id="1"]').click();
    assert(await target.evaluate(()=>uiState.activeTab==='record'&&uiState.editingRecordId==='1'),'没有直接进入编辑');
    assert(await target.locator('#recordTime').inputValue()==='', '旧账伪造时间');
    await target.locator('#recordTime').fill('18:42');
    await target.evaluate(() => setRecordKeyboardExpression('18.50'));
    await target.locator('#saveBtn').click(); await ready();
    await target.waitForFunction(() => uiState.activeTab==='home');
    assert(await target.evaluate(() => dataState.records.find(r=>r.id===1).amountCents===1850 && dataState.records.find(r=>r.id===9).amountCents===755940), '修改串笔');
    assert(!(await target.locator('#homeRecentList').innerText()).includes('18:42'),'首页展示了时分');
    await target.reload(); await ready();
    assert(await target.evaluate(()=>dataState.records.find(r=>r.id===1).time==='18:42'),'重开丢失时分');
  });
  await check('取消编辑保留旧账，无时分旧账编辑后仍为空', async () => {
    await target.locator('[data-home-record-id="1"]').click();
    await target.locator('#recordTime').fill('20:11'); await target.locator('#cancelBtn').click();
    await target.waitForFunction(()=>uiState.activeTab==='home');
    assert(await target.evaluate(()=>!dataState.records[0].time),'取消写入时间');
    await target.locator('[data-home-record-id="1"]').click(); await target.getByRole('button',{name:'确定',exact:true}).click(); await ready();
    await target.waitForFunction(()=>uiState.activeTab==='home');
    assert(await target.evaluate(()=>!dataState.records[0].time),'旧账被赋当前时间');
  });
  await check('新账默认保存时分，自动补记无时分，备份原字符串带时分', async () => {
    await target.getByRole('button',{name:'记一笔',exact:true}).click();
    await target.evaluate(()=>setRecordKeyboardExpression('3.25'));
    const expected = await target.evaluate(()=>currentRecordTime());
    await target.getByRole('button',{name:'确定',exact:true}).click(); await ready();
    assert(await target.evaluate(expected=>dataState.records.at(-1).time===expected, expected),'新账缺少当前时分');
    assert(await target.evaluate(()=>JSON.parse(appStorage.get(recordsKey(1))).at(-1).time===dataState.records.at(-1).time),'持久化缺少时分');
    await target.evaluate(()=>{dataState.fundProjects=[{id:'auto',fundAccountId:2,mode:'recurring'}];makeFundTransfer(dataState.fundProjects[0],'2026-11-18',100,'contribution',1,2,true);});
    assert(await target.evaluate(()=>!dataState.records.at(-1).time),'自动补记伪造时分');
  });
  await check('报表来源流水直接编辑，页面返回及侧边返回保留筛选', async () => {
    await target.evaluate(()=>{switchTab('overview');openReportCategoryRecords('测试自定义小类','expense');});
    await target.waitForFunction(()=>uiState.activeTab==='detail');
    const before = await target.evaluate(()=>JSON.stringify(filterState));
    await target.locator('#list .record-entry-open').first().click();
    assert(await target.evaluate(()=>uiState.activeTab==='record'),'流水没有直接进入编辑');
    await target.locator('#recordBackBtn').click(); await target.waitForFunction(()=>uiState.activeTab==='detail');
    assert(await target.evaluate(()=>JSON.stringify(filterState))===before,'筛选丢失');
    assert(await target.evaluate(()=>!!uiState.detailReportReturn),'报表来源丢失');
    await target.locator('#list .record-entry-open').first().click(); await target.evaluate(()=>window.handleNativeBack());
    await target.waitForFunction(()=>uiState.activeTab==='detail');
    await target.evaluate(()=>window.handleNativeBack()); await target.waitForFunction(()=>uiState.activeTab==='overview');
  });
  await check('流水铅笔直接编辑并返回，浏览器前进仍回填对应金额', async () => {
    await target.evaluate(()=>openHomeRecords());
    await target.locator('#list [data-act="edit"][data-id="1"]').click();
    assert(await target.locator('#amount').inputValue()==='16','铅笔金额不一致');
    await target.goBack(); await target.waitForFunction(()=>uiState.activeTab==='detail');
    await target.goForward(); await target.waitForFunction(()=>uiState.activeTab==='record');
    assert(await target.locator('#amount').inputValue()==='16','前进变成新记一笔');
  });
  await check('基金三种状态、正负和持平互斥展示，隐私掩码和小屏可用', async () => {
    await target.evaluate(()=>{
      dataState.fundProjects=[{id:'f1',fundName:'测试进行中',platform:'示例',mode:'one-time',status:'open',originalCostCents:50000},
        {id:'f2',fundName:'测试部分赎回',platform:'示例',mode:'one-time',status:'open',originalCostCents:100000},
        {id:'f3',fundName:'测试亏损',platform:'示例',mode:'one-time',status:'closed',originalCostCents:800000},
        {id:'f4',fundName:'测试盈利',platform:'示例',mode:'one-time',status:'closed',originalCostCents:100000},
        {id:'f5',fundName:'测试持平',platform:'示例',mode:'one-time',status:'closed',originalCostCents:100000}];
      dataState.records.push(...[['f2',25000],['f3',798877],['f4',106500],['f5',100000]].map(([id,cents],i)=>({id:100+i,fundProjectId:id,type:'转账',fundAction:'withdrawal',amountCents:cents,date:'2026-11-19'})));
      switchTab('investment');
    });
    const loss=target.locator('[data-fund-detail="f3"]');
    assert((await loss.innerText()).includes('11.23')&&(await loss.innerText()).includes('亏损')&&!(await loss.innerText()).includes('盈利'),'亏损展示错误');
    assert((await target.locator('[data-fund-detail="f2"] .fund-status').innerText()).includes('部分'),'部分状态缺失');
    assert((await target.locator('[data-fund-detail="f4"] .fund-result').innerText()).includes('盈利'),'盈利缺失');
    assert((await target.locator('[data-fund-detail="f5"] .fund-result').innerText()).includes('持平'),'持平缺失');
    await target.evaluate(()=>applyPrivacyMask(true));
    assert(await loss.locator('.fund-result strong').evaluate(node=>getComputedStyle(node).color)==='rgba(0, 0, 0, 0)','盈亏未隐私隐藏');
    await target.setViewportSize({width:320,height:750});
    assert(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'小屏横向溢出');
    await target.screenshot({path:'G:/project/jizhangben-publish/output/playwright/record-fund-funds.png',fullPage:true});
  });
  return {browser:browser.version(),results,errors};
}
