// 独立服务器上的真实 SW、Cache API 和 IndexedDB；只使用合成账本。
async (page) => {
  const fixture=page.__pwaFixture,browser=page.context().browser(),results=[],errors=[],unexpectedRequests=[],contexts=[];
  if(!fixture)throw Error('请先加载合成夹具');
  const engine=browser.version().startsWith('27')?'webkit':'edge';
  const base='http://127.0.0.1:'+(engine==='webkit'?4178:4177),url=base+'/ledger-preview/';
  const assert=(ok,message='检查未通过')=>{if(!ok)throw Error(message);};
  async function deploy(target,version,options={}){const result=await target.request.post(base+'/__test_control',{data:{version,...options}});assert(result.ok());}
  async function ledger(target){await target.waitForFunction(()=>window.PwaOffline&&PwaLedger.status.ready&&!PwaLedger.status.busy&&!PwaLedger.status.initializingCore);}
  async function available(target){await target.waitForFunction(()=>window.PwaOffline?.state.ready&&navigator.serviceWorker.controller,null,{timeout:25000});}
  async function setup(options={}){
    const context=await browser.newContext({viewport:{width:393,height:852},timezoneId:'Asia/Shanghai'});context.setDefaultTimeout(10000);contexts.push(context);
    context.on('request',r=>{const u=new URL(r.url());if(u.protocol.startsWith('http')&&u.origin!==base)unexpectedRequests.push(r.url());});
    await context.addInitScript(seed=>{if(!localStorage.getItem('offline-seeded')){Object.entries(seed).forEach(([k,v])=>localStorage.setItem(k,v));localStorage.setItem('offline-seeded','1');}},fixture);
    const target=await context.newPage();target.on('pageerror',error=>errors.push(error.message));
    await deploy(target,'A',options.fault||{});await target.goto(options.root?base+'/':url);
    if(!options.broken)await ledger(target);
    if(!options.incomplete&&!options.broken)await available(target);
    return target;
  }
  async function check(name,action){if(page.__offlineOnly&&!name.includes(page.__offlineOnly))return;const start=contexts.length;try{await action();results.push({name,passed:true});}catch(error){results.push({name,passed:false,message:error.message});}finally{for(const c of contexts.slice(start))await c.close();}}
  async function disk(target){return target.evaluate(async()=>{const db=await LedgerDatabase.open();try{return await db.read();}finally{db.close();}});}
  async function updateReady(target,version='B'){await deploy(target,version);await target.evaluate(()=>PwaOffline.check());await target.waitForFunction(()=>PwaOffline.state.waiting&&PwaOffline.state.phase==='update',null,{timeout:25000});}
  async function update(target,version='B'){
    await target.evaluate(()=>{window.__updateResult=PwaOffline.applyUpdate();});
    await target.waitForFunction(version=>document.documentElement.dataset.offlineTestVersion===version,version,{timeout:20000});await ledger(target);await available(target);
  }

  await check('首次完整下载核对后才显示离线可用，缓存只有程序文件',async()=>{
    const target=await setup();const entries=await target.evaluate(async()=>{const names=await caches.keys();const found=[];for(const name of names){const cache=await caches.open(name);found.push({name,urls:(await cache.keys()).map(r=>r.url)});}return found;});
    assert(entries.length===1&&entries[0].urls.length===53);
    assert(entries[0].urls.every(url=>!url.includes('api/')&&!url.includes('备份')&&!url.includes('backups/')));
    assert(await target.locator('#pwaOfflineStatus').innerText().then(t=>t.includes('可离线使用')));
  });
  await check('关闭页面再断网打开，图标记账保存及重开都可用',async()=>{
    const target=await setup();const context=target.context(),before=await disk(target);await target.close();await context.setOffline(true);
    const offline=await context.newPage();await offline.goto(url);await ledger(offline);await available(offline);
    assert(await offline.evaluate(()=>dataState.records.length===1&&!!document.querySelector('svg')));
    await offline.getByRole('button',{name:'记一笔',exact:true}).click();await offline.getByRole('button',{name:'2',exact:true}).click();
    await offline.locator('#note').fill('断网合成账目');await offline.locator('#amount').click();await offline.getByRole('button',{name:'确定',exact:true}).click();await ledger(offline);
    assert(await offline.evaluate(()=>dataState.records.some(r=>r.note==='断网合成账目')));
    const after=await disk(offline);assert(after.revision>before.revision);
    await offline.reload();await ledger(offline);assert(await offline.evaluate(()=>dataState.records.some(r=>r.note==='断网合成账目')));
  });
  await check('根路径同样可缓存和离线重开，作用域保持根目录',async()=>{
    const target=await setup({root:true});await target.context().setOffline(true);await target.reload();await ledger(target);await available(target);
    assert(await target.evaluate(async()=>new URL((await navigator.serviceWorker.getRegistration()).scope).pathname==='/'));
  });
  await check('首次缓存下载失败不误报准备完成，重试可成功',async()=>{
    const target=await setup({incomplete:true,fault:{fail:'js/helpers.js',after:1}});
    await target.waitForFunction(()=>['failed','incomplete'].includes(PwaOffline.state.phase),null,{timeout:20000});assert(!await target.evaluate(()=>PwaOffline.state.ready));
    assert(await target.evaluate(async()=>!(await caches.keys()).some(name=>name.includes('jizhangben-pwa-shell'))));
    await deploy(target,'A');await target.evaluate(()=>PwaOffline.check());await available(target);
  });
  await check('首次缓存摘要错误被拒绝，不缓存损坏资源',async()=>{
    const target=await setup({incomplete:true,fault:{tamper:'js/helpers.js',after:1}});
    await target.waitForFunction(()=>['failed','incomplete'].includes(PwaOffline.state.phase),null,{timeout:20000});assert(!await target.evaluate(()=>PwaOffline.state.ready));
    assert((await disk(target)).entries.jizhangben_records_1===fixture.jizhangben_records_1);
  });
  await check('新版本等待用户操作，不自动刷新或改写账本',async()=>{
    const target=await setup();const before=await disk(target);await updateReady(target);
    assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='A'&&PwaOffline.state.ready));
    assert(JSON.stringify(await disk(target))===JSON.stringify(before));
    assert(await target.locator('#pwaOfflineStatus').innerText().then(t=>t.includes('新版已准备')));
  });
  await check('明确更新到新版后账本类别图标排序隐藏项原样保留',async()=>{
    const target=await setup();const before=await disk(target);await updateReady(target);await update(target);
    const after=await disk(target);assert(JSON.stringify(after.entries)===JSON.stringify(before.entries));
    await target.context().setOffline(true);await target.reload();await ledger(target);assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='B'));
  });
  await check('金额计算草稿先核对保存，更新后按原交互恢复，未写成流水',async()=>{
    const target=await setup();await target.getByRole('button',{name:'记一笔',exact:true}).click();
    await target.getByRole('button',{name:'8',exact:true}).click();await target.locator('#note').fill('保留合成草稿');const before=await disk(target);
    await updateReady(target);await update(target);
    assert(JSON.stringify((await disk(target)).entries)===JSON.stringify(before.entries));
    await target.getByRole('button',{name:'记一笔',exact:true}).click();await target.locator('#confirmDialogOk').click();
    assert(await target.evaluate(()=>document.getElementById('note').value==='保留合成草稿'&&document.getElementById('amount').value==='8'));
  });
  await check('草稿存储失败拒绝更新，金额和输入留在原页面',async()=>{
    const target=await setup();await target.getByRole('button',{name:'记一笔',exact:true}).click();await target.getByRole('button',{name:'3',exact:true}).click();
    await target.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='record-form-draft-v1')throw new DOMException('不足','QuotaExceededError');return set.call(this,key,value);};localStorage.removeItem('record-form-draft-v1');});
    await updateReady(target);assert(!await target.evaluate(()=>PwaOffline.applyUpdate()));
    assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='A'&&document.getElementById('amount').value==='3'));
  });
  await check('原流水编辑及其他表单未完成时拒绝更新',async()=>{
    const target=await setup();await updateReady(target);await target.evaluate(()=>{uiState.editingRecordId=1;});assert(!await target.evaluate(()=>PwaOffline.applyUpdate()));
    await target.evaluate(()=>{uiState.editingRecordId=null;document.getElementById('bookName').value='未保存合成账本';});assert(!await target.evaluate(()=>PwaOffline.applyUpdate()));
    assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='A'&&document.getElementById('bookName').value==='未保存合成账本'));
  });
  await check('正在提交账本时不允许更新，原提交完成可正常继续',async()=>{
    const target=await setup();await updateReady(target);
    const refused=await target.evaluate(async()=>{const write=PwaLedger.commitChange(()=>{dataState.records[0].note='提交中的合成记录';save();});const accepted=await PwaOffline.applyUpdate();await write;return !accepted;});
    assert(refused&&await target.evaluate(()=>dataState.records[0].note==='提交中的合成记录'&&document.documentElement.dataset.offlineTestVersion==='A'));
  });
  await check('多窗口时拒绝强制激活，关闭其他窗口后才更新',async()=>{
    const target=await setup();const other=await target.context().newPage();await other.goto(url);await ledger(other);await updateReady(target);
    const accepted=await target.evaluate(()=>PwaOffline.applyUpdate());const detail=await target.locator('#pwaOfflineMessage').textContent();assert(!accepted&&detail.includes('关闭其他'),JSON.stringify({accepted,detail}));
    await other.close();await update(target);assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='B'));
  });
  await check('新版下载中断保留旧版完整缓存，断网仍可打开旧版',async()=>{
    const target=await setup();const before=await disk(target);await deploy(target,'B',{fail:'js/helpers.js'});await target.evaluate(()=>PwaOffline.check());
    await target.waitForFunction(async()=>{const reg=await navigator.serviceWorker.getRegistration();return !reg.installing&&!reg.waiting;},null,{timeout:25000});await target.context().setOffline(true);await target.reload();await ledger(target);await available(target);
    assert(await target.evaluate(()=>document.documentElement.dataset.offlineTestVersion==='A'));assert(JSON.stringify((await disk(target)).entries)===JSON.stringify(before.entries));
  });
  await check('旧版本资源缺失时拒绝混入新文件，账本不被清理',async()=>{
    const target=await setup();const before=await disk(target);
    await target.evaluate(async()=>{for(const name of await caches.keys()){const c=await caches.open(name);await c.delete(new URL('index.html',location.href).href);}});
    await deploy(target,'B');const result=await target.evaluate(async()=>{const response=await fetch('index.html?v='+PwaOffline.state.version);return response.status;});
    assert(result===503,'响应状态 '+result);assert(JSON.stringify(await disk(target))===JSON.stringify(before));
  });
  await check('缓存被局部移除时检查如实失败，联网可修复同版本文件',async()=>{
    const target=await setup();await target.evaluate(async()=>{for(const name of await caches.keys()){const c=await caches.open(name);await c.delete(new URL('favicon.svg',location.href).href);}});
    await target.evaluate(()=>PwaOffline.refresh());assert(!await target.evaluate(()=>PwaOffline.state.ready));
    await target.evaluate(()=>PwaOffline.check());assert(await target.evaluate(()=>PwaOffline.state.ready));
  });
  await check('接口和下载路径不进入程序缓存，其他来源缓存不被清理',async()=>{
    const target=await setup();await target.evaluate(async()=>{const c=await caches.open('合成其他应用缓存');await c.put('/other-test',new Response('保留'));await fetch('/api/private');await fetch('/记账本备份.json');});
    await updateReady(target);await update(target);await updateReady(target,'C');await update(target,'C');
    await target.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();const channel=new MessageChannel();const done=new Promise(r=>channel.port1.onmessage=e=>r(e.data));reg.active.postMessage({type:'CLEANUP',version:PwaOffline.state.version},[channel.port2]);await done;});
    const names=await target.evaluate(()=>caches.keys());assert(names.includes('合成其他应用缓存')&&names.filter(name=>name.startsWith('jizhangben-pwa-shell')).length===2);
    assert(await target.evaluate(async()=>{for(const name of await caches.keys()){if(!name.startsWith('jizhangben-pwa-shell'))continue;const c=await caches.open(name);if((await c.keys()).some(r=>r.url.includes('/api/')||r.url.includes('备份.json')))return false;}return true;}));
  });
  return {browser:browser.version(),results,errors,unexpectedRequests};
}
