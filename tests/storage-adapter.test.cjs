const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime } = require('./runtime.cjs');

function nativeStore() {
  const disk = {};
  return {
    disk, fail: false, commits: 0,
    readEntries() { return JSON.stringify(disk); },
    writeEntries(raw) {
      if (this.fail) return false;
      const changes = JSON.parse(raw);
      Object.assign(disk, changes);
      this.commits++;
      return true;
    }
  };
}

test('native reads preserve untouched 1.64 data without populating defaults or rewriting categories', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/upgrade-v1.64-synthetic.json'), 'utf8')).storage;
  const bridge = nativeStore();
  const runtime = createRuntime(fixture, { window: { JizhangbenStorage: bridge } });
  runtime.run('loadBooks();load();loadAccounts();loadCustomTypes();loadCustomCategories();loadCustomCategoryIcons();loadCategorySystem()');
  assert.equal(bridge.commits, 0);
  assert.equal(runtime.run('JSON.stringify(appStorage.entries("jizhangben_"))'), JSON.stringify(fixture));
  assert.deepEqual(runtime.localStorage.toObject(), fixture);
});

for (const version of ['1.60', '1.64']) {
  test(`native v${version} upgrade and backup preserve ledger and custom category identity`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/upgrade-v${version}-synthetic.json`), 'utf8')).storage;
    const bridge = nativeStore();
    const runtime = createRuntime(fixture, { window: { JizhangbenStorage: bridge } });
    const startup = 'loadBooks();load();loadAccounts();loadCustomTypes();loadCustomCategories();loadCustomCategoryIcons();loadCategorySystem()';
    runtime.run(startup);
    const exported = JSON.parse(runtime.run('JSON.stringify(appStorage.entries("jizhangben_"))'));
    for (const [key, raw] of Object.entries(fixture)) {
      if (key !== 'jizhangben_category_system') assert.equal(exported[key], raw, key);
    }
    const before = JSON.parse(fixture.jizhangben_category_system), after = JSON.parse(exported.jizhangben_category_system);
    const withoutSide = group => { const result = { ...group }; delete result.side; return result; };
    assert.deepEqual(after.groups.map(withoutSide), before.groups.map(withoutSide));
    assert.deepEqual(after.hidden, before.hidden);
    // 恢复到另一全新原生副本，备份往返仍保留同一组值。
    const restored = createRuntime({}, { window: { JizhangbenStorage: nativeStore() } });
    restored.run(`replaceBackupStorage(${JSON.stringify(exported)});${startup}`);
    assert.deepEqual(JSON.parse(restored.run('JSON.stringify(appStorage.entries("jizhangben_"))')), exported);
  });
}

test('acknowledged native write survives a lost WebView copy after restart', () => {
  const bridge = nativeStore(), stale = { jizhangben_records_1: '[]' };
  let runtime = createRuntime(stale, { window: { JizhangbenStorage: bridge } });
  runtime.run(`appStorage.set("jizhangben_records_1", ${JSON.stringify('[{"id":1,"amountCents":1000}]')})`);
  runtime = createRuntime(stale, { window: { JizhangbenStorage: bridge } });
  assert.equal(runtime.run('appStorage.get("jizhangben_records_1")'), '[{"id":1,"amountCents":1000}]');
  assert.equal(runtime.run('appStorage.entries("jizhangben_").jizhangben_records_1'), bridge.disk.jizhangben_records_1);
});

test('native deletion tombstone prevents stale WebView entries from reappearing in reads and exports', () => {
  const bridge = nativeStore(), stale = { jizhangben_deleted: '旧值', jizhangben_keep: '保留' };
  let runtime = createRuntime(stale, { window: { JizhangbenStorage: bridge } });
  runtime.run('appStorage.remove("jizhangben_deleted")');
  runtime = createRuntime(stale, { window: { JizhangbenStorage: bridge } });
  assert.equal(runtime.run('appStorage.get("jizhangben_deleted")'), null);
  assert.equal(runtime.run('JSON.stringify(appStorage.entries("jizhangben_"))'), '{"jizhangben_keep":"保留"}');
});

test('failed native commit leaves disk, cache and WebView copy unchanged', () => {
  const bridge = nativeStore();
  const runtime = createRuntime({ jizhangben_key: '旧值' }, { window: { JizhangbenStorage: bridge } });
  runtime.run('appStorage.set("jizhangben_key", "旧值")');
  bridge.fail = true;
  assert.throws(() => runtime.run('appStorage.set("jizhangben_key", "新值")'), /未能保存/);
  assert.equal(bridge.disk.jizhangben_key, '旧值');
  assert.equal(runtime.run('appStorage.get("jizhangben_key")'), '旧值');
  assert.equal(runtime.localStorage.getItem('jizhangben_key'), '旧值');
});

test('WebView quota failure does not discard a committed native value', () => {
  const bridge = nativeStore();
  const runtime = createRuntime({}, { window: { JizhangbenStorage: bridge } });
  runtime.localStorage.setItem = () => { throw Error('quota'); };
  runtime.run('appStorage.set("jizhangben_key", "已保存")');
  assert.equal(runtime.run('appStorage.get("jizhangben_key")'), '已保存');
  assert.equal(createRuntime({}, { window: { JizhangbenStorage: bridge } }).run('appStorage.get("jizhangben_key")'), '已保存');
});

test('native backup replacement commits once and failure preserves the entire prior ledger', () => {
  const bridge = nativeStore();
  const runtime = createRuntime({ jizhangben_old: '旧值', device_flag: '设备设置' }, { window: { JizhangbenStorage: bridge } });
  runtime.run('replaceBackupStorage({ jizhangben_new: "新值" })');
  assert.equal(bridge.commits, 1);
  assert.equal(runtime.run('JSON.stringify(appStorage.entries("jizhangben_"))'), '{"jizhangben_new":"新值"}');
  bridge.fail = true;
  assert.throws(() => runtime.run('replaceBackupStorage({ jizhangben_wrong: "不应写入" })'), /未能保存/);
  assert.equal(runtime.run('JSON.stringify(appStorage.entries("jizhangben_"))'), '{"jizhangben_new":"新值"}');
  assert.equal(runtime.localStorage.getItem('device_flag'), '设备设置');
});

test('invalid native read fails closed and never overwrites old browser data with defaults', () => {
  const bridge = nativeStore();bridge.readEntries = () => '';
  const runtime = createRuntime({ jizhangben_key: '原有数据' }, { window: { JizhangbenStorage: bridge } });
  assert.throws(() => runtime.run('appStorage.get("jizhangben_key")'), /停止写入/);
  assert.throws(() => runtime.run('appStorage.set("jizhangben_key", "默认值")'), /停止写入/);
  assert.equal(bridge.commits, 0);
  assert.equal(runtime.localStorage.getItem('jizhangben_key'), '原有数据');
});

test('browser fallback still reports WebView storage failure and native store excludes device settings', () => {
  const plain = createRuntime();plain.localStorage.setItem = () => { throw Error('quota'); };
  assert.throws(() => plain.run('appStorage.set("jizhangben_key", "值")'), /quota/);
  const bridge = nativeStore(), runtime = createRuntime({}, { window: { JizhangbenStorage: bridge } });
  runtime.run('appStorage.set("device_key", "本机设置")');
  assert.equal(bridge.commits, 0);
  assert.equal(runtime.localStorage.getItem('device_key'), '本机设置');
});
