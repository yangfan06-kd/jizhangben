const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("runMigrations upgrades legacy single-book data through schema v2", () => {
  const runtime = createRuntime({
    jizhangben_records: JSON.stringify([
      { id: 1, type: "支出", amount: 6.789, accountId: 2 }
    ]),
    jizhangben_accounts: JSON.stringify([
      { id: 2, name: "银行卡", kind: "资金", initial: 10.239 }
    ])
  });

  assert.equal(runtime.run("runMigrations()"), true);
  assert.equal(runtime.localStorage.getItem("jizhangben_schema_version"), "2");
  assert.equal(runtime.localStorage.getItem("jizhangben_records"), null);
  assert.equal(runtime.localStorage.getItem("jizhangben_accounts"), null);

  const books = JSON.parse(runtime.localStorage.getItem("jizhangben_books"));
  assert.equal(books.length, 1);
  assert.equal(books[0].name, "我的账本");

  const records = JSON.parse(
    runtime.localStorage.getItem(`jizhangben_records_${books[0].id}`)
  );
  const accounts = JSON.parse(
    runtime.localStorage.getItem(`jizhangben_accounts_${books[0].id}`)
  );
  assert.equal(records[0].amount, 6.79);
  assert.equal(records[0].amountCents, 679);
  assert.equal(accounts[0].initial, 10.24);
  assert.equal(accounts[0].initialCents, 1024);
  assert.equal(runtime.run("uiState.startupNotice"), "");
});

test("runMigrations restores the complete snapshot after a write failure", () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 99, name: "测试账本", category: "个人" }]),
    jizhangben_current_book: "99",
    jizhangben_schema_version: "1",
    jizhangben_records_99: JSON.stringify([{ id: 1, amount: 8.765 }]),
    jizhangben_accounts_99: JSON.stringify([{ id: 2, initial: 20.555 }])
  });
  const before = runtime.localStorage.toObject();

  const succeeded = runtime.run(`(() => {
    const originalSet = appStorage.set;
    let shouldFail = true;
    appStorage.set = function(key, value) {
      if (shouldFail && key === "jizhangben_accounts_99") {
        shouldFail = false;
        throw new Error("simulated migration failure");
      }
      return originalSet.call(appStorage, key, value);
    };
    const ok = runMigrations();
    appStorage.set = originalSet;
    return ok;
  })()`);

  assert.equal(succeeded, false);
  assert.deepEqual(runtime.localStorage.toObject(), before);
  assert.match(runtime.run("uiState.startupNotice"), /已恢复升级前的数据/);
});

test("runMigrations preserves corrupt JSON while advancing valid schema steps", () => {
  const runtime = createRuntime({
    jizhangben_schema_version: "1",
    jizhangben_records_99: "{broken",
    jizhangben_accounts_99: JSON.stringify([{ id: 2, initial: 3.456 }])
  });

  assert.equal(runtime.run("runMigrations()"), true);
  assert.equal(runtime.localStorage.getItem("jizhangben_schema_version"), "2");
  assert.equal(runtime.localStorage.getItem("jizhangben_records_99"), "{broken");

  const accounts = JSON.parse(runtime.localStorage.getItem("jizhangben_accounts_99"));
  assert.equal(accounts[0].initial, 3.46);
  assert.equal(accounts[0].initialCents, 346);
  assert.equal(runtime.run("uiState.startupNotice"), "");
});
