// 登录模块：负责注册、登录、退出和会话状态显示。

let authMode = "login";
let authMsgTimer = null;
let authPanelOpen = false;
let syncInFlight = false;

function isBackendAuthGateEnabled() {
  return !!(typeof backendApi !== "undefined" && backendApi.baseUrl());
}

function clearLedgerStateForAuthGate() {
  dataState.currentBookId = null;
  dataState.books = [];
  dataState.records = [];
  dataState.accounts = [];
  dataState.customTypes = [];
  dataState.customCategories = [];
  dataState.backendCategoryIds = Object.create(null);
  dataState.backendTypeIds = Object.create(null);
  dataState.backendBooksLoaded = false;
  dataState.backendOptionsLoaded = false;
  dataState.backendRecordsLoaded = false;
  dataState.backendOverview = null;
  if (typeof document !== "undefined" && typeof resetForm === "function") resetForm();
  if (typeof document !== "undefined" && typeof resetAccountForm === "function") resetAccountForm();
  if (typeof document !== "undefined" && typeof resetBookForm === "function") resetBookForm();
  if (typeof resetFilterState === "function") resetFilterState();
}

function renderAuthGate() {
  const ledger = document.getElementById("ledgerApp");
  const panel = document.getElementById("authPanel");
  const close = document.getElementById("authCloseBtn");
  const hint = document.getElementById("authEntryHint");
  const isAuthenticated = dataState.authStatus === "authenticated" && !!dataState.authUser;
  const gateActive = isBackendAuthGateEnabled() && !isAuthenticated;
  const app = typeof document.querySelector === "function" ? document.querySelector(".app") : null;
  const bookBar = typeof document.querySelector === "function" ? document.querySelector(".book-bar") : null;
  const authBar = typeof document.querySelector === "function" ? document.querySelector(".auth-bar") : null;

  if (ledger) ledger.hidden = gateActive;
  if (panel) {
    panel.classList.toggle("auth-entry-panel", gateActive);
    panel.hidden = gateActive ? false : !authPanelOpen;
  }
  if (close) close.hidden = gateActive;
  if (hint) hint.hidden = !gateActive;
  if (app) app.classList.toggle("auth-gate", gateActive);
  if (bookBar) bookBar.hidden = gateActive;
  if (authBar) authBar.hidden = gateActive;
}

function showAuthMsg(text, isError = true) {
  const message = document.getElementById("authMsg");
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("error", !!isError);
  message.classList.toggle("success", !isError);
  clearTimeout(authMsgTimer);
  authMsgTimer = setTimeout(() => { message.textContent = ""; }, 4000);
}

function showAuthDataNotice(text) {
  uiState.startupNotice = text;
  const notice = document.getElementById("startupNotice");
  if (notice) {
    notice.textContent = text;
    notice.hidden = false;
  }
}

function bindNetworkStatusEvents() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("online", () => {
    if (dataState.offlineMode) {
      showAuthDataNotice("网络已恢复，请点击“联网登录”同步本机数据。 ");
    } else if (dataState.authStatus === "authenticated") {
      showAuthDataNotice("网络已恢复，可以点击“同步”读取其他设备的新数据。 ");
    }
  });
  window.addEventListener("offline", () => {
    if (dataState.offlineMode) {
      showAuthDataNotice("网络已断开，当前继续使用本机数据。 ");
    } else if (dataState.authStatus === "authenticated") {
      showAuthDataNotice("网络已断开，新记录会先保存在本机，恢复后可继续同步。 ");
    }
  });
}

async function hydrateAuthenticatedData() {
  uiState.startupNotice = "";
  const migration = typeof maybeOfferLocalMigration === "function"
    ? await maybeOfferLocalMigration()
    : "none";
  // 用户选择保留本地数据，或迁移过程暂时失败时，页面已经回退到本地快照。
  if (migration === "local") return true;
  const hydrated = await startBackendReadHydration(true);
  if (!hydrated && dataState.authStatus === "authenticated") {
    showAuthDataNotice("已登录，但服务端账本暂时无法读取，请稍后重试。当前未显示本地账本数据。");
    showAuthMsg("服务端数据暂时无法读取", true);
  }
  return hydrated;
}

// 跨设备新增数据后，允许用户在当前页面主动重新读取服务端快照。
async function syncBackendData() {
  if (syncInFlight || !isBackendAuthGateEnabled() || dataState.authStatus !== "authenticated") return false;
  const button = document.getElementById("syncBtn");
  syncInFlight = true;
  if (button) {
    button.disabled = true;
    button.textContent = "同步中…";
  }
  showAuthDataNotice("正在同步服务端账本、账户、明细和总览…");
  try {
    const hydrated = await startBackendReadHydration(true);
    if (!hydrated) {
      if (dataState.authStatus === "authenticated") {
        showAuthDataNotice("服务端数据暂时无法同步，请稍后重试。当前数据未被替换。 ");
        showAuthMsg("同步失败，请检查网络后重试", true);
      }
      return false;
    }
    showAuthDataNotice("已同步服务端账本、账户、明细和总览。 ");
    return true;
  } finally {
    syncInFlight = false;
    if (button) {
      button.disabled = false;
      button.textContent = "同步";
    }
    renderAuthStatus();
  }
}

function renderAuthStatus() {
  const status = document.getElementById("authStatus");
  const open = document.getElementById("authOpenBtn");
  const sync = document.getElementById("syncBtn");
  const logout = document.getElementById("authLogoutBtn");
  if (!status || !open || !sync || !logout) return;
  if (dataState.authStatus === "authenticated" && dataState.authUser) {
    status.textContent = "已登录：" + dataState.authUser.display_name;
    dataState.offlineMode = false;
    open.hidden = true;
    sync.hidden = false;
    sync.disabled = syncInFlight;
    logout.hidden = false;
  } else if (dataState.authStatus === "loading") {
    status.textContent = "正在检查登录状态…";
    open.hidden = true;
    sync.hidden = true;
    sync.disabled = false;
    logout.hidden = true;
  } else {
    status.textContent = dataState.offlineMode
      ? "本机离线模式"
      : (backendApi.baseUrl() ? "未登录，请先登录" : "本地模式");
    open.textContent = dataState.offlineMode ? "联网登录" : "登录";
    open.hidden = false;
    sync.hidden = true;
    sync.disabled = false;
    logout.hidden = true;
  }
  renderAuthGate();
}

function handleBackendAuthExpired() {
  const wasAuthenticated = dataState.authStatus === "authenticated" && dataState.authUser;
  dataState.authUser = null;
  dataState.authStatus = "guest";
  dataState.authHydrated = true;
  clearLedgerStateForAuthGate();
  showAuthDataNotice("登录状态已过期，请重新登录后继续使用。");
  renderAuthStatus();
  if (wasAuthenticated) showAuthMsg("登录状态已过期，请重新登录");
  if (typeof render === "function") render();
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const title = document.getElementById("authTitle");
  const nameField = document.getElementById("authNameField");
  const submit = document.getElementById("authSubmitBtn");
  const loginTab = document.getElementById("authLoginTab");
  const registerTab = document.getElementById("authRegisterTab");
  const confirmField = document.getElementById("authConfirmField");
  const passwordHint = document.getElementById("authPasswordHint");
  const passwordInput = document.getElementById("authPassword");
  const confirmInput = document.getElementById("authPasswordConfirm");
  if (title) title.textContent = authMode === "register" ? "创建账号" : "登录记账本";
  if (nameField) nameField.hidden = authMode !== "register";
  if (confirmField) confirmField.hidden = authMode !== "register";
  if (passwordHint) passwordHint.textContent = authMode === "register"
    ? "密码至少 8 个字符，注册后会自动登录。"
    : "登录时填写注册账号的密码。";
  if (passwordInput && typeof passwordInput.setAttribute === "function") {
    passwordInput.setAttribute("autocomplete", authMode === "register" ? "new-password" : "current-password");
  }
  if (authMode === "login" && confirmInput) confirmInput.value = "";
  if (submit) submit.textContent = authMode === "register" ? "注册并登录" : "登录";
  if (loginTab) loginTab.classList.toggle("active", authMode === "login");
  if (registerTab) registerTab.classList.toggle("active", authMode === "register");
  showAuthMsg("");
}

function isValidAuthEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function openAuthPanel(mode = "login") {
  const panel = document.getElementById("authPanel");
  if (!panel) return;
  if (dataState.offlineMode) {
    dataState.offlineMode = false;
    renderAuthStatus();
  }
  setAuthMode(mode);
  authPanelOpen = true;
  panel.hidden = false;
  renderAuthGate();
  document.getElementById("authEmail").focus();
}

function closeAuthPanel() {
  const panel = document.getElementById("authPanel");
  if (isBackendAuthGateEnabled() && dataState.authStatus !== "authenticated") return;
  authPanelOpen = false;
  if (panel) panel.hidden = true;
  renderAuthGate();
}

function setAuthBusy(busy) {
  const submit = document.getElementById("authSubmitBtn");
  const close = document.getElementById("authCloseBtn");
  if (submit) {
    submit.disabled = !!busy;
    if (busy) submit.textContent = "处理中…";
    else submit.textContent = authMode === "register" ? "注册并登录" : "登录";
  }
  if (close) close.disabled = !!busy;
}

async function submitAuth() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const displayName = document.getElementById("authDisplayName").value.trim();
  const passwordConfirm = document.getElementById("authPasswordConfirm").value;
  if (!email) { showAuthMsg("请填写邮箱"); return; }
  if (!isValidAuthEmail(email)) { showAuthMsg("请输入有效的邮箱地址"); return; }
  if (!password) { showAuthMsg("请填写密码"); return; }
  if (authMode === "register" && password.length < 8) { showAuthMsg("密码至少需要 8 个字符"); return; }
  if (authMode === "register" && !displayName) { showAuthMsg("请填写显示名称"); return; }
  if (authMode === "register" && displayName.length > 100) { showAuthMsg("显示名称不能超过 100 个字符"); return; }
  if (authMode === "register" && password !== passwordConfirm) { showAuthMsg("两次输入的密码不一致"); return; }
  if (!backendApi.baseUrl()) {
    showAuthMsg("当前是本地文件模式，请先用 HTTP 服务打开页面");
    return;
  }
  setAuthBusy(true);
  dataState.authStatus = "loading";
  renderAuthStatus();
  let user = null;
  try {
    user = authMode === "register"
      ? await backendApi.register({ email, password, display_name: displayName })
      : await backendApi.login({ email, password });
    if (!user || !user.id) throw new Error("auth_response_invalid");
  } catch (error) {
    dataState.authUser = null;
    dataState.authStatus = "guest";
    renderAuthStatus();
    showAuthMsg(error && error.message ? error.message : "登录失败，请稍后重试");
    setAuthBusy(false);
    return;
  }
  dataState.authUser = user;
  dataState.authStatus = "authenticated";
  dataState.authHydrated = true;
  // 登录用户可能还没有账本，必须允许空账本响应替换本地兼容数据。
  const hydrated = await hydrateAuthenticatedData();
  closeAuthPanel();
  renderAuthStatus();
  render();
  setAuthBusy(false);
}

async function logoutAuth() {
  if (dataState.authStatus === "loading") return;
  try {
    if (backendApi.baseUrl()) await backendApi.logout();
  } catch (error) {
    // 退出时即使网络失败也清掉本地会话状态，下一次请求会重新检查。
  }
  dataState.authUser = null;
  dataState.authStatus = "guest";
  dataState.authHydrated = true;
  clearLedgerStateForAuthGate();
  showAuthDataNotice("已退出登录，请重新登录后继续使用。");
  renderAuthStatus();
  if (typeof render === "function") render();
}

async function hydrateAuthSession() {
  dataState.authStatus = "loading";
  renderAuthStatus();
  if (!backendApi.baseUrl()) {
    dataState.authStatus = "guest";
    dataState.authHydrated = true;
    renderAuthStatus();
    return false;
  }
  let user;
  try {
    user = await backendApi.currentUser();
    if (!user || !user.id) throw new Error("auth_response_invalid");
  } catch (error) {
    dataState.authUser = null;
    dataState.authStatus = "guest";
    dataState.authHydrated = true;
    if (error && !error.status) {
      dataState.offlineMode = true;
      if (typeof initializeLocalLedger === "function") initializeLocalLedger();
      showAuthDataNotice("网络暂时不可用，已切换到本机数据；恢复网络后点击“联网登录”即可同步。 ");
      renderAuthStatus();
      return false;
    }
    clearLedgerStateForAuthGate();
    renderAuthStatus();
    return false;
  }
  dataState.authUser = user;
  dataState.authStatus = "authenticated";
  dataState.authHydrated = true;
  const hydrated = await hydrateAuthenticatedData();
  renderAuthStatus();
  render();
  return true;
}
