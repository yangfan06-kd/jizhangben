const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("canceling or failing to clear retirement settings retains the plan and history, and allows retry", async () => {
  const plan = { id: "retirement", amountCents: 20000, accountId: 4, day: 15, startMonth: "2026-10", active: true };
  const history = [{id:1,type:"收入",category:"退休金收入",amountCents:20000,date:"2026-10-15"}];
  const runtime = createRuntime({ jizhangben_fixed_income_1: JSON.stringify(plan), jizhangben_records_1: JSON.stringify(history) });
  runtime.run(`
    dataState.currentBookId=1;dataState.fixedIncomePlan=${JSON.stringify(plan)};dataState.records=${JSON.stringify(history)};
    var pensionNodes={fixedIncomeForm:{},fixedIncomeStopBtn:{},fixedIncomeMsg:{textContent:"",classList:{toggle(){}}}};
    document={getElementById(id){return pensionNodes[id]||null;}};
    renderFixedIncomeSettings=()=>{};appConfirm=async()=>false;bindFixedIncomeEvents();
  `);
  const before = runtime.localStorage.toObject();
  await runtime.run("pensionNodes.fixedIncomeStopBtn.onclick()");
  assert.deepEqual(JSON.parse(runtime.run("JSON.stringify(dataState.fixedIncomePlan)")), plan);
  const remove = runtime.localStorage.removeItem.bind(runtime.localStorage);
  runtime.localStorage.removeItem = () => { throw new Error("storage_unavailable"); };
  runtime.run("appConfirm=async()=>true");
  await runtime.run("pensionNodes.fixedIncomeStopBtn.onclick()");
  assert.deepEqual(JSON.parse(runtime.run("JSON.stringify(dataState.fixedIncomePlan)")), plan);
  assert.deepEqual(runtime.localStorage.toObject(), before);
  assert.match(runtime.run("pensionNodes.fixedIncomeMsg.textContent"), /清除失败/);
  runtime.localStorage.removeItem = remove;
  await runtime.run("pensionNodes.fixedIncomeStopBtn.onclick()");
  assert.equal(runtime.run("dataState.fixedIncomePlan"), null);
  assert.deepEqual(JSON.parse(runtime.run("JSON.stringify(dataState.records)")), history);
});

function setupFixedIncome(runtime, plan, today) {
  runtime.run(`
    dataState.currentBookId = 1;
    dataState.books = [{ id: 1, name: "个人账本", category: "个人" }];
    dataState.accounts = [{ id: 4, name: "银行卡", kind: "资金", initial: 0 }];
    dataState.records = [];
    dataState.fixedIncomePlan = ${JSON.stringify(plan)};
    todayStr = () => ${JSON.stringify(today)};
    fixedIncomeSay = () => {};
    fillCategoryFilter = () => {};
    render = () => {};
  `);
}

test("monthly fixed income catches up missed months once and keeps their scheduled dates", () => {
  const runtime = createRuntime();
  setupFixedIncome(runtime, {
    id: "social-plan-1", amountCents: 250000, accountId: 4, day: 15,
    startMonth: "2026-08", nextEligibleMonth: "2026-08", active: true
  }, "2026-10-01");

  assert.equal(runtime.run("processDueFixedIncome()"), 2);
  assert.equal(runtime.run("processDueFixedIncome()"), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.run("dataState.records.map(record => [record.date, record.fixedIncomeMonth, record.category])"))), [
    ["2026-08-15", "2026-08", "退休金收入"],
    ["2026-09-15", "2026-09", "退休金收入"]
  ]);

  runtime.run("todayStr = () => '2026-10-20'");
  assert.equal(runtime.run("processDueFixedIncome()"), 1);
  assert.equal(runtime.run("dataState.records.filter(record => record.fixedIncomeMonth === '2026-10').length"), 1);
});

test("monthly fixed income moves the 31st to the last day in short months", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("fixedIncomeDueDate('2026-02', 31)"), "2026-02-28");
  assert.equal(runtime.run("fixedIncomeDueDate('2026-04', 31)"), "2026-04-30");
});

test("a fixed-income plan starting next month waits instead of recording early", () => {
  const runtime = createRuntime();
  setupFixedIncome(runtime, {
    id: "social-plan-future", amountCents: 250000, accountId: 4, day: 15,
    startMonth: "2026-11", nextEligibleMonth: "2026-11", active: true
  }, "2026-10-20");
  assert.equal(runtime.run("processDueFixedIncome()"), 0);
  assert.equal(runtime.run("dataState.records.length"), 0);
});

test("a paused fixed income plan does not create records and skips a passed month", () => {
  const runtime = createRuntime();
  setupFixedIncome(runtime, {
    id: "social-plan-2", amountCents: 250000, accountId: 4, day: 15,
    startMonth: "2026-08", nextEligibleMonth: "2026-08", active: false
  }, "2026-10-20");
  assert.equal(runtime.run("processDueFixedIncome()"), 0);
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("dataState.fixedIncomePlan.nextEligibleMonth"), "2026-11");
});

test("small category rename updates old transactions and budget keys in each local book", async () => {
  const runtime = createRuntime({
    jizhangben_records_1: JSON.stringify([{ id: 1, type: "支出", amountCents: 1000, category: "餐饮", date: "2026-09-01" }]),
    jizhangben_records_2: JSON.stringify([{ id: 2, type: "支出", amountCents: 2000, category: "餐饮", date: "2026-08-01" }]),
    jizhangben_budgets_1: JSON.stringify({ version: 1, periods: { "2026-09": { totalCents: 5000, categories: { "餐饮": 3000, "外食": 500 } } } }),
    jizhangben_custom_categories: JSON.stringify(["餐饮"]),
    jizhangben_custom_category_icons: JSON.stringify({ "餐饮": "dining" })
  });
  runtime.run(`
    dataState.books = [{ id: 1 }, { id: 2 }];
    dataState.currentBookId = 1;
    loadCustomCategories(); loadCustomCategoryIcons(); loadCategorySystem();
    appConfirm = async () => true;
    renderCategorySystem = () => {}; renderCategoryChips = () => {};
    fillCategoryFilter = () => {}; renderBudgetPage = () => {}; render = () => {};
  `);

  assert.equal(await runtime.run("renameCategoryItem('food', '餐饮', '外食')"), true);
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1"))[0].category, "外食");
  assert.deepEqual(JSON.parse(runtime.localStorage.getItem("jizhangben_records_2"))[0].category, "外食");
  const budget = JSON.parse(runtime.localStorage.getItem("jizhangben_budgets_1"));
  assert.equal(budget.periods["2026-09"].categories["外食"], 3500);
  assert.equal(Object.hasOwn(budget.periods["2026-09"].categories, "餐饮"), false);
  assert.equal(JSON.parse(runtime.localStorage.getItem("jizhangben_custom_category_icons")).外食, "dining");
});

test("backup validation allows a zero-cost one-time fund and rejects a zero recurring installment", () => {
  const runtime = createRuntime();
  const project = {
    id: 1, fundName: "示例基金", platform: "支付宝", mode: "one-time",
    fundAccountId: 11, sourceAccountId: 4, amountCents: 0, originalCostCents: 0,
    startDate: "2026-10-01", status: "open"
  };
  assert.equal(runtime.run(`validateBackupValue('jizhangben_fund_projects_1', ${JSON.stringify([project])})`), true);
  project.mode = "recurring";
  assert.equal(runtime.run(`validateBackupValue('jizhangben_fund_projects_1', ${JSON.stringify([project])})`), false);
});
