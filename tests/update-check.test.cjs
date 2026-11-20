const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime.cjs");

const repoRoot = path.resolve(__dirname, "..");
const updateScriptPath = path.join(repoRoot, "js", "update-check.js");
const DOWNLOAD_URL = "https://jizhangben-download.pages.dev/";
const MANIFEST_URL = DOWNLOAD_URL + "version.json";

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

// 用项目现有的 vm 运行时加载真实脚本，只把原生桥、fetch、定时器和 DOM 换成可控替身。
function createHarness(options = {}) {
  const openedUrls = [];
  const fetchCalls = [];
  const timers = [];
  const windowListeners = {};
  const bridge = options.bridge === undefined
    ? {
        getVersionInfo: () => JSON.stringify(options.installed || { versionCode: 110, versionName: "2.09" }),
        openExternalBrowser: url => {
          openedUrls.push(url);
          return options.openResult !== false;
        }
      }
    : options.bridge;
  const windowStub = {
    JizhangbenUpdate: bridge,
    fetch(url, init) {
      fetchCalls.push({ url, init });
      return options.fetch ? options.fetch(url, init) : Promise.reject(new Error("offline"));
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms: ms || 0 });
      return timers.length;
    },
    clearTimeout() {},
    addEventListener(name, fn) {
      windowListeners[name] = fn;
    }
  };
  const runtime = createRuntime(options.storage || {}, { window: windowStub });
  runtime.run(fs.readFileSync(updateScriptPath, "utf8"));
  runtime.run(`
    globalThis.updateElements = {};
    globalThis.document = {
      getElementById(id) {
        if (!updateElements[id]) updateElements[id] = { hidden: true, textContent: "", disabled: false, onclick: null };
        return updateElements[id];
      }
    };
  `);
  return {
    runtime,
    windowStub,
    openedUrls,
    fetchCalls,
    windowListeners,
    element(id) {
      return runtime.run(`document.getElementById(${JSON.stringify(id)})`);
    },
    run(source) {
      return runtime.run(source);
    },
    storageValue(key) {
      const value = runtime.localStorage.toObject()[key];
      return value === undefined ? undefined : JSON.parse(value);
    },
    async flush() {
      for (let i = 0; i < 20; i++) {
        // 只执行 0ms 的延后任务；8s 超时计时器保留，不替真机提前触发超时。
        for (let index = timers.length - 1; index >= 0; index--) {
          if (timers[index].ms !== 0) continue;
          const [timer] = timers.splice(index, 1);
          timer.fn();
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  };
}

test("新版：首页出现提示，去下载用系统浏览器打开下载站", async () => {
  const harness = createHarness({
    fetch: () => jsonResponse({ versionCode: 111, versionName: "2.10", notes: "新增应用内更新提醒。" })
  });
  harness.run("startAndroidUpdateCheck()");
  await harness.flush();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].url.split("?")[0], MANIFEST_URL);
  assert.match(harness.fetchCalls[0].url, /\?t=\d+$/);
  assert.equal(harness.fetchCalls[0].init.cache, "no-store");

  assert.equal(harness.element("androidUpdateBanner").hidden, false);
  assert.match(harness.element("androidUpdateBannerTitle").textContent, /发现新版本 v2\.10/);
  assert.equal(harness.element("androidUpdateBannerNotes").textContent, "新增应用内更新提醒。");
  assert.equal(harness.element("settingsUpdateDot").hidden, false);
  assert.equal(harness.element("androidUpdateSettings").hidden, false);
  assert.equal(harness.element("androidUpdateDownloadRow").hidden, false);
  assert.equal(harness.element("androidUpdateVersion").textContent, "当前版本 v2.09（110）");
  assert.equal(harness.element("androidUpdateStatus").textContent, "发现新版本 v2.10（111）");

  harness.element("androidUpdateDownloadBtn").onclick();
  assert.deepEqual(harness.openedUrls, [DOWNLOAD_URL]);
  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("settingsUpdateDot").hidden, false);

  // 提醒状态单独保存，不写入账本的 jizhangben_ 前缀键。
  assert.deepEqual(
    Object.keys(harness.runtime.localStorage.toObject()).filter(key => key.startsWith("jizhangben_")),
    []
  );
  const state = harness.storageValue("jzb.android.update.v1");
  assert.equal(state.notifiedVersionCode, 111);
  assert.equal(state.latest.versionCode, 111);
});

test("同版本：不提示、不显示红点，手动检查显示已是最新", async () => {
  const harness = createHarness({
    fetch: () => jsonResponse({ versionCode: 110, versionName: "2.09", notes: "无变化" })
  });
  harness.run("startAndroidUpdateCheck()");
  await harness.flush();

  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("settingsUpdateDot").hidden, true);
  assert.equal(harness.element("androidUpdateDownloadRow").hidden, true);
  assert.equal(harness.element("androidUpdateStatus").textContent, "已是最新版本");

  harness.element("androidUpdateCheckBtn").onclick();
  await harness.flush();
  assert.equal(harness.element("androidUpdateStatus").textContent, "已是最新版本");
  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("androidUpdateDownloadRow").hidden, true);
});

test("远端版本更低时不提示", async () => {
  const harness = createHarness({ fetch: () => jsonResponse({ versionCode: 109, versionName: "2.08" }) });
  harness.run("startAndroidUpdateCheck()");
  await harness.flush();
  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("settingsUpdateDot").hidden, true);
});

test("断网或请求失败：不提示、不写账本、手动检查给出失败文案", async () => {
  const harness = createHarness({
    storage: { jizhangben_records_1: '[{"id":1,"amountCents":1200}]' },
    fetch: () => Promise.reject(new Error("offline"))
  });
  harness.run("startAndroidUpdateCheck()");
  await harness.flush();

  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("settingsUpdateDot").hidden, true);
  assert.equal(harness.runtime.localStorage.getItem("jizhangben_records_1"), '[{"id":1,"amountCents":1200}]');
  assert.equal(harness.runtime.localStorage.getItem("jzb.android.update.v1"), null);

  harness.element("androidUpdateCheckBtn").onclick();
  await harness.flush();
  assert.match(harness.element("androidUpdateStatus").textContent, /无法连接更新服务/);
  assert.equal(harness.element("androidUpdateBanner").hidden, true);
});

test("清单异常按检查失败处理，不当成新版本", async () => {
  const harness = createHarness({ fetch: () => jsonResponse({ versionCode: "abc", versionName: 111 }) });
  const result = await harness.run("checkAndroidUpdate({})");
  assert.equal(result.status, "failed");
  assert.equal(harness.element("androidUpdateBanner").hidden, true);
  assert.equal(harness.element("settingsUpdateDot").hidden, true);
});

test("同一版本只主动提醒一次：再次打开只保留红点，设置页仍有下载入口", async () => {
  const manifest = { versionCode: 111, versionName: "2.10", notes: "第一次提醒" };
  const first = createHarness({ fetch: () => jsonResponse(manifest) });
  first.run("startAndroidUpdateCheck()");
  await first.flush();
  assert.equal(first.element("androidUpdateBanner").hidden, false);

  first.element("androidUpdateLaterBtn").onclick();
  assert.equal(first.element("androidUpdateBanner").hidden, true);
  assert.equal(first.element("settingsUpdateDot").hidden, false);

  // 模拟下次打开：沿用上一步保存的提醒状态。
  const second = createHarness({
    storage: first.runtime.localStorage.toObject(),
    fetch: () => jsonResponse(manifest)
  });
  second.run("startAndroidUpdateCheck()");
  await second.flush();
  assert.equal(second.element("androidUpdateBanner").hidden, true);
  assert.equal(second.element("settingsUpdateDot").hidden, false);
  assert.equal(second.element("androidUpdateSettings").hidden, false);
  assert.equal(second.element("androidUpdateDownloadRow").hidden, false);

  // 点「稍后」后，仍能从设置 → 检查更新重新找到下载入口。
  second.element("androidUpdateCheckBtn").onclick();
  await second.flush();
  assert.equal(second.element("androidUpdateDownloadRow").hidden, false);
  second.element("androidUpdateSettingsDownloadBtn").onclick();
  assert.deepEqual(second.openedUrls, [DOWNLOAD_URL]);
});

test("启动不等待检查结果：请求未返回时应用照常可用", async () => {
  let resolveFetch = null;
  const pending = new Promise(resolve => {
    resolveFetch = resolve;
  });
  const harness = createHarness({ fetch: () => pending });
  const startedAt = Date.now();
  harness.run("startAndroidUpdateCheck()");
  assert.ok(Date.now() - startedAt < 1000);
  await harness.flush();
  assert.equal(harness.element("androidUpdateBanner").hidden, true);

  resolveFetch({ ok: true, json: () => Promise.resolve({ versionCode: 111, versionName: "2.10" }) });
  await harness.flush();
  assert.equal(harness.element("androidUpdateBanner").hidden, false);
});

test("iPhone PWA / 无原生桥：不加载检查、不发请求、设置入口保持隐藏", async () => {
  const harness = createHarness({ bridge: null });
  harness.run("startAndroidUpdateCheck()");
  await harness.flush();
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.runtime.run("Object.keys(updateElements).length"), 0);
  const result = await harness.run("checkAndroidUpdate({})");
  assert.equal(result.status, "unsupported");
  assert.equal(harness.fetchCalls.length, 0);
});

test("首页提示与设置入口已接入页面、样式和启动脚本", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  [
    "androidUpdateBanner",
    "androidUpdateBannerTitle",
    "androidUpdateBannerNotes",
    "androidUpdateDownloadBtn",
    "androidUpdateLaterBtn",
    "androidUpdateSettings",
    "androidUpdateVersion",
    "androidUpdateStatus",
    "androidUpdateCheckBtn",
    "androidUpdateDownloadRow",
    "androidUpdateLatest",
    "androidUpdateSettingsDownloadBtn",
    "settingsUpdateDot"
  ].forEach(id => assert.match(html, new RegExp(`id="${id}"`), id));

  // 默认隐藏：iPhone PWA 和未检查出更新时不显示。
  assert.match(html, /id="androidUpdateBanner"[^>]*hidden/);
  assert.match(html, /id="androidUpdateSettings"[^>]*hidden/);
  assert.match(html, /id="settingsUpdateDot"[^>]*hidden/);
  // 更新脚本必须在启动脚本之前加载，且首页入口在首页面板内。
  assert.ok(html.indexOf('src="js/update-check.js"') > 0);
  assert.ok(html.indexOf('src="js/update-check.js"') < html.indexOf('src="js/app.js"'));
  assert.ok(html.indexOf('id="androidUpdateBanner"') < html.indexOf('id="panelBook"'));

  const css = fs.readFileSync(path.join(repoRoot, "css", "style.css"), "utf8");
  assert.match(css, /\.update-banner\s*\{/);
  assert.match(css, /\.update-banner\[hidden\]/);
  assert.match(css, /\.tab-update-dot/);
  assert.match(css, /\.android-update-settings\[hidden\]/);

  const appJs = fs.readFileSync(path.join(repoRoot, "js", "app.js"), "utf8");
  assert.match(appJs, /startAndroidUpdateCheck\(\)/);
});
