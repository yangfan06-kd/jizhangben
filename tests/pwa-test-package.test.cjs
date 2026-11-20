const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { preparePackage, verifySite, expectedFiles, headers, mime } = require('../pwa/prepare-test-package.cjs');
const { createServer } = require('../pwa/test-package-server.cjs');
const baseline = require('../docs/PWA_PUBLIC_FILES_STAGE0.json');
const config = require('../pwa/public-files.json');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pwa-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...baseline.sourceFiles, ...Object.keys(config.extraSourceFiles),
    ...Object.keys(config.storagePreviewSourceFiles), 'pwa/sw-template.js', 'pwa/hosting/nginx-test.conf.example']) {
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, file), target);
  }
  fs.mkdirSync(path.join(root, 'backups'));
  fs.writeFileSync(path.join(root, 'backups/family.json'), '家庭私密账本不可发布');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=禁止公开');
  return root;
}

test('deployment package is allowlisted, reproducible and keeps prior snapshots when sources change or fail', t => {
  const root = fixture(t), first = preparePackage({ root }), site = path.join(first.output, 'site');
  assert.equal(first.fileCount, 53);
  assert.equal(verifySite(site).fileCount, expectedFiles.length);
  assert.equal(fs.existsSync(path.join(site, 'review.json')), false);
  assert.equal(fs.existsSync(path.join(site, 'backups')), false);
  assert.equal(fs.existsSync(path.join(site, '.env')), false);
  const receipt = JSON.parse(fs.readFileSync(path.join(first.output, 'review.json')));
  assert.deepEqual(receipt.deployment, { publicUrl: null, deployed: false, realIPhoneAccepted: false });
  assert.equal(preparePackage({ root }).reused, true);
  const original = fs.readFileSync(path.join(site, 'index.html'));
  fs.appendFileSync(path.join(root, 'index.html'), '\n<!-- 测试新版，不含用户资料 -->');
  const next = preparePackage({ root });
  assert.notEqual(next.buildId, first.buildId);
  assert.deepEqual(fs.readFileSync(path.join(site, 'index.html')), original);
  fs.unlinkSync(path.join(root, 'js/app.js'));
  assert.throws(() => preparePackage({ root }), /ENOENT/);
  assert.equal(verifySite(site).buildId, first.buildId);
  assert.equal(verifySite(path.join(next.output, 'site')).buildId, next.buildId);
});

test('deployment verifier refuses modified resources, missing files, extra files, links and forged inventories', t => {
  const root = fixture(t), result = preparePackage({ root }), site = path.join(result.output, 'site');
  const resource = path.join(site, 'js/app.js'), original = fs.readFileSync(resource);
  fs.appendFileSync(resource, '\n// 篡改'); assert.throws(() => verifySite(site), /摘要/); fs.writeFileSync(resource, original);
  fs.unlinkSync(resource); assert.throws(() => verifySite(site), /清单/); fs.writeFileSync(resource, original);
  const extra = path.join(site, 'family.json'); fs.writeFileSync(extra, '不可公开'); assert.throws(() => verifySite(site), /清单/); fs.unlinkSync(extra);
  const linked = path.join(site, 'linked'); fs.symlinkSync(path.join(root, 'backups'), linked, 'junction'); assert.throws(() => verifySite(site), /链接/); fs.unlinkSync(linked);
  const infoPath = path.join(site, 'build-info.json'), bytes = fs.readFileSync(infoPath), info = JSON.parse(bytes);
  info.files[0].sha256 = '0'.repeat(64); fs.writeFileSync(infoPath, JSON.stringify(info)); assert.throws(() => verifySite(site), /摘要/); fs.writeFileSync(infoPath, bytes);
  const reviewPath = path.join(result.output, 'review.json'), review = JSON.parse(fs.readFileSync(reviewPath));
  review.files[0].sha256 = '0'.repeat(64); fs.writeFileSync(reviewPath, JSON.stringify(review));
  assert.throws(() => preparePackage({ root }), /未覆盖/);
  assert.equal(verifySite(site).buildId, result.buildId);
});

test('local deployment contract serves exact bytes with headers, correct MIME and real missing-resource errors', async t => {
  const root = fixture(t), result = preparePackage({ root });
  const server = createServer({ site: path.join(result.output, 'site') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port, base = origin + '/ledger-preview/';
  const verified = verifySite(path.join(result.output, 'site'));
  for (const file of expectedFiles) {
    const response = await fetch(base + file + '?v=' + result.buildId, { redirect: 'manual' });
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('content-type'), mime[path.extname(file)], file);
    for (const [key, value] of Object.entries(headers)) assert.equal(response.headers.get(key), value, file);
    assert.equal(response.headers.get('clear-site-data'), null);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), verified.files.find(x => x.file === file).sha256);
  }
  for (const file of ['js/missing.js', 'api/health', 'review.json', '.env', 'backups/family.json', '..%2f..%2f.env']) {
    const response = await fetch(base + file); assert.equal(response.status, 404, file); assert.doesNotMatch(await response.text(), /<!DOCTYPE/i);
  }
  assert.equal((await fetch(origin + '/')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '%E0%A4%A')).status, 400);
  const redirect = await fetch(base.slice(0, -1), { redirect: 'manual' }); assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/ledger-preview/');
  assert.equal((await fetch(base)).status, 200);
});
