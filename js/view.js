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

  // 净资产 = 所有资金账户余额 − 所有负债账户欠款
  const bal = computeBalances();
  let net = 0;
  dataState.accounts.forEach(a => { net += (a.kind === "负债") ? -bal[a.id] : bal[a.id]; });
  document.getElementById("netWorth").textContent =
    (net < 0 ? "−¥" : "¥") + Math.abs(net).toFixed(2);
}

// 所选阶段的汇总：总收入 / 总支出 / 新增负债
function renderPeriodSummary() {
  const box = document.getElementById("periodSummary");
  const shown = filteredRecords();
  const income = shown.reduce((s, r) => s + incomeEffect(r), 0);
  const expense = shown.reduce((s, r) => s + expenseEffect(r), 0);
  // 新增负债 = 支出侧的钱进出负债账户（付押金用花呗算新增，退回算减少）
  const debt = shown.reduce((s, r) => {
    const e = expenseEffect(r);
    return (e !== 0 && isLiabAccount(r.account)) ? s + e : s;
  }, 0);
  const incomeText = (income < 0 ? "−¥" : "+¥") + Math.abs(income).toFixed(2);
  const expenseText = (expense < 0 ? "+¥" : "−¥") + Math.abs(expense).toFixed(2);
  const debtText = (debt < 0 ? "−¥" : "¥") + Math.abs(debt).toFixed(2);

  box.innerHTML = `
    <div class="period-stat">
      <div class="label">总收入</div>
      <div class="value income">${incomeText}</div>
    </div>
    <div class="period-stat">
      <div class="label">总支出</div>
      <div class="value expense">${expenseText}</div>
    </div>
    <div class="period-stat">
      <div class="label">新增负债</div>
      <div class="value debt">${debtText}</div>
    </div>
  `;
}

// ============ 渲染：明细列表 ============
function renderList() {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  const toggle = document.getElementById("detailToggle");
  const wrap = document.getElementById("listWrap");
  list.innerHTML = "";

  // 先按时间段筛选，再按搜索关键字筛选
  const shown = filterByPeriod(dataState.records);
  const filtered = shown.filter(matchesSearch);

  // 没有任何账目时，只提示，不显示“展开”按钮
  if (dataState.records.length === 0) {
    toggle.style.display = "none";
    wrap.style.display = "block";
    empty.style.display = "block";
    empty.textContent = "还没有账目，先记一笔吧";
    return;
  }
  // 有账目：默认收起，点按钮才展开
  toggle.style.display = "inline-block";
  toggle.textContent = uiState.detailExpanded
    ? "▴ 收起明细"
    : "▾ 展开明细（共 " + filtered.length + " 笔）";
  wrap.style.display = uiState.detailExpanded ? "block" : "none";
  if (!uiState.detailExpanded) return;

  if (shown.length === 0) {
    empty.style.display = "block";
    empty.textContent = "这个时间段没有账目";
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
      const badgeText = isDep ? depositLabel(r.depositDir) : r.type;
      const badgeCls = isIncome(r) ? "income" : isExpense(r) ? "expense" : "";
      let accLabel = accountName(r.account);
      if (r.type === "转账" && r.toAccount) {
        accLabel = accountName(r.account) + " → " + accountName(r.toAccount);
      }
      const accHtml = r.account ? `<div class="row-date">${esc(accLabel)}</div>` : "";
      // 押金显示“对象”，备注跟在后面
      let noteText = r.note || "";
      if (isDep && r.depositTarget) {
        noteText = "对象：" + r.depositTarget + (noteText ? " · " + noteText : "");
      }
      if (isDep && r.depositFinal) {
        const settlement = depositSettlementInfo(r, r.id);
        if (settlement.difference > 0) {
          noteText += (noteText ? " · " : "") + "结算差额 ¥" + settlement.difference.toFixed(2) + (settlement.expense > 0 ? "计支出" : "计收入");
        }
      }

      row.innerHTML = `
        <div class="row-main">
          <div class="row-top">
            <span class="badge ${badgeCls}">${esc(badgeText)}</span>
            <span class="row-cat">${esc(r.category)}</span>
          </div>
          <div class="row-note">${esc(noteText)}</div>
          ${accHtml}
        </div>
        <div class="row-amount ${amt.cls}">${amt.text}</div>
        <div class="row-actions">
          <button class="mini-btn" data-id="${r.id}" data-act="edit">改</button>
          <button class="mini-btn danger" data-id="${r.id}" data-act="del">删</button>
        </div>
      `;
      list.appendChild(row);
    });
  });

  // 给“改”“删”按钮绑事件
  list.querySelectorAll(".mini-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "edit") startEdit(id);
      else deleteRec(id);
    };
  });
}

// ============ 渲染：账户列表 ============
function renderAccountList() {
  const box = document.getElementById("accountList");
  box.innerHTML = "";
  const bal = computeBalances();

  ["资金", "负债"].forEach(kind => {
    const group = dataState.accounts.filter(a => a.kind === kind);
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
          <button class="mini-btn" data-id="${a.id}" data-act="edit">改</button>
          <button class="mini-btn danger" data-id="${a.id}" data-act="del">删</button>
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
}

// 筛选变化时，刷新明细列表 + 汇总 + 统计图
function refreshDetail() {
  renderList();
  renderPeriodSummary();
  renderChart();
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
  renderList();
  renderAccountList();
  renderAccountSelects();
  renderChartKindChips();
  renderChartTypeChips();
  renderChart();
  renderOverview();
}

// 切换大类（记一笔 / 账户 / 明细），一次只显示一个
function switchTab(tab) {
  uiState.activeTab = tab;
  document.getElementById("panelBook").style.display = "none";
  document.getElementById("panelRecord").style.display = (tab === "record") ? "block" : "none";
  document.getElementById("panelAccount").style.display = (tab === "account") ? "block" : "none";
  document.getElementById("panelDetail").style.display = (tab === "detail") ? "block" : "none";
  document.getElementById("panelOverview").style.display = (tab === "overview") ? "block" : "none";
  if (tab === "overview") renderOverview();
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
