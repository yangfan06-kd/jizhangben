const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const webDir = path.join(repoRoot, "mobile", "www");
const offlineMode = /^(1|true|yes)$/i.test(String(process.env.JIZHANGBEN_OFFLINE_MODE || "").trim());
const apiBaseUrl = (process.env.JIZHANGBEN_API_BASE_URL || "http://localhost:8000/api")
  .trim()
  .replace(/\/$/, "");

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const mobileIndexHtml = indexHtml.replace(
  "</head>",
  "  <script src=\"runtime-config.js\"></script>\n</head>"
);
fs.writeFileSync(path.join(webDir, "index.html"), mobileIndexHtml, "utf8");
fs.writeFileSync(
  path.join(webDir, "runtime-config.js"),
  `window.JIZHANGBEN_OFFLINE_MODE = ${offlineMode ? "true" : "false"};\n` +
    `window.JIZHANGBEN_API_BASE_URL = ${offlineMode ? "null" : JSON.stringify(apiBaseUrl)};\n`,
  "utf8"
);
fs.cpSync(path.join(repoRoot, "css"), path.join(webDir, "css"), { recursive: true });
fs.cpSync(path.join(repoRoot, "js"), path.join(webDir, "js"), { recursive: true });
fs.copyFileSync(path.join(repoRoot, "favicon.svg"), path.join(webDir, "favicon.svg"));

console.log(`已同步 App 网页资源：${path.relative(repoRoot, webDir)}`);
console.log(offlineMode ? "App 运行模式：个人离线模式" : `App API 地址：${apiBaseUrl}`);
