// 登录模块：负责注册、登录、退出和会话状态显示。

let authMode = "login";
let authMsgTimer = null;

function showAuthMsg(text, isError = true) {
  const message = document.getElementById("authMsg");
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("error", !!isError);
  message.classList.toggle("success", !isError);
  clearTimeout(authMsgTimer);
  authMsgTimer = setTimeout(() => { message.textContent = ""; }, 4000);
}

function renderAuthStatus() {
  const status = document.getElementById("authStatus");
  const open = document.getElementById("authOpenBtn");
  const logout = document.getElementById("authLogoutBtn");
  if (!status || !open || !logout) return;
  if (dataState.authStatus === "authenticated" && dataState.authUser) {
    status.textContent = "已登录：" + dataState.authUser.display_name;
    open.hidden = true;
    logout.hidden = false;
  } else if (dataState.authStatus === "loading") {
    status.textContent = "正在检查登录状态…";
    open.hidden = false;
    logout.hidden = true;
  } else {
    status.textContent = backendApi.baseUrl() ? "未登录（本地兼容模式）" : "本地模式";
    open.hidden = false;
    logout.hidden = true;
  }
}

function handleBackendAuthExpired() {
  const wasAuthenticated = dataState.authStatus === "authenticated" && dataState.authUser;
  dataState.authUser = null;
  dataState.authStatus = "guest";
  dataState.authHydrated = true;
  // 会话失效后不继续把页面当成服务端数据，恢复到浏览器本地快照。
  restoreLocalStateFromStorage();
  uiState.startupNotice = "登录状态已过期，请重新登录；当前显示浏览器本地数据。";
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
  if (title) title.textContent = authMode === "register" ? "创建账号" : "登录记账本";
  if (nameField) nameField.hidden = authMode !== "register";
  if (submit) submit.textContent = authMode === "register" ? "注册并登录" : "登录";
  if (loginTab) loginTab.classList.toggle("active", authMode === "login");
  if (registerTab) registerTab.classList.toggle("active", authMode === "register");
  showAuthMsg("");
}

function openAuthPanel(mode = "login") {
  const panel = document.getElementById("authPanel");
  if (!panel) return;
  setAuthMode(mode);
  panel.hidden = false;
  document.getElementById("authEmail").focus();
}

function closeAuthPanel() {
  const panel = document.getElementById("authPanel");
  if (panel) panel.hidden = true;
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
  if (!email) { showAuthMsg("请填写邮箱"); return; }
  if (!password) { showAuthMsg("请填写密码"); return; }
  if (authMode === "register" && !displayName) { showAuthMsg("请填写显示名称"); return; }
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
  closeAuthPanel();
  renderAuthStatus();
  // 登录用户可能还没有账本，必须允许空账本响应替换本地兼容数据。
  const hydrated = await startBackendReadHydration(true);
  if (!hydrated && dataState.authStatus === "authenticated") {
    showAuthMsg("已登录，但账本数据暂时无法读取", true);
  }
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
  restoreLocalStateFromStorage();
  renderAuthStatus();
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
    renderAuthStatus();
    await startBackendReadHydration(false);
    return false;
  }
  dataState.authUser = user;
  dataState.authStatus = "authenticated";
  dataState.authHydrated = true;
  renderAuthStatus();
  const hydrated = await startBackendReadHydration(true);
  if (!hydrated && dataState.authStatus === "authenticated") {
    showAuthMsg("已登录，但账本数据暂时无法读取", true);
  }
  render();
  return true;
}
