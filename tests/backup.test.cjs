const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function runWithValue(runtime, expression, value) {
  return runtime.run(`${expression}(${JSON.stringify(value)})`);
}

function validBackup() {
  return {
    format: "jizhangben-backup",
    version: 2,
    exportedAt: "2026-09-13T00:00:00.000Z",
    storage: {
      jizhangben_books: JSON.stringify([{ id: 1, name: "我的账本", category: "个人" }]),
      jizhangben_current_book: "1",
      jizhangben_records_1: JSON.stringify([
        { id: 10, type: "支出", amountCents: 123, category: "餐饮", account: 2 }
      ]),
      jizhangben_accounts_1: JSON.stringify([
        { id: 2, name: "银行卡", kind: "资金", initialCents: 1000 }
      ]),
      jizhangben_custom_types: JSON.stringify([{ name: "奖金", side: "income" }]),
      jizhangben_custom_categories: JSON.stringify(["旅行"]),
      jizhangben_custom_category_icons: JSON.stringify({ "旅行": "travel" }),
      jizhangben_budgets_1: JSON.stringify({ version: 1, periods: { "2026-09": { totalCents: 300000, categories: { "餐饮": 80000 } } } }),
      jizhangben_schema_version: "2"
    }
  };
}

test("extractBackupStorage accepts a complete current backup", () => {
  const runtime = createRuntime();
  const backup = validBackup();
  const extracted = runWithValue(runtime, "extractBackupStorage", backup);

  assert.equal(Object.keys(extracted).length, Object.keys(backup.storage).length);
  assert.equal(extracted.jizhangben_records_1, backup.storage.jizhangben_records_1);
  assert.equal(extracted.jizhangben_accounts_1, backup.storage.jizhangben_accounts_1);
  assert.equal(extracted.jizhangben_budgets_1, backup.storage.jizhangben_budgets_1);
});

test("extractBackupStorage keeps compatibility with legacy flat backups", () => {
  const runtime = createRuntime();
  const legacy = {
    jizhangben_records: JSON.stringify([{ id: 1, type: "支出", amount: 8.88 }]),
    jizhangben_accounts: JSON.stringify([
      { id: 2, name: "现金", kind: "资金", initial: 100 }
    ])
  };
  const extracted = runWithValue(runtime, "extractBackupStorage", legacy);

  assert.equal(extracted.jizhangben_records, legacy.jizhangben_records);
  assert.equal(extracted.jizhangben_accounts, legacy.jizhangben_accounts);
});

test("extractBackupStorage rejects records with missing money fields", () => {
  const runtime = createRuntime();
  const backup = validBackup();
  backup.storage.jizhangben_records_1 = JSON.stringify([{ id: 10, type: "支出" }]);

  assert.throws(() => runWithValue(runtime, "extractBackupStorage", backup), /bad/);
});

test("extractBackupStorage rejects future versions and unknown storage keys", () => {
  const runtime = createRuntime();
  const future = validBackup();
  future.version = runtime.run("DATA_VERSION + 1");
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", future), /bad/);

  const unknown = validBackup();
  unknown.storage.jizhangben_unrecognized = JSON.stringify({ value: true });
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", unknown), /bad/);
});

test("extractBackupStorage validates custom category icon mappings", () => {
  const runtime = createRuntime();
  const backup = validBackup();
  backup.storage.jizhangben_custom_category_icons = JSON.stringify({ "旅行": "travel" });
  assert.equal(runWithValue(runtime, "extractBackupStorage", backup).jizhangben_custom_category_icons, backup.storage.jizhangben_custom_category_icons);

  const invalid = validBackup();
  invalid.storage.jizhangben_custom_category_icons = JSON.stringify(["travel"]);
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", invalid), /bad/);
});

test("investment plans are preserved in local backups and validated", () => {
  const runtime = createRuntime();
  const backup = validBackup();
  const plans = [{
    id: 15,
    name: "指数基金定投",
    fundName: "沪深300",
    amountCents: 10000,
    frequency: "monthly",
    day: 31,
    startDate: "2026-01-31",
    endDate: "",
    sourceAccountId: 2,
    targetAccountId: 3,
    confirmMode: "automatic",
    status: "active",
    processedDates: [],
    pendingDates: []
  }];
  backup.storage.jizhangben_investment_plans_1 = JSON.stringify(plans);
  const extracted = runWithValue(runtime, "extractBackupStorage", backup);
  assert.equal(extracted.jizhangben_investment_plans_1, backup.storage.jizhangben_investment_plans_1);

  backup.storage.jizhangben_investment_plans_1 = JSON.stringify([{ ...plans[0], amountCents: 0 }]);
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", backup), /bad/);
});

test("dedicated fund projects and accounts survive backup validation", () => {
  const runtime = createRuntime();
  const backup = validBackup();
  const projects = [{
    id: 27, mode: "recurring", fundName: "宽基基金", platform: "支付宝",
    fundAccountId: 3, sourceAccountId: 2, amountCents: 12000,
    frequency: "weekly", weekdays: [1, 3, 5], monthDay: null,
    startDate: "2026-09-23", endDate: "", status: "open",
    scheduleStatus: "active", processedDates: []
  }];
  backup.storage.jizhangben_fund_projects_1 = JSON.stringify(projects);
  backup.storage.jizhangben_accounts_1 = JSON.stringify([
    { id: 2, name: "微信", kind: "资金", initialCents: 100000 },
    { id: 3, name: "宽基基金 · 支付宝", kind: "资金", initialCents: 0, fundOnly: true }
  ]);
  const extracted = runWithValue(runtime, "extractBackupStorage", backup);
  assert.equal(extracted.jizhangben_fund_projects_1, backup.storage.jizhangben_fund_projects_1);

  backup.storage.jizhangben_fund_projects_1 = JSON.stringify([{ ...projects[0], weekdays: [0] }]);
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", backup), /bad/);

  backup.storage.jizhangben_fund_projects_1 = JSON.stringify([{
    ...projects[0], frequency: "monthly", weekdays: [], monthDays: [1, 15, 31]
  }]);
  assert.doesNotThrow(() => runWithValue(runtime, "extractBackupStorage", backup));
  backup.storage.jizhangben_fund_projects_1 = JSON.stringify([{
    ...projects[0], frequency: "monthly", weekdays: [], monthDays: [1, 1]
  }]);
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", backup), /bad/);
  backup.storage.jizhangben_fund_projects_1 = JSON.stringify([{
    ...projects[0], frequency: "monthly", weekdays: [], monthDays: undefined, monthDay: 15
  }]);
  assert.doesNotThrow(() => runWithValue(runtime, "extractBackupStorage", backup));
});

test("replaceBackupStorage restores the original snapshot after a write failure", () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 7, name: "原账本", category: "个人" }]),
    jizhangben_current_book: "7",
    jizhangben_records_7: JSON.stringify([{ id: 1, type: "收入", amountCents: 500 }]),
    jizhangben_schema_version: "2"
  });
  const before = runtime.localStorage.toObject();
  const imported = validBackup().storage;

  const succeeded = runtime.run(`(() => {
    const imported = ${JSON.stringify(imported)};
    const originalSet = appStorage.set;
    let shouldFail = true;
    appStorage.set = function(key, value) {
      if (shouldFail && key === "jizhangben_accounts_1") {
        shouldFail = false;
        throw new Error("simulated backup write failure");
      }
      return originalSet.call(appStorage, key, value);
    };
    try {
      replaceBackupStorage(imported);
      return true;
    } catch (error) {
      return false;
    } finally {
      appStorage.set = originalSet;
    }
  })()`);

  assert.equal(succeeded, false);
  assert.deepEqual(runtime.localStorage.toObject(), before);
});
