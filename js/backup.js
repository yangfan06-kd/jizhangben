// 备份模块：负责把 jizhangben_ 开头的数据导出、导入和恢复。

let backupMsgTimer = null;
let migrationPreviewState = null;

function showBackupMsg(text, isWarn) {
  const m = document.getElementById("backupMsg");
  m.textContent = text;
  m.classList.toggle("warn", !!isWarn);
  clearTimeout(backupMsgTimer);
  backupMsgTimer = setTimeout(() => { m.textContent = ""; }, isWarn ? 5000 : 3000);
}

function formatPreviewMoney(cents) {
  const amount = Number(cents) / 100;
  if (!Number.isFinite(amount)) return "¥0.00";
  return (amount < 0 ? "−¥" : "¥") + Math.abs(amount).toFixed(2);
}

function renderMigrationPreview(summary) {
  const box = document.getElementById("migrationPreview");
  const summaryBox = document.getElementById("migrationPreviewSummary");
  const booksBox = document.getElementById("migrationPreviewBooks");
  if (!box || !summaryBox || !booksBox) return;

  const counts = summary.counts || {};
  const totals = summary.totals || {};
  summaryBox.innerHTML = `
    <div class="migration-counts">共 ${Number(counts.books || 0)} 个账本、${Number(counts.accounts || 0)} 个账户、${Number(counts.records || 0)} 笔账目</div>
    <div class="migration-totals">
      <span>收入 ${formatPreviewMoney(totals.income_cents)}</span>
      <span>支出 ${formatPreviewMoney(totals.expense_cents)}</span>
      <span>净资产 ${formatPreviewMoney(totals.net_worth_cents)}</span>
    </div>
  `;
  booksBox.innerHTML = (Array.isArray(summary.books) ? summary.books : []).map(book => `
    <div class="migration-book">
      <div class="migration-book-name">${esc(book.name || "未命名账本")}</div>
      <div class="migration-book-meta">${esc(book.group_name || "未分类")} · ${Number(book.accounts || 0)} 个账户 · ${Number(book.records || 0)} 笔账目</div>
      <div class="migration-book-money">收入 ${formatPreviewMoney(book.income_cents)} · 支出 ${formatPreviewMoney(book.expense_cents)} · 净资产 ${formatPreviewMoney(book.net_worth_cents)}</div>
    </div>
  `).join("");
  box.hidden = false;
  const confirmButton = document.getElementById("migrationConfirmBtn");
  if (confirmButton) confirmButton.disabled = false;
}

function clearMigrationPreview() {
  migrationPreviewState = null;
  const box = document.getElementById("migrationPreview");
  const summaryBox = document.getElementById("migrationPreviewSummary");
  const booksBox = document.getElementById("migrationPreviewBooks");
  const confirmButton = document.getElementById("migrationConfirmBtn");
  if (box) box.hidden = true;
  if (summaryBox) summaryBox.innerHTML = "";
  if (booksBox) booksBox.innerHTML = "";
  if (confirmButton) confirmButton.disabled = true;
}

function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (error) { reject(error); }
    };
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsText(file);
  });
}

async function previewMigrationFile(file) {
  clearMigrationPreview();
  if (!file) return;
  try {
    const backup = await readBackupFile(file);
    // 先在浏览器本地检查结构，避免把明显损坏的文件发给后端。
    extractBackupStorage(backup);
    const summary = await backendApi.previewLocalBackup(backup);
    if (!summary || !summary.counts || !summary.totals || !Array.isArray(summary.books)) {
      throw new Error("preview_response_invalid");
    }
    migrationPreviewState = { backup, summary };
    renderMigrationPreview(summary);
    showBackupMsg("预览完成，请核对数量和金额后再确认导入。");
  } catch (error) {
    if (error && error.message === "backend_disabled") {
      showBackupMsg("迁移预览需要通过 HTTP 页面访问，直接打开文件时暂不可用。", true);
    } else if (error && error.code === "backup_invalid") {
      showBackupMsg(error.message || "服务端拒绝了这份备份，请先修复数据。", true);
    } else {
      showBackupMsg("预览失败，请确认后端已启动并重试。", true);
    }
  }
}

async function confirmMigrationImport() {
  if (!migrationPreviewState) return;
  if (!confirm("确认把这份备份导入服务端吗？导入会替换当前服务端账本，浏览器本地备份仍会保留。")) return;

  const confirmButton = document.getElementById("migrationConfirmBtn");
  if (confirmButton) confirmButton.disabled = true;
  showBackupMsg("正在导入服务端，请稍候…");
  try {
    await backendApi.importLocalBackup(migrationPreviewState.backup);
    clearMigrationPreview();
    const loaded = await startBackendReadHydration();
    if (loaded) {
      showBackupMsg("迁移完成，页面已读取服务端数据；浏览器原始备份仍保留。");
    } else {
      showBackupMsg("服务端已完成迁移，但页面刷新失败，请重新打开页面。", true);
    }
  } catch (error) {
    if (confirmButton) confirmButton.disabled = false;
    showBackupMsg(error && error.message ? error.message : "导入失败，原数据未被替换。", true);
  }
}

// 把所有 jizhangben_ 开头的本地数据打包成带版本号的 JSON 文件下载
function exportBackup() {
  const storage = appStorage.entries("jizhangben_");
  delete storage[PENDING_SYNC_KEY];
  delete storage[LOCAL_SNAPSHOT_OWNER_KEY];
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

// 登录后，如果服务端还是空账本，先检查浏览器 / App WebView 里是否有可迁移的旧数据。
// 只把有实际账目的本地数据作为候选，避免新用户仅因默认空账本被反复提醒。
function getLocalMigrationCandidate() {
  const storage = appStorage.entries("jizhangben_");
  delete storage[PENDING_SYNC_KEY];
  delete storage[LOCAL_SNAPSHOT_OWNER_KEY];
  if (!storage[BOOKS_KEY]) return null;
  let books = [];
  try { books = JSON.parse(storage[BOOKS_KEY]); } catch (e) { return null; }
  if (!Array.isArray(books) || books.length === 0) return null;

  let recordCount = 0;
  Object.entries(storage).forEach(([key, raw]) => {
    if (key.indexOf("jizhangben_records_") !== 0) return;
    try {
      const records = JSON.parse(raw);
      if (Array.isArray(records)) recordCount += records.length;
    } catch (e) { /* extractBackupStorage 会在真正迁移前再次校验 */ }
  });
  let customTypes = [];
  let customCategories = [];
  try { customTypes = JSON.parse(storage[CUSTOM_TYPES_KEY] || "[]"); } catch (e) { customTypes = []; }
  try { customCategories = JSON.parse(storage[CUSTOM_CATEGORIES_KEY] || "[]"); } catch (e) { customCategories = []; }
  const hasMeaningfulData = recordCount > 0 || books.length > 1 ||
    customTypes.length > 0 || customCategories.length > 0 ||
    (books[0] && books[0].name && books[0].name !== "我的账本");
  if (!hasMeaningfulData) return null;

  const backup = {
    format: "jizhangben-backup",
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    storage
  };
  try {
    extractBackupStorage(backup);
    return backup;
  } catch (e) {
    return null;
  }
}

function showLocalMigrationFallback(message = "发现本机已有账目，暂未同步到当前账号；本机数据已保留，可稍后在账本管理中导出并迁移。 ") {
  if (typeof initializeLocalLedger === "function") initializeLocalLedger();
  if (typeof showAuthDataNotice === "function") {
    showAuthDataNotice(message);
  }
}

// 返回 none（无需处理）、imported（已导入）或 local（保留本地数据继续使用）。
async function maybeOfferLocalMigration() {
  if (!backendApi.baseUrl()) return "none";
  const backup = getLocalMigrationCandidate();
  const pending = typeof getPendingLocalChange === "function" ? getPendingLocalChange() : null;
  if (!backup && !pending) return "none";
  if (typeof localSnapshotMatchesCurrentUser === "function" && !localSnapshotMatchesCurrentUser()) {
    return "none";
  }
  try {
    const booksPayload = await backendApi.getJSON("/books");
    if (!booksPayload || !Array.isArray(booksPayload.items)) return "none";
    if (pending && booksPayload.items.length > 0) {
      showLocalMigrationFallback("发现本机有尚未同步的离线修改；为避免覆盖服务端账本，当前继续使用本机数据。请先导出本机备份，再在账本管理中预览并迁移。 ");
      return "local";
    }
    if (!backup) {
      showLocalMigrationFallback("发现本机有尚未同步的离线修改；当前继续使用本机数据。请先导出本机备份，再决定是否迁移到当前账号。 ");
      return "local";
    }
    if (booksPayload.items.length > 0) return "none";
    const summary = await backendApi.previewLocalBackup(backup);
    const counts = summary && summary.counts ? summary.counts : {};
    const totals = summary && summary.totals ? summary.totals : {};
    const income = (Number(totals.income_cents || 0) / 100).toFixed(2);
    const expense = (Number(totals.expense_cents || 0) / 100).toFixed(2);
    const message = `检测到本机有 ${Number(counts.books || 0)} 个账本、${Number(counts.records || 0)} 笔账目和 ${Number(counts.accounts || 0)} 个账户。\n收入 ¥${income}，支出 ¥${expense}。\n当前账号还没有账本，是否把本机数据迁移到当前账号？`;
    if (typeof confirm !== "function" || !confirm(message)) {
      showLocalMigrationFallback();
      return "local";
    }
    await backendApi.importLocalBackup(backup);
    return "imported";
  } catch (error) {
    // 预览或导入失败时保留本机数据，避免登录过程把它替换成空页面。
    showLocalMigrationFallback();
    return "local";
  }
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
