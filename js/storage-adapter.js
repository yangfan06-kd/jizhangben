// 存储适配层：为业务模块提供统一的键值存储接口。
// 以后切换到 IndexedDB 或后端 API 时，优先替换这里，而不是逐个修改业务模块。

let durableLedgerBackend = null;
let durableLedgerReadNoticeShown = false;

function ledgerStorageBackend() {
  if (durableLedgerBackend) return durableLedgerBackend;
  const bridge = window.JizhangbenStorage;
  if (!bridge || typeof bridge.readEntries !== "function" || typeof bridge.writeEntries !== "function") return null;
  try {
    const values = JSON.parse(bridge.readEntries());
    if (!values || typeof values !== "object" || Array.isArray(values) ||
        Object.entries(values).some(([key, value]) => !key.startsWith("jizhangben_") || (value !== null && typeof value !== "string"))) {
      throw new Error("ledger_storage_invalid");
    }
    durableLedgerBackend = { bridge, values };
    return durableLedgerBackend;
  } catch (error) {
    const message = "无法读取本机账本存储，已停止写入。请重新打开应用；不要卸载或清除数据。";
    if (!durableLedgerReadNoticeShown && typeof document !== "undefined" && typeof appNotice === "function") {
      durableLedgerReadNoticeShown = true;
      appNotice(message);
    }
    throw new Error(message);
  }
}

function commitLedgerStorage(backend, changes) {
  if (backend.bridge.writeEntries(JSON.stringify(changes)) !== true) {
    throw new Error("账本未能保存到手机，原设置已保留");
  }
  Object.assign(backend.values, changes);
  // 原生提交是成功依据。WebView 副本只用于兼容，写入失败不能丢掉已提交值。
  Object.entries(changes).forEach(([key, value]) => {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) { /* 后续读取仍使用已提交的原生值。 */ }
  });
}

const appStorage = {
  get(key) {
    key = String(key);
    const backend = key.startsWith("jizhangben_") ? ledgerStorageBackend() : null;
    if (backend && Object.prototype.hasOwnProperty.call(backend.values, key)) return backend.values[key];
    return window.localStorage.getItem(key);
  },

  set(key, value) {
    key = String(key);
    const backend = key.startsWith("jizhangben_") ? ledgerStorageBackend() : null;
    if (backend) return commitLedgerStorage(backend, { [key]: String(value) });
    window.localStorage.setItem(key, value);
  },

  remove(key) {
    key = String(key);
    const backend = key.startsWith("jizhangben_") ? ledgerStorageBackend() : null;
    if (backend) return commitLedgerStorage(backend, { [key]: null });
    window.localStorage.removeItem(key);
  },

  entries(prefix = "") {
    const result = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.indexOf(prefix) === 0) result[key] = window.localStorage.getItem(key);
    }
    const backend = ledgerStorageBackend();
    if (backend) Object.entries(backend.values).forEach(([key, value]) => {
      if (!key.startsWith(prefix)) return;
      if (value === null) delete result[key];
      else result[key] = value;
    });
    return result;
  },

  removeMany(keys) {
    const backend = keys.every(key => String(key).startsWith("jizhangben_")) ? ledgerStorageBackend() : null;
    if (backend) return commitLedgerStorage(backend, Object.fromEntries(keys.map(key => [key, null])));
    keys.forEach(key => this.remove(key));
  },

  setMany(entries) {
    const backend = Object.keys(entries).every(key => key.startsWith("jizhangben_")) ? ledgerStorageBackend() : null;
    if (backend) return commitLedgerStorage(backend, Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, String(value)])));
    Object.entries(entries).forEach(([key, value]) => this.set(key, value));
  },

  replaceLedgerEntries(entries) {
    const backend = ledgerStorageBackend();
    if (!backend) return false;
    if (Object.keys(entries).some(key => !key.startsWith("jizhangben_"))) throw new Error("备份存储项无效");
    const changes = Object.fromEntries(Object.keys(this.entries("jizhangben_")).map(key => [key, null]));
    Object.entries(entries).forEach(([key, value]) => { changes[key] = String(value); });
    commitLedgerStorage(backend, changes);
    return true;
  }
};
