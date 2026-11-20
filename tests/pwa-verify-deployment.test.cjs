const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../pwa/build.cjs');
const { headers, mime } = require('../pwa/prepare-test-package.cjs');
const { verifyDeployment } = require('../pwa/verify-deployment.cjs');
const baseline = require('../docs/PWA_PUBLIC_FILES_STAGE0.json');
const config = require('../pwa/public-files.json');
test('HTTPS verification checks all 53 resources plus root and four unknown routes without following redirects', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pwa-https-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...baseline.sourceFiles, ...Object.keys(config.extraSourceFiles), ...Object.keys(config.storagePreviewSourceFiles), 'pwa/sw-template.js']) {
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.resolve(__dirname, '..', file), target);
  }
  const site = build({ root, storagePreview: true }).output, original = global.fetch;
  t.after(() => { global.fetch = original; });
  const seen = [];
  global.fetch = async (url, options) => {
    assert.equal(url.origin, 'https://example.test'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['OAI-Sites-Authorization'], 'Bearer synthetic-test-only');
    seen.push(url.href); const file = url.pathname.slice(1) || 'index.html';
    if (!fs.existsSync(path.join(site, file))) return new Response('未找到页面', { status: 404, headers });
    return new Response(fs.readFileSync(path.join(site, file)), { headers: { ...headers, 'Content-Type': mime[path.extname(file)] } });
  };
  const input = { url: 'https://example.test/', site, headers: { 'OAI-Sites-Authorization': 'Bearer synthetic-test-only' } };
  const passed = await verifyDeployment(input); assert.equal(passed.passed, true); assert.equal(passed.checked, 58); assert.equal(seen.length, 58);
  assert.ok(!JSON.stringify(passed).includes('synthetic-test-only'));
  for (const status of [403, 302]) {
    let count = 0; global.fetch = async () => { count++; return new Response('拒绝或登录跳转', { status, headers: { location: 'https://other.test/' } }); };
    const rejected = await verifyDeployment(input); assert.equal(rejected.passed, false); assert.equal(rejected.checked, 1); assert.equal(count, 1);
  }
  await assert.rejects(verifyDeployment({ ...input, url: 'http://example.test/' }), /HTTPS/);
  await assert.rejects(verifyDeployment({ ...input, url: 'https://name:secret@example.test/' }), /HTTPS/);
});
