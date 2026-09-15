// 统计图模块：根据当前筛选结果绘制收入、支出和综合图表。
// 筛选和金额计算由 filters.js 与 records.js 提供，图表选择状态保存在 uiState。

// ============ 统计图（按明细筛选，收入/支出/综合按类别） ============
function renderChartKindChips() {
  const box = document.getElementById("chartKindChips");
  box.innerHTML = "";
  ["支出", "收入", "综合"].forEach(k => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    const val = (k === "支出") ? "expense" : (k === "收入") ? "income" : "combined";
    if (uiState.chartKind === val) b.classList.add("selected");
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
  box.innerHTML = "";
  ["柱形", "扇形"].forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    if ((t === "柱形") === (uiState.chartType === "bar")) b.classList.add("selected");
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

// ============ 综合图：柱形（每类两根柱子：红=收入，绿=支出） ============
function renderCombinedBarChart(box, cats, incomeMap, expenseMap) {
  const W = 600, H = 280, padT = 30, padB = 34, padL = 8, padR = 8;
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
      svg += `<text x="${(xIn + barW / 2).toFixed(1)}" y="${(yIn - 5).toFixed(1)}" font-size="9" text-anchor="middle" fill="#C03A3A">${inc.toFixed(0)} · ${incPct.toFixed(0)}%</text>`;
    }
    if (exp > 0) {
      const yEx = padT + (chartH - hEx);
      svg += `<rect x="${xEx.toFixed(1)}" y="${yEx.toFixed(1)}" width="${barW}" height="${hEx.toFixed(1)}" rx="3" fill="#147D5A"/>`;
      svg += `<text x="${(xEx + barW / 2).toFixed(1)}" y="${(yEx - 5).toFixed(1)}" font-size="9" text-anchor="middle" fill="#147D5A">${exp.toFixed(0)} · ${expPct.toFixed(0)}%</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${H - padB + 16}" font-size="10" text-anchor="middle" fill="#6B7280">${esc(cat)}</text>`;
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
  const W = 600, H = 260, padT = 24, padB = 34, padL = 8, padR = 8;
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
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - padB + 16}" font-size="11" text-anchor="middle" fill="#6B7280">${esc(cat)}</text>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="10" text-anchor="middle" fill="#1E2227">${amt.toFixed(0)} · ${pct.toFixed(0)}%</text>`;
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
