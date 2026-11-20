// 仅在本机核验固定部署副本；与真实 HTTPS 托管验收分开记录。
const http = require('node:http');
const path = require('node:path');
const { verifySite, headers, mime } = require('./prepare-test-package.cjs');
function createServer({ site, mount = '/ledger-preview/' }) {
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(mount)) throw Error('测试路径不安全');
  const verified = verifySite(site);
  return http.createServer((req, res) => {
    const finish = (status, text) => { res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : text); };
    if (!['GET', 'HEAD'].includes(req.method)) return finish(405, '仅支持读取');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { return finish(400, '地址无效'); }
    if (mount !== '/' && pathname === mount.slice(0, -1)) { res.writeHead(308, { ...headers, Location: mount }); return res.end(); }
    if (!pathname.startsWith(mount)) return finish(404, '未找到页面');
    const file = pathname.slice(mount.length) || 'index.html';
    const bytes = verified.bytes.get(file);
    if (!bytes) return finish(404, '未找到页面');
    res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)], 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
}
module.exports = { createServer };
if (require.main === module) {
  try {
    if (!process.argv[2]) throw Error('请提供固定部署副本中的 site 路径');
    createServer({ site: path.resolve(process.argv[2]) }).listen(4177, '127.0.0.1', () => console.log('部署副本本机核验：http://127.0.0.1:4177/ledger-preview/'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
