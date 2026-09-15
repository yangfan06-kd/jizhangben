// 备份模块：负责把 jizhangben_ 开头的数据导出、导入和恢复。

let backupMsgTimer = null;

function showBackupMsg(text, isWarn) {
  const m = document.getElementById("backupMsg");
  m.textContent = text;
  m.classList.toggle("warn", !!isWarn);
  clearTimeout(backupMsgTimer);
  backupMsgTimer = setTimeout(() => { m.textContent = ""; }, isWarn ? 5000 : 3000);
}

// 把所有 jizhangben_ 开头的本地数据打包成带版本号的 JSON 文件下载
function exportBackup() {
  const storage = appStorage.entries("jizhangben_");
  const data = {
    format: "jizhangben-backup",
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    storage: storage
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "记账本备份_" + todayStr() + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showBackupMsg("已导出备份文件");
}

function isBackupObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasBackupId(value) {
  return (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() !== "");
}

function hasBackupMoney(item, centsKey, amountKey) {
  const raw = item[centsKey] != null ? item[centsKey] : item[amountKey];
  return raw !== "" && Number.isFinite(Number(raw));
}

function isValidBookList(value) {
  return Array.isArray(value) && value.every(book =>
    isBackupObject(book) &&
    hasBackupId(book.id) &&
    typeof book.name === "string" && book.name.trim() !== "" &&
    (book.category == null || typeof book.category === "string")
  );
}

function isValidRecordList(value) {
  return Array.isArray(value) && value.every(record =>
    isBackupObject(record) &&
    hasBackupId(record.id) &&
    typeof record.type === "string" && record.type.trim() !== "" &&
    hasBackupMoney(record, "amountCents", "amount")
  );
}

function isValidAccountList(value) {
  return Array.isArray(value) && value.every(account =>
    isBackupObject(account) &&
    hasBackupId(account.id) &&
    typeof account.name === "string" && account.name.trim() !== "" &&
    (account.kind === "资金" || account.kind === "负债") &&
    hasBackupMoney(account, "initialCents", "initial")
  );
}

function isValidCustomTypeList(value) {
  return Array.isArray(value) && value.every(type =>
    (typeof type === "string" && type.trim() !== "") ||
    (isBackupObject(type) &&
      typeof type.name === "string" && type.name.trim() !== "" &&
      ["income", "expense", "neutral"].includes(type.side))
  );
}

function validateBackupValue(key, value) {
  if (key === BOOKS_KEY) return isValidBookList(value);
  if (key === CURRENT_BOOK_KEY) return hasBackupId(value);
  if (key === STORAGE_SCHEMA_KEY) {
    return Number.isInteger(value) && value >= 0 && value <= STORAGE_SCHEMA_VERSION;
  }
  if (key === CUSTOM_TYPES_KEY) return isValidCustomTypeList(value);
  if (key === CUSTOM_CATEGORIES_KEY) {
    return Array.isArray(value) && value.every(category =>
      typeof category === "string" && category.trim() !== ""
    );
  }
  if (key === STORAGE_KEY || key.indexOf("jizhangben_records_") === 0) {
    return isValidRecordList(value);
  }
  if (key === ACCOUNTS_KEY || key.indexOf("jizhangben_accounts_") === 0) {
    return isValidAccountList(value);
  }
  return false;
}

// 读取并校验备份，兼容旧版扁平对象格式。
// 除了检查 JSON，还检查每个存储键对应的数据结构，避免无效内容覆盖当前数据。
function extractBackupStorage(data) {
  const wrapped = data && data.format === "jizhangben-backup";
  if (wrapped && (!Number.isInteger(data.version) || data.version < 1 || data.version > DATA_VERSION)) {
    throw new Error("bad");
  }
  const storage = wrapped ? data.storage : data;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) throw new Error("bad");
  const entries = Object.entries(storage);
  const keys = entries.map(([key]) => key);
  if (keys.length === 0 || !keys.every(key => key.indexOf("jizhangben_") === 0)) throw new Error("bad");
  entries.forEach(([key, value]) => {
    if (typeof value !== "string") throw new Error("bad");
    let parsed = null;
    try { parsed = JSON.parse(value); }
    catch (e) { throw new Error("bad"); }
    if (!validateBackupValue(key, parsed)) throw new Error("bad");
  });
  return Object.fromEntries(entries);
}

// 用“先保存快照、再替换、失败后恢复”的方式更新全部备份数据。
function replaceBackupStorage(imported) {
  const existing = appStorage.entries("jizhangben_");
  try {
    appStorage.removeMany(Object.keys(existing));
    appStorage.setMany(imported);
  } catch (writeError) {
    const current = appStorage.entries("jizhangben_");
    appStorage.removeMany(Object.keys(current));
    appStorage.setMany(existing);
    throw writeError;
  }
}

// 导入备份，写入失败时恢复导入前的数据
function importBackup(file) {
  if (!file) return;
  if (!confirm("导入会覆盖当前所有账本和账目，确定继续吗？")) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = extractBackupStorage(data);
      replaceBackupStorage(imported);
      reloadData();
      showBackupMsg("已恢复备份");
    } catch (e) {
      showBackupMsg("备份文件无效，请重新选择", true);
    }
  };
  reader.onerror = () => { showBackupMsg("读取文件失败，请重试", true); };
  reader.readAsText(file);
}

// 导入后重新读取所有数据并刷新页面
function reloadData() {
  loadBooks();
  load();
  loadAccounts();
  loadCustomTypes();
  loadCustomCategories();
  resetForm();
  resetAccountForm();
  resetBookForm();
  resetFilterState();
  document.getElementById("fromDate").value = "";
  document.getElementById("toDate").value = "";
  document.getElementById("filterAccountSel").value = "";
  document.getElementById("filterCategorySel").value = "";
  document.getElementById("searchInput").value = "";
  renderBookSelect();
  renderBookList();
  renderAccountSelects();
  fillCategoryFilter();
  render();
}
