// 核对真实 HTTPS 来源；凭据只从隐藏 stdin 读取，不存盘、不跟随跳转。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifySite, headers: expectedHeaders, mime } = require('./prepare-test-package.cjs');
async function verifyDeployment({ url, site, headers = {} }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw Error('需要固定、无凭据且以 / 结尾的 HTTPS 地址');
  const verified = verifySite(site), results = [];
  async function inspect(file, expected, status = 200) {
    const target = new URL(file, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw Error('禁止请求其他来源');
    const faults = [], result = { file: file || '/', expectedStatus: status };
    try {
      const response = await fetch(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      result.status = response.status;
      if (response.status !== status) faults.push('状态码不符');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (expected) {
        result.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (result.sha256 !== expected.sha256) faults.push('内容摘要不符');
        result.contentType = response.headers.get('content-type');
        if (result.contentType !== mime[path.extname(expected.file)]) faults.push('资源类型不符');
      }
      for (const [name, value] of Object.entries(expectedHeaders)) if (response.headers.get(name) !== value) faults.push(name + ' 不符');
      if (response.headers.has('clear-site-data')) faults.push('禁止 Clear-Site-Data');
    } catch (_) { faults.push('无法完成网络请求'); }
    Object.assign(result, { passed: faults.length === 0, faults }); results.push(result); return result;
  }
  const first = await inspect('index.html', verified.files.find(item => item.file === 'index.html'));
  if (first.status === 200) {
    const files = verified.files.filter(item => item.file !== 'index.html');
    for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(item => inspect(item.file, item)));
    await inspect('', verified.files.find(item => item.file === 'index.html'));
    for (const file of ['js/not-a-resource.js', 'api/health', '.env', 'backups/family.json']) await inspect(file, null, 404);
  }
  return { date: new Date().toISOString(), url: base.href, buildId: verified.buildId, passed: results.every(item => item.passed) && results.length === 58,
    checked: results.length, results, realIPhone: 'pending', mobileNetwork: 'pending' };
}
async function readHiddenInput() {
  return new Promise((resolve, reject) => {
    let text = ''; const terminal = process.stdin.isTTY;
    function finish(error) {
      process.stdin.removeListener('data', data); process.stdin.removeListener('end', end);
      if (terminal) process.stdin.setRawMode(false); process.stdin.pause();
      if (error) reject(error); else { try { resolve(JSON.parse(text)); } catch (_) { reject(Error('输入必须为一行 JSON')); } }
    }
    const data = chunk => { text += chunk; if (text.includes('\u0003') || text.length > 65536) finish(Error('输入已取消')); else if (/[\r\n]/.test(text)) finish(); };
    const end = () => finish();
    if (terminal) process.stdin.setRawMode(true);
    process.stderr.write('请通过 stdin 传入核对参数（输入隐藏）。\n');
    process.stdin.setEncoding('utf8'); process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.resume();
  });
}
module.exports = { verifyDeployment, readHiddenInput };
if (require.main === module) (async () => {
  const input = await readHiddenInput(), report = await verifyDeployment(input);
  const output = path.resolve(__dirname, '../output/playwright/pwa-hosted'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'http-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ url: report.url, checked: report.checked, passed: report.passed, failures: report.results.filter(x => !x.passed).slice(0, 5) }));
  if (!report.passed) process.exitCode = 1;
})().catch(() => { console.error('部署核对未完成，请检查参数与网络；凭据未写入报告。'); process.exitCode = 1; });
