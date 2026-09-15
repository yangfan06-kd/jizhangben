const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

test("backendApi disables requests when the page is opened as a local file", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("backendApi.baseUrl()"), null);
});

test("backendApi posts local migration JSON and preserves server error codes", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async (url, options) => {
      window.lastRequest = { url, options };
      return { ok: true, json: async () => ({ counts: {}, books: [], totals: {} }) };
    };
  })()`);

  const response = await runtime.run("backendApi.previewLocalBackup({ format: 'jizhangben-backup' })");
  const request = runtime.run("window.lastRequest");
  assert.equal(response.books.length, 0);
  assert.equal(request.url, "/api/backups/preview-local");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.options.body, JSON.stringify({ format: "jizhangben-backup" }));

  runtime.run(`window.fetch = async () => ({
    ok: false,
    json: async () => ({ code: "backup_invalid", message: "备份格式无效" })
  })`);
  await assert.rejects(
    () => runtime.run("backendApi.importLocalBackup({})"),
    error => error.code === "backup_invalid" && error.message === "备份格式无效"
  );
});

test("migration preview money formatting keeps cents exact", () => {
  const runtime = createRuntime();
  assert.equal(runtime.run("formatPreviewMoney(31200)"), "¥312.00");
  assert.equal(runtime.run("formatPreviewMoney(-500)"), "−¥5.00");
});

test("backendApi maps server books and accounts to the webpage shape", () => {
  const runtime = createRuntime();
  const book = runtime.run(`mapBackendBook({
    id: "book-1",
    name: "家庭账",
    group_name: "家庭"
  })`);
  const asset = runtime.run(`mapBackendAccount({
    id: "account-1",
    name: "银行卡",
    kind: "asset",
    initial_cents: 12345
  })`);
  const liability = runtime.run(`mapBackendAccount({
    id: "account-2",
    name: "信用卡",
    kind: "liability",
    initial_cents: 678
  })`);

  assert.equal(JSON.stringify(book), JSON.stringify({ id: "book-1", name: "家庭账", category: "家庭" }));
  assert.equal(asset.kind, "资金");
  assert.equal(asset.initial, 123.45);
  assert.equal(asset.initialCents, 12345);
  assert.equal(liability.kind, "负债");
});

test("backend option and record mappings preserve business behavior", () => {
  const runtime = createRuntime();
  const category = runtime.run(`mapBackendCategory({
    id: "category-1", name: "旅行", is_system: 0
  })`);
  const type = runtime.run(`mapBackendType({
    id: "type-1", code: "gift-income", name: "礼金",
    behavior: "income", is_system: 0
  })`);
  const record = runtime.run(`mapBackendRecord({
    id: "record-1", type_name: "支出", category_name: "餐饮",
    amount_cents: 1234, occurred_on: "2026-09-15", note: "午餐",
    account_id: "account-1", to_account_id: null,
    deposit_direction: null, deposit_target: null,
    deposit_link_id: null, deposit_final: 0
  })`);

  assert.equal(JSON.stringify(category), JSON.stringify({
    id: "category-1", name: "旅行", isSystem: false
  }));
  assert.equal(type.side, "income");
  assert.equal(record.amountCents, 1234);
  assert.equal(record.amount, 12.34);
  assert.equal(record.account, "account-1");
  assert.equal(record.depositDir, null);
});

test("hydrateBooksFromBackend replaces in-memory books only for a non-empty response", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async () => ({ ok: true, json: async () => ({ items: [
      { id: "server-book", name: "服务端账本", group_name: "工作" }
    ]}) });
    dataState.books = [{ id: 1, name: "本地账本", category: "个人" }];
    dataState.currentBookId = 1;
  })()`);

  assert.equal(await runtime.run("hydrateBooksFromBackend()"), true);
  assert.equal(JSON.stringify(runtime.run("dataState.books")), JSON.stringify([
    { id: "server-book", name: "服务端账本", category: "工作" }
  ]));
  assert.equal(runtime.run("dataState.currentBookId"), "server-book");
  assert.equal(runtime.run("dataState.backendBooksLoaded"), true);

  runtime.run(`window.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) })`);
  assert.equal(await runtime.run("hydrateBooksFromBackend()"), false);
  assert.equal(JSON.stringify(runtime.run("dataState.books")), JSON.stringify([
    { id: "server-book", name: "服务端账本", category: "工作" }
  ]));
});

test("hydrateAccountsFromBackend reads the selected server book", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "https:" };
    window.fetch = async (url) => ({ ok: true, json: async () => ({ items: [
      { id: "cash", name: "现金", kind: "asset", initial_cents: 5000 },
      { id: "card", name: "信用卡", kind: "liability", initial_cents: 1200 }
    ]}), url });
    dataState.currentBookId = "book/with space";
    dataState.backendBooksLoaded = true;
  })()`);

  assert.equal(await runtime.run("hydrateAccountsFromBackend()"), true);
  const accounts = runtime.run("dataState.accounts");
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].initialCents, 5000);
  assert.equal(accounts[1].kind, "负债");
});

test("hydrateOptionsFromBackend keeps only custom active options", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async (url) => {
      if (url.endsWith("/categories")) return { ok: true, json: async () => ({ items: [
        { id: "system-category", name: "餐饮", is_system: 1 },
        { id: "custom-category", name: "旅行", is_system: 0 }
      ]}) };
      return { ok: true, json: async () => ({ items: [
        { id: "system-type", code: "expense", name: "支出", behavior: "expense", is_system: 1 },
        { id: "custom-type", code: "gift-income", name: "礼金", behavior: "income", is_system: 0 }
      ]}) };
    };
  })()`);

  assert.equal(await runtime.run("hydrateOptionsFromBackend()"), true);
  assert.equal(JSON.stringify(runtime.run("dataState.customCategories")), JSON.stringify(["旅行"]));
  assert.equal(JSON.stringify(runtime.run("dataState.customTypes")), JSON.stringify([
    { name: "礼金", side: "income" }
  ]));
  assert.equal(runtime.run("dataState.backendOptionsLoaded"), true);
});

test("hydrateRecordsFromBackend converts server fields and deposit directions", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async () => ({ ok: true, json: async () => ({ items: [
      { id: "record-1", type_name: "押金", category_name: "居住",
        amount_cents: 70000, occurred_on: "2026-09-15", note: "退回",
        account_id: "cash", to_account_id: null, deposit_direction: "returned_to_me",
        deposit_target: "房东", deposit_link_id: "record-0", deposit_final: 1 }
    ]}) });
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
  })()`);

  assert.equal(await runtime.run("hydrateRecordsFromBackend()"), true);
  const record = runtime.run("dataState.records[0]");
  assert.equal(record.type, "押金");
  assert.equal(record.amount, 700);
  assert.equal(record.depositDir, "退回");
  assert.equal(record.depositLinkId, "record-0");
  assert.equal(runtime.run("dataState.backendRecordsLoaded"), true);
});

test("hydrateOverviewFromBackend stores server totals for the overview panel", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async () => ({ ok: true, json: async () => ({
      period_from: "2026-09-01",
      period_to: "2026-09-15",
      items: [{ id: "book-1", name: "日常账本", group_name: "个人",
        income_cents: 5000, expense_cents: 1200, net_worth_cents: 8800 }],
      totals: { income_cents: 5000, expense_cents: 1200, net_worth_cents: 8800 }
    }) });
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
  })()`);

  assert.equal(await runtime.run("hydrateOverviewFromBackend()"), true);
  const overview = runtime.run("dataState.backendOverview");
  assert.equal(overview.periodFrom, "2026-09-01");
  assert.equal(overview.items[0].netWorth, 88);
  assert.equal(overview.totals.expense, 12);
});

test("hydrateRecordsFromBackend rejects malformed items without replacing existing records", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async () => ({ ok: true, json: async () => ({ items: [
      { id: "broken", type_name: "支出", category_name: "餐饮", amount_cents: 0,
        occurred_on: "2026-09-15", note: "金额缺失" }
    ]}) });
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.records = [{ id: 1, type: "收入", amountCents: 100 }];
  })()`);

  assert.equal(await runtime.run("hydrateRecordsFromBackend()"), false);
  assert.equal(JSON.stringify(runtime.run("dataState.records")), JSON.stringify([
    { id: 1, type: "收入", amountCents: 100 }
  ]));
});

test("startBackendReadHydration restores the local snapshot when account loading fails", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    let callCount = 0;
    window.fetch = async () => {
      callCount += 1;
      if (callCount === 1) return { ok: true, json: async () => ({ items: [
        { id: "server-book", name: "服务端账本", group_name: "工作" }
      ]}) };
      if (callCount === 2) return { ok: true, json: async () => ({ items: [] }) };
      if (callCount === 3) return { ok: true, json: async () => ({ items: [] }) };
      throw new Error("account request failed");
    };
    dataState.books = [{ id: 7, name: "本地账本", category: "个人" }];
    dataState.currentBookId = 7;
    dataState.accounts = [{ id: 9, name: "现金", kind: "资金", initial: 0, initialCents: 0 }];
  })()`);

  assert.equal(await runtime.run("startBackendReadHydration()"), false);
  assert.equal(JSON.stringify(runtime.run("dataState.books")), JSON.stringify([
    { id: 7, name: "本地账本", category: "个人" }
  ]));
  assert.equal(runtime.run("dataState.currentBookId"), 7);
  assert.equal(runtime.run("dataState.backendBooksLoaded"), false);
});
