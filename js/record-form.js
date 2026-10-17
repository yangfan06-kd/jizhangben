// 记账表单模块：负责新增、编辑、取消和删除记录。
// 金额和余额计算由 records.js 提供，存储由 storage.js 提供。

let msgTimer = null;
let recordErrorTarget = null;
let recordErrorField = null;

// 校验反馈只改变表单呈现，不改动草稿、账目或类别。
function clearRecordFieldError() {
  if (recordErrorField) {
    recordErrorField.removeEventListener("input", clearRecordFieldError);
    recordErrorField.removeEventListener("change", clearRecordFieldError);
    recordErrorField = null;
  }
  if (recordErrorTarget) {
    recordErrorTarget.removeAttribute("aria-invalid");
    const description = (recordErrorTarget.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(id => id && id !== "recordFieldError").join(" ");
    if (description) recordErrorTarget.setAttribute("aria-describedby", description);
    else recordErrorTarget.removeAttribute("aria-describedby");
  }
  const error = document.getElementById("recordFieldError");
  if (error && typeof error.remove === "function") error.remove();
  recordErrorTarget = null;
}

function showRecordFieldError(message, targetId) {
  clearRecordFieldError();
  const target = document.getElementById(targetId);
  const field = target && typeof target.closest === "function" ? target.closest(".field") : null;
  if (!field) { showMsg(message); return; }
  if (!["amount", "balancePrincipal"].includes(targetId) && typeof hideRecordKeyboard === "function") hideRecordKeyboard();
  const error = document.createElement("p");
  error.id = "recordFieldError";
  error.className = "record-field-error";
  error.setAttribute("role", "alert");
  error.textContent = message;
  field.appendChild(error);
  target.setAttribute("aria-invalid", "true");
  target.setAttribute("aria-describedby", [target.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
  recordErrorTarget = target;
  recordErrorField = field;
  field.addEventListener("input", clearRecordFieldError);
  field.addEventListener("change", clearRecordFieldError);
  uiState.recordSaveStatus = "error";
  const messageBox = document.getElementById("formMsg");
  if (messageBox) { messageBox.textContent = ""; messageBox.className = "form-msg"; }
  // 选择器只定位，不代替用户展开；键盘也不会清除现有金额及计算式。
  const focusTarget = target.matches("button,input") ? target : target.querySelector("button");
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center", behavior: "auto" });
  if (typeof syncRecordKeyboardLayout === "function") syncRecordKeyboardLayout();
}

function defaultRecordCategory(type = uiState.selectedType || "支出") {
  const side = typeof typeSide === "function" ? typeSide(type) : "expense";
  if (side !== "income" && side !== "expense") return null;
  const groups = dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
  const group = groups.find(item => item.side === side && item.items && item.items.length);
  return group ? group.items[0] : null;
}

function defaultRecordAccountId() {
  const accounts = Array.isArray(dataState.accounts) ? dataState.accounts : [];
  const preferred = accounts.find(account => account.name === "微信");
  return preferred ? preferred.id : (accounts[0] ? accounts[0].id : "");
}

// 类型切换时只给“支出”提供常用默认值；其它类型要求用户自行选择。
// 编辑旧账目不套用新建表单默认值，避免改类型时覆盖原有选择。
function selectRecordType(type) {
  const nextType = String(type || "");
  const previousType = uiState.selectedType;
  uiState.selectedType = nextType;
  if (uiState.editingRecordId !== null) return;
  if (nextType === "借贷") uiState.selectedCategory = null;
  if (previousType === "借贷" && nextType !== "借贷") uiState.selectedLoanMode = null;
  if (nextType === "代付") uiState.selectedCategory = null;
  if (previousType === "代付" && nextType !== "代付") uiState.selectedPayMode = null;
  if (nextType === "报销") uiState.selectedCategory = null;
  if (nextType === "退款") uiState.selectedCategory = null;
  if (nextType === "转账") {
    uiState.selectedCategory = null;
    uiState.selectedTransferMode = uiState.selectedTransferMode || "账户间转账";
  }
  if (previousType === "转账" && nextType !== "转账") uiState.selectedTransferMode = null;
  const nextSide = typeSide(nextType);
  if (nextSide === "income" || nextSide === "expense") {
    const selectedGroup = categoryGroupForName(uiState.selectedCategory);
    if (previousType !== nextType || !selectedGroup || selectedGroup.side !== nextSide) {
      uiState.selectedCategory = defaultRecordCategory(nextType);
    }
  } else if (typeSide(previousType) !== "neutral" && previousType !== nextType) {
    uiState.selectedCategory = null;
  }
  const accountSel = typeof document !== "undefined" ? document.getElementById("accountSel") : null;
  if (nextType === "支出") {
    if (accountSel && (previousType !== "支出" || !accountSel.value)) {
      accountSel.value = defaultRecordAccountId();
      if (typeof syncAccountPickerValue === "function") syncAccountPickerValue("accountSel");
    }
    return;
  }
  if (previousType === "支出") {
    uiState.selectedCategory = null;
    if (accountSel) {
      accountSel.value = "";
      if (typeof syncAccountPickerValue === "function") syncAccountPickerValue("accountSel");
    }
  }
}

// 顶部类型栏与键盘快捷类型共用入口：先更新表单，再展开金额键盘。
function chooseRecordType(type) {
  clearRecordFieldError();
  selectRecordType(type);
  renderTypeChips();
  renderCategoryChips();
  updateFormFields();
  if (typeof showRecordKeyboard === "function") {
    showRecordKeyboard();
    const input = document.getElementById("amount");
    if (input) input.focus({ preventScroll: true });
  }
}

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
  clearRecordFieldError();
  // 新建账目默认从“支出”开始，减少一次点击；编辑时仍由 startEdit 覆盖。
  if (typeof closeCategoryPicker === "function") closeCategoryPicker();
  if (typeof resetRecordKeyboard === "function") resetRecordKeyboard();
  uiState.selectedType = "支出";
  uiState.selectedCategory = defaultRecordCategory("支出");
  uiState.selectedDepositDir = null;
  uiState.selectedLoanMode = null;
  uiState.selectedPayMode = null;
  uiState.selectedTransferMode = null;
  uiState.balanceTargetAccountId = null;
  uiState.balanceTargetRecordId = null;
  uiState.editingRecordId = null;
  uiState.recordSaveStatus = "idle";
  document.getElementById("amount").value = "";
  document.getElementById("note").value = "";
  document.getElementById("date").value = todayStr();
  document.getElementById("accountSel").value = defaultRecordAccountId();
  document.getElementById("toAccountSel").value = "";
  const balancePrincipal = document.getElementById("balancePrincipal");
  if (balancePrincipal) balancePrincipal.value = "";
  const balanceAccountName = document.getElementById("balanceAccountName");
  if (balanceAccountName) balanceAccountName.value = "";
  const transferParty = document.getElementById("transferParty");
  if (transferParty) transferParty.value = "";
  if (typeof syncAccountPickerValue === "function") {
    syncAccountPickerValue("accountSel");
    syncAccountPickerValue("toAccountSel");
  }
  document.getElementById("depositTarget").value = "";
  document.getElementById("depositLinkSel").value = "";
  document.getElementById("depositFinal").checked = false;
  const loanPartyInput = document.getElementById("loanParty");
  const loanLinkSelect = document.getElementById("loanLinkSel");
  if (loanPartyInput) loanPartyInput.value = "";
  if (loanLinkSelect) loanLinkSelect.value = "";
  const payPartyInput = document.getElementById("payParty");
  const payLinkSelect = document.getElementById("payLinkSel");
  if (payPartyInput) payPartyInput.value = "";
  if (payLinkSelect) payLinkSelect.value = "";
  const reimbursementPartyInput = document.getElementById("reimbursementParty");
  const reimbursementLinkSelect = document.getElementById("reimbursementLinkSel");
  if (reimbursementPartyInput) reimbursementPartyInput.value = "";
  if (reimbursementLinkSelect) reimbursementLinkSelect.value = "";
  const refundLinkSelect = document.getElementById("refundLinkSel");
  if (refundLinkSelect) refundLinkSelect.value = "";
  document.getElementById("saveBtn").textContent = "保存这笔账";
  document.getElementById("cancelBtn").style.display = "none";
  document.getElementById("formMsg").textContent = "";
  document.getElementById("formMsg").className = "form-msg";
  document.getElementById("typeCustomBox").innerHTML = "";
  document.getElementById("categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  if (typeof renderLoanModeChips === "function") renderLoanModeChips();
  if (typeof renderPayModeChips === "function") renderPayModeChips();
  if (typeof renderTransferModeChips === "function") renderTransferModeChips();
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
  continueRecordingAfterSave();
}

function continueRecordingAfterSave() {
  if (typeof clearRecordDraft === "function") clearRecordDraft();
  if (uiState.activeTab === "record" && typeof showRecordKeyboard === "function") showRecordKeyboard();
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
    to_account_id: record.type === "转账" && record.transferMode !== "转账他人" ? (record.toAccount || null) : null,
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
    depositTarget: record.depositTarget || null,
    loanMode: record.loanMode || null,
    loanParty: record.loanParty || null,
    loanLinkId: record.loanLinkId || null,
    payMode: record.payMode || null,
    payParty: record.payParty || null,
    payLinkId: record.payLinkId || null,
    transferMode: record.transferMode || null,
    transferParty: record.transferParty || null,
    reimbursementParty: record.reimbursementParty || null,
    reimbursementLinkId: record.reimbursementLinkId || null,
    refundLinkId: record.refundLinkId || null
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
    (record.transferMode || null) === fingerprint.transferMode &&
    (record.transferParty || null) === fingerprint.transferParty &&
    (record.depositDir || null) === fingerprint.depositDir &&
    (record.depositTarget || null) === fingerprint.depositTarget &&
    (record.loanMode || null) === fingerprint.loanMode &&
    (record.loanParty || null) === fingerprint.loanParty &&
    (record.loanLinkId || null) === fingerprint.loanLinkId &&
    (record.payMode || null) === fingerprint.payMode &&
    (record.payParty || null) === fingerprint.payParty &&
    (record.payLinkId || null) === fingerprint.payLinkId &&
    (record.reimbursementParty || null) === fingerprint.reimbursementParty &&
    (record.reimbursementLinkId || null) === fingerprint.reimbursementLinkId &&
    (record.refundLinkId || null) === fingerprint.refundLinkId;
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
  target.transferMode = draft.transferMode;
  target.transferParty = draft.transferParty;
  target.depositDir = draft.depositDir;
  target.depositTarget = draft.depositTarget;
  target.depositLinkId = draft.depositLinkId;
  target.depositFinal = draft.depositFinal;
  target.loanMode = draft.loanMode;
  target.loanParty = draft.loanParty;
  target.loanLinkId = draft.loanLinkId;
  target.payMode = draft.payMode;
  target.payParty = draft.payParty;
  target.payLinkId = draft.payLinkId;
  target.reimbursementParty = draft.reimbursementParty;
  target.reimbursementLinkId = draft.reimbursementLinkId;
  target.refundLinkId = draft.refundLinkId;
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
  continueRecordingAfterSave();
  return true;
}

function setRecordSaveBusy(busy) {
  uiState.recordSaveInFlight = !!busy;
  if (busy) uiState.recordSaveStatus = "saving";
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  if (saveBtn) {
    if (typeof saveBtn.setAttribute === "function") {
      saveBtn.setAttribute("aria-busy", busy ? "true" : "false");
    }
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
  clearRecordFieldError();
  const amount = typeof recordAmountValue === "function"
    ? recordAmountValue()
    : parseFloat(document.getElementById("amount").value);
  const amountCents = toCents(amount);
  const note = document.getElementById("note").value.trim();
  const date = document.getElementById("date").value;
  const payMode = (uiState.selectedType === "代付") ? uiState.selectedPayMode : null;
  const account = (uiState.selectedType === "代付" && payMode === "转为支出")
    ? null : (document.getElementById("accountSel").value || null);
  const editingTransfer = uiState.selectedType === "转账" && uiState.editingRecordId !== null
    ? dataState.records.find(record => String(record.id) === String(uiState.editingRecordId) && record.type === "转账")
    : null;
  const transferMode = (uiState.selectedType === "转账")
    ? (editingTransfer && editingTransfer.transferMode === "转账他人" ? "转账他人" : "账户间转账") : null;
  const transferParty = (uiState.selectedType === "转账" && transferMode === "转账他人")
    ? document.getElementById("transferParty").value.trim() : null;
  const toAccount = (uiState.selectedType === "转账" && transferMode !== "转账他人")
    ? (document.getElementById("toAccountSel").value || null) : null;
  const balancePrincipalInput = document.getElementById("balancePrincipal");
  const balancePrincipal = uiState.selectedType === "余额" && balancePrincipalInput && balancePrincipalInput.value !== ""
    ? parseFloat(balancePrincipalInput.value) : null;
  const balanceAccountName = uiState.selectedType === "余额" && uiState.balanceTargetAccountId
    ? (document.getElementById("balanceAccountName")?.value || "").trim() : "";
  const depositDir = (uiState.selectedType === "押金") ? uiState.selectedDepositDir : null;
  const depositTarget = document.getElementById("depositTarget").value.trim();
  const depositLinkId = (uiState.selectedType === "押金") ? (document.getElementById("depositLinkSel").value || null) : null;
  const depositFinal = (uiState.selectedType === "押金") ? document.getElementById("depositFinal").checked : false;
  const loanMode = (uiState.selectedType === "借贷") ? uiState.selectedLoanMode : null;
  const loanParty = (uiState.selectedType === "借贷") ? document.getElementById("loanParty").value.trim() : null;
  const loanLinkId = (uiState.selectedType === "借贷") ? (document.getElementById("loanLinkSel").value || null) : null;
  let payParty = (uiState.selectedType === "代付" && payMode === "代付") ? document.getElementById("payParty").value.trim() : null;
  const payLinkId = (uiState.selectedType === "代付") ? (document.getElementById("payLinkSel").value || null) : null;
  const reimbursementParty = (uiState.selectedType === "报销") ? document.getElementById("reimbursementParty").value.trim() : null;
  const reimbursementLinkId = (uiState.selectedType === "报销") ? (document.getElementById("reimbursementLinkSel").value || null) : null;
  const refundLinkId = (uiState.selectedType === "退款") ? (document.getElementById("refundLinkSel").value || null) : null;

  if (!uiState.selectedType) { showRecordFieldError("请先选择一个类型", "typeChips"); return; }
  if (!["余额", "转账", "借贷", "代付", "报销", "退款"].includes(uiState.selectedType) && !uiState.selectedCategory) { showRecordFieldError("请先选择一个类别", "categoryChips"); return; }
  const incomeAmount = typeSide(uiState.selectedType) === "income";
  const amountInvalid = !Number.isFinite(amount) || (uiState.selectedType === "余额" ? amountCents < 0 : incomeAmount ? amountCents === 0 : amountCents <= 0);
  if (amountInvalid) {
    showRecordFieldError(uiState.selectedType === "余额" ? "请输入不小于 0 的账户余额" : incomeAmount ? "请输入非零收入金额" : "请输入大于 0 的金额", "amount");
    return;
  }
  if (incomeAmount && amountCents < 0 && backendRecordWritesEnabled()) {
    showMsg("联网账本暂不支持负收入，请使用个人离线版记录", "conflict");
    return;
  }
  if (!date) { showRecordFieldError("请选择日期", "date"); return; }
  if (needsAccount(uiState.selectedType) && !account) { showRecordFieldError("请选择账户", "accountPickerBtn"); return; }
  if (uiState.selectedType === "转账") {
    if (transferMode === "转账他人") {
      if (!transferParty) { showRecordFieldError("请填写转账对象", "transferParty"); return; }
    } else {
      if (!toAccount) { showRecordFieldError("转账需要选择转入账户", "toAccountPickerBtn"); return; }
      if (account === toAccount) { showRecordFieldError("转出和转入账户不能相同", "toAccountPickerBtn"); return; }
    }
  }
  if (uiState.selectedType === "余额" && balancePrincipal !== null &&
      (!Number.isFinite(balancePrincipal) || toCents(balancePrincipal) < 0)) {
    showRecordFieldError("请输入不小于 0 的账户本金", "balancePrincipal"); return;
  }
  if (uiState.selectedType === "余额" && uiState.balanceTargetAccountId) {
    const target = dataState.accounts.find(item => String(item.id) === String(uiState.balanceTargetAccountId));
    if (!target || !balanceAccountName) { showRecordFieldError("请填写账户名称", "balanceAccountName"); return; }
    if (dataState.accounts.some(item => String(item.id) !== String(target.id) && item.name.trim() === balanceAccountName)) {
      showRecordFieldError("这个账户名称已经使用，请换一个名称", "balanceAccountName"); return;
    }
  }
  if (uiState.selectedType === "押金") {
    if (!depositDir) { showRecordFieldError("请选择押金方向（主动收/别人退回/主动付/我退）", "depositDirChips"); return; }
    if (!depositTarget) { showRecordFieldError("请填写押金对象（谁对谁押）", "depositTarget"); return; }
    if (depositCounterpartDir(depositDir) && !depositLinkId) { showRecordFieldError("请选择要对应的原押金", "depositLinkPickerBtn"); return; }
  }
  if (uiState.selectedType === "借贷") {
    if (!loanMode) { showRecordFieldError("请选择借贷动作", "loanModeChips"); return; }
    if (!loanParty) { showRecordFieldError("请填写借贷对象", "loanParty"); return; }
    if (!isLoanOriginalMode(loanMode) && !loanLinkId) { showRecordFieldError("请关联原借贷", "loanLinkPickerBtn"); return; }
    if (!isLoanOriginalMode(loanMode) && loanLinkId) {
      const original = dataState.records.find(record => String(record.id) === String(loanLinkId));
      if (!original || loanOutstandingFor(original) < amount) { showRecordFieldError("本次金额不能超过未结清金额", "amount"); return; }
    }
  }
  if (uiState.selectedType === "代付") {
    if (!payMode) { showRecordFieldError("请选择代付动作", "payModeChips"); return; }
    if (payMode === "代付" && !payParty) { showRecordFieldError("请填写代付对象", "payParty"); return; }
    if (payMode !== "代付" && !payLinkId) { showRecordFieldError("请关联原代付", "payLinkPickerBtn"); return; }
    if (payMode !== "代付" && payLinkId) {
      const original = dataState.records.find(record => String(record.id) === String(payLinkId));
      const otherRecords = dataState.records.filter(record => String(record.id) !== String(uiState.editingRecordId));
      if (!original || original.type !== "代付" || original.payMode !== "代付" ||
          payOutstandingFor(original, otherRecords) < amount) { showRecordFieldError("本次金额不能超过待收回金额", "amount"); return; }
      payParty = original.payParty || null;
    }
  }
  if (uiState.selectedType === "报销") {
    if (!reimbursementParty) { showRecordFieldError("请填写报销来源", "reimbursementParty"); return; }
    if (!reimbursementLinkId) { showRecordFieldError("请关联原支出", "reimbursementLinkPickerBtn"); return; }
    const original = dataState.records.find(record => String(record.id) === String(reimbursementLinkId));
    if (!original || reimbursementOutstandingFor(original, dataState.records, uiState.editingRecordId) <= 0) { showRecordFieldError("原支出已经没有可报销金额", "reimbursementLinkPickerBtn"); return; }
  }
  if (uiState.selectedType === "退款") {
    if (!refundLinkId) { showRecordFieldError("请关联原支出", "refundLinkPickerBtn"); return; }
    const original = dataState.records.find(record => String(record.id) === String(refundLinkId));
    if (!original || refundOutstandingFor(original, dataState.records, uiState.editingRecordId) <= 0) { showRecordFieldError("原支出已经没有可退款金额", "refundLinkPickerBtn"); return; }
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
    // 余额不向用户要求类别；内部用“其他”兼容旧备份和当前存储结构。
    category: selectedCategory || "其他",
    note: note,
    date: date,
    account: account,
    toAccount: (selectedType === "转账") ? toAccount : null,
    transferMode: transferMode,
    transferParty: transferParty,
    depositDir: depositDir,
    depositTarget: (selectedType === "押金") ? depositTarget : null,
    depositLinkId: depositLinkId,
    depositFinal: depositFinal,
    loanMode: loanMode,
    loanParty: loanParty,
    loanLinkId: loanLinkId,
    payMode: payMode,
    payParty: payParty,
    payLinkId: payLinkId,
    reimbursementParty: reimbursementParty,
    reimbursementLinkId: reimbursementLinkId,
    refundLinkId: refundLinkId,
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

  const localOnlyTransfer = selectedType === "转账" && transferMode === "转账他人";

  // 余额校准先在本机完成；服务端当前的中性类型契约不允许账户字段，联网同步留到余额模型升级批次。
  if (!wasEdit && backendRecordWritesEnabled() && !localOnlyTransfer && !["余额", "借贷", "代付", "报销", "退款"].includes(selectedType)) {
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
      continueRecordingAfterSave();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showMsg(userFacingError(error, "服务端拒绝了这笔账，请检查输入"), "conflict");
      } else {
        saveRecordLocally(fallbackRecord, "服务端不可用，已保存到本地", true, "local");
      }
    } finally {
      setRecordSaveBusy(false);
    }
    return;
  }

  if (wasEdit && backendRecordWritesEnabled() && !localOnlyTransfer && !["余额", "借贷", "代付", "报销", "退款"].includes(selectedType)) {
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
      continueRecordingAfterSave();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showMsg(userFacingError(error, "服务端拒绝了修改，请检查输入"), "conflict");
      } else {
        saveEditedRecordLocally(fallbackRecord, originalFingerprint, "服务端不可用，已在本地保存修改");
      }
    } finally {
      setRecordSaveBusy(false);
    }
    return;
  }

  const priorRecords = JSON.stringify(dataState.records);
  const priorAccounts = JSON.stringify(dataState.accounts);
  const priorRecordsStorage = appStorage.get(recordsKey(dataState.currentBookId));
  const priorAccountsStorage = appStorage.get(accountsKey(dataState.currentBookId));
  if (wasEdit) {
    const rec = dataState.records.find(r => String(r.id) === String(uiState.editingRecordId));
    applyRecordDraft(rec, localRecord);
  } else {
    dataState.records.push(localRecord);
  }

  try {
    if (selectedType === "余额" && uiState.balanceTargetAccountId) {
      const target = dataState.accounts.find(item => String(item.id) === String(uiState.balanceTargetAccountId));
      if (target) {
        target.name = balanceAccountName;
        if (balancePrincipal !== null) {
          target.initialCents = toCents(balancePrincipal);
          target.initial = target.initialCents / 100;
        }
      }
      saveAccounts();
    }
    save();
  } catch (error) {
    dataState.records = JSON.parse(priorRecords);
    dataState.accounts = JSON.parse(priorAccounts);
    try {
      if (priorRecordsStorage === null) appStorage.remove(recordsKey(dataState.currentBookId));
      else appStorage.set(recordsKey(dataState.currentBookId), priorRecordsStorage);
      if (priorAccountsStorage === null) appStorage.remove(accountsKey(dataState.currentBookId));
      else appStorage.set(accountsKey(dataState.currentBookId), priorAccountsStorage);
    } catch (_) { /* 尽力回滚本地存储 */ }
    showMsg("保存失败，记录和账户设置已恢复；请检查手机存储空间", "conflict");
    return;
  }
  const localOnlySpecial = localOnlyTransfer || ["余额", "借贷", "代付", "报销", "退款"].includes(selectedType);
  if (typeof markLocalChangePending === "function" &&
      (localOnlySpecial || (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange()))) {
    markLocalChangePending(wasEdit ? "record_edit" : "record_write");
  }
  resetForm();
  const localMessage = ["余额", "借贷", "代付", "报销", "退款"].includes(selectedType) && backendRecordWritesEnabled()
    ? (selectedType === "余额" ? "余额已保存在本机，联网同步将在后续版本支持"
      : selectedType === "借贷" ? "借贷已保存在本机，联网关联将在后续版本支持"
        : selectedType === "代付" ? "代付已保存在本机，联网关联将在后续版本支持"
          : selectedType === "报销" ? "报销已保存在本机，联网关联将在后续版本支持"
            : "退款已保存在本机，联网关联将在后续版本支持")
    : (wasEdit ? "已保存修改" : "已记一笔");
  showMsg(localMessage, "local");
  render();
  continueRecordingAfterSave();
}

function startEdit(id) {
  const r = dataState.records.find(x => String(x.id) === String(id));
  if (!r) return;
  if (r.fundProjectId) {
    switchTab("investment");
    openFundDetail(r.fundProjectId);
    return;
  }
  uiState.editingRecordId = id;
  uiState.selectedType = r.type;
  uiState.selectedCategory = r.category;
  uiState.selectedDepositDir = r.depositDir || null;
  uiState.selectedLoanMode = r.loanMode || null;
  uiState.selectedPayMode = r.payMode || null;
  uiState.selectedTransferMode = r.transferMode || (r.type === "转账" ? "账户间转账" : null);
  document.getElementById("amount").value = r.amount;
  document.getElementById("note").value = r.note;
  document.getElementById("date").value = r.date;
  document.getElementById("accountSel").value = r.account || "";
  document.getElementById("toAccountSel").value = r.toAccount || "";
  const transferParty = document.getElementById("transferParty");
  if (transferParty) transferParty.value = r.transferParty || "";
  const balancePrincipal = document.getElementById("balancePrincipal");
  if (balancePrincipal) {
    const account = dataState.accounts.find(item => String(item.id) === String(r.account));
    balancePrincipal.value = account ? initialOf(account).toFixed(2) : "";
  }
  if (typeof syncAccountPickerValue === "function") {
    syncAccountPickerValue("accountSel");
    syncAccountPickerValue("toAccountSel");
  }
  document.getElementById("depositTarget").value = r.depositTarget || "";
  document.getElementById("depositLinkSel").value = r.depositLinkId || "";
  document.getElementById("depositFinal").checked = !!r.depositFinal;
  const loanPartyInput = document.getElementById("loanParty");
  const loanLinkSelect = document.getElementById("loanLinkSel");
  if (loanPartyInput) loanPartyInput.value = r.loanParty || "";
  if (loanLinkSelect) loanLinkSelect.value = r.loanLinkId || "";
  const payPartyInput = document.getElementById("payParty");
  const payLinkSelect = document.getElementById("payLinkSel");
  if (payPartyInput) payPartyInput.value = r.payParty || "";
  if (payLinkSelect) payLinkSelect.value = r.payLinkId || "";
  const reimbursementPartyInput = document.getElementById("reimbursementParty");
  const reimbursementLinkSelect = document.getElementById("reimbursementLinkSel");
  if (reimbursementPartyInput) reimbursementPartyInput.value = r.reimbursementParty || "";
  if (reimbursementLinkSelect) reimbursementLinkSelect.value = r.reimbursementLinkId || "";
  const refundLinkSelect = document.getElementById("refundLinkSel");
  if (refundLinkSelect) refundLinkSelect.value = r.refundLinkId || "";
  updateFormFields();
  document.getElementById("depositLinkSel").value = r.depositLinkId || "";
  document.getElementById("saveBtn").textContent = "保存修改";
  document.getElementById("cancelBtn").style.display = "block";
  renderTypeChips();
  renderCategoryChips();
  if (typeof renderLoanModeChips === "function") renderLoanModeChips();
  if (typeof renderPayModeChips === "function") renderPayModeChips();
  if (typeof renderTransferModeChips === "function") renderTransferModeChips();
  switchTab("record");
}

function cancelEdit() {
  if (typeof clearRecordDraft === "function") clearRecordDraft();
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
  if (target && target.fundProjectId) {
    switchTab("investment");
    openFundDetail(target.fundProjectId);
    return;
  }
  if (!target || !await appConfirm("确定删除这笔账吗？")) return;
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
        showMsg(userFacingError(error, "服务端拒绝删除，请先处理关联记录"), "conflict");
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
