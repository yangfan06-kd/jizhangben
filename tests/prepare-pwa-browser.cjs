// 只读取仓库中的合成夹具，生成 Playwright CLI 的初始化代码。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/upgrade-v1.64-synthetic.json'), 'utf8')).storage;
const salt = '00112233445566778899aabbccddeeff';
const hash = crypto.pbkdf2Sync('123456', Buffer.from(salt, 'hex'), 150000, 32, 'sha256').toString('hex');
const lock = JSON.stringify({ version: 1, pin: { salt, hash }, questions: [{ question: '合成问题', salt, hash }], trustedDevice: false });
const output = path.join(root, 'output/playwright/pwa-stage2b/load-fixture.js');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, 'async (page) => { page.__pwaFixture = ' + JSON.stringify(fixture) + '; page.__pwaLock=' + JSON.stringify(lock) + '; return {syntheticKeys:Object.keys(page.__pwaFixture).length}; }');
console.log('已生成合成夹具初始化代码：' + output);
