// 独立构建：仅复制允许列表，绝不把项目根目录当作公开站点。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('../docs/PWA_PUBLIC_FILES_STAGE0.json');
const config = require('./public-files.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function safePath(root, relative) {
  if (!relative || /[\\:]|^\/|(^|\/)\.\.?($|\/)/.test(relative)) throw Error('文件路径不安全：' + relative);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw Error('文件超出构建范围');
  let cursor = absolute;
  while (cursor !== root) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('构建路径不能使用链接：' + relative);
    cursor = path.dirname(cursor);
  }
  return absolute;
}

function listFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw Error('产物中不允许链接');
    return entry.isDirectory() ? listFiles(root, name) : [name];
  }).sort();
}

function validateReferences(html, available) {
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const ref = match[1];
    if (ref === './' || ref.startsWith('#')) continue;
    if (!available.has(ref)) throw Error('页面引用了未允许的资源：' + ref);
  }
}

function build({ root = path.resolve(__dirname, '..'), storagePreview = false } = {}) {
  root = fs.realpathSync(root);
  const output = safePath(root, storagePreview ? 'output/pwa-storage-preview' : 'output/pwa-dist');
  const inputs = Object.fromEntries(baseline.sourceFiles.map(file => [file, file]));
  Object.assign(inputs, config.extraSourceFiles);
  if (storagePreview) Object.assign(inputs, config.storagePreviewSourceFiles);
  const targets = [...Object.values(inputs), ...config.generatedFiles, ...(storagePreview ? config.storagePreviewGeneratedFiles : [])];
  if (new Set(targets).size !== targets.length) throw Error('发布文件名称重复');
  // 完整读入并检查，再触碰旧产物；缺失文件不能破坏上一次构建。
  const buffers = new Map();
  for (const [source, target] of Object.entries(inputs)) {
    safePath(root, target);
    buffers.set(target, fs.readFileSync(safePath(root, source)));
  }
  let html = buffers.get('index.html').toString('utf8');
  if (!html.includes('</head>') || !html.includes('<div class="app">')) throw Error('页面结构已改变，停止构建');
  html = html.replace('initial-scale=1.0', 'initial-scale=1.0, viewport-fit=cover')
    .replace('</head>', `<meta name="theme-color" content="#F7F5F1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="记账本预览">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">
<link rel="stylesheet" href="pwa-preview.css">
<script src="runtime-config.js"></script>
</head>`)
    .replace('<div class="app">', `<div class="app">
<aside class="pwa-prototype-note" aria-label="原型状态">网页预览版 · 仅用于测试，尚未支持离线打开。<a href="install.html">桌面使用说明</a></aside>`);
  if (storagePreview) {
    if (!html.includes('<script src="js/app.js"></script>')) throw Error('启动脚本位置已改变');
    html = html.replace('<script src="js/app.js"></script>', '<script src="ledger-database.js"></script>\n<script src="pwa-app-storage.js"></script>\n<script src="pwa-fund-storage.js"></script>\n<script src="pwa-management-storage.js"></script>\n<script src="pwa-backup.js"></script>\n<script src="pwa-offline.js"></script>\n<script src="js/app.js"></script>')
      .replace('网页预览版 · 仅用于测试，尚未支持离线打开。', '离线预览 · 仅使用示例账本。');
  }
  const available = new Set(targets);
  validateReferences(html, available);
  validateReferences(buffers.get('install.html').toString('utf8'), available);
  buffers.set('index.html', Buffer.from(html));
  buffers.set('runtime-config.js', Buffer.from('window.JIZHANGBEN_OFFLINE_MODE = true;\nwindow.JIZHANGBEN_API_BASE_URL = null;\nwindow.JIZHANGBEN_PWA_PREVIEW = true;\n' +
    (storagePreview ? 'document.documentElement.classList.add("pwa-storage-loading");\nwindow.JIZHANGBEN_PWA_BUILD_ID="__PWA_BUILD_ID__";\n' : '')));
  buffers.set('manifest.webmanifest', Buffer.from(JSON.stringify({
    id: './', name: '记账本预览', short_name: '记账本预览', lang: 'zh-CN',
    description: '中文本机记账应用的网页预览版，仅用于测试',
    start_url: './', scope: './', display: 'standalone',
    background_color: '#F7F5F1', theme_color: '#F7F5F1',
    icons: [192, 512].map(size => ({ src: `icons/app-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' }))
  }, null, 2)));
  let buildId = null, workerTemplate = null;
  if (storagePreview) {
    buffers.set('install.html', Buffer.from(buffers.get('install.html').toString('utf8').replace('尚未支持离线打开，存储与备份仍在完善。', '联网打开并等待页面显示“程序资源已核对，可离线使用”后，才可测试断网重新打开。苹果真机表现仍待验收。')));
    workerTemplate = fs.readFileSync(safePath(root, 'pwa/sw-template.js'), 'utf8');
    // 先用占位内容生成版本，再写入版本和资源完整性；避免 HTML 与清单互相求摘要。
    buildId = sha256(Buffer.concat([...buffers].flatMap(([name, bytes]) => [Buffer.from(name + '\n'), bytes]).concat(Buffer.from(workerTemplate))));
    buffers.set('runtime-config.js', Buffer.from(buffers.get('runtime-config.js').toString('utf8').replace('__PWA_BUILD_ID__', buildId)));
    const versionHtml = source => source.replace(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g, (tag, kind, file) => {
      if (!buffers.has(file) || !/\.(js|css|svg|png|webmanifest)$/.test(file)) return tag;
      const versioned = tag.replace('"' + file + '"', '"' + file + '?v=' + buildId + '"');
      return kind === 'script' || /rel="stylesheet"/.test(tag)
        ? versioned.replace(/>$/, ' integrity="sha256-' + crypto.createHash('sha256').update(buffers.get(file)).digest('base64') + '" crossorigin="anonymous">') : versioned;
    });
    let main = versionHtml(buffers.get('index.html').toString('utf8'));
    main = main.replace('<head>', `<head><script>
window.addEventListener('error',function(event){if(event.target&&/^(SCRIPT|LINK)$/.test(event.target.tagName))window.JIZHANGBEN_PWA_RESOURCE_ERROR=true;},true);
document.addEventListener('DOMContentLoaded',function(){if(!window.JIZHANGBEN_PWA_RESOURCE_ERROR)return;document.querySelector('.app').inert=true;var nav=document.querySelector('.bottom-nav');if(nav)nav.inert=true;var box=document.createElement('section');box.id='pwaResourceFailure';box.setAttribute('role','alert');box.textContent='程序资源未加载完整，已停止进入账本。请联网重新打开，并保留网站数据与备份。';var button=document.createElement('button');button.textContent='重新打开';button.onclick=function(){location.reload();};box.appendChild(button);document.body.appendChild(box);});
</script>`);
    buffers.set('index.html', Buffer.from(main));
    buffers.set('install.html', Buffer.from(versionHtml(buffers.get('install.html').toString('utf8'))));
  }
  const inventory = [...buffers].map(([file, bytes]) => ({ file, size: bytes.length, sha256: sha256(bytes) }));
  buffers.set('build-info.json', Buffer.from(JSON.stringify({
    builder: 'jizhangben-pwa-stage1', stage: storagePreview ? '4' : 1, buildId, offlineCapable: storagePreview, offlineReady: false, files: inventory
  }, null, 2)));
  if (storagePreview) {
    const files = [...buffers].map(([file, bytes]) => ({ file, sha256: sha256(bytes) }));
    buffers.set('service-worker.js', Buffer.from(workerTemplate.replace('__PWA_RELEASE_MANIFEST__', JSON.stringify({ version: buildId, files }))));
  }
  if (fs.existsSync(output)) {
    const info = JSON.parse(fs.readFileSync(path.join(output, 'build-info.json'), 'utf8'));
    if (info.builder !== 'jizhangben-pwa-stage1') throw Error('目录并非本构建器产物，已停止替换');
  }
  fs.mkdirSync(safePath(root, 'output'), { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, 'output/pwa-build-'));
  const previous = staging + '-previous';
  let installed = false;
  try {
    for (const [file, bytes] of buffers) {
      const target = safePath(staging, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    if (JSON.stringify(listFiles(staging)) !== JSON.stringify([...available].sort())) throw Error('产物存在意外或缺失文件');
    if (fs.existsSync(output)) fs.renameSync(output, previous);
    try { fs.renameSync(staging, output); installed = true; }
    catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, output); throw error; }
  } finally {
    // 两个目标都来自本次 mkdtemp，且固定在项目 output 内。
    for (const directory of [staging, ...(installed ? [previous] : [])]) {
      safePath(root, path.relative(root, directory).split(path.sep).join('/'));
      if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
    }
  }
  return { output, fileCount: buffers.size, offlineReady: false };
}

module.exports = { build, safePath, validateReferences };
if (require.main === module) console.log(JSON.stringify(build({ storagePreview: process.argv.includes('--storage') }), null, 2));
