// Playwright CLI 页面检查；只使用合成账本，不进入公开产物。
async (page) => {
  const fixture = page.__pwaFixture;
  if (!fixture) throw Error('请先加载合成测试夹具');
  const browser = page.context().browser(), results = [], errors = [], unexpectedRequests = [], contexts = [];
  const url = 'http://127.0.0.1:4176/ledger-preview/';
  const assert = (ok, text = '检查未通过') => { if (!ok) throw Error(text); };
  async function setup(seed = fixture, missingModule = false) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 393, height: 852 }, timezoneId: 'Asia/Shanghai' });
    context.setDefaultTimeout(7000); contexts.push(context);
    context.on('request', request => {
      const parsed = new URL(request.url());
      if (parsed.protocol.startsWith('http') && (parsed.origin !== 'http://127.0.0.1:4176' || /\/api(?:\/|$)/.test(parsed.pathname))) unexpectedRequests.push(request.url());
    });
    await context.addInitScript(seed => {
      if (location.origin === 'http://127.0.0.1:4176' && !localStorage.getItem('management-seeded')) {
        Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('management-seeded', '1');
      }
    }, seed);
    const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
    if (missingModule) await context.route('**/pwa-management-storage.js*', route => route.abort());
    await target.goto(url);
    if (missingModule) await target.waitForFunction(() => document.getElementById('pwaStorageGate').getAttribute('role') === 'alert');
    else await ready(target);
    return target;
  }
  async function ready(target) {
    await target.waitForFunction(() => window.PwaManagement && PwaLedger.status.ready && !PwaLedger.status.busy && !PwaLedger.status.initializingCore && !PwaManagement.busy && dataState.currentBookId !== null);
  }
  async function check(name, action) {
    if (page.__managementOnly && !name.includes(page.__managementOnly)) return;
    const start = contexts.length;
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, message: error.message }); }
    finally { for (const context of contexts.slice(start)) await context.close(); }
  }
  async function disk(target) {
    return target.evaluate(async () => { const db = await LedgerDatabase.open(); try { return await db.read(); } finally { db.close(); } });
  }
  async function abortNext(target) {
    await target.evaluate(() => {
      window.__managementOriginals = { put: IDBObjectStore.prototype.put, delete: IDBObjectStore.prototype.delete };
      window.__managementAbort = true;
      for (const method of ['put', 'delete']) {
        IDBObjectStore.prototype[method] = function (...args) {
          const request = window.__managementOriginals[method].apply(this, args);
          if (this.name === 'ledger') {
            const tx = this.transaction;
            request.addEventListener('success', () => { if (window.__managementAbort) { window.__managementAbort = false; tx.abort(); } });
          }
          return request;
        };
      }
    });
  }
  async function restore(target) {
    await target.evaluate(() => { Object.assign(IDBObjectStore.prototype, window.__managementOriginals); });
    await dismiss(target);
  }
  async function dismiss(target) {
    if (await target.evaluate(() => !!pendingNotice)) await target.locator('#confirmDialogOk').click();
  }
  async function confirmed(target, expression, yes = true) {
    await target.evaluate(expression => { window.__managementCommand = eval(expression); }, expression);
    await target.locator('#confirmDialog').waitFor({ state: 'visible' });
    await target.locator(yes ? '#confirmDialogOk' : '#confirmDialogCancel').click();
    return target.evaluate(() => window.__managementCommand);
  }
  async function books(target) { await target.evaluate(() => switchTab('book')); }
  async function categories(target, side = 'expense') {
    await target.evaluate(side => { switchTab('categorySystem'); categorySystemSide = side; categorySystemExpandedKey = 'food'; renderCategorySystem(); }, side);
  }
  async function budget(target) { await target.evaluate(() => switchTab('budget')); }
  async function importJson(target, storage, { yes = true, abort = false } = {}) {
    if (abort) await abortNext(target);
    await target.evaluate(storage => importBackup(new File([JSON.stringify(storage)], '合成备份.json', { type: 'application/json' })), storage);
    await target.evaluate(() => { window.__managementCommand = PwaBackup.restorePreview(); });
    await target.locator('#confirmDialog').waitFor({ state: 'visible' });
    await target.locator(yes ? '#confirmDialogOk' : '#confirmDialogCancel').click();
    return target.evaluate(() => window.__managementCommand);
  }

  await check('旧类别编号、顺序、隐藏项和所有流水在启动与切换后保持', async () => {
    const target = await setup(); const before = await disk(target);
    assert(await target.evaluate(() => !document.getElementById('bookPickerBtn').disabled), '账本按钮被禁用');
    await target.evaluate(() => switchBook(2)); await ready(target); await target.evaluate(() => switchBook(1)); await ready(target);
    const after = await disk(target);
    for (const key of Object.keys(fixture).filter(key => /records_|category|custom/.test(key))) assert(before.entries[key] === after.entries[key], key);
    assert(await target.evaluate(() => dataState.currentBookId === 1 && dataState.records.length === 1), JSON.stringify(await target.evaluate(() => ({book:dataState.currentBookId, records:dataState.records, message:document.getElementById('bookMsg').textContent}))));
  });
  await check('账本切换失败保留原账本与输入，成功重开读取选择', async () => {
    const target = await setup(); await books(target); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => switchBook(2)));
    assert((await disk(target)).revision === before.revision);
    assert(await target.evaluate(() => dataState.currentBookId === 1 && document.getElementById('bookSel').value === '1'));
    await restore(target); assert(await target.evaluate(() => switchBook(2)));
    await target.reload(); await ready(target); assert(await target.evaluate(() => dataState.currentBookId === 2 && dataState.records[0].category === '测试奖励'));
  });
  await check('已保存为空的账户切换和重开均不复活默认账户', async () => {
    const target = await setup({ ...fixture, jizhangben_accounts_2: '[]' });
    await target.evaluate(() => switchBook(2)); assert(await target.evaluate(() => dataState.accounts.length === 0));
    await target.reload(); await ready(target); assert(await target.evaluate(() => dataState.accounts.length === 0));
  });
  await check('新增账本失败保留名称，快速重复保存只新增一次', async () => {
    const target = await setup(); await books(target); await target.locator('#bookName').fill('新合成账本'); await target.locator('#bookCategory').fill('测试分组');
    const before = await disk(target); await abortNext(target); await target.locator('#bookSaveBtn').click(); await ready(target);
    assert((await disk(target)).revision === before.revision && await target.locator('#bookName').inputValue() === '新合成账本');
    assert(await target.evaluate(() => dataState.books.length === 2)); await restore(target);
    await target.evaluate(() => Promise.all([handleBookSave(), handleBookSave(), handleBookSave()]));
    assert(await target.evaluate(() => dataState.books.length === 3 && document.getElementById('bookName').value === ''));
  });
  await check('账本改名失败原清单不变，成功不修改账目和账户', async () => {
    const target = await setup(); await books(target); await target.evaluate(() => startEditBook(1));
    await target.locator('#bookName').fill('账本更名'); const before = await disk(target); await abortNext(target);
    await target.locator('#bookSaveBtn').click(); await ready(target);
    assert(await target.evaluate(() => dataState.books[0].name === '测试账本甲' && document.getElementById('bookName').value === '账本更名'));
    await restore(target); await target.locator('#bookSaveBtn').click(); await ready(target);
    const after = await disk(target); assert(after.entries.jizhangben_records_1 === before.entries.jizhangben_records_1 && after.entries.jizhangben_accounts_1 === before.entries.jizhangben_accounts_1);
  });
  await check('删除当前账本取消不写入，失败不半删除，成功切换且保留其他账本', async () => {
    const seed = { ...fixture, jizhangben_budgets_1: '{"version":1,"periods":{}}', jizhangben_investment_plans_1: '[]', jizhangben_fund_projects_1: '[]', jizhangben_fixed_income_1: '{"id":"inactive-pension","amountCents":100,"accountId":1,"day":1,"startMonth":"2026-11","nextEligibleMonth":"2026-12","active":false}' };
    const target = await setup(seed); await books(target); const before = await disk(target);
    await confirmed(target, 'deleteBook(1)', false); assert((await disk(target)).revision === before.revision);
    await abortNext(target); await confirmed(target, 'deleteBook(1)'); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    assert(await target.evaluate(() => dataState.currentBookId === 1 && dataState.books.length === 2));
    await restore(target); await confirmed(target, 'deleteBook(1)'); const after = await disk(target);
    for (const prefix of ['records', 'accounts', 'budgets', 'investment_plans', 'fund_projects', 'fixed_income']) assert(!Object.hasOwn(after.entries, 'jizhangben_' + prefix + '_1'), prefix);
    assert(after.entries.jizhangben_records_2 === before.entries.jizhangben_records_2);
    await target.reload(); await ready(target); assert(await target.evaluate(() => dataState.currentBookId === 2 && dataState.books.length === 1));
  });
  await check('新增大类失败不清输入，成功保存后收起', async () => {
    const target = await setup(); await categories(target); await target.locator('#categoryGroupCreateToggle').click();
    await target.locator('#categoryGroupName').fill('合成大类'); const before = await disk(target); await abortNext(target);
    await target.locator('#categoryGroupForm button[type=submit]').click(); await ready(target);
    assert((await disk(target)).revision === before.revision && await target.locator('#categoryGroupName').inputValue() === '合成大类');
    await restore(target); await target.locator('#categoryGroupForm button[type=submit]').click(); await ready(target);
    assert(await target.evaluate(() => categorySystemGroups().some(group => group.name === '合成大类') && document.getElementById('categoryGroupForm').hidden));
  });
  await check('新增小类图标和元数据联合提交，失败不残留半个小类', async () => {
    const target = await setup(); await categories(target); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => createCategoryItem('food', '合成小类', 'dining')));
    assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    assert(await target.evaluate(() => !categorySystemItemNames().includes('合成小类') && !dataState.customCategories.includes('合成小类') && !dataState.customCategoryIcons['合成小类']));
    await restore(target); assert(await target.evaluate(() => createCategoryItem('food', '合成小类', 'dining')));
    await target.reload(); await ready(target); assert(await target.evaluate(() => categorySystemItemNames().includes('合成小类') && dataState.customCategoryIcons['合成小类'] === 'dining'));
  });
  await check('点击小类编辑图标可取消，保存失败保留编辑，重试后生效', async () => {
    const target = await setup(); await categories(target); const before = await disk(target);
    const icon = target.locator('[data-sort-id="测试自定义小类"] .category-system-item-icon');
    await icon.click(); await target.locator('#categoryItemEditIconChoices [data-category-icon-key="transport"]').click();
    await target.locator('[data-category-item-edit-close]').first().click(); assert((await disk(target)).revision === before.revision);
    await icon.click(); await target.locator('#categoryItemEditIconChoices [data-category-icon-key="transport"]').click(); await abortNext(target);
    await target.locator('#categoryItemEditSave').click(); await ready(target);
    assert(await target.locator('#categoryItemEditBackdrop').isVisible()); assert((await disk(target)).revision === before.revision);
    await restore(target); await target.locator('#categoryItemEditSave').click(); await ready(target); await dismiss(target);
    assert(await target.evaluate(() => dataState.customCategoryIcons['测试自定义小类'] === 'transport' && document.getElementById('categoryItemEditBackdrop').hidden));
  });
  await check('支出小类改名跨账本同步流水预算及图标，失败全部回滚', async () => {
    const seed = { ...fixture, jizhangben_budgets_1: '{"version":1,"periods":{"2026-11":{"totalCents":10000,"categories":{"测试自定义小类":3000}}}}',
      jizhangben_budgets_2: '{"version":1,"periods":{"2026-11":{"totalCents":9000,"categories":{"测试自定义小类":2000}}}}' };
    const records = JSON.parse(seed.jizhangben_records_2); records.push({ ...JSON.parse(seed.jizhangben_records_1)[0], id: 3 }); seed.jizhangben_records_2 = JSON.stringify(records);
    const target = await setup(seed); await categories(target); const before = await disk(target); await abortNext(target);
    assert(!await confirmed(target, 'renameCategoryItem("food","测试自定义小类","改后小类","transport")'));
    assert(JSON.stringify(await disk(target)) === JSON.stringify(before)); await restore(target);
    assert(await confirmed(target, 'renameCategoryItem("food","测试自定义小类","改后小类","transport")'));
    const after = await disk(target);
    for (const id of [1,2]) {
      assert(JSON.parse(after.entries['jizhangben_records_' + id]).some(record => record.category === '改后小类'));
      const budgets = JSON.parse(after.entries['jizhangben_budgets_' + id]); assert(budgets.periods['2026-11'].categories['改后小类'] > 0 && !budgets.periods['2026-11'].categories['测试自定义小类']);
    }
    assert(await target.evaluate(() => dataState.customCategoryIcons['改后小类'] === 'transport' && !dataState.customCategoryIcons['测试自定义小类']));
  });
  await check('收入改名只改变今后选择，原收入流水名称保留', async () => {
    const target = await setup(); await categories(target, 'income'); const before = await disk(target);
    assert(await confirmed(target, 'renameCategoryItem("family-income-test","测试奖励","新奖励","other")'));
    assert((await disk(target)).entries.jizhangben_records_2 === before.entries.jizhangben_records_2);
    assert(await target.evaluate(() => dataState.categorySystem.hidden.includes('测试奖励') && categorySystemItemNames().includes('新奖励')));
  });
  await check('大类改名提交失败保留原名称，重试保持小类及排序', async () => {
    const target = await setup(); await categories(target); const before = await disk(target); await abortNext(target);
    assert(!await confirmed(target, 'renameCategoryGroup("food","新的食品大类")')); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await restore(target); assert(await confirmed(target, 'renameCategoryGroup("food","新的食品大类")'));
    const previous = JSON.parse(before.entries.jizhangben_category_system).groups;
    assert(await target.evaluate(previous => categorySystemGroups().every((group, index) => group.key === previous[index].key && JSON.stringify(group.items) === JSON.stringify(previous[index].items)), previous));
  });
  await check('排序失败恢复原顺序，重试保留图标与隐藏项', async () => {
    const target = await setup(); await categories(target); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => reorderCategoryItems('food', categorySystemGroups().find(group => group.key === 'food').items.slice().reverse())));
    assert(JSON.stringify(await disk(target)) === JSON.stringify(before)); await restore(target);
    assert(await target.evaluate(() => reorderCategoryItems('food', categorySystemGroups().find(group => group.key === 'food').items.slice().reverse())));
    const old = JSON.parse(before.entries.jizhangben_category_system), after = JSON.parse((await disk(target)).entries.jizhangben_category_system);
    assert(JSON.stringify(after.groups.find(group => group.key === 'food').items) === JSON.stringify(old.groups.find(group => group.key === 'food').items.reverse()));
    assert(JSON.stringify(after.hidden) === JSON.stringify(old.hidden));
  });
  await check('长按小类拖动保存排序，普通点击仍打开编辑', async () => {
    const target = await setup(); await categories(target);
    const items = target.locator('[data-sort-id="food"] .category-system-item');
    await items.first().scrollIntoViewIfNeeded(); const firstName = await items.first().getAttribute('data-sort-id');
    const first = await items.first().boundingBox(), last = await items.nth(2).boundingBox();
    await target.mouse.move(first.x+first.width/2, first.y+first.height/2); await target.mouse.down();
    await target.waitForFunction(() => !!document.querySelector('.category-system-drag-ghost'));
    await target.mouse.move(last.x+last.width*0.8, last.y+last.height/2, { steps: 10 }); await target.mouse.up(); await ready(target);
    assert(await target.evaluate(name => categorySystemGroups().find(group => group.key === 'food').items[0] !== name && !categoryItemIconEditState, firstName));
    await items.first().locator('.category-system-item-icon').click(); assert(await target.locator('#categoryItemEditBackdrop').isVisible());
  });
  await check('删除小类取消不变，失败保留，成功只隐藏不删历史', async () => {
    const target = await setup(); await categories(target); const before = await disk(target);
    await confirmed(target, 'removeCategoryItem("food","测试自定义小类")', false); assert((await disk(target)).revision === before.revision);
    await abortNext(target); assert(!await confirmed(target, 'removeCategoryItem("food","测试自定义小类")')); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await restore(target); assert(await confirmed(target, 'removeCategoryItem("food","测试自定义小类")'));
    assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
    assert(await target.evaluate(() => dataState.categorySystem.hidden.includes('测试自定义小类')));
  });
  await check('预算总额失败保留输入，清除和分类额度均可保存重开', async () => {
    const target = await setup(); await budget(target); await target.locator('#budgetTotalInput').fill('600');
    const before = await disk(target); await abortNext(target); await target.locator('#budgetSaveTotalBtn').click(); await ready(target);
    assert((await disk(target)).revision === before.revision && await target.locator('#budgetTotalInput').inputValue() === '600');
    await restore(target); await target.locator('#budgetSaveTotalBtn').click(); await ready(target);
    await target.evaluate(() => { document.getElementById('budgetCategorySelect').value = '测试自定义小类'; document.getElementById('budgetCategoryInput').value='100'; });
    await abortNext(target); await target.locator('#budgetAddCategoryBtn').click(); await ready(target);
    assert(await target.evaluate(() => document.getElementById('budgetCategoryInput').value === '100' && !budgetPeriod().categories['测试自定义小类']));
    await restore(target); await target.locator('#budgetAddCategoryBtn').click(); await ready(target);
    const row = target.locator('[data-budget-category="测试自定义小类"]'); await row.locator('input').fill('80'); await row.locator('[data-budget-action=save]').click(); await ready(target);
    await target.locator('#budgetClearTotalBtn').click(); await ready(target);
    await target.reload(); await ready(target); await budget(target); assert(await target.evaluate(() => budgetPeriod().totalCents === null && budgetPeriod().categories['测试自定义小类'] === 8000));
    await target.locator('[data-budget-action=remove]').click(); await ready(target); assert(await target.evaluate(() => !budgetPeriod().categories['测试自定义小类']));
  });
  await check('JSON导入取消或损坏均保留当前数据', async () => {
    const target = await setup(); await target.evaluate(() => switchTab('manage')); const before = await disk(target);
    await importJson(target, fixture, { yes: false }); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    assert(!await target.evaluate(() => importBackup(new File(['损坏'], '坏备份.json')))); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    assert(await target.locator('#backupMsg').innerText().then(text => text.includes('无效')));
  });
  await check('JSON替换失败全部回滚，重试后旧图标顺序隐藏项保留且不从旧副本复活', async () => {
    const target = await setup(); const before = await disk(target); const imported = { ...fixture, jizhangben_current_book: '2', jizhangben_records_1: '[]', jizhangben_accounts_2: '[]' };
    assert(!await importJson(target, imported, { abort: true })); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await restore(target); assert(await importJson(target, imported));
    const after = await disk(target); assert(after.entries.jizhangben_records_1 === '[]' && after.entries.jizhangben_category_system === fixture.jizhangben_category_system);
    await target.reload(); await ready(target);
    assert(await target.evaluate(() => dataState.currentBookId === 2 && dataState.accounts.length === 0 && localStorage.getItem('jizhangben_records_1') !== '[]'));
  });
  await check('CSV预览取消不写入，事务失败不残留账本且保留预览可重试', async () => {
    const target = await setup(); await target.evaluate(() => switchTab('manage'));
    const csv='日期,类型,分类,金额,账户,备注\n2026-11-10,支出,外部餐饮,15,测试银行,合成午餐\n2026-11-11,收入,外部工资,600,测试银行,合成工资';
    await target.evaluate(csv => previewExternalImportFile(new File([csv],'合成账本.csv')), csv);
    const before = await disk(target); await confirmed(target, 'commitExternalImport()', false); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await abortNext(target); assert(!await confirmed(target, 'commitExternalImport()')); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    assert(await target.evaluate(() => externalImportState.rows.length === 2 && dataState.books.length === 2));
    await restore(target); assert(await confirmed(target, 'commitExternalImport()'));
    const after = await disk(target);
    assert(after.entries.jizhangben_records_1 === before.entries.jizhangben_records_1 && after.entries.jizhangben_records_2 === before.entries.jizhangben_records_2);
    assert(await target.evaluate(() => dataState.books.length === 3 && dataState.records.length === 2 && dataState.records.every(record => record.importSourceFile === '合成账本.csv') && dataState.fundProjects.length === 0 && dataState.fixedIncomePlan === null));
  });
  await check('自定义记账类型失败不增加，重试可保存，删除不移除旧流水', async () => {
    const target = await setup(); const before = await disk(target); await abortNext(target);
    assert(!await target.evaluate(() => PwaManagement.addCustom('type','合成自定义支出'))); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await restore(target); assert(await target.evaluate(() => { uiState.customTypeSideDraft='expense'; return PwaManagement.addCustom('type','合成自定义支出'); }));
    assert(await target.evaluate(() => dataState.customTypes.some(item => item.name === '合成自定义支出' && item.side === 'expense')));
    await confirmed(target, 'removeCustom("type","合成自定义支出")'); assert((await disk(target)).entries.jizhangben_records_1 === before.entries.jizhangben_records_1);
  });
  await check('多窗口旧类别保存被拒绝，编辑内容仍保留', async () => {
    const target = await setup(); await categories(target);
    await target.locator('[data-sort-id="测试自定义小类"] .category-system-item-icon').click(); await target.locator('#categoryItemEditNameInput').fill('本页未保存');
    const other = await target.context().newPage(); await other.goto(url); await ready(other);
    await other.evaluate(() => PwaManagement.categoryIcon('测试自定义小类','transport'));
    await target.locator('#categoryItemEditIconChoices [data-category-icon-key="education"]').click();
    assert(!await confirmed(target, 'saveCategoryItemChanges()'));
    assert(await target.evaluate(() => PwaLedger.status.conflict && !document.getElementById('categoryItemEditBackdrop').hidden && categoryItemIconEditState.iconKey === 'education' && document.getElementById('categoryItemEditNameInput').value === '本页未保存'));
    assert(JSON.parse((await disk(other)).entries.jizhangben_custom_category_icons)['测试自定义小类'] === 'transport');
  });
  await check('管理脚本加载不完整时停止启动，不能打开半接入账本', async () => {
    const target = await setup(fixture, true); const after = await disk(target);
    assert(await target.evaluate(() => !PwaLedger.status.ready && dataState.currentBookId === null));
    for (const [key,value] of Object.entries(fixture)) assert(after.entries[key] === value, key);
  });
  await check('新增小类抽屉失败保留名称和选中图标，取消不写入', async () => {
    const target = await setup(); await categories(target); const group = target.locator('[data-sort-id="food"]');
    const toggle = group.locator('.category-system-sub-toggle'); await toggle.click();
    await group.locator('.category-system-sub-input').fill('抽屉合成类别');
    await group.locator('[data-category-icon-key="education"]').click(); const before = await disk(target); await abortNext(target);
    await group.locator('.category-system-sub-submit').click(); await ready(target);
    assert(await group.locator('.category-system-sub-input').inputValue() === '抽屉合成类别');
    assert(await group.locator('[data-category-icon-key="education"]').getAttribute('aria-pressed') === 'true');
    assert(JSON.stringify(await disk(target)) === JSON.stringify(before)); await restore(target);
    await toggle.click(); assert((await disk(target)).revision === before.revision);
    assert(await toggle.getAttribute('aria-expanded') === 'false');
  });
  await check('大类删除失败不丢组，成功只隐藏小类并保留历史与图标', async () => {
    const target = await setup(); await categories(target); const before = await disk(target); await abortNext(target);
    assert(!await confirmed(target, 'removeCategoryGroup("food")')); assert(JSON.stringify(await disk(target)) === JSON.stringify(before));
    await restore(target); assert(await confirmed(target, 'removeCategoryGroup("food")'));
    const after = await disk(target); assert(after.entries.jizhangben_records_1 === before.entries.jizhangben_records_1 && after.entries.jizhangben_custom_category_icons === before.entries.jizhangben_custom_category_icons);
    assert(await target.evaluate(() => !categorySystemGroups().some(group => group.key === 'food') && dataState.categorySystem.hidden.includes('测试自定义小类')));
  });
  await check('女生记账多账本CSV联合导入，原账本及账户均不覆盖', async () => {
    const target = await setup();
    const csv='日期,收入/支出,金额,类别,备注,\n\n账本：合成甲,\n2026年11月1日,支出,30,合成生活,备注甲,\n账本：合成乙,\n2026年11月2日,收入,70,合成生活费,备注乙,';
    await target.evaluate(csv => previewExternalImportFile(new File([csv], '女生记账合成.csv')), csv);
    const before = await disk(target); assert(await confirmed(target, 'commitExternalImport()'));
    const after = await disk(target); for (const key of ['jizhangben_records_1','jizhangben_records_2','jizhangben_accounts_1','jizhangben_accounts_2']) assert(after.entries[key] === before.entries[key]);
    assert(await target.evaluate(() => dataState.books.length === 4 && dataState.accounts[0].name === '未注明账户' && dataState.records[0].importSourceRow === 4));
    const newBooks=JSON.parse(after.entries.jizhangben_books).slice(2);
    assert(newBooks.every(book => JSON.parse(after.entries['jizhangben_records_'+book.id]).length === 1));
  });
  await check('旧版未区分收支的备份导入保留图标顺序隐藏项与设备隐私偏好', async () => {
    const target = await setup({ ...fixture, ledger_privacy_mask_v1:'1' });
    const oldSystem=JSON.parse(fixture.jizhangben_category_system); oldSystem.groups.forEach(group => {delete group.side;});
    const legacy = { ...fixture, jizhangben_category_system:JSON.stringify(oldSystem) };
    assert(await importJson(target, {format:'jizhangben-backup',version:3,storage:legacy}));
    const after=await disk(target), system=JSON.parse(after.entries.jizhangben_category_system);
    assert(system.groups.every((group,index)=>group.key===oldSystem.groups[index].key && JSON.stringify(group.items)===JSON.stringify(oldSystem.groups[index].items)));
    assert(system.groups.find(group=>group.key==='family-income-test').side==='income');
    assert(JSON.stringify(system.hidden)===JSON.stringify(oldSystem.hidden) && after.entries.jizhangben_custom_category_icons===fixture.jizhangben_custom_category_icons);
    assert(await target.evaluate(()=>localStorage.getItem('ledger_privacy_mask_v1')==='1' && document.body.classList.contains('privacy-masked')));
  });
  await check('其他窗口修改后预算旧保存被拒绝，旧输入可见且新值保留', async () => {
    const target=await setup(); await budget(target); await target.locator('#budgetTotalInput').fill('900');
    const other=await target.context().newPage(); await other.goto(url); await ready(other); await budget(other);
    await other.locator('#budgetTotalInput').fill('500'); await other.locator('#budgetSaveTotalBtn').click(); await ready(other);
    await target.locator('#budgetSaveTotalBtn').click(); await target.waitForFunction(()=>!PwaLedger.status.busy);
    assert(await target.locator('#budgetTotalInput').inputValue()==='900' && await target.evaluate(()=>PwaLedger.status.conflict));
    assert(await other.evaluate(()=>budgetPeriod().totalCents===50000));
  });
  return { browser: browser.version(), results, errors, unexpectedRequests };
}
