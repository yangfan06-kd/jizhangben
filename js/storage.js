// 数据存储模块：负责 localStorage 的读取、保存和旧数据兼容。
// 运行时数据统一放在 state.js 的 dataState 中；这些函数在页面启动时才会被调用。

// 从 localStorage 读取当前账本的账目
function load() {
  try {
    const raw = appStorage.get(recordsKey(dataState.currentBookId));
    dataState.records = raw ? normalizeRecords(JSON.parse(raw)) : [];
  } catch (e) {
    dataState.records = [];
  }
}

// 保存当前账本的账目
function save() {
  dataState.records = normalizeRecords(dataState.records);
  appStorage.set(recordsKey(dataState.currentBookId), JSON.stringify(dataState.records));
}

// 读取所有账本，并把旧版本的单账本数据迁移到默认账本
function loadBooks() {
  runMigrations();
  try {
    dataState.books = JSON.parse(appStorage.get(BOOKS_KEY)) || [];
  } catch (e) { dataState.books = []; }
  if (!Array.isArray(dataState.books)) dataState.books = [];

  if (dataState.books.length === 0) {
    const defaultBook = { id: nextId(dataState.books), name: "我的账本", category: "个人" };
    dataState.books = [defaultBook];
    saveBooks();
  }

  let cur = null;
  try { cur = JSON.parse(appStorage.get(CURRENT_BOOK_KEY)); } catch (e) { cur = null; }
  dataState.currentBookId = dataState.books.some(b => b.id === cur) ? cur : dataState.books[0].id;
}

function saveBooks() {
  appStorage.set(BOOKS_KEY, JSON.stringify(dataState.books));
}

// 读取和保存自定义类型、类别
function loadCustomTypes() {
  try {
    const raw = JSON.parse(appStorage.get(CUSTOM_TYPES_KEY)) || [];
    dataState.customTypes = raw.map(t => (typeof t === "string" ? { name: t, side: "neutral" } : t));
  } catch (e) { dataState.customTypes = []; }
}

function saveCustomTypes() {
  appStorage.set(CUSTOM_TYPES_KEY, JSON.stringify(dataState.customTypes));
}

function loadCustomCategories() {
  try { dataState.customCategories = JSON.parse(appStorage.get(CUSTOM_CATEGORIES_KEY)) || []; }
  catch (e) { dataState.customCategories = []; }
}

function saveCustomCategories() {
  appStorage.set(CUSTOM_CATEGORIES_KEY, JSON.stringify(dataState.customCategories));
}

// 读取当前账本的账户，没有数据时使用默认账户
function loadAccounts() {
  try {
    const raw = appStorage.get(accountsKey(dataState.currentBookId));
    dataState.accounts = raw ? normalizeAccounts(JSON.parse(raw)) : null;
  } catch (e) { dataState.accounts = null; }
  if (!dataState.accounts || dataState.accounts.length === 0) {
    dataState.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
  }
}

function saveAccounts() {
  dataState.accounts = normalizeAccounts(dataState.accounts);
  appStorage.set(accountsKey(dataState.currentBookId), JSON.stringify(dataState.accounts));
}
