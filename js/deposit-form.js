// 押金表单交互模块：负责方向、原押金关联、最终结算提示和字段显隐。
// 押金的收入/支出计算由 records.js 提供，本模块只管理表单交互和关联选择。

// 根据当前类型，显示/隐藏对应字段
function updateFormFields() {
  document.getElementById("toAccountField").style.display =
    (uiState.selectedType === "转账") ? "block" : "none";
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
