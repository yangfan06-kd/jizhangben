// 后端读取层：只负责请求和响应映射，不直接操作 DOM 或 localStorage。
// HTTP 页面登录后读取服务端数据；直接打开文件时继续由原有本地流程工作。

function notifyBackendAuthExpired(path, error) {
  // 登录接口自己的 401（例如密码错误）应该留在登录表单里，不要清理已有页面状态。
  if (!error || error.status !== 401 || String(path).startsWith("/auth/")) return;
  if (typeof handleBackendAuthExpired === "function") handleBackendAuthExpired();
}

async function readBackendJSON(response, path) {
  try {
    return await response.json();
  } catch (cause) {
    const contentType = response && response.headers && typeof response.headers.get === "function"
      ? String(response.headers.get("content-type") || "")
      : "";
    const error = new Error(contentType.includes("text/html")
      ? "后端地址配置错误：接口返回了网页，请检查 App 的服务地址"
      : "后端返回的数据不是有效 JSON，请检查服务是否正常运行");
    error.code = "invalid_json_response";
    error.path = path;
    error.cause = cause;
    throw error;
  }
}

const backendApi = {
  // 直接打开 index.html 时没有可用的同源 API；用 HTTP 服务打开时默认请求 /api。
  baseUrl() {
    if (typeof dataState !== "undefined" && dataState.offlineMode) return null;
    const configured = typeof window !== "undefined" && window.JIZHANGBEN_API_BASE_URL;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim().replace(/\/$/, "");
    }
    const protocol = typeof window !== "undefined" && window.location
      ? window.location.protocol
      : "";
    return (protocol === "http:" || protocol === "https:") ? "/api" : null;
  },

  async getJSON(path) {
    const base = this.baseUrl();
    if (!base) throw new Error("backend_disabled");
    const response = await window.fetch(base + path, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response || !response.ok) {
      let body = null;
      try { body = await response.json(); } catch (e) { /* ignore invalid error bodies */ }
      const error = new Error(body && body.message ? body.message : "backend_request_failed");
      error.code = body && body.code ? body.code : "backend_request_failed";
      if (response && response.status) error.status = response.status;
      notifyBackendAuthExpired(path, error);
      throw error;
    }
    return readBackendJSON(response, path);
  },

  async postJSON(path, payload, method = "POST") {
    const base = this.baseUrl();
    if (!base) throw new Error("backend_disabled");
    const response = await window.fetch(base + path, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response || !response.ok) {
      let body = null;
      try { body = await response.json(); } catch (e) { /* ignore invalid error bodies */ }
      const error = new Error(body && body.message ? body.message : "backend_request_failed");
      error.code = body && body.code ? body.code : "backend_request_failed";
      if (response && response.status) error.status = response.status;
      notifyBackendAuthExpired(path, error);
      throw error;
    }
    if (response.status === 204) return null;
    return readBackendJSON(response, path);
  },

  previewLocalBackup(payload) {
    return this.postJSON("/backups/preview-local", payload);
  },

  importLocalBackup(payload) {
    return this.postJSON("/backups/import-local", payload);
  },

  register(payload) {
    return this.postJSON("/auth/register", payload);
  },

  login(payload) {
    return this.postJSON("/auth/login", payload);
  },

  logout() {
    return this.postJSON("/auth/logout", {});
  },

  currentUser() {
    return this.getJSON("/auth/me");
  },

  createCategory(payload) {
    return this.postJSON("/categories", payload);
  },

  deleteCategory(categoryId) {
    return this.postJSON("/categories/" + encodeURIComponent(String(categoryId)), {}, "DELETE");
  },

  createRecordType(payload) {
    return this.postJSON("/record-types", payload);
  },

  deleteRecordType(typeId) {
    return this.postJSON("/record-types/" + encodeURIComponent(String(typeId)), {}, "DELETE");
  },

  createBook(payload) {
    return this.postJSON("/books", payload);
  },

  updateBook(bookId, payload) {
    return this.postJSON("/books/" + encodeURIComponent(String(bookId)), payload, "PATCH");
  },

  deleteBook(bookId) {
    return this.postJSON("/books/" + encodeURIComponent(String(bookId)), {}, "DELETE");
  },

  createAccount(bookId, payload) {
    const id = encodeURIComponent(String(bookId));
    return this.postJSON("/books/" + id + "/accounts", payload);
  },

  createRecord(bookId, payload) {
    const id = encodeURIComponent(String(bookId));
    return this.postJSON("/books/" + id + "/records", payload);
  },

  updateRecord(bookId, recordId, payload) {
    const book = encodeURIComponent(String(bookId));
    const record = encodeURIComponent(String(recordId));
    return this.postJSON("/books/" + book + "/records/" + record, payload, "PUT");
  },

  deleteRecord(bookId, recordId) {
    const book = encodeURIComponent(String(bookId));
    const record = encodeURIComponent(String(recordId));
    return this.postJSON("/books/" + book + "/records/" + record, {}, "DELETE");
  },

  updateAccount(bookId, accountId, payload) {
    const book = encodeURIComponent(String(bookId));
    const account = encodeURIComponent(String(accountId));
    return this.postJSON("/books/" + book + "/accounts/" + account, payload, "PATCH");
  },

  deleteAccount(bookId, accountId) {
    const book = encodeURIComponent(String(bookId));
    const account = encodeURIComponent(String(accountId));
    return this.postJSON("/books/" + book + "/accounts/" + account, {}, "DELETE");
  }
};

function backendWritesEnabled() {
  return !!(dataState.backendBooksLoaded && backendApi.baseUrl());
}

function backendRecordWritesEnabled() {
  return !!(
    dataState.backendBooksLoaded &&
    dataState.backendOptionsLoaded &&
    dataState.backendRecordsLoaded &&
    backendApi.baseUrl()
  );
}

// 服务端成功读取或写入后，把当前账号的完整快照留在设备 localStorage。
// 这份副本用于网络暂时不可用时的本地回退，不改变服务端作为跨设备同步来源的角色。
function persistBackendSnapshotLocally() {
  if (dataState.authStatus !== "authenticated" || !dataState.authUser) return false;
  try {
    saveBooks();
    appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
    saveCustomTypes();
    saveCustomCategories();
    if (dataState.currentBookId) {
      saveAccounts();
      save();
    }
    return true;
  } catch (error) {
    return false;
  }
}

function backendOptionId(map, name) {
  if (!map || !name) return null;
  const id = map[name];
  return (typeof id === "string" && id) ? id : null;
}

async function refreshBackendOverviewAfterWrite() {
  if (!dataState.backendBooksLoaded) return false;
  try {
    const loaded = await hydrateOverviewFromBackend();
    persistBackendSnapshotLocally();
    return loaded;
  } catch (error) {
    // 统计刷新失败不应抹掉刚刚已经成功写入的本地镜像。
    persistBackendSnapshotLocally();
    return false;
  }
}

async function refreshBackendRecordsAfterWrite() {
  if (!dataState.backendBooksLoaded || !dataState.currentBookId) return false;
  try {
    const loaded = await hydrateRecordsFromBackend();
    if (loaded) persistBackendSnapshotLocally();
    return loaded;
  } catch (error) {
    return false;
  }
}

function mapBackendBook(book) {
  return {
    id: book.id,
    name: book.name,
    category: book.group_name || "未分类"
  };
}

function mapBackendAccount(account) {
  const cents = Number(account.initial_cents);
  const initialCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  return {
    id: account.id,
    name: account.name,
    kind: account.kind === "liability" ? "负债" : "资金",
    initial: initialCents / 100,
    initialCents
  };
}

function mapBackendCategory(category) {
  return {
    id: category.id,
    name: category.name,
    isSystem: !!category.is_system
  };
}

function backendTypeSide(behavior) {
  if (behavior === "income") return "income";
  if (behavior === "expense") return "expense";
  return "neutral";
}

function mapBackendType(recordType) {
  return {
    id: recordType.id,
    code: recordType.code,
    name: recordType.name,
    behavior: recordType.behavior,
    side: backendTypeSide(recordType.behavior),
    isSystem: !!recordType.is_system
  };
}

const BACKEND_DEPOSIT_DIRS = {
  receive: "收",
  return_to_other: "退",
  pay: "付",
  returned_to_me: "退回"
};

function mapBackendRecord(record) {
  const cents = Number(record.amount_cents);
  const amountCents = Number.isFinite(cents) ? Math.round(cents) : 0;
  return {
    id: record.id,
    type: record.type_name || record.type_code || "",
    amount: amountCents / 100,
    amountCents,
    category: record.category_name || "",
    note: record.note || "",
    date: record.occurred_on || "",
    account: record.account_id || null,
    toAccount: record.to_account_id || null,
    depositDir: BACKEND_DEPOSIT_DIRS[record.deposit_direction] || null,
    depositTarget: record.deposit_target || null,
    depositLinkId: record.deposit_link_id || null,
    depositFinal: !!record.deposit_final
  };
}

function mapBackendOverview(payload) {
  if (!payload || !Array.isArray(payload.items) || !payload.totals) return null;
  const items = payload.items.filter(Boolean).map(book => ({
    id: book.id,
    name: book.name,
    category: book.group_name || "未分类",
    income: Number(book.income_cents || 0) / 100,
    expense: Number(book.expense_cents || 0) / 100,
    netWorth: Number(book.net_worth_cents || 0) / 100
  })).filter(book => book.id && book.name);
  if (items.length === 0 && dataState.books.length > 0) return null;
  return {
    periodFrom: payload.period_from || "",
    periodTo: payload.period_to || "",
    items,
    totals: {
      income: Number(payload.totals.income_cents || 0) / 100,
      expense: Number(payload.totals.expense_cents || 0) / 100,
      netWorth: Number(payload.totals.net_worth_cents || 0) / 100
    }
  };
}

// 后端写入失败时恢复浏览器里的原始快照，避免页面停留在半迁移状态。
function restoreLocalStateFromStorage() {
  dataState.backendBooksLoaded = false;
  dataState.backendOptionsLoaded = false;
  dataState.backendRecordsLoaded = false;
  dataState.backendOverview = null;
  dataState.backendCategoryIds = Object.create(null);
  dataState.backendTypeIds = Object.create(null);
  loadBooks();
  load();
  loadAccounts();
  loadCustomTypes();
  loadCustomCategories();
  resetForm();
  resetAccountForm();
  resetBookForm();
  resetFilterState();
  if (typeof renderBookSelect === "function") renderBookSelect();
  if (typeof renderBookList === "function") renderBookList();
  if (typeof renderAccountSelects === "function") renderAccountSelects();
  if (typeof fillCategoryFilter === "function") fillCategoryFilter();
  if (typeof renderTypeChips === "function") renderTypeChips();
  if (typeof renderCategoryChips === "function") renderCategoryChips();
  if (typeof updateFormFields === "function") updateFormFields();
  if (typeof render === "function") render();
}

// 只在返回了有效账本时替换内存中的账本；空响应或请求失败都保留本地数据。
async function hydrateBooksFromBackend(allowEmpty = false) {
  const payload = await backendApi.getJSON("/books");
  if (!payload || !Array.isArray(payload.items)) return false;
  const books = payload.items.filter(Boolean).map(mapBackendBook).filter(b => b.id && b.name);
  if (books.length === 0 && !allowEmpty) return false;

  dataState.books = books;
  const selected = books.find(book => String(book.id) === String(dataState.currentBookId));
  dataState.currentBookId = selected ? selected.id : (books[0] ? books[0].id : null);
  dataState.backendBooksLoaded = true;
  return true;
}

async function hydrateAccountsFromBackend() {
  if (!dataState.backendBooksLoaded) return false;
  if (!dataState.currentBookId) {
    dataState.accounts = [];
    return true;
  }
  const bookId = encodeURIComponent(String(dataState.currentBookId));
  const payload = await backendApi.getJSON("/books/" + bookId + "/accounts");
  if (!payload || !Array.isArray(payload.items)) return false;
  dataState.accounts = payload.items.filter(Boolean).map(mapBackendAccount);
  return true;
}

async function hydrateOptionsFromBackend() {
  const responses = await Promise.all([
    backendApi.getJSON("/categories"),
    backendApi.getJSON("/record-types")
  ]);
  const categories = responses[0];
  const recordTypes = responses[1];
  if (!categories || !Array.isArray(categories.items)) return false;
  if (!recordTypes || !Array.isArray(recordTypes.items)) return false;

  const mappedCategories = categories.items
    .filter(Boolean)
    .map(mapBackendCategory)
    .filter(category => category.id && category.name);
  const mappedTypes = recordTypes.items
    .filter(Boolean)
    .map(mapBackendType)
    .filter(recordType => recordType.id && recordType.name);
  dataState.backendCategoryIds = Object.create(null);
  mappedCategories.forEach(category => {
    dataState.backendCategoryIds[category.name] = category.id;
  });
  dataState.backendTypeIds = Object.create(null);
  mappedTypes.forEach(recordType => {
    dataState.backendTypeIds[recordType.name] = recordType.id;
  });
  dataState.customCategories = mappedCategories
    .filter(category => !category.isSystem)
    .map(category => category.name);
  dataState.customTypes = mappedTypes
    .filter(recordType => !recordType.isSystem)
    .map(recordType => ({ name: recordType.name, side: recordType.side }));
  dataState.backendOptionsLoaded = true;
  return true;
}

async function hydrateRecordsFromBackend() {
  if (!dataState.backendBooksLoaded) return false;
  if (!dataState.currentBookId) {
    dataState.records = [];
    dataState.backendRecordsLoaded = true;
    return true;
  }
  const bookId = encodeURIComponent(String(dataState.currentBookId));
  const payload = await backendApi.getJSON("/books/" + bookId + "/records");
  if (!payload || !Array.isArray(payload.items)) return false;
  if (!payload.items.every(item => item && typeof item === "object")) return false;
  const records = payload.items.map(mapBackendRecord);
  if (records.some(record => (
    !record.id || !record.type || !record.category || !record.date || record.amountCents <= 0
  ))) return false;
  dataState.records = records;
  dataState.backendRecordsLoaded = true;
  return true;
}

async function hydrateOverviewFromBackend() {
  const payload = await backendApi.getJSON("/overview");
  const overview = mapBackendOverview(payload);
  if (!overview) return false;
  dataState.backendOverview = overview;
  return true;
}

// 读取服务端账本时保留调用前快照，普通网络失败可以回退；认证失效则由登录入口接管。
async function startBackendReadHydration(allowEmptyBooks = false) {
  if (backendApi.baseUrl() && dataState.authStatus !== "authenticated") return false;
  const localBooks = dataState.books;
  const localCurrentBookId = dataState.currentBookId;
  const localAccounts = dataState.accounts;
  const localCustomTypes = dataState.customTypes;
  const localCustomCategories = dataState.customCategories;
  const localRecords = dataState.records;
  const localOverview = dataState.backendOverview;
  try {
    const loaded = await hydrateBooksFromBackend(allowEmptyBooks);
    if (!loaded) return false;
    if (!await hydrateOptionsFromBackend()) throw new Error("options_response_invalid");
    if (!await hydrateAccountsFromBackend()) throw new Error("accounts_response_invalid");
    if (!await hydrateRecordsFromBackend()) throw new Error("records_response_invalid");
    if (!await hydrateOverviewFromBackend()) throw new Error("overview_response_invalid");
    if (!uiState.startupNotice) {
      uiState.startupNotice = "已读取服务端账本、账户、选项和当前账本明细，并缓存到本机；新建账本、账户和账目会优先同步服务端，网络异常时再回退到本机数据。";
    }
    renderBookSelect();
    renderBookList();
    renderAccountSelects();
    fillCategoryFilter();
    if (typeof renderTypeChips === "function") renderTypeChips();
    if (typeof renderCategoryChips === "function") renderCategoryChips();
    updateFormFields();
    render();
    persistBackendSnapshotLocally();
    return true;
  } catch (e) {
    if (backendApi.baseUrl() && dataState.authStatus !== "authenticated") {
      if (typeof clearLedgerStateForAuthGate === "function") clearLedgerStateForAuthGate();
      return false;
    }
    // 账本和账户要么一起切换，要么一起回到启动时的本地快照。
    dataState.books = localBooks;
    dataState.currentBookId = localCurrentBookId;
    dataState.accounts = localAccounts;
    dataState.customTypes = localCustomTypes;
    dataState.customCategories = localCustomCategories;
    dataState.records = localRecords;
    dataState.backendOverview = localOverview;
    dataState.backendCategoryIds = Object.create(null);
    dataState.backendTypeIds = Object.create(null);
    dataState.backendBooksLoaded = false;
    dataState.backendOptionsLoaded = false;
    dataState.backendRecordsLoaded = false;
    return false;
  }
}
