const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("fund trading days skip exchange holidays, weekends and unknown future years", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run('fundTradingDay("2026-09-23")'), true);
  assert.equal(runtime.run('fundTradingDay("2026-09-25")'), false);
  assert.equal(runtime.run('fundTradingDay("2026-09-20")'), false);
  assert.equal(runtime.run('fundTradingDay("2026-10-05")'), false);
  assert.equal(runtime.run('fundTradingDay("2027-01-04")'), null);
});

test("unknown holiday calendar stops future automatic contributions", () => {
  const runtime = createRuntime();
  const dates = runtime.run(`fundDueDates({
    mode: "recurring", frequency: "daily", startDate: "2026-12-30", endDate: ""
  }, "2027-01-06")`);
  assert.deepEqual(Array.from(dates), ["2026-12-30", "2026-12-31"]);
});

test("weekly fund investment accepts several weekdays and skips closed days", () => {
  const runtime = createRuntime();
  const dates = runtime.run(`fundDueDates({
    mode: "recurring", frequency: "weekly", weekdays: [1, 3, 5],
    startDate: "2026-09-21", endDate: "2026-10-09", processedDates: ["2026-09-21"]
  }, "2026-10-09")`);
  assert.deepEqual(Array.from(dates), ["2026-09-23", "2026-09-28", "2026-09-30", "2026-10-09"]);
});

test("monthly fund investment rolls a closed month-end to the next trading day", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("fundMonthlyExecutionDate(2026, 2, 31)"), "2026-03-02");
  const dates = runtime.run(`fundDueDates({
    mode: "recurring", frequency: "monthly", monthDay: 31,
    startDate: "2026-02-01", endDate: ""
  }, "2026-03-02")`);
  assert.deepEqual(Array.from(dates), ["2026-03-02"]);
});

test("multiple monthly days create separate contributions even when holidays roll them to one day", () => {
  const runtime = createRuntime();
  const occurrences = runtime.run(`fundDueOccurrences({
    mode: "recurring", frequency: "monthly", monthDays: [1, 2],
    startDate: "2026-10-01", endDate: ""
  }, "2026-10-08")`);
  assert.deepEqual(Array.from(occurrences, item => [item.date, item.key]), [
    ["2026-10-08", "2026-10#1"], ["2026-10-08", "2026-10#2"]
  ]);
  runtime.run(`
    todayStr = () => "2026-10-08";
    renderInvestmentPlans = () => {};
    render = () => {};
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.records = [];
    dataState.accounts = [
      { id: 1, name: "银行卡", kind: "资金", initialCents: 100000 },
      { id: 2, name: "基金专属", kind: "资金", initialCents: 0, fundOnly: true }
    ];
    dataState.fundProjects = [{ id: 3, mode: "recurring", fundName: "基金", platform: "自填平台",
      fundAccountId: 2, sourceAccountId: 1, amountCents: 1000,
      frequency: "monthly", monthDays: [1, 2], startDate: "2026-10-01",
      endDate: "", status: "open", scheduleStatus: "active", processedDates: [] }];
    processDueInvestmentPlans(true);
    processDueInvestmentPlans(true);
  `);
  assert.deepEqual(Array.from(runtime.run("dataState.records.map(record => record.fundScheduleKey)")),
    ["2026-10#1", "2026-10#2"]);
  assert.equal(runtime.run("computeBalances()[1]"), 980);
});

test("editing a recurring fund keeps old records and uses the new plan from the next day", () => {
  const runtime = createRuntime();
  runtime.run(`
    todayStr = () => "2026-09-23";
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "银行卡", kind: "资金", initialCents: 100000 },
      { id: 3, name: "旧基金", kind: "资金", initialCents: 0, fundOnly: true, fundProjectId: "4" }
    ];
    dataState.records = [];
    dataState.fundProjects = [{ id: 4, mode: "recurring", fundName: "旧基金", platform: "支付宝",
      sourceAccountId: 1, fundAccountId: 3, amountCents: 1000, originalCostCents: 0,
      frequency: "weekly", weekdays: [1], monthDays: [], startDate: "2026-09-21",
      endDate: "", status: "open", scheduleStatus: "active", processedDates: ["2026-09-21"] }];
    makeFundTransfer(dataState.fundProjects[0], "2026-09-21", 1000, "contribution", 1, 3, true);
    dataState.oldRecordForTest = JSON.stringify(dataState.records[0]);
    saveAccounts(); save(); saveFundProjects();
    fundUi.editId = "4";
    fundUi.mode = "recurring";
    renderAccountSelects = () => {};
    render = () => {};
    renderInvestmentPlans = () => {};
    openFundDetail = () => {};
    saveFundEdits({ fundName: "新名称", platform: "直销公司", sourceAccountId: "2",
      amountCents: 2000, originalCostCents: 5000, frequency: "daily", weekdays: [],
      monthDays: [], startDate: "2026-09-21", endDate: "" });
    todayStr = () => "2026-09-24";
    processDueInvestmentPlans(true);
  `);
  assert.equal(runtime.run("JSON.stringify(dataState.records[0]) === dataState.oldRecordForTest"), true);
  assert.equal(runtime.run("dataState.records.length"), 2);
  assert.equal(runtime.run("dataState.records[1].account"), "2");
  assert.equal(runtime.run("dataState.records[1].amountCents"), 2000);
  assert.equal(runtime.run("dataState.records[1].date"), "2026-09-24");
  assert.equal(runtime.run("dataState.accounts[2].initialCents"), 5000);
  assert.equal(runtime.run("fundTotals(dataState.fundProjects[0]).investedCents"), 8000);
});

test("editing an already invested one-time fund cannot create another contribution", () => {
  const runtime = createRuntime();
  runtime.run(`
    todayStr = () => "2026-09-23";
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "银行卡", kind: "资金", initialCents: 100000 },
      { id: 3, name: "基金账户", kind: "资金", initialCents: 0, fundOnly: true, fundProjectId: "4" }
    ];
    dataState.records = [];
    dataState.fundProjects = [{ id: 4, mode: "one-time", fundName: "基金", platform: "支付宝",
      sourceAccountId: 1, fundAccountId: 3, amountCents: 1000, originalCostCents: 0,
      startDate: "2026-09-23", endDate: "", status: "open", scheduleStatus: "active",
      processedDates: ["2026-09-23"] }];
    makeFundTransfer(dataState.fundProjects[0], "2026-09-23", 1000, "contribution", 1, 3, true);
    dataState.oldRecordForTest = JSON.stringify(dataState.records[0]);
    saveAccounts(); save(); saveFundProjects();
    fundUi.editId = "4";
    fundUi.mode = "one-time";
    renderAccountSelects = () => {};
    render = () => {};
    renderInvestmentPlans = () => {};
    openFundDetail = () => {};
    saveFundEdits({ fundName: "基金", platform: "支付宝", sourceAccountId: "2",
      amountCents: 2000, originalCostCents: 0, frequency: null, weekdays: [],
      monthDays: [], startDate: "2026-09-24", endDate: "" });
    todayStr = () => "2026-09-24";
    processDueInvestmentPlans(true);
  `);
  assert.equal(runtime.run("dataState.records.length"), 1);
  assert.equal(runtime.run("JSON.stringify(dataState.records[0]) === dataState.oldRecordForTest"), true);
});

test("fund investment adds principal while partial and full withdrawals share redemption", async () => {
  const runtime = createRuntime();
  runtime.run(`
    todayStr = () => "2026-09-24";
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.accounts = [
      { id: 1, name: "银行卡", kind: "资金", initialCents: 100000 },
      { id: 2, name: "基金专属", kind: "资金", initialCents: 10000, fundOnly: true, fundProjectId: "3" }
    ];
    dataState.records = [];
    dataState.fundProjects = [{ id: 3, mode: "one-time", fundName: "基金", platform: "支付宝",
      sourceAccountId: 1, fundAccountId: 2, amountCents: 2000, originalCostCents: 10000,
      startDate: "2026-10-08", endDate: "", status: "open", scheduleStatus: "active", processedDates: [] }];
    saveAccounts(); save(); saveFundProjects();
    fundUi.selectedId = "3";
    dataState.adjustFields = {
      fundAdjustAmount: { value: "30.00" }, fundAdjustDate: { value: "2026-09-24" },
      fundAdjustAccount: { value: "1" },
      fundRedeemAmount: { value: "40.00" }, fundRedeemDate: { value: "2026-10-09" },
      fundRedeemAccount: { value: "1" }
    };
    dataState.redeemKind = "partial";
    document = {
      getElementById(id) { return dataState.adjustFields[id]; },
      querySelector() { return { value: dataState.redeemKind }; }
    };
    render = () => {};
    renderInvestmentPlans = () => {};
    setFundView = () => {};
  `);
  await runtime.run("handleFundAdjust({ preventDefault() {} })");
  assert.equal(runtime.run("dataState.records.length"), 1);
  assert.equal(runtime.run("dataState.records[0].fundScheduledDate"), null);
  runtime.run(`todayStr = () => "2026-10-08"; processDueInvestmentPlans(true);`);
  assert.equal(runtime.run("dataState.records.length"), 2);
  assert.equal(runtime.run("dataState.records[1].fundScheduledDate"), "2026-10-08");
  runtime.run(`
    todayStr = () => "2026-10-09";
  `);
  await runtime.run("handleFundRedeem({ preventDefault() {} })");
  assert.equal(runtime.run("fundTotals(dataState.fundProjects[0]).investedCents"), 15000);
  assert.equal(runtime.run("fundTotals(dataState.fundProjects[0]).withdrawnCents"), 4000);
  assert.equal(runtime.run("dataState.records.reduce((sum, record) => sum + incomeEffect(record) + expenseEffect(record), 0)"), 0);
  runtime.run(`
    todayStr = () => "2026-10-10";
    dataState.redeemKind = "full";
    dataState.adjustFields.fundRedeemAmount.value = "120.00";
    dataState.adjustFields.fundRedeemDate.value = "2026-10-10";
  `);
  await runtime.run("handleFundRedeem({ preventDefault() {} })");
  assert.equal(runtime.run("incomeEffect(dataState.records.at(-1))"), 10);
  assert.equal(runtime.run('dataState.fundProjects[0].status'), "closed");
  assert.equal(runtime.run("computeBalances()[2]"), 0);
});

test("fund deletion removes only its dedicated account and linked records", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "基金专属", kind: "资金", initialCents: 0, fundOnly: true, fundProjectId: "3" }
    ];
    dataState.records = [{ id: 1, type: "支出", amount: 5, amountCents: 500, account: 1, date: "2026-09-01" }];
    dataState.fundProjects = [{ id: 3, mode: "one-time", fundName: "基金", fundAccountId: 2 }];
    makeFundTransfer(dataState.fundProjects[0], "2026-09-02", 1000, "contribution", 1, 2, true);
    saveAccounts(); save(); saveFundProjects();
  `);
  assert.equal(runtime.run("deleteFundProject(3)"), true);
  assert.equal(runtime.run("dataState.records.length"), 1);
  assert.equal(runtime.run("dataState.accounts.length"), 1);
  assert.equal(runtime.run("dataState.fundProjects.length"), 0);
  assert.equal(runtime.run("computeBalances()[1]"), 995);
  assert.equal(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1")).length, 1);
});

test("fund deletion refuses an account referenced outside its project", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.offlineMode = true;
    dataState.accounts = [{ id: 2, name: "基金专属", fundOnly: true, fundProjectId: "3" }];
    dataState.fundProjects = [{ id: 3, fundAccountId: 2 }];
    dataState.records = [{ id: 1, type: "转账", account: 2, fundProjectId: "other" }];
  `);
  assert.equal(runtime.run("deleteFundProject(3)"), false);
  assert.equal(runtime.run("dataState.fundProjects.length"), 1);
});

test("fund deletion rolls back account, project and records when storage fails", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "基金专属", kind: "资金", initialCents: 0, fundOnly: true, fundProjectId: "3" }
    ];
    dataState.fundProjects = [{ id: 3, fundAccountId: 2, mode: "one-time", fundName: "基金" }];
    dataState.records = [];
    makeFundTransfer(dataState.fundProjects[0], "2026-09-02", 1000, "contribution", 1, 2, true);
    saveAccounts(); save(); saveFundProjects();
    const originalSet = appStorage.set;
    let failed = false;
    appStorage.set = function(key, value) {
      if (key === fundProjectsKey(1) && !failed) { failed = true; throw new Error("quota"); }
      return originalSet.call(this, key, value);
    };
    try { deleteFundProject(3); } catch (error) {}
    appStorage.set = originalSet;
  `);
  assert.equal(runtime.run("dataState.records.length"), 1);
  assert.equal(runtime.run("dataState.accounts.length"), 2);
  assert.equal(runtime.run("dataState.fundProjects.length"), 1);
  assert.equal(JSON.parse(runtime.localStorage.getItem("jizhangben_accounts_1")).length, 2);
});

test("old plans are not processed by the new fund scheduler", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.offlineMode = true;
    dataState.records = [];
    dataState.investmentPlans = [{ id: 1, name: "旧计划", status: "active", frequency: "daily",
      amountCents: 1000, startDate: "2026-09-01", sourceAccountId: 1, targetAccountId: 2 }];
    dataState.fundProjects = [];
    processDueInvestmentPlans(true);
  `);
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("dataState.investmentPlans[0].status"), "active");
});

test("opening the app catches up each scheduled fund date exactly once", () => {
  const runtime = createRuntime();
  runtime.run(`
    todayStr = () => "2026-09-23";
    renderInvestmentPlans = () => {};
    render = () => {};
    dataState.offlineMode = true;
    dataState.currentBookId = 1;
    dataState.records = [];
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "宽基 · 支付宝", kind: "资金", initialCents: 0, fundOnly: true }
    ];
    dataState.fundProjects = [{
      id: 3, mode: "recurring", fundName: "宽基", platform: "支付宝",
      fundAccountId: 2, sourceAccountId: 1, amountCents: 1000,
      frequency: "weekly", weekdays: [1, 3], startDate: "2026-09-21",
      endDate: "", status: "open", scheduleStatus: "active", processedDates: []
    }];
    processDueInvestmentPlans(true);
    processDueInvestmentPlans(true);
  `);
  assert.deepEqual(Array.from(runtime.run("dataState.records.map(record => record.fundScheduledDate)")),
    ["2026-09-21", "2026-09-23"]);
  assert.equal(runtime.run("computeBalances()[1]"), 980);
  assert.equal(runtime.run("computeBalances()[2]"), 20);
});

test("fund transfers keep principal neutral; only a full profitable redemption records income", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.records = [];
    dataState.accounts = [
      { id: 1, name: "微信", kind: "资金", initialCents: 100000 },
      { id: 2, name: "指数基金 · 支付宝", kind: "资金", initialCents: 0, fundOnly: true }
    ];
    const project = { id: 9, fundName: "指数基金", mode: "recurring", fundAccountId: 2 };
    makeFundTransfer(project, "2026-09-23", 10000, "contribution", 1, 2, true);
    makeFundTransfer(project, "2026-09-23", 10000, "contribution", 1, 2, true);
    makeFundTransfer(project, "2026-09-24", 3000, "withdrawal", 2, 1);
    dataState.projectForTest = project;
  `);
  assert.equal(runtime.run("dataState.records.length"), 2);
  assert.equal(runtime.run("dataState.records.reduce((sum, record) => sum + incomeEffect(record) + expenseEffect(record), 0)"), 0);
  assert.equal(runtime.run("computeBalances()[1]"), 930);
  assert.equal(runtime.run("computeBalances()[2]"), 70);
  runtime.run(`
    makeFundTransfer(dataState.projectForTest, "2026-09-25", 8000, "withdrawal", 2, 1);
    const totals = fundTotals(dataState.projectForTest);
    makeFundSettlement(dataState.projectForTest, "2026-09-25", totals.differenceCents);
  `);
  assert.equal(runtime.run("incomeEffect(dataState.records.at(-1))"), 10);
  assert.equal(runtime.run("expenseEffect(dataState.records.at(-1))"), 0);
  assert.equal(runtime.run("computeBalances()[2]"), 0);
  assert.equal(runtime.run("computeNetWorthFor(dataState.accounts, dataState.records)"), 1010);
});

test("a full loss becomes expense and clears the dedicated fund account", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.records = [];
    dataState.accounts = [
      { id: 1, name: "银行卡", kind: "资金", initialCents: 100000 },
      { id: 2, name: "债券基金 · 直销", kind: "资金", initialCents: 0, fundOnly: true }
    ];
    const project = { id: 8, fundName: "债券基金", mode: "one-time", fundAccountId: 2 };
    makeFundTransfer(project, "2026-09-21", 10000, "contribution", 1, 2, true);
    makeFundTransfer(project, "2026-09-23", 8000, "withdrawal", 2, 1);
    makeFundSettlement(project, "2026-09-23", -2000);
  `);
  assert.equal(runtime.run("expenseEffect(dataState.records.at(-1))"), 20);
  assert.equal(runtime.run("incomeEffect(dataState.records.at(-1))"), 0);
  assert.equal(runtime.run("computeBalances()[2]"), 0);
  assert.equal(runtime.run("computeNetWorthFor(dataState.accounts, dataState.records)"), 980);
});

test("failed fund storage write rolls back project and ledger together", () => {
  const runtime = createRuntime();
  runtime.run(`
    dataState.currentBookId = 1;
    dataState.accounts = [{ id: 1, name: "微信", kind: "资金", initialCents: 10000 }];
    dataState.records = [];
    dataState.fundProjects = [{ id: 2, mode: "one-time", fundName: "测试基金",
      platform: "支付宝", fundAccountId: 3, sourceAccountId: 1,
      amountCents: 1000, startDate: "2026-09-23", endDate: "",
      status: "open", scheduleStatus: "active", processedDates: [] }];
    saveAccounts(); save(); saveFundProjects();
    dataState.records.push({ id: 4, type: "转账", amountCents: 1000, amount: 10,
      date: "2026-09-23", account: 1, toAccount: 3, transferMode: "账户间转账" });
    dataState.fundProjects[0].status = "closed";
    const originalSet = appStorage.set;
    let failed = false;
    appStorage.set = function(key, value) {
      if (key === fundProjectsKey(1) && !failed) { failed = true; throw new Error("quota"); }
      return originalSet.call(this, key, value);
    };
    try { fundPersistState(); } catch (error) {}
    appStorage.set = originalSet;
  `);
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("dataState.fundProjects[0].status"), "open");
  assert.equal(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1")).length, 0);
});
