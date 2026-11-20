/* 实际浏览器 IndexedDB 检查；只删除本轮创建的随机实验数据库。 */
'use strict';
const assert = (condition, message = '检测结果不符合预期') => { if (!condition) throw Error(message); };
const equal = (a, b) => {
  const keys = Object.keys(a).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every(key => a[key] === b[key]);
};
function memoryStorage(values) {
  const state = { ...values };
  return { state, get length() { return Object.keys(state).length; },
    key(index) { return Object.keys(state)[index] ?? null; }, getItem(key) { return state[key] ?? null; } };
}
async function rejects(action, code) {
  let error;
  try { await action(); } catch (cause) { error = cause; }
  assert(error && error.code === code, '应停止操作并返回预期的中文错误：' + code);
}
function rawOpen(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function rawTransaction(db, stores, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    action(tx);
  });
}
function removeExperiment(name) {
  if (!name.startsWith('jizhangben-storage-lab-')) throw Error('拒绝删除非实验数据库');
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error('实验连接未关闭'));
  });
}
async function verifyStorageCheckpoint() {
  const checkpoint = JSON.parse(sessionStorage.getItem('ledger-storage-checkpoint') || 'null');
  assert(checkpoint && checkpoint.name.startsWith('jizhangben-storage-lab-'));
  const store = await LedgerDatabase.open({ name: checkpoint.name });
  try {
    const read = await store.read();
    assert(read.revision === checkpoint.revision && equal(read.entries, checkpoint.entries));
    return { preserved: true, revision: read.revision, keys: Object.keys(read.entries).length };
  } finally { store.close(); }
}
window.verifyStorageCheckpoint = verifyStorageCheckpoint;

document.getElementById('run').onclick = async () => {
  const button = document.getElementById('run');
  button.disabled = true;
  const list = document.getElementById('results');
  list.replaceChildren();
  window.storageLabFinished = false;
  const results = [];
  window.storageLabResults = results;
  let next = 0;
  const prefix = 'jizhangben-storage-lab-' + crypto.randomUUID() + '-';
  async function check(name, action) {
    const databases = new Set();
    const connections = [];
    const create = async (existingName) => {
      const name = existingName || prefix + (++next);
      databases.add(name);
      const store = await LedgerDatabase.open({ name });
      connections.push(store);
      return { store, name };
    };
    const row = document.createElement('li');
    row.textContent = name + '：检测中'; list.appendChild(row);
    try {
      await action(create, databases, connections);
      results.push({ name, passed: true }); row.textContent = name + '：通过';
    } catch (error) {
      results.push({ name, passed: false, message: error.message });
      row.textContent = name + '：失败，' + error.message; row.className = 'failed';
    } finally {
      for (const store of connections) store.close();
      for (const name of databases) {
        try { await removeExperiment(name); }
        catch (error) { results.push({ name: '实验清理', passed: false, message: error.message }); }
      }
    }
  }
  const sample = { jizhangben_records_1: '[{"id":1,"type":"支出","amountCents":1234}]',
    jizhangben_custom_category_icons: '{"自定义":"dining"}' };
  const migrate = (store, values = sample) => store.migrateLegacy(memoryStorage(values), entries => equal(entries, values));
  try {
    await check('未初始化时禁止直接保存', async create => {
      const { store } = await create();
      const initial = await store.read();
      assert(initial.revision === 0 && !initial.initialized && Object.keys(initial.entries).length === 0);
      await rejects(() => store.commit(0, sample), 'notReady');
      assert(!(await store.read()).initialized);
    });
    await check('确认为空的旧存储才允许首次初始化', async create => {
      const { store } = await create();
      const read = await store.migrateLegacy(memoryStorage({ device_flag: '偏好' }), entries => Object.keys(entries).length === 0);
      assert(read.initialized && read.revision === 1 && read.legacyImport.count === 0);
      assert(Object.keys(read.entries).length === 0);
      await store.commit(read.revision, sample);
      assert(equal((await store.read()).entries, sample));
    });
    for (const version of ['160', '164']) {
      await check('旧版 ' + version + ' 合成数据原样迁移和再次打开', async create => {
        const response = await fetch('/fixture-' + version + '.json'); assert(response.ok);
        const original = (await response.json()).storage;
        const storage = memoryStorage({ ...original, device_flag: '设备偏好独立保留' });
        const { store, name } = await create();
        const read = await store.migrateLegacy(storage, entries => equal(entries, original));
        assert(equal(read.entries, original) && read.legacyImport.count === Object.keys(original).length);
        assert(storage.state.device_flag === '设备偏好独立保留');
        assert(Object.entries(original).every(([key, value]) => storage.state[key] === value));
        store.close();
        const reopened = (await create(name)).store;
        assert(equal((await reopened.read()).entries, original));
        const again = await reopened.migrateLegacy({ get length() { throw Error('不能再次读旧副本'); } }, () => false);
        assert(equal(again.entries, original));
      });
    }
    await check('数据库不可用时不回退空账本', async () => {
      await rejects(() => LedgerDatabase.open({ factory: null }), 'unsupported');
      await rejects(() => LedgerDatabase.open({ factory: { open() { throw new DOMException('禁止访问', 'SecurityError'); } } }), 'open');
      await rejects(() => LedgerDatabase.open({ get factory() { throw new DOMException('访问被禁止', 'SecurityError'); } }), 'open');
    });
    await check('旧存储读取失败时停止迁移', async create => {
      const { store } = await create();
      await rejects(() => store.migrateLegacy({ length: 1, key: () => 'jizhangben_records_1', getItem() { throw Error('无法读取'); } }, () => true), 'legacy');
      await rejects(() => store.migrateLegacy({}, () => true), 'legacy');
      const read = await store.read(); assert(read.revision === 0 && !read.initialized);
    });
    await check('校验拒绝或缺少校验器时不写入', async create => {
      const { store } = await create();
      await rejects(() => store.migrateLegacy(memoryStorage(sample), () => false), 'invalid');
      await rejects(() => store.migrateLegacy(memoryStorage(sample)), 'invalid');
      assert((await store.read()).revision === 0);
    });
    await check('迁移校验期间原副本发生变化时停止', async create => {
      const { store } = await create(); const storage = memoryStorage(sample);
      await rejects(() => store.migrateLegacy(storage, () => {
        storage.state.jizhangben_records_1 = '[]'; return true;
      }), 'conflict');
      assert((await store.read()).revision === 0);
      assert(storage.state.jizhangben_records_1 === '[]');
    });
    await check('单条请求成功后事务失败，整批保持原状', async create => {
      const { store } = await create(); const before = await migrate(store);
      const originalPut = IDBObjectStore.prototype.put;
      let oneRequestSucceeded = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = originalPut.apply(this, args);
        if (this.name === 'ledger' && !oneRequestSucceeded) {
          const tx = this.transaction;
          request.addEventListener('success', () => {
            if (!oneRequestSucceeded) { oneRequestSucceeded = true; tx.abort(); }
          });
        }
        return request;
      };
      try { await rejects(() => store.commit(before.revision, {
        jizhangben_records_1: '[]', jizhangben_custom_category_icons: '{}'
      }), 'write'); } finally { IDBObjectStore.prototype.put = originalPut; }
      const after = await store.read();
      assert(oneRequestSucceeded && after.revision === before.revision && equal(after.entries, before.entries));
    });
    await check('事务失败后可以重试，提交与删除原子生效', async create => {
      const { store } = await create(); const before = await migrate(store);
      const result = await store.commit(before.revision, { jizhangben_records_1: '[]', jizhangben_custom_category_icons: null });
      const after = await store.read();
      assert(after.revision === result.revision && Object.keys(after.entries).length === 1 && after.entries.jizhangben_records_1 === '[]');
      await rejects(() => store.commit(after.revision, { device_flag: '不能混入设备设置' }), 'invalid');
    });
    await check('模拟空间不足时保留原账本和中文错误', async create => {
      const { store } = await create(); const before = await migrate(store);
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'ledger') throw new DOMException('模拟配额不足', 'QuotaExceededError');
        return originalPut.apply(this, args);
      };
      try { await rejects(() => store.commit(before.revision, { jizhangben_records_1: '[]' }), 'write'); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      const after = await store.read(); assert(after.revision === before.revision && equal(after.entries, before.entries));
      await store.commit(after.revision, { jizhangben_records_1: '[]' });
      assert((await store.read()).entries.jizhangben_records_1 === '[]');
    });
    await check('两个连接并发保存，旧版本不能覆盖新内容', async create => {
      const first = await create(); const before = await migrate(first.store);
      const second = await create(first.name);
      const results = await Promise.allSettled([
        first.store.commit(before.revision, { jizhangben_records_1: '["甲"]' }),
        second.store.commit(before.revision, { jizhangben_records_1: '["乙"]' })
      ]);
      assert(results.filter(x => x.status === 'fulfilled').length === 1);
      const failure = results.find(x => x.status === 'rejected'); assert(failure.reason.code === 'conflict');
      const read = await first.store.read(); assert(read.revision === before.revision + 1);
    });
    await check('两个连接同时迁移，只有一份初始化提交', async create => {
      const first = await create(); const second = await create(first.name);
      const result = await Promise.allSettled([migrate(first.store), migrate(second.store)]);
      assert(result.some(x => x.status === 'fulfilled'));
      const read = await first.store.read(); assert(read.revision === 1 && equal(read.entries, sample));
      for (const item of result.filter(x => x.status === 'rejected')) assert(item.reason.code === 'conflict');
    });
    await check('整本替换和回读保持一致', async create => {
      const { store } = await create(); const before = await migrate(store);
      const replacement = { jizhangben_records_2: '[{"id":2,"amountCents":5000}]' };
      await store.commit(before.revision, replacement, { replace: true });
      assert(equal((await store.read()).entries, replacement));
    });
    await check('整本替换中途失败，清除旧内容也会回滚', async create => {
      const { store } = await create(); const before = await migrate(store);
      const originalPut = IDBObjectStore.prototype.put;
      let aborted = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = originalPut.apply(this, args);
        if (this.name === 'ledger') {
          const tx = this.transaction;
          request.addEventListener('success', () => { if (!aborted) { aborted = true; tx.abort(); } });
        }
        return request;
      };
      try { await rejects(() => store.commit(before.revision, { jizhangben_records_2: '[]' }, { replace: true }), 'write'); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      const after = await store.read();
      assert(aborted && after.revision === before.revision && equal(after.entries, before.entries));
    });
    await check('元数据异常时停止，禁止自动重建', async create => {
      const { store, name } = await create(); await migrate(store); store.close();
      const raw = await rawOpen(name, 1);
      try { await rawTransaction(raw, ['metadata'], tx => tx.objectStore('metadata').delete('head')); }
      finally { raw.close(); }
      await rejects(() => LedgerDatabase.open({ name }), 'invalid');
    });
    await check('连接关闭后拒绝读写', async create => {
      const { store } = await create(); await migrate(store); store.close();
      await rejects(() => store.read(), 'closed');
      await rejects(() => store.commit(1, sample), 'closed');
    });
    await check('数据库版本变化后关闭旧连接', async create => {
      const { store, name } = await create(); await migrate(store);
      const upgraded = await rawOpen(name, 2); upgraded.close();
      await rejects(() => store.read(), 'closed');
      await rejects(() => LedgerDatabase.open({ name }), 'open');
    });
    await check('升级被其他窗口阻挡时不给出可用状态', async (create) => {
      const { store, name } = await create(); await migrate(store); store.close();
      const holder = await rawOpen(name, 1); holder.onversionchange = () => {};
      let request;
      try {
        await rejects(() => LedgerDatabase.open({ name, factory: { open(n) {
          request = indexedDB.open(n, 2); return request;
        } } }), 'blocked');
      } finally { holder.close(); }
      // 被拒绝的打开请求稍后解除阻挡，也不能升级或留下连接。
      await new Promise(resolve => {
        if (request.readyState === 'done') resolve();
        else { request.addEventListener('error', resolve); request.addEventListener('success', resolve); }
      });
      const reopened = await LedgerDatabase.open({ name });
      try { assert(equal((await reopened.read()).entries, sample)); } finally { reopened.close(); }
    });
    await check('持久存储提示只依据实际授权状态', async () => {
      let calls = 0;
      const falseGrant = await LedgerDatabase.persistenceStatus({ request: true, storage: {
        persisted: async () => false, persist: async () => { calls++; return true; }
      } });
      assert(falseGrant.status === 'not-granted' && falseGrant.requested && calls === 1);
      const granted = await LedgerDatabase.persistenceStatus({ request: true, storage: { persisted: async () => true, persist: async () => { throw Error('不应再次申请'); } } });
      assert(granted.status === 'granted' && !granted.requested);
      assert((await LedgerDatabase.persistenceStatus({ storage: {} })).status === 'unsupported');
      assert((await LedgerDatabase.persistenceStatus({ storage: { persisted: async () => { throw Error('无法读取'); } } })).status === 'unavailable');
      assert((await LedgerDatabase.persistenceStatus({ get storage() { throw Error('状态接口被禁用'); } })).status === 'unavailable');
      window.actualPersistenceStatus = await LedgerDatabase.persistenceStatus();
    });
    // 此副本专供页面刷新/新窗口回读，保留到本轮检查结束，不进入正式账本。
    const checkpointName = prefix + 'checkpoint';
    const checkpointStore = await LedgerDatabase.open({ name: checkpointName });
    const checkpoint = await migrate(checkpointStore);
    checkpointStore.close();
    sessionStorage.setItem('ledger-storage-checkpoint', JSON.stringify({ name: checkpointName, entries: checkpoint.entries, revision: checkpoint.revision }));
    window.storageLabCheckpoint = checkpointName;
  } catch (error) { results.push({ name: '实验执行', passed: false, message: error.message }); }
  window.storageLabFinished = true;
  const failed = results.filter(result => !result.passed).length;
  document.getElementById('summary').textContent = results.length + ' 项检测，' + failed + ' 项失败';
  button.disabled = false;
};
