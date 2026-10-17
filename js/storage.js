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
      (group.side !== undefined && group.side !== "income" && group.side !== "expense") ||
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
  const groups = CATEGORY_GROUPS.map(group => ({ ...group, side: "expense", items: group.items.slice() }));
  const legacy = [...new Set(dataState.customCategories.filter(name =>
    typeof name === "string" && name.trim() && !categorySystemBuiltInNames().has(name)))];
  appendLegacyCategoryGroups(groups, legacy);
  return { groups, hidden: [] };
}

function categorySystemBuiltInNames() {
  return new Set(CATEGORY_GROUPS.flatMap(group => group.items));
}

function inferLegacyCategorySide(name) {
  const records = Array.isArray(dataState.records) ? dataState.records.slice() : [];
  const seenSides = new Set();
  const addRecords = list => {
    if (!Array.isArray(list)) return;
    list.forEach(record => {
      if (!record || record.category !== name || typeof typeSide !== "function") return;
      const side = typeSide(record.type);
      if (side === "income" || side === "expense") seenSides.add(side);
    });
  };
  addRecords(records);
  (Array.isArray(dataState.books) ? dataState.books : []).forEach(book => {
    if (!book || String(book.id) === String(dataState.currentBookId)) return;
    try {
      const raw = appStorage.get(recordsKey(book.id));
      if (raw) addRecords(JSON.parse(raw));
    } catch (error) { /* 单个旧账本损坏时继续使用其他账本的类别记录 */ }
  });
  return seenSides.size === 1 && seenSides.has("income") ? "income" : "expense";
}

function appendLegacyCategoryGroups(groups, names) {
  const bySide = { income: [], expense: [] };
  [...new Set(names)].forEach(name => bySide[inferLegacyCategorySide(name)].push(name));
  ["expense", "income"].forEach(side => {
    if (!bySide[side].length) return;
    groups.push({
      key: "legacy-custom-" + side,
      name: side === "income" ? "原收入自定义类别" : "原支出自定义类别",
      side, icon: "other", color: "#6E8790", background: "#EEF3F4", items: bySide[side]
    });
  });
}

// 保留旧版大类的名称、顺序、小类、图标和隐藏状态；只补充收入/支出方向。
// 此处不能用模板重建已有配置，否则用户自行删除和调整的类别会再次出现。
function normalizeCategorySystem(value) {
  if (!isValidCategorySystem(value)) return defaultCategorySystem();
  const groups = value.groups.map(group => {
    let side = group.side;
    if (side !== "income" && side !== "expense") {
      if (CATEGORY_GROUPS.some(item => item.key === group.key)) side = "expense";
      // 早期类别共用收支；用户明确命名的收入大类优先保留其含义。
      // 小类「其他」曾用于支出也不能把整个收入大类改成支出；旧流水不参与改写。
      else if (group.name.trim() === "收入") side = "income";
      else {
        const inferred = group.items.map(inferLegacyCategorySide);
        side = inferred.length && inferred.every(item => item === "income") ? "income" : "expense";
      }
    }
    return { ...group, side, items: group.items.slice() };
  });
  return { groups, hidden: value.hidden.slice() };
}

function syncCategorySystemWithCustomCategories() {
  const system = dataState.categorySystem;
  if (!system) return;
  const known = new Set(system.groups.flatMap(group => group.items).concat(system.hidden));
  const builtInNames = categorySystemBuiltInNames();
  const incoming = dataState.customCategories.filter(name => typeof name === "string" && name.trim() && !known.has(name) && !builtInNames.has(name));
  if (!incoming.length) return;
  const bySide = { income: [], expense: [] };
  [...new Set(incoming)].forEach(name => bySide[inferLegacyCategorySide(name)].push(name));
  ["expense", "income"].forEach(side => {
    if (!bySide[side].length) return;
    let group = system.groups.find(item => item.side === side && item.key.startsWith("legacy-custom-"));
    if (!group) {
      group = {
        key: "legacy-custom-" + side, name: side === "income" ? "原收入自定义类别" : "原支出自定义类别",
        side, icon: "other", color: "#6E8790", background: "#EEF3F4", items: []
      };
      system.groups.push(group);
    }
    group.items.push(...bySide[side]);
  });
  dataState.categorySystem = normalizeCategorySystem(system);
  saveCategorySystem();
}

function loadCategorySystem() {
  try {
    const raw = appStorage.get(CATEGORY_SYSTEM_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const normalized = normalizeCategorySystem(parsed);
    dataState.categorySystem = normalized;
    if (!raw || JSON.stringify(parsed) !== JSON.stringify(normalized)) saveCategorySystem();
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

function loadFixedIncomePlan() {
  try {
    const value = JSON.parse(appStorage.get(fixedIncomeKey(dataState.currentBookId)) || "null");
    dataState.fixedIncomePlan = value && typeof value === "object" ? value : null;
  } catch (error) {
    dataState.fixedIncomePlan = null;
  }
}

function saveFixedIncomePlan() {
  if (dataState.currentBookId == null) return;
  if (dataState.fixedIncomePlan) appStorage.set(fixedIncomeKey(dataState.currentBookId), JSON.stringify(dataState.fixedIncomePlan));
  else appStorage.remove(fixedIncomeKey(dataState.currentBookId));
}
