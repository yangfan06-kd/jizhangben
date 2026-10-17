// 统计图模块：根据报表独立选择的时期绘制分类收入、支出与综合图表。
// 报表日期与分类聚合由 report-period.js 提供，金额规则复用 records.js。

// ============ 报表（独立时期，收入/支出/综合按类别） ============
function renderChartKindChips() {
  const box = document.getElementById("chartKindChips");
  if (!box) return;
  box.innerHTML = "";
  box.setAttribute("aria-label", "图表收支范围");
  ["支出", "收入", "综合"].forEach(k => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    const val = (k === "支出") ? "expense" : (k === "收入") ? "income" : "combined";
    if (uiState.chartKind === val) b.classList.add("selected");
    b.setAttribute("aria-pressed", uiState.chartKind === val ? "true" : "false");
    b.setAttribute("aria-label", "按" + k + "查看统计图");
    b.textContent = k;
    b.onclick = () => {
      uiState.chartKind = val;
      renderChartKindChips();
      renderChart();
    };
    box.appendChild(b);
  });
}

function renderChartTypeChips() {
  const box = document.getElementById("chartTypeChips");
  if (!box) return;
  box.innerHTML = "";
  box.setAttribute("aria-label", "图表样式");
  ["柱形", "扇形"].forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    const selected = (t === "柱形") === (uiState.chartType === "bar");
    if (selected) b.classList.add("selected");
    b.setAttribute("aria-pressed", selected ? "true" : "false");
    b.setAttribute("aria-label", "使用" + t + "图");
    b.textContent = t;
    b.onclick = () => {
      uiState.chartType = (t === "柱形") ? "bar" : "pie";
      renderChartTypeChips();
      renderChart();
    };
    box.appendChild(b);
  });
}

function renderChart() {
  const box = document.getElementById("chartBox");
  if (!box) return;
  const records = reportRecords();
  const summary = aggregateReportCategories(records);
  const scope = document.getElementById("overviewChartScope");
  if (scope) {
    const book = dataState.books.find(item => String(item.id) === String(dataState.currentBookId));
    const bounds = reportPeriodBounds();
    scope.textContent = (book ? book.name : "当前账本") + " · " + (bounds ? bounds.start + " 至 " + bounds.end : "全部日期");
  }
  const totals = document.getElementById("reportPeriodTotals");
  if (totals) totals.innerHTML = '<div><span>期间支出</span><strong class="expense">' + reportMoney(summary.expenseCents / 100) + '</strong></div>' +
    '<div><span>期间收入</span><strong class="income">' + reportMoney(summary.incomeCents / 100) + '</strong></div>';

  if (uiState.chartKind === "combined") {
    const incomeMap = {}, expenseMap = {};
    summary.categories.forEach(item => {
      if (item.incomeCents) incomeMap[item.category] = item.incomeCents / 100;
      if (item.expenseCents) expenseMap[item.category] = item.expenseCents / 100;
    });
    const cats = summary.categories.slice().sort((a, b) =>
      Math.abs(b.incomeCents) + Math.abs(b.expenseCents) - Math.abs(a.incomeCents) - Math.abs(a.expenseCents)
    ).map(item => item.category);
    if (!cats.length) {
      box.innerHTML = '<div class="empty small">这个时期还没有收入或支出</div>';
      return;
    }
    if (uiState.chartType === "bar") renderCombinedBarChart(box, cats, incomeMap, expenseMap);
    else renderCombinedPieChart(box, cats, incomeMap, expenseMap);
    return;
  }
  const income = uiState.chartKind === "income";
  const entries = summary.categories.map(item => [item.category, (income ? item.incomeCents : item.expenseCents) / 100])
    .filter(([, amount]) => amount !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!entries.length) {
    box.innerHTML = '<div class="empty small">这个时期还没有' + (income ? '收入' : '支出') + '</div>';
    return;
  }
  if (uiState.chartType === "bar") renderBarChart(box, entries);
  else {
    const positive = entries.filter(([, amount]) => amount > 0);
    if (!positive.length) {
      box.innerHTML = '<div class="empty small">只有负金额，扇形图无法表示；请切换柱形图查看</div>';
      return;
    }
    renderPieChart(box, positive, positive.reduce((sum, [, amount]) => sum + amount, 0));
    if (entries.some(([, amount]) => amount < 0)) box.insertAdjacentHTML("beforeend", '<p class="chart-note">负金额已计入期间合计；扇形图仅显示正值，柱形图可查看全部金额。</p>');
  }
}

function reportMoney(amount) {
  return (amount < 0 ? "−¥" : "¥") + Math.abs(amount).toFixed(2);
}

// 金额和占比用 HTML 排版，避免 SVG 缩放把文字压小。
function reportBarMeasure(kind, amount, total, scale, signed) {
  const label = kind === "income" ? "收入" : "支出";
  const percentage = !signed && total > 0 ? Math.max(0, amount / total * 100) : null;
  const ratio = percentage === null ? "不计占比" : (percentage > 0 && percentage < 0.1 ? "＜0.1%" : percentage.toFixed(1) + "%");
  const width = Math.min(100, signed ? (scale ? Math.abs(amount) / scale * 50 : 0) : percentage || 0);
  return '<div class="report-bar-figures"><span class="report-bar-type kind-' + kind + '">' + label + '</span>' +
    '<strong class="report-bar-value">' + reportMoney(amount) + '</strong><span class="report-bar-ratio">' + ratio + '</span></div>' +
    '<div class="report-bar-track' + (signed ? ' signed' : '') + '" aria-hidden="true"><span class="report-bar-fill kind-' + kind + (amount < 0 ? ' negative' : ' positive') + '" style="width:' + width.toFixed(4) + '%"></span></div>';
}

// 保留首日和当天，用最多四个均匀刻度给小屏日期留出空间。
function homeTrendDateIndices(days) {
  if (!Number.isInteger(days) || days < 1) return [];
  const count = Math.min(days, 4);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round(index * (days - 1) / (count - 1)));
}

// 首页本月按日显示收入、支出的趋势，金额取实际收支口径，借贷和账户转账保持中性。
function renderHomeTrendChart() {
  const box = document.getElementById("homeTrendChart");
  if (!box) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = now.getDate();
  const income = Array(days).fill(0);
  const expense = Array(days).fill(0);
  dataState.records.forEach(record => {
    const date = parseLocalDate(record.date);
    if (!date || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() > days) return;
    const index = date.getDate() - 1;
    const inc = incomeEffect(record);
    const exp = expenseEffect(record);
    if (inc !== 0) income[index] += inc;
    if (exp > 0) expense[index] += exp;
  });
  if (!income.some(value => value !== 0) && !expense.some(value => value !== 0)) {
    box.innerHTML = '<div class="empty small">本月还没有收入或支出</div>';
    return;
  }
  // 图表在手机上会缩放；为可读的刻度文字预留空间，不改变折线数据。
  const W = 680, H = 300, padL = 100, padR = 32, padT = 26, padB = 48;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(0, ...income, ...expense);
  const min = Math.min(0, ...income, ...expense);
  const range = max - min || 1;
  const x = index => padL + (days === 1 ? chartW / 2 : (index / (days - 1)) * chartW);
  const y = value => padT + (max - value) / range * chartH;
  const points = values => values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  let svg = `<svg class="home-trend-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="本月每日收入和支出趋势">`;
  [...new Set(min < 0 ? [min, 0, max] : [0, max / 2, max])].forEach(level => {
    const gy = y(level);
    const absolute = Math.abs(level);
    const number = absolute >= 100000000 ? (absolute / 100000000).toFixed(1) + "亿" : absolute >= 10000 ? (absolute / 10000).toFixed(1) + "万" : absolute.toFixed(0);
    const label = (level < 0 ? "−¥" : "¥") + number;
    svg += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="#E7EAF0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${(gy + 8).toFixed(1)}" text-anchor="end" font-size="26" fill="#626B69">${label}</text>`;
  });
  svg += `<polyline points="${points(income)}" fill="none" stroke="#C03A3A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<polyline points="${points(expense)}" fill="none" stroke="#2F8F83" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  homeTrendDateIndices(days).forEach(index => {
    const anchor = days === 1 ? "middle" : index === 0 ? "start" : index === days - 1 ? "end" : "middle";
    svg += `<text class="home-trend-date" x="${x(index).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" font-size="26" fill="#626B69">${index + 1}日</text>`;
  });
  svg += `</svg>`;
  box.innerHTML = `<div class="home-trend-legend"><span><i style="background:#C03A3A"></i>收入</span><span><i style="background:#2F8F83"></i>支出</span><span class="home-trend-month">${year}年${month + 1}月</span></div>${svg}`;
}

// ============ 综合图：柱形（仅显示该类别非零的收支方向） ============
function renderCombinedBarChart(box, cats, incomeMap, expenseMap) {
  const visibleCats = cats.filter(category => (incomeMap[category] || 0) !== 0 || (expenseMap[category] || 0) !== 0);
  if (!visibleCats.length) {
    box.innerHTML = '<div class="empty small">这个时期还没有收入或支出</div>';
    return;
  }
  const incomeValues = Object.values(incomeMap), expenseValues = Object.values(expenseMap);
  const incomeSigned = incomeValues.some(amount => amount < 0), expenseSigned = expenseValues.some(amount => amount < 0);
  const incomeTotal = incomeValues.reduce((sum, amount) => sum + amount, 0);
  const expenseTotal = expenseValues.reduce((sum, amount) => sum + amount, 0);
  const incomeScale = Math.max(0, ...incomeValues.map(Math.abs));
  const expenseScale = Math.max(0, ...expenseValues.map(Math.abs));
  box.innerHTML = '<ol class="report-bar-list">' + visibleCats.map((category, index) =>
    '<li class="report-bar-item"><div class="report-bar-category"><span class="report-bar-rank">' + (index + 1) + '</span>' + esc(category) + '</div>' +
    ((expenseMap[category] || 0) !== 0 ? reportBarMeasure("expense", expenseMap[category], expenseTotal, expenseScale, expenseSigned) : "") +
    ((incomeMap[category] || 0) !== 0 ? reportBarMeasure("income", incomeMap[category], incomeTotal, incomeScale, incomeSigned) : "") + '</li>'
  ).join("") + '</ol><p class="chart-note">收入、支出占比分别按各自合计计算。' +
    (incomeSigned || expenseSigned ? '含负金额的一侧不计算占比，正负金额以中线区分。' : '') + '</p>';
}

// ============ 综合图：扇形（分类多色，图例明确标注收支方向） ============
function renderCombinedPieChart(box, cats, incomeMap, expenseMap) {
  const entries = [];
  Object.keys(incomeMap).forEach(cat => {
    const amt = incomeMap[cat];
    if (amt > 0) entries.push({ cat, amt, kind: "income" });
  });
  Object.keys(expenseMap).forEach(cat => {
    const amt = expenseMap[cat];
    if (amt > 0) entries.push({ cat, amt, kind: "expense" });
  });

  if (!entries.length) {
    box.innerHTML = '<div class="empty small">只有负金额，扇形图无法表示；请切换柱形图查看</div>';
    return;
  }

  const total = entries.reduce((s, e) => s + e.amt, 0);
  renderReportPie(box, entries, total);
  if ([...Object.values(incomeMap), ...Object.values(expenseMap)].some(amount => amount < 0)) box.insertAdjacentHTML("beforeend", '<p class="chart-note">负金额已计入期间合计；扇形图仅显示正值，柱形图可查看全部金额。</p>');
}

// 色块与图例使用同一配色，占比文字留在图例中，保持图面简洁。
function reportPiePercentage(fraction) {
  return fraction > 0 && fraction < 0.001 ? "＜0.1%" : (fraction * 100).toFixed(1) + "%";
}

function renderReportPie(box, entries, total) {
  const cx = 100, cy = 100, r = 88;
  let angle = -Math.PI / 2;
  let slices = "";
  entries.forEach((e, index) => {
    const color = REPORT_PIE_COLORS[index % REPORT_PIE_COLORS.length];
    const frac = total ? e.amt / total : 0;
    const end = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = frac > 0.5 ? 1 : 0;
    const title = esc((e.kind === "income" ? "收入·" : "支出·") + e.cat + " " + reportMoney(e.amt) + " · " + reportPiePercentage(frac));
    slices += frac >= 1
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"><title>${title}</title></circle>`
      // 同色亚像素描边消除相邻 SVG 扇区的抗锯齿亮缝，不绘制分隔边框。
      : `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" stroke="${color}" stroke-width="0.35" stroke-linejoin="round"><title>${title}</title></path>`;
    angle = end;
  });

  const legend = entries.map((e, index) => {
    const color = REPORT_PIE_COLORS[index % REPORT_PIE_COLORS.length];
    const ratio = reportPiePercentage(total ? e.amt / total : 0);
    return `<div class="chart-legend-item"><span class="dot" style="background:${color}"></span><span>${e.kind === "income" ? "收入·" : "支出·"}${esc(e.cat)} ¥${e.amt.toFixed(2)} · ${ratio}</span></div>`;
  }).join("");

  box.innerHTML = `
    <div class="report-pie-layout">
      <svg viewBox="0 0 200 200" width="160" height="160" role="img" aria-label="分类占比扇形图，颜色对应下方图例" xmlns="http://www.w3.org/2000/svg">${slices}</svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

function renderBarChart(box, entries) {
  const kind = uiState.chartKind === "income" ? "income" : "expense";
  const signed = entries.some(([, amount]) => amount < 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  const scale = Math.max(0, ...entries.map(([, amount]) => Math.abs(amount)));
  box.innerHTML = '<ol class="report-bar-list">' + entries.map(([category, amount], index) =>
    '<li class="report-bar-item"><div class="report-bar-category"><span class="report-bar-rank">' + (index + 1) + '</span>' + esc(category) + '</div>' +
    reportBarMeasure(kind, amount, total, scale, signed) + '</li>'
  ).join("") + '</ol>' + (signed ? '<p class="chart-note">负金额已计入期间合计；含负金额时不计算占比，正负金额以中线区分。</p>' : '');
}

function renderPieChart(box, entries, total) {
  renderReportPie(box, entries.map(([cat, amt]) => ({cat, amt, kind: uiState.chartKind === "income" ? "income" : "expense"})), total);
}
