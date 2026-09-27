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

test("unsettled deposits remain in net assets, and final differences are not double-counted", () => {
  const runtime = createRuntime();
  const paid = [
    { id: "paid-open", type: "押金", amountCents: 100000, account: 1, depositDir: "付", date: "2026-09-01" },
    { id: "paid-part", type: "押金", amountCents: 70000, account: 1, depositDir: "退回", depositLinkId: "paid-open", depositFinal: false, date: "2026-09-02" }
  ];
  const paidAssets = [{ id: 1, kind: "资金", initialCents: 100000 }];
  assert.equal(runtime.run(`computeNetWorthFor(${JSON.stringify(paidAssets)}, ${JSON.stringify(paid)})`), 1000);

  paid[1].depositFinal = true;
  assert.equal(runtime.run(`computeNetWorthFor(${JSON.stringify(paidAssets)}, ${JSON.stringify(paid)})`), 700);

  const received = [
    { id: "received-open", type: "押金", amountCents: 100000, account: 1, depositDir: "收", date: "2026-09-01" },
    { id: "received-part", type: "押金", amountCents: 70000, account: 1, depositDir: "退", depositLinkId: "received-open", depositFinal: false, date: "2026-09-02" }
  ];
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 0 }], ${JSON.stringify(received)})`), 0);
  received[1].depositFinal = true;
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 0 }], ${JSON.stringify(received)})`), 300);
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

test("transferring money to another person reduces the source balance without becoming expense", () => {
  const runtime = createRuntime();
  const record = {
    id: "other-transfer-1",
    type: "转账",
    transferMode: "转账他人",
    transferParty: "家人",
    amountCents: 1250,
    account: 1,
    date: "2026-09-20"
  };
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 10000 }], [${JSON.stringify(record)}])[1]`), 87.5);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(record)})`), 0);
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(record)})`), 0);
  assert.equal(runtime.run(`flowDir(${JSON.stringify(record)})`), "out");
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

test("balance adjustments set the selected account to its actual balance", () => {
  const runtime = createRuntime();
  const balances = runtime.run(`computeBalancesFor(
    [
      { id: 1, kind: "资金", initialCents: 1000 },
      { id: 2, kind: "负债", initialCents: 5000 }
    ],
    [
      { id: 1, type: "支出", amountCents: 300, account: 1, date: "2026-09-01" },
      { id: 2, type: "余额", amountCents: 2000, account: 1, date: "2026-09-02" },
      { id: 3, type: "收入", amountCents: 400, account: 1, date: "2026-09-03" },
      { id: 4, type: "余额", amountCents: 12000, account: 2, date: "2026-09-03" }
    ]
  )`);

  assert.equal(balances[1], 24);
  assert.equal(balances[2], 120);
  assert.equal(runtime.run(`incomeEffect({ type: "余额", amountCents: 12000 })`), 0);
  assert.equal(runtime.run(`expenseEffect({ type: "余额", amountCents: 12000 })`), 0);
});

test("loan principal stays neutral while borrow and repayment change the account", () => {
  const runtime = createRuntime();
  const records = [
    { id: "borrow-1", type: "借贷", loanMode: "借入", loanParty: "同学", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "repay-1", type: "借贷", loanMode: "偿还", loanParty: "同学", loanLinkId: "borrow-1", amountCents: 3000, account: 1, date: "2026-09-03" }
  ];
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 0 }], ${JSON.stringify(records)})[1]`), 70);
  assert.equal(runtime.run(`loanOutstandingFor(${JSON.stringify(records[0])}, ${JSON.stringify(records)})`), 70);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(records[0])}) + expenseEffect(${JSON.stringify(records[1])})`), 0);
});

test("loan principal stays neutral while lending and collecting change the account", () => {
  const runtime = createRuntime();
  const records = [
    { id: "lend-1", type: "借贷", loanMode: "借出", loanParty: "朋友", amountCents: 20000, account: 1, date: "2026-09-01" },
    { id: "collect-1", type: "借贷", loanMode: "收回", loanParty: "朋友", loanLinkId: "lend-1", amountCents: 12000, account: 1, date: "2026-09-03" }
  ];
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(records)})[1]`), 920);
  assert.equal(runtime.run(`loanOutstandingFor(${JSON.stringify(records[0])}, ${JSON.stringify(records)})`), 80);
  assert.equal(runtime.run(`dataState.records = ${JSON.stringify(records)}; dataState.records.reduce((sum, r) => sum + incomeEffect(r) + expenseEffect(r), 0)`), 0);
});

test("loan balances keep net worth unchanged while tracking debt and receivables", () => {
  const runtime = createRuntime();
  const borrowed = [
    { id: "borrow-2", type: "借贷", loanMode: "借入", amountCents: 10000, account: 1, date: "2026-09-01" }
  ];
  const lent = [
    { id: "lend-2", type: "借贷", loanMode: "借出", amountCents: 10000, account: 1, date: "2026-09-01" }
  ];
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 0 }], ${JSON.stringify(borrowed)})`), 0);
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(lent)})`), 1000);
});

test("paying for someone stays neutral until the amount is written off", () => {
  const runtime = createRuntime();
  const recovered = [
    { id: "pay-1", type: "代付", payMode: "代付", payParty: "朋友", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "recover-1", type: "代付", payMode: "收回", payParty: "朋友", payLinkId: "pay-1", amountCents: 3000, account: 1, date: "2026-09-03" }
  ];
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(recovered)})[1]`), 930);
  assert.equal(runtime.run(`payOutstandingFor(${JSON.stringify(recovered[0])}, ${JSON.stringify(recovered)})`), 70);
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(recovered)})`), 1000);
  assert.equal(runtime.run(`dataState.records = ${JSON.stringify(recovered)}; dataState.records.reduce((sum, r) => sum + expenseEffect(r), 0)`), 0);
});

test("an unrecovered pay-for amount becomes expense without charging the account twice", () => {
  const runtime = createRuntime();
  const writtenOff = [
    { id: "pay-2", type: "代付", payMode: "代付", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "writeoff-2", type: "代付", payMode: "转为支出", payLinkId: "pay-2", amountCents: 10000, date: "2026-09-04" }
  ];
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(writtenOff)})[1]`), 900);
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(writtenOff[1])})`), 100);
  assert.equal(runtime.run(`computeNetWorthFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(writtenOff)})`), 900);
});

test("legacy pay-for records without a mode keep their original account flow", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], [{ id: 1, type: "代付", amountCents: 2500, account: 1 }])[1]`), 975);
  assert.equal(runtime.run(`expenseEffect({ type: "代付", amountCents: 2500 })`), 0);
});

test("reimbursement offsets the linked expense without becoming income", () => {
  const runtime = createRuntime();
  const records = [
    { id: "expense-1", type: "支出", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "reim-1", type: "报销", reimbursementParty: "公司", reimbursementLinkId: "expense-1", amountCents: 7000, account: 1, date: "2026-09-03" }
  ];
  setRecords(runtime, records);
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(records)})[1]`), 970);
  assert.equal(runtime.run(`reimbursementOutstandingFor(${JSON.stringify(records[0])}, ${JSON.stringify(records)})`), 30);
  assert.equal(runtime.run(`reimbursementOutstandingFor(${JSON.stringify(records[0])}, ${JSON.stringify(records)}, "reim-1")`), 100);
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(records[1])})`), -70);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(records[1])})`), 0);
});

test("reimbursement excess becomes income after the linked expense is fully offset", () => {
  const runtime = createRuntime();
  const records = [
    { id: "expense-2", type: "支出", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "reim-2", type: "报销", reimbursementParty: "学校", reimbursementLinkId: "expense-2", amountCents: 12000, account: 1, date: "2026-09-03" }
  ];
  setRecords(runtime, records);
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(records)})[1]`), 1020);
  const effect = runtime.run(`reimbursementEffect(${JSON.stringify(records[1])}, ${JSON.stringify(records)})`);
  assert.equal(effect.income, 20);
  assert.equal(effect.expense, -100);
  assert.equal(effect.applied, 100);
  assert.equal(effect.excess, 20);
  assert.equal(effect.original.id, "expense-2");
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(records[1])})`), 20);
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(records[1])})`), -100);
});

test("legacy unlinked reimbursement keeps the old expense offset behavior", () => {
  const runtime = createRuntime();
  const record = { type: "报销", amountCents: 2500 };
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(record)})`), -25);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(record)})`), 0);
  assert.equal(runtime.run(`flowDir(${JSON.stringify(record)})`), "in");
});

test("refund offsets the linked expense without becoming income", () => {
  const runtime = createRuntime();
  const records = [
    { id: "expense-3", type: "支出", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "refund-1", type: "退款", refundLinkId: "expense-3", amountCents: 7000, account: 1, date: "2026-09-03" }
  ];
  setRecords(runtime, records);
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(records)})[1]`), 970);
  assert.equal(runtime.run(`refundOutstandingFor(${JSON.stringify(records[0])}, ${JSON.stringify(records)})`), 30);
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(records[1])})`), -70);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(records[1])})`), 0);
});

test("refund excess becomes income after the linked expense is fully offset", () => {
  const runtime = createRuntime();
  const records = [
    { id: "expense-4", type: "支出", amountCents: 10000, account: 1, date: "2026-09-01" },
    { id: "refund-2", type: "退款", refundLinkId: "expense-4", amountCents: 12000, account: 1, date: "2026-09-03" }
  ];
  setRecords(runtime, records);
  const effect = runtime.run(`refundEffect(${JSON.stringify(records[1])}, ${JSON.stringify(records)})`);
  assert.equal(effect.income, 20);
  assert.equal(effect.expense, -100);
  assert.equal(effect.applied, 100);
  assert.equal(effect.excess, 20);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(records[1])})`), 20);
  assert.equal(runtime.run(`computeBalancesFor([{ id: 1, kind: "资金", initialCents: 100000 }], ${JSON.stringify(records)})[1]`), 1020);
});

test("legacy unlinked refund keeps the old expense offset behavior", () => {
  const runtime = createRuntime();
  const record = { type: "退款", amountCents: 2500 };
  assert.equal(runtime.run(`expenseEffect(${JSON.stringify(record)})`), -25);
  assert.equal(runtime.run(`incomeEffect(${JSON.stringify(record)})`), 0);
  assert.equal(runtime.run(`flowDir(${JSON.stringify(record)})`), "in");
});
