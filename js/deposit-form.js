// 押金表单交互模块：负责方向、原押金关联、最终结算提示和字段显隐。
// 押金的收入/支出计算由 records.js 提供，本模块只管理表单交互和关联选择。

// 根据当前类型，显示/隐藏对应字段
function updateFormFields() {
  if (typeof updateTransferFields === "function") updateTransferFields();
  const isBalance = uiState.selectedType === "余额";
  const categoryField = document.querySelector("#panelRecord .record-category-field");
  if (categoryField) categoryField.style.display = (isBalance || uiState.selectedType === "借贷" || uiState.selectedType === "代付" || uiState.selectedType === "报销" || uiState.selectedType === "退款") ? "none" : "";
  const amountLabel = document.getElementById("recordAmountLabel");
  if (amountLabel) amountLabel.textContent = isBalance ? "账户实际余额" : "金额";
  const accountLabel = document.getElementById("recordAccountLabel");
  if (accountLabel) accountLabel.textContent = isBalance ? "调整账户" : "账户";
  const principalField = document.getElementById("balancePrincipalField");
  const principalInput = document.getElementById("balancePrincipal");
  const balanceHint = document.getElementById("balanceCurrentHint");
  if (principalField) principalField.style.display = isBalance ? "block" : "none";
  if (isBalance && principalInput) {
    const selectedAccountId = document.getElementById("accountSel")?.value || uiState.balanceTargetAccountId;
    const account = dataState.accounts.find(item => String(item.id) === String(selectedAccountId));
    const current = account ? computeBalances()[account.id] : null;
    if (balanceHint) balanceHint.textContent = account
      ? "当前余额：¥" + Number(current || 0).toFixed(2) + "。保存后会新增一条余额校准记录。"
      : "选择账户后显示当前余额。";
    if (uiState.balanceTargetAccountId && !principalInput.value && account) {
      principalInput.value = initialOf(account).toFixed(2);
    }
  } else if (balanceHint) {
    balanceHint.textContent = "";
  }
  if (typeof updateLoanFields === "function") updateLoanFields();
  if (typeof updatePayFields === "function") updatePayFields();
  if (typeof updateReimbursementFields === "function") updateReimbursementFields();
  if (typeof updateRefundFields === "function") updateRefundFields();
  const isDep = (uiState.selectedType === "押金");
  document.getElementById("depositDirField").style.display = isDep ? "block" : "none";
  document.getElementById("depositTargetField").style.display = isDep ? "block" : "none";
  const isReturn = isDep && (uiState.selectedDepositDir === "退回" || uiState.selectedDepositDir === "退");
  document.getElementById("depositLinkField").style.display = isReturn ? "block" : "none";
  document.getElementById("depositFinalField").style.display = isReturn ? "block" : "none";
  if (isDep) {
    renderDepositDirChips();
    renderDepositLinkOptions();
    updateDepositSettlementHint();
  }
}

// 押金方向按钮（4 个：主动收 / 别人退回 / 主动付给别人 / 我退给别人）
function renderDepositDirChips() {
  const box = document.getElementById("depositDirChips");
  box.innerHTML = "";
  DEPOSIT_DIRS.forEach(d => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    if (d.side === "income") b.classList.add("chip-income");
    else if (d.side === "expense") b.classList.add("chip-expense");
    if (uiState.selectedDepositDir === d.key) b.classList.add("selected");
    b.textContent = d.label;
    b.onclick = () => { uiState.selectedDepositDir = d.key; updateFormFields(); };
    box.appendChild(b);
  });
}

function depositCounterpartDir(dir) {
  if (dir === "退回") return "付";
  if (dir === "退") return "收";
  return null;
}

function linkedDepositOptions() {
  const counterpart = depositCounterpartDir(uiState.selectedDepositDir);
  if (!counterpart) return [];
  return dataState.records.filter(r => r.type === "押金" && r.depositDir === counterpart);
}

function renderDepositLinkOptions() {
  const sel = document.getElementById("depositLinkSel");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">请选择对应的原押金</option>';
  linkedDepositOptions().forEach(r => {
    const op = document.createElement("option");
    op.value = String(r.id);
    op.textContent = formatDate(r.date) + " · " + (r.depositTarget || "未填写对象") + " · ¥" + amountOf(r).toFixed(2);
    sel.appendChild(op);
  });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}

function updateDepositSettlementHint() {
  const hint = document.getElementById("depositSettlementHint");
  if (!hint) return;
  const linkId = document.getElementById("depositLinkSel").value;
  const original = dataState.records.find(r => String(r.id) === String(linkId));
  if (!original) {
    hint.textContent = "勾选最终结算后，系统会把未退回的差额计入收入或支出。";
    return;
  }
  const returnedBefore = dataState.records.reduce((sum, r) => {
    return (String(r.depositLinkId) === String(original.id) && String(r.id) !== String(uiState.editingRecordId)) ? sum + amountOf(r) : sum;
  }, 0);
  const current = toCents(document.getElementById("amount").value) / 100;
  const remaining = Math.max(0, amountOf(original) - returnedBefore - current);
  hint.textContent = "原押金 ¥" + amountOf(original).toFixed(2) + "，预计本次结算后差额 ¥" + remaining.toFixed(2);
}
