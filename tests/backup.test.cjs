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
  future.version = 3;
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", future), /bad/);

  const unknown = validBackup();
  unknown.storage.jizhangben_unrecognized = JSON.stringify({ value: true });
  assert.throws(() => runWithValue(runtime, "extractBackupStorage", unknown), /bad/);
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
