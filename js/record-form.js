// 记账表单模块：负责新增、编辑、取消和删除记录。
// 金额和余额计算由 records.js 提供，存储由 storage.js 提供。

let msgTimer = null;

function showMsg(text) {
  const m = document.getElementById("formMsg");
  m.textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { m.textContent = ""; }, 3000);
}

function resetForm() {
  uiState.selectedType = null;
  uiState.selectedCategory = null;
  uiState.selectedDepositDir = null;
  uiState.editingRecordId = null;
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

function saveRecordLocally(record, message, restore) {
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
  resetForm();
  showMsg(message);
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

async function handleSave() {
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
      saveRecordLocally(fallbackRecord, "服务端选项尚未同步，已保存到本地", true);
      return;
    }
    const payload = {
      type_id: typeId,
      category_id: categoryId,
      account_id: needsAccount(selectedType) ? account : null,
      to_account_id: selectedType === "转账" ? toAccount : null,
      amount_cents: amountCents,
      occurred_on: date,
      note: note,
      deposit_direction: depositDir ? backendDepositDirection(depositDir) : null,
      deposit_target: uiState.selectedType === "押金" ? depositTarget : null,
      deposit_link_id: depositLinkId,
      deposit_final: depositFinal
    };
    try {
      const saved = await backendApi.createRecord(dataState.currentBookId, payload);
      if (!saved || !saved.id) throw new Error("record_response_invalid");
      const mapped = mapBackendRecord(Object.assign({}, saved, {
        type_name: selectedType,
        category_name: selectedCategory
      }));
      dataState.records.push(mapped);
      await refreshBackendOverviewAfterWrite();
      resetForm();
      showMsg("已记一笔（已同步服务端）");
      render();
    } catch (error) {
      saveRecordLocally(fallbackRecord, "服务端不可用，已保存到本地", true);
    }
    return;
  }

  if (wasEdit) {
    const rec = dataState.records.find(r => String(r.id) === String(uiState.editingRecordId));
    rec.type = uiState.selectedType;
    rec.amount = amountCents / 100;
    rec.amountCents = amountCents;
    rec.category = uiState.selectedCategory;
    rec.note = note;
    rec.date = date;
    rec.account = account;
    rec.toAccount = (uiState.selectedType === "转账") ? toAccount : null;
    rec.depositDir = depositDir;
    rec.depositTarget = (uiState.selectedType === "押金") ? depositTarget : null;
    rec.depositLinkId = depositLinkId;
    rec.depositFinal = depositFinal;
  } else {
    dataState.records.push(localRecord);
  }

  save();
  resetForm();
  showMsg(wasEdit ? "已保存修改" : "已记一笔");
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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelEdit() {
  resetForm();
}

function deleteRec(id) {
  if (!confirm("确定删除这笔账吗？")) return;
  dataState.records = dataState.records.filter(r => String(r.id) !== String(id));
  save();
  render();
}
