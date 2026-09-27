// 统计图模块：根据当前筛选结果绘制收入、支出和综合图表。
// 筛选和金额计算由 filters.js 与 records.js 提供，图表选择状态保存在 uiState。

// ============ 统计图（按明细筛选，收入/支出/综合按类别） ============
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

  // 综合：收入 + 支出两种颜色一起显示
  if (uiState.chartKind === "combined") {
    const shown = filteredRecords();
    const incomeMap = {}, expenseMap = {};
    shown.forEach(r => {
      const eff = incomeEffect(r);
      if (eff > 0) incomeMap[r.category] = (incomeMap[r.category] || 0) + eff;
      else if (expenseEffect(r) > 0) expenseMap[r.category] = (expenseMap[r.category] || 0) + expenseEffect(r);
    });
    const cats = Array.from(new Set([...Object.keys(incomeMap), ...Object.keys(expenseMap)]));
    if (cats.length === 0) {
      box.innerHTML = '<div class="empty small">这个筛选条件下没有收入和支出，画不出图</div>';
      return;
    }
    if (uiState.chartType === "bar") renderCombinedBarChart(box, cats, incomeMap, expenseMap);
    else renderCombinedPieChart(box, cats, incomeMap, expenseMap);
    return;
  }

  const targetType = (uiState.chartKind === "income") ? "收入" : "支出";
  const shown = filteredRecords().filter(r =>
    uiState.chartKind === "income" ? (incomeEffect(r) > 0) : (expenseEffect(r) > 0)
  );
  const map = {};
  shown.forEach(r => { map[r.category] = (map[r.category] || 0) + (uiState.chartKind === "income" ? incomeEffect(r) : expenseEffect(r)); });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);

  if (entries.length === 0) {
    box.innerHTML = '<div class="empty small">这个筛选条件下没有' + targetType + '，画不出图</div>';
    return;
  }
  if (uiState.chartType === "bar") renderBarChart(box, entries);
  else renderPieChart(box, entries, total);
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
    if (inc > 0) income[index] += inc;
    if (exp > 0) expense[index] += exp;
  });
  const total = income.reduce((sum, value) => sum + value, 0) + expense.reduce((sum, value) => sum + value, 0);
  if (!total) {
    box.innerHTML = '<div class="empty small">本月还没有收入或支出</div>';
    return;
  }
  const W = 680, H = 250, padL = 42, padR = 14, padT = 26, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(...income, ...expense, 1);
  const x = index => padL + (days === 1 ? chartW / 2 : (index / (days - 1)) * chartW);
  const y = value => padT + chartH - (value / max) * chartH;
  const points = values => values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  let svg = `<svg class="home-trend-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="本月每日收入和支出趋势">`;
  [0, 0.5, 1].forEach(level => {
    const gy = padT + chartH * (1 - level);
    const label = (max * level).toFixed(0);
    svg += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="#E7EAF0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#8A93A1">¥${label}</text>`;
  });
  svg += `<polyline points="${points(income)}" fill="none" stroke="#C03A3A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<polyline points="${points(expense)}" fill="none" stroke="#2F8F83" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const labelStep = days > 14 ? 5 : 2;
  for (let index = 0; index < days; index += labelStep) {
    svg += `<text x="${x(index).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#8A93A1">${index + 1}日</text>`;
  }
  if ((days - 1) % labelStep !== 0) svg += `<text x="${x(days - 1).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#8A93A1">${days}日</text>`;
  svg += `</svg>`;
  box.innerHTML = `<div class="home-trend-legend"><span><i style="background:#C03A3A"></i>收入</span><span><i style="background:#2F8F83"></i>支出</span><span class="home-trend-month">${year}年${month + 1}月</span></div>${svg}`;
}

// ============ 综合图：柱形（每类两根柱子：红=收入，绿=支出） ============
function renderCombinedBarChart(box, cats, incomeMap, expenseMap) {
  const W = 640, H = 310, padT = 38, padB = 50, padL = 8, padR = 8;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const max = Math.max(
    ...Object.values(incomeMap),
    ...Object.values(expenseMap),
    0
  );
  const n = cats.length;
  const slot = chartW / n;
  const barW = Math.min(22, slot * 0.28);
  const gap = 4;
  const incTotal = Object.values(incomeMap).reduce((s, v) => s + v, 0);
  const expTotal = Object.values(expenseMap).reduce((s, v) => s + v, 0);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">`;
  cats.forEach((cat, i) => {
    const inc = incomeMap[cat] || 0;
    const exp = expenseMap[cat] || 0;
    const cx = padL + slot * i + slot / 2;
    const hIn = max ? (inc / max) * chartH : 0;
    const hEx = max ? (exp / max) * chartH : 0;
    const xIn = cx - barW - gap / 2;
    const xEx = cx + gap / 2;
    const incPct = incTotal ? (inc / incTotal * 100) : 0;
    const expPct = expTotal ? (exp / expTotal * 100) : 0;
    if (inc > 0) {
      const yIn = padT + (chartH - hIn);
      svg += `<rect x="${xIn.toFixed(1)}" y="${yIn.toFixed(1)}" width="${barW}" height="${hIn.toFixed(1)}" rx="3" fill="#C03A3A"/>`;
      svg += `<text x="${(xIn + barW / 2).toFixed(1)}" y="${(yIn - 7).toFixed(1)}" font-size="12" font-weight="600" text-anchor="middle" fill="#C03A3A">${inc.toFixed(0)} · ${incPct.toFixed(0)}%</text>`;
    }
    if (exp > 0) {
      const yEx = padT + (chartH - hEx);
      svg += `<rect x="${xEx.toFixed(1)}" y="${yEx.toFixed(1)}" width="${barW}" height="${hEx.toFixed(1)}" rx="3" fill="#147D5A"/>`;
      svg += `<text x="${(xEx + barW / 2).toFixed(1)}" y="${(yEx - 7).toFixed(1)}" font-size="12" font-weight="600" text-anchor="middle" fill="#147D5A">${exp.toFixed(0)} · ${expPct.toFixed(0)}%</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${H - padB + 19}" font-size="13" text-anchor="middle" fill="#6B7280">${esc(cat)}</text>`;
  });
  svg += `</svg>`;

  const legend = `<div class="chart-legend" style="margin-bottom:8px;">
    <div class="chart-legend-item"><span class="dot" style="background:#C03A3A"></span>收入</div>
    <div class="chart-legend-item"><span class="dot" style="background:#147D5A"></span>支出</div>
  </div>`;

  box.innerHTML = legend + svg;
}

// ============ 综合图：扇形（单饼：收入红色系、支出绿色系，混在一起 + 图例） ============
function renderCombinedPieChart(box, cats, incomeMap, expenseMap) {
  const entries = [];
  let incIdx = 0, expIdx = 0;
  Object.keys(incomeMap).forEach(cat => {
    const amt = incomeMap[cat];
    if (amt > 0) entries.push({ cat, amt, kind: "income", color: INCOME_COLORS[incIdx++ % INCOME_COLORS.length] });
  });
  Object.keys(expenseMap).forEach(cat => {
    const amt = expenseMap[cat];
    if (amt > 0) entries.push({ cat, amt, kind: "expense", color: EXPENSE_COLORS[expIdx++ % EXPENSE_COLORS.length] });
  });

  const total = entries.reduce((s, e) => s + e.amt, 0);
  const cx = 100, cy = 100, r = 88;
  let angle = -Math.PI / 2;
  let slices = "";
  entries.forEach(e => {
    const frac = total ? e.amt / total : 0;
    const end = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = frac > 0.5 ? 1 : 0;
    slices += `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${e.color}"/>`;
    angle = end;
  });

  const legend = entries.map(e => {
    const pct = total ? (e.amt / total * 100) : 0;
    return `<div class="chart-legend-item"><span class="dot" style="background:${e.color}"></span>${e.kind === "income" ? "收入·" : "支出·"}${esc(e.cat)} ¥${e.amt.toFixed(2)} · ${pct.toFixed(1)}%</div>`;
  }).join("");

  box.innerHTML = `
    <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      <svg viewBox="0 0 200 200" width="160" height="160" xmlns="http://www.w3.org/2000/svg">${slices}</svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

function renderBarChart(box, entries) {
  const W = 640, H = 290, padT = 34, padB = 50, padL = 8, padR = 8;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const max = entries[0][1];
  const total = entries.reduce((s, e) => s + e[1], 0);
  const n = entries.length;
  const slot = chartW / n;
  const barW = Math.min(48, slot * 0.6);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">`;
  entries.forEach(([cat, amt], i) => {
    const h = max ? (amt / max) * chartH : 0;
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + (chartH - h);
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pct = total ? (amt / total * 100) : 0;
    svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="4" fill="${color}"/>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - padB + 19}" font-size="13" text-anchor="middle" fill="#6B7280">${esc(cat)}</text>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="12" font-weight="600" text-anchor="middle" fill="#1E2227">${amt.toFixed(0)} · ${pct.toFixed(0)}%</text>`;
  });
  svg += `</svg>`;
  box.innerHTML = svg;
}

function renderPieChart(box, entries, total) {
  const cx = 100, cy = 100, r = 88;
  let angle = -Math.PI / 2;
  let slices = "";
  entries.forEach(([cat, amt], i) => {
    const frac = total ? amt / total : 0;
    const end = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = frac > 0.5 ? 1 : 0;
    slices += `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
    angle = end;
  });
  const legend = entries.map(([cat, amt], i) => {
    const pct = total ? (amt / total * 100) : 0;
    return `<div class="chart-legend-item"><span class="dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${esc(cat)} ¥${amt.toFixed(2)} · ${pct.toFixed(1)}%</div>`;
  }).join("");

  box.innerHTML = `
    <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      <svg viewBox="0 0 200 200" width="160" height="160" xmlns="http://www.w3.org/2000/svg">${slices}</svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}
