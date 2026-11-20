// 仅提供独立产物，绑定本机；不暴露项目根目录或真实备份。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const storagePreview = process.argv.includes('--storage');
const root = path.resolve(__dirname, storagePreview ? '../output/pwa-storage-preview' : '../output/pwa-dist');
const port = storagePreview ? 4176 : 4173;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const { safePath } = require('./build.cjs');
const server = http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // 同时检查根路径和部署子路径；二者仅用于独立测试来源。
    if (pathname.startsWith('/ledger-preview/')) pathname = pathname.slice('/ledger-preview'.length);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = safePath(root, relative);
    if (!fs.statSync(file).isFile()) throw Error('not_file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch (_) { res.writeHead(404); res.end('未找到页面'); }
});
server.listen(port, '127.0.0.1', () => console.log(`本机预览：http://127.0.0.1:${port}/ledger-preview/`));
