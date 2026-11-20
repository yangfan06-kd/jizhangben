// 真实浏览器下载/文件重选 + 隔离故障注入；不读取真实用户账本。
async (page) => {
  const fixture=page.__pwaFixture, browser=page.context().browser(), results=[], errors=[], unexpectedRequests=[], contexts=[];
  if(!fixture) throw Error('请先加载合成夹具');
  const root='G:/project/jizhangben-publish/output/playwright/pwa-stage3/';
  const engine=browser.version().startsWith('27')?'webkit':'edge';
  const url='http://127.0.0.1:4176/ledger-preview/';
  const assert=(ok,message='检查未通过')=>{if(!ok)throw Error(message);};
  async function ready(target){await target.waitForFunction(()=>window.PwaBackup&&PwaLedger.status.ready&&!PwaLedger.status.busy&&!PwaLedger.status.initializingCore&&!PwaBackup.busy&&!PwaManagement.busy);}
  async function setup(seed=fixture){
    const context=await browser.newContext({viewport:{width:393,height:852},timezoneId:'Asia/Shanghai',acceptDownloads:true});
    context.setDefaultTimeout(7000);contexts.push(context);
    context.on('request',request=>{const u=new URL(request.url());if(u.protocol.startsWith('http')&&(u.origin!=='http://127.0.0.1:4176'&&u.origin!=='http://127.0.0.1:4173'||/\/api(?:\/|$)/.test(u.pathname)))unexpectedRequests.push(request.url());});
    await context.addInitScript(seed=>{if(!localStorage.getItem('backup-seeded')){Object.entries(seed).forEach(([key,value])=>localStorage.setItem(key,value));localStorage.setItem('backup-seeded','1');}},seed);
    const target=await context.newPage();target.on('pageerror',error=>errors.push(error.message));await target.goto(url);await ready(target);
    await target.evaluate(()=>switchTab('book'));return target;
  }
  async function check(name,action){if(page.__backupOnly&&!name.includes(page.__backupOnly))return;const start=contexts.length;try{await action();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.message});}finally{for(const c of contexts.slice(start))await c.close();}}
  async function disk(target){return target.evaluate(async()=>{const db=await LedgerDatabase.open();try{return await db.read();}finally{db.close();}});}
  async function prepare(target){await target.locator('#exportBtn').click();await ready(target);assert(await target.locator('#pwaBackupExport').isVisible());}
  async function choose(target,storage){await target.evaluate(storage=>importBackup(new File([JSON.stringify(storage)],'合成恢复.json',{type:'application/json'})),storage);assert(await target.locator('#pwaBackupImport').isVisible());}
  async function restore(target,yes=true){await target.locator('#pwaBackupRestore').click();await target.locator('#confirmDialog').waitFor({state:'visible'});await target.locator(yes?'#confirmDialogOk':'#confirmDialogCancel').click();await ready(target);}
  async function abortNext(target){await target.evaluate(()=>{window.__backupOriginals={put:IDBObjectStore.prototype.put,delete:IDBObjectStore.prototype.delete};window.__backupAbort=true;for(const method of ['put','delete'])IDBObjectStore.prototype[method]=function(...args){const req=window.__backupOriginals[method].apply(this,args);if(this.name==='ledger'){const tx=this.transaction;req.addEventListener('success',()=>{if(window.__backupAbort){window.__backupAbort=false;tx.abort();}});}return req;};});}
  async function fileStub(target,kind='ok'){
    await target.evaluate(kind=>{window.__fileWritten='';window.__fileAborted=false;window.showSaveFilePicker=async()=>{if(kind==='cancel')throw new DOMException('取消','AbortError');return {createWritable:async()=>({write:async text=>{if(kind==='write')throw Error('空间不足');window.__fileWritten=text;},close:async()=>{if(kind==='close')throw Error('写入未完成');},abort:async()=>{window.__fileAborted=true;}}),getFile:async()=>new File([kind==='mismatch'?'错误内容':window.__fileWritten],'合成.json')};};},kind);
  }

  await check('导出准备只读且不谎报保存成功，预览计数正确',async()=>{
    const target=await setup();const before=await disk(target);await prepare(target);
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));
    assert(await target.locator('#pwaBackupExportInfo').innerText().then(t=>t.includes('2 个账本、2 笔流水')));
    assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('尚未生成已确认')));
    assert(await target.evaluate(()=>!JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')||'{}').confirmedAt));
  });
  await check('实际下载JSON到主机后重新选择恢复，流水类别图标顺序逐项一致',async()=>{
    const target=await setup({...fixture,ledger_privacy_mask_v1:'1',ledger_device_lock_v1:'无效的合成配置'});await prepare(target);
    const before=await disk(target);const waiting=target.waitForEvent('download');await target.locator('#pwaBackupDownload').click();const download=await waiting;
    const filePath=root+engine+'-roundtrip.json';await download.saveAs(filePath);
    assert(await target.evaluate(()=>JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).lastAction.state==='requested'&&!JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).confirmedAt));
    await target.evaluate(()=>PwaLedger.commitChange(()=>{dataState.records=[];save();}));
    await target.locator('#importFile').evaluate(input=>input.addEventListener('change',event=>{window.__downloadedFileText=event.target.files[0].text();},{capture:true,once:true}));
    await target.locator('#importFile').setInputFiles(filePath);await target.locator('#pwaBackupImport').waitFor({state:'visible'});
    const payload=JSON.parse(await target.evaluate(()=>window.__downloadedFileText));
    assert(payload.format==='jizhangben-backup'&&payload.version===3);
    for(const [key,value] of Object.entries(before.entries).filter(([key])=>!['jizhangben_pending_sync','jizhangben_snapshot_owner'].includes(key)))assert(payload.storage[key]===value,key);
    assert(!Object.hasOwn(payload.storage,'ledger_privacy_mask_v1')&&!Object.hasOwn(payload.storage,'ledger_device_lock_v1'));
    assert(await target.locator('#pwaBackupImportSummary').innerText().then(t=>t.includes('2 笔流水')));
    await restore(target);const after=await disk(target);
    for(const [key,value] of Object.entries(payload.storage))assert(after.entries[key]===value,key);
    assert(await target.evaluate(()=>localStorage.getItem('ledger_privacy_mask_v1')==='1'));
  });
  await check('下载请求只能由用户核对后确认，确认状态重开仍保留',async()=>{
    const target=await setup();await prepare(target);const waiting=target.waitForEvent('download');await target.locator('#pwaBackupDownload').click();await waiting;
    await target.locator('#pwaBackupConfirmFile').click();assert(await target.locator('#pwaBackupHistory').innerText().then(t=>t.includes('由你确认')));
    await target.reload();await ready(target);await target.evaluate(()=>switchTab('book'));
    assert(await target.evaluate(()=>Number(JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).confirmedAt)>0));
  });
  await check('文件接口写入关闭及读回都成功才显示已核对',async()=>{
    const target=await setup();await fileStub(target);await prepare(target);const before=await disk(target);
    await target.locator('#pwaBackupSaveFile').click();await ready(target);
    assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('已写入并核对')));
    assert(await target.evaluate(()=>JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).lastAction.state==='verified'));
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));
  });
  for(const kind of ['cancel','write','close','mismatch'])await check('文件接口故障 '+kind+' 不虚报成功或修改账本',async()=>{
    const target=await setup();await fileStub(target,kind);await prepare(target);const before=await disk(target);
    await target.locator('#pwaBackupSaveFile').click();await ready(target);
    assert(await target.evaluate(()=>!JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).confirmedAt));
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));
    const text=await target.locator('#pwaBackupActionStatus').innerText();assert(!text.includes('已写入并核对')&&text.includes('当前账本未更改'));
  });
  await check('系统分享完成只标记已交付，不冒充文件保存',async()=>{
    const target=await setup();await target.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedFile=await data.files[0].text();}});});
    await prepare(target);await target.locator('#pwaBackupShare').click();await ready(target);
    assert(await target.evaluate(()=>JSON.parse(window.__sharedFile).storage.jizhangben_records_1===appStorage.get('jizhangben_records_1')&&!JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).confirmedAt));
    assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('尚未确认保存')));
  });
  await check('取消系统分享不自动触发下载，仍可重新选择',async()=>{
    const target=await setup();let downloads=0;target.on('download',()=>downloads++);
    await target.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('取消','AbortError');}});});
    await prepare(target);await target.locator('#pwaBackupShare').click();await ready(target);
    assert(downloads===0&&await target.locator('#pwaBackupConfirmFile').isHidden());
    assert(await target.evaluate(()=>JSON.parse(localStorage.getItem('ledger_pwa_backup_status_v1')).lastAction.state==='cancelled'));
  });
  await check('不支持文件分享时隐藏分享入口，仍提供下载',async()=>{
    const target=await setup();await target.evaluate(()=>{window.showSaveFilePicker=undefined;Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});});
    await prepare(target);assert(await target.locator('#pwaBackupSaveFile').isHidden()&&await target.locator('#pwaBackupShare').isHidden()&&await target.locator('#pwaBackupDownload').isVisible());
  });
  await check('重复发起文件操作被拦截，只请求一次下载',async()=>{
    const target=await setup();await prepare(target);let downloads=0;target.on('download',()=>downloads++);
    const waiting=target.waitForEvent('download');const values=await target.evaluate(()=>Promise.all([PwaBackup.exportFile('download'),PwaBackup.exportFile('download'),PwaBackup.exportFile('download')]));await waiting;
    assert(values.filter(Boolean).length===1&&downloads===1);
  });
  await check('空账本不提醒，非空账本可一周后提醒且偏好不入备份',async()=>{
    const empty={...fixture,jizhangben_records_1:'[]',jizhangben_records_2:'[]'};const blank=await setup(empty);await blank.evaluate(()=>switchTab('home'));assert(await blank.locator('#pwaBackupReminder').isHidden());
    const target=await setup();await target.evaluate(()=>switchTab('home'));assert(await target.locator('#pwaBackupReminder').isVisible());
    await target.locator('#pwaBackupGo').click();assert(await target.locator('#exportBtn').isVisible());await target.evaluate(()=>switchTab('home'));
    await target.locator('#pwaBackupSnooze').click();assert(await target.locator('#pwaBackupReminder').isHidden());
    await target.reload();await ready(target);assert(await target.locator('#pwaBackupReminder').isHidden());
    assert(await target.evaluate(()=>Object.keys(createLedgerBackup().data.storage).every(key=>key.startsWith('jizhangben_'))));
  });
  await check('备份时间偏好写入失败不阻止文件写入，不假称时间已持久记录',async()=>{
    const target=await setup();await fileStub(target);await target.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='ledger_pwa_backup_status_v1')throw new DOMException('空间不足','QuotaExceededError');return original.call(this,key,value);};});
    await prepare(target);await target.locator('#pwaBackupSaveFile').click();await ready(target);
    assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('已写入并核对')));
    assert(await target.locator('#pwaBackupHistory').innerText().then(t=>t.includes('无法完整读取或记录')));
    assert(await target.evaluate(()=>localStorage.getItem('ledger_pwa_backup_status_v1')===null));
  });
  await check('恢复预览和最终确认都可取消，不更改当前账本',async()=>{
    const target=await setup();const before=await disk(target);await choose(target,fixture);
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));await target.locator('#pwaBackupImportCancel').click();
    await choose(target,fixture);await restore(target,false);assert(await target.locator('#pwaBackupImport').isVisible());
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));
  });
  await check('损坏未来版本和未知键的备份都不出现可恢复预览',async()=>{
    const target=await setup();const before=await disk(target);
    for(const contents of ['坏文件',JSON.stringify({format:'jizhangben-backup',version:999,storage:fixture}),JSON.stringify({...fixture,jizhangben_future:'[]'})]){
      assert(!await target.evaluate(text=>importBackup(new File([text],'合成坏文件.json')),contents));assert(await target.locator('#pwaBackupImport').isHidden());assert(JSON.stringify(await disk(target))===JSON.stringify(before));
    }
  });
  await check('恢复事务中途失败保留账本及预览，重试才替换',async()=>{
    const target=await setup();const before=await disk(target);await choose(target,{...fixture,jizhangben_records_1:'[]'});await abortNext(target);
    await restore(target);assert(JSON.stringify(await disk(target))===JSON.stringify(before));assert(await target.locator('#pwaBackupImport').isVisible());
    await target.evaluate(()=>Object.assign(IDBObjectStore.prototype,window.__backupOriginals));await restore(target);
    assert((await disk(target)).entries.jizhangben_records_1==='[]'&&await target.locator('#pwaBackupImport').isHidden());
  });
  await check('预览后本页已有新保存时拒绝替换，重新预览后可恢复',async()=>{
    const target=await setup();await choose(target,fixture);await target.evaluate(()=>PwaLedger.commitChange(()=>{dataState.records[0].note='预览之后新增修改';save();}));const saved=await disk(target);
    await restore(target);assert(JSON.stringify(await disk(target))===JSON.stringify(saved));assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('预览后账本已有更改')));
    await choose(target,fixture);await restore(target);assert((await disk(target)).entries.jizhangben_records_1===fixture.jizhangben_records_1);
  });
  await check('其他窗口的新账目进入导出快照，但旧页恢复不能覆盖新账目',async()=>{
    const target=await setup();await choose(target,fixture);const other=await target.context().newPage();await other.goto(url);await ready(other);
    await other.evaluate(()=>PwaLedger.commitChange(()=>{dataState.records[0].note='另一个窗口已保存';save();}));const saved=await disk(other);
    await prepare(target);const waiting=target.waitForEvent('download');await target.locator('#pwaBackupDownload').click();const download=await waiting;const path=root+engine+'-latest.json';await download.saveAs(path);
    await target.locator('#importFile').evaluate(input=>input.addEventListener('change',event=>{window.__downloadedFileText=event.target.files[0].text();event.stopImmediatePropagation();},{capture:true,once:true}));
    await target.locator('#importFile').setInputFiles(path);
    assert(JSON.parse(await target.evaluate(()=>window.__downloadedFileText)).storage.jizhangben_records_1===saved.entries.jizhangben_records_1);
    await restore(target);assert(JSON.stringify(await disk(other))===JSON.stringify(saved)&&await target.evaluate(()=>PwaLedger.status.conflict));
  });
  await check('取消慢速读取后不显示过期预览，先选文件不会覆盖后选文件',async()=>{
    const target=await setup();await target.evaluate(()=>{window.__originalRead=readBackupFile;window.__readResolve=null;readBackupFile=()=>new Promise(resolve=>{window.__readResolve=resolve;});window.__slowImport=importBackup(new File(['{}'],'慢文件.json'));});
    await target.evaluate(()=>{PwaBackup.cancelPreview();readBackupFile=window.__originalRead;});await choose(target,fixture);
    await target.evaluate(async seed=>{window.__readResolve(seed);await window.__slowImport;},fixture);
    assert(await target.locator('#pwaBackupImportFile').innerText()==='合成恢复.json');
  });
  await check('旧版单账本平面备份可预览和恢复，重复旧键不会重复计数',async()=>{
    const target=await setup();const flat={jizhangben_records:'[{"id":8,"type":"支出","amount":8.88,"category":"旧餐饮","account":2,"date":"2020-01-02"}]',jizhangben_accounts:'[{"id":2,"name":"旧现金","kind":"资金","initial":100}]'};
    await choose(target,flat);assert(await target.locator('#pwaBackupImportSummary').innerText().then(t=>t.includes('1 笔流水')));await restore(target);
    assert(await target.evaluate(()=>dataState.records.length===1&&dataState.records[0].id===8&&dataState.accounts[0].name==='旧现金'));
    await prepare(target);assert(await target.locator('#pwaBackupExportInfo').innerText().then(t=>t.includes('1 笔流水')));
  });
  await check('小屏大字预览不横向溢出，恢复按钮触摸区域足够',async()=>{
    const target=await setup();await target.setViewportSize({width:320,height:640});await target.addStyleTag({content:'html{font-size:24px!important}'});await choose(target,fixture);
    const geometry=await target.evaluate(()=>{const r=document.getElementById('pwaBackupRestore').getBoundingClientRect();return {width:document.documentElement.scrollWidth,viewport:innerWidth,height:r.height};});
    assert(geometry.width<=geometry.viewport+1&&geometry.height>=44,JSON.stringify(geometry));
    await target.screenshot({path:root+engine+'-restore-small.png',fullPage:true});
  });
  await check('文件读取中断时结束等待并保留原账本',async()=>{
    const target=await setup();const before=await disk(target);
    await target.evaluate(()=>{const NativeReader=FileReader;window.FileReader=class extends NativeReader{readAsText(){queueMicrotask(()=>this.dispatchEvent(new ProgressEvent('abort')));}};});
    assert(!await target.evaluate(seed=>importBackup(new File([JSON.stringify(seed)],'读取中断.json')),fixture));
    assert(await target.evaluate(()=>!PwaBackup.busy)&&JSON.stringify(await disk(target))===JSON.stringify(before));
  });
  await check('恢复已提交但页面刷新异常时如实提示，禁止重复确认',async()=>{
    const target=await setup();await choose(target,{...fixture,jizhangben_records_1:'[]'});
    await target.evaluate(()=>{refreshReloadedData=()=>{throw Error('受控刷新异常');};});await restore(target);
    assert((await disk(target)).entries.jizhangben_records_1==='[]');
    assert(await target.locator('#pwaBackupActionStatus').innerText().then(t=>t.includes('数据已保存，但页面刷新未完成')));
    assert(await target.locator('#pwaBackupImport').isHidden());
  });
  return {browser:browser.version(),results,errors,unexpectedRequests};
}
