// 基础页面视图模块：负责统计卡片、明细列表、账户列表和页面面板切换。
// 业务计算由 records.js 提供，账本总览和统计图暂时保留在入口脚本中。

// ============ 渲染：统计卡片 ============
function renderStats() {
  const month = dataState.records.filter(r => isThisMonth(r.date));
  const income = month.reduce((s, r) => s + incomeEffect(r), 0);
  const expense = month.reduce((s, r) => s + expenseEffect(r), 0);
  const balance = income - expense;

  document.getElementById("incomeTotal").textContent =
    (income < 0 ? "−¥" : "+¥") + Math.abs(income).toFixed(2);
  document.getElementById("expenseTotal").textContent =
    (expense < 0 ? "+¥" : "−¥") + Math.abs(expense).toFixed(2);
  document.getElementById("balance").textContent =
    (balance < 0 ? "−¥" : "¥") + Math.abs(balance).toFixed(2);

  // 净资产还要计入尚未收回的借款、代付款和押金应收/应付。
  const net = computeNetWorthFor(dataState.accounts, dataState.records);
  document.getElementById("netWorth").textContent =
    (net < 0 ? "−¥" : "¥") + Math.abs(net).toFixed(2);
}

function detailPeriodRangeText(period) {
  const bounds = detailPeriodBounds(period);
  if (!bounds) return "全部日期";
  const start = parseLocalDate(bounds.start);
  const end = parseLocalDate(bounds.end);
  if (!start || !end) return "全部日期";
  if (period === "today") return (end.getMonth() + 1) + "月" + end.getDate() + "日";
  if (period === "year") return end.getFullYear() + "年";
  return (start.getMonth() + 1) + "月" + start.getDate() + "日—" + (end.getMonth() + 1) + "月" + end.getDate() + "日";
}

function detailPeriodRecords(period) {
  return filterByPeriod(recordsInDetailPeriod(dataState.records, period)).filter(matchesSearch);
}

function detailPeriodMoney(value, side) {
  const amount = Number(value) || 0;
  const sign = side === "income"
    ? (amount < 0 ? "−¥" : "+¥")
    : (amount < 0 ? "+¥" : "−¥");
  return sign + Math.abs(amount).toFixed(2);
}

function renderDetailPeriodCards() {
  const box = document.getElementById("detailPeriodCards");
  if (!box) return;
  const active = uiState.detailPeriod || "month";
  box.innerHTML = DETAIL_PERIODS.map(period => {
    const records = detailPeriodRecords(period.key);
    const income = records.reduce((sum, record) => sum + incomeEffect(record), 0);
    const expense = records.reduce((sum, record) => sum + expenseEffect(record), 0);
    const isActive = active === period.key;
    return `
      <button class="detail-period-card${isActive ? " active" : ""}" type="button" data-detail-period="${period.key}" aria-pressed="${isActive ? "true" : "false"}">
        <span class="detail-period-main">
          <span class="detail-period-name">${period.name}</span>
          <span class="detail-period-range">${detailPeriodRangeText(period.key)}</span>
        </span>
        <span class="detail-period-count">${records.length ? "共 " + records.length + " 笔" : "暂无账目"}</span>
        <span class="detail-period-totals" aria-label="${period.name}收入和支出">
          <span class="detail-period-total income"><span class="detail-period-total-label">收入</span><strong>${detailPeriodMoney(income, "income")}</strong></span>
          <span class="detail-period-total expense"><span class="detail-period-total-label">支出</span><strong>${detailPeriodMoney(expense, "expense")}</strong></span>
        </span>
      </button>
    `;
  }).join("");
}

// 所选阶段的汇总：总收入 / 总支出 / 新增负债
function renderPeriodSummary() {
  const box = document.getElementById("periodSummary");
  const shown = filteredRecords();
  // 新增负债 = 支出侧的钱进出负债账户（付押金用花呗算新增，退回算减少）
  const debt = shown.reduce((s, r) => {
    const e = expenseEffect(r);
    return (e !== 0 && isLiabAccount(r.account)) ? s + e : s;
  }, 0);
  const debtText = (debt < 0 ? "−¥" : "¥") + Math.abs(debt).toFixed(2);

  box.innerHTML = `
    <div class="period-stat period-stat-debt-only">
      <div class="label">新增负债</div>
      <div class="value debt">${debtText}</div>
    </div>
  `;
}

function renderDetailFilters() {
  const panel = document.getElementById("detailFilters");
  const toggle = document.getElementById("filterToggle");
  const reset = document.getElementById("filterResetBtn");
  if (!panel || !toggle || !reset) return;
  const active = [];
  if (filterState.fromDate || filterState.toDate) active.push("日期");
  if (filterState.account) active.push("账户");
  if (filterState.category) active.push("类别");
  if (filterState.searchKey.trim()) active.push("搜索");
  panel.hidden = !uiState.detailFiltersExpanded;
  toggle.setAttribute("aria-expanded", uiState.detailFiltersExpanded ? "true" : "false");
  toggle.textContent = uiState.detailFiltersExpanded
    ? "收起筛选条件"
    : (active.length ? "筛选条件（已选" + active.length + "项）" : "展开筛选条件");
  reset.disabled = active.length === 0;
  renderCompactFilterPicker("filterAccountSel", "filterAccountPickerBtn", "filterAccountPickerMenu", "全部账户");
  renderCompactFilterPicker("filterCategorySel", "filterCategoryPickerBtn", "filterCategoryPickerMenu", "全部类别");
}

function renderCompactFilterPicker(selectId, buttonId, menuId, emptyLabel) {
  const select = document.getElementById(selectId);
  const button = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  if (!select || !button || !menu) return;
  const selected = select.options[select.selectedIndex];
  const selectedLabel = selected ? selected.textContent : emptyLabel;
  button.innerHTML = `${esc(selectedLabel)}<span aria-hidden="true">⌄</span>`;
  button.classList.toggle("has-value", Boolean(select.value));
  // select.options 已包含 optgroup 内的实际账户；optgroup 标题本身不是 option。
  menu.innerHTML = Array.from(select.options).map(option =>
    `<button class="compact-picker-option${option.value === select.value ? " selected" : ""}" type="button" role="option" data-picker-value="${esc(option.value)}" aria-selected="${option.value === select.value ? "true" : "false"}">${esc(option.textContent)}</button>`
  ).join("");
  menu.querySelectorAll("[data-picker-value]").forEach(optionButton => {
    optionButton.onclick = () => {
      select.value = optionButton.dataset.pickerValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCompactPickers();
    };
  });
}

function closeCompactPickers(exceptId = "") {
  document.querySelectorAll(".compact-picker-menu").forEach(menu => {
    if (menu.id === exceptId) return;
    menu.hidden = true;
    const button = menu.parentElement && menu.parentElement.querySelector(".compact-picker-trigger");
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

function toggleCompactPicker(buttonId, menuId) {
  const button = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  if (!button || !menu) return;
  const willOpen = menu.hidden;
  closeCompactPickers(menuId);
  if (willOpen) {
    const rect = button.getBoundingClientRect();
    const preferredHeight = Math.min(230, window.innerHeight * 0.4);
    menu.classList.toggle("open-up", window.innerHeight - rect.bottom < preferredHeight && rect.top > window.innerHeight - rect.bottom);
  }
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function renderChartPanel() {
  const panel = document.getElementById("chartPanel");
  const toggle = document.getElementById("chartToggle");
  if (!panel || !toggle) return;
  panel.hidden = !uiState.chartExpanded;
  toggle.setAttribute("aria-expanded", uiState.chartExpanded ? "true" : "false");
  toggle.textContent = uiState.chartExpanded ? "收起统计图" : "展开统计图";
}

// ============ 渲染：明细列表 ============
function renderList() {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const emptyAction = document.getElementById("emptyRecordBtn");
  const toggle = document.getElementById("detailToggle");
  const categoryTotal = document.getElementById("detailCategoryTotal");
  const wrap = document.getElementById("listWrap");
  list.innerHTML = "";

  // 先按时间段筛选，再按搜索关键字筛选
  const shown = filterByPeriod(recordsInDetailPeriod(dataState.records, currentDetailPeriod()));
  const filtered = shown.filter(matchesSearch);
  renderSelectedCategoryTotal(categoryTotal);

  // 没有任何账目时，只提示，不显示“展开”按钮
  if (dataState.records.length === 0) {
    toggle.style.display = "none";
    wrap.style.display = "block";
    empty.style.display = "block";
    empty.textContent = "还没有账目，先记一笔吧";
    if (emptyAction) emptyAction.style.display = "block";
    return;
  }
  if (emptyAction) emptyAction.style.display = "none";
  // 有账目：进入流水页默认展开，用户仍可通过按钮收起
  toggle.style.display = "inline-block";
  toggle.textContent = uiState.detailExpanded
    ? "▴ 收起明细"
    : "▾ 展开明细（共 " + filtered.length + " 笔）";
  wrap.style.display = uiState.detailExpanded ? "block" : "none";
  if (!uiState.detailExpanded) return;

  if (shown.length === 0) {
    empty.style.display = "block";
    empty.textContent = filterState.account ? "当前账户在所选时间段没有账目" : "这个时间段没有账目";
    return;
  }
  if (filtered.length === 0) {
    empty.style.display = "block";
    empty.textContent = "没有找到匹配的账目";
    return;
  }
  empty.style.display = "none";

  // 按日期从新到旧排（同一天按 id 大的在前 = 后记的在前）
  const sorted = [...filtered].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id - a.id
  );

  // 按日期分组，一组一个日期标题
  const groups = {};
  sorted.forEach(r => { (groups[r.date] = groups[r.date] || []).push(r); });

  Object.keys(groups).forEach(date => {
    const head = document.createElement("div");
    head.className = "date-head";
    head.textContent = formatDate(date);
    list.appendChild(head);

    groups[date].forEach(r => {
      const row = document.createElement("div");
      row.className = "row";

      const amt = amountText(r);
      const isDep = (r.type === "押金");
      const badgeText = r.fundAction === "contribution" ? (r.fundMode === "recurring" ? "基金定投" : "基金投资") :
        r.fundAction === "withdrawal" ? "基金赎回" : isDep ? depositLabel(r.depositDir) : r.type;
      const badgeCls = isIncome(r) ? "income" : isExpense(r) ? "expense" : "";
      let accLabel = accountName(r.account);
      if (r.type === "转账" && r.toAccount) {
        accLabel = accountName(r.account) + " → " + accountName(r.toAccount);
      }
      const accHtml = r.account ? `<div class="row-date">${esc(accLabel)}</div>` : "";
      // 押金显示“对象”，备注跟在后面
      let noteText = r.note || "";
      if (r.type === "转账" && r.transferMode === "转账他人" && r.transferParty) {
        noteText = "转账给：" + r.transferParty + (noteText ? " · " + noteText : "");
      }
      if (isDep && r.depositTarget) {
        noteText = "对象：" + r.depositTarget + (noteText ? " · " + noteText : "");
      }
      if (isDep && r.depositFinal) {
        const settlement = depositSettlementInfo(r, r.id);
        if (settlement.difference > 0) {
          noteText += (noteText ? " · " : "") + "结算差额 ¥" + settlement.difference.toFixed(2) + (settlement.expense > 0 ? "计支出" : "计收入");
        }
      }
      if (r.type === "借贷") {
        const remaining = typeof loanOutstandingFor === "function" ? loanOutstandingFor(r) : 0;
        noteText = (r.loanMode || "借贷") + (r.loanParty ? " · 对象：" + r.loanParty : "") +
          (isLoanOriginalMode(r.loanMode) && remaining > 0 ? " · 未结清 ¥" + remaining.toFixed(2) : "") +
          (noteText ? " · " + noteText : "");
      }
      if (r.type === "代付") {
        const remaining = typeof payOutstandingFor === "function" ? payOutstandingFor(r) : 0;
        noteText = (r.payMode || "代付") + (r.payParty ? " · 对象：" + r.payParty : "") +
          (r.payMode === "代付" && remaining > 0 ? " · 待收回 ¥" + remaining.toFixed(2) : "") +
          (noteText ? " · " + noteText : "");
      }
      if (r.type === "报销") {
        const effect = typeof reimbursementEffect === "function" ? reimbursementEffect(r) : { original: null, excess: 0 };
        noteText = "来源：" + (r.reimbursementParty || "未填写") +
          (effect.original ? " · 原支出 ¥" + amountOf(effect.original).toFixed(2) : "") +
          (effect.excess > 0 ? " · 超出部分计收入 ¥" + effect.excess.toFixed(2) : "") +
          (noteText ? " · " + noteText : "");
      }
      if (r.type === "退款") {
        const effect = typeof refundEffect === "function" ? refundEffect(r) : { original: null, excess: 0 };
        noteText = (effect.original ? "原支出 ¥" + amountOf(effect.original).toFixed(2) : "未关联原支出") +
          (effect.excess > 0 ? " · 超出部分计收入 ¥" + effect.excess.toFixed(2) : "") +
          (noteText ? " · " + noteText : "");
      }

      row.innerHTML = `
        <div class="row-main">
          <div class="row-top">
            <span class="badge ${badgeCls}">${esc(badgeText)}</span>
            ${["余额", "借贷", "代付", "报销", "退款", "基金结算"].includes(r.type) || r.investmentPlanId || r.fundProjectId || !r.category ? "" : `<button class="row-cat row-category-button" type="button" data-category="${esc(r.category)}" aria-label="查看${esc(r.category)}类别流水和合计">${esc(r.category)}</button>`}
          </div>
          <div class="row-note">${esc(noteText)}</div>
          ${accHtml}
        </div>
        <div class="row-amount ${amt.cls}">${amt.text}</div>
        <div class="row-actions">${r.fundProjectId ?
          `<button class="mini-btn row-action-btn" data-id="${esc(r.fundProjectId)}" data-act="fund">查看基金</button>` :
          `<button class="mini-btn row-action-btn" data-id="${r.id}" data-act="edit" title="编辑这笔账" aria-label="编辑这笔账"><span class="ui-icon" data-icon="edit" aria-hidden="true"></span><span class="action-label">编辑</span></button>
          <button class="mini-btn danger row-action-btn" data-id="${r.id}" data-act="del" title="删除这笔账" aria-label="删除这笔账"><span class="ui-icon" data-icon="delete" aria-hidden="true"></span><span class="action-label">删除</span></button>`}</div>
      `;
      list.appendChild(row);
    });
  });

  // 给“改”“删”按钮绑事件
  list.querySelectorAll(".mini-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "fund") {
        switchTab("investment");
        if (typeof openFundDetail === "function") openFundDetail(id);
      } else if (btn.dataset.act === "edit") startEdit(id);
      else deleteRec(id);
    };
  });
  list.querySelectorAll(".row-category-button").forEach(button => {
    button.onclick = () => {
      filterState.category = button.dataset.category || "";
      const select = document.getElementById("filterCategorySel");
      if (select) select.value = filterState.category;
      uiState.detailFiltersExpanded = true;
      uiState.detailExpanded = true;
      refreshDetail();
    };
  });
  if (typeof renderUiIcons === "function") renderUiIcons(list);
}

function renderSelectedCategoryTotal(box) {
  if (!box) return;
  const category = filterState.category;
  if (!category) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  const records = recordsInDetailPeriod(dataState.records, currentDetailPeriod()).filter(record => {
    if (filterState.fromDate && record.date < filterState.fromDate) return false;
    if (filterState.toDate && record.date > filterState.toDate) return false;
    if (filterState.account && String(record.account) !== filterState.account && String(record.toAccount) !== filterState.account) return false;
    return true;
  });
  let totalCents = 0;
  records.forEach(record => {
    if (record.type === "报销" || record.type === "退款") {
      const effect = record.type === "报销" ? reimbursementEffect(record) : refundEffect(record);
      const original = effect.original;
      if ((original && original.category === category) || (!original && record.category === category)) {
        totalCents += toCents(effect.expense);
      }
      return;
    }
    if (record.category === category) totalCents += toCents(expenseEffect(record));
  });
  box.hidden = false;
  box.innerHTML = `<span>${esc(category)}类支出合计</span><strong>¥${(Math.max(0, totalCents) / 100).toFixed(2)}</strong>`;
}

// ============ 渲染：账户列表 ============
function renderAccountList() {
  const box = document.getElementById("accountList");
  box.innerHTML = "";
  const bal = computeBalances();

  ["资金", "负债"].forEach(kind => {
    const group = dataState.accounts.filter(a => a.kind === kind && !a.fundOnly);
    if (group.length === 0) return;
    const glabel = document.createElement("div");
    glabel.className = "acc-group-label";
    glabel.textContent = (kind === "资金") ? "资金账户" : "负债账户";
    box.appendChild(glabel);

    group.forEach(a => {
      const b = bal[a.id];
      const row = document.createElement("div");
      row.className = "acc-row";
      row.innerHTML = `
        <div class="acc-main">
          <div>
            <span class="acc-name">${esc(a.name)}</span>
            <span class="acc-kind ${kind === "负债" ? "liab" : ""}">${kind}</span>
          </div>
          <div class="acc-init">本金 ${initialOf(a).toFixed(2)}</div>
        </div>
        <div class="acc-balance ${b < 0 ? "neg" : ""}">${kind === "负债" ? "欠款 ¥" : "¥"}${b.toFixed(2)}</div>
        <div class="row-actions">
          <button class="mini-btn row-action-btn" data-id="${a.id}" data-act="edit" title="修改账户余额和本金" aria-label="修改账户余额和本金"><span class="ui-icon" data-icon="edit" aria-hidden="true"></span><span class="action-label">修改余额</span></button>
          <button class="mini-btn danger row-action-btn" data-id="${a.id}" data-act="del" title="删除账户" aria-label="删除账户"><span class="ui-icon" data-icon="delete" aria-hidden="true"></span><span class="action-label">删除</span></button>
        </div>
      `;
      box.appendChild(row);
    });
  });

  box.querySelectorAll(".mini-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "edit") startEditAccount(id);
      else deleteAccount(id);
    };
  });
  if (typeof renderUiIcons === "function") renderUiIcons(box);
}

// 筛选变化时，刷新明细列表 + 汇总 + 统计图
function refreshDetail() {
  renderDetailPeriodCards();
  renderList();
  renderPeriodSummary();
  renderChart();
  renderDetailFilters();
}

function renderStartupNotice() {
  const notice = document.getElementById("startupNotice");
  notice.textContent = uiState.startupNotice;
  notice.hidden = !uiState.startupNotice;
}

// 一次刷新所有
function render() {
  renderStartupNotice();
  renderPeriodSummary();
  renderStats();
  renderDetailPeriodCards();
  renderList();
  renderAccountList();
  renderAccountSelects();
  renderChartKindChips();
  renderChartTypeChips();
  renderChart();
  renderDetailFilters();
  renderChartPanel();
  renderOverview();
  if (typeof renderHomeTrendChart === "function") renderHomeTrendChart();
  if (typeof renderBudgetPage === "function") renderBudgetPage();
  if (typeof renderInvestmentPlans === "function") renderInvestmentPlans();
}

// 切换页面，一次只显示一个；首页只负责概览，低频操作进入独立页面。
// 进入独立页面写入浏览器历史；回首页时可替换当前历史，避免返回手势再次进入已离开的页面。
function switchTab(tab, options = {}) {
  const currentTab = uiState.activeTab || "home";
  if (window.history && typeof window.history.pushState === "function" && !options.fromHistory && currentTab !== tab) {
    if (options.replaceHistory && typeof window.history.replaceState === "function") {
      window.history.replaceState({ tab }, "", `#${tab}`);
    } else {
      window.history.pushState({ tab }, "", `#${tab}`);
    }
  }
  uiState.activeTab = tab;
  // 每次从其它页面进入流水，都直接展示明细；用户仍可在流水页手动收起。
  if (tab === "detail" && currentTab !== "detail") uiState.detailExpanded = true;
  const app = document.querySelector(".app");
  if (app) app.classList.toggle("subpage-open", tab !== "home");
  const bottomNav = document.querySelector(".bottom-nav");
  if (bottomNav) bottomNav.classList.toggle("record-hidden", tab === "record" || tab === "categorySystem");
  const panels = ["panelHome", "panelBook", "panelRecord", "panelCategorySystem", "panelAccount", "panelDetail", "panelOverview", "panelBudget", "panelInvestment"];
  panels.forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.style.display = "none";
  });
  const panelMap = {
    home: "panelHome",
    book: "panelBook",
    record: "panelRecord",
    categorySystem: "panelCategorySystem",
    account: "panelAccount",
    detail: "panelDetail",
    overview: "panelOverview",
    budget: "panelBudget",
    investment: "panelInvestment"
  };
    const target = document.getElementById(panelMap[tab] || "panelHome");
    if (target) target.style.display = "block";
    if (tab === "record" && typeof showRecordKeyboard === "function") showRecordKeyboard();
    if (tab !== "record" && typeof hideRecordKeyboard === "function") hideRecordKeyboard();
    if (tab === "detail") refreshDetail();
  if (tab === "overview") {
    renderOverview();
    renderChart();
  }
  if (tab === "book") renderBookList();
  if (tab === "categorySystem" && typeof renderCategorySystem === "function") renderCategorySystem();
  if (tab === "budget" && typeof renderBudgetPage === "function") renderBudgetPage();
  if (tab === "investment" && typeof setFundView === "function" && currentTab !== "investment") setFundView("home");
  else if (tab === "investment" && typeof renderInvestmentPlans === "function") renderInvestmentPlans();
  document.querySelectorAll(".bottom-nav .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}
