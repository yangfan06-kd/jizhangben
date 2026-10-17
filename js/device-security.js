// 本机隐私入口：凭据使用 PBKDF2 加盐摘要保存，不进入账本备份；这不是数据加密。

const DEVICE_LOCK_KEY = "ledger_device_lock_v1";
const PRIVACY_MASK_KEY = "ledger_privacy_mask_v1";
const DEVICE_LOCK_ITERATIONS = 150000;
let deviceAppStarted = false;
let deviceAppUnlocked = false;
let privacyMaskObserver = null;

function readDeviceLock() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEVICE_LOCK_KEY) || "null");
    if (!value || value.version !== 1 || !value.pin || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 2) return null;
    return value;
  } catch (error) { return null; }
}

function deviceCryptoAvailable() {
  return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder);
}

function randomDeviceSalt() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  return new Uint8Array(String(hex || "").match(/.{1,2}/g)?.map(value => parseInt(value, 16)) || []);
}

async function deviceDigest(value, saltHex) {
  const salt = hexToBytes(saltHex);
  const material = await window.crypto.subtle.importKey("raw", new window.TextEncoder().encode(String(value)), "PBKDF2", false, ["deriveBits"]);
  const bits = await window.crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: DEVICE_LOCK_ITERATIONS, hash: "SHA-256" }, material, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameDeviceDigest(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function applyPrivacyMask(masked) {
  const active = !!masked;
  document.body.classList.toggle("privacy-masked", active);
  syncPrivacyInputMasks(active);
  const button = document.getElementById("privacyToggleBtn");
  if (button) {
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-label", active ? "显示金额" : "隐藏金额");
    button.title = active ? "显示金额" : "隐藏金额";
    button.innerHTML = active
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path class="eye-slash" d="M4 20 20 4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  }
}

function syncPrivacyInputMasks(active) {
  if (!document.querySelectorAll) return;
  if (privacyMaskObserver) {
    privacyMaskObserver.disconnect();
    privacyMaskObserver = null;
  }
  document.querySelectorAll('input[inputmode="decimal"], input[type="number"], #amount, #balancePrincipal').forEach(input => {
    const host = input.parentElement;
    if (!host) return;
    let mask = host.querySelector(":scope > .privacy-input-mask");
    if (!active) {
      if (mask) mask.remove();
      host.classList.remove("privacy-mask-input-host");
      if (input.dataset.privacyOriginalColor !== undefined) {
        input.style.color = input.dataset.privacyOriginalColor;
        input.style.caretColor = input.dataset.privacyOriginalCaret;
        delete input.dataset.privacyOriginalColor;
        delete input.dataset.privacyOriginalCaret;
      }
      return;
    }
    if (!mask) {
      host.classList.add("privacy-mask-input-host");
      input.dataset.privacyOriginalColor = input.style.color;
      input.dataset.privacyOriginalCaret = input.style.caretColor;
      input.style.color = "transparent";
      input.style.caretColor = "transparent";
      mask = document.createElement("span");
      mask.className = "privacy-input-mask";
      mask.setAttribute("aria-hidden", "true");
      mask.textContent = input.value ? "******" : "";
      host.appendChild(mask);
      if (!input.dataset.privacyMaskListener) {
        input.dataset.privacyMaskListener = "1";
        input.addEventListener("input", () => {
          const currentMask = input.parentElement && input.parentElement.querySelector(":scope > .privacy-input-mask");
          if (currentMask) currentMask.textContent = input.value ? "******" : "";
        });
      }
    }
    mask.textContent = input.value ? "******" : "";
    const inputRect = input.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    mask.style.left = (inputRect.left - hostRect.left + host.scrollLeft + 1) + "px";
    mask.style.top = (inputRect.top - hostRect.top + host.scrollTop + 1) + "px";
    mask.style.width = Math.max(0, inputRect.width - 2) + "px";
    mask.style.height = Math.max(0, inputRect.height - 2) + "px";
    mask.style.paddingLeft = style.paddingLeft;
    mask.style.backgroundColor = style.backgroundColor;
    mask.style.fontSize = style.fontSize;
    mask.style.fontWeight = style.fontWeight;
    mask.style.fontFamily = style.fontFamily;
    mask.style.lineHeight = style.lineHeight;
  });
  if (active && typeof MutationObserver !== "undefined" && document.body) {
    privacyMaskObserver = new MutationObserver(() => syncPrivacyInputMasks(true));
    privacyMaskObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function togglePrivacyMask() {
  const next = !document.body.classList.contains("privacy-masked");
  applyPrivacyMask(next);
  try { window.localStorage.setItem(PRIVACY_MASK_KEY, next ? "1" : "0"); }
  catch (error) { /* 只影响本次显示，不阻断记账 */ }
}

function deviceLockMessage(message, isError = false) {
  const box = document.getElementById("appLockMessage");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("warn", !!isError);
}

function showDeviceLock() {
  const overlay = document.getElementById("appLockOverlay");
  const pinPane = document.getElementById("appLockPinPane");
  const recoveryPane = document.getElementById("appLockRecoveryPane");
  const pin = document.getElementById("appLockPinInput");
  const remember = document.getElementById("appLockRemember");
  if (!overlay) return;
  overlay.hidden = false;
  if (pinPane) pinPane.hidden = false;
  if (recoveryPane) recoveryPane.hidden = true;
  if (pin) { pin.value = ""; setTimeout(() => pin.focus({ preventScroll: true }), 50); }
  if (remember) remember.checked = false;
  deviceLockMessage("");
}

function deviceLockRateStatus(config) {
  const remaining = Number(config && config.blockedUntil || 0) - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailedDeviceAttempt(config) {
  config.failedAttempts = Number(config.failedAttempts || 0) + 1;
  if (config.failedAttempts >= 5) {
    config.failedAttempts = 0;
    config.blockedUntil = Date.now() + 30000;
  }
  try { window.localStorage.setItem(DEVICE_LOCK_KEY, JSON.stringify(config)); } catch (error) { /* no-op */ }
}

function unlockDeviceApp() {
  const overlay = document.getElementById("appLockOverlay");
  if (overlay) overlay.hidden = true;
  deviceAppUnlocked = true;
  if (!deviceAppStarted) {
    deviceAppStarted = true;
    startApplicationCore();
  } else {
    if (typeof processDueInvestmentPlans === "function") processDueInvestmentPlans();
    if (typeof processDueFixedIncome === "function") processDueFixedIncome();
    if (typeof render === "function") render();
  }
}

async function submitDeviceUnlock() {
  const config = readDeviceLock();
  const pin = document.getElementById("appLockPinInput").value;
  if (!config) { deviceLockMessage("本机密码设置无效，请在此设备清除应用数据后重新设置。", true); return; }
  const waitSeconds = deviceLockRateStatus(config);
  if (waitSeconds) { deviceLockMessage("尝试次数过多，请 " + waitSeconds + " 秒后再试。", true); return; }
  if (!/^\d{6}$/.test(pin)) { deviceLockMessage("请输入六位数字密码。", true); return; }
  try {
    const digest = await deviceDigest(pin, config.pin.salt);
    if (!sameDeviceDigest(digest, config.pin.hash)) {
      recordFailedDeviceAttempt(config);
      deviceLockMessage(config.failedAttempts === 0 ? "尝试次数过多，请稍后再试。" : "密码不正确，请重试。", true);
      return;
    }
    config.failedAttempts = 0;
    config.blockedUntil = 0;
    config.trustedDevice = !!document.getElementById("appLockRemember")?.checked;
    window.localStorage.setItem(DEVICE_LOCK_KEY, JSON.stringify(config));
    unlockDeviceApp();
  } catch (error) {
    deviceLockMessage("验证失败，请重启应用后重试。", true);
  }
}

function showDeviceRecovery() {
  const config = readDeviceLock();
  if (!config) return;
  const select = document.getElementById("appLockQuestionSelect");
  const pinPane = document.getElementById("appLockPinPane");
  const recovery = document.getElementById("appLockRecoveryPane");
  select.innerHTML = "";
  config.questions.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.question;
    select.appendChild(option);
  });
  pinPane.hidden = true;
  recovery.hidden = false;
  document.getElementById("appLockIntro").textContent = "答对任意一个找回问题后，可设置新密码。";
  deviceLockMessage("");
}

async function resetDevicePinFromRecovery(event) {
  event.preventDefault();
  const config = readDeviceLock();
  if (!config) return;
  const waitSeconds = deviceLockRateStatus(config);
  if (waitSeconds) { deviceLockMessage("尝试次数过多，请 " + waitSeconds + " 秒后再试。", true); return; }
  const index = Number(document.getElementById("appLockQuestionSelect").value);
  const answer = document.getElementById("appLockAnswerInput").value.trim().toLocaleLowerCase();
  const pin = document.getElementById("appLockNewPin").value;
  const confirmPin = document.getElementById("appLockNewPinConfirm").value;
  if (!/^\d{6}$/.test(pin) || pin !== confirmPin) { deviceLockMessage("请确认两次输入相同的六位数字新密码。", true); return; }
  const question = config.questions[index];
  if (!question || !answer) { deviceLockMessage("请选择问题并填写答案。", true); return; }
  try {
    const answerDigest = await deviceDigest(answer, question.salt);
    if (!sameDeviceDigest(answerDigest, question.hash)) {
      recordFailedDeviceAttempt(config);
      deviceLockMessage(config.failedAttempts === 0 ? "尝试次数过多，请稍后再试。" : "答案不正确，请重试。", true);
      return;
    }
    const salt = randomDeviceSalt();
    config.pin = { salt, hash: await deviceDigest(pin, salt) };
    config.failedAttempts = 0;
    config.blockedUntil = 0;
    config.trustedDevice = false;
    window.localStorage.setItem(DEVICE_LOCK_KEY, JSON.stringify(config));
    document.getElementById("appLockAnswerInput").value = "";
    unlockDeviceApp();
  } catch (error) {
    deviceLockMessage("重设失败，请重试。", true);
  }
}

async function saveDeviceLockSettings(event) {
  event.preventDefault();
  const status = document.getElementById("deviceLockSettingsMsg");
  const pin = document.getElementById("deviceLockPin").value;
  const confirmPin = document.getElementById("deviceLockPinConfirm").value;
  const question1 = document.getElementById("deviceLockQuestion1").value.trim();
  const answer1 = document.getElementById("deviceLockAnswer1").value.trim().toLocaleLowerCase();
  const question2 = document.getElementById("deviceLockQuestion2").value.trim();
  const answer2 = document.getElementById("deviceLockAnswer2").value.trim().toLocaleLowerCase();
  const currentPin = document.getElementById("deviceLockCurrentPin").value;
  const previous = readDeviceLock();
  const say = (message, error = false) => { status.textContent = message; status.classList.toggle("warn", error); };
  if (!deviceCryptoAvailable()) { say("此设备暂不支持安全摘要，无法启用本机密码。", true); return; }
  if (!/^\d{6}$/.test(pin) || pin !== confirmPin) { say("请输入两次相同的六位数字密码。", true); return; }
  if (previous) {
    if (!/^\d{6}$/.test(currentPin)) { say("请输入当前六位密码后再修改。", true); return; }
    try {
      const currentDigest = await deviceDigest(currentPin, previous.pin.salt);
      if (!sameDeviceDigest(currentDigest, previous.pin.hash)) { say("当前密码不正确，未修改设置。", true); return; }
    } catch (error) {
      say("当前密码验证失败，原设置未改变。", true);
      return;
    }
  }
  if ((!previous && (!question1 || !answer1)) || (!!question1 !== !!answer1) || (!!question2 !== !!answer2)) {
    say(previous ? "修改找回问题时，问题和答案需要同时填写。" : "首次启用时请填写问题一和答案；问题二与答案需同时填写。", true);
    return;
  }
  const questions = previous ? previous.questions.slice() : [];
  if (question1) {
    const salt = randomDeviceSalt();
    questions[0] = { question: question1, salt, hash: await deviceDigest(answer1, salt) };
  }
  if (question2) {
    const duplicate = questions.some((item, index) => index !== 1 && item.question === question2);
    if (duplicate) { say("两个找回问题不能相同。", true); return; }
    const salt = randomDeviceSalt();
    questions[1] = { question: question2, salt, hash: await deviceDigest(answer2, salt) };
  }
  if (!questions.length || questions.some(item => !item)) { say("至少需要保留一个找回问题。", true); return; }
  if (new Set(questions.map(item => item.question)).size !== questions.length) { say("两个找回问题不能相同。", true); return; }
  try {
    const pinSalt = randomDeviceSalt();
    const config = { version: 1, pin: { salt: pinSalt, hash: await deviceDigest(pin, pinSalt) }, questions, failedAttempts: 0, blockedUntil: 0, trustedDevice: false };
    window.localStorage.setItem(DEVICE_LOCK_KEY, JSON.stringify(config));
    renderDeviceLockSettings();
    document.getElementById("deviceLockPin").value = "";
    document.getElementById("deviceLockPinConfirm").value = "";
    document.getElementById("deviceLockCurrentPin").value = "";
    document.getElementById("deviceLockQuestion1").value = "";
    document.getElementById("deviceLockQuestion2").value = "";
    document.getElementById("deviceLockAnswer1").value = "";
    document.getElementById("deviceLockAnswer2").value = "";
    say(previous ? "本机密码已修改；已有账本数据和流水未改变。" : "本机密码已启用。以后重新打开应用或从后台返回时需要验证。");
  } catch (error) {
    say("保存失败，原设置未主动清除。", true);
  }
}

async function disableDeviceLock() {
  if (!readDeviceLock()) return;
  if (!await appConfirm("关闭本机密码吗？账本数据不会删除。")) return;
  try {
    window.localStorage.removeItem(DEVICE_LOCK_KEY);
    renderDeviceLockSettings();
    document.getElementById("deviceLockSettingsMsg").textContent = "本机密码已关闭。";
  } catch (error) {
    document.getElementById("deviceLockSettingsMsg").textContent = "关闭失败，请重试。";
  }
}

async function forgetTrustedDevice() {
  const config = readDeviceLock();
  if (!config || config.trustedDevice !== true) return;
  try {
    config.trustedDevice = false;
    window.localStorage.setItem(DEVICE_LOCK_KEY, JSON.stringify(config));
    renderDeviceLockSettings();
    document.getElementById("deviceLockSettingsMsg").textContent = "已取消免输密码，下次进入时需要验证。";
  } catch (error) {
    document.getElementById("deviceLockSettingsMsg").textContent = "取消失败，请重试。";
  }
}

function renderDeviceLockSettings() {
  const button = document.getElementById("deviceLockDisableBtn");
  const forgetButton = document.getElementById("deviceLockForgetBtn");
  const saveButton = document.getElementById("deviceLockSaveBtn");
  const currentField = document.getElementById("deviceLockCurrentPinField");
  const summary = document.getElementById("deviceLockQuestionSummary");
  const config = readDeviceLock();
  if (button) { button.disabled = !config; button.hidden = !config; }
  if (forgetButton) forgetButton.hidden = !config || config.trustedDevice !== true;
  if (currentField) currentField.hidden = !config;
  if (saveButton) saveButton.textContent = config ? "修改本机密码" : "设置本机密码";
  if (summary) {
    summary.hidden = !config;
    summary.textContent = config ? "当前找回问题：" + config.questions.map(item => item.question).join("、") + "。修改密码时留空即可保留。" : "";
  }
  const currentPin = document.getElementById("deviceLockCurrentPin");
  if (currentPin) currentPin.value = "";
}

function bindDeviceSecurityEvents() {
  const eye = document.getElementById("privacyToggleBtn");
  const form = document.getElementById("deviceLockForm");
  const unlock = document.getElementById("appLockUnlockBtn");
  const recover = document.getElementById("appLockRecoverBtn");
  const cancelRecovery = document.getElementById("appLockRecoveryCancelBtn");
  const recovery = document.getElementById("appLockRecoveryPane");
  const disable = document.getElementById("deviceLockDisableBtn");
  const forget = document.getElementById("deviceLockForgetBtn");
  if (eye) eye.onclick = togglePrivacyMask;
  if (form) form.onsubmit = saveDeviceLockSettings;
  if (unlock) unlock.onclick = submitDeviceUnlock;
  if (recover) recover.onclick = showDeviceRecovery;
  if (cancelRecovery) cancelRecovery.onclick = () => {
    document.getElementById("appLockRecoveryPane").hidden = true;
    document.getElementById("appLockPinPane").hidden = false;
    document.getElementById("appLockIntro").textContent = "请输入六位数字密码";
    deviceLockMessage("");
  };
  if (recovery) recovery.onsubmit = resetDevicePinFromRecovery;
  if (disable) disable.onclick = disableDeviceLock;
  if (forget) forget.onclick = forgetTrustedDevice;
  const pin = document.getElementById("appLockPinInput");
  if (pin) pin.addEventListener("keydown", event => { if (event.key === "Enter") submitDeviceUnlock(); });
}

function initializeDeviceSecurity() {
  bindDeviceSecurityEvents();
  renderDeviceLockSettings();
  applyPrivacyMask(window.localStorage.getItem(PRIVACY_MASK_KEY) === "1");
  const config = readDeviceLock();
  if (config && config.trustedDevice !== true) showDeviceLock();
  else {
    deviceAppStarted = true;
    deviceAppUnlocked = true;
    startApplicationCore();
  }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => {
    const config = readDeviceLock();
    if (document.visibilityState !== "hidden" || !deviceAppStarted || !deviceAppUnlocked || !config || config.trustedDevice === true) return;
    deviceAppUnlocked = false;
    showDeviceLock();
  });
}
