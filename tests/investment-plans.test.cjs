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

function correctionRuntime(mode = "one-time", closed = false, window = {}) {
  const runtime = createRuntime({}, { window });
  runtime.run(`
    todayStr = () => "2026-10-17";
    renderInvestmentPlans = () => {}; render = () => {};
    dataState.offlineMode = true; dataState.currentBookId = 1;
    dataState.accounts = [
      {id:1,name:"微信",kind:"资金",initialCents:100000},
      {id:2,name:"银行卡",kind:"资金",initialCents:50000},
      {id:3,name:"基金",kind:"资金",initialCents:2000,fundOnly:true,fundProjectId:"9"}
    ];
    dataState.records = [];
    dataState.fundProjects = [{id:9,mode:${JSON.stringify(mode)},fundName:"宽基",platform:"支付宝",
      sourceAccountId:1,fundAccountId:3,originalCostCents:2000,amountCents:10000,
      frequency:"monthly",monthDays:[8],startDate:"2026-10-01",endDate:"",
      status:"open",scheduleStatus:"active",processedDates:[]}];
    makeFundTransfer(dataState.fundProjects[0],"2026-10-08",10000,"contribution",1,3,true,"2026-10#8");
    dataState.records.at(-1).id=1;
    makeFundTransfer(dataState.fundProjects[0],"2026-10-09",3000,"withdrawal",3,1);
    dataState.records.at(-1).id=2;
    dataState.records.push({id:10,type:"支出",category:"自定义保留",account:1,date:"2026-10-10",amountCents:1234,amount:12.34});
    saveAccounts();save();saveFundProjects();
  `);
  if (closed) runtime.run(`
    makeFundTransfer(dataState.fundProjects[0],"2026-10-10",7000,"withdrawal",3,1);
    makeFundSettlement(dataState.fundProjects[0],"2026-10-10",-2000);
    dataState.fundProjects[0].status="closed";dataState.fundProjects[0].closedDate="2026-10-10";
    save();saveFundProjects();
  `);
  return runtime;
}

test("fund correction updates one transfer, principal and both account ledgers without rewriting unrelated data", () => {
  const runtime = correctionRuntime();
  const other = runtime.run('JSON.stringify(dataState.records.find(r=>r.id===10))');
  runtime.run('correctFundRecord(9,1,{bookId:1,amountCents:15000,date:"2026-10-07",accountId:"2"})');
  assert.equal(runtime.run("fundTotals(dataState.fundProjects[0]).investedCents"), 17000);
  assert.equal(runtime.run("dataState.fundProjects[0].originalCostCents"), 2000);
  assert.equal(runtime.run("dataState.records[0].id"), 1);
  assert.equal(runtime.run("dataState.records[0].fundScheduleKey"), "2026-10#8");
  assert.equal(runtime.run("computeBalances()[1]"), 1017.66);
  assert.equal(runtime.run("computeBalances()[2]"), 350);
  assert.equal(runtime.run("computeBalances()[3]"), 140);
  assert.equal(runtime.run('JSON.stringify(dataState.records.find(r=>r.id===10))'), other);
  assert.equal(runtime.run("incomeEffect(dataState.records[0])+expenseEffect(dataState.records[0])"), 0);
  assert.equal(runtime.run("dataState.fundProjects[0].corrections.length"), 1);
});

test("voiding a mistaken recurring contribution retains occurrence key and optionally pauses future posting", () => {
  const runtime = correctionRuntime("recurring");
  runtime.run('correctFundRecord(9,1,{bookId:1,void:true});processDueInvestmentPlans(true)');
  assert.equal(runtime.run('dataState.records.filter(r=>r.fundAction==="contribution").length'), 0);
  assert.equal(runtime.run('dataState.fundProjects[0].processedDates.includes("2026-10#8")'), true);
  assert.equal(runtime.run('dataState.fundProjects[0].scheduleStatus'), "active");
  assert.equal(runtime.run('fundTotals(dataState.fundProjects[0]).investedCents'), 2000);
  const paused = correctionRuntime("recurring");
  paused.run('correctFundRecord(9,1,{bookId:1,amountCents:9000,date:"2026-10-08",accountId:1,pauseSchedule:true})');
  assert.equal(paused.run('dataState.fundProjects[0].scheduleStatus'), "paused");
});

test("closed fund correction recalculates loss, zero and profit with matching settlement and zero fund balance", () => {
  const runtime = correctionRuntime("one-time", true);
  const settlementId = runtime.run('dataState.records.find(r=>r.fundAction==="settlement").id');
  runtime.run('correctFundRecord(9,1,{bookId:1,amountCents:6000,date:"2026-10-08",accountId:1})');
  assert.equal(runtime.run('dataState.records.find(r=>r.fundAction==="settlement").id'), settlementId);
  assert.equal(runtime.run('dataState.records.find(r=>r.fundAction==="settlement").fundResult'), "income");
  assert.equal(runtime.run('incomeEffect(dataState.records.find(r=>r.fundAction==="settlement"))'), 20);
  assert.equal(runtime.run('computeBalances()[3]'), 0);
  runtime.run('correctFundRecord(9,1,{bookId:1,amountCents:8000,date:"2026-10-08",accountId:1})');
  assert.equal(runtime.run('dataState.records.filter(r=>r.fundAction==="settlement").length'), 0);
  assert.equal(runtime.run('computeBalances()[3]'), 0);
  runtime.run('correctFundRecord(9,1,{bookId:1,amountCents:12000,date:"2026-10-08",accountId:1})');
  assert.equal(runtime.run('expenseEffect(dataState.records.find(r=>r.fundAction==="settlement"))'), 40);
  assert.equal(runtime.run('computeBalances()[3]'), 0);
  runtime.run('correctFundRecord(9,2,{bookId:1,amountCents:4000,date:"2026-10-09",accountId:2})');
  assert.equal(runtime.run('fundTotals(dataState.fundProjects[0]).withdrawnCents'), 11000);
  assert.equal(runtime.run('expenseEffect(dataState.records.find(r=>r.fundAction==="settlement"))'), 30);
  assert.equal(runtime.run('computeBalances()[3]'), 0);
});

test("invalid, stale, cross-book and ambiguous fund corrections do not mutate records or settings", () => {
  const runtime = correctionRuntime();
  const before = runtime.run('JSON.stringify([dataState.records,dataState.accounts,dataState.fundProjects])');
  for (const changes of [
    '{bookId:2,void:true}', '{bookId:1,amountCents:0,date:"2026-10-08",accountId:1}',
    '{bookId:1,amountCents:100,date:"2026-02-30",accountId:1}',
    '{bookId:1,amountCents:100,date:"2026-10-18",accountId:1}',
    '{bookId:1,amountCents:100,date:"2026-10-08",accountId:3}'
  ]) assert.throws(()=>runtime.run(`correctFundRecord(9,1,${changes})`));
  assert.throws(()=>runtime.run('correctFundRecord(9,1,{bookId:1,void:true},"stale")'));
  assert.equal(runtime.run('JSON.stringify([dataState.records,dataState.accounts,dataState.fundProjects])'), before);
  const closed = correctionRuntime("one-time", true);
  assert.throws(()=>closed.run('correctFundRecord(9,1,{bookId:1,amountCents:100,date:"2026-10-11",accountId:1})'));
  assert.throws(()=>closed.run('correctFundRecord(9,2,{bookId:1,void:true})'), /暂不能撤销/);
  runtime.run('dataState.records.push({...dataState.records[0]})');
  assert.throws(()=>runtime.run('correctFundRecord(9,1,{bookId:1,void:true})'), /重复编号/);
});

test("failed fund correction restores stored records, occurrence keys and audit history", () => {
  const runtime = correctionRuntime("recurring");
  const before = runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])');
  runtime.run(`
    const realSet = appStorage.set; let once=false;
    appStorage.set=function(key,value){if(key===fundProjectsKey(1)&&!once){once=true;throw new Error("空间不足");}return realSet.call(this,key,value);};
  `);
  assert.throws(()=>runtime.run('correctFundRecord(9,1,{bookId:1,void:true,pauseSchedule:true})'), /空间不足/);
  assert.equal(runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])'), before);
  assert.equal(JSON.parse(runtime.localStorage.getItem("jizhangben_records_1"))[0].id, 1);
});

test("native fund correction commits ledger and plan together, and a failed native transaction changes neither", () => {
  const disk = {}, batches = [];
  const bridge = { fail: false, readEntries: () => JSON.stringify(disk), writeEntries(raw) {
    if (this.fail) return false;
    batches.push(JSON.parse(raw));Object.assign(disk, batches.at(-1));return true;
  } };
  const runtime = correctionRuntime("recurring", false, { JizhangbenStorage: bridge });
  batches.length = 0;
  runtime.run('correctFundRecord(9,1,{bookId:1,amountCents:7500,date:"2026-10-08",accountId:1})');
  assert.equal(batches.length, 1);
  assert.deepEqual(Object.keys(batches[0]).sort(), ['jizhangben_fund_projects_1', 'jizhangben_records_1']);
  const before = JSON.stringify(disk);
  const beforeMemory = runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])');
  bridge.fail = true;
  assert.throws(()=>runtime.run('correctFundRecord(9,1,{bookId:1,void:true,pauseSchedule:true})'), /未能保存/);
  assert.equal(JSON.stringify(disk), before);
  assert.equal(runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])'), beforeMemory);
});

test("fund corrections and voided schedule markers survive validated backup round-trip", () => {
  const runtime = correctionRuntime("recurring");
  runtime.run(`
    appStorage.set(BOOKS_KEY,JSON.stringify([{id:1,name:"隔离基金账本",category:"个人"}]));
    appStorage.set(CURRENT_BOOK_KEY,"1");
    appStorage.set(STORAGE_SCHEMA_KEY,String(STORAGE_SCHEMA_VERSION));
    correctFundRecord(9,1,{bookId:1,void:true});
    dataState.backupForCorrection = extractBackupStorage({format:"jizhangben-backup",version:3,storage:appStorage.entries("jizhangben_")});
  `);
  const backup=runtime.run('JSON.stringify(dataState.backupForCorrection)');
  const restored=createRuntime();
  restored.run(`replaceBackupStorage(${backup});loadBooks();load();loadAccounts();loadFundProjects();`);
  assert.equal(restored.run('dataState.fundProjects[0].corrections[0].action'),"void");
  assert.equal(restored.run('dataState.fundProjects[0].processedDates.includes("2026-10#8")'),true);
  assert.equal(restored.run('dataState.records.some(r=>r.id===1)'),false);
  assert.equal(restored.run('JSON.stringify(appStorage.entries("jizhangben_"))'),backup);
});

test("failure while reading the pre-commit snapshot does not leave an unsaved correction in memory", () => {
  const runtime = correctionRuntime("recurring");
  const before=runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])');
  runtime.run('appStorage.get=()=>{throw new Error("模拟读取失败")};');
  assert.throws(()=>runtime.run('correctFundRecord(9,1,{bookId:1,void:true,pauseSchedule:true})'), /模拟读取失败/);
  assert.equal(runtime.run('JSON.stringify([dataState.records,dataState.fundProjects])'),before);
});
