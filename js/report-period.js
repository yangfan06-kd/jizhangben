// 报表日期与分类汇总：读取原流水，复用既有收支规则，不写入账本。
function reportPeriodBounds(state = reportState, referenceDate = todayStr()) {
  if (state.periodMode === "all") return null;
  if (state.periodMode === "today" || state.periodMode === "week") {
    return detailPeriodBounds(state.periodMode, referenceDate);
  }
  let start, end;
  if (state.periodMode === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(state.month)) throw new Error("请选择有效的月份");
    start = state.month + "-01";
    const date = parseLocalDate(start);
    if (!date) throw new Error("请选择有效的月份");
    end = state.month + "-" + String(new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()).padStart(2, "0");
  } else if (state.periodMode === "year") {
    if (!/^\d{4}$/.test(String(state.year))) throw new Error("请输入四位年份");
    start = state.year + "-01-01";
    end = state.year + "-12-31";
  } else if (state.periodMode === "range") {
    start = state.fromDate;
    end = state.toDate;
  } else {
    throw new Error("请选择查看时期");
  }
  if (!parseLocalDate(start) || !parseLocalDate(end)) throw new Error("请填写有效的开始和结束日期");
  if (start > end) throw new Error("开始日期不能晚于结束日期");
  return { start, end };
}

function reportRecords(records = dataState.records, state = reportState, referenceDate = todayStr()) {
  const bounds = reportPeriodBounds(state, referenceDate);
  return bounds ? records.filter(record => record.date >= bounds.start && record.date <= bounds.end) : records.slice();
}

function aggregateReportCategories(records) {
  const categories = new Map();
  let incomeCents = 0, expenseCents = 0;
  records.forEach(record => {
    const income = toCents(incomeEffect(record));
    const expense = toCents(expenseEffect(record));
    incomeCents += income;
    expenseCents += expense;
    if (!income && !expense) return;
    const name = record.category || "未分类";
    const item = categories.get(name) || { category: name, incomeCents: 0, expenseCents: 0 };
    item.incomeCents += income;
    item.expenseCents += expense;
    categories.set(name, item);
  });
  return {
    incomeCents, expenseCents,
    categories: Array.from(categories.values()).filter(item => item.incomeCents || item.expenseCents)
  };
}

function renderReportPeriodControls() {
  const select = document.getElementById("reportPeriodMode");
  if (!select) return;
  select.value = reportState.periodMode;
  renderCompactFilterPicker("reportPeriodMode", "reportPeriodPickerBtn", "reportPeriodPickerMenu", "查看时期");
  document.getElementById("reportMonthField").hidden = reportState.periodMode !== "month";
  document.getElementById("reportYearField").hidden = reportState.periodMode !== "year";
  document.getElementById("reportRangeFields").hidden = reportState.periodMode !== "range";
  document.getElementById("reportMonthInput").value = reportState.month;
  document.getElementById("reportYearInput").value = reportState.year;
  document.getElementById("reportFromDate").value = reportState.fromDate;
  document.getElementById("reportToDate").value = reportState.toDate;
  ["reportPrevBtn", "reportNextBtn"].forEach((id, index) => {
    const button = document.getElementById(id);
    button.hidden = !["month", "year"].includes(reportState.periodMode);
    button.setAttribute("aria-label", (index ? "下一" : "上一") + (reportState.periodMode === "year" ? "年份" : "月份"));
  });
}

function updateReportPeriod(patch) {
  const next = Object.assign({}, reportState, patch);
  const message = document.getElementById("reportPeriodMsg");
  try {
    reportPeriodBounds(next);
  } catch (error) {
    if (message) message.textContent = error.message;
    return false;
  }
  Object.assign(reportState, next);
  if (message) message.textContent = "";
  renderReportPeriodControls();
  renderChart();
  return true;
}

function moveReportPeriod(step) {
  if (reportState.periodMode === "year") {
    return updateReportPeriod({ year: String(Number(reportState.year) + step) });
  }
  const date = parseLocalDate(reportState.month + "-01");
  if (!date) return false;
  date.setMonth(date.getMonth() + step);
  return updateReportPeriod({ month: String(date.getFullYear()).padStart(4, "0") + "-" + String(date.getMonth() + 1).padStart(2, "0") });
}

function bindReportPeriodEvents() {
  const select = document.getElementById("reportPeriodMode");
  if (!select) return;
  document.getElementById("reportPeriodPickerBtn").onclick = () => toggleCompactPicker("reportPeriodPickerBtn", "reportPeriodPickerMenu");
  select.onchange = event => updateReportPeriod({ periodMode: event.target.value });
  document.getElementById("reportMonthInput").onchange = event => updateReportPeriod({ month: event.target.value });
  document.getElementById("reportYearInput").onchange = event => updateReportPeriod({ year: event.target.value });
  document.getElementById("reportPrevBtn").onclick = () => moveReportPeriod(-1);
  document.getElementById("reportNextBtn").onclick = () => moveReportPeriod(1);
  document.getElementById("reportThisMonthBtn").onclick = () => updateReportPeriod({ periodMode: "month", month: stateCurrentMonth() });
  document.getElementById("reportRangeApplyBtn").onclick = () => updateReportPeriod({
    fromDate: document.getElementById("reportFromDate").value,
    toDate: document.getElementById("reportToDate").value
  });
}
