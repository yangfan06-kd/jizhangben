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

function loadCustomCategoryIcons() {
  try {
    const raw = JSON.parse(appStorage.get(CUSTOM_CATEGORY_ICONS_KEY) || "{}");
    dataState.customCategoryIcons = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (e) { dataState.customCategoryIcons = {}; }
}

function saveCustomCategoryIcons() {
  appStorage.set(CUSTOM_CATEGORY_ICONS_KEY, JSON.stringify(dataState.customCategoryIcons || {}));
}

function isValidCategorySystem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.groups) || !Array.isArray(value.hidden)) return false;
  if (value.groups.length > 100 || value.hidden.length > 1000) return false;
  const ids = new Set();
  const groupNames = new Set();
  const itemNames = new Set();
  for (const group of value.groups) {
    if (!group || typeof group !== "object" || Array.isArray(group) ||
      typeof group.key !== "string" || !group.key || group.key.length > 80 || ids.has(group.key) ||
      typeof group.name !== "string" || !group.name.trim() || group.name.length > 30 || groupNames.has(group.name) ||
      typeof group.icon !== "string" || group.icon.length > 40 ||
      typeof group.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(group.color) ||
      typeof group.background !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(group.background) ||
      !Array.isArray(group.items) || group.items.length > 300) return false;
    ids.add(group.key);
    groupNames.add(group.name);
    for (const name of group.items) {
      if (typeof name !== "string" || !name.trim() || name.length > 30 || itemNames.has(name)) return false;
      itemNames.add(name);
    }
  }
  return value.hidden.every(name => typeof name === "string" && name.length <= 30 && !itemNames.has(name)) &&
    new Set(value.hidden).size === value.hidden.length;
}

function defaultCategorySystem() {
  const groups = CATEGORY_GROUPS.map(group => ({ ...group, items: group.items.slice() }));
  const assigned = new Set(groups.flatMap(group => group.items));
  const legacy = dataState.customCategories.filter(name => typeof name === "string" && name.trim() && !assigned.has(name));
  if (legacy.length) groups.push({
    key: "legacy-custom", name: "自定义类别", icon: "other", color: "#6E8790", background: "#EEF3F4", items: [...new Set(legacy)]
  });
  return { groups, hidden: [] };
}

function syncCategorySystemWithCustomCategories() {
  const system = dataState.categorySystem;
  if (!system) return;
  const known = new Set(system.groups.flatMap(group => group.items).concat(system.hidden));
  const incoming = dataState.customCategories.filter(name => typeof name === "string" && name.trim() && !known.has(name));
  if (!incoming.length) return;
  let group = system.groups.find(item => item.key === "legacy-custom" || item.name === "自定义类别");
  if (!group) {
    group = { key: "legacy-custom", name: "自定义类别", icon: "other", color: "#6E8790", background: "#EEF3F4", items: [] };
    system.groups.push(group);
  }
  group.items.push(...new Set(incoming));
  saveCategorySystem();
}

function loadCategorySystem() {
  try {
    const raw = appStorage.get(CATEGORY_SYSTEM_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    dataState.categorySystem = isValidCategorySystem(parsed) ? parsed : defaultCategorySystem();
    if (!raw) saveCategorySystem();
  } catch (error) {
    dataState.categorySystem = defaultCategorySystem();
  }
  syncCategorySystemWithCustomCategories();
}

function saveCategorySystem() {
  if (!isValidCategorySystem(dataState.categorySystem)) throw new Error("category_system_invalid");
  appStorage.set(CATEGORY_SYSTEM_KEY, JSON.stringify(dataState.categorySystem));
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

// 定投计划按账本单独保存，旧账本没有该键时自然视为空列表。
function loadInvestmentPlans() {
  try {
    const value = JSON.parse(appStorage.get(investmentPlansKey(dataState.currentBookId)) || "[]");
    dataState.investmentPlans = Array.isArray(value) ? value : [];
  } catch (error) {
    dataState.investmentPlans = [];
  }
}

function saveInvestmentPlans() {
  const plans = Array.isArray(dataState.investmentPlans) ? dataState.investmentPlans : [];
  appStorage.set(investmentPlansKey(dataState.currentBookId), JSON.stringify(plans));
}

// 新版基金项目与旧定投计划分开保存；旧数据保留供用户核对。
function loadFundProjects() {
  try {
    const value = JSON.parse(appStorage.get(fundProjectsKey(dataState.currentBookId)) || "[]");
    dataState.fundProjects = Array.isArray(value) ? value : [];
  } catch (error) {
    dataState.fundProjects = [];
  }
  if (typeof fundUi !== "undefined") fundUi.lastRunDate = "";
}

function saveFundProjects() {
  appStorage.set(fundProjectsKey(dataState.currentBookId), JSON.stringify(dataState.fundProjects || []));
}
