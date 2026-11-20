// 安卓应用内更新提醒：只在带原生桥的安卓壳里运行，iPhone PWA 与普通浏览器不加载检查。
// 检查在后台进行，启动和记账都不等待结果；断网、超时或清单异常时静默跳过，不影响记账。
// 提醒状态单独保存在独立键里，不写进账本数据，也不会进入备份或恢复流程。

const ANDROID_UPDATE_DOWNLOAD_URL = "https://jizhangben-download.pages.dev/";
const ANDROID_UPDATE_MANIFEST_URL = ANDROID_UPDATE_DOWNLOAD_URL + "version.json";
const ANDROID_UPDATE_STATE_KEY = "jzb.android.update.v1";
const ANDROID_UPDATE_TIMEOUT_MS = 8000;
const ANDROID_UPDATE_DEFAULT_NOTES = "包含体验改进与问题修复，覆盖安装即可，账目和设置都会保留。";

const androidUpdateState = {
  installed: null,
  latest: null,
  bannerVisible: false,
  checking: false,
  status: "",
  lastResult: "",
  eventsBound: false
};

function androidUpdateBridge() {
  if (typeof window === "undefined") return null;
  const bridge = window.JizhangbenUpdate;
  if (!bridge || typeof bridge.getVersionInfo !== "function") return null;
  return bridge;
}

// 用系统记录的已安装版本作为比较基准，避免把网页里的版本号当成真实安装版本。
function readAndroidInstalledVersion() {
  const bridge = androidUpdateBridge();
  if (!bridge) return null;
  try {
    const info = JSON.parse(bridge.getVersionInfo() || "");
    const versionCode = Number(info && info.versionCode);
    if (!Number.isInteger(versionCode) || versionCode <= 0) return null;
    return {
      versionCode,
      versionName: typeof info.versionName === "string" ? info.versionName : ""
    };
  } catch (error) {
    return null;
  }
}

function readAndroidUpdateStorage() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(ANDROID_UPDATE_STATE_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    return {};
  }
}

function saveAndroidUpdateStorage(patch) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const state = Object.assign(readAndroidUpdateStorage(), patch);
    window.localStorage.setItem(ANDROID_UPDATE_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    // 提醒状态写不进去时按未提醒处理，下次打开最多再提醒一次，不影响账目。
  }
}

function normalizeAndroidManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const versionCode = Number(manifest.versionCode);
  if (!Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (manifest.versionName != null && typeof manifest.versionName !== "string") return null;
  if (manifest.notes != null && typeof manifest.notes !== "string") return null;
  return {
    versionCode,
    versionName: typeof manifest.versionName === "string" ? manifest.versionName : "",
    notes: typeof manifest.notes === "string" ? manifest.notes.trim() : ""
  };
}

// 后台读取远端版本清单；超时、非 2xx、JSON 或字段异常都按检查失败处理。
async function fetchAndroidUpdateManifest() {
  const fetcher = typeof window !== "undefined" && typeof window.fetch === "function"
    ? window.fetch.bind(window)
    : null;
  if (!fetcher) throw new Error("fetch_unavailable");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    if (typeof window.setTimeout !== "function") return;
    timer = window.setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error("timeout"));
    }, ANDROID_UPDATE_TIMEOUT_MS);
  });
  const request = Promise.resolve().then(() => fetcher(
    ANDROID_UPDATE_MANIFEST_URL + "?t=" + Date.now(),
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller ? controller.signal : undefined
    }
  )).then(response => {
    if (!response || response.ok !== true) throw new Error("bad_response");
    return response.json();
  });

  try {
    const manifest = await Promise.race([request, timeout]);
    const normalized = normalizeAndroidManifest(manifest);
    if (!normalized) throw new Error("invalid_manifest");
    return normalized;
  } finally {
    if (timer !== null && typeof window.clearTimeout === "function") window.clearTimeout(timer);
  }
}

function androidUpdateVersionLabel(info) {
  if (!info) return "";
  const name = info.versionName ? "v" + info.versionName : "";
  return name ? name + "（" + info.versionCode + "）" : String(info.versionCode);
}

function isAndroidUpdateAvailable() {
  const latest = androidUpdateState.latest;
  const installed = androidUpdateState.installed;
  if (!latest || !installed) return false;
  return Number(latest.versionCode) > Number(installed.versionCode);
}

function androidUpdateElement(id) {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return null;
  return document.getElementById(id);
}

// 首页提示条、设置页入口和底栏红点共用同一份状态，避免互相不同步。
function renderAndroidUpdateUi() {
  const bridgeReady = Boolean(androidUpdateBridge());
  const available = bridgeReady && isAndroidUpdateAvailable();

  const settings = androidUpdateElement("androidUpdateSettings");
  if (settings) {
    settings.hidden = !bridgeReady;
    const versionLabel = androidUpdateElement("androidUpdateVersion");
    if (versionLabel) {
      versionLabel.textContent = androidUpdateState.installed
        ? "当前版本 " + androidUpdateVersionLabel(androidUpdateState.installed)
        : "";
    }
    const status = androidUpdateElement("androidUpdateStatus");
    if (status) status.textContent = androidUpdateState.status || (bridgeReady ? "尚未检查" : "");
    const latestLabel = androidUpdateElement("androidUpdateLatest");
    if (latestLabel) {
      latestLabel.textContent = available ? "发现 " + androidUpdateVersionLabel(androidUpdateState.latest) : "";
    }
    const downloadRow = androidUpdateElement("androidUpdateDownloadRow");
    if (downloadRow) downloadRow.hidden = !available;
    const checkBtn = androidUpdateElement("androidUpdateCheckBtn");
    if (checkBtn) checkBtn.disabled = androidUpdateState.checking || !bridgeReady;
  }

  const banner = androidUpdateElement("androidUpdateBanner");
  if (banner) {
    banner.hidden = !available || !androidUpdateState.bannerVisible;
    const title = androidUpdateElement("androidUpdateBannerTitle");
    if (title) {
      const versionName = available && androidUpdateState.latest.versionName
        ? " v" + androidUpdateState.latest.versionName
        : "";
      title.textContent = "发现新版本" + versionName;
    }
    const notes = androidUpdateElement("androidUpdateBannerNotes");
    if (notes) {
      notes.textContent = available && androidUpdateState.latest
        ? androidUpdateState.latest.notes || ANDROID_UPDATE_DEFAULT_NOTES
        : "";
    }
  }

  const dot = androidUpdateElement("settingsUpdateDot");
  if (dot) dot.hidden = !available;
}

function openAndroidUpdateDownloadPage() {
  const bridge = androidUpdateBridge();
  if (bridge && typeof bridge.openExternalBrowser === "function") {
    try {
      if (bridge.openExternalBrowser(ANDROID_UPDATE_DOWNLOAD_URL) === true) return true;
    } catch (error) {
      // 原生打开失败时回退到网页打开方式。
    }
  }
  if (typeof window !== "undefined" && typeof window.open === "function") {
    try {
      if (window.open(ANDROID_UPDATE_DOWNLOAD_URL, "_blank")) return true;
    } catch (error) {
      // 交给下面的失败提示。
    }
  }
  return false;
}

function androidUpdateNotice(message) {
  if (typeof appNotice === "function") {
    try {
      appNotice(message);
      return;
    } catch (error) {
      // 提示失败时退回设置页状态文案。
    }
  }
  androidUpdateState.status = message;
  renderAndroidUpdateUi();
}

function bindAndroidUpdateEvents() {
  if (androidUpdateState.eventsBound) return;
  androidUpdateState.eventsBound = true;

  const downloadBtn = androidUpdateElement("androidUpdateDownloadBtn");
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      androidUpdateState.bannerVisible = false;
      renderAndroidUpdateUi();
      if (!openAndroidUpdateDownloadPage()) {
        androidUpdateNotice("未能打开浏览器，请在浏览器中访问 " + ANDROID_UPDATE_DOWNLOAD_URL);
      }
    };
  }

  const laterBtn = androidUpdateElement("androidUpdateLaterBtn");
  if (laterBtn) {
    laterBtn.onclick = () => {
      androidUpdateState.bannerVisible = false;
      renderAndroidUpdateUi();
    };
  }

  const settingsDownloadBtn = androidUpdateElement("androidUpdateSettingsDownloadBtn");
  if (settingsDownloadBtn) {
    settingsDownloadBtn.onclick = () => {
      if (!openAndroidUpdateDownloadPage()) {
        androidUpdateNotice("未能打开浏览器，请在浏览器中访问 " + ANDROID_UPDATE_DOWNLOAD_URL);
      }
    };
  }

  const checkBtn = androidUpdateElement("androidUpdateCheckBtn");
  if (checkBtn) {
    checkBtn.onclick = () => {
      checkAndroidUpdate({ source: "manual" });
    };
  }
}

// 启动时的后台检查：不返回、不等待，失败也只是一次静默跳过。
function startAndroidUpdateCheck() {
  if (typeof window === "undefined") return;
  const bridge = androidUpdateBridge();
  if (!bridge) return; // iPhone PWA / 普通浏览器不加载安卓更新检查，也不发任何请求。

  bindAndroidUpdateEvents();
  androidUpdateState.installed = readAndroidInstalledVersion();
  const stored = readAndroidUpdateStorage();
  const storedLatest = normalizeAndroidManifest(stored && stored.latest);
  androidUpdateState.latest = storedLatest;
  renderAndroidUpdateUi();

  const runCheck = () => {
    checkAndroidUpdate({ source: "startup" });
  };
  if (typeof window.setTimeout === "function") window.setTimeout(runCheck, 0);
  else runCheck();

  if (typeof window.addEventListener === "function") {
    // 打开时正好断网的话，等网络恢复再补一次，不打断当前操作。
    window.addEventListener("online", () => {
      if (androidUpdateState.lastResult === "failed") checkAndroidUpdate({ source: "startup" });
    });
  }
}

// 检查远端清单并更新提醒状态；永不 reject，调用方可以放心地不 await。
async function checkAndroidUpdate(options = {}) {
  const manual = options.source === "manual";
  if (!androidUpdateBridge()) return { status: "unsupported" };

  const installed = readAndroidInstalledVersion();
  if (!installed) return { status: "unsupported" };
  androidUpdateState.installed = installed;
  androidUpdateState.checking = true;
  if (manual) {
    androidUpdateState.status = "正在检查…";
    renderAndroidUpdateUi();
  }

  try {
    const manifest = await fetchAndroidUpdateManifest();
    if (manifest.versionCode > installed.versionCode) {
      androidUpdateState.latest = manifest;
      androidUpdateState.lastResult = "update";
      androidUpdateState.status = "发现新版本 " + androidUpdateVersionLabel(manifest);
      saveAndroidUpdateStorage({ latest: manifest });
      if (!manual) {
        // 同一版本只在第一次发现时主动提醒一次，之后只保留设置页红点。
        const stored = readAndroidUpdateStorage();
        if (Number(stored.notifiedVersionCode) !== manifest.versionCode) {
          androidUpdateState.bannerVisible = true;
          saveAndroidUpdateStorage({ notifiedVersionCode: manifest.versionCode });
        }
      }
      return { status: "update", manifest };
    }

    androidUpdateState.latest = null;
    androidUpdateState.bannerVisible = false;
    androidUpdateState.lastResult = "current";
    androidUpdateState.status = "已是最新版本";
    saveAndroidUpdateStorage({ latest: null });
    return { status: "current", manifest };
  } catch (error) {
    androidUpdateState.lastResult = "failed";
    androidUpdateState.status = manual ? "暂时无法连接更新服务，稍后再试。" : "暂时无法连接更新服务";
    return { status: "failed" };
  } finally {
    androidUpdateState.checking = false;
    renderAndroidUpdateUi();
  }
}
