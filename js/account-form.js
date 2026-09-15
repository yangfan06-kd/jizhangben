// 账户表单模块：负责账户的新增、编辑和删除。
// 账户余额计算由 records.js 提供，账户数据保存由 storage.js 提供。

let accMsgTimer = null;

function showAccMsg(text) {
  const m = document.getElementById("accMsg");
  m.textContent = text;
  clearTimeout(accMsgTimer);
  accMsgTimer = setTimeout(() => { m.textContent = ""; }, 3000);
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
  const name = document.getElementById("accName").value.trim();
  const kind = document.getElementById("accKind").value;
  const initial = parseFloat(document.getElementById("accInitial").value) || 0;
  const initialCents = toCents(initial);
  if (!name) { showAccMsg("请填写账户名"); return; }

  const wasEdit = !!uiState.editingAccountId;
  let backendFallback = false;
  // 新账户先写入后端；已有账户的修改暂时保留本地流程，下一步再切换 PATCH。
  if (!wasEdit && backendWritesEnabled()) {
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
      restoreLocalStateFromStorage();
      backendFallback = true;
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

function deleteAccount(id) {
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  if (!a) return;
  if (!confirm("确定删除账户「" + a.name + "」吗？\n（用它记过的账会显示为“未指定”）")) return;
  dataState.accounts = dataState.accounts.filter(x => String(x.id) !== String(id));
  saveAccounts();
  resetAccountForm();
  render();
}
