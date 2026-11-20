// 普通浏览器存储分支的兼容烟测；验证共享函数重排没有依赖 PWA 控制器。
async (page) => {
  const fixture=page.__pwaFixture, browser=page.context().browser(), results=[], errors=[];
  if (!fixture) throw Error('请先加载合成测试夹具');
  const assert=(ok,message='检查未通过')=>{if(!ok)throw Error(message);};
  async function check(name, action) {
    const context=await browser.newContext({viewport:{width:393,height:852}});
    context.setDefaultTimeout(7000);
    try {
      await context.addInitScript(seed=>{Object.entries(seed).forEach(([key,value])=>localStorage.setItem(key,value));},fixture);
      const target=await context.newPage(); target.on('pageerror',error=>errors.push(error.message));
      await target.goto('http://127.0.0.1:4173/ledger-preview/');
      await target.waitForFunction(()=>dataState.currentBookId!==null);
      assert(await target.evaluate(()=>!window.PwaLedger&&!window.PwaManagement&&!window.PwaFunds));
      await action(target); results.push({name,passed:true});
    } catch(error) {results.push({name,passed:false,message:error.message});}
    finally {await context.close();}
  }
  await check('普通分支新增类别仍返回同步结果，记录和图标未改写',async target=>{
    assert(await target.evaluate(()=>{const result=createCategoryGroup('普通分支合成大类');return result===true&&categorySystemGroups().some(group=>group.name==='普通分支合成大类');}));
    assert(await target.evaluate(seed=>appStorage.get('jizhangben_records_1')===seed.jizhangben_records_1&&appStorage.get('jizhangben_custom_category_icons')===seed.jizhangben_custom_category_icons,fixture));
  });
  await check('普通CSV分支仍新建账本并保留来源及原账户流水',async target=>{
    await target.evaluate(()=>switchTab('manage'));
    await target.evaluate(()=>previewExternalImportFile(new File(['日期,类型,金额,分类\n2026-11-01,支出,16,合成午餐'],'普通分支.csv')));
    await target.evaluate(()=>{window.__ordinaryImport=commitExternalImport();});
    await target.locator('#confirmDialogOk').click(); await target.evaluate(()=>window.__ordinaryImport);
    assert(await target.evaluate(()=>dataState.books.length===3&&dataState.records[0].importSourceFile==='普通分支.csv'&&dataState.accounts[0].name==='未注明账户'));
    assert(await target.evaluate(seed=>appStorage.get('jizhangben_records_1')===seed.jizhangben_records_1&&appStorage.get('jizhangben_accounts_1')===seed.jizhangben_accounts_1,fixture));
  });
  await check('普通JSON恢复分支仍读取并刷新指定账本',async target=>{
    await target.evaluate(()=>switchTab('manage'));
    await target.evaluate(seed=>{window.__ordinaryRestore=importBackup(new File([JSON.stringify({...seed,jizhangben_current_book:'2'})],'普通备份.json'));},fixture);
    await target.locator('#confirmDialogOk').click();
    await target.waitForFunction(()=>dataState.currentBookId===2&&dataState.records[0].category==='测试奖励');
    assert(await target.evaluate(seed=>appStorage.get('jizhangben_category_system')===seed.jizhangben_category_system&&appStorage.get('jizhangben_custom_category_icons')===seed.jizhangben_custom_category_icons,fixture));
  });
  return {browser:browser.version(),results,errors};
}
