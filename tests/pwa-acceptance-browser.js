// 阶段 5：独立合成账本的小屏、字号、返回与键盘布局验收。系统手势/键盘仍待真机。
async (page) => {
 const browser=page.context().browser(),fixture=page.__pwaFixture,results=[],errors=[],contexts=[];
 if(!fixture)throw Error('请先加载合成夹具');
 const engine=browser.version().startsWith('27')?'webkit':'edge',root='G:/project/jizhangben-publish/output/playwright/pwa-stage5/';
 const assert=(ok,message='检查未通过')=>{if(!ok)throw Error(message);};
 async function setup(width=393,height=852,font=16){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',timezoneId:'Asia/Shanghai'});context.setDefaultTimeout(7000);contexts.push(context);
  await context.addInitScript(seed=>{if(!localStorage.getItem('acceptance-seeded')){Object.entries(seed).forEach(([k,v])=>localStorage.setItem(k,v));localStorage.setItem('acceptance-seeded','1');}},fixture);
  const target=await context.newPage();target.on('pageerror',e=>errors.push(e.message));
  await target.goto('http://127.0.0.1:4176/ledger-preview/');await target.waitForFunction(()=>window.PwaLedger?.status.ready&&!PwaLedger.status.busy&&!PwaLedger.status.initializingCore);
  if(font!==16)await target.addStyleTag({content:`html{font-size:${font}px!important}`});return target;
 }
 async function check(name,action){if(page.__uiOnly&&!name.includes(page.__uiOnly))return;const start=contexts.length;try{await action();results.push({name,passed:true});}catch(e){results.push({name,passed:false,message:e.message});}finally{for(const c of contexts.slice(start))await c.close();}}
 for(const [width,height,font] of [[320,640,16],[393,852,16],[320,640,24],[740,360,16]])await check(`${width}×${height} 字号${font}各专项页面不横向溢出`,async()=>{
  const target=await setup(width,height,font);
  for(const tab of ['home','homePeriods','detail','account','overview','budget','investment','book','categorySystem','record','fixedIncome']){
   await target.evaluate(tab=>switchTab(tab),tab);
   const metrics=await target.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,tab:uiState.activeTab}));
   assert(metrics.width<=metrics.viewport+2,JSON.stringify(metrics));
  }
  await target.evaluate(()=>switchTab('home'));await target.screenshot({path:root+engine+'-'+width+'-'+font+'.png',fullPage:true});
 });
 await check('首页三个主操作具有中文名称且触摸高度足够',async()=>{
  const target=await setup(320,640);
  const values=await target.locator('.bottom-nav .tab').evaluateAll(nodes=>nodes.map(node=>({name:node.textContent.trim(),height:node.getBoundingClientRect().height})));
  assert(values.length===3&&values.every(v=>v.height>=44)&&values.some(v=>v.name.includes('记一笔')),JSON.stringify(values));
 });
 await check('记一笔默认支出，键盘顺序为一二三起并可收起重新打开',async()=>{
  const target=await setup();await target.getByRole('button',{name:'记一笔',exact:true}).click();
  assert(await target.evaluate(()=>uiState.selectedType==='支出'&&!document.getElementById('recordKeyboard').hidden));
  const keys=await target.locator('.record-keyboard-numbers button').allTextContents();assert(keys.slice(0,9).map(v=>v.trim()).join('')==='123456789');
  await target.locator('#recordKeyboardHandle').click();assert(await target.locator('#recordKeyboard').isHidden());
  await target.locator('#amount').click();assert(await target.locator('#recordKeyboard').isVisible());
 });
 await check('备注输入收起金额键盘，缩小可视高度后输入仍可见',async()=>{
  const target=await setup();await target.getByRole('button',{name:'记一笔',exact:true}).click();await target.locator('#note').fill('可视区域合成备注');
  assert(await target.locator('#recordKeyboard').isHidden());await target.setViewportSize({width:393,height:460});
  await target.waitForFunction(()=>{const r=document.getElementById('note').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
  assert(await target.locator('#note').inputValue()==='可视区域合成备注');
 });
 await check('类别选择关闭回原表单，编辑小类取消不改变配置',async()=>{
  const target=await setup();await target.getByRole('button',{name:'记一笔',exact:true}).click();
  await target.evaluate(()=>openCategoryPicker());await target.locator('#categoryPickerCloseBtn').click();assert(await target.evaluate(()=>uiState.activeTab==='record'));
  await target.evaluate(()=>{openCategorySystem();categorySystemExpandedKey='food';renderCategorySystem();});
  const before=await target.evaluate(()=>JSON.stringify(dataState.categorySystem));
  await target.locator('[data-sort-id="测试自定义小类"] .category-system-item-icon').click();await target.locator('#categoryItemEditNameInput').fill('不应保存');
  await target.locator('[data-category-item-edit-close]').first().click();assert(await target.evaluate(before=>JSON.stringify(dataState.categorySystem)===before,before));
  await target.locator('#categorySystemBackBtn').click();assert(await target.evaluate(()=>uiState.activeTab==='record'));
 });
 await check('页面返回及浏览器后退保持正确来源',async()=>{
  const target=await setup();await target.locator('[data-tab="account"]').first().click();await target.goBack();assert(await target.evaluate(()=>uiState.activeTab==='home'));
  await target.evaluate(()=>{switchTab('overview');switchTab('detail',{fromReport:true});handleNativeBack();});assert(await target.evaluate(()=>uiState.activeTab==='overview'));
  await target.evaluate(()=>switchTab('book'));await target.locator('#bookBackBtn').click();assert(await target.evaluate(()=>uiState.activeTab==='home'));
 });
 await check('流水返回后保留筛选与浏览范围，隐私隐藏不改变账目',async()=>{
  const target=await setup();const before=await target.evaluate(()=>appStorage.get('jizhangben_records_1'));
  await target.evaluate(()=>{switchTab('detail');filterState.searchKey='隔离测试';refreshDetail();switchTab('home');switchTab('detail');});
  assert(await target.evaluate(()=>filterState.searchKey==='隔离测试'));
  await target.evaluate(()=>switchTab('home'));await target.locator('#privacyToggleBtn').click();
  assert(await target.evaluate(()=>document.body.classList.contains('privacy-masked')));
  assert(await target.evaluate(before=>appStorage.get('jizhangben_records_1')===before,before));
 });
 return {browser:browser.version(),results,errors};
}
