const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function createCategoryEditorRuntime() {
  const runtime = createCategoryRuntime();
  runtime.run(`
    dataState.categorySystem.groups[0].items = ["示例小类"];
    var editorNodes = {
      categoryItemEditNameInput: { value: "更改的小类" },
      categoryItemEditSave: { disabled: false, textContent: "保存更改", setAttribute(name, value) { this[name] = value; } },
      categoryItemEditStatus: { textContent: "" },
      categoryItemEditBackdrop: { hidden: false }, panelCategorySystem: { inert: true }
    };
    var editorCloseButtons = [{disabled:false}];
    var restoredEditorScroll = null;
    var removedEditorClass = null;
    document = {
      getElementById(id) { return editorNodes[id] || null; },
      querySelectorAll() { return editorCloseButtons; },
      body: { classList: { remove(name) { removedEditorClass = name; } } }
    };
    window.scrollTo = (_, y) => { restoredEditorScroll = y; };
    categoryItemIconEditState = {groupKey:dataState.categorySystem.groups[0].key,name:"示例小类",iconKey:"tabler:coffee",scrollTop:237,pageWasInert:false,saving:false};
    appNotice = () => {};
  `);
  return runtime;
}

test("canceling an icon editor restores browsing without persisting its draft", () => {
  const runtime = createCategoryEditorRuntime();
  const before = runtime.localStorage.toObject();
  assert.equal(runtime.run("closeCategoryItemIconEditor()"), true);
  assert.equal(runtime.run("categoryItemIconEditState"), null);
  assert.equal(runtime.run("editorNodes.categoryItemEditBackdrop.hidden"), true);
  assert.equal(runtime.run("editorNodes.panelCategorySystem.inert"), false);
  assert.equal(runtime.run("restoredEditorScroll"), 237);
  assert.equal(runtime.run("removedEditorClass"), "category-item-editor-open");
  assert.deepEqual(runtime.localStorage.toObject(), before);
});

test("return from a category confirmation closes only that confirmation", () => {
  const runtime = createCategoryEditorRuntime();
  const before = runtime.localStorage.toObject();
  runtime.run('var categoryConfirmationCancelled=false; pendingConfirm={}; finishAppConfirm=()=>{pendingConfirm=null;categoryConfirmationCancelled=true;};');
  assert.equal(runtime.run("closeCategoryItemIconEditor()"), true);
  assert.equal(runtime.run("categoryConfirmationCancelled"), true);
  assert.equal(runtime.run("editorNodes.categoryItemEditBackdrop.hidden"), false);
  assert.notEqual(runtime.run("categoryItemIconEditState"), null);
  assert.equal(runtime.run("editorNodes.categoryItemEditNameInput.value"), "更改的小类");
  assert.deepEqual(runtime.localStorage.toObject(), before);
});

test("category browsing captures departure and restores it despite an intervening layout scroll", () => {
  const runtime = createCategoryRuntime();
  runtime.run('window.scrollY=237;rememberCategorySystemScrollPosition();var queuedCategoryFrame,restoredCategoryPosition;window.requestAnimationFrame=callback=>{queuedCategoryFrame=callback;};window.scrollTo=(_,y)=>{restoredCategoryPosition=y;};restoreCategorySystemScrollPosition();categorySystemScrollTop=0;queuedCategoryFrame();');
  assert.equal(runtime.run("restoredCategoryPosition"), 237);
});

test("repeated edit saves wait for the first result, and canceling confirmation retains the draft", async () => {
  const runtime = createCategoryEditorRuntime();
  const before = runtime.localStorage.toObject();
  runtime.run('var renameCalls=0, finishRename; renameCategoryItem=()=>{renameCalls++;return new Promise(resolve=>{finishRename=resolve;});};');
  const firstSave = runtime.run("saveCategoryItemChanges()");
  assert.equal(await runtime.run("saveCategoryItemChanges()"), false);
  assert.equal(runtime.run("renameCalls"), 1);
  assert.equal(runtime.run("editorNodes.categoryItemEditSave.disabled"), true);
  assert.equal(runtime.run("closeCategoryItemIconEditor()"), true);
  assert.notEqual(runtime.run("categoryItemIconEditState"), null);
  runtime.run("finishRename(false)");
  assert.equal(await firstSave, false);
  assert.equal(runtime.run("editorNodes.categoryItemEditSave.disabled"), false);
  assert.equal(runtime.run("editorNodes.categoryItemEditSave.textContent"), "保存更改");
  assert.equal(runtime.run("editorCloseButtons[0].disabled"), false);
  assert.equal(runtime.run("editorNodes.categoryItemEditNameInput.value"), "更改的小类");
  assert.match(runtime.run("editorNodes.categoryItemEditStatus.textContent"), /原设置已保留/);
  assert.deepEqual(runtime.localStorage.toObject(), before);
});

function createCategoryRuntime(initialStorage = {}) {
  const runtime = createRuntime(initialStorage);
  runtime.run("loadCustomCategories(); loadCustomCategoryIcons(); loadCategorySystem();");
  return runtime;
}

function createGroup(runtime, name, side = "expense") {
  runtime.run(`categorySystemSide = ${JSON.stringify(side)}; createCategoryGroup(${JSON.stringify(name)});`);
  return runtime.run(`dataState.categorySystem.groups.find(group => group.name === ${JSON.stringify(name)}).key`);
}

async function addItem(runtime, key, name) {
  return runtime.run(`createCategoryItem(${JSON.stringify(key)}, ${JSON.stringify(name)}, "other")`);
}

test("older expense groups retain user order, hidden categories and custom entries", () => {
  const runtime = createRuntime({ jizhangben_custom_categories: JSON.stringify(["旧自定义"]) });
  const legacy = runtime.run(`(() => {
    const groups = CATEGORY_GROUPS.map(group => ({ ...group, items: group.items.slice() }));
    groups[0].items = groups[0].items.filter(name => name !== '餐饮');
    groups[0].items.push('宠物用品');
    return JSON.stringify({ groups, hidden: ['餐饮'] });
  })()`);
  runtime.localStorage.setItem("jizhangben_category_system", legacy);
  runtime.localStorage.setItem("jizhangben_records_1", JSON.stringify([
    { id: 1, type: "支出", amountCents: 1200, category: "餐饮", date: "2026-09-01" }
  ]));
  runtime.run("dataState.currentBookId = 1; loadCustomCategories(); loadCustomCategoryIcons(); load(); loadCategorySystem();");

  assert.equal(runtime.run("allCategories('expense').includes('餐饮')"), false);
  assert.equal(runtime.run("allCategories('expense').includes('买菜')"), true);
  assert.equal(runtime.run("allCategories().includes('旧自定义')"), true);
  assert.equal(runtime.run("allCategories().includes('宠物用品')"), true);
  assert.equal(runtime.run("categorySystemGroups()[0].side"), "expense");
  assert.equal(runtime.run("dataState.records[0].category"), "餐饮");
  assert.equal(runtime.run("dataState.categorySystem.hidden.includes('餐饮')"), true);
  assert.equal(runtime.run("isValidCategorySystem(dataState.categorySystem)"), true);
});

test("income and expense categories are stored and selected separately", async () => {
  const runtime = createCategoryRuntime();
  const expenseKey = createGroup(runtime, "日常支出", "expense");
  const incomeKey = createGroup(runtime, "收入来源", "income");
  await addItem(runtime, expenseKey, "自定义午餐");
  await addItem(runtime, incomeKey, "工资");

  assert.equal(runtime.run("allCategories('expense').includes('自定义午餐')"), true);
  assert.equal(runtime.run("allCategories('expense').includes('餐饮')"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.run("allCategories('income')"))), ["工资"]);
  runtime.run("uiState.selectedType = '收入'");
  assert.equal(runtime.run("categoryPickerSide()"), "income");
  runtime.run("uiState.selectedType = '支出'");
  assert.equal(runtime.run("categoryPickerSide()"), "expense");
});

test("a legacy user-named income group keeps its side despite mixed historical usage", () => {
  // 合成结构，不使用个人备份、真实类别键或流水。
  const group = { key: "custom-income", name: "收入", icon: "other", color: "#6E8790", background: "#EEF3F4", items: ["合成收入", "共用小项"] };
  const originalSystem = { groups: [group], hidden: ["已隐藏小项"] };
  const records = [{ id: 1, type: "收入", category: "合成收入", amountCents: 100 }, { id: 2, type: "支出", category: "共用小项", amountCents: 50 }];
  const rawRecords = JSON.stringify(records);
  const icons = JSON.stringify({ "共用小项": "other" });
  const runtime = createRuntime({ jizhangben_category_system: JSON.stringify(originalSystem), jizhangben_records_1: rawRecords, jizhangben_custom_category_icons: icons });
  runtime.run("dataState.currentBookId=1;load();loadCustomCategories();loadCustomCategoryIcons();loadCategorySystem();");
  const after = JSON.parse(runtime.localStorage.getItem("jizhangben_category_system"));
  assert.deepEqual(after, { groups: [{ ...group, side: "income" }], hidden: originalSystem.hidden });
  assert.deepEqual(JSON.parse(runtime.run("JSON.stringify(allCategories('income'))")), group.items);
  assert.equal(runtime.run("allCategories('expense').includes('共用小项')"), false);
  assert.equal(runtime.localStorage.getItem("jizhangben_records_1"), rawRecords);
  assert.equal(runtime.localStorage.getItem("jizhangben_custom_category_icons"), icons);
  const once = runtime.localStorage.toObject();
  runtime.run("loadCategorySystem()");
  assert.deepEqual(runtime.localStorage.toObject(), once);
});

test("income-name compatibility does not override an explicit side or a renamed built-in group", () => {
  const runtime = createRuntime();
  const raw = runtime.run(`JSON.stringify({groups:[
    {key:'custom-explicit',name:'收入',side:'expense',icon:'other',color:'#6E8790',background:'#EEF3F4',items:['合成小项']},
    {...CATEGORY_GROUPS[0],name:'我的收入',items:['合成餐食']}
  ],hidden:[]})`);
  runtime.localStorage.setItem("jizhangben_category_system", raw);
  runtime.run("loadCustomCategories();loadCategorySystem();");
  assert.equal(runtime.run("dataState.categorySystem.groups[0].side"), "expense");
  assert.equal(runtime.run("dataState.categorySystem.groups[1].side"), "expense");
  runtime.run("dataState.categorySystem.groups[1].name='收入';delete dataState.categorySystem.groups[1].side;dataState.categorySystem.groups[0].name='另一大类';saveCategorySystem();loadCategorySystem();");
  assert.equal(runtime.run("dataState.categorySystem.groups[1].side"), "expense");
});

test("group and small-category order persists independently within each side", async () => {
  const runtime = createCategoryRuntime();
  const first = createGroup(runtime, "餐食");
  const second = createGroup(runtime, "交通");
  createGroup(runtime, "收入来源", "income");
  await addItem(runtime, first, "午间点心");
  await addItem(runtime, first, "夜宵");
  runtime.run("categorySystemSide = 'expense'");

  assert.equal(runtime.run(`moveCategoryGroup(${JSON.stringify(first)}, 1)`), true);
  assert.equal(runtime.run(`moveCategoryItem(${JSON.stringify(first)}, '午间点心', 1)`), true);
  assert.equal(runtime.run(`categorySystemVisibleGroups().findIndex(group => group.key === ${JSON.stringify(second)}) < categorySystemVisibleGroups().findIndex(group => group.key === ${JSON.stringify(first)})`), true);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.run(`categorySystemGroups().find(group => group.key === ${JSON.stringify(first)}).items`))), ["夜宵", "午间点心"]);
  runtime.run("loadCategorySystem()");
  assert.equal(runtime.run(`categorySystemVisibleGroups().findIndex(group => group.key === '${second}') < categorySystemVisibleGroups().findIndex(group => group.key === '${first}')`), true);
  assert.equal(runtime.run("categorySystemGroups().find(group => group.key === '" + first + "').items[0]"), "夜宵");
  assert.equal(runtime.run("dataState.categorySystem.groups.find(group => group.side === 'income').name"), "收入来源");
});

test("removing a user category keeps historical records and permits later recreation", async () => {
  const runtime = createCategoryRuntime();
  const key = createGroup(runtime, "餐食");
  await addItem(runtime, key, "临时午餐");
  runtime.run("dataState.records = [{ category: '临时午餐', amountCents: 1200 }]; appConfirm = async () => true;");
  await runtime.run(`removeCategoryItem(${JSON.stringify(key)}, '临时午餐')`);
  assert.equal(runtime.run("allCategories().includes('临时午餐')"), false);
  assert.equal(runtime.run("dataState.records[0].category"), "临时午餐");
  assert.equal(runtime.run("dataState.categorySystem.hidden.includes('临时午餐')"), true);
  assert.equal(runtime.run("validateBackupValue(CATEGORY_SYSTEM_KEY, dataState.categorySystem)"), true);
  runtime.run("dataState.categorySystem.hidden = []; saveCategorySystem();");
  const nextKey = createGroup(runtime, "饮食");
  assert.equal(await addItem(runtime, nextKey, "临时午餐"), true);
});

test("backup validation rejects duplicate category names and unsafe colors", () => {
  const runtime = createCategoryRuntime();
  createGroup(runtime, "支出甲", "expense");
  createGroup(runtime, "收入乙", "income");
  assert.equal(runtime.run(`(() => {
    const copy = JSON.parse(JSON.stringify(dataState.categorySystem));
    copy.groups[1].items.push('重名');
    copy.groups[0].items.push('重名');
    return validateBackupValue(CATEGORY_SYSTEM_KEY, copy);
  })()`), false);
  assert.equal(runtime.run(`(() => {
    const copy = JSON.parse(JSON.stringify(dataState.categorySystem));
    copy.groups[0].color = 'red; background: black';
    return validateBackupValue(CATEGORY_SYSTEM_KEY, copy);
  })()`), false);
});

test("failed category save leaves the previous category structure intact", () => {
  const runtime = createCategoryRuntime();
  const first = createGroup(runtime, "餐食");
  createGroup(runtime, "交通");
  const before = runtime.localStorage.getItem("jizhangben_category_system");
  const originalSet = runtime.localStorage.setItem.bind(runtime.localStorage);
  runtime.localStorage.setItem = (key, value) => {
    if (key === "jizhangben_category_system") throw new Error("storage_full");
    originalSet(key, value);
  };
  runtime.run("appNotice = () => Promise.resolve(true)");
  assert.equal(runtime.run(`moveCategoryGroup(${JSON.stringify(first)}, 1)`), false);
  assert.equal(runtime.localStorage.getItem("jizhangben_category_system"), before);
});

test("category icon changes save only the chosen icon and retain legacy data", () => {
  const runtime = createCategoryRuntime();
  const group = createGroup(runtime, "日常支出");
  runtime.run(`dataState.categorySystem.groups.find(item => item.key === ${JSON.stringify(group)}).items.push("自定义小类");`);
  const iconKey = runtime.run("CUSTOM_CATEGORY_ICONS_KEY");
  runtime.localStorage.setItem(iconKey, JSON.stringify({ "自定义小类": "breakfast", "旧类别": "dining" }));
  runtime.run("loadCustomCategoryIcons()");
  const previousRecords = JSON.stringify([{ id: 3, category: "自定义小类", amountCents: 1250 }]);
  runtime.localStorage.setItem("jizhangben_records_1", previousRecords);
  const previousCategory = JSON.stringify(runtime.run("dataState.categorySystem"));

  assert.equal(runtime.run('currentCategoryIconKey("自定义小类", categorySystemGroups()[0])'), "breakfast");
  assert.equal(runtime.run('persistCategoryItemIcon("自定义小类", "tabler:coffee")'), true);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem(iconKey)), {
    "自定义小类": "tabler:coffee",
    "旧类别": "dining"
  });
  assert.equal(runtime.localStorage.getItem("jizhangben_records_1"), previousRecords);
  assert.equal(JSON.stringify(runtime.run("dataState.categorySystem")), previousCategory);
});

test("failed category icon save keeps the prior icon mapping", () => {
  const runtime = createCategoryRuntime();
  const iconKey = runtime.run("CUSTOM_CATEGORY_ICONS_KEY");
  runtime.localStorage.setItem(iconKey, JSON.stringify({ "自定义小类": "dining" }));
  runtime.run("loadCustomCategoryIcons(); appNotice = () => Promise.resolve(true); appStorage.set = () => { throw new Error('storage_full'); };");

  assert.equal(runtime.run('persistCategoryItemIcon("自定义小类", "tabler:coffee")'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.run("dataState.customCategoryIcons"))), { "自定义小类": "dining" });
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem(iconKey)), { "自定义小类": "dining" });
});

test("renaming a small category and choosing its icon saves together without losing expense history", async () => {
  const runtime = createCategoryRuntime({
    jizhangben_records_1: JSON.stringify([{ id: 9, type: "支出", amountCents: 2350, category: "工作午餐", date: "2026-10-01" }]),
    jizhangben_custom_category_icons: JSON.stringify({ "工作午餐": "dining", "旧类别": "other" })
  });
  const groupKey = createGroup(runtime, "工作餐");
  await addItem(runtime, groupKey, "工作午餐");
  runtime.run("appConfirm = async () => true; appNotice = () => {}; renderCategoryChips = () => {}; fillCategoryFilter = () => {}; renderBudgetPage = () => {}; renderCategorySystem = () => {}; render = () => {};");

  assert.equal(await runtime.run(`renameCategoryItem(${JSON.stringify(groupKey)}, "工作午餐", "午间简餐", "tabler:coffee")`), true);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1")), [
    { id: 9, type: "支出", amountCents: 2350, category: "午间简餐", date: "2026-10-01" }
  ]);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_custom_category_icons")), {
    "午间简餐": "tabler:coffee",
    "旧类别": "other"
  });
  assert.equal(runtime.run(`categorySystemGroups().find(group => group.key === ${JSON.stringify(groupKey)}).items.includes("午间简餐")`), true);
});

test("failed combined category edit rolls back the name and keeps the old icon and records", async () => {
  const runtime = createCategoryRuntime({
    jizhangben_records_1: JSON.stringify([{ id: 10, type: "支出", amountCents: 500, category: "临时咖啡", date: "2026-10-02" }]),
    jizhangben_custom_category_icons: JSON.stringify({ "临时咖啡": "dining" })
  });
  const groupKey = createGroup(runtime, "临时消费");
  await addItem(runtime, groupKey, "临时咖啡");
  runtime.localStorage.setItem("jizhangben_custom_category_icons", JSON.stringify({ "临时咖啡": "dining" }));
  runtime.run(`loadCustomCategoryIcons(); appConfirm = async () => true; appNotice = () => {}; renderCategoryChips = () => {}; fillCategoryFilter = () => {}; renderBudgetPage = () => {}; renderCategorySystem = () => {}; render = () => {}; const originalSet = appStorage.set.bind(appStorage); appStorage.set = (key, value) => { if (key === CUSTOM_CATEGORY_ICONS_KEY) throw new Error("storage_full"); return originalSet(key, value); };`);

  assert.equal(await runtime.run(`renameCategoryItem(${JSON.stringify(groupKey)}, "临时咖啡", "随手饮品", "tabler:coffee")`), false);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1")), [
    { id: 10, type: "支出", amountCents: 500, category: "临时咖啡", date: "2026-10-02" }
  ]);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_custom_category_icons")), { "临时咖啡": "dining" });
  assert.equal(runtime.run(`categorySystemGroups().find(group => group.key === ${JSON.stringify(groupKey)}).items.includes("临时咖啡")`), true);
});
