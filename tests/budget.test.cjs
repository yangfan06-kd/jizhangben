const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("budget actuals only count net expenses for the selected month", () => {
  const runtime = createRuntime();
  const result = runtime.run(`budgetActuals("2026-09", [
    { id: 1, type: "支出", amountCents: 12000, category: "餐饮", date: "2026-09-02" },
    { type: "支出", amountCents: 3000, category: "交通", date: "2026-09-03" },
    { type: "收入", amountCents: 90000, category: "其他", date: "2026-09-04" },
    { type: "支出", amountCents: 5000, category: "餐饮", date: "2026-08-31" },
    { type: "退款", amountCents: 2000, refundLinkId: 1, date: "2026-09-05" },
    { type: "余额", amountCents: 50000, date: "2026-09-06" }
  ])`);

  assert.equal(result.totalCents, 13000);
  assert.equal(result.categories["餐饮"], 10000);
  assert.equal(result.categories["交通"], 3000);
});

test("budget periods persist by book and month without changing records", () => {
  const runtime = createRuntime();
  runtime.run(`dataState.currentBookId = 9; loadBudgetData(); budgetUiState.month = "2026-09"; budgetPeriod().totalCents = 250000; budgetPeriod().categories["餐饮"] = 80000; saveBudgetData()`);
  const stored = JSON.parse(runtime.localStorage.getItem("jizhangben_budgets_9"));
  assert.equal(stored.periods["2026-09"].totalCents, 250000);
  assert.equal(stored.periods["2026-09"].categories["餐饮"], 80000);
  assert.equal(runtime.run(`dataState.records.length`), 0);
});

test("budget status distinguishes normal, near-limit and over-budget", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run(`budgetStatus(5000, 10000).label`), "执行正常");
  assert.equal(runtime.run(`budgetStatus(8000, 10000).label`), "接近上限");
  assert.equal(runtime.run(`budgetStatus(12000, 10000).label`), "已超支");
  assert.equal(runtime.run(`budgetStatus(12000, null).label`), "未设置额度");
});

test("budget month navigation crosses year boundaries", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run(`shiftBudgetMonth("2026-01", -1)`), "2025-12");
  assert.equal(runtime.run(`shiftBudgetMonth("2025-12", 1)`), "2026-01");
});
