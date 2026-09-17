// 账户表单模块：负责账户的新增、编辑和删除。
// 账户余额计算由 records.js 提供，账户数据保存由 storage.js 提供。

let accMsgTimer = null;

function showAccMsg(text) {
  const m = document.getElementById("accMsg");
  m.textContent = text;
  clearTimeout(accMsgTimer);
  accMsgTimer = setTimeout(() => { m.textContent = ""; }, 3000);
}

function setAccountSaveBusy(busy) {
  uiState.accountSaveInFlight = !!busy;
  const saveBtn = document.getElementById("accSaveBtn");
  const cancelBtn = document.getElementById("accCancelBtn");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy) saveBtn.textContent = "保存中…";
    else saveBtn.textContent = uiState.editingAccountId === null ? "添加账户" : "保存修改";
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function setAccountDeleteBusy(busy) {
  uiState.accountDeleteInFlight = !!busy;
  const saveBtn = document.getElementById("accSaveBtn");
  const cancelBtn = document.getElementById("accCancelBtn");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy) saveBtn.textContent = "删除中…";
    else saveBtn.textContent = uiState.editingAccountId === null ? "添加账户" : "保存修改";
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function accountFingerprint(account) {
  if (!account) return null;
  return {
    name: account.name,
    kind: account.kind,
    initialCents: Number.isFinite(Number(account.initialCents))
      ? Math.round(Number(account.initialCents))
      : toCents(account.initial)
  };
}

function findLocalAccountByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  const matches = dataState.accounts.filter(account => (
    account.name === fingerprint.name &&
    account.kind === fingerprint.kind &&
    (Number.isFinite(Number(account.initialCents)) ? Math.round(Number(account.initialCents)) : toCents(account.initial)) === fingerprint.initialCents
  ));
  return matches.length === 1 ? matches[0] : null;
}

function resetAccountForm() {
  uiState.editingAccountId = null;
  document.getElementById("accName").value = "";
  document.getElementById("accKind").value = "资金";
  document.getElementById("accInitial").value = "";
  document.getElementById("accSaveBtn").textContent = "添加账户";
  document.getElementById("accCancelBtn").style.display = "none";
  document.getElementById("accMsg").textContent = "";
}

async function handleAccountSave() {
  if (uiState.accountSaveInFlight || uiState.accountDeleteInFlight) {
    showAccMsg("正在处理，请稍候");
    return;
  }
  const name = document.getElementById("accName").value.trim();
  const kind = document.getElementById("accKind").value;
  const initial = parseFloat(document.getElementById("accInitial").value) || 0;
  const initialCents = toCents(initial);
  if (!name) { showAccMsg("请填写账户名"); return; }

  const wasEdit = uiState.editingAccountId !== null;
  const originalAccount = wasEdit
    ? dataState.accounts.find(x => String(x.id) === String(uiState.editingAccountId))
    : null;
  const originalFingerprint = accountFingerprint(originalAccount);
  let backendFallback = false;

  if (wasEdit && !originalAccount) {
    showAccMsg("找不到正在编辑的账户，请重新选择");
    return;
  }

  if (wasEdit && backendWritesEnabled() && originalAccount && typeof originalAccount.id === "string") {
    setAccountSaveBusy(true);
    try {
      const saved = await backendApi.updateAccount(dataState.currentBookId, originalAccount.id, {
        name,
        kind: kind === "负债" ? "liability" : "asset",
        initial_cents: initialCents
      });
      if (!saved || !saved.id) throw new Error("account_response_invalid");
      const index = dataState.accounts.findIndex(x => String(x.id) === String(originalAccount.id));
      if (index >= 0) dataState.accounts[index] = mapBackendAccount(saved);
      await refreshBackendOverviewAfterWrite();
      resetAccountForm();
      showAccMsg("已保存到账户服务端");
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showAccMsg(error.message || "服务端拒绝了账户修改");
      } else {
        restoreLocalStateFromStorage();
        const localAccount = findLocalAccountByFingerprint(originalFingerprint);
        if (!localAccount) {
          showAccMsg("服务端不可用，本地未找到原账户，修改未保存");
        } else {
          localAccount.name = name;
          localAccount.kind = kind;
          localAccount.initial = initialCents / 100;
          localAccount.initialCents = initialCents;
          saveAccounts();
          if (typeof markLocalChangePending === "function") markLocalChangePending("account_edit");
          resetAccountForm();
          showAccMsg("服务端不可用，已在本地保存修改");
          render();
        }
      }
    } finally {
      setAccountSaveBusy(false);
    }
    return;
  }

  // 新账户和账户修改都优先写入后端；缺少服务端 ID 时继续本地流程。
  if (!wasEdit && backendWritesEnabled()) {
    setAccountSaveBusy(true);
    try {
      const saved = await backendApi.createAccount(dataState.currentBookId, {
        name,
        kind: kind === "负债" ? "liability" : "asset",
        initial_cents: initialCents
      });
      dataState.accounts.push(mapBackendAccount(saved));
      await refreshBackendOverviewAfterWrite();
      resetAccountForm();
      showAccMsg("已添加到账户服务端");
      render();
      return;
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showAccMsg(error.message || "服务端拒绝创建账户");
        return;
      }
      restoreLocalStateFromStorage();
      backendFallback = true;
    } finally {
      setAccountSaveBusy(false);
    }
  }

  if (wasEdit) {
    const a = dataState.accounts.find(x => String(x.id) === String(uiState.editingAccountId));
    a.name = name;
    a.kind = kind;
    a.initial = initialCents / 100;
    a.initialCents = initialCents;
  } else {
    dataState.accounts.push({ id: nextId(dataState.accounts), name: name, kind: kind, initial: initialCents / 100, initialCents: initialCents });
  }
  saveAccounts();
  if (backendFallback || (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange())) {
    if (typeof markLocalChangePending === "function") markLocalChangePending(wasEdit ? "account_edit" : "account_write");
  }
  resetAccountForm();
  showAccMsg(wasEdit ? "已保存修改" : (backendFallback ? "服务端不可用，已保存到本地" : "已添加账户"));
  render();
}

function startEditAccount(id) {
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  if (!a) return;
  uiState.editingAccountId = id;
  document.getElementById("accName").value = a.name;
  document.getElementById("accKind").value = a.kind;
  document.getElementById("accInitial").value = initialOf(a);
  document.getElementById("accSaveBtn").textContent = "保存修改";
  document.getElementById("accCancelBtn").style.display = "block";
}

async function deleteAccount(id) {
  if (uiState.accountSaveInFlight) {
    showAccMsg("正在保存，请稍候");
    return;
  }
  if (uiState.accountDeleteInFlight) {
    showAccMsg("正在删除，请稍候");
    return;
  }
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  if (!a) return;
  if (!confirm("确定删除账户「" + a.name + "」吗？\n（用它记过的账会显示为“未指定”）")) return;
  const fingerprint = accountFingerprint(a);
  if (backendWritesEnabled() && typeof a.id === "string") {
    setAccountDeleteBusy(true);
    try {
      await backendApi.deleteAccount(dataState.currentBookId, a.id);
      dataState.accounts = dataState.accounts.filter(x => String(x.id) !== String(id));
      const recordsRefreshed = await refreshBackendRecordsAfterWrite();
      if (!recordsRefreshed) dataState.backendRecordsLoaded = false;
      await refreshBackendOverviewAfterWrite();
      resetAccountForm();
      showAccMsg(recordsRefreshed ? "已删除账户（已同步服务端）" : "已删除账户（服务端已删除，明细刷新稍后重试）");
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showAccMsg(error.message || "服务端拒绝删除账户");
      } else {
        restoreLocalStateFromStorage();
        const localAccount = findLocalAccountByFingerprint(fingerprint);
        if (!localAccount) {
          showAccMsg("服务端不可用，本地未找到这笔账户，未删除");
        } else {
          dataState.accounts = dataState.accounts.filter(item => item !== localAccount);
          saveAccounts();
          if (typeof markLocalChangePending === "function") markLocalChangePending("account_delete");
          resetAccountForm();
          showAccMsg("服务端不可用，已在本地删除账户");
          render();
        }
      }
    } finally {
      setAccountDeleteBusy(false);
    }
    return;
  }

  dataState.accounts = dataState.accounts.filter(x => String(x.id) !== String(id));
  saveAccounts();
  if (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange() && typeof markLocalChangePending === "function") {
    markLocalChangePending("account_delete");
  }
  resetAccountForm();
  showAccMsg("已删除账户");
  render();
}
