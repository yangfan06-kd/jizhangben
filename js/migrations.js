// 数据迁移模块：把旧版本的存储结构升级到当前结构。
// 迁移函数需要可重复执行，页面中断后再次打开也不会重复覆盖已有数据。

function readStorageSchemaVersion() {
  const raw = appStorage.get(STORAGE_SCHEMA_KEY);
  const version = Number(raw);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

function writeStorageSchemaVersion(version) {
  appStorage.set(STORAGE_SCHEMA_KEY, String(version));
}

function restoreMigrationSnapshot(snapshot) {
  const current = appStorage.entries("jizhangben_");
  Object.keys(current).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) appStorage.remove(key);
  });
  appStorage.setMany(snapshot);
}

// v1：把最早的单账本记录/账户键迁移到默认账本的分账本键。
function migrateLegacySingleBookData() {
  const legacyRecords = appStorage.get(STORAGE_KEY);
  const legacyAccounts = appStorage.get(ACCOUNTS_KEY);
  if (legacyRecords == null && legacyAccounts == null) return;

  let books = [];
  try { books = JSON.parse(appStorage.get(BOOKS_KEY)) || []; }
  catch (e) { books = []; }
  if (!Array.isArray(books)) books = [];

  if (books.length === 0) {
    books = [{ id: nextId(books), name: "我的账本", category: "个人" }];
    appStorage.set(BOOKS_KEY, JSON.stringify(books));
  }

  const targetBook = books[0];
  if (legacyRecords != null && appStorage.get(recordsKey(targetBook.id)) == null) {
    appStorage.set(recordsKey(targetBook.id), legacyRecords);
  }
  if (legacyAccounts != null && appStorage.get(accountsKey(targetBook.id)) == null) {
    appStorage.set(accountsKey(targetBook.id), legacyAccounts);
  }
  appStorage.remove(STORAGE_KEY);
  appStorage.remove(ACCOUNTS_KEY);
}

// v2：把读取时兼容的金额字段规范化并写回，保证新数据都带有分值字段。
function migrateNormalizedData() {
  const recordEntries = appStorage.entries("jizhangben_records_");
  Object.entries(recordEntries).forEach(([key, raw]) => {
    let records = null;
    try { records = JSON.parse(raw); }
    catch (e) { return; }
    // 只忽略解析失败；写入失败必须交给 runMigrations 触发回滚。
    if (Array.isArray(records)) appStorage.set(key, JSON.stringify(normalizeRecords(records)));
  });

  const accountEntries = appStorage.entries("jizhangben_accounts_");
  Object.entries(accountEntries).forEach(([key, raw]) => {
    let accounts = null;
    try { accounts = JSON.parse(raw); }
    catch (e) { return; }
    // 只忽略解析失败；写入失败必须交给 runMigrations 触发回滚。
    if (Array.isArray(accounts)) appStorage.set(key, JSON.stringify(normalizeAccounts(accounts)));
  });
}

function runMigrations() {
  let snapshot = null;
  uiState.startupNotice = "";
  try {
    snapshot = appStorage.entries("jizhangben_");
    let version = readStorageSchemaVersion();
    while (version < STORAGE_SCHEMA_VERSION) {
      const nextVersion = version + 1;
      if (nextVersion === 1) migrateLegacySingleBookData();
      if (nextVersion === 2) migrateNormalizedData();
      writeStorageSchemaVersion(nextVersion);
      version = nextVersion;
    }
    return true;
  } catch (error) {
    try {
      if (!snapshot) throw new Error("migration snapshot unavailable");
      restoreMigrationSnapshot(snapshot);
      uiState.startupNotice = "数据升级失败，已恢复升级前的数据。建议先导出备份，再刷新页面重试。";
    } catch (rollbackError) {
      uiState.startupNotice = "数据升级失败，自动恢复也未完成。请先停止记账，并使用备份文件恢复数据。";
    }
    return false;
  }
}
