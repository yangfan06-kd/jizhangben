// 固定部署副本的响应头与真实离线启动烟测；不是 iPhone 或公网验收。
async (page) => {
  const browser = page.context().browser(), seed = page.__pwaFixture;
  if (!seed) throw Error('请先加载合成夹具');
  const base = page.__deploymentTarget?.url || 'http://127.0.0.1:4177/ledger-preview/', errors = [], external = [], results = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: page.__deploymentTarget?.headers || {} });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  // 私有 HTTPS 烟测：阻止任何跨来源请求，访问参数仅在内存中使用。
  if (page.__deploymentTarget) await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  context.on('request', request => { if (request.url().startsWith('http') && new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
  await context.addInitScript(seed => { if (!localStorage.getItem('deployment-seeded')) { Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v)); localStorage.setItem('deployment-seeded', '1'); } }, seed);
  const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
  const ready = async () => {
    await target.waitForFunction(() => window.PwaLedger?.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore);
    await target.waitForFunction(() => window.PwaOffline?.state.ready && navigator.serviceWorker.controller, null, { timeout: 30000 });
  };
  const disk = () => target.evaluate(async () => { const db = await LedgerDatabase.open(); try { return (await db.read()).entries; } finally { db.close(); } });
  try {
    const response = await target.goto(base); await ready();
    const headers = await response.allHeaders();
    assert(response.status() === 200 && headers['cache-control'] === 'no-store, no-transform' && headers['x-content-type-options'] === 'nosniff', '入口响应契约不符');
    results.push({ name: '固定副本按要求响应并完成真实 SW 准备', passed: true });
    assert(await target.evaluate(() => document.querySelector('#pwaOfflineStatus').textContent.includes('可离线使用')), '离线状态未准备');
    const cacheState = await target.evaluate(async () => ({ scope: (await navigator.serviceWorker.getRegistration()).scope, sizes: await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).length)) }));
    assert(cacheState.scope === base && cacheState.sizes.length === 1 && cacheState.sizes[0] === 53, '缓存边界不符');
    results.push({ name: '子路径作用域正确且缓存只含程序资源', passed: true });
    const before = await disk();
    await context.setOffline(true); await target.reload(); await ready();
    assert(JSON.stringify(await disk()) === JSON.stringify(before), '离线重开改变原数据');
    results.push({ name: '断网重开保留合成账本及类别原字符串', passed: true });
    await target.getByRole('button', { name: '记一笔', exact: true }).click();
    await target.getByRole('button', { name: '3', exact: true }).click();
    await target.locator('#note').fill('固定部署副本断网合成记录'); await target.locator('#amount').click();
    await target.getByRole('button', { name: '确定', exact: true }).click(); await ready();
    await target.waitForFunction(() => dataState.records.some(r => r.note === '固定部署副本断网合成记录'));
    assert(await target.evaluate(() => dataState.records.some(r => r.note === '固定部署副本断网合成记录' && r.amountCents === 300)), '断网保存金额不符');
    await target.reload(); await ready();
    assert(await target.evaluate(() => dataState.records.some(r => r.note === '固定部署副本断网合成记录')), '断网保存后重开丢失');
    results.push({ name: '部署副本断网记账后重开仍保留', passed: true });
    assert(errors.length === 0 && external.length === 0, '存在运行错误或第三方请求');
    results.push({ name: '未出现运行异常或第三方请求', passed: true });
  } catch (error) {
    results.push({ name: '部署副本烟测', passed: false, message: error.message });
    if (page.__deploymentTarget) results.push({ name: '失败时页面状态', passed: false,
      title: await target.title().catch(() => ''),
      offlineStatus: await target.locator('#pwaOfflineStatus').textContent({ timeout: 1000 }).catch(() => null),
      resourceFailure: await target.locator('#pwaResourceFailure').textContent({ timeout: 1000 }).catch(() => null) });
  }
  finally { await context.close(); }
  return { browser: browser.version(), results, errors, external };
}
