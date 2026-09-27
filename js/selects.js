// 下拉选项模块：把账户和类别数据转换成表单、筛选所需的 option。
// 本模块只负责 DOM 选项刷新，不参与账目计算和状态持久化。

const ACCOUNT_PICKER_CONFIG = {
  accountSel: { triggerId: "accountPickerBtn", menuId: "accountPickerMenu" },
  toAccountSel: { triggerId: "toAccountPickerBtn", menuId: "toAccountPickerMenu" }
};

function accountPickerConfig(selectId) {
  return ACCOUNT_PICKER_CONFIG[String(selectId)] || null;
}

function closeAccountPickers(exceptSelectId) {
  Object.entries(ACCOUNT_PICKER_CONFIG).forEach(([selectId, config]) => {
    if (selectId === exceptSelectId) return;
    const menu = document.getElementById(config.menuId);
    const trigger = document.getElementById(config.triggerId);
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function syncAccountPickerValue(selectId) {
  const select = document.getElementById(selectId);
  const config = accountPickerConfig(selectId);
  if (!select || !config) return;
  const trigger = document.getElementById(config.triggerId);
  if (!trigger) return;
  const selected = select.options[select.selectedIndex];
  trigger.textContent = selected ? selected.textContent : "请选择账户";
  trigger.classList.toggle("has-value", Boolean(select.value));
  renderAccountPickerOptions(selectId);
}

function renderAccountPickerOptions(selectId) {
  const select = document.getElementById(selectId);
  const config = accountPickerConfig(selectId);
  const menu = config ? document.getElementById(config.menuId) : null;
  if (!select || !menu) return;
  menu.innerHTML = "";

  const addOption = (option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-picker-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", option.value === select.value ? "true" : "false");
    if (option.value === select.value) button.classList.add("selected");
    button.textContent = option.textContent;
    button.addEventListener("click", () => {
      select.value = option.value;
      if (typeof Event === "function") select.dispatchEvent(new Event("change", { bubbles: true }));
      syncAccountPickerValue(selectId);
      closeAccountPickers();
    });
    menu.appendChild(button);
  };

  Array.from(select.children).forEach(child => {
    if (child.tagName === "OPTGROUP") {
      const label = document.createElement("div");
      label.className = "account-picker-group";
      label.textContent = child.label;
      menu.appendChild(label);
      Array.from(child.children).forEach(addOption);
    } else if (child.tagName === "OPTION") {
      addOption(child);
    }
  });
}

function ensureAccountPicker(selectId) {
  const config = accountPickerConfig(selectId);
  if (!config) return;
  const trigger = document.getElementById(config.triggerId);
  const menu = document.getElementById(config.menuId);
  if (!trigger || !menu || trigger.dataset.bound === "true") return;
  trigger.dataset.bound = "true";
  trigger.setAttribute("aria-controls", config.menuId);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = menu.hidden;
    closeAccountPickers(selectId);
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) {
      const rect = trigger.getBoundingClientRect();
      const roomBelow = window.innerHeight - rect.bottom;
      const roomAbove = rect.top;
      const preferredHeight = Math.min(280, window.innerHeight * 0.42);
      menu.classList.toggle("open-up", roomBelow < preferredHeight && roomAbove > roomBelow);
      renderAccountPickerOptions(selectId);
      const selected = menu.querySelector(".selected");
      if (selected && typeof selected.scrollIntoView === "function") selected.scrollIntoView({ block: "nearest" });
    }
  });
}

function syncAllAccountPickers() {
  Object.keys(ACCOUNT_PICKER_CONFIG).forEach(selectId => {
    ensureAccountPicker(selectId);
    syncAccountPickerValue(selectId);
  });
}

if (typeof document !== "undefined" && !document.body?.dataset.accountPickerBound) {
  document.addEventListener("click", () => closeAccountPickers());
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeAccountPickers();
  });
  if (document.body) document.body.dataset.accountPickerBound = "true";
}

// 给下拉框填账户（按资金/负债分组）
function fillAccountSelect(sel, placeholder) {
  const cur = sel.value;
  sel.innerHTML = '<option value="">' + placeholder + '</option>';
  ["资金", "负债"].forEach(kind => {
    const group = dataState.accounts.filter(a => a.kind === kind && !a.fundOnly);
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
  ensureAccountPicker(sel.id);
  syncAccountPickerValue(sel.id);
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
    const group = dataState.accounts.filter(a => a.kind === kind && !a.fundOnly);
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
  const fundAccounts = dataState.accounts.filter(a => a.fundOnly);
  if (fundAccounts.length) {
    const og = document.createElement("optgroup");
    og.label = "基金账户";
    fundAccounts.forEach(a => {
      const op = document.createElement("option");
      op.value = a.id;
      op.textContent = a.name;
      og.appendChild(op);
    });
    sel.appendChild(og);
  }
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}

// 明细筛选用的类别下拉（带“全部类别”）
function fillCategoryFilter() {
  const sel = document.getElementById("filterCategorySel");
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部类别</option>';
  const active = allCategories();
  const categories = [...new Set(active.concat(dataState.records.map(record => record.category).filter(Boolean)))];
  categories.forEach(c => {
    const op = document.createElement("option");
    op.value = c;
    op.textContent = active.includes(c) ? c : c + "（历史类别）";
    sel.appendChild(op);
  });
  if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}
