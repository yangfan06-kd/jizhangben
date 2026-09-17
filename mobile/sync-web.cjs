const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const webDir = path.join(repoRoot, "mobile", "www");

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "index.html"), path.join(webDir, "index.html"));
fs.cpSync(path.join(repoRoot, "css"), path.join(webDir, "css"), { recursive: true });
fs.cpSync(path.join(repoRoot, "js"), path.join(webDir, "js"), { recursive: true });

console.log(`已同步 App 网页资源：${path.relative(repoRoot, webDir)}`);
