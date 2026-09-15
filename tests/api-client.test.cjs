const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function installFormDom(runtime) {
  runtime.run(`(() => {
    const ids = [
      "bookName", "bookCategory", "bookSaveBtn", "bookCancelBtn", "bookMsg",
      "accName", "accKind", "accInitial", "accSaveBtn", "accCancelBtn", "accMsg"
    ];
    const elements = Object.fromEntries(ids.map(id => [id, {
      value: "",
      textContent: "",
      style: { display: "" },
      classList: { toggle() {} }
    }]));
    globalThis.document = { getElementById: id => elements[id] };
    globalThis.renderBookSelect = () => {};
    globalThis.renderBookList = () => {};
    globalThis.renderAccountSelects = () => {};
    globalThis.fillCategoryFilter = () => {};
    globalThis.updateFormFields = () => {};
    globalThis.renderOverview = () => {};
    globalThis.render = () => {};
    globalThis.resetForm = () => {};
    globalThis.clearTimeout = () => {};
    globalThis.setTimeout = () => 0;
    globalThis.formElements = elements;
  })()`);
}

function installRecordDom(runtime) {
  runtime.run(`(() => {
    const ids = [
      "amount", "note", "date", "accountSel", "toAccountSel", "depositTarget",
      "depositLinkSel", "depositFinal", "saveBtn", "cancelBtn", "formMsg",
      "typeCustomBox", "categoryCustomBox", "typeChips", "categoryChips",
      "toAccountField", "depositDirField", "depositTargetField", "depositLinkField",
      "depositFinalField", "depositDirChips", "depositSettlementHint",
      "bookName", "bookCategory", "bookSaveBtn", "bookCancelBtn", "bookMsg",
      "accName", "accKind", "accInitial", "accSaveBtn", "accCancelBtn", "accMsg"
    ];
    const elements = Object.fromEntries(ids.map(id => [id, {
      value: "",
      textContent: "",
      innerHTML: "",
      checked: false,
      style: { display: "" },
      classList: { toggle() {} },
      options: []
    }]));
    globalThis.document = { getElementById: id => elements[id] };
    globalThis.renderTypeChips = () => {};
    globalThis.renderCategoryChips = () => {};
    globalThis.updateFormFields = () => {};
    globalThis.render = () => {};
    globalThis.renderBookSelect = () => {};
    globalThis.renderBookList = () => {};
    globalThis.renderAccountSelects = () => {};
    globalThis.fillCategoryFilter = () => {};
    globalThis.resetAccountForm = () => {};
    globalThis.resetBookForm = () => {};
    globalThis.clearTimeout = () => {};
    globalThis.setTimeout = () => 0;
    globalThis.formElements = elements;
  })()`);
}

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

test("backendApi uses UUID-safe write paths for books and accounts", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    };
  })()`);

  await runtime.run(`Promise.all([
    backendApi.createBook({ name: "家庭账", group_name: "个人" }),
    backendApi.createAccount("book/with space", { name: "现金", kind: "asset", initial_cents: 1234 }),
    backendApi.updateBook("book/with space", { name: "新账本", group_name: "工作" }),
    backendApi.updateAccount("book/with space", "account/one", { name: "卡", kind: "liability", initial_cents: 0 })
  ])`);
  const calls = runtime.run("window.calls");
  assert.equal(JSON.stringify(calls.map(call => [call.url, call.options.method])), JSON.stringify([
    ["/api/books", "POST"],
    ["/api/books/book%2Fwith%20space/accounts", "POST"],
    ["/api/books/book%2Fwith%20space", "PATCH"],
    ["/api/books/book%2Fwith%20space/accounts/account%2Fone", "PATCH"]
  ]));
});

test("new ordinary record posts server option and account UUIDs", async () => {
  const runtime = createRuntime();
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.backendOptionsLoaded = true;
    dataState.backendRecordsLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    dataState.accounts = [{ id: "cash-1", name: "现金", kind: "资金", initial: 0, initialCents: 0 }];
    dataState.records = [];
    dataState.backendTypeIds = { "支出": "type-expense" };
    dataState.backendCategoryIds = { "餐饮": "category-food" };
    uiState.selectedType = "支出";
    uiState.selectedCategory = "餐饮";
    formElements.amount.value = "12.34";
    formElements.note.value = "午餐";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "cash-1";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/records")) return { ok: true, json: async () => ({
        id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
        account_id: "cash-1", to_account_id: null, amount_cents: 1234,
        occurred_on: "2026-09-15", note: "午餐", deposit_direction: null,
        deposit_target: null, deposit_link_id: null, deposit_final: false
      }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 1234, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 1234, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("handleSave()");
  const calls = runtime.run("window.calls");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, "/api/books/book-1/records");
  assert.equal(payload.type_id, "type-expense");
  assert.equal(payload.category_id, "category-food");
  assert.equal(payload.account_id, "cash-1");
  assert.equal(payload.amount_cents, 1234);
  assert.equal(runtime.run("dataState.records[0].id"), "record-1");
  assert.equal(runtime.run("dataState.records[0].type"), "支出");
});

test("new deposit record maps direction and linked server record", async () => {
  const runtime = createRuntime();
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.backendOptionsLoaded = true;
    dataState.backendRecordsLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    dataState.accounts = [{ id: "cash-1", name: "现金", kind: "资金", initial: 0, initialCents: 0 }];
    dataState.records = [{ id: "record-original", type: "押金", amount: 1000, amountCents: 100000,
      category: "居住", note: "租房押金", date: "2026-09-01", account: "cash-1", toAccount: null,
      depositDir: "付", depositTarget: "房东", depositLinkId: null, depositFinal: false }];
    dataState.backendTypeIds = { "押金": "type-deposit" };
    dataState.backendCategoryIds = { "居住": "category-home" };
    uiState.selectedType = "押金";
    uiState.selectedCategory = "居住";
    uiState.selectedDepositDir = "退回";
    formElements.amount.value = "700";
    formElements.note.value = "退回押金";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "cash-1";
    formElements.depositTarget.value = "房东";
    formElements.depositLinkSel.value = "record-original";
    formElements.depositFinal.checked = true;
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/records")) return { ok: true, json: async () => ({
        id: "record-return", book_id: "book-1", type_id: "type-deposit", category_id: "category-home",
        account_id: "cash-1", to_account_id: null, amount_cents: 70000,
        occurred_on: "2026-09-15", note: "退回押金", deposit_direction: "returned_to_me",
        deposit_target: "房东", deposit_link_id: "record-original", deposit_final: true
      }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 30000, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 30000, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("handleSave()");
  const payload = JSON.parse(runtime.run("window.calls[0].options.body"));
  assert.equal(payload.deposit_direction, "returned_to_me");
  assert.equal(payload.deposit_link_id, "record-original");
  assert.equal(payload.deposit_final, true);
  assert.equal(runtime.run("dataState.records[1].depositDir"), "退回");
});

test("record write failure restores local accounts before local fallback", async () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 1, name: "本地账本", category: "个人" }]),
    jizhangben_current_book: JSON.stringify(1),
    jizhangben_records_1: JSON.stringify([]),
    jizhangben_accounts_1: JSON.stringify([{ id: 7, name: "现金", kind: "资金", initial: 0 }])
  });
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.backendOptionsLoaded = true;
    dataState.backendRecordsLoaded = true;
    dataState.currentBookId = "server-book";
    dataState.books = [{ id: "server-book", name: "本地账本", category: "个人" }];
    dataState.accounts = [{ id: "server-cash", name: "现金", kind: "资金", initial: 0, initialCents: 0 }];
    dataState.records = [];
    dataState.backendTypeIds = { "支出": "type-expense" };
    dataState.backendCategoryIds = { "餐饮": "category-food" };
    uiState.selectedType = "支出";
    uiState.selectedCategory = "餐饮";
    formElements.amount.value = "8";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "server-cash";
    window.fetch = async () => { throw new Error("offline"); };
  })()`);

  await runtime.run("handleSave()");
  assert.equal(runtime.run("dataState.backendBooksLoaded"), false);
  assert.equal(runtime.run("dataState.currentBookId"), 1);
  assert.equal(runtime.run("dataState.records[0].account"), 7);
  assert.match(runtime.run("document.getElementById('formMsg').textContent"), /服务端不可用/);
});

test("new book and account use backend responses when backend reads are active", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.books = [{ id: "server-book", name: "原账本", category: "个人" }];
    dataState.currentBookId = "server-book";
    dataState.accounts = [];
    formElements.bookName.value = "旅行账本";
    formElements.bookCategory.value = "生活";
    formElements.accName.value = "旅行卡";
    formElements.accKind.value = "资金";
    formElements.accInitial.value = "12.34";
    window.requests = [];
    window.fetch = async (url, options) => {
      window.requests.push({ url, options });
      if (url.endsWith("/books")) return { ok: true, json: async () => ({
        id: "uuid-book", name: "旅行账本", group_name: "生活", warnings: []
      }) };
      if (url.endsWith("/overview")) return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "server-book", name: "原账本", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 0 },
          { id: "uuid-book", name: "旅行账本", group_name: "生活", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
      return { ok: true, json: async () => ({
        id: "uuid-account", book_id: "server-book", name: "旅行卡", kind: "asset",
        initial_cents: 1234
      }) };
    };
  })()`);

  await runtime.run("handleBookSave()");
  await runtime.run("handleAccountSave()");
  const books = runtime.run("dataState.books");
  const accounts = runtime.run("dataState.accounts");
  const requests = runtime.run("window.requests");
  assert.equal(books.some(book => book.id === "uuid-book"), true);
  assert.equal(accounts[0].id, "uuid-account");
  assert.equal(accounts[0].initialCents, 1234);
  assert.equal(JSON.stringify(requests.map(request => [request.url, request.options.method])), JSON.stringify([
    ["/api/books", "POST"],
    ["/api/overview", null],
    ["/api/books/server-book/accounts", "POST"],
    ["/api/overview", null]
  ]));
});

test("backend write failure restores local storage before saving a new book locally", async () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 1, name: "本地账本", category: "个人" }]),
    jizhangben_current_book: JSON.stringify(1)
  });
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.books = [{ id: "server-book", name: "服务端账本", category: "个人" }];
    dataState.currentBookId = "server-book";
    formElements.bookName.value = "本地新增";
    formElements.bookCategory.value = "生活";
    window.fetch = async () => { throw new Error("offline"); };
  })()`);

  await runtime.run("handleBookSave()");
  const books = runtime.run("dataState.books");
  assert.equal(dataStateOr(runtime, "dataState.backendBooksLoaded"), false);
  assert.equal(books.some(book => book.name === "本地账本"), true);
  assert.equal(books.some(book => book.name === "本地新增"), true);
  assert.match(runtime.run("formElements.bookMsg.textContent"), /服务端不可用/);
});

function dataStateOr(runtime, expression) {
  return runtime.run(expression);
}

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
