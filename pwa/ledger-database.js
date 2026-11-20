/* 独立 IndexedDB 底座；仅由存储接入预览加载，安卓及普通网页原型不加载。 */
(function (root) {
  'use strict';
  const VERSION = 1;
  const LEDGER = 'ledger';
  const META = 'metadata';
  const messages = {
    unsupported: '当前浏览器不支持账本数据库，已停止写入。',
    open: '无法打开账本数据库，已停止写入；请保留网站数据并重试。',
    blocked: '账本数据库正在被其他窗口占用，请关闭其他窗口后重试。',
    timeout: '打开账本数据库超时，已停止写入。',
    closed: '账本存储连接已关闭，请重新打开应用后再保存。',
    read: '无法读取账本数据库，已停止写入，原数据未被重建。',
    invalid: '账本存储内容异常，已停止写入；请保留原数据并检查备份。',
    notReady: '账本尚未完成初始化，已停止写入。',
    conflict: '其他窗口已更新账本，本次未保存；请保留输入并重新读取。',
    write: '账本未能保存，本次改动未提交，原记录仍保留。',
    legacy: '无法完整读取原网页账本，已停止迁移，原数据仍保留。',
    verify: '迁移后的账本核对失败，已停止启动；原网页副本仍保留。'
  };
  function fault(code, cause) {
    const error = new Error(messages[code]);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function asFault(error, fallback) {
    return error && typeof error.code === 'string' && Object.prototype.hasOwnProperty.call(messages, error.code)
      ? error : fault(fallback, error);
  }
  function validEntries(entries, allowNull = false) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw fault('invalid');
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith('jizhangben_') || key.length === 11 ||
          (typeof value !== 'string' && !(allowNull && value === null))) throw fault('invalid');
    }
  }
  function validHead(head) {
    if (!head || head.schema !== VERSION || !Number.isSafeInteger(head.revision) || head.revision < 0 ||
        typeof head.initialized !== 'boolean' ||
        !(head.legacyImport === null || (head.legacyImport && Number.isSafeInteger(head.legacyImport.count) && head.legacyImport.count >= 0))) {
      throw fault('invalid');
    }
    if ((!head.initialized && (head.revision !== 0 || head.legacyImport !== null)) ||
        (head.initialized && (head.revision === 0 || head.legacyImport === null))) throw fault('invalid');
  }
  function readLegacy(storage) {
    try {
      if (!storage || !Number.isSafeInteger(storage.length) || storage.length < 0 ||
          typeof storage.key !== 'function' || typeof storage.getItem !== 'function') throw fault('legacy');
      const result = Object.create(null);
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (typeof key === 'string' && key.startsWith('jizhangben_')) {
          const value = storage.getItem(key);
          if (typeof value !== 'string') throw fault('legacy');
          result[key] = value;
        }
      }
      validEntries(result);
      return result;
    } catch (error) { throw fault('legacy', error); }
  }
  function sameEntries(first, second) {
    const a = Object.keys(first).sort(), b = Object.keys(second).sort();
    return a.length === b.length && a.every((key, index) => key === b[index] && first[key] === second[key]);
  }

  class LedgerStore {
    constructor(db, onClose) {
      this.db = db;
      this.closed = false;
      this.onClose = onClose;
      db.onversionchange = () => {
        this.close();
        if (onClose) onClose(fault('closed'));
      };
      db.onclose = () => {
        this.closed = true;
        if (onClose) onClose(fault('closed'));
      };
    }
    close() { this.closed = true; this.db.close(); }
    transaction(mode) {
      if (this.closed) throw fault('closed');
      // 请求更严格的落盘提示；实际断电保证仍由浏览器和系统决定。
      if (mode === 'readwrite') return this.db.transaction([LEDGER, META], mode, { durability: 'strict' });
      return this.db.transaction([LEDGER, META], mode);
    }
    async read() {
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = this.transaction('readonly'); }
        catch (error) { reject(asFault(error, 'read')); return; }
        const entries = Object.create(null);
        let head;
        let invalid = null;
        tx.onabort = () => reject(invalid || fault('read', tx.error));
        tx.onerror = () => {}; // 以事务 abort/complete 为最终依据。
        tx.oncomplete = () => {
          try {
            if (invalid) throw invalid;
            validHead(head);
            validEntries(entries);
            if (!head.initialized && Object.keys(entries).length) throw fault('invalid');
            resolve({ entries, revision: head.revision, initialized: head.initialized, legacyImport: head.legacyImport });
          } catch (error) { reject(error); }
        };
        tx.objectStore(META).get('head').onsuccess = event => { head = event.target.result; };
        tx.objectStore(LEDGER).openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          if (typeof cursor.key !== 'string' || typeof cursor.value !== 'string') {
            invalid = fault('invalid'); tx.abort(); return;
          }
          entries[cursor.key] = cursor.value;
          cursor.continue();
        };
      });
    }
    async commit(expectedRevision, changes, { replace = false } = {}) {
      validEntries(changes, true);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fault('invalid');
      return this.write(expectedRevision, { ...changes }, replace, null);
    }
    async write(expectedRevision, changes, replace, legacyImport) {
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = this.transaction('readwrite'); }
        catch (error) { reject(asFault(error, 'write')); return; }
        let error = null;
        let revision;
        tx.onerror = () => {};
        tx.onabort = () => reject(error || fault('write', tx.error));
        // 单条 put 成功不算保存成功，整个事务完成后才兑现 Promise。
        tx.oncomplete = () => resolve({ revision });
        tx.objectStore(META).get('head').onsuccess = event => {
          try {
            const head = event.target.result;
            validHead(head);
            if (head.revision !== expectedRevision) throw fault('conflict');
            if (legacyImport ? head.initialized : !head.initialized) throw fault(legacyImport ? 'conflict' : 'notReady');
            if (head.revision === Number.MAX_SAFE_INTEGER) throw fault('invalid');
            const store = tx.objectStore(LEDGER);
            if (replace) store.clear();
            for (const [key, value] of Object.entries(changes)) {
              if (value === null) store.delete(key);
              else store.put(value, key);
            }
            revision = head.revision + 1;
            tx.objectStore(META).put({ ...head, revision, initialized: true,
              legacyImport: legacyImport || head.legacyImport }, 'head');
          } catch (cause) {
            error = asFault(cause, 'write');
            try { tx.abort(); } catch (_) { /* 事务可能已因浏览器错误终止。 */ }
          }
        };
      });
    }
    async migrateLegacy(storage, validate) {
      const before = await this.read();
      if (before.initialized) return before;
      // 必须显式传入业务校验器，不以“JSON 能解析”代替业务校验。
      if (typeof validate !== 'function') throw fault('invalid');
      const entries = readLegacy(storage);
      try { if (await validate({ ...entries }) !== true) throw fault('invalid'); }
      catch (error) { throw fault('invalid', error); }
      if (!sameEntries(entries, readLegacy(storage))) throw fault('conflict');
      await this.write(before.revision, entries, true, { count: Object.keys(entries).length });
      const after = await this.read();
      if (!sameEntries(entries, after.entries) || !after.initialized) throw fault('verify');
      // 故意不删除、不改写原 localStorage，数据和迁移标记在同一事务提交。
      return after;
    }
  }

  function open(options = {}) {
    const { name = 'jizhangben-pwa-ledger', timeoutMs = 10000, onClose } = options;
    let factory;
    try { factory = Object.prototype.hasOwnProperty.call(options, 'factory') ? options.factory : root.indexedDB; }
    catch (error) { return Promise.reject(fault('open', error)); }
    if (!factory || typeof factory.open !== 'function') return Promise.reject(fault('unsupported'));
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => fail(fault('timeout')), timeoutMs);
      try { request = factory.open(name, VERSION); }
      catch (error) { fail(fault('open', error)); return; }
      request.onblocked = () => fail(fault('blocked'));
      request.onerror = () => fail(fault('open', request.error));
      request.onupgradeneeded = event => {
        if (settled || event.oldVersion !== 0) { request.transaction.abort(); return; }
        const db = request.result;
        db.createObjectStore(LEDGER);
        db.createObjectStore(META).add({ schema: VERSION, revision: 0, initialized: false, legacyImport: null }, 'head');
      };
      request.onsuccess = async () => {
        if (settled) { request.result.close(); return; }
        const store = new LedgerStore(request.result, onClose);
        try {
          await store.read();
          if (settled) { store.close(); return; }
          settled = true; clearTimeout(timer); resolve(store);
        } catch (error) { store.close(); fail(error); }
      };
    });
  }

  async function persistenceStatus(options = {}) {
    const request = options.request === true;
    let storage;
    try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : root.navigator && root.navigator.storage; }
    catch (_) { return { status: 'unavailable', requested: false, message: '无法确认持久存储状态，请定期备份。' }; }
    if (!storage || typeof storage.persisted !== 'function') {
      return { status: 'unsupported', requested: false, message: '浏览器未提供持久存储状态，请定期备份。' };
    }
    let requested = false;
    try {
      let granted = await storage.persisted();
      if (!granted && request && typeof storage.persist === 'function') {
        requested = true;
        await storage.persist();
        granted = await storage.persisted();
      }
      return { status: granted ? 'granted' : 'not-granted', requested,
        message: granted ? '浏览器已授予持久存储；仍需备份，清除网站数据仍可能删除账目。' : '浏览器尚未授予持久存储，请定期备份。' };
    } catch (_) {
      return { status: 'unavailable', requested, message: '无法确认持久存储状态，请定期备份。' };
    }
  }
  root.LedgerDatabase = Object.freeze({ open, persistenceStatus });
})(globalThis);
