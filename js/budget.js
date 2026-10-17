// 预算模块：按账本和月份保存预算额度，实际支出复用 records.js 的收支口径。
// 预算只影响预算页展示，不改写账目、账户余额或首页的收支统计。

const budgetUiState = {
  month: todayStr().slice(0, 7)
};

function emptyBudgetPeriod() {
  return { totalCents: null, categories: {} };
}

function normalizeBudgetPeriod(value) {
  const source = value && typeof value === "object" ? value : {};
  let totalCents = null;
  if (source.totalCents !== null && source.totalCents !== undefined && Number.isFinite(Number(source.totalCents))) {
    totalCents = Math.max(0, Math.round(Number(source.totalCents)));
  } else if (source.total !== null && source.total !== undefined && Number.isFinite(Number(source.total))) {
    totalCents = Math.max(0, toCents(source.total));
  }
  const categories = {};
  const rawCategories = source.categories && typeof source.categories === "object" ? source.categories : {};
  Object.entries(rawCategories).forEach(([name, raw]) => {
    const cents = raw && typeof raw === "object" && raw.amountCents !== undefined
      ? Number(raw.amountCents)
      : Number(raw);
    if (name.trim() && Number.isFinite(cents) && cents > 0) categories[name] = Math.round(cents);
  });
  return { totalCents, categories };
}

function normalizeBudgetData(value) {
  const source = value && typeof value === "object" ? value : {};
  const periods = {};
  const rawPeriods = source.periods && typeof source.periods === "object" ? source.periods : {};
  Object.entries(rawPeriods).forEach(([month, period]) => {
    if (/^\d{4}-\d{2}$/.test(month)) periods[month] = normalizeBudgetPeriod(period);
  });
  return { version: 1, periods };
}

function loadBudgetData() {
  let parsed = null;
  try {
    const raw = dataState.currentBookId == null ? null : appStorage.get(budgetKey(dataState.currentBookId));
    parsed = raw ? JSON.parse(raw) : null;
  } catch (error) {
    parsed = null;
  }
  dataState.budgetData = normalizeBudgetData(parsed);
  budgetUiState.month = budgetUiState.month || todayStr().slice(0, 7);
}

function saveBudgetData(reason = "budget_write") {
  if (dataState.currentBookId == null) return false;
  dataState.budgetData = normalizeBudgetData(dataState.budgetData);
  appStorage.set(budgetKey(dataState.currentBookId), JSON.stringify(dataState.budgetData));
  if (typeof markLocalChangePending === "function") markLocalChangePending(reason);
  return true;
}

function budgetPeriod(month = budgetUiState.month) {
  if (!dataState.budgetData) loadBudgetData();
  const key = /^\d{4}-\d{2}$/.test(month) ? month : todayStr().slice(0, 7);
  if (!dataState.budgetData.periods[key]) dataState.budgetData.periods[key] = emptyBudgetPeriod();
  return dataState.budgetData.periods[key];
}

function budgetMonthLabel(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  return match ? match[1] + "年" + Number(match[2]) + "月" : "本月";
}

function shiftBudgetMonth(month, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (!match) return todayStr().slice(0, 7);
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + Number(delta || 0), 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function budgetCategoryForRecord(record, records = dataState.records) {
  if (!record) return "";
  if (record.category) return record.category;
  const linkId = record.type === "退款" ? record.refundLinkId : record.type === "报销" ? record.reimbursementLinkId : null;
  if (!linkId) return "";
  const original = (Array.isArray(records) ? records : []).find(item => String(item.id) === String(linkId));
  return original && original.category ? original.category : "";
}

function budgetActuals(month, records = dataState.records) {
  let totalCents = 0;
  const categories = {};
  (Array.isArray(records) ? records : []).forEach(record => {
    if (!record || String(record.date || "").slice(0, 7) !== month) return;
    const cents = toCents(expenseEffect(record));
    if (!cents) return;
    totalCents += cents;
    const category = budgetCategoryForRecord(record, records);
    if (category) categories[category] = (categories[category] || 0) + cents;
  });
  return {
    totalCents: Math.max(0, totalCents),
    categories: Object.fromEntries(Object.entries(categories).map(([name, cents]) => [name, Math.max(0, cents)]))
  };
}

function budgetMoney(cents, signed = false) {
  const value = Number(cents || 0) / 100;
  if (signed && value < 0) return "−¥" + Math.abs(value).toFixed(2);
  return "¥" + Math.abs(value).toFixed(2);
}

function budgetPercent(actualCents, limitCents) {
  if (!(Number(limitCents) > 0)) return null;
  return Math.round((Number(actualCents || 0) / Number(limitCents)) * 100);
}

function budgetStatus(actualCents, limitCents) {
  if (!(Number(limitCents) > 0)) return { label: "未设置额度", cls: "unset" };
  const percent = budgetPercent(actualCents, limitCents);
  if (percent > 100) return { label: "已超支", cls: "over" };
  if (percent >= 80) return { label: "接近上限", cls: "near" };
  return { label: "执行正常", cls: "normal" };
}

function budgetProgressHtml(actualCents, limitCents, label) {
  const percent = budgetPercent(actualCents, limitCents);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const status = budgetStatus(actualCents, limitCents);
  return `
    <div class="budget-progress" role="progressbar" aria-label="${esc(label)}使用进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent === null ? 0 : Math.min(100, percent)}">
      <span class="budget-progress-bar ${status.cls}" style="width:${width}%"></span>
    </div>
  `;
}

function budgetCategoryOptions() {
  const period = budgetPeriod();
  const used = new Set(Object.keys(period.categories));
  return allCategories("expense").filter((name, index, list) => list.indexOf(name) === index && !used.has(name));
}

function closeBudgetCategoryPicker() {
  const menu = document.getElementById("budgetCategoryPickerMenu");
  const trigger = document.getElementById("budgetCategoryPickerBtn");
  if (menu) menu.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function renderBudgetCategoryPickerOptions() {
  const select = document.getElementById("budgetCategorySelect");
  const menu = document.getElementById("budgetCategoryPickerMenu");
  if (!select || !menu) return;
  menu.innerHTML = "";
  const options = Array.from(select.options).filter(option => option.value);
  if (options.length === 0) {
    const empty = document.createElement("div");
    empty.className = "budget-category-picker-empty";
    empty.textContent = "暂无可用类别";
    menu.appendChild(empty);
    return;
  }
  options.forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "budget-category-picker-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", option.value === select.value ? "true" : "false");
    if (option.value === select.value) button.classList.add("selected");
    button.textContent = option.textContent;
    button.addEventListener("click", () => {
      select.value = option.value;
      syncBudgetCategoryPicker();
      closeBudgetCategoryPicker();
    });
    menu.appendChild(button);
  });
}

function syncBudgetCategoryPicker() {
  const select = document.getElementById("budgetCategorySelect");
  const trigger = document.getElementById("budgetCategoryPickerBtn");
  if (!select || !trigger) return;
  trigger.replaceChildren();
  const label = document.createElement("span");
  label.textContent = select.value || "选择类别";
  trigger.appendChild(label);
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "⌄";
  trigger.appendChild(arrow);
  trigger.classList.toggle("has-value", Boolean(select.value));
  renderBudgetCategoryPickerOptions();
}

function renderBudgetCategoryOptions() {
  const select = document.getElementById("budgetCategorySelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">选择类别</option>' + budgetCategoryOptions()
    .map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  if (budgetCategoryOptions().includes(current)) select.value = current;
  syncBudgetCategoryPicker();
}

function renderBudgetSummary(month, period, actuals) {
  const box = document.getElementById("budgetSummary");
  if (!box) return;
  const total = period.totalCents;
  const hasTotal = Number(total) > 0;
  const used = actuals.totalCents;
  const remaining = hasTotal ? Number(total) - used : null;
  const status = budgetStatus(used, total);
  const statusText = hasTotal
    ? (remaining < 0 ? "已超支 " + budgetMoney(Math.abs(remaining)) : "剩余 " + budgetMoney(remaining))
    : "还没有设置本月额度";
  box.innerHTML = `
    <div class="budget-summary-head">
      <div>
        <span class="budget-summary-kicker">${esc(budgetMonthLabel(month))} · 支出预算</span>
        <strong>${hasTotal ? budgetMoney(total) : "未设置"}</strong>
      </div>
      <span class="budget-status ${status.cls}">${status.label}</span>
    </div>
    <div class="budget-summary-numbers">
      <span>已用 <strong>${budgetMoney(used)}</strong></span>
      <span class="${remaining !== null && remaining < 0 ? "over" : ""}">${esc(statusText)}</span>
    </div>
    ${budgetProgressHtml(used, total, "月度总预算")}
    <div class="budget-summary-caption">${hasTotal ? (budgetPercent(used, total) + "% 已使用") : "设置总预算后，这里会显示使用进度"}</div>
  `;
}

function renderBudgetCategoryList(month, period, actuals) {
  const box = document.getElementById("budgetCategoryList");
  const empty = document.getElementById("budgetCategoryEmpty");
  if (!box || !empty) return;
  const entries = Object.entries(period.categories);
  empty.hidden = entries.length > 0;
  box.innerHTML = entries.map(([name, limitCents]) => {
    const used = actuals.categories[name] || 0;
    const remaining = Number(limitCents) - used;
    const status = budgetStatus(used, limitCents);
    return `
      <div class="budget-category-row" data-budget-category="${esc(name)}">
        <div class="budget-category-top">
          <div>
            <strong>${esc(name)}</strong>
            <span class="budget-status ${status.cls}">${status.label}</span>
          </div>
          <div class="budget-category-actions">
            <label class="sr-only" for="budget-category-${esc(name)}">${esc(name)}预算额度</label>
            <input id="budget-category-${esc(name)}" class="budget-category-input" type="number" min="0" step="0.01" value="${(Number(limitCents) / 100).toFixed(2)}" data-budget-category-input>
            <button class="mini-btn" type="button" data-budget-action="save">保存</button>
            <button class="mini-btn danger" type="button" data-budget-action="remove">删除</button>
          </div>
        </div>
        <div class="budget-category-meta"><span>已用 <strong>${budgetMoney(used)}</strong></span><span class="${remaining < 0 ? "over" : ""}">${remaining < 0 ? "超支 " : "剩余 "}<strong>${budgetMoney(Math.abs(remaining))}</strong></span></div>
        ${budgetProgressHtml(used, limitCents, name)}
      </div>
    `;
  }).join("");
}

function renderBudgetPage() {
  if (!document.getElementById("panelBudget")) return;
  if (!dataState.budgetData) loadBudgetData();
  const monthInput = document.getElementById("budgetMonthInput");
  const month = /^\d{4}-\d{2}$/.test(budgetUiState.month) ? budgetUiState.month : todayStr().slice(0, 7);
  budgetUiState.month = month;
  if (monthInput) monthInput.value = month;
  const period = budgetPeriod(month);
  const actuals = budgetActuals(month);
  const totalInput = document.getElementById("budgetTotalInput");
  if (totalInput) totalInput.value = period.totalCents === null ? "" : (period.totalCents / 100).toFixed(2);
  renderBudgetSummary(month, period, actuals);
  renderBudgetCategoryOptions();
  renderBudgetCategoryList(month, period, actuals);
}

function showBudgetMsg(text, warn = false) {
  const box = document.getElementById("budgetMsg");
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("warn", !!warn);
}

function saveBudgetPeriodAndRender(message = "预算已保存") {
  saveBudgetData("budget_write");
  renderBudgetPage();
  showBudgetMsg(message);
}

function saveBudgetTotal() {
  const input = document.getElementById("budgetTotalInput");
  if (!input) return;
  const raw = input.value.trim();
  const period = budgetPeriod();
  if (raw === "") {
    period.totalCents = null;
    saveBudgetPeriodAndRender("已清除本月总预算");
    return;
  }
  const cents = toCents(raw);
  if (!(cents > 0)) {
    showBudgetMsg("请输入大于 0 的预算额度", true);
    return;
  }
  period.totalCents = cents;
  saveBudgetPeriodAndRender("本月总预算已保存");
}

function clearBudgetTotal() {
  const period = budgetPeriod();
  period.totalCents = null;
  saveBudgetPeriodAndRender("已清除本月总预算");
}

function addBudgetCategory() {
  const select = document.getElementById("budgetCategorySelect");
  const input = document.getElementById("budgetCategoryInput");
  const name = select && select.value ? select.value : "";
  const cents = input ? toCents(input.value) : 0;
  if (!name) {
    showBudgetMsg("请先选择一个类别", true);
    return;
  }
  if (!(cents > 0)) {
    showBudgetMsg("请输入大于 0 的分类预算", true);
    return;
  }
  budgetPeriod().categories[name] = cents;
  if (select) select.value = "";
  if (input) input.value = "";
  saveBudgetPeriodAndRender("分类预算已添加");
}

function updateBudgetCategory(row, remove = false) {
  if (!row) return;
  const name = row.dataset.budgetCategory;
  const period = budgetPeriod();
  if (!name || !period.categories[name]) return;
  if (remove) {
    delete period.categories[name];
    saveBudgetPeriodAndRender("分类预算已删除");
    return;
  }
  const input = row.querySelector("[data-budget-category-input]");
  const cents = input ? toCents(input.value) : 0;
  if (!(cents > 0)) {
    showBudgetMsg("分类预算必须大于 0；如不再需要，请点击删除", true);
    return;
  }
  period.categories[name] = cents;
  saveBudgetPeriodAndRender("分类预算已保存");
}

function bindBudgetEvents() {
  const prev = document.getElementById("budgetPrevBtn");
  const next = document.getElementById("budgetNextBtn");
  const current = document.getElementById("budgetCurrentBtn");
  const month = document.getElementById("budgetMonthInput");
  const total = document.getElementById("budgetSaveTotalBtn");
  const clear = document.getElementById("budgetClearTotalBtn");
  const add = document.getElementById("budgetAddCategoryBtn");
  const list = document.getElementById("budgetCategoryList");
  const picker = document.getElementById("budgetCategoryPickerBtn");
  const pickerMenu = document.getElementById("budgetCategoryPickerMenu");
  if (prev) prev.onclick = () => { budgetUiState.month = shiftBudgetMonth(budgetUiState.month, -1); renderBudgetPage(); };
  if (next) next.onclick = () => { budgetUiState.month = shiftBudgetMonth(budgetUiState.month, 1); renderBudgetPage(); };
  if (current) current.onclick = () => { budgetUiState.month = todayStr().slice(0, 7); renderBudgetPage(); };
  if (month) month.onchange = () => { if (/^\d{4}-\d{2}$/.test(month.value)) budgetUiState.month = month.value; renderBudgetPage(); };
  if (total) total.onclick = saveBudgetTotal;
  if (clear) clear.onclick = clearBudgetTotal;
  if (add) add.onclick = addBudgetCategory;
  if (picker && pickerMenu) {
    picker.setAttribute("aria-controls", "budgetCategoryPickerMenu");
    picker.onclick = event => {
      event.stopPropagation();
      const opening = pickerMenu.hidden;
      closeBudgetCategoryPicker();
      pickerMenu.hidden = !opening;
      picker.setAttribute("aria-expanded", opening ? "true" : "false");
      if (opening) {
        const rect = picker.getBoundingClientRect();
        const roomBelow = window.innerHeight - rect.bottom;
        const roomAbove = rect.top;
        const preferredHeight = Math.min(150, window.innerHeight * 0.24);
        pickerMenu.classList.toggle("open-up", roomBelow < preferredHeight && roomAbove > roomBelow);
        renderBudgetCategoryPickerOptions();
      }
    };
  }
  if (list) list.onclick = event => {
    const button = event.target.closest("[data-budget-action]");
    if (!button) return;
    updateBudgetCategory(button.closest("[data-budget-category]"), button.dataset.budgetAction === "remove");
  };
  if (!document.body.dataset.budgetCategoryPickerBound) {
    document.addEventListener("click", event => {
      if (!event.target.closest(".budget-category-picker")) closeBudgetCategoryPicker();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeBudgetCategoryPicker();
    });
    document.body.dataset.budgetCategoryPickerBound = "true";
  }
}
