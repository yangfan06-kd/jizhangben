const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const allowed = {
  '/': ['pwa/storage-lab/index.html', 'text/html; charset=utf-8'],
  '/checks.js': ['pwa/storage-lab/checks.js', 'text/javascript; charset=utf-8'],
  '/ledger-database.js': ['pwa/ledger-database.js', 'text/javascript; charset=utf-8'],
  '/fixture-160.json': ['tests/fixtures/upgrade-v1.60-synthetic.json', 'application/json'],
  '/fixture-164.json': ['tests/fixtures/upgrade-v1.64-synthetic.json', 'application/json']
};
http.createServer((req, res) => {
  const item = allowed[req.url];
  if (!item) { res.writeHead(404); res.end('未找到实验资源'); return; }
  res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(root, item[0])).pipe(res);
}).listen(4175, '127.0.0.1', () => console.log('独立存储实验：http://127.0.0.1:4175/'));
