// 应用内确认框：统一中文文案，并避免浏览器/系统自带弹窗按钮随语言变化。

let pendingConfirm = null;
let pendingNotice = null;

function finishAppConfirm(result) {
  if (!pendingConfirm) return;
  const current = pendingConfirm;
  pendingConfirm = null;
  const dialog = document.getElementById("confirmDialog");
  const panel = dialog ? dialog.querySelector(".confirm-dialog") : null;
  if (dialog) dialog.hidden = true;
  if (typeof document !== "undefined" && document.body) document.body.classList.remove("dialog-open");
  document.removeEventListener("keydown", current.onKeyDown, true);
  if (current.restoreFocus && typeof current.restoreFocus.focus === "function") {
    current.restoreFocus.focus();
  } else if (panel && typeof panel.blur === "function") {
    panel.blur();
  }
  current.resolve(!!result);
}

function finishAppNotice() {
  if (!pendingNotice) return;
  const current = pendingNotice;
  pendingNotice = null;
  const dialog = document.getElementById("confirmDialog");
  const panel = dialog ? dialog.querySelector(".confirm-dialog") : null;
  const cancel = document.getElementById("confirmDialogCancel");
  if (dialog) dialog.hidden = true;
  if (cancel) cancel.hidden = false;
  if (typeof document !== "undefined" && document.body) document.body.classList.remove("dialog-open");
  document.removeEventListener("keydown", current.onKeyDown, true);
  if (current.restoreFocus && typeof current.restoreFocus.focus === "function") {
    current.restoreFocus.focus();
  } else if (panel && typeof panel.blur === "function") {
    panel.blur();
  }
  current.resolve(true);
}

function appConfirm(message, options = {}) {
  const dialog = document.getElementById("confirmDialog");
  const panel = dialog ? dialog.querySelector(".confirm-dialog") : null;
  const title = document.getElementById("confirmDialogTitle");
  const content = document.getElementById("confirmDialogMessage");
  const cancel = document.getElementById("confirmDialogCancel");
  const ok = document.getElementById("confirmDialogOk");
  // 单元测试或旧页面资源还没有弹窗节点时，沿用测试环境提供的确认函数；
  // 正常 App 页面始终会加载上面的应用内中文弹窗。
  if (!dialog || !panel || !title || !content || !cancel || !ok) {
    return Promise.resolve(typeof confirm === "function" ? confirm(String(message || "是否继续？")) : false);
  }

  if (pendingConfirm) finishAppConfirm(false);
  if (pendingNotice) finishAppNotice();
  title.textContent = options.title || "请确认";
  content.textContent = String(message || "是否继续？");
  dialog.hidden = false;
  if (typeof document !== "undefined" && document.body) document.body.classList.add("dialog-open");

  return new Promise(resolve => {
    const restoreFocus = document.activeElement;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishAppConfirm(false);
      }
    };
    pendingConfirm = { resolve, restoreFocus, onKeyDown };
    document.addEventListener("keydown", onKeyDown, true);
    cancel.onclick = () => finishAppConfirm(false);
    ok.onclick = () => finishAppConfirm(true);
    cancel.focus();
  });
}

// 应用内普通提示：只提供中文“确定”按钮，不让业务流程误把提示当成确认。
function appNotice(message, options = {}) {
  const dialog = document.getElementById("confirmDialog");
  const panel = dialog ? dialog.querySelector(".confirm-dialog") : null;
  const title = document.getElementById("confirmDialogTitle");
  const content = document.getElementById("confirmDialogMessage");
  const cancel = document.getElementById("confirmDialogCancel");
  const ok = document.getElementById("confirmDialogOk");
  if (!dialog || !panel || !title || !content || !cancel || !ok) {
    if (typeof alert === "function") alert(String(message || "操作提示"));
    return Promise.resolve(true);
  }

  if (pendingConfirm) finishAppConfirm(false);
  if (pendingNotice) finishAppNotice();
  title.textContent = options.title || "提示";
  content.textContent = String(message || "操作提示");
  cancel.hidden = true;
  dialog.hidden = false;
  if (typeof document !== "undefined" && document.body) document.body.classList.add("dialog-open");

  return new Promise(resolve => {
    const restoreFocus = document.activeElement;
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishAppNotice();
      }
    };
    pendingNotice = { resolve, restoreFocus, onKeyDown };
    document.addEventListener("keydown", onKeyDown, true);
    ok.onclick = () => finishAppNotice();
    ok.focus();
  });
}
