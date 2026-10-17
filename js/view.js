// 基础页面视图模块：负责统计卡片、明细列表、账户列表和页面面板切换。
// 业务计算由 records.js 提供，账本总览和统计图暂时保留在入口脚本中。

// ============ 渲染：统计卡片 ============
function renderStats() {
  return withRecordCalculationIndex(dataState.records, renderStatsContents);
}

function renderStatsContents() {
  const monthLabel = document.getElementById("homeMonthLabel");
  if (monthLabel) {
    const now = new Date();
    monthLabel.textContent = now.getFullYear() + "年" + (now.getMonth() + 1) + "月";
  }
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
  // 首页始终展示当前账本的完整期间，不能被流水页遗留的账户／类别条件缩小。
  return recordsInDetailPeriod(dataState.records, period);
}

// 只读选取最近五笔，最多保留五个候选，不对原数组排序或建立持久化副本。
function homeRecentRecords() {
  const recent = [];
  dataState.records.forEach(record => {
    const index = recent.findIndex(other => {
      const dateOrder = String(record.date || "").localeCompare(String(other.date || ""));
      if (dateOrder) return dateOrder > 0;
      const left = Number(record.id), right = Number(other.id);
      return Number.isFinite(left) && Number.isFinite(right) ? left > right : true;
    });
    if (index !== -1) recent.splice(index, 0, record);
    else if (recent.length < 5) recent.push(record);
    if (recent.length > 5) recent.pop();
  });
  return recent;
}

function renderHomeRecentRecords() {
  const box = document.getElementById("homeRecentList");
  if (!box) return;
  const recent = homeRecentRecords();
  if (!recent.length) {
    box.innerHTML = '<div class="home-recent-empty"><strong>还没有流水</strong><p>从第一笔日常开销开始。</p><button class="home-empty-record" type="button" data-home-record>记一笔</button></div>';
    return;
  }
  let previousDate = null;
  box.innerHTML = recent.map(record => {
    const date = String(record.date || "");
    const dateText = parseLocalDate(date) ? formatDate(date) : "日期未填写";
    const heading = previousDate !== date ? `<div class="home-recent-date">${esc(dateText)}</div>` : "";
    previousDate = date;
    const amount = amountText(record); // 沿用流水原有的收支／中性显示，不能把基金或押金本金当作支出。
    const type = record.fundAction === "contribution" ? (record.fundMode === "recurring" ? "基金定投" : "基金投资") : record.fundAction === "withdrawal" ? "基金赎回" : record.type;
    const category = record.category || type;
    const account = record.account ? accountName(record.account) : "未指定账户";
    const accountText = record.type === "转账" && record.toAccount ? account + " → " + accountName(record.toAccount) : account;
    return `${heading}<button class="home-recent-row" type="button" data-home-date="${esc(date)}" aria-label="${esc("查看" + dateText + "流水：" + accountText + "，" + type + "，" + category)}">
      <span class="home-recent-icon" aria-hidden="true">${categoryIconMarkup(record.category, "other")}</span>
      <span class="home-recent-main"><span class="home-recent-top"><strong class="home-recent-account">${esc(accountText)}</strong><span class="home-recent-category">${esc(category)}</span></span><span class="home-recent-meta"><span class="home-recent-type">${esc(type)}</span></span></span>
      <span class="row-amount home-recent-amount ${esc(amount.cls)}">${esc(amount.text)}</span>
    </button>`;
  }).join("");
}

// 首页的“全部”与日期入口明确切换查询范围；只改内存筛选，不保存或迁移账本。
function openHomeRecords(date = "") {
  const day = parseLocalDate(date) ? date : "";
  Object.assign(filterState, { account: "", category: "", searchKey: "", fromDate: day, toDate: day, periodMode: day ? "range" : "all" });
  uiState.detailExpanded = true;
  switchTab("detail");
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
        <span class="detail-period-totals">
          <span class="detail-period-total expense"><span class="detail-period-total-label">支出</span><strong>${detailPeriodMoney(expense, "expense")}</strong></span>
          <span class="detail-period-total income"><span class="detail-period-total-label">收入</span><strong>${detailPeriodMoney(income, "income")}</strong></span>
        </span>
      </button>
    `;
  }).join("");
}

// 所选阶段的汇总：总收入 / 总支出 / 新增负债
function renderPeriodSummary() {
  const box = document.getElementById("periodSummary");
  const period = DETAIL_PERIODS.find(item => item.key === uiState.detailPeriod) || DETAIL_PERIODS[2];
  const shown = detailPeriodRecords(period.key);
  // 新增负债 = 支出侧的钱进出负债账户（付押金用花呗算新增，退回算减少）
  const debt = shown.reduce((s, r) => {
    const e = expenseEffect(r);
    return (e !== 0 && isLiabAccount(r.account)) ? s + e : s;
  }, 0);
  const debtText = (debt < 0 ? "−¥" : "¥") + Math.abs(debt).toFixed(2);

  box.innerHTML = `
    <div class="period-stat period-stat-debt-only">
      <div class="label">${period.name}新增负债</div>
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
  toggle.innerHTML = '<span class="detail-filter-button-main"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z"/></svg><span>筛选条件' +
    (active.length ? '（已选' + active.length + '项）' : '') + '</span></span><span class="detail-filter-button-action">' +
    (uiState.detailFiltersExpanded ? '收起 ▴' : '展开 ▾') + '</span>';
  reset.disabled = active.length === 0;
  renderCompactFilterPicker("filterAccountSel", "filterAccountPickerBtn", "filterAccountPickerMenu", "全部账户");
  renderCompactFilterPicker("filterCategorySel", "filterCategoryPickerBtn", "filterCategoryPickerMenu", "全部类别");
  const mode = document.getElementById("detailPeriodMode");
  const monthField = document.getElementById("detailMonthField");
  const yearField = document.getElementById("detailYearField");
  const monthInput = document.getElementById("detailMonthInput");
  const yearInput = document.getElementById("detailYearInput");
  if (mode) mode.value = filterState.periodMode || "period";
  renderCompactFilterPicker("detailPeriodMode", "detailPeriodModePickerBtn", "detailPeriodModePickerMenu", "选择范围");
  if (monthInput) monthInput.value = filterState.month || todayStr().slice(0, 7);
  if (yearInput) yearInput.value = filterState.year || String(new Date().getFullYear());
  if (monthField) monthField.hidden = filterState.periodMode !== "month";
  if (yearField) yearField.hidden = filterState.periodMode !== "year";
}

function renderCompactFilterPicker(selectId, buttonId, menuId, emptyLabel) {
  const select = document.getElementById(selectId);
  const button = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  if (!select || !button || !menu) return;
  const selected = select.options[select.selectedIndex];
  const selectedLabel = selected ? selected.textContent : emptyLabel;
  button.innerHTML = `<span class="compact-picker-label">${esc(selectedLabel)}</span><span class="compact-picker-chevron" aria-hidden="true">⌄</span>`;
  button.classList.toggle("has-value", Boolean(select.value));
  // select.options 已包含 optgroup 内的实际账户；optgroup 标题本身不是 option。
  menu.innerHTML = Array.from(select.options).map(option =>
    `<button class="compact-picker-option${option.value === select.value ? " selected" : ""}" type="button" role="option" data-picker-value="${esc(option.value)}" aria-selected="${option.value === select.value ? "true" : "false"}">${esc(option.textContent)}</button>`
  ).join("");
  menu.querySelectorAll("[data-picker-value]").forEach(optionButton => {
    optionButton.onclick = () => {
      select.value = optionButton.dataset.pickerValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      renderCompactFilterPicker(selectId, buttonId, menuId, emptyLabel);
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
  if (willOpen) {
    const selected = menu.querySelector(".compact-picker-option.selected");
    if (selected) menu.scrollTop = Math.max(0, selected.offsetTop - 4);
  }
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
let detailListGeneration = 0;
function renderList(continuation = null) {
  return withRecordCalculationIndex(dataState.records, () => renderListContents(continuation));
}

function renderListContents(continuation) {
  const detailPageSize = 100;
  const list = document.getElementById("list");
  const loadMore = document.getElementById("detailLoadMore");
  const empty = document.getElementById("empty");
  const emptyAction = document.getElementById("emptyRecordBtn");
  const toggle = document.getElementById("detailToggle");
  const categoryTotal = document.getElementById("detailCategoryTotal");
  const wrap = document.getElementById("listWrap");
  if (loadMore) {
    loadMore.hidden = true;
    loadMore.onclick = null; // 最后一批或空结果不再持有旧排序快照。
  }
  const append = continuation && continuation.generation === detailListGeneration &&
    continuation.records === dataState.records && continuation.context === detailBrowseContext();
  detailListGeneration += 1;
  let sorted;
  if (!append) {
    list.innerHTML = "";

    // 先按时间段筛选，再按搜索关键字筛选
    const shown = filterByPeriod(recordsInDetailPeriod(dataState.records, currentDetailPeriod()));
    const filtered = shown.filter(matchesSearch);
    renderDetailPeriodTotals(filtered);
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
    sorted = [...filtered].sort((a, b) =>
      b.date.localeCompare(a.date) || b.id - a.id
    );
  } else sorted = continuation.sorted;
  const visibleCount = Math.max(detailPageSize, uiState.detailVisibleCount || detailPageSize);
  const renderedCount = Math.min(visibleCount, sorted.length);
  const visible = sorted.slice(append ? continuation.visibleCount : 0, renderedCount);
  if (loadMore && renderedCount < sorted.length) {
    // 后续批次只复用本次绘制的快照；任何新绘制都会使旧加载事件失效。
    const next = {
      generation: detailListGeneration,
      records: dataState.records,
      context: detailBrowseContext(),
      sorted,
      visibleCount: renderedCount,
      lastDate: sorted[renderedCount - 1]?.date
    };
    loadMore.hidden = false;
    loadMore.textContent = "再显示 " + Math.min(detailPageSize, sorted.length - renderedCount) + " 笔（剩余 " + (sorted.length - renderedCount) + " 笔）";
    loadMore.onclick = () => {
      if (next.generation !== detailListGeneration || next.records !== dataState.records || next.context !== detailBrowseContext()) {
        refreshDetail();
        return;
      }
      const scrollTop = window.scrollY;
      uiState.detailVisibleCount = renderedCount + detailPageSize;
      renderList(next);
      window.scrollTo(0, scrollTop);
    };
  }

  // 按日期分组，一组一个日期标题
  const groups = {};
  visible.forEach(r => { (groups[r.date] = groups[r.date] || []).push(r); });
  const additions = typeof document.createDocumentFragment === "function" ? document.createDocumentFragment() : list;

  Object.keys(groups).forEach(date => {
    if (!append || date !== continuation.lastDate) {
      const head = document.createElement("div");
      head.className = "date-head";
      head.textContent = formatDate(date);
      additions.appendChild(head);
    }

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
      const accountDisplay = r.account ? accLabel : "未指定账户";
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
            <span class="row-account" title="${esc(accountDisplay)}">${esc(accountDisplay)}</span>
            ${["余额", "转账", "借贷", "代付", "报销", "退款", "基金结算"].includes(r.type) || r.investmentPlanId || r.fundProjectId || !r.category ? "" : `<button class="row-cat row-category-button" type="button" data-category="${esc(r.category)}" aria-label="查看${esc(r.category)}类别流水和合计">${esc(r.category)}</button>`}
          </div>
          <div class="row-note">${esc(noteText)}</div>
          <span class="badge ${badgeCls}">${esc(badgeText)}</span>
        </div>
        <div class="row-amount ${amt.cls}">${esc(amt.text)}</div>
        <div class="row-actions">${r.fundProjectId ?
          `<button class="mini-btn row-action-btn" data-id="${esc(r.fundProjectId)}" data-act="fund">查看基金</button>` :
          `<button class="mini-btn row-action-btn" data-id="${r.id}" data-act="edit" title="编辑这笔账" aria-label="编辑这笔账"><span class="ui-icon" data-icon="edit" aria-hidden="true"></span><span class="action-label">编辑</span></button>
          <button class="mini-btn danger row-action-btn" data-id="${r.id}" data-act="del" title="删除这笔账" aria-label="删除这笔账"><span class="ui-icon" data-icon="delete" aria-hidden="true"></span><span class="action-label">删除</span></button>`}</div>
      `;
      additions.appendChild(row);
    });
  });

  // 给“改”“删”按钮绑事件
  additions.querySelectorAll(".mini-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "fund") {
        switchTab("investment");
        if (typeof openFundDetail === "function") openFundDetail(id);
      } else if (btn.dataset.act === "edit") startEdit(id);
      else deleteRec(id);
    };
  });
  additions.querySelectorAll(".row-category-button").forEach(button => {
    button.onclick = () => {
      filterState.category = button.dataset.category || "";
      const select = document.getElementById("filterCategorySel");
      if (select) select.value = filterState.category;
      uiState.detailFiltersExpanded = true;
      uiState.detailExpanded = true;
      refreshDetail();
    };
  });
  if (typeof renderUiIcons === "function") renderUiIcons(additions);
  if (additions !== list) list.appendChild(additions);
}

function renderDetailPeriodTotals(records) {
  const box = document.getElementById("detailPeriodTotals");
  if (!box) return;
  const rows = Array.isArray(records) ? records : [];
  const income = rows.reduce((total, record) => total + toCents(incomeEffect(record)), 0);
  const expense = rows.reduce((total, record) => total + toCents(expenseEffect(record)), 0);
  box.innerHTML = `<span>收入 <strong class="income">${income < 0 ? "−¥" : "¥"}${Math.abs(income / 100).toFixed(2)}</strong></span><span>支出 <strong class="expense">¥${(expense / 100).toFixed(2)}</strong></span><span>共 ${rows.length} 笔</span>`;
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
  const empty = document.getElementById("accountEmpty");
  if (empty) empty.hidden = dataState.accounts.some(account => !account.fundOnly && ["资金", "负债"].includes(account.kind));
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
          <div class="acc-init">本金 <strong>${initialOf(a).toFixed(2)}</strong></div>
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

// 同一账本、同一筛选范围才可复用浏览位置；相对日期也要考虑跨天。
function detailBrowseContext() {
  const period = currentDetailPeriod();
  return JSON.stringify({
    book: dataState.currentBookId,
    filters: filterState,
    period,
    bounds: period === "all" ? null : detailPeriodBounds(period)
  });
}

// 筛选变化从首批开始；普通页面往返可以保留已加载的批次。
function refreshDetail(options = {}) {
  return withRecordCalculationIndex(dataState.records, () => refreshDetailContents(options));
}

function refreshDetailContents(options) {
  if (!options.preserveVisibleCount) {
    uiState.detailVisibleCount = 100;
    uiState.detailBrowsePosition = null;
  }
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
  return withRecordCalculationIndex(dataState.records, renderContents);
}

function renderContents() {
  renderStartupNotice();
  renderPeriodSummary();
  renderStats();
  renderHomeRecentRecords();
  renderDetailPeriodCards();
  renderList();
  renderAccountList();
  renderAccountSelects();
  renderChartKindChips();
  renderChartTypeChips();
  if (typeof renderReportPeriodControls === "function") renderReportPeriodControls();
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
  if (typeof compactCalendar !== "undefined" && compactCalendar) closeCompactCalendar();
  const currentTab = uiState.activeTab || "home";
  if (currentTab === "categorySystem" && tab !== currentTab && typeof rememberCategorySystemScrollPosition === "function") {
    rememberCategorySystemScrollPosition();
  }
  if (currentTab === "detail" && tab !== "detail") {
    uiState.detailBrowsePosition = {
      context: detailBrowseContext(),
      visibleCount: uiState.detailVisibleCount,
      scrollTop: Math.max(0, window.scrollY || 0)
    };
  }
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
  if (bottomNav) bottomNav.classList.toggle("record-hidden", tab === "record" || tab === "categorySystem" || tab === "fixedIncome");
  const panels = ["panelHome", "panelHomePeriods", "panelBook", "panelRecord", "panelCategorySystem", "panelFixedIncome", "panelAccount", "panelDetail", "panelOverview", "panelBudget", "panelInvestment"];
  panels.forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.style.display = "none";
  });
  const panelMap = {
    home: "panelHome",
    homePeriods: "panelHomePeriods",
    book: "panelBook",
    record: "panelRecord",
    categorySystem: "panelCategorySystem",
    fixedIncome: "panelFixedIncome",
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
    if (tab === "detail") {
      const position = currentTab !== "detail" && uiState.detailBrowsePosition;
      const restore = position && position.context === detailBrowseContext();
      if (restore) uiState.detailVisibleCount = position.visibleCount;
      refreshDetail({ preserveVisibleCount: Boolean(restore) });
      // 列表绘制完再恢复，避免短首页先把较深的位置截断。
      if (currentTab !== "detail") window.scrollTo(0, restore ? position.scrollTop : 0);
    }
  if (tab === "homePeriods") { renderDetailPeriodCards(); renderPeriodSummary(); }
  if (tab === "overview") {
    renderOverview();
    if (typeof renderReportPeriodControls === "function") renderReportPeriodControls();
    renderChart();
  }
  if (tab === "book") renderBookList();
  if (tab === "categorySystem" && typeof renderCategorySystem === "function") renderCategorySystem();
  if (tab === "fixedIncome" && typeof renderFixedIncomeSettings === "function") renderFixedIncomeSettings();
  if (tab === "budget" && typeof renderBudgetPage === "function") renderBudgetPage();
  if (tab === "investment" && typeof setFundView === "function" && currentTab !== "investment") setFundView("home");
  else if (tab === "investment" && typeof renderInvestmentPlans === "function") renderInvestmentPlans();
  document.querySelectorAll(".bottom-nav .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}
