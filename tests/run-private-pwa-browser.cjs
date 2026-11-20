// 私有托管烟测的无回显入口，避免把访问参数写入 Playwright 命令行或脚本文件。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readHiddenInput } = require('../pwa/verify-deployment.cjs');
(async () => {
  const input = await readHiddenInput(), base = new URL(input.url);
  if (base.origin !== 'https://jizhangben-ios-test.awakehornbill.chatgpt.site' || base.pathname !== '/') throw Error('只允许已注册的测试来源');
  const playwright = require(input.playwrightModule);
  const browser = input.engine === 'webkit' ? await playwright.webkit.launch({ headless: true }) : await playwright.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext(), page = await context.newPage();
    page.__pwaFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/upgrade-v1.64-synthetic.json'))).storage;
    page.__deploymentTarget = { url: base.href, headers: input.headers || {} };
    const run = vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pwa-deployment-browser.js'), 'utf8'), { URL });
    const result = await run(page);
    const output = path.resolve(__dirname, '../output/playwright/pwa-hosted'); fs.mkdirSync(output, { recursive: true });
    const safe = { ...result, date: new Date().toISOString(), url: base.href, auth: 'in-memory', realIPhone: 'pending' };
    fs.writeFileSync(path.join(output, (input.engine === 'webkit' ? 'webkit' : 'edge') + '-private-browser.json'), JSON.stringify(safe, null, 2));
    console.log(JSON.stringify(safe));
    if (result.results.some(x => !x.passed) || result.errors.length || result.external.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(() => { console.error('私有入口浏览器检查未完成；请核对浏览器环境及网络，访问参数未写入日志。'); process.exitCode = 1; });
