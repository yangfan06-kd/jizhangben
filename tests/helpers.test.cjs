const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("toCents avoids decimal accumulation errors", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("toCents(0.1 + 0.2)"), 30);
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
