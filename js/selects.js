// 下拉选项模块：把账户和类别数据转换成表单、筛选所需的 option。
// 本模块只负责 DOM 选项刷新，不参与账目计算和状态持久化。

// 给下拉框填账户（按资金/负债分组）
function fillAccountSelect(sel, placeholder) {
  const cur = sel.value;
  sel.innerHTML = '<option value="">' + placeholder + '</option>';
  ["资金", "负债"].forEach(kind => {
    const group = dataState.accounts.filter(a => a.kind === kind);
    if (group.length === 0) return;
    const og = document.createElement("optgroup");
    og.label = (kind === "资金") ? "资金账户" : "负债账户";
    group.forEach(a => {
      const op = document.createElement("option");
      op.value = a.id;
      op.textContent = a.name;
      og.appendChild(op);
    });
    sel.appendChild(og);
  });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}

function renderAccountSelects() {
  fillAccountSelect(document.getElementById("accountSel"), "请选择账户");
  fillAccountSelect(document.getElementById("toAccountSel"), "请选择转入账户");
  fillAccountFilter();
}

// 明细筛选用的账户下拉（带“全部账户”）
function fillAccountFilter() {
  const sel = document.getElementById("filterAccountSel");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部账户</option>';
  ["资金", "负债"].forEach(kind => {
    const group = dataState.accounts.filter(a => a.kind === kind);
    if (group.length === 0) return;
    const og = document.createElement("optgroup");
    og.label = (kind === "资金") ? "资金账户" : "负债账户";
    group.forEach(a => {
      const op = document.createElement("option");
      op.value = a.id;
      op.textContent = a.name;
      og.appendChild(op);
    });
    sel.appendChild(og);
  });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}

// 明细筛选用的类别下拉（带“全部类别”）
function fillCategoryFilter() {
  const sel = document.getElementById("filterCategorySel");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部类别</option>';
  allCategories().forEach(c => {
    const op = document.createElement("option");
    op.value = c;
    op.textContent = c;
    sel.appendChild(op);
  });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}
