// Playwright CLI 实际 IndexedDB + 页面检查，仅使用仓库合成数据。
async (page) => {
  const fixture = page.__pwaFixture;
  if (!fixture) throw Error('缺少合成夹具');
  const browser = page.context().browser(), results = [], errors = [], unexpectedRequests = [];
  const url = 'http://127.0.0.1:4176/ledger-preview/';
  const clock = '2026-11-11T12:00:00+08:00';
  const assert = (ok, message = '检查未通过') => { if (!ok) throw Error(message); };
  const recurring = () => ({ id: 'fund-test', mode: 'recurring', fundName: '模拟定投', platform: '模拟平台',
    fundAccountId: 99, sourceAccountId: 1, amountCents: 1000, frequency: 'daily', weekdays: [], monthDays: [],
    originalCostCents: 0, startDate: '2026-11-10', endDate: '', status: 'open', scheduleStatus: 'active', processedDates: [] });
  const single = (cost = 10000) => ({ ...recurring(), mode: 'one-time', fundName: '模拟投资', amountCents: 0,
    originalCostCents: cost, frequency: null, startDate: '2026-11-11', processedDates: ['2026-11-11'] });
  const pension = () => ({ id: 'pension-test', amountCents: 50000, accountId: 1, day: 1,
    startMonth: '2026-11', nextEligibleMonth: '2026-11', active: true });
  const contexts = [];
  async function setup({ project = null, plan = null, abort = false, time = clock } = {}) {
    const seed = { ...fixture };
    if (project) {
      const accounts = JSON.parse(seed.jizhangben_accounts_1);
      accounts.push({ id: 99, name: '模拟基金专户', kind: '资金', fundOnly: true,
        fundProjectId: String(project.id), initialCents: project.originalCostCents, initial: project.originalCostCents / 100 });
      seed.jizhangben_accounts_1 = JSON.stringify(accounts);
      seed.jizhangben_fund_projects_1 = JSON.stringify([project]);
    }
    if (plan) seed.jizhangben_fixed_income_1 = JSON.stringify(plan);
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 393, height: 852 }, timezoneId: 'Asia/Shanghai' });
    contexts.push(context); context.setDefaultTimeout(7000);
    context.on('request', request => {
      const parsed = new URL(request.url());
      if (parsed.protocol.startsWith('http') && (parsed.origin !== 'http://127.0.0.1:4176' || /\/api(?:\/|$)/.test(parsed.pathname))) unexpectedRequests.push(request.url());
    });
    await context.addInitScript(({ seed, time, abort }) => {
      const NativeDate = Date;
      window.__fundClock = NativeDate.parse(time);
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [window.__fundClock])); } static now() { return window.__fundClock; } };
      if (location.origin === 'http://127.0.0.1:4176' && !localStorage.getItem('fund-tests-seeded')) {
        Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('fund-tests-seeded', '1');
      }
      window.__failFundWrites = abort;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const req = original.apply(this, args);
        if (this.name === 'ledger' && typeof args[0] === 'string' && /"fundScheduledDate"|"fixedIncomePlanId"/.test(args[0])) {
          const tx = this.transaction;
          req.addEventListener('success', () => { if (window.__failFundWrites) { try { tx.abort(); } catch (_) {} } });
        }
        return req;
      };
    }, { seed, time, abort });
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
    await target.goto(url);
    await target.waitForFunction(() => window.PwaFunds && PwaLedger.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore && dataState.currentBookId !== null);
    return target;
  }
  async function check(name, action) {
    if (page.__fundOnly && !name.includes(page.__fundOnly)) return;
    const start = contexts.length;
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, message: error.message }); }
    finally { for (const context of contexts.slice(start)) await context.close(); }
  }
  async function disk(target) {
    return target.evaluate(async () => { const store = await LedgerDatabase.open(); try { return await store.read(); } finally { store.close(); } });
  }
  async function abortNext(target) {
    await target.evaluate(() => {
      window.__savedPut = IDBObjectStore.prototype.put;
      window.__savedDelete = IDBObjectStore.prototype.delete;
      window.__abortNext = true;
      for (const [method, original] of [['put', window.__savedPut], ['delete', window.__savedDelete]]) {
        IDBObjectStore.prototype[method] = function (...args) {
          const req = original.apply(this, args);
          if (this.name === 'ledger') {
            const tx = this.transaction;
            req.addEventListener('success', () => { if (window.__abortNext) { window.__abortNext = false; tx.abort(); } });
          }
          return req;
        };
      }
    });
  }
  async function restore(target) { await target.evaluate(() => { IDBObjectStore.prototype.put = window.__savedPut; IDBObjectStore.prototype.delete = window.__savedDelete; }); }
  async function prepareCreate(target, amount = '0') {
    await target.getByRole('button', { name: '基金', exact: true }).click();
    await target.getByRole('button', { name: '基金投资 记录一次性投入' }).click();
    await target.locator('#fundName').fill('页面投资'); await target.locator('#fundPlatform').fill('自填平台');
    await target.locator('#fundAmount').fill(amount);
    await target.locator('#fundSourceAccountBtn').click();
    await target.locator('[data-fund-option="fundSourceAccount"][data-fund-value="1"]').click();
  }
  async function saveCreate(target) {
    await target.locator('#fundFormSubmit').click();
    await target.waitForFunction(() => !PwaLedger.status.busy && !fundUi.createBusy);
  }
  async function selectFund(target) { await target.evaluate(() => { switchTab('investment'); openFundDetail('fund-test'); }); }
  async function redeem(target, amount, full) {
    return target.evaluate(async ({ amount, full }) => {
      fundUi.selectedId = 'fund-test'; setFundView('redeem');
      document.getElementById('fundRedeemAmount').value = String(amount);
      document.querySelector('input[name="fundRedeemKind"][value="' + (full ? 'full' : 'partial') + '"]').checked = true;
      return PwaFunds.redeem();
    }, { amount, full });
  }

  await check('启动合并补记基金和退休金，重复触发不重记', async () => {
    const target = await setup({ project: recurring(), plan: pension() });
    let stored = await disk(target); const beforeRevision = stored.revision;
    assert(JSON.parse(stored.entries.jizhangben_records_1).length === 4);
    assert(await target.evaluate(() => fundTotals(fundProjectById('fund-test')).investedCents === 2000 && dataState.fixedIncomePlan.nextEligibleMonth === '2026-12'));
    await target.evaluate(async () => { await Promise.all([PwaFunds.requestDue(true), PwaFunds.requestDue(true), PwaFunds.requestDue(true)]); await PwaFunds.flushDue(); });
    stored = await disk(target); assert(stored.revision === beforeRevision && JSON.parse(stored.entries.jizhangben_records_1).length === 4);
    assert(stored.entries.jizhangben_records_2 === fixture.jizhangben_records_2);
    await target.screenshot({ path: 'output/playwright/pwa-stage2b2/due-' + browser.browserType().name() + '.png' });
  });
  await check('补记事务失败时金额、处理日期、运行标记一起恢复，重试只补一次', async () => {
    const project = recurring(), plan = pension();
    const target = await setup({ project, plan, abort: true }); const before = await disk(target);
    assert(before.entries.jizhangben_records_1 === fixture.jizhangben_records_1);
    assert(JSON.parse(before.entries.jizhangben_fund_projects_1)[0].processedDates.length === 0);
    assert(JSON.parse(before.entries.jizhangben_fixed_income_1).nextEligibleMonth === plan.nextEligibleMonth);
    assert(await target.evaluate(() => !document.getElementById('pwaPeriodicNotice').hidden && fundUi.lastRunDate === ''));
    await target.evaluate(async () => { window.__failFundWrites = false; await PwaFunds.requestDue(true); });
    const after = await disk(target); assert(after.revision === before.revision + 1 && JSON.parse(after.entries.jizhangben_records_1).length === 4);
    assert(await target.evaluate(() => document.getElementById('pwaPeriodicNotice').hidden));
  });
  await check('页面建立零金额一次投资，不制造收支或零金额流水', async () => {
    const target = await setup(); await prepareCreate(target); await saveCreate(target);
    const stored = await disk(target); const projects = JSON.parse(stored.entries.jizhangben_fund_projects_1);
    assert(projects.length === 1 && projects[0].amountCents === 0 && projects[0].processedDates.length === 1);
    assert(JSON.parse(stored.entries.jizhangben_records_1).length === 1);
    assert(JSON.parse(stored.entries.jizhangben_accounts_1).length === 2);
    assert(await target.evaluate(() => fundUi.view === 'detail'));
  });
  await check('建立基金失败不残留账户或首笔投入，表单保留后可重试', async () => {
    const target = await setup(); await prepareCreate(target, '10'); const before = await disk(target); await abortNext(target); await saveCreate(target);
    const failed = await disk(target); assert(failed.revision === before.revision && !failed.entries.jizhangben_fund_projects_1);
    assert(failed.entries.jizhangben_accounts_1 === before.entries.jizhangben_accounts_1 && await target.locator('#fundName').inputValue() === '页面投资');
    await restore(target); await saveCreate(target);
    const after = await disk(target); assert(JSON.parse(after.entries.jizhangben_records_1).length === 2 && JSON.parse(after.entries.jizhangben_fund_projects_1).length === 1);
  });
  await check('历史定投建立取消不写入，确认后只补约定交易日', async () => {
    const target = await setup(); await target.getByRole('button', { name:'基金',exact:true }).click();
    await target.getByRole('button', { name:'基金定投 按交易日自动记录' }).click();
    await target.locator('#fundName').fill('历史定投'); await target.locator('#fundPlatform').fill('平台');
    await target.locator('#fundAmount').fill('10'); await target.locator('#fundSourceAccountBtn').click();
    await target.locator('[data-fund-option="fundSourceAccount"][data-fund-value="1"]').click();
    await target.evaluate(() => { document.getElementById('fundStartDate').value='2026-11-10'; });
    const before=await disk(target); await target.locator('#fundFormSubmit').click(); await target.locator('#confirmDialogCancel').click();
    await target.waitForFunction(()=>!fundUi.createBusy); assert((await disk(target)).revision===before.revision);
    await target.locator('#fundFormSubmit').click(); await target.locator('#confirmDialogOk').click();
    await target.waitForFunction(()=>!PwaLedger.status.busy&&!fundUi.createBusy&&fundUi.view==='detail');
    assert(await target.evaluate(()=>dataState.records.filter(record=>record.fundAction==='contribution').map(record=>record.date).join(',')==='2026-11-10,2026-11-11'));
  });
  await check('基金设置及专属账户成本修改同进同退，历史资金记录不改写', async () => {
    const target = await setup({ project: single() }); await selectFund(target);
    await target.evaluate(() => openFundEdit()); await target.locator('#fundName').fill('改名后的基金'); await target.locator('#fundOriginalCost').fill('120');
    const before = await disk(target); await abortNext(target); await saveCreate(target);
    assert((await disk(target)).entries.jizhangben_fund_projects_1 === before.entries.jizhangben_fund_projects_1);
    assert(await target.locator('#fundName').inputValue() === '改名后的基金'); await restore(target); await saveCreate(target);
    const after = await disk(target); const fund = JSON.parse(after.entries.jizhangben_fund_projects_1)[0], account = JSON.parse(after.entries.jizhangben_accounts_1).find(item => item.id === 99);
    assert(fund.originalCostCents === 12000 && account.initialCents === 12000 && account.name.includes('改名后的基金'));
    assert(after.entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
  });
  await check('追加投资失败不增加本金，成功后本金与流水同步', async () => {
    const target = await setup({ project: single() }); await selectFund(target);
    await target.evaluate(() => setFundView('adjust')); await target.locator('#fundAdjustAmount').fill('20'); const before = await disk(target); await abortNext(target);
    await target.locator('#fundAdjustForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy);
    assert((await disk(target)).revision === before.revision && await target.locator('#fundAdjustAmount').inputValue() === '20');
    await restore(target); await target.locator('#fundAdjustForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy && fundUi.view === 'detail');
    assert(await target.evaluate(() => fundTotals(fundProjectById('fund-test')).investedCents === 12000));
  });
  await check('部分赎回不计盈亏，全部赎回成功后才结算收益', async () => {
    const target = await setup({ project: single() }); await selectFund(target); assert(await redeem(target, 30, false));
    assert(await target.evaluate(() => !dataState.records.some(record => record.fundAction === 'settlement') && fundProjectById('fund-test').status === 'open'));
    const before = await disk(target); await abortNext(target); assert(!await redeem(target, 80, true));
    assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1 && await target.evaluate(() => fundProjectById('fund-test').status === 'open'));
    await restore(target); assert(await redeem(target, 80, true));
    assert(await target.evaluate(() => fundProjectById('fund-test').status === 'closed' && dataState.records.some(record => record.fundAction === 'settlement' && record.fundResult === 'income' && record.amountCents === 1000)));
  });
  await check('全部取出零元时只结算实际亏损', async () => {
    const target = await setup({ project: single() }); assert(await redeem(target, 0, true));
    assert(await target.evaluate(() => dataState.records.some(record => record.fundAction === 'settlement' && record.fundResult === 'expense' && record.amountCents === 10000)));
  });
  await check('更正已结清投入，原编号、本金和结算同步，失败时保留编辑', async () => {
    const project = { ...single(0), amountCents: 10000, processedDates: [] };
    const target = await setup({ project }); await selectFund(target); assert(await redeem(target, 120, true));
    const recordId = await target.evaluate(() => dataState.records.find(record => record.fundAction === 'contribution').id);
    await target.evaluate(id => openFundRecordEditor(id), recordId); await target.locator('#fundRecordAmount').fill('90');
    const before = await disk(target); await abortNext(target); await target.locator('#fundRecordForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy && !fundUi.recordBusy);
    assert((await disk(target)).revision === before.revision && await target.locator('#fundRecordAmount').inputValue() === '90'); await restore(target);
    await target.locator('#fundRecordForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy && fundUi.view === 'detail');
    assert(await target.evaluate(id => dataState.records.some(record => record.id === id && record.amountCents === 9000) && dataState.records.some(record => record.fundAction === 'settlement' && record.amountCents === 3000), recordId));
  });
  await check('撤销自动投入后不重复补回，暂停选项保留', async () => {
    const target = await setup({ project: recurring() });
    await target.evaluate(async () => { const record = dataState.records.find(item => item.fundScheduledDate); await PwaFunds.commit(() => correctFundRecord('fund-test', record.id, {bookId:1,void:true,pauseSchedule:true}, JSON.stringify(record))); });
    await target.evaluate(() => PwaFunds.requestDue(true));
    assert(await target.evaluate(() => dataState.records.filter(record => record.fundProjectId).length === 1 && fundProjectById('fund-test').processedDates.length === 2 && fundProjectById('fund-test').scheduleStatus === 'paused'));
  });
  await check('暂停失败不改变状态，恢复只从恢复日起补记', async () => {
    const target = await setup({ project: recurring() }); await selectFund(target); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => PwaFunds.toggle('fund-test'))); assert((await disk(target)).revision === before.revision); await restore(target);
    assert(await target.evaluate(() => PwaFunds.toggle('fund-test')));
    await target.evaluate(async () => { window.__fundClock = Date.parse('2026-11-12T12:00:00+08:00'); await PwaFunds.requestDue(true); });
    assert(await target.evaluate(() => dataState.records.filter(record => record.fundProjectId).length === 2));
    assert(await target.evaluate(() => PwaFunds.toggle('fund-test')));
    assert(await target.evaluate(() => dataState.records.filter(record => record.fundProjectId).length === 3 && fundProjectById('fund-test').resumeFromDate === '2026-11-12'));
  });
  await check('删除基金事务失败保留账户和历史，成功只删除该基金', async () => {
    const target = await setup({ project: recurring() }); await selectFund(target); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => PwaFunds.remove('fund-test'))); assert((await disk(target)).revision === before.revision); await restore(target);
    assert(await target.evaluate(() => PwaFunds.remove('fund-test')));
    const after = await disk(target); assert(JSON.parse(after.entries.jizhangben_records_1).length === 1 && JSON.parse(after.entries.jizhangben_accounts_1).length === 1 && JSON.parse(after.entries.jizhangben_fund_projects_1).length === 0);
    assert(after.entries.jizhangben_records_2 === fixture.jizhangben_records_2);
  });
  await check('退休金设置失败保留输入，修改金额不改历史收入', async () => {
    const target = await setup({ plan: pension() }); await target.evaluate(() => switchTab('fixedIncome'));
    await target.locator('#fixedIncomeAmount').fill('600'); const before = await disk(target); await abortNext(target);
    await target.locator('#fixedIncomeForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy);
    assert((await disk(target)).revision === before.revision && await target.locator('#fixedIncomeAmount').inputValue() === '600'); await restore(target);
    await target.locator('#fixedIncomeForm button[type="submit"]').click(); await target.waitForFunction(() => !PwaLedger.status.busy);
    const after = await disk(target); assert(JSON.parse(after.entries.jizhangben_fixed_income_1).amountCents === 60000 && after.entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
  });
  await check('清除退休金失败可重试，刷新不从旧副本复活计划', async () => {
    const target = await setup({ plan: pension() }); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => PwaFunds.clearPension())); assert((await disk(target)).revision === before.revision); await restore(target);
    assert(await target.evaluate(() => PwaFunds.clearPension())); await target.reload(); await target.waitForFunction(() => PwaLedger.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore && dataState.currentBookId !== null);
    assert(await target.evaluate(() => dataState.fixedIncomePlan === null)); assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
  });
  await check('暂停退休金跳过暂停月份，不补造已暂停收入', async () => {
    const target = await setup({ plan: { ...pension(), active: false, startMonth: '2026-01', nextEligibleMonth: '2026-01' } });
    assert(await target.evaluate(() => dataState.records.length === 1 && dataState.fixedIncomePlan.nextEligibleMonth === '2026-12'));
    await target.evaluate(() => PwaFunds.savePension({ ...dataState.fixedIncomePlan, active:true }));
    assert(await target.evaluate(() => dataState.records.length === 1));
  });
  await check('退休金月末日期按当月最后一天处理并去重', async () => {
    const target = await setup({ plan: { ...pension(), day: 31, startMonth: '2026-10', nextEligibleMonth: '2026-10' }, time: '2026-11-30T12:00:00+08:00' });
    assert(await target.evaluate(() => dataState.records.filter(record => record.fixedIncomePlanId).map(record => record.date).join(',') === '2026-10-31,2026-11-30'));
    await target.evaluate(() => PwaFunds.requestDue(true)); assert(await target.evaluate(() => dataState.records.length === 3));
  });
  await check('未知年份休市表暂停定投，不能误作交易日', async () => {
    const target = await setup({ project: { ...recurring(), startDate: '2027-01-01' }, time: '2027-01-04T12:00:00+08:00' });
    assert(await target.evaluate(() => dataState.records.length === 1 && fundProjectById('fund-test').processedDates.length === 0 && !document.getElementById('fundCalendarNotice').hidden));
  });
  await check('其他窗口先更新后，基金表单旧保存被拒绝且输入保留', async () => {
    const target = await setup(); const other = await target.context().newPage(); await other.goto(url);
    await other.waitForFunction(() => PwaLedger.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore && dataState.currentBookId !== null);
    await prepareCreate(target, '10');
    await other.evaluate(() => PwaLedger.commitChange(() => { dataState.records[0].note = '其他窗口更新'; save(); }));
    await saveCreate(target); assert(await target.evaluate(() => PwaLedger.status.conflict));
    assert(await target.locator('#fundName').inputValue() === '页面投资'); assert(!(await disk(target)).entries.jizhangben_fund_projects_1);
  });
  await check('资金保存忙碌期间延后补记，不丢保存也不重复扣账', async () => {
    const target = await setup({ project: { ...recurring(), startDate:'2026-11-12' } });
    await target.evaluate(async () => {
      window.__fundClock = Date.parse('2026-11-12T12:00:00+08:00');
      const command = PwaLedger.commitChange(() => { dataState.records[0].note = '正在保存的内容'; save(); });
      await PwaFunds.requestDue(true); await command; await PwaFunds.flushDue();
    });
    assert(await target.evaluate(() => dataState.records.length === 2 && dataState.records[0].note === '正在保存的内容' && fundProjectById('fund-test').processedDates.length === 1));
  });
  await check('编辑时暂缓自动补记，离开后补记且不覆盖未保存金额', async () => {
    const target=await setup({plan:pension()}); await target.evaluate(()=>switchTab('fixedIncome'));
    await target.locator('#fixedIncomeAmount').fill('650');
    await target.evaluate(async()=>{window.__fundClock=Date.parse('2026-12-01T12:00:00+08:00');await PwaFunds.requestDue(true);});
    assert(await target.evaluate(()=>dataState.records.length===2));
    await target.evaluate(async()=>{switchTab('home');await PwaFunds.flushDue();});
    const actual=await target.evaluate(()=>({records:dataState.records.length,amount:document.getElementById('fixedIncomeAmount').value,incomes:dataState.records.filter(record=>record.fixedIncomePlanId).map(record=>record.amountCents),tab:uiState.activeTab,focused:document.activeElement.id,focusedRects:document.activeElement.getClientRects().length,busy:PwaLedger.status.busy}));
    assert(actual.records===3&&actual.amount==='650'&&actual.incomes.every(value=>value===50000),JSON.stringify(actual));
  });
  return { browser: browser.version(), results, errors, unexpectedRequests };
}
