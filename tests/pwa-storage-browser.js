// Playwright CLI run-code 的独立接入检查。fixture 由本机脚本从合成夹具注入，不进入站点产物。
async (page) => {
  const fixture = page.__pwaFixture;
  if (!fixture) throw Error('请先加载合成测试夹具');
  const browser = page.context().browser();
  const results = [];
  page.__integrationResults = results;
  const errors = [];
  const unexpectedRequests = [];
  const url = 'http://127.0.0.1:4176/ledger-preview/';
  const assert = (ok, text) => { if (!ok) throw Error(text || '检查未通过'); };
  const contexts = [];
  async function setup({ seed = fixture, init, locked = false, failed = false } = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 393, height: 852 } });
    context.setDefaultTimeout(7000);
    context.on('request', request => {
      const parsed = new URL(request.url());
      if (parsed.protocol.startsWith('http') && (parsed.origin !== 'http://127.0.0.1:4176' || /\/api(?:\/|$)/.test(parsed.pathname))) unexpectedRequests.push(request.url());
    });
    contexts.push(context);
    await context.addInitScript(values => {
      if (location.origin === 'http://127.0.0.1:4176' && !localStorage.getItem('pwa-integration-seeded')) {
        Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('pwa-integration-seeded', '1');
      }
    }, seed);
    if (init) await context.addInitScript(init);
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto(url);
    if (failed) await target.waitForFunction(() => document.getElementById('pwaStorageGate')?.getAttribute('role') === 'alert');
    else if (locked) await target.waitForFunction(() => window.PwaLedger?.status.ready && !document.getElementById('appLockOverlay').hidden);
    else await target.waitForFunction(() => window.PwaLedger?.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore && dataState.currentBookId !== null);
    return target;
  }
  async function check(name, action) {
    const start = contexts.length;
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, message: error.message }); }
    finally { for (const context of contexts.slice(start)) await context.close(); }
  }
  async function disk(target) {
    return target.evaluate(async () => { const store = await LedgerDatabase.open(); try { return await store.read(); } finally { store.close(); } });
  }
  async function enterRecord(target, digits = '3', note = '事务接入样例') {
    await target.getByRole('button', { name: '记一笔', exact: true }).click();
    if (await target.locator('#confirmDialog').isVisible() && (await target.locator('#confirmDialogMessage').innerText()).includes('上次未保存')) {
      await target.locator('#confirmDialogCancel').click();
    }
    for (const digit of digits) await target.getByRole('button', { name: digit, exact: true }).click();
    await target.locator('#note').fill(note);
    await target.locator('#amount').click();
  }
  async function confirmRecord(target) {
    await target.getByRole('button', { name: '确定', exact: true }).click();
    await target.waitForFunction(() => !PwaLedger.status.busy && !uiState.recordSaveInFlight);
  }
  async function abortNextWrite(target) {
    await target.evaluate(() => {
      window.__originalIdbPut = IDBObjectStore.prototype.put;
      window.__abortedWrite = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = window.__originalIdbPut.apply(this, args);
        if (this.name === 'ledger') {
          const transaction = this.transaction;
          request.addEventListener('success', () => {
            if (!window.__abortedWrite) { window.__abortedWrite = true; transaction.abort(); }
          });
        }
        return request;
      };
    });
  }
  async function restorePut(target) { await target.evaluate(() => { IDBObjectStore.prototype.put = window.__originalIdbPut; }); }

  await check('启动从数据库读取，旧记录和类别设置保留', async () => {
    const target = await setup(); const actual = await disk(target);
    await target.screenshot({ path: 'output/playwright/pwa-stage2b/home-' + browser.browserType().name() + '.png' });
    for (const key of ['jizhangben_records_1', 'jizhangben_records_2', 'jizhangben_accounts_1', 'jizhangben_custom_category_icons']) {
      assert(actual.entries[key] === fixture[key], '迁移值发生变化：' + key);
    }
    assert(JSON.stringify(JSON.parse(actual.entries.jizhangben_category_system).hidden) === JSON.stringify(JSON.parse(fixture.jizhangben_category_system).hidden));
    assert(await target.evaluate(() => backendApi.baseUrl() === null && document.getElementById('pwaStorageGate').hidden));
  });
  await check('首次使用才创建默认内容，账户初始化提交后可刷新', async () => {
    const target = await setup({ seed: {} });
    const accountKey = await target.evaluate(() => accountsKey(dataState.currentBookId));
    const before = await disk(target);
    assert(before.initialized && JSON.parse(before.entries[accountKey]).length > 0);
    await target.reload(); await target.waitForFunction(() => dataState.currentBookId !== null && !PwaLedger.status.busy);
    assert((await disk(target)).entries[accountKey] === before.entries[accountKey]);
  });
  await check('密码解锁后仍等待数据库加载，偏好不混入账本', async () => {
    assert(page.__pwaLock, '缺少合成密码配置');
    const target = await setup({ seed: { ...fixture, ledger_device_lock_v1: page.__pwaLock, ledger_privacy_mask_v1: '1' }, locked: true });
    assert(await target.evaluate(() => dataState.currentBookId === null));
    await target.locator('#appLockPinInput').fill('123456');
    await target.locator('#appLockUnlockBtn').click();
    await target.waitForFunction(() => dataState.currentBookId !== null && !PwaLedger.status.busy);
    assert(await target.evaluate(() => dataState.records.length === 1 && document.body.classList.contains('privacy-masked')));
    assert(!Object.keys((await disk(target)).entries).includes('ledger_device_lock_v1'));
  });
  await check('不支持数据库时阻断启动，不创建空账本', async () => {
    const target = await setup({ failed: true, init: () => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('禁止访问', 'SecurityError'); } }) });
    assert(await target.evaluate(() => !PwaLedger.status.ready && dataState.currentBookId === null && getComputedStyle(document.querySelector('.app')).visibility === 'hidden'));
    assert(await target.evaluate(raw => localStorage.getItem('jizhangben_records_1') === raw, fixture.jizhangben_records_1));
  });
  await check('旧副本损坏时停止，不把损坏当空数据', async () => {
    const target = await setup({ seed: { ...fixture, jizhangben_records_1: '损坏的 JSON' }, failed: true });
    const state = await disk(target);
    assert(!state.initialized && state.revision === 0);
    assert(await target.evaluate(() => localStorage.getItem('jizhangben_records_1') === '损坏的 JSON' && dataState.currentBookId === null));
  });
  await check('未知历史键被保留并阻断迁移，不静默丢弃', async () => {
    const target = await setup({ seed: { ...fixture, jizhangben_future_data: '{"keep":true}' }, failed: true });
    assert(!(await disk(target)).initialized);
    assert(await target.evaluate(() => localStorage.getItem('jizhangben_future_data') === '{"keep":true}'));
  });
  await check('未接入写入入口被拒绝，不能写到旧副本', async () => {
    const target = await setup();
    assert(await target.evaluate(() => { try { appStorage.set('jizhangben_records_1', '[]'); return false; } catch (_) { return dataState.records.length === 1; } }));
    assert((await disk(target)).entries.jizhangben_records_1 === fixture.jizhangben_records_1);
  });
  await check('数字键盘确认后提交完成、清表单并可刷新恢复', async () => {
    const target = await setup(); await enterRecord(target, '3'); await confirmRecord(target);
    assert(await target.evaluate(() => dataState.records.length === 2 && document.getElementById('amount').value === '' && uiState.activeTab === 'record'));
    const after = await disk(target);
    assert(JSON.parse(after.entries.jizhangben_records_1).some(record => record.amountCents === 300));
    assert(await target.evaluate(raw => localStorage.getItem('jizhangben_records_1') === raw, fixture.jizhangben_records_1));
    await target.reload(); await target.waitForFunction(() => dataState.currentBookId !== null && !PwaLedger.status.busy);
    assert(await target.evaluate(() => dataState.records.some(record => record.amountCents === 300)));
  });
  await check('记账事务失败保留金额、备注、账户、类别及原记录，允许重试', async () => {
    const target = await setup(); await enterRecord(target, '7', '失败也要保留备注');
    const before = await disk(target);
    const selected = await target.evaluate(() => ({ account: document.getElementById('accountSel').value, category: uiState.selectedCategory }));
    await abortNextWrite(target); await confirmRecord(target);
    assert(await target.evaluate(old => document.getElementById('amount').value === '7' && document.getElementById('note').value === '失败也要保留备注' && dataState.records.length === 1 && document.getElementById('accountSel').value === old.account && uiState.selectedCategory === old.category, selected));
    assert((await disk(target)).revision === before.revision);
    assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
    await restorePut(target); await confirmRecord(target);
    assert(await target.evaluate(() => dataState.records.length === 2 && document.getElementById('amount').value === ''));
  });
  await check('快速重复保存只提交一次', async () => {
    const target = await setup(); await enterRecord(target, '9');
    await target.evaluate(() => Promise.all([handleSave(), handleSave()]));
    const saved = JSON.parse((await disk(target)).entries.jizhangben_records_1);
    assert(saved.length === 2 && saved.filter(record => record.amountCents === 900).length === 1);
  });
  await check('编辑原流水失败保持原值，重试后保留原编号', async () => {
    const target = await setup();
    await target.evaluate(() => { startEdit(1); switchTab('record'); });
    await target.locator('#amount').click();
    for (let n = 0; n < 12; n++) await target.getByRole('button', { name: '删除一位' }).click();
    await target.getByRole('button', { name: '8', exact: true }).click();
    await target.locator('#note').fill('修改原流水'); await target.locator('#amount').click();
    const before = await disk(target); await abortNextWrite(target); await confirmRecord(target);
    assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
    assert(await target.evaluate(() => uiState.editingRecordId === 1 && document.getElementById('amount').value === '8'));
    await restorePut(target); await confirmRecord(target);
    const after = await disk(target), records = JSON.parse(after.entries.jizhangben_records_1);
    assert(records.length === 1 && records[0].id === 1 && records[0].amountCents === 800 && records[0].note === '修改原流水');
    assert(after.entries.jizhangben_records_2 === before.entries.jizhangben_records_2);
  });
  await check('账户失败保留名称和本金，重试后才清空', async () => {
    const target = await setup(); await target.getByRole('button', { name: '账户', exact: true }).click();
    await target.getByRole('textbox', { name: '账户名称', exact: true }).fill('事务账户');
    await target.getByRole('spinbutton', { name: '本金（初始余额）' }).fill('20');
    const before = await disk(target); await abortNextWrite(target);
    await target.getByRole('button', { name: '添加账户', exact: true }).click();
    await target.waitForFunction(() => !PwaLedger.status.busy && !uiState.accountSaveInFlight);
    assert(await target.evaluate(() => document.getElementById('accName').value === '事务账户' && document.getElementById('accInitial').value === '20' && dataState.accounts.length === 1));
    assert((await disk(target)).revision === before.revision);
    await restorePut(target); await target.getByRole('button', { name: '添加账户', exact: true }).click();
    await target.waitForFunction(() => !PwaLedger.status.busy && !uiState.accountSaveInFlight);
    assert(await target.evaluate(() => document.getElementById('accName').value === '' && dataState.accounts.some(account => account.name === '事务账户' && account.initialCents === 2000)));
  });
  await check('余额、账户名称和本金原子保存，失败时一起恢复', async () => {
    const target = await setup(); await target.getByRole('button', { name: '账户', exact: true }).click();
    await target.getByRole('button', { name: '修改账户余额和本金' }).click();
    await target.locator('#balanceAccountName').fill('调整后的账户');
    await target.locator('#balancePrincipal').click();
    for (let n = 0; n < 12; n++) await target.getByRole('button', { name: '删除一位' }).click();
    for (const digit of '200') await target.getByRole('button', { name: digit, exact: true }).click();
    await target.locator('#amount').click();
    for (let n = 0; n < 12; n++) await target.getByRole('button', { name: '删除一位' }).click();
    for (const digit of '150') await target.getByRole('button', { name: digit, exact: true }).click();
    const before = await disk(target); await abortNextWrite(target); await confirmRecord(target);
    const failed = await disk(target);
    assert(failed.revision === before.revision && failed.entries.jizhangben_accounts_1 === before.entries.jizhangben_accounts_1 && failed.entries.jizhangben_records_1 === before.entries.jizhangben_records_1, '失败后数据库必须完全保留');
    const formAfterFailure = await target.evaluate(() => ({name:document.getElementById('balanceAccountName').value,principal:document.getElementById('balancePrincipal').value,amount:document.getElementById('amount').value,message:document.getElementById('formMsg').textContent}));
    assert(formAfterFailure.name === '调整后的账户' && formAfterFailure.principal === '200', '失败后的表单：' + JSON.stringify(formAfterFailure));
    await restorePut(target); await confirmRecord(target);
    const saved = await disk(target);
    assert(saved.revision === before.revision + 1, '重试未提交：' + JSON.stringify(await target.evaluate(()=>({amount:document.getElementById('amount').value,message:document.getElementById('formMsg').textContent}))));
    const accounts = JSON.parse(saved.entries.jizhangben_accounts_1), records = JSON.parse(saved.entries.jizhangben_records_1);
    assert(accounts[0].name === '调整后的账户' && accounts[0].initialCents === 20000 && records.some(record => record.type === '余额' && record.amountCents === 15000), '联合保存结果：' + JSON.stringify({accounts,records}));
  });
  await check('删除记录失败不丢账，重试才生效', async () => {
    const target = await setup(); const before = await disk(target); await abortNextWrite(target);
    let deletion = target.evaluate(() => deleteRec(1));
    await target.locator('#confirmDialogOk').click(); await deletion;
    assert((await disk(target)).revision === before.revision && await target.evaluate(() => dataState.records.length === 1));
    await restorePut(target);
    deletion = target.evaluate(() => deleteRec(1)); await target.locator('#confirmDialogOk').click(); await deletion;
    assert(JSON.parse((await disk(target)).entries.jizhangben_records_1).length === 0);
  });
  await check('删除账户失败保留原账户，重试才生效', async () => {
    const target = await setup(); await abortNextWrite(target); const before = await disk(target);
    let deletion = target.evaluate(() => deleteAccount(1)); await target.locator('#confirmDialogOk').click(); await deletion;
    assert((await disk(target)).revision === before.revision && await target.evaluate(() => dataState.accounts.length === 1));
    await restorePut(target);
    deletion = target.evaluate(() => deleteAccount(1)); await target.locator('#confirmDialogOk').click(); await deletion;
    assert(JSON.parse((await disk(target)).entries.jizhangben_accounts_1).length === 0);
    await target.reload(); await target.waitForFunction(()=>dataState.currentBookId!==null&&!PwaLedger.status.busy);
    assert(await target.evaluate(()=>dataState.accounts.length === 0), '刷新后不能重新生成已删除账户');
  });
  await check('两个实际页面冲突时拒绝旧保存并保留第二页输入', async () => {
    const first = await setup(); const second = await first.context().newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(url); await second.waitForFunction(() => dataState.currentBookId !== null && !PwaLedger.status.busy);
    await enterRecord(first, '3', '第一窗口'); await enterRecord(second, '5', '第二窗口输入');
    await confirmRecord(first); await confirmRecord(second);
    assert(await second.evaluate(() => PwaLedger.status.conflict && document.getElementById('amount').value === '5' && document.getElementById('note').value === '第二窗口输入'));
    const records = JSON.parse((await disk(second)).entries.jizhangben_records_1);
    assert(records.length === 2 && records.some(record => record.note === '第一窗口') && !records.some(record => record.note === '第二窗口输入'));
  });
  await check('退休金启动补记后不重复，基金入口已开放', async () => {
    const month = await page.evaluate(() => new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
    const plan = { id: 9, amountCents: 50000, accountId: 1, day: 1, startMonth: month, active: true, nextEligibleMonth: month };
    const raw = JSON.stringify(plan);
    const target = await setup({ seed: { ...fixture, jizhangben_fixed_income_1: raw } });
    assert(await target.evaluate(() => dataState.records.length === 2));
    await target.evaluate(() => PwaFunds.requestDue(true));
    assert(await target.evaluate(() => dataState.records.length === 2));
    const before = (await disk(target)).revision;
    await target.getByRole('button', { name: '基金', exact: true }).click();
    assert(await target.evaluate(() => uiState.activeTab === 'investment'));
    assert((await disk(target)).revision === before);
  });
  await check('隐私开关仍隐藏净资产，设备偏好不混入账本', async () => {
    const target = await setup(); await target.getByRole('button', { name: '隐藏金额', exact: true }).click();
    assert(await target.evaluate(() => getComputedStyle(document.getElementById('netWorth')).color === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.getElementById('netWorth'), '::after').content.includes('*')));
    assert(!Object.keys((await disk(target)).entries).some(key => key.startsWith('ledger_') || key.startsWith('record-selection')));
  });
  return { browser: browser.version(), results, errors, unexpectedRequests };
}
