const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function setRecords(runtime, records) {
  runtime.run(`dataState.records = ${JSON.stringify(records)}`);
}

test("a paid deposit and its full return do not count as income or expense", () => {
  const runtime = createRuntime();
  setRecords(runtime, [
    { id: 1, type: "押金", amountCents: 100000, account: 1, depositDir: "付" },
    {
      id: 2,
      type: "押金",
      amountCents: 100000,
      account: 1,
      depositDir: "退回",
      depositLinkId: 1,
      depositFinal: true
    }
  ]);

  assert.equal(runtime.run("dataState.records.reduce((sum, r) => sum + incomeEffect(r), 0)"), 0);
  assert.equal(runtime.run("dataState.records.reduce((sum, r) => sum + expenseEffect(r), 0)"), 0);
  assert.equal(runtime.run(`computeBalancesFor(
    [{ id: 1, kind: "资金", initialCents: 200000 }],
    dataState.records
  )[1]`), 2000);
});

test("an incompletely returned paid deposit recognizes only the missing amount as expense", () => {
  const runtime = createRuntime();
  setRecords(runtime, [
    { id: 10, type: "押金", amountCents: 100000, account: 1, depositDir: "付" },
    {
      id: 11,
      type: "押金",
      amountCents: 20000,
      account: 1,
      depositDir: "退回",
      depositLinkId: 10,
      depositFinal: false
    },
    {
      id: 12,
      type: "押金",
      amountCents: 50000,
      account: 1,
      depositDir: "退回",
      depositLinkId: 10,
      depositFinal: true
    }
  ]);

  assert.equal(runtime.run("expenseEffect(dataState.records[0])"), 0);
  assert.equal(runtime.run("expenseEffect(dataState.records[1])"), 0);
  assert.equal(runtime.run("expenseEffect(dataState.records[2])"), 300);
  assert.equal(runtime.run("incomeEffect(dataState.records[2])"), 0);
  assert.equal(runtime.run(`computeBalancesFor(
    [{ id: 1, kind: "资金", initialCents: 200000 }],
    dataState.records
  )[1]`), 1700);
});

test("an incompletely returned received deposit recognizes the retained amount as income", () => {
  const runtime = createRuntime();
  setRecords(runtime, [
    { id: 20, type: "押金", amountCents: 100000, account: 1, depositDir: "收" },
    {
      id: 21,
      type: "押金",
      amountCents: 70000,
      account: 1,
      depositDir: "退",
      depositLinkId: 20,
      depositFinal: true
    }
  ]);

  assert.equal(runtime.run("incomeEffect(dataState.records[1])"), 300);
  assert.equal(runtime.run("expenseEffect(dataState.records[1])"), 0);
  assert.equal(runtime.run(`computeBalancesFor(
    [{ id: 1, kind: "资金", initialCents: 100000 }],
    dataState.records
  )[1]`), 1300);
});

test("asset, debt and transfer balances preserve the net worth equation", () => {
  const runtime = createRuntime();
  const balances = runtime.run(`computeBalancesFor(
    [
      { id: 1, kind: "资金", initialCents: 100000 },
      { id: 2, kind: "负债", initialCents: 20000 }
    ],
    [
      { id: 1, type: "收入", amountCents: 20000, account: 1 },
      { id: 2, type: "支出", amountCents: 10000, account: 1 },
      { id: 3, type: "支出", amountCents: 30000, account: 2 },
      { id: 4, type: "转账", amountCents: 20000, account: 1, toAccount: 2 }
    ]
  )`);

  assert.equal(balances[1], 900);
  assert.equal(balances[2], 300);
  assert.equal(balances[1] - balances[2], 600);
});

test("balance calculations keep cent values exact", () => {
  const runtime = createRuntime();
  const balance = runtime.run(`computeBalancesFor(
    [{ id: 1, kind: "资金", initialCents: 0 }],
    [
      { id: 1, type: "收入", amountCents: 10, account: 1 },
      { id: 2, type: "收入", amountCents: 20, account: 1 }
    ]
  )[1]`);

  assert.equal(balance, 0.3);
});

test("deposit settlement keeps cent values exact across multiple returns", () => {
  const runtime = createRuntime();
  setRecords(runtime, [
    { id: 30, type: "押金", amountCents: 60, account: 1, depositDir: "付" },
    {
      id: 31,
      type: "押金",
      amountCents: 10,
      account: 1,
      depositDir: "退回",
      depositLinkId: 30,
      depositFinal: false
    },
    {
      id: 32,
      type: "押金",
      amountCents: 20,
      account: 1,
      depositDir: "退回",
      depositLinkId: 30,
      depositFinal: true
    }
  ]);

  assert.equal(runtime.run("depositSettlementInfo(dataState.records[2], 32).difference"), 0.3);
  assert.equal(runtime.run("expenseEffect(dataState.records[2])"), 0.3);
});

test("balance calculations accept UUID account references", () => {
  const runtime = createRuntime();
  const balance = runtime.run(`computeBalancesFor(
    [{ id: "account-uuid", kind: "资金", initialCents: 10000 }],
    [{ id: "record-uuid", type: "支出", amountCents: 2500, account: "account-uuid" }]
  )["account-uuid"]`);

  assert.equal(balance, 75);
});
