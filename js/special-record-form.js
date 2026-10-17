// 特殊记账表单：先实现“借贷”的动作、对象和原记录关联。
// 借贷本金不进入收入或支出；账户资金变化由 records.js 统一计算。

const LOAN_MODES = [
  { key: "借入", label: "借入" },
  { key: "借出", label: "借出" },
  { key: "收回", label: "收回" },
  { key: "偿还", label: "偿还" }
];

const PAY_MODES = [
  { key: "代付", label: "先替别人付" },
  { key: "收回", label: "收回代付" },
  { key: "转为支出", label: "无法收回，记支出" }
];

function renderTransferModeChips() {
  // 保留函数供旧页面调用；“转给他人”不再作为新建入口展示。
  const box = document.getElementById("transferModeChips");
  if (box) box.replaceChildren();
}

function updateTransferFields() {
  const isTransfer = uiState.selectedType === "转账";
  const modeField = document.getElementById("transferModeField");
  const partyField = document.getElementById("transferPartyField");
  const toAccountField = document.getElementById("toAccountField");
  const editingLegacyTransfer = isTransfer && uiState.editingRecordId !== null &&
    dataState.records.some(record => String(record.id) === String(uiState.editingRecordId) &&
      record.type === "转账" && record.transferMode === "转账他人");
  if (modeField) modeField.style.display = "none";
  if (partyField) partyField.style.display = editingLegacyTransfer ? "block" : "none";
  if (toAccountField) toAccountField.style.display = isTransfer && !editingLegacyTransfer ? "block" : "none";
  if (isTransfer && !editingLegacyTransfer) uiState.selectedTransferMode = "账户间转账";
}

function selectTransferMode(mode) {
  uiState.selectedTransferMode = mode === "转账他人" && uiState.editingRecordId !== null ? mode : "账户间转账";
  updateTransferFields();
}

function reimbursementOriginalOptions() {
  return (Array.isArray(dataState.records) ? dataState.records : [])
    .map((record, index) => ({ record, index }))
    .filter(item => (item.record.type === "支出" || (item.record.type === "代付" && item.record.payMode === "转为支出")) && expenseEffect(item.record) > 0)
    .filter(item => String(item.record.id) !== String(uiState.editingRecordId || ""))
    .map(item => ({ ...item, remaining: reimbursementOutstandingFor(item.record, dataState.records, uiState.editingRecordId) }))
    .filter(item => item.remaining > 0)
    .sort((a, b) => String(b.record.date || "").localeCompare(String(a.record.date || "")) || b.index - a.index);
}

function renderLinkedRecordPicker(select, button, menu, items, emptyText, presentation = {}) {
  if (!select || !button || !menu) return;
  const titleOf = presentation.titleOf || (record => record.category || "未分类");
  const amountLabel = presentation.amountLabel || "剩余";
  const current = select.value;
  select.innerHTML = `<option value="">${esc(emptyText)}</option>`;
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = String(item.record.id);
    const category = item.record.category ? " · " + item.record.category : "";
    const title = presentation.titleOf ? titleOf(item.record) : "原支出" + category;
    option.textContent = title + " · " + amountLabel + " ¥" + item.remaining.toFixed(2) + " · " + (item.record.date || "");
    select.appendChild(option);
  });
  if ([...select.options].some(option => option.value === current)) select.value = current;
  const selectedItem = items.find(item => String(item.record.id) === select.value);
  button.innerHTML = selectedItem
    ? `${esc(titleOf(selectedItem.record) + " · " + (selectedItem.record.date || ""))}<span aria-hidden="true">⌄</span>`
    : `${esc(emptyText)}<span aria-hidden="true">⌄</span>`;
  button.classList.toggle("has-value", Boolean(selectedItem));
  menu.innerHTML = items.length ? items.map(item => {
    const date = esc(item.record.date || "日期未记录");
    const title = esc(titleOf(item.record));
    const note = esc((item.record.note || "").trim());
    const selected = String(item.record.id) === select.value;
    return `<button class="compact-picker-option special-expense-option${selected ? " selected" : ""}" type="button" role="option" data-linked-record-id="${esc(item.record.id)}" aria-selected="${selected ? "true" : "false"}"><span class="special-expense-option-main"><span class="special-expense-option-title">${title}</span><span class="special-expense-option-meta">${date}${note ? " · " + note : ""}</span></span><span class="special-expense-option-amount">${esc(amountLabel)} ¥${item.remaining.toFixed(2)}</span></button>`;
  }).join("") : `<div class="compact-picker-empty">${esc(presentation.emptyMessage || "没有可关联的原支出")}</div>`;
  menu.querySelectorAll("[data-linked-record-id]").forEach(optionButton => {
    optionButton.onclick = () => {
      select.value = optionButton.dataset.linkedRecordId;
      renderLinkedRecordPicker(select, button, menu, items, emptyText, presentation);
      if (typeof closeCompactPickers === "function") closeCompactPickers();
    };
  });
}

function renderReimbursementLinkOptions() {
  const select = document.getElementById("reimbursementLinkSel");
  if (!select) return;
  renderLinkedRecordPicker(
    select,
    document.getElementById("reimbursementLinkPickerBtn"),
    document.getElementById("reimbursementLinkPickerMenu"),
    reimbursementOriginalOptions(),
    "请选择原支出"
  );
}

function updateReimbursementFields() {
  const isReimbursement = uiState.selectedType === "报销";
  const partyField = document.getElementById("reimbursementPartyField");
  const linkField = document.getElementById("reimbursementLinkField");
  if (partyField) partyField.style.display = isReimbursement ? "block" : "none";
  if (linkField) linkField.style.display = isReimbursement ? "block" : "none";
  if (isReimbursement) renderReimbursementLinkOptions();
}

function refundOriginalOptions() {
  return (Array.isArray(dataState.records) ? dataState.records : [])
    .map((record, index) => ({ record, index }))
    .filter(item => (item.record.type === "支出" || (item.record.type === "代付" && item.record.payMode === "转为支出")) && expenseEffect(item.record) > 0)
    .filter(item => String(item.record.id) !== String(uiState.editingRecordId || ""))
    .map(item => ({ ...item, remaining: refundOutstandingFor(item.record, dataState.records, uiState.editingRecordId) }))
    .filter(item => item.remaining > 0)
    .sort((a, b) => String(b.record.date || "").localeCompare(String(a.record.date || "")) || b.index - a.index);
}

function renderRefundLinkOptions() {
  const select = document.getElementById("refundLinkSel");
  if (!select) return;
  renderLinkedRecordPicker(
    select,
    document.getElementById("refundLinkPickerBtn"),
    document.getElementById("refundLinkPickerMenu"),
    refundOriginalOptions(),
    "请选择原支出"
  );
}

function updateRefundFields() {
  const isRefund = uiState.selectedType === "退款";
  const linkField = document.getElementById("refundLinkField");
  if (linkField) linkField.style.display = isRefund ? "block" : "none";
  if (isRefund) renderRefundLinkOptions();
}

function isLoanOriginalMode(mode) {
  return mode === "借入" || mode === "借出";
}

function loanSettlementMode(mode) {
  return mode === "借入" ? "偿还" : mode === "借出" ? "收回" : null;
}

function loanModeLabel(mode) {
  const item = LOAN_MODES.find(x => x.key === mode);
  return item ? item.label : (mode || "");
}

function loanOriginalOptions(mode) {
  const expected = mode === "偿还" ? "借入" : mode === "收回" ? "借出" : null;
  if (!expected) return [];
  return (Array.isArray(dataState.records) ? dataState.records : [])
    .filter(record => record.type === "借贷" && record.loanMode === expected)
    .filter(record => String(record.id) !== String(uiState.editingRecordId || ""))
    .map(record => ({ record, remaining: loanOutstandingFor(record) }))
    .filter(item => item.remaining > 0);
}

function renderLoanModeChips() {
  const box = document.getElementById("loanModeChips");
  if (!box) return;
  box.innerHTML = "";
  LOAN_MODES.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (uiState.selectedLoanMode === item.key ? " selected" : "");
    button.textContent = item.label;
    button.setAttribute("aria-pressed", uiState.selectedLoanMode === item.key ? "true" : "false");
    button.onclick = () => selectLoanMode(item.key);
    box.appendChild(button);
  });
}

function renderLoanLinkOptions() {
  const select = document.getElementById("loanLinkSel");
  if (!select) return;
  renderLinkedRecordPicker(
    select,
    document.getElementById("loanLinkPickerBtn"),
    document.getElementById("loanLinkPickerMenu"),
    loanOriginalOptions(uiState.selectedLoanMode),
    "请选择原借贷",
    {
      titleOf: record => loanModeLabel(record.loanMode) + " · " + (record.loanParty || "未填写对象"),
      amountLabel: "未结清",
      emptyMessage: "没有可关联的未结清借贷"
    }
  );
}

function updateLoanFields() {
  const isLoan = uiState.selectedType === "借贷";
  const modeField = document.getElementById("loanModeField");
  const partyField = document.getElementById("loanPartyField");
  const linkField = document.getElementById("loanLinkField");
  const accountLabel = document.getElementById("recordAccountLabel");
  if (modeField) modeField.style.display = isLoan ? "block" : "none";
  if (partyField) partyField.style.display = isLoan ? "block" : "none";
  const settlement = isLoan && !isLoanOriginalMode(uiState.selectedLoanMode);
  if (linkField) linkField.style.display = settlement ? "block" : "none";
  if (accountLabel && isLoan) {
    accountLabel.textContent = !uiState.selectedLoanMode
      ? "账户"
      : (uiState.selectedLoanMode === "借入" || uiState.selectedLoanMode === "收回")
        ? "收款账户" : "付款账户";
  }
  if (isLoan) {
    renderLoanModeChips();
    renderLoanLinkOptions();
  }
}

function selectLoanMode(mode) {
  uiState.selectedLoanMode = LOAN_MODES.some(item => item.key === mode) ? mode : null;
  const link = document.getElementById("loanLinkSel");
  if (link && isLoanOriginalMode(mode)) link.value = "";
  renderLoanModeChips();
  updateLoanFields();
}

function isPayOriginalMode(mode) {
  return mode === "代付";
}

function paySettlementModes() {
  return ["收回", "转为支出"];
}

function renderPayModeChips() {
  const box = document.getElementById("payModeChips");
  if (!box) return;
  box.innerHTML = "";
  PAY_MODES.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (uiState.selectedPayMode === item.key ? " selected" : "");
    button.textContent = item.label;
    button.setAttribute("aria-pressed", uiState.selectedPayMode === item.key ? "true" : "false");
    button.onclick = () => selectPayMode(item.key);
    box.appendChild(button);
  });
}

function payOriginalOptions() {
  const otherRecords = (Array.isArray(dataState.records) ? dataState.records : [])
    .filter(record => String(record.id) !== String(uiState.editingRecordId));
  return (Array.isArray(dataState.records) ? dataState.records : [])
    .filter(record => record.type === "代付" && record.payMode === "代付")
    .filter(record => String(record.id) !== String(uiState.editingRecordId || ""))
    .map(record => ({ record, remaining: payOutstandingFor(record, otherRecords) }))
    .filter(item => item.remaining > 0);
}

function renderPayLinkOptions() {
  const select = document.getElementById("payLinkSel");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">请选择原代付</option>';
  payOriginalOptions().forEach(item => {
    const option = document.createElement("option");
    option.value = String(item.record.id);
    const party = item.record.payParty ? " · " + item.record.payParty : "";
    option.textContent = "代付" + party + " · 未收回 ¥" + item.remaining.toFixed(2) + " · " + (item.record.date || "");
    select.appendChild(option);
  });
  if ([...select.options].some(option => option.value === current)) select.value = current;
  renderCompactFilterPicker("payLinkSel", "payLinkPickerBtn", "payLinkPickerMenu", "请选择原代付");
}

function updatePayFields() {
  const isPay = uiState.selectedType === "代付";
  const modeField = document.getElementById("payModeField");
  const partyField = document.getElementById("payPartyField");
  const linkField = document.getElementById("payLinkField");
  const accountField = document.querySelector("#panelRecord .record-supporting-fields > .record-account-field");
  const accountLabel = document.getElementById("recordAccountLabel");
  if (modeField) modeField.style.display = isPay ? "block" : "none";
  if (partyField) partyField.style.display = isPay && uiState.selectedPayMode === "代付" ? "block" : "none";
  const settlement = isPay && uiState.selectedPayMode !== "代付" && !!uiState.selectedPayMode;
  if (linkField) linkField.style.display = settlement ? "block" : "none";
  const writeoff = isPay && uiState.selectedPayMode === "转为支出";
  if (accountField) accountField.style.display = writeoff ? "none" : "block";
  if (accountLabel && isPay) {
    accountLabel.textContent = !uiState.selectedPayMode
      ? "账户"
      : uiState.selectedPayMode === "收回" ? "收款账户" : "付款账户";
  }
  if (isPay) {
    renderPayModeChips();
    renderPayLinkOptions();
  }
}

function selectPayMode(mode) {
  uiState.selectedPayMode = PAY_MODES.some(item => item.key === mode) ? mode : null;
  const link = document.getElementById("payLinkSel");
  if (link && isPayOriginalMode(mode)) link.value = "";
  renderPayModeChips();
  updatePayFields();
}
