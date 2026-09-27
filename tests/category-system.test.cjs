const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function createCategoryRuntime(initialStorage = {}) {
  const runtime = createRuntime(initialStorage);
  runtime.run("loadCustomCategories(); loadCustomCategoryIcons(); loadCategorySystem();");
  return runtime;
}

test("old categories migrate into editable groups without changing existing records", () => {
  const runtime = createCategoryRuntime({
    jizhangben_custom_categories: JSON.stringify(["宠物用品"])
  });
  assert.equal(runtime.run("categorySystemGroups().length"), 10);
  assert.equal(runtime.run("categorySystemGroups().find(group => group.name === '自定义类别').items[0]"), "宠物用品");
  assert.equal(runtime.run("allCategories().includes('餐饮') && allCategories().includes('宠物用品')"), true);
  assert.equal(runtime.run("isValidCategorySystem(dataState.categorySystem)"), true);
});

test("moving groups and small categories persists their selected order", () => {
  const runtime = createCategoryRuntime();
  runtime.run("moveCategoryGroup('food', 1); moveCategoryItem('food', '餐饮', 1);");
  assert.equal(runtime.run("categorySystemGroups()[1].key"), "food");
  assert.equal(runtime.run("categorySystemGroups()[1].items[0]"), "买菜");
  assert.equal(runtime.run("categorySystemGroups()[1].items[1]"), "餐饮");
  runtime.run("loadCategorySystem()");
  assert.equal(runtime.run("categorySystemGroups()[1].items[1]"), "餐饮");
});

test("dragged group and small-category order persists after reloading", () => {
  const runtime = createCategoryRuntime();
  const keys = runtime.run("categorySystemGroups().map(group => group.key)");
  const lastKey = keys.at(-1);
  assert.equal(runtime.run(`reorderCategoryGroups(${JSON.stringify([lastKey, ...keys.slice(0, -1)])})`), true);
  assert.equal(runtime.run("reorderCategoryItems('food', ['买菜', '餐饮', ...categorySystemGroups().find(group => group.key === 'food').items.slice(2)])"), true);
  runtime.run("loadCategorySystem()");
  assert.equal(runtime.run("categorySystemGroups()[0].key"), lastKey);
  assert.equal(runtime.run("categorySystemGroups().find(group => group.key === 'food').items[0]"), "买菜");
  assert.equal(runtime.run("categorySystemGroups().find(group => group.key === 'food').items[1]"), "餐饮");
});

test("an incomplete drag order cannot change stored categories", () => {
  const runtime = createCategoryRuntime();
  const before = runtime.localStorage.getItem("jizhangben_category_system");
  assert.equal(runtime.run("reorderCategoryGroups(['food'])"), false);
  assert.equal(runtime.run("reorderCategoryItems('food', ['餐饮', '餐饮'])"), false);
  assert.equal(runtime.localStorage.getItem("jizhangben_category_system"), before);
});

test("removing a built-in small category hides it but preserves historical records and backup data", async () => {
  const runtime = createCategoryRuntime();
  runtime.run("dataState.records = [{ category: '餐饮', amountCents: 1200 }]; appConfirm = async () => true;");
  await runtime.run("removeCategoryItem('food', '餐饮')");
  assert.equal(runtime.run("allCategories().includes('餐饮')"), false);
  assert.equal(runtime.run("dataState.records[0].category"), "餐饮");
  assert.equal(runtime.run("dataState.categorySystem.hidden.includes('餐饮')"), true);
  const exported = runtime.localStorage.getItem("jizhangben_category_system");
  assert.equal(runtime.run(`validateBackupValue(CATEGORY_SYSTEM_KEY, JSON.parse(${JSON.stringify(exported)}))`), true);
  runtime.run("loadCategorySystem()");
  assert.equal(runtime.run("allCategories().includes('餐饮')"), false);
});

test("new large and small categories can be added and restored without duplicate names", async () => {
  const runtime = createCategoryRuntime();
  runtime.run("createCategoryGroup('旅行出游')");
  const key = runtime.run("categorySystemGroups().at(-1).key");
  await runtime.run(`createCategoryItem(${JSON.stringify(key)}, '门票', 'travel')`);
  assert.equal(runtime.run("allCategories().includes('门票')"), true);
  assert.equal(runtime.run("dataState.customCategoryIcons['门票']"), "travel");
  assert.equal(runtime.run("categorySystemGroups().at(-1).items.length"), 1);
  runtime.run("appConfirm = async () => true");
  await runtime.run(`removeCategoryGroup(${JSON.stringify(key)})`);
  assert.equal(runtime.run("allCategories().includes('门票')"), false);
  await runtime.run("restoreDefaultCategories()");
  assert.equal(runtime.run("categorySystemGroups().filter(group => group.key === 'food').length"), 1);
});

test("backup validation rejects duplicate category names and malformed colors", () => {
  const runtime = createCategoryRuntime();
  assert.equal(runtime.run(`(() => {
    const copy = JSON.parse(JSON.stringify(dataState.categorySystem));
    copy.groups[1].items.push(copy.groups[0].items[0]);
    return validateBackupValue(CATEGORY_SYSTEM_KEY, copy);
  })()`), false);
  assert.equal(runtime.run(`(() => {
    const copy = JSON.parse(JSON.stringify(dataState.categorySystem));
    copy.groups[0].color = 'red; background: black';
    return validateBackupValue(CATEGORY_SYSTEM_KEY, copy);
  })()`), false);
});

test("category layout survives a storage reload and deleted defaults stay hidden", async () => {
  const runtime = createCategoryRuntime();
  runtime.run("appConfirm = async () => true; moveCategoryGroup('food', 1);");
  await runtime.run("removeCategoryItem('food', '餐饮')");
  const saved = runtime.localStorage.toObject();
  const restored = createCategoryRuntime(saved);
  assert.equal(restored.run("categorySystemGroups()[1].key"), "food");
  assert.equal(restored.run("allCategories().includes('餐饮')"), false);
  assert.equal(restored.run("categorySystemGroups().find(group => group.key === 'food').items.includes('买菜')"), true);
});

test("a failed category save leaves the previous order intact", () => {
  const runtime = createCategoryRuntime();
  const before = runtime.localStorage.getItem("jizhangben_category_system");
  const originalSet = runtime.localStorage.setItem.bind(runtime.localStorage);
  runtime.localStorage.setItem = (key, value) => {
    if (key === "jizhangben_category_system") throw new Error("storage_full");
    originalSet(key, value);
  };
  runtime.run("appNotice = () => Promise.resolve(true)");
  assert.equal(runtime.run("moveCategoryGroup('food', 1)"), false);
  assert.equal(runtime.run("categorySystemGroups()[0].key"), "food");
  assert.equal(runtime.localStorage.getItem("jizhangben_category_system"), before);
});
