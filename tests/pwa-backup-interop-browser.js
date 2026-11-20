// 安卓网页业务分支与 PWA 文件格式互通；原生桥接返回值为合成模拟，不代表安卓真机文件验收。
async (page) => {
  const fixture=page.__pwaFixture,browser=page.context().browser(),results=[],errors=[];
  if(!fixture)throw Error('请先加载合成夹具');
  const engine=browser.version().startsWith('27')?'webkit':'edge';
  const assert=(ok,message='检查未通过')=>{if(!ok)throw Error(message);};
  async function check(name,action){
    const context=await browser.newContext({viewport:{width:393,height:852},acceptDownloads:true});context.setDefaultTimeout(7000);
    try{
      await context.addInitScript(seed=>{if(!localStorage.getItem('interop-seeded')){Object.entries(seed).forEach(([key,value])=>localStorage.setItem(key,value));localStorage.setItem('interop-seeded','1');}},fixture);
      const native=await context.newPage(),pwa=await context.newPage();for(const target of [native,pwa])target.on('pageerror',error=>errors.push(error.message));
      await native.goto('http://127.0.0.1:4173/ledger-preview/');await native.waitForFunction(()=>dataState.currentBookId!==null);await native.evaluate(()=>switchTab('book'));
      await pwa.goto('http://127.0.0.1:4176/ledger-preview/');await pwa.waitForFunction(()=>window.PwaBackup&&PwaLedger.status.ready&&!PwaLedger.status.initializingCore&&!PwaLedger.status.busy);await pwa.evaluate(()=>switchTab('book'));
      await action(native,pwa);results.push({name,passed:true});
    }catch(error){results.push({name,passed:false,message:error.message});}finally{await context.close();}
  }
  await check('安卓网页分支通过保存桥接生成的JSON可由PWA预览和恢复',async(native,pwa)=>{
    const content=await native.evaluate(()=>{
      window.JizhangbenNative={saveBackup(name,content){window.__nativeBackup=content;return '合成下载目录/'+name;}};
      dataState.records[0].reimbursementParty='需保留的旧字段';save();exportBackup();return window.__nativeBackup;
    });
    await pwa.evaluate(content=>importBackup(new File([content],'安卓分支备份.json')),content);
    await pwa.locator('#pwaBackupRestore').click();await pwa.locator('#confirmDialogOk').click();
    await pwa.waitForFunction(()=>!PwaLedger.status.busy&&!PwaBackup.busy);
    const expected=JSON.parse(content).storage;
    assert(await pwa.evaluate(expected=>Object.entries(expected).every(([key,value])=>appStorage.get(key)===value),expected));
    assert(await pwa.evaluate(()=>dataState.records[0].reimbursementParty==='需保留的旧字段'));
  });
  await check('PWA实际下载文件可在安卓网页分支恢复，类别图标及隐藏项不变',async(native,pwa)=>{
    await pwa.evaluate(()=>PwaLedger.commitChange(()=>{dataState.records[0].note='来自网页备份';save();}));
    const expected=await pwa.evaluate(()=>createLedgerBackup().data.storage);
    await pwa.locator('#exportBtn').click();await pwa.waitForFunction(()=>!PwaBackup.busy);
    const waiting=pwa.waitForEvent('download');await pwa.locator('#pwaBackupDownload').click();const download=await waiting;
    const path='G:/project/jizhangben-publish/output/playwright/pwa-stage3/'+engine+'-to-native.json';await download.saveAs(path);
    await native.locator('#importFile').setInputFiles(path);await native.locator('#confirmDialogOk').click();
    await native.waitForFunction(()=>dataState.records[0]?.note==='来自网页备份');
    assert(await native.evaluate(expected=>Object.entries(expected).every(([key,value])=>appStorage.get(key)===value),expected));
  });
  return {browser:browser.version(),results,errors};
}
