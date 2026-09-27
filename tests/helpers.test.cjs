const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("toCents avoids decimal accumulation errors", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("toCents(0.1 + 0.2)"), 30);
});

test("userFacingError hides internal codes while keeping Chinese server messages", () => {
  const runtime = createRuntime();
  assert.equal(
    runtime.run('userFacingError({ code: "backend_request_failed", message: "backend_request_failed" }, "保存失败")'),
    "服务暂时不可用，请稍后重试"
  );
  assert.equal(
    runtime.run('userFacingError({ code: "deposit_link_not_found", message: "当前账本中不存在对应的原押金" }, "保存失败")'),
    "当前账本中不存在对应的原押金"
  );
});

test("common categories have local SVG icons while unknown categories stay text-only", () => {
  const runtime = createRuntime();
  assert.match(runtime.run('categoryIconMarkup("餐饮")'), /<svg/);
  assert.equal(runtime.run('categoryIconMarkup("自定义一类")'), "");
});

test("category picker groups expose common subcategories with colored local icons", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run('CATEGORY_GROUPS.length'), 9);
  assert.equal(runtime.run('CATEGORY_GROUPS[0].name'), "食品酒水");
  assert.equal(runtime.run('allCategories().includes("早餐")'), true);
  assert.equal(runtime.run('allCategories().includes("宿舍")'), true);
  assert.match(runtime.run('categoryIconMarkup("约会")'), /<svg/);
  assert.match(runtime.run('categoryIconMarkup("保险")'), /<svg/);
  assert.match(runtime.run('categoryIconMarkup("公摊")'), /<svg/);
  assert.equal(runtime.run('CATEGORY_GROUPS.flatMap(group => group.items).every(category => /<svg/.test(categoryIconMarkup(category)))'), true);
  assert.notEqual(runtime.run('categoryIconMarkup("早餐")'), runtime.run('categoryIconMarkup("晚餐")'));
  assert.notEqual(runtime.run('categoryIconMarkup("公交")'), runtime.run('categoryIconMarkup("地铁")'));
  assert.notEqual(runtime.run('categoryIconMarkup("药品")'), runtime.run('categoryIconMarkup("保险")'));
});

test("custom category icon selections use the local SVG directory", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run('JSON.stringify(CATEGORY_ICON_OPTIONS.map(option => option.key))'), JSON.stringify([
    "dining", "transport", "shopping", "entertainment", "home", "health", "education",
    "sport", "travel", "pet", "digital", "gift", "love", "insurance", "dorm", "other"
  ]));
  assert.match(runtime.run('categoryIconMarkupByKey("pet")'), /<svg/);
  assert.match(runtime.run('(() => { dataState.customCategoryIcons = { "宠物": "pet" }; return categoryIconMarkup("宠物"); })()'), /<svg/);
  assert.equal(runtime.run('categoryIconMarkupByKey("unknown")'), "");
});

test("normalizeRecord converts legacy amounts to integer cents", () => {
  const runtime = createRuntime();
  const record = runtime.run(`normalizeRecord({
    id: 7,
    amount: 6.789,
    type: "支出",
    note: "旧记录"
  })`);

  assert.equal(record.id, 7);
  assert.equal(record.type, "支出");
  assert.equal(record.note, "旧记录");
  assert.equal(record.amount, 6.79);
  assert.equal(record.amountCents, 679);
});

test("normalizeAccount converts legacy initial balances to integer cents", () => {
  const runtime = createRuntime();
  const account = runtime.run(`normalizeAccount({
    id: 3,
    name: "银行卡",
    kind: "资金",
    initial: 10.239
  })`);

  assert.equal(account.id, 3);
  assert.equal(account.name, "银行卡");
  assert.equal(account.kind, "资金");
  assert.equal(account.initial, 10.24);
  assert.equal(account.initialCents, 1024);
});

test("detail periods use local calendar boundaries", () => {
  const runtime = createRuntime();
  const week = runtime.run('detailPeriodBounds("week", "2026-09-18")');
  const month = runtime.run('detailPeriodBounds("month", "2026-09-18")');
  const year = runtime.run('detailPeriodBounds("year", "2026-09-18")');
  assert.equal(week.start, "2026-09-14");
  assert.equal(week.end, "2026-09-18");
  assert.equal(month.start, "2026-09-01");
  assert.equal(month.end, "2026-09-18");
  assert.equal(year.start, "2026-01-01");
  assert.equal(year.end, "2026-09-18");
});
