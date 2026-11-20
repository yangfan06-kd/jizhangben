const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { build, safePath, validateReferences } = require('../pwa/build.cjs');
const baseline = require('../docs/PWA_PUBLIC_FILES_STAGE0.json');
const config = require('../pwa/public-files.json');
const sourceRoot = path.resolve(__dirname, '..');

test('PWA build isolates public files, preserves source, supports subpaths and keeps last good build on failure', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pwa-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...baseline.sourceFiles, ...Object.keys(config.extraSourceFiles)]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'backups'));
  fs.writeFileSync(path.join(root, 'backups/private.json'), '禁止公开');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=禁止公开');
  fs.mkdirSync(path.join(root, 'pwa/storage-lab'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'pwa/ledger-database.js'), path.join(root, 'pwa/ledger-database.js'));
  fs.writeFileSync(path.join(root, 'pwa/storage-lab/index.html'), '独立实验页禁止发布');
  const source = fs.readFileSync(path.join(root, 'index.html'));
  const { output, fileCount } = build({ root });
  assert.equal(fileCount, 46);
  assert.deepEqual(fs.readFileSync(path.join(root, 'index.html')), source);
  assert.equal(fs.existsSync(path.join(output, 'backups')), false);
  assert.equal(fs.existsSync(path.join(output, '.env')), false);
  assert.equal(fs.existsSync(path.join(output, 'storage-lab')), false);
  assert.equal(fs.existsSync(path.join(output, 'ledger-database.js')), false);
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.ok(html.indexOf('runtime-config.js') < html.indexOf('js/constants.js'));
  assert.match(html, /viewport-fit=cover/);
  assert.match(fs.readFileSync(path.join(output, 'runtime-config.js'), 'utf8'), /OFFLINE_MODE = true/);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.webmanifest')));
  for (const base of ['https://example.test/', 'https://example.test/ledger/']) {
    assert.equal(new URL(manifest.start_url, base).href, base);
    assert.equal(new URL(manifest.scope, base).href, base);
    for (const icon of manifest.icons) assert.ok(new URL(icon.src, base).href.startsWith(base));
  }
  assert.equal(manifest.display, 'standalone');
  for (const [file, size] of [['app-192.png', 192], ['app-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const bytes = fs.readFileSync(path.join(output, 'icons', file));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'build-info.json'))).offlineReady, false);
  fs.copyFileSync(path.join(sourceRoot, 'pwa/app-storage.js'), path.join(root, 'pwa/app-storage.js'));
  fs.copyFileSync(path.join(sourceRoot, 'pwa/fund-storage.js'), path.join(root, 'pwa/fund-storage.js'));
  fs.copyFileSync(path.join(sourceRoot, 'pwa/management-storage.js'), path.join(root, 'pwa/management-storage.js'));
  fs.copyFileSync(path.join(sourceRoot, 'pwa/backup.js'), path.join(root, 'pwa/backup.js'));
  fs.copyFileSync(path.join(sourceRoot, 'pwa/offline.js'), path.join(root, 'pwa/offline.js'));
  fs.copyFileSync(path.join(sourceRoot, 'pwa/sw-template.js'), path.join(root, 'pwa/sw-template.js'));
  const ordinaryHtml = fs.readFileSync(path.join(output, 'index.html'));
  const candidate = build({ root, storagePreview: true });
  assert.equal(candidate.fileCount, 53);
  assert.notEqual(candidate.output, output);
  assert.deepEqual(fs.readFileSync(path.join(output, 'index.html')), ordinaryHtml);
  const candidateHtml = fs.readFileSync(path.join(candidate.output, 'index.html'), 'utf8');
  assert.ok(candidateHtml.indexOf('ledger-database.js') < candidateHtml.indexOf('pwa-app-storage.js'));
  assert.ok(candidateHtml.indexOf('pwa-app-storage.js') < candidateHtml.indexOf('js/app.js'));
  assert.ok(candidateHtml.indexOf('pwa-app-storage.js') < candidateHtml.indexOf('pwa-fund-storage.js'));
  assert.ok(candidateHtml.indexOf('pwa-fund-storage.js') < candidateHtml.indexOf('js/app.js'));
  assert.ok(candidateHtml.indexOf('pwa-fund-storage.js') < candidateHtml.indexOf('pwa-management-storage.js'));
  assert.ok(candidateHtml.indexOf('pwa-management-storage.js') < candidateHtml.indexOf('js/app.js'));
  assert.ok(candidateHtml.indexOf('pwa-management-storage.js') < candidateHtml.indexOf('pwa-backup.js'));
  assert.ok(candidateHtml.indexOf('pwa-backup.js') < candidateHtml.indexOf('js/app.js'));
  assert.match(candidateHtml, /pwa-offline\.js\?v=[a-f0-9]{64}/);
  assert.match(candidateHtml, /integrity="sha256-/);
  const info = JSON.parse(fs.readFileSync(path.join(candidate.output, 'build-info.json')));
  const sw = fs.readFileSync(path.join(candidate.output, 'service-worker.js'), 'utf8');
  assert.ok(sw.includes(info.buildId));
  assert.match(info.buildId, /^[a-f0-9]{64}$/);
  assert.equal(info.offlineCapable, true);
  assert.equal(info.offlineReady, false);
  assert.equal(fs.existsSync(path.join(output, 'service-worker.js')), false);
  assert.equal(fs.existsSync(path.join(candidate.output, 'storage-lab')), false);
  const old = fs.readFileSync(path.join(output, 'build-info.json'));
  fs.appendFileSync(path.join(root, 'index.html'), '<script src="https://example.test/tracker.js"></script>');
  assert.throws(() => build({ root }), /未允许/);
  assert.deepEqual(fs.readFileSync(path.join(output, 'build-info.json')), old);
  fs.writeFileSync(path.join(root, 'index.html'), source);
  fs.unlinkSync(path.join(root, 'js/app.js'));
  assert.throws(() => build({ root }), /ENOENT/);
  assert.deepEqual(fs.readFileSync(path.join(output, 'build-info.json')), old);
});

test('PWA boundary rejects traversal, external references and linked source paths', t => {
  for (const name of ['../private.json', '/private.json', 'C:/private.json', 'js\\private.js']) {
    assert.throws(() => safePath(sourceRoot, name));
  }
  assert.throws(() => validateReferences('<script src="//other.test/code.js"></script>', new Set()));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pwa-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.symlinkSync(sourceRoot, path.join(root, 'linked'), 'junction');
  assert.throws(() => safePath(root, 'linked/index.html'), /链接/);
});

for (const fault of ['quota', 'digest']) test('worker install rollback preserves unrelated caches on ' + fault, async () => {
  const vm = require('node:vm'), crypto = require('node:crypto');
  const version = 'a'.repeat(64), scope = 'https://example.test/ledger/';
  const release = { version, files: [{ file: 'index.html', sha256: crypto.createHash('sha256').update('程序').digest('hex') }] };
  const names = new Map([['other-app-cache', new Map([['keep', '保留']])]]), listeners = {};
  const caches = {
    has: async name => names.has(name), keys: async () => [...names.keys()], delete: async name => names.delete(name),
    async open(name) {
      if (!names.has(name)) names.set(name, new Map());
      return { match: async key => names.get(name).get(key), put: async (key, value) => {
        if (fault === 'quota') throw new DOMException('空间不足', 'QuotaExceededError');
        names.get(name).set(key, value);
      } };
    }
  };
  const context = { URL, Response, Request, DOMException, crypto: crypto.webcrypto, caches,
    fetch: async () => new Response(fault === 'digest' ? '错误资源' : '程序'),
    self: { registration: { scope }, addEventListener: (type, fn) => { listeners[type] = fn; } } };
  Object.defineProperty(context, 'indexedDB', { get() { throw Error('禁止访问账本数据库'); } });
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'pwa/sw-template.js'), 'utf8').replace('__PWA_RELEASE_MANIFEST__', JSON.stringify(release)), context);
  let install;
  listeners.install({ waitUntil(promise) { install = promise; } });
  await assert.rejects(install);
  assert.deepEqual([...names.keys()], ['other-app-cache']);
  assert.equal(names.get('other-app-cache').get('keep'), '保留');
});
