// 生成独立、可核对的测试部署副本；不上传、不读取用户账本。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { build, safePath } = require('./build.cjs');
const baseline = require('../docs/PWA_PUBLIC_FILES_STAGE0.json');
const config = require('./public-files.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expectedFiles = [...baseline.sourceFiles,
  ...Object.values(config.extraSourceFiles), ...Object.values(config.storagePreviewSourceFiles),
  ...config.generatedFiles, ...config.storagePreviewGeneratedFiles].sort();
const headers = Object.freeze({
  'Cache-Control': 'no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
});
const mime = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' });

function listFiles(root, prefix = '') {
  return fs.readdirSync(prefix ? safePath(root, prefix) : root, { withFileTypes: true }).flatMap(entry => {
    const file = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw Error('部署副本不允许链接：' + file);
    if (entry.isDirectory()) return listFiles(root, file);
    if (!entry.isFile()) throw Error('部署副本不允许特殊文件：' + file);
    return [file];
  }).sort();
}

function verifySite(site) {
  if (fs.lstatSync(site).isSymbolicLink()) throw Error('部署根目录不允许链接');
  site = fs.realpathSync(site);
  if (JSON.stringify(listFiles(site)) !== JSON.stringify(expectedFiles)) throw Error('部署文件清单不符，禁止夹带或缺失文件');
  const bytes = new Map(expectedFiles.map(file => [file, fs.readFileSync(safePath(site, file))]));
  const info = JSON.parse(bytes.get('build-info.json'));
  if (info.builder !== 'jizhangben-pwa-stage1' || !info.offlineCapable || !/^[a-f0-9]{64}$/.test(info.buildId)) throw Error('不是离线预览构建');
  const worker = bytes.get('service-worker.js').toString('utf8');
  const match = worker.match(/^const RELEASE = (.+);$/m);
  if (!match) throw Error('离线资源清单缺失');
  const release = JSON.parse(match[1]);
  if (release.version !== info.buildId) throw Error('离线版本不一致');
  const verifyInventory = (entries, expected) => {
    if (!Array.isArray(entries) || JSON.stringify(entries.map(x => x.file).sort()) !== JSON.stringify(expected)) throw Error('资源摘要清单不符');
    for (const entry of entries) if (sha256(bytes.get(entry.file)) !== entry.sha256) throw Error('资源摘要不符：' + entry.file);
  };
  verifyInventory(info.files, expectedFiles.filter(file => !['build-info.json', 'service-worker.js'].includes(file)));
  verifyInventory(release.files, expectedFiles.filter(file => file !== 'service-worker.js'));
  if (!bytes.get('runtime-config.js').toString().includes(info.buildId)) throw Error('运行配置版本不一致');
  const files = expectedFiles.map(file => ({ file, size: bytes.get(file).length, sha256: sha256(bytes.get(file)) }));
  return { buildId: info.buildId, fileCount: files.length, files, bytes };
}

function preparePackage({ root = path.resolve(__dirname, '..') } = {}) {
  root = fs.realpathSync(root);
  const candidate = build({ root, storagePreview: true });
  const verified = verifySite(candidate.output);
  const parent = safePath(root, 'output/pwa-test-packages');
  fs.mkdirSync(parent, { recursive: true });
  const output = safePath(root, 'output/pwa-test-packages/' + verified.buildId);
  if (fs.existsSync(output)) {
    const previous = verifySite(safePath(output, 'site'));
    const receipt = JSON.parse(fs.readFileSync(safePath(output, 'review.json')));
    if (JSON.stringify(previous.files) !== JSON.stringify(verified.files) || JSON.stringify(receipt.files) !== JSON.stringify(verified.files)) throw Error('已有固定副本不一致，已停止，未覆盖');
    return { output, buildId: verified.buildId, fileCount: verified.fileCount, reused: true };
  }
  const staging = fs.mkdtempSync(path.join(parent, 'prepare-'));
  try {
    const site = safePath(staging, 'site'); fs.mkdirSync(site);
    for (const [file, bytes] of verified.bytes) {
      const target = safePath(site, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    verifySite(site);
    const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; } };
    const gitStatus = git(['status', '--porcelain']);
    fs.writeFileSync(safePath(staging, 'review.json'), JSON.stringify({
      format: 1, purpose: '仅供合成账本与借用 iPhone 验收', createdAt: new Date().toISOString(),
      buildId: verified.buildId, sourceCommit: git(['rev-parse', 'HEAD']),
      workingTreeDirty: gitStatus === null ? null : Boolean(gitStatus), files: verified.files,
      deployment: { publicUrl: null, deployed: false, realIPhoneAccepted: false },
      hosting: { httpsRequired: true, fixedOriginRequired: true, missingResourceStatus: 404,
        noHtmlFallback: true, noHtmlRedirect: true, headers }
    }, null, 2));
    fs.copyFileSync(safePath(root, 'pwa/hosting/nginx-test.conf.example'), safePath(staging, 'nginx-test.conf.example'));
    fs.writeFileSync(safePath(staging, '部署前必读.txt'), '仅发布 site 文件夹内的文件。review.json 和此目录其他文件仅供本机审阅。\n尚未公开部署，也未通过真实 iPhone 验收。仅用合成账本。\n固定 HTTPS 测试来源；不改网站来源、不发送 Clear-Site-Data、不清理浏览器数据。\n完整说明：项目 docs/PWA_TEST_DEPLOYMENT.md。\n');
    fs.renameSync(staging, output);
  } finally {
    // mkdtemp 产生的绝对路径经过工作目录边界检查，不删除已存在的版本副本。
    safePath(root, path.relative(root, staging).split(path.sep).join('/'));
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  }
  return { output, buildId: verified.buildId, fileCount: verified.fileCount, reused: false };
}

module.exports = { preparePackage, verifySite, expectedFiles, headers, mime };
if (require.main === module) {
  try { console.log(JSON.stringify(preparePackage(), null, 2)); }
  catch (error) { console.error('测试部署包准备失败：' + error.message); process.exitCode = 1; }
}
