// 跨账本总览模块：读取各账本的快照并显示净资产与本月收支。
// 当前账本 ID 由 state.js 提供，账目和账户数据仍由存储层加载。

// 读某个账本的账目 / 账户（不动当前内存里的数据）
function readBookRecords(id) {
  try {
    const raw = appStorage.get(recordsKey(id));
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function readBookAccounts(id) {
  try {
    const raw = appStorage.get(accountsKey(id));
    let accs = raw ? normalizeAccounts(JSON.parse(raw)) : null;
    if (!accs || accs.length === 0) accs = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    return accs;
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)); }
}

function renderOverview() {
  const box = document.getElementById("overviewList");
  const totalBox = document.getElementById("overviewTotal");
  box.innerHTML = "";
  if (dataState.books.length === 0) {
    box.innerHTML = '<div class="empty small">还没有账本</div>';
    totalBox.style.display = "none";
    return;
  }
  if (dataState.backendOverview) {
    renderBackendOverview(box, totalBox);
    return;
  }
  let totalNet = 0;
  dataState.books.forEach(b => {
    const recs = readBookRecords(b.id);
    const accs = readBookAccounts(b.id);
    const bal = computeBalancesFor(accs, recs);
    let net = 0;
    accs.forEach(a => { net += (a.kind === "负债") ? -bal[a.id] : bal[a.id]; });
    totalNet += net;
    const month = recs.filter(r => isThisMonth(r.date));
    const income = month.reduce((s, r) => s + incomeEffect(r), 0);
    const expense = month.reduce((s, r) => s + expenseEffect(r), 0);

    const row = document.createElement("div");
    row.className = "acc-row";
    row.innerHTML = `
      <div class="acc-main">
        <div>
          <span class="acc-name">${esc(b.name)}</span>
          <span class="acc-kind">${esc(b.category)}</span>
          ${b.id === dataState.currentBookId ? '<span class="acc-kind">当前</span>' : ''}
        </div>
        <div class="acc-init">本月 <span class="ov-income">${income < 0 ? "−¥" : "+¥"}${Math.abs(income).toFixed(2)}</span> · <span class="ov-expense">${expense < 0 ? "+¥" : "−¥"}${Math.abs(expense).toFixed(2)}</span></div>
      </div>
      <div class="acc-balance ${net < 0 ? "neg" : ""}">${net < 0 ? "−¥" : "¥"}${Math.abs(net).toFixed(2)}</div>
    `;
    box.appendChild(row);
  });
  totalBox.style.display = "block";
  totalBox.innerHTML = `<span class="label">全部账本净资产合计</span><span class="value">${totalNet < 0 ? "−¥" : "¥"}${Math.abs(totalNet).toFixed(2)}</span>`;
}

function renderBackendOverview(box, totalBox) {
  const byId = new Map(dataState.backendOverview.items.map(item => [String(item.id), item]));
  dataState.books.forEach(book => {
    const summary = byId.get(String(book.id));
    if (!summary) return;
    const income = summary.income;
    const expense = summary.expense;
    const net = summary.netWorth;
    const row = document.createElement("div");
    row.className = "acc-row";
    row.innerHTML = `
      <div class="acc-main">
        <div>
          <span class="acc-name">${esc(book.name)}</span>
          <span class="acc-kind">${esc(book.category)}</span>
          ${String(book.id) === String(dataState.currentBookId) ? '<span class="acc-kind">当前</span>' : ''}
        </div>
        <div class="acc-init">本期 <span class="ov-income">${income < 0 ? "−¥" : "+¥"}${Math.abs(income).toFixed(2)}</span> · <span class="ov-expense">${expense < 0 ? "+¥" : "−¥"}${Math.abs(expense).toFixed(2)}</span></div>
      </div>
      <div class="acc-balance ${net < 0 ? "neg" : ""}">${net < 0 ? "−¥" : "¥"}${Math.abs(net).toFixed(2)}</div>
    `;
    box.appendChild(row);
  });
  const totalNet = dataState.backendOverview.totals.netWorth;
  totalBox.style.display = "block";
  totalBox.innerHTML = `<span class="label">全部账本净资产合计</span><span class="value">${totalNet < 0 ? "−¥" : "¥"}${Math.abs(totalNet).toFixed(2)}</span>`;
}
