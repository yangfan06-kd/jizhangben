/* 构建时注入程序资源清单；不接触账目数据库、设备偏好或备份。 */
'use strict';
const RELEASE = __PWA_RELEASE_MANIFEST__;
const BASE = new URL(self.registration.scope);
const PREFIX = 'jizhangben-pwa-shell:' + BASE.pathname + ':';
const CACHE = PREFIX + RELEASE.version;
const META = new URL('__program_manifest__', BASE).href;
const validVersion = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const assetUrl = path => new URL(path, BASE).href;
const digest = async response => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
const safeFile = path => typeof path === 'string' && !/[:\\?#]|(^|\/)\.{1,2}(\/|$)|^\//.test(path);
async function metadata(version) {
  if (!validVersion(version) || !(await caches.has(PREFIX + version))) return null;
  const cache = await caches.open(PREFIX + version), response = await cache.match(META);
  if (!response) return null;
  const value = await response.json();
  if (value.version !== version || !Array.isArray(value.files) || value.files.some(file => !safeFile(file.file) || !validVersion(file.sha256))) return null;
  return { cache, manifest: value };
}
async function complete(version) {
  try {
    const state = await metadata(version);
    if (!state) return false;
    for (const file of state.manifest.files) {
      const response = await state.cache.match(assetUrl(file.file));
      if (!response || !response.ok || await digest(response) !== file.sha256) return false;
    }
    return true;
  } catch (_) { return false; }
}
self.addEventListener('install', event => event.waitUntil((async () => {
  if (await complete(RELEASE.version)) return;
  const cache = await caches.open(CACHE);
  try {
    for (const file of RELEASE.files) {
      const response = await fetch(assetUrl(file.file), { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
      if (!response.ok || response.type === 'opaque' || await digest(response) !== file.sha256) throw Error('程序资源校验失败');
      await cache.put(assetUrl(file.file), response);
    }
    await cache.put(META, new Response(JSON.stringify({ ...RELEASE, installedAt: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
    if (!await complete(RELEASE.version)) throw Error('程序缓存不完整');
  } catch (error) { await caches.delete(CACHE); throw error; }
  // 升级保持 waiting，只有所有旧窗口关闭或用户明确要求时才能激活。
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
async function scopedWindows() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(BASE.href));
}
async function cleanup(source, version) {
  const clients = await scopedWindows();
  if (version !== RELEASE.version || clients.length !== 1 || clients[0].id !== source.id) return false;
  const candidates = [];
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) {
    const previous = await metadata(name.slice(PREFIX.length));
    if (previous) candidates.push({ name, time: Number(previous.manifest.installedAt) || 0 });
  }
  candidates.sort((a, b) => b.time - a.time);
  // 保留当前版本及最近一个完整旧版本；仅清理本作用域的更早程序缓存。
  for (const previous of candidates.slice(1)) await caches.delete(previous.name);
  return true;
}
self.addEventListener('message', event => {
  const message = event.data || {}, port = event.ports && event.ports[0];
  if (!port || !event.source || !event.source.url.startsWith(BASE.href)) return;
  event.waitUntil((async () => {
    try {
      if (message.type === 'STATUS') port.postMessage({ version: RELEASE.version, ready: await complete(message.version || RELEASE.version) });
      else if (message.type === 'REPAIR') {
        const version = message.version || RELEASE.version, state = await metadata(version);
        if (!state) { port.postMessage({ ready: false }); return; }
        for (const file of state.manifest.files) {
          const response = await state.cache.match(assetUrl(file.file));
          if (!response || await digest(response) !== file.sha256) await programResponse(new Request(assetUrl(file.file)), file.file, version);
        }
        port.postMessage({ ready: await complete(version) });
      }
      else if (message.type === 'ACTIVATE') {
        const clients = await scopedWindows();
        if (clients.length !== 1 || clients[0].id !== event.source.id) { port.postMessage({ ok: false, reason: '请先关闭其他记账窗口，再更新当前窗口。' }); return; }
        if (!await complete(RELEASE.version)) { port.postMessage({ ok: false, reason: '新版本缓存不完整，请联网重新准备。' }); return; }
        await self.skipWaiting(); port.postMessage({ ok: true, version: RELEASE.version });
      } else if (message.type === 'CLEANUP') port.postMessage({ ok: await cleanup(event.source, message.version) });
    } catch (_) { port.postMessage({ ok: false, ready: false, reason: '无法核对离线资源，请联网重试。' }); }
  })());
});
const unavailable = () => new Response('程序资源尚未完整保存，请联网重新打开。请保留网站数据与备份。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
async function programResponse(request, path, version) {
  try {
    const state = await metadata(version);
    if (!state) return unavailable();
    const file = state.manifest.files.find(file => file.file === path);
    if (!file) return fetch(request);
    const key = assetUrl(path), cached = await state.cache.match(key);
    if (cached && cached.ok && await digest(cached) === file.sha256) return cached;
    // 网络只能修复相同摘要的资源，禁止用新版文件填充旧版缓存。
    const response = await fetch(key, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    if (!response.ok || await digest(response) !== file.sha256) return unavailable();
    await state.cache.put(key, response.clone()); return response;
  } catch (_) { return unavailable(); }
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  let path = url.pathname.slice(BASE.pathname.length);
  if (request.mode === 'navigate' && (path === '' || path === 'index.html')) path = 'index.html';
  const version = url.searchParams.get('v') || RELEASE.version;
  if (!validVersion(version)) return;
  // 非允许资源保持原网络行为，不缓存接口、导出文件、未知路径或 SW 自身。
  if (!RELEASE.files.some(file => file.file === path) && !url.searchParams.has('v')) return;
  event.respondWith(programResponse(request, path, version));
});
