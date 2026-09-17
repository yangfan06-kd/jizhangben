const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function installFormDom(runtime) {
  runtime.run(`(() => {
    const ids = [
      "bookName", "bookCategory", "bookSaveBtn", "bookCancelBtn", "bookMsg",
      "accName", "accKind", "accInitial", "accSaveBtn", "accCancelBtn", "accMsg",
      "authStatus", "authOpenBtn", "authLogoutBtn", "authPanel", "authTitle", "authCloseBtn",
      "authLoginTab", "authRegisterTab", "authNameField", "authEmail", "authDisplayName",
      "authPassword", "authPasswordHint", "authConfirmField", "authPasswordConfirm",
      "authSubmitBtn", "authMsg", "startupNotice", "ledgerApp", "authEntryHint"
    ];
    const elements = Object.fromEntries(ids.map(id => [id, {
      value: "",
      textContent: "",
      style: { display: "" },
      hidden: false,
      disabled: false,
      focus() {},
      classList: { toggle() {}, add() {}, remove() {} }
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
    globalThis.confirm = () => true;
    globalThis.formElements = elements;
  })()`);
}

function installRecordDom(runtime) {
  runtime.run(`(() => {
    const ids = [
      "amount", "note", "date", "accountSel", "toAccountSel", "depositTarget",
      "depositLinkSel", "depositFinal", "saveBtn", "cancelBtn", "formMsg",
      "customInput", "customOk",
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
      dataset: {},
      checked: false,
      style: { display: "" },
      classList: { toggle() {}, add() {}, remove() {} },
      options: [],
      appendChild() {},
      querySelectorAll() { return []; }
    }]));
    globalThis.document = {
      getElementById: id => elements[id],
      createElement: () => ({
        className: "",
        textContent: "",
        dataset: {},
        classList: { add() {}, remove() {} },
        appendChild() {}
      })
    };
    globalThis.renderTypeChips = () => {};
    globalThis.renderCategoryChips = () => {};
    globalThis.updateFormFields = () => {};
    globalThis.render = () => {};
    globalThis.renderBookSelect = () => {};
    globalThis.renderBookList = () => {};
    globalThis.renderAccountSelects = () => {};
    globalThis.fillCategoryFilter = () => {};
    globalThis.refreshDetail = () => {};
    globalThis.resetAccountForm = () => {};
    globalThis.resetBookForm = () => {};
    globalThis.clearTimeout = () => {};
    globalThis.setTimeout = () => 0;
    globalThis.confirm = () => true;
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

test("backendApi explains a successful HTML response instead of exposing a JSON parse error", async () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    window.fetch = async () => ({
      ok: true,
      headers: { get: name => name === "content-type" ? "text/html" : "" },
      json: async () => { throw new SyntaxError("Unexpected token '<'"); }
    });
  })()`);

  await assert.rejects(
    () => runtime.run("backendApi.register({ email: 'new@example.com' })"),
    error => error.code === "invalid_json_response" && /接口返回了网页/.test(error.message)
  );
});

test("local detail search includes the deposit counterpart", () => {
  const runtime = createRuntime();
  runtime.run(`(() => {
    filterState.searchKey = "房东";
  })()`);
  assert.equal(runtime.run(`matchesSearch({
    note: "押金测试", depositTarget: "房东", category: "居住", type: "押金"
  })`), true);
  assert.equal(runtime.run(`matchesSearch({
    note: "押金测试", depositTarget: "中介", category: "居住", type: "押金"
  })`), false);
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

test("custom categories created in an authenticated page sync to the backend", async () => {
  const runtime = createRuntime();
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "authenticated";
    dataState.backendOptionsLoaded = true;
    window.fetch = async (url, options) => {
      window.customRequest = { url, options };
      return { ok: true, status: 201, json: async () => ({
        id: "category-travel", name: "旅行", is_system: false
      }) };
    };
    formElements.customInput.value = "旅行";
  })()`);

  await runtime.run("addCustom('category')");
  assert.equal(runtime.run("window.customRequest.url"), "/api/categories");
  assert.equal(runtime.run("window.customRequest.options.method"), "POST");
  assert.equal(runtime.run("JSON.parse(window.customRequest.options.body).name"), "旅行");
  assert.equal(JSON.stringify(runtime.run("dataState.customCategories")), JSON.stringify(["旅行"]));
  assert.equal(runtime.run("dataState.backendCategoryIds['旅行']"), "category-travel");
});

test("custom record types created in an authenticated page sync behavior and UUID", async () => {
  const runtime = createRuntime();
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "authenticated";
    dataState.backendOptionsLoaded = true;
    uiState.customTypeSideDraft = "income";
    window.fetch = async (url, options) => {
      window.customRequest = { url, options };
      return { ok: true, status: 201, json: async () => ({
        id: "type-salary", code: "custom-salary", name: "工资", behavior: "income", is_system: false
      }) };
    };
    formElements.customInput.value = "工资";
  })()`);

  await runtime.run("addCustom('type')");
  const payload = runtime.run("JSON.parse(window.customRequest.options.body)");
  assert.equal(runtime.run("window.customRequest.url"), "/api/record-types");
  assert.equal(payload.behavior, "income");
  assert.equal(payload.name, "工资");
  assert.match(payload.code, /^custom-/);
  assert.equal(runtime.run("dataState.backendTypeIds['工资']"), "type-salary");
  assert.equal(runtime.run("dataState.customTypes[0].side"), "income");
});

test("deleting a synced custom category archives it on the backend", async () => {
  const runtime = createRuntime();
  installRecordDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "authenticated";
    dataState.backendOptionsLoaded = true;
    dataState.customCategories = ["旅行"];
    dataState.backendCategoryIds = { "旅行": "category-travel" };
    window.fetch = async (url, options) => {
      window.deleteRequest = { url, options };
      return { ok: true, status: 204, json: async () => null };
    };
  })()`);

  await runtime.run("removeCustom('category', '旅行')");
  assert.equal(runtime.run("window.deleteRequest.url"), "/api/categories/category-travel");
  assert.equal(runtime.run("window.deleteRequest.options.method"), "DELETE");
  assert.equal(JSON.stringify(runtime.run("dataState.customCategories")), "[]");
  assert.equal(runtime.run("dataState.backendCategoryIds['旅行']"), undefined);
});

test("auth form login accepts an authenticated user with no server books yet", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    formElements.authEmail.value = "learner@example.com";
    formElements.authPassword.value = "correct-horse-battery";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/auth/login")) return { ok: true, json: async () => ({
        id: "user-1", email: "learner@example.com", display_name: "学习者"
      }) };
      if (url.endsWith("/books")) return { ok: true, json: async () => ({ items: [] }) };
      if (url.endsWith("/categories")) return { ok: true, json: async () => ({ items: [
        { id: "category-food", name: "餐饮", is_system: true }
      ] }) };
      if (url.endsWith("/record-types")) return { ok: true, json: async () => ({ items: [
        { id: "type-expense", code: "expense", name: "支出", behavior: "expense", is_system: true }
      ] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [],
        totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("submitAuth()");
  assert.equal(runtime.run("dataState.authStatus"), "authenticated");
  assert.equal(runtime.run("dataState.authUser.id"), "user-1");
  assert.equal(runtime.run("dataState.backendBooksLoaded"), true);
  assert.equal(runtime.run("dataState.books.length"), 0);
  assert.equal(runtime.run("document.getElementById('authPanel').hidden"), true);
});

test("login offers local data migration before accepting an empty server account", async () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 1, name: "本地账本", category: "个人" }]),
    jizhangben_current_book: "1",
    jizhangben_records_1: JSON.stringify([{ id: 2, type: "支出", amountCents: 123, category: "餐饮" }]),
    jizhangben_schema_version: "2"
  });
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    formElements.authEmail.value = "learner@example.com";
    formElements.authPassword.value = "correct-horse-battery";
    window.calls = [];
    startBackendReadHydration = async () => true;
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/auth/login")) return { ok: true, json: async () => ({
        id: "user-1", email: "learner@example.com", display_name: "学习者"
      }) };
      if (url.endsWith("/books")) return { ok: true, json: async () => ({ items: [] }) };
      if (url.endsWith("/backups/preview-local")) return { ok: true, json: async () => ({
        counts: { books: 1, records: 1, accounts: 7 },
        totals: { income_cents: 0, expense_cents: 123, net_worth_cents: -123 },
        books: []
      }) };
      if (url.endsWith("/backups/import-local")) return { ok: true, json: async () => ({ imported: {
        books: 1, records: 1, accounts: 7
      } }) };
      throw new Error("unexpected request: " + url);
    };
  })()`);

  await runtime.run("submitAuth()");
  assert.deepEqual(JSON.parse(runtime.run("JSON.stringify(window.calls.map(call => call.url))")), [
    "/api/auth/login",
    "/api/books",
    "/api/backups/preview-local",
    "/api/backups/import-local"
  ]);
  assert.equal(runtime.run("dataState.authStatus"), "authenticated");
  assert.equal(runtime.run("JSON.parse(window.calls[3].options.body).format"), "jizhangben-backup");
});

test("HTTP entry hides the ledger until authentication succeeds", () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "guest";
    dataState.authUser = null;
    renderAuthStatus();
  })()`);

  assert.equal(runtime.run("document.getElementById('ledgerApp').hidden"), true);
  assert.equal(runtime.run("document.getElementById('authPanel').hidden"), false);
  assert.equal(runtime.run("document.getElementById('authEntryHint').hidden"), false);
  assert.equal(runtime.run("document.getElementById('authCloseBtn').hidden"), true);

  runtime.run(`(() => {
    dataState.authStatus = "authenticated";
    dataState.authUser = { id: "user-1", display_name: "学习者" };
    renderAuthStatus();
  })()`);
  assert.equal(runtime.run("document.getElementById('ledgerApp').hidden"), false);
  assert.equal(runtime.run("document.getElementById('authPanel').hidden"), true);
});

test("registration validates password confirmation before sending credentials", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    setAuthMode("register");
    formElements.authEmail.value = "new-user@example.com";
    formElements.authDisplayName.value = "新用户";
    formElements.authPassword.value = "correct-horse-battery";
    formElements.authPasswordConfirm.value = "different-password";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      return { ok: true, json: async () => ({ id: "user-1", display_name: "新用户" }) };
    };
  })()`);

  await runtime.run("submitAuth()");
  assert.equal(runtime.run("window.calls.length"), 0);
  assert.match(runtime.run("document.getElementById('authMsg').textContent"), /密码不一致/);

  runtime.run("formElements.authPasswordConfirm.value = 'correct-horse-battery'; startBackendReadHydration = async () => false;");
  await runtime.run("submitAuth()");
  assert.equal(runtime.run("window.calls.length"), 1);
  assert.equal(JSON.parse(runtime.run("window.calls[0].options.body")).password_confirm, undefined);
  assert.equal(runtime.run("dataState.authStatus"), "authenticated");
});

test("an expired backend session returns the page to the login gate", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "authenticated";
    dataState.authUser = { id: "user-1", display_name: "学习者" };
    window.restored = false;
    restoreLocalStateFromStorage = () => { window.restored = true; };
    window.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: "authentication_required", message: "登录状态已失效，请重新登录" })
    });
  })()`);

  await assert.rejects(
    () => runtime.run("backendApi.getJSON('/books')"),
    error => error.status === 401 && error.code === "authentication_required"
  );
  assert.equal(runtime.run("dataState.authStatus"), "guest");
  assert.equal(runtime.run("dataState.authUser"), null);
  assert.equal(runtime.run("window.restored"), false);
  assert.match(runtime.run("uiState.startupNotice"), /登录状态已过期/);
  assert.equal(runtime.run("document.getElementById('ledgerApp').hidden"), true);
  assert.equal(runtime.run("document.getElementById('authPanel').hidden"), false);
});

test("a successful login keeps the user visible when server data is temporarily unavailable", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    formElements.authEmail.value = "learner@example.com";
    formElements.authPassword.value = "correct-horse-battery";
    startBackendReadHydration = async () => false;
    window.fetch = async () => ({ ok: true, json: async () => ({
      id: "user-1", email: "learner@example.com", display_name: "学习者"
    }) });
  })()`);

  await runtime.run("submitAuth()");
  assert.equal(runtime.run("dataState.authStatus"), "authenticated");
  assert.equal(runtime.run("dataState.authUser.id"), "user-1");
  assert.equal(runtime.run("document.getElementById('startupNotice').hidden"), false);
  assert.match(runtime.run("uiState.startupNotice"), /服务端账本暂时无法读取/);
});

test("logout clears the session state and returns to the login gate", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.authStatus = "authenticated";
    dataState.authUser = { id: "user-1", display_name: "学习者" };
    window.restored = false;
    restoreLocalStateFromStorage = () => { window.restored = true; };
    window.fetch = async () => ({ ok: true, status: 204, json: async () => null });
  })()`);

  await runtime.run("logoutAuth()");
  assert.equal(runtime.run("dataState.authStatus"), "guest");
  assert.equal(runtime.run("dataState.authUser"), null);
  assert.equal(runtime.run("window.restored"), false);
  assert.equal(runtime.run("document.getElementById('authOpenBtn').hidden"), false);
  assert.equal(runtime.run("document.getElementById('authLogoutBtn').hidden"), true);
  assert.equal(runtime.run("document.getElementById('ledgerApp').hidden"), true);
  assert.equal(runtime.run("document.getElementById('authPanel').hidden"), false);
  assert.match(runtime.run("uiState.startupNotice"), /已退出登录/);
});

test("editing a server book uses PATCH and refreshes the overview", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    uiState.editingBookId = "book-1";
    formElements.bookName.value = "家庭账本";
    formElements.bookCategory.value = "家庭";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/books/book-1")) return { ok: true, json: async () => ({
        id: "book-1", name: "家庭账本", group_name: "家庭", warnings: []
      }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "家庭账本", group_name: "家庭", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("handleBookSave()");
  const calls = runtime.run("window.calls");
  assert.equal(calls[0].url, "/api/books/book-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: "家庭账本", group_name: "家庭" });
  assert.equal(runtime.run("dataState.books[0].name"), "家庭账本");
  assert.match(runtime.run("document.getElementById('bookMsg').textContent"), /服务端/);
});

test("deleting a server book uses DELETE", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [
      { id: "book-1", name: "日常账本", category: "个人" },
      { id: "book-2", name: "旅行账本", category: "旅行" }
    ];
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/books/book-2") && options.method === "DELETE") return {
        ok: true, status: 204, json: async () => { throw new Error("no content"); }
      };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("deleteBook('book-2')");
  const calls = runtime.run("window.calls");
  assert.equal(calls[0].url, "/api/books/book-2");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(runtime.run("dataState.books.length"), 1);
  assert.equal(runtime.run("uiState.bookDeleteInFlight"), false);
});

test("editing a server account uses PATCH and refreshes the overview", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    dataState.accounts = [{ id: "account-1", name: "现金", kind: "资金", initial: 10, initialCents: 1000 }];
    uiState.editingAccountId = "account-1";
    formElements.accName.value = "工资卡";
    formElements.accKind.value = "资金";
    formElements.accInitial.value = "20.50";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/accounts/account-1")) return { ok: true, json: async () => ({
        id: "account-1", book_id: "book-1", name: "工资卡", kind: "asset", initial_cents: 2050
      }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 2050 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 2050 }
      }) };
    };
  })()`);

  await runtime.run("handleAccountSave()");
  const calls = runtime.run("window.calls");
  assert.equal(calls[0].url, "/api/books/book-1/accounts/account-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: "工资卡", kind: "asset", initial_cents: 2050 });
  assert.equal(runtime.run("dataState.accounts[0].name"), "工资卡");
  assert.equal(runtime.run("dataState.accounts[0].initialCents"), 2050);
});

test("deleting a server account uses DELETE and refreshes records", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.backendRecordsLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    dataState.accounts = [{ id: "account-1", name: "现金", kind: "资金", initial: 0, initialCents: 0 }];
    dataState.records = [{ id: "record-1", type: "支出", amount: 1, amountCents: 100,
      category: "餐饮", note: "午餐", date: "2026-09-15", account: "account-1", toAccount: null,
      depositDir: null, depositTarget: null, depositLinkId: null, depositFinal: false }];
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/accounts/account-1") && options.method === "DELETE") return {
        ok: true, status: 204, json: async () => { throw new Error("no content"); }
      };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("deleteAccount('account-1')");
  const calls = runtime.run("window.calls");
  assert.equal(calls[0].url, "/api/books/book-1/accounts/account-1");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(runtime.run("dataState.accounts.length"), 0);
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("uiState.accountDeleteInFlight"), false);
});

test("server book conflicts stay visible instead of falling back locally", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "book-1";
    dataState.books = [{ id: "book-1", name: "日常账本", category: "个人" }];
    uiState.editingBookId = "book-1";
    formElements.bookName.value = "日常账本";
    formElements.bookCategory.value = "个人";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      return { ok: false, json: async () => ({ code: "book_not_found", message: "当前账本不存在" }) };
    };
  })()`);

  await runtime.run("handleBookSave()");
  assert.equal(runtime.run("dataState.books[0].name"), "日常账本");
  assert.equal(runtime.run("uiState.bookSaveInFlight"), false);
  assert.equal(runtime.run("document.getElementById('bookMsg').textContent"), "当前账本不存在");
  assert.equal(runtime.run("window.calls.length"), 1);
});

test("account edit network failure restores local account IDs before fallback", async () => {
  const runtime = createRuntime({
    jizhangben_books: JSON.stringify([{ id: 1, name: "本地账本", category: "个人" }]),
    jizhangben_current_book: JSON.stringify(1),
    jizhangben_accounts_1: JSON.stringify([{ id: 7, name: "现金", kind: "资金", initial: 10 }])
  });
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.currentBookId = "server-book";
    dataState.books = [{ id: "server-book", name: "本地账本", category: "个人" }];
    dataState.accounts = [{ id: "server-account", name: "现金", kind: "资金", initial: 10, initialCents: 1000 }];
    uiState.editingAccountId = "server-account";
    formElements.accName.value = "工资卡";
    formElements.accKind.value = "资金";
    formElements.accInitial.value = "20.50";
    window.fetch = async () => { throw new Error("offline"); };
  })()`);

  await runtime.run("handleAccountSave()");
  assert.equal(runtime.run("dataState.backendBooksLoaded"), false);
  assert.equal(runtime.run("dataState.currentBookId"), 1);
  assert.equal(runtime.run("dataState.accounts[0].id"), 7);
  assert.equal(runtime.run("dataState.accounts[0].name"), "工资卡");
  assert.match(runtime.run("document.getElementById('accMsg').textContent"), /服务端不可用/);
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
      if (url.endsWith("/records") && options && options.method === "POST") return { ok: true, json: async () => ({
        id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
        account_id: "cash-1", to_account_id: null, amount_cents: 1234,
        occurred_on: "2026-09-15", note: "午餐", deposit_direction: null,
        deposit_target: null, deposit_link_id: null, deposit_final: false
      }) };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [
        { id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
          type_name: "支出", category_name: "餐饮", account_id: "cash-1", to_account_id: null,
          amount_cents: 1234, occurred_on: "2026-09-15", note: "午餐", deposit_direction: null,
          deposit_target: null, deposit_link_id: null, deposit_final: false }
      ] }) };
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
  assert.equal(JSON.stringify(calls.map(call => [call.url, call.options.method])), JSON.stringify([
    ["/api/books/book-1/records", "POST"],
    ["/api/books/book-1/records", undefined],
    ["/api/overview", undefined]
  ]));
});

test("repeated record save clicks send only one backend request", async () => {
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
    formElements.amount.value = "5";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "cash-1";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/records") && options && options.method === "POST") return { ok: true, json: async () => ({
        id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
        account_id: "cash-1", to_account_id: null, amount_cents: 500,
        occurred_on: "2026-09-15", note: "", deposit_direction: null,
        deposit_target: null, deposit_link_id: null, deposit_final: false
      }) };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [
        { id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
          type_name: "支出", category_name: "餐饮", account_id: "cash-1", to_account_id: null,
          amount_cents: 500, occurred_on: "2026-09-15", note: "", deposit_direction: null,
          deposit_target: null, deposit_link_id: null, deposit_final: false }
      ] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 500, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 500, net_worth_cents: 0 }
      }) };
    };
  })()`);

  const firstSave = runtime.run("handleSave()");
  await runtime.run("handleSave()");
  assert.equal(runtime.run("window.calls.filter(call => call.options && call.options.method === 'POST').length"), 1);
  assert.match(runtime.run("document.getElementById('formMsg').textContent"), /正在保存/);
  await firstSave;
  assert.equal(runtime.run("dataState.records.length"), 1);
});

test("backend record conflict stays visible instead of falling back locally", async () => {
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
    formElements.amount.value = "8";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "cash-1";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      return { ok: false, json: async () => ({
        code: "deposit_link_not_found", message: "当前账本中不存在对应的原押金"
      }) };
    };
  })()`);

  await runtime.run("handleSave()");
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("dataState.backendBooksLoaded"), true);
  assert.equal(runtime.run("uiState.recordSaveStatus"), "conflict");
  assert.equal(runtime.run("document.getElementById('formMsg').textContent"), "当前账本中不存在对应的原押金");
  assert.equal(runtime.run("window.calls.length"), 1);
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
      if (url.endsWith("/records") && options && options.method === "POST") return { ok: true, json: async () => ({
        id: "record-return", book_id: "book-1", type_id: "type-deposit", category_id: "category-home",
        account_id: "cash-1", to_account_id: null, amount_cents: 70000,
        occurred_on: "2026-09-15", note: "退回押金", deposit_direction: "returned_to_me",
        deposit_target: "房东", deposit_link_id: "record-original", deposit_final: true
      }) };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [
        { id: "record-return", book_id: "book-1", type_id: "type-deposit", category_id: "category-home",
          type_name: "押金", category_name: "居住", account_id: "cash-1", to_account_id: null,
          amount_cents: 70000, occurred_on: "2026-09-15", note: "退回押金", deposit_direction: "returned_to_me",
          deposit_target: "房东", deposit_link_id: "record-original", deposit_final: true }
      ] }) };
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
  assert.equal(runtime.run("dataState.records.find(record => record.id === 'record-return').depositDir"), "退回");
});

test("editing a server record uses PUT and refreshes backend details", async () => {
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
    dataState.records = [{ id: "record-1", type: "支出", amount: 12.34, amountCents: 1234,
      category: "餐饮", note: "午餐", date: "2026-09-15", account: "cash-1", toAccount: null,
      depositDir: null, depositTarget: null, depositLinkId: null, depositFinal: false }];
    dataState.backendTypeIds = { "支出": "type-expense" };
    dataState.backendCategoryIds = { "餐饮": "category-food" };
    uiState.editingRecordId = "record-1";
    uiState.selectedType = "支出";
    uiState.selectedCategory = "餐饮";
    formElements.amount.value = "20.50";
    formElements.note.value = "晚餐";
    formElements.date.value = "2026-09-15";
    formElements.accountSel.value = "cash-1";
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/records/record-1") && options.method === "PUT") return { ok: true, json: async () => ({
        id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
        account_id: "cash-1", to_account_id: null, amount_cents: 2050,
        occurred_on: "2026-09-15", note: "晚餐", deposit_direction: null,
        deposit_target: null, deposit_link_id: null, deposit_final: false
      }) };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [
        { id: "record-1", book_id: "book-1", type_id: "type-expense", category_id: "category-food",
          type_name: "支出", category_name: "餐饮", account_id: "cash-1", to_account_id: null,
          amount_cents: 2050, occurred_on: "2026-09-15", note: "晚餐", deposit_direction: null,
          deposit_target: null, deposit_link_id: null, deposit_final: false }
      ] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 2050, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 2050, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("handleSave()");
  const calls = runtime.run("window.calls");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, "/api/books/book-1/records/record-1");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(payload.type_id, "type-expense");
  assert.equal(payload.category_id, "category-food");
  assert.equal(payload.amount_cents, 2050);
  assert.equal(runtime.run("dataState.records[0].amountCents"), 2050);
  assert.equal(runtime.run("dataState.records[0].note"), "晚餐");
  assert.equal(runtime.run("uiState.recordSaveStatus"), "success");
  assert.equal(JSON.stringify(calls.map(call => [call.url, call.options.method])), JSON.stringify([
    ["/api/books/book-1/records/record-1", "PUT"],
    ["/api/books/book-1/records", undefined],
    ["/api/overview", undefined]
  ]));
});

test("deleting a server record uses DELETE and handles a 204 response", async () => {
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
    dataState.records = [{ id: "record-1", type: "支出", amount: 12.34, amountCents: 1234,
      category: "餐饮", note: "午餐", date: "2026-09-15", account: "cash-1", toAccount: null,
      depositDir: null, depositTarget: null, depositLinkId: null, depositFinal: false }];
    window.calls = [];
    window.fetch = async (url, options) => {
      window.calls.push({ url, options });
      if (url.endsWith("/records/record-1") && options.method === "DELETE") return {
        ok: true, status: 204, json: async () => { throw new Error("no content"); }
      };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "book-1", name: "日常账本", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("deleteRec('record-1')");
  const calls = runtime.run("window.calls");
  assert.equal(calls[0].url, "/api/books/book-1/records/record-1");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(runtime.run("dataState.records.length"), 0);
  assert.equal(runtime.run("uiState.recordSaveStatus"), "success");
  assert.equal(runtime.run("uiState.recordDeleteInFlight"), false);
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

test("creating the first server book activates it and reads seeded accounts", async () => {
  const runtime = createRuntime();
  installFormDom(runtime);
  runtime.run(`(() => {
    window.location = { protocol: "http:" };
    dataState.backendBooksLoaded = true;
    dataState.backendOptionsLoaded = true;
    dataState.books = [];
    dataState.currentBookId = null;
    dataState.accounts = [];
    dataState.records = [];
    formElements.bookName.value = "第一本账";
    formElements.bookCategory.value = "个人";
    window.requests = [];
    window.fetch = async (url, options) => {
      window.requests.push({ url, options });
      if (url.endsWith("/books") && options.method === "POST") return { ok: true, json: async () => ({
        id: "first-book", name: "第一本账", group_name: "个人", warnings: []
      }) };
      if (url.endsWith("/accounts")) return { ok: true, json: async () => ({ items: [
        { id: "seed-cash", book_id: "first-book", name: "现金", kind: "asset", initial_cents: 0 }
      ] }) };
      if (url.endsWith("/records")) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({
        period_from: "2026-09-01", period_to: "2026-09-15", items: [
          { id: "first-book", name: "第一本账", group_name: "个人", income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
        ], totals: { income_cents: 0, expense_cents: 0, net_worth_cents: 0 }
      }) };
    };
  })()`);

  await runtime.run("handleBookSave()");
  assert.equal(runtime.run("dataState.currentBookId"), "first-book");
  assert.equal(runtime.run("dataState.accounts[0].id"), "seed-cash");
  assert.equal(runtime.run("dataState.backendRecordsLoaded"), true);
  assert.equal(runtime.run("JSON.parse(window.localStorage.getItem('jizhangben_current_book'))"), "first-book");
  const requestPaths = runtime.run("window.requests.map(request => request.url)");
  assert.equal(requestPaths.includes("/api/books/first-book/accounts"), true);
  assert.equal(requestPaths.includes("/api/books/first-book/records"), true);
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
    dataState.authStatus = "authenticated";
    dataState.authUser = { id: "user-1", display_name: "学习者" };
  })()`);

  assert.equal(await runtime.run("startBackendReadHydration()"), false);
  assert.equal(JSON.stringify(runtime.run("dataState.books")), JSON.stringify([
    { id: 7, name: "本地账本", category: "个人" }
  ]));
  assert.equal(runtime.run("dataState.currentBookId"), 7);
  assert.equal(runtime.run("dataState.backendBooksLoaded"), false);
});
