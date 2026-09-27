const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function normalize(runtime, csv) {
  return runtime.run(`normalizeExternalRows(parseExternalCsv(${JSON.stringify(csv)}))`);
}

test("external CSV parser keeps quoted commas and maps common fields", () => {
  const runtime = createRuntime();
  const result = normalize(runtime, "日期,类型,分类,金额,账户,备注\n2026-09-20,支出,餐饮,\"35.50\",微信,\"午餐,堂食\"");

  assert.equal(result.rows.length, 1);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0])), {
    sourceRow: 2,
    date: "2026-09-20",
    type: "支出",
    amountCents: 3550,
    category: "餐饮",
    account: "微信",
    toAccount: "",
    note: "午餐,堂食",
    bookName: ""
  });
});

test("external CSV parser accepts tab columns and separate income/expense fields", () => {
  const runtime = createRuntime();
  const result = normalize(runtime, "记账日期\t收入\t支出\t一级分类\t账户\n2026年9月1日\t1200\t\t工资\t银行卡\n2026/09/02\t\t¥18.80\t食品酒水\t微信");

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].type, "收入");
  assert.equal(result.rows[0].amountCents, 120000);
  assert.equal(result.rows[0].date, "2026-09-01");
  assert.equal(result.rows[1].type, "支出");
  assert.equal(result.rows[1].amountCents, 1880);
});

test("女生记账 CSV accepts 收入/支出, separates ledgers, skips balance rows, and keeps source lines", () => {
  const runtime = createRuntime();
  const csv = "日期,收入/支出,金额,类别,备注,\n\n账本：2020十一,\n\n\t2024年9月4日\t,支出,30.00,生活,按摩,\n余额,30.00,\n账本：20240223,\n2024年9月5日,收入,70.00,生活费,,\n2024年9月6日,支出,0.00,生活,无消费记录,";
  const parsed = runtime.run(`normalizeExternalRows(parseExternalCsv(${JSON.stringify(csv)}))`);

  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows[0].sourceRow, 5);
  assert.equal(parsed.rows[0].date, "2024-09-04");
  assert.equal(parsed.rows[0].type, "支出");
  assert.equal(parsed.rows[0].category, "生活");
  assert.equal(parsed.rows[0].note, "按摩");
  assert.equal(parsed.rows[0].bookName, "2020十一");
  assert.equal(parsed.rows[1].sourceRow, 8);
  assert.equal(parsed.rows[1].type, "收入");
  assert.equal(parsed.rows[1].bookName, "20240223");
  assert.equal(parsed.rows[2].amountCents, 0);
  assert.equal(parsed.bookBalances["2020十一"], 3000);
  assert.equal(runtime.run(`groupExternalImportRows(${JSON.stringify(parsed.rows)}).size`), 2);
  assert.equal(runtime.run(`externalImportBookName("女生记账", "bill(1).csv", ${JSON.stringify(csv)})`), "女生记账导入");
});

test("external CSV parser records invalid rows and skips incomplete transfers", () => {
  const runtime = createRuntime();
  const result = normalize(runtime, "日期,类型,金额,账户,转入账户\n2026-09-20,支出,10,现金,\n坏日期,收入,20,银行卡,\n2026-09-22,转账,30,银行卡,");

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountCents, 1000);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message + result.issues[1].message, /日期无法识别|转账缺少/);
});

test("external CSV parser rejects files without date and amount columns", () => {
  const runtime = createRuntime();
  assert.throws(() => runtime.run(`normalizeExternalRows(parseExternalCsv("分类,备注\\n餐饮,午餐"))`), /csv_columns_missing/);
});

test("external CSV parser detects semicolon delimiters", () => {
  const runtime = createRuntime();
  const result = normalize(runtime, "日期;类型;金额;分类\n2026-09-20;收入;100;工资");
  assert.equal(result.rows[0].type, "收入");
  assert.equal(result.rows[0].amountCents, 10000);
});
