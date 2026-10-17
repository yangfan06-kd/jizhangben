// 只提供应用静态资源的本机离线预览；不提供账本、备份、Git 或用户文件。
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || 8766);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("请指定 1024 至 65535 的本机端口");
http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^(index\.html|favicon\.svg|(?:js|css)\/[\w.-]+\.(?:js|css))$/.test(name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    let content = fs.readFileSync(path.join(root, name), "utf8");
    if (name === "index.html") content = content.replace("<head>", "<head><script>window.JIZHANGBEN_OFFLINE_MODE=true;</script>");
    response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => process.stdout.write(`本机离线预览：http://127.0.0.1:${port}/\n`));
