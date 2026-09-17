// 记账表单模块：负责新增、编辑、取消和删除记录。
// 金额和余额计算由 records.js 提供，存储由 storage.js 提供。

let msgTimer = null;

function showMsg(text, status = "error") {
  const m = document.getElementById("formMsg");
  m.textContent = text;
  uiState.recordSaveStatus = status;
  if (m.classList) {
    ["success", "local", "conflict", "info", "busy", "error"].forEach(name => {
      if (typeof m.classList.remove === "function") m.classList.remove(name);
    });
    if (typeof m.classList.add === "function") m.classList.add(status);
  }
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { m.textContent = ""; }, 3000);
}

function resetForm() {
  uiState.selectedType = null;
  uiState.selectedCategory = null;
  uiState.selectedDepositDir = null;
  uiState.editingRecordId = null;
  uiState.recordSaveStatus = "idle";
  document.getElementById("amount").value = "";
  document.getElementById("note").value = "";
  document.getElementById("date").value = todayStr();
  document.getElementById("accountSel").value = "";
  document.getElementById("toAccountSel").value = "";
  document.getElementById("depositTarget").value = "";
  document.getElementById("depositLinkSel").value = "";
  document.getElementById("depositFinal").checked = false;
  document.getElementById("saveBtn").textContent = "保存这笔账";
  document.getElementById("cancelBtn").style.display = "none";
  document.getElementById("formMsg").textContent = "";
  document.getElementById("typeCustomBox").innerHTML = "";
  document.getElementById("categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  updateFormFields();
}

function localAccountIdByName(name) {
  if (!name) return null;
  const account = dataState.accounts.find(item => item.name === name);
  return account ? account.id : null;
}

function localDepositIdByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  const record = dataState.records.find(item => (
    item.type === fingerprint.type &&
    item.category === fingerprint.category &&
    item.date === fingerprint.date &&
    amountOf(item) === fingerprint.amount &&
    item.depositDir === fingerprint.depositDir &&
    (item.depositTarget || null) === (fingerprint.depositTarget || null) &&
    (item.note || "") === (fingerprint.note || "")
  ));
  return record ? record.id : null;
}

function saveRecordLocally(record, message, restore, status = "local") {
  if (restore) restoreLocalStateFromStorage();
  if (record.accountName) record.account = localAccountIdByName(record.accountName);
  if (record.toAccountName) record.toAccount = localAccountIdByName(record.toAccountName);
  if (record.depositLinkFingerprint) {
    record.depositLinkId = localDepositIdByFingerprint(record.depositLinkFingerprint);
  }
  delete record.accountName;
  delete record.toAccountName;
  delete record.depositLinkFingerprint;
  record.id = nextId(dataState.records);
  dataState.records.push(record);
  save();
  if (typeof markLocalChangePending === "function") markLocalChangePending("record_write");
  resetForm();
  showMsg(message, status);
  render();
}

function backendDepositDirection(direction) {
  return {
    "收": "receive",
    "退": "return_to_other",
    "付": "pay",
    "退回": "returned_to_me"
  }[direction] || null;
}

function backendRecordPayload(record, typeId, categoryId) {
  return {
    type_id: typeId,
    category_id: categoryId,
    account_id: needsAccount(record.type) ? (record.account || null) : null,
    to_account_id: record.type === "转账" ? (record.toAccount || null) : null,
    amount_cents: record.amountCents,
    occurred_on: record.date,
    note: record.note || "",
    deposit_direction: record.depositDir ? backendDepositDirection(record.depositDir) : null,
    deposit_target: record.type === "押金" ? (record.depositTarget || null) : null,
    deposit_link_id: record.depositLinkId || null,
    deposit_final: !!record.depositFinal
  };
}

function accountNameById(id) {
  if (id === null || id === undefined || id === "") return null;
  const account = dataState.accounts.find(item => String(item.id) === String(id));
  return account ? account.name : null;
}

function recordFingerprint(record) {
  if (!record) return null;
  return {
    type: record.type,
    category: record.category,
    date: record.date,
    amount: amountOf(record),
    note: record.note || "",
    accountName: accountNameById(record.account),
    toAccountName: accountNameById(record.toAccount),
    depositDir: record.depositDir || null,
    depositTarget: record.depositTarget || null
  };
}

function localRecordMatchesFingerprint(record, fingerprint) {
  if (!record || !fingerprint) return false;
  return record.type === fingerprint.type &&
    record.category === fingerprint.category &&
    record.date === fingerprint.date &&
    amountOf(record) === fingerprint.amount &&
    (record.note || "") === fingerprint.note &&
    accountNameById(record.account) === fingerprint.accountName &&
    accountNameById(record.toAccount) === fingerprint.toAccountName &&
    (record.depositDir || null) === fingerprint.depositDir &&
    (record.depositTarget || null) === fingerprint.depositTarget;
}

function findLocalRecordByFingerprint(fingerprint) {
  const matches = dataState.records.filter(record => localRecordMatchesFingerprint(record, fingerprint));
  return matches.length === 1 ? matches[0] : null;
}

function applyRecordDraft(target, draft) {
  target.type = draft.type;
  target.amount = draft.amount;
  target.amountCents = draft.amountCents;
  target.category = draft.category;
  target.note = draft.note;
  target.date = draft.date;
  target.account = draft.account;
  target.toAccount = draft.toAccount;
  target.depositDir = draft.depositDir;
  target.depositTarget = draft.depositTarget;
  target.depositLinkId = draft.depositLinkId;
  target.depositFinal = draft.depositFinal;
}

function saveEditedRecordLocally(draft, originalFingerprint, message) {
  restoreLocalStateFromStorage();
  const target = findLocalRecordByFingerprint(originalFingerprint);
  if (!target) {
    showMsg("服务端不可用，本地未找到原账目，修改未保存", "info");
    render();
    return false;
  }
  if (draft.accountName) draft.account = localAccountIdByName(draft.accountName);
  if (draft.toAccountName) draft.toAccount = localAccountIdByName(draft.toAccountName);
  if (draft.depositLinkFingerprint) {
    draft.depositLinkId = localDepositIdByFingerprint(draft.depositLinkFingerprint);
  }
  applyRecordDraft(target, draft);
  save();
  if (typeof markLocalChangePending === "function") markLocalChangePending("record_edit");
  resetForm();
  showMsg(message, "local");
  render();
  return true;
}

function setRecordSaveBusy(busy) {
  uiState.recordSaveInFlight = !!busy;
  if (busy) uiState.recordSaveStatus = "saving";
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  if (saveBtn) {
    if (busy) {
      if (saveBtn.dataset) saveBtn.dataset.idleText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = "保存中…";
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = saveBtn.dataset && saveBtn.dataset.idleText
        ? saveBtn.dataset.idleText
        : (uiState.editingRecordId === null ? "保存这笔账" : "保存修改");
      if (saveBtn.dataset) delete saveBtn.dataset.idleText;
    }
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

async function handleSave() {
  if (uiState.recordSaveInFlight) {
    showMsg("正在保存，请稍候", "busy");
    return;
  }
  if (uiState.recordDeleteInFlight) {
    showMsg("正在删除，请稍候", "busy");
    return;
  }
  const amount = parseFloat(document.getElementById("amount").value);
  const amountCents = toCents(amount);
  const note = document.getElementById("note").value.trim();
  const date = document.getElementById("date").value;
  const account = document.getElementById("accountSel").value || null;
  const toAccount = document.getElementById("toAccountSel").value || null;
  const depositDir = (uiState.selectedType === "押金") ? uiState.selectedDepositDir : null;
  const depositTarget = document.getElementById("depositTarget").value.trim();
  const depositLinkId = (uiState.selectedType === "押金") ? (document.getElementById("depositLinkSel").value || null) : null;
  const depositFinal = (uiState.selectedType === "押金") ? document.getElementById("depositFinal").checked : false;

  if (!uiState.selectedType) { showMsg("请先选择一个类型"); return; }
  if (!uiState.selectedCategory) { showMsg("请先选择一个类别"); return; }
  if (isNaN(amount) || amountCents <= 0) { showMsg("请输入大于 0 的金额"); return; }
  if (!date) { showMsg("请选择日期"); return; }
  if (needsAccount(uiState.selectedType) && !account) { showMsg("请选择账户"); return; }
  if (uiState.selectedType === "转账") {
    if (!toAccount) { showMsg("转账需要选择转入账户"); return; }
    if (account === toAccount) { showMsg("转出和转入账户不能相同"); return; }
  }
  if (uiState.selectedType === "押金") {
    if (!depositDir) { showMsg("请选择押金方向（主动收/别人退回/主动付/我退）"); return; }
    if (!depositTarget) { showMsg("请填写押金对象（谁对谁押）"); return; }
    if (depositCounterpartDir(depositDir) && !depositLinkId) { showMsg("请选择要对应的原押金"); return; }
  }

  const wasEdit = uiState.editingRecordId !== null;
  const originalRecord = wasEdit
    ? dataState.records.find(r => String(r.id) === String(uiState.editingRecordId))
    : null;
  const originalFingerprint = recordFingerprint(originalRecord);
  const accountName = account ? (dataState.accounts.find(item => String(item.id) === String(account)) || {}).name : null;
  const toAccountName = toAccount ? (dataState.accounts.find(item => String(item.id) === String(toAccount)) || {}).name : null;
  const linkedRecord = depositLinkId
    ? dataState.records.find(item => String(item.id) === String(depositLinkId))
    : null;
  const selectedType = uiState.selectedType;
  const selectedCategory = uiState.selectedCategory;
  const localRecord = {
    id: nextId(dataState.records),
    type: selectedType,
    amount: amountCents / 100,
    amountCents: amountCents,
    category: selectedCategory,
    note: note,
    date: date,
    account: account,
    toAccount: (selectedType === "转账") ? toAccount : null,
    depositDir: depositDir,
    depositTarget: (selectedType === "押金") ? depositTarget : null,
    depositLinkId: depositLinkId,
    depositFinal: depositFinal,
  };
  const fallbackRecord = Object.assign({}, localRecord, {
    accountName: accountName,
    toAccountName: toAccountName,
    depositLinkFingerprint: linkedRecord ? {
      type: linkedRecord.type,
      category: linkedRecord.category,
      date: linkedRecord.date,
      amount: amountOf(linkedRecord),
      depositDir: linkedRecord.depositDir,
      depositTarget: linkedRecord.depositTarget,
      note: linkedRecord.note
    } : null
  });

  if (!wasEdit && backendRecordWritesEnabled()) {
    const typeId = backendOptionId(dataState.backendTypeIds, selectedType);
    const categoryId = backendOptionId(dataState.backendCategoryIds, selectedCategory);
    if (!typeId || !categoryId) {
      saveRecordLocally(fallbackRecord, "服务端选项尚未同步，已保存到本地", true, "local");
      return;
    }
    setRecordSaveBusy(true);
    const payload = backendRecordPayload(localRecord, typeId, categoryId);
    try {
      const saved = await backendApi.createRecord(dataState.currentBookId, payload);
      if (!saved || !saved.id) throw new Error("record_response_invalid");
      const mapped = mapBackendRecord(Object.assign({}, saved, {
        type_name: selectedType,
        category_name: selectedCategory
      }));
      dataState.records.push(mapped);
      const recordsRefreshed = await refreshBackendRecordsAfterWrite();
      await refreshBackendOverviewAfterWrite();
      resetForm();
      showMsg(recordsRefreshed
        ? "已记一笔（已同步服务端）"
        : "已记一笔（服务端已保存，明细刷新稍后重试）",
        recordsRefreshed ? "success" : "info");
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showMsg(error.message || "服务端拒绝了这笔账，请检查输入", "conflict");
      } else {
        saveRecordLocally(fallbackRecord, "服务端不可用，已保存到本地", true, "local");
      }
    } finally {
      setRecordSaveBusy(false);
    }
    return;
  }

  if (wasEdit && backendRecordWritesEnabled()) {
    const typeId = backendOptionId(dataState.backendTypeIds, selectedType);
    const categoryId = backendOptionId(dataState.backendCategoryIds, selectedCategory);
    if (!originalRecord || !typeId || !categoryId) {
      showMsg("服务端选项尚未同步，修改未保存，请稍后重试", "conflict");
      return;
    }
    setRecordSaveBusy(true);
    try {
      const saved = await backendApi.updateRecord(
        dataState.currentBookId,
        originalRecord.id,
        backendRecordPayload(localRecord, typeId, categoryId)
      );
      if (!saved || !saved.id) throw new Error("record_response_invalid");
      const mapped = mapBackendRecord(Object.assign({}, saved, {
        type_name: selectedType,
        category_name: selectedCategory
      }));
      const index = dataState.records.findIndex(r => String(r.id) === String(originalRecord.id));
      if (index >= 0) dataState.records[index] = mapped;
      else dataState.records.push(mapped);
      const recordsRefreshed = await refreshBackendRecordsAfterWrite();
      await refreshBackendOverviewAfterWrite();
      resetForm();
      showMsg(recordsRefreshed
        ? "已保存修改（已同步服务端）"
        : "已保存修改（服务端已保存，明细刷新稍后重试）",
        recordsRefreshed ? "success" : "info");
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showMsg(error.message || "服务端拒绝了修改，请检查输入", "conflict");
      } else {
        saveEditedRecordLocally(fallbackRecord, originalFingerprint, "服务端不可用，已在本地保存修改");
      }
    } finally {
      setRecordSaveBusy(false);
    }
    return;
  }

  if (wasEdit) {
    const rec = dataState.records.find(r => String(r.id) === String(uiState.editingRecordId));
    applyRecordDraft(rec, localRecord);
  } else {
    dataState.records.push(localRecord);
  }

  save();
  if (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange() && typeof markLocalChangePending === "function") {
    markLocalChangePending(wasEdit ? "record_edit" : "record_write");
  }
  resetForm();
  showMsg(wasEdit ? "已保存修改" : "已记一笔", "local");
  render();
}

function startEdit(id) {
  const r = dataState.records.find(x => String(x.id) === String(id));
  if (!r) return;
  uiState.editingRecordId = id;
  uiState.selectedType = r.type;
  uiState.selectedCategory = r.category;
  uiState.selectedDepositDir = r.depositDir || null;
  document.getElementById("amount").value = r.amount;
  document.getElementById("note").value = r.note;
  document.getElementById("date").value = r.date;
  document.getElementById("accountSel").value = r.account || "";
  document.getElementById("toAccountSel").value = r.toAccount || "";
  document.getElementById("depositTarget").value = r.depositTarget || "";
  document.getElementById("depositLinkSel").value = r.depositLinkId || "";
  document.getElementById("depositFinal").checked = !!r.depositFinal;
  updateFormFields();
  document.getElementById("depositLinkSel").value = r.depositLinkId || "";
  document.getElementById("saveBtn").textContent = "保存修改";
  document.getElementById("cancelBtn").style.display = "block";
  renderTypeChips();
  renderCategoryChips();
  switchTab("record");
}

function cancelEdit() {
  resetForm();
}

async function deleteRec(id) {
  if (uiState.recordSaveInFlight) {
    showMsg("正在保存，请稍候", "busy");
    return;
  }
  if (uiState.recordDeleteInFlight) {
    showMsg("正在删除，请稍候", "busy");
    return;
  }
  const target = dataState.records.find(r => String(r.id) === String(id));
  if (!target || !confirm("确定删除这笔账吗？")) return;
  const fingerprint = recordFingerprint(target);

  if (backendRecordWritesEnabled() && typeof target.id === "string" && target.id) {
    uiState.recordDeleteInFlight = true;
    uiState.recordSaveStatus = "saving";
    try {
      await backendApi.deleteRecord(dataState.currentBookId, target.id);
      dataState.records = dataState.records.filter(r => String(r.id) !== String(id));
      const recordsRefreshed = await refreshBackendRecordsAfterWrite();
      await refreshBackendOverviewAfterWrite();
      showMsg(recordsRefreshed
        ? "已删除（已同步服务端）"
        : "已删除（服务端已删除，明细刷新稍后重试）",
        recordsRefreshed ? "success" : "info");
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showMsg(error.message || "服务端拒绝删除，请先处理关联记录", "conflict");
      } else {
        restoreLocalStateFromStorage();
        const localTarget = findLocalRecordByFingerprint(fingerprint);
        if (!localTarget) {
          showMsg("服务端不可用，本地未找到这笔账，未删除", "info");
          render();
        } else {
          dataState.records = dataState.records.filter(r => r !== localTarget);
          save();
          if (typeof markLocalChangePending === "function") markLocalChangePending("record_delete");
          showMsg("服务端不可用，已在本地删除", "local");
          render();
        }
      }
    } finally {
      uiState.recordDeleteInFlight = false;
    }
    return;
  }

  dataState.records = dataState.records.filter(r => String(r.id) !== String(id));
  save();
  if (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange() && typeof markLocalChangePending === "function") {
    markLocalChangePending("record_delete");
  }
  showMsg("已删除", "local");
  render();
}
