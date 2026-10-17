// 明细筛选模块：把日期、账户、类别和关键字条件组合成可复用的记录集合。
// 筛选状态由 state.js 维护，视图和统计图只消费 filteredRecords() 的结果。

const DETAIL_PERIODS = [
  { key: "today", name: "今天" },
  { key: "week", name: "本周" },
  { key: "month", name: "本月" },
  { key: "year", name: "本年" }
];

function detailPeriodBounds(period, referenceDate = todayStr()) {
  const date = parseLocalDate(referenceDate);
  if (!date) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (period === "month") {
    start.setDate(1);
  } else if (period === "year") {
    start.setMonth(0, 1);
  } else if (period !== "today") {
    return null;
  }
  return {
    start: start.getFullYear() + "-" + String(start.getMonth() + 1).padStart(2, "0") + "-" + String(start.getDate()).padStart(2, "0"),
    end: referenceDate
  };
}

function recordsInDetailPeriod(recs, period = "all") {
  if (period === "all") return recs;
  const bounds = detailPeriodBounds(period);
  if (!bounds) return recs;
  return recs.filter(r => r.date >= bounds.start && r.date <= bounds.end);
}

function currentDetailPeriod() {
  if (["month", "year", "all", "range"].includes(filterState.periodMode)) return "all";
  if (filterState.fromDate || filterState.toDate) return "all";
  return uiState.detailPeriod || "all";
}

function applyDetailPeriodMode(mode) {
  filterState.periodMode = ["month", "year", "period", "range", "all"].includes(mode) ? mode : "period";
  if (filterState.periodMode === "month") {
    const month = /^\d{4}-\d{2}$/.test(filterState.month) ? filterState.month : todayStr().slice(0, 7);
    const [year, monthNumber] = month.split("-").map(Number);
    filterState.fromDate = month + "-01";
    filterState.toDate = year + "-" + String(monthNumber).padStart(2, "0") + "-" + String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0");
  } else if (filterState.periodMode === "year") {
    const year = /^\d{4}$/.test(filterState.year) ? filterState.year : String(new Date().getFullYear());
    filterState.year = year;
    filterState.fromDate = year + "-01-01";
    filterState.toDate = year + "-12-31";
  } else if (filterState.periodMode === "all" || filterState.periodMode === "period") {
    filterState.fromDate = "";
    filterState.toDate = "";
  }
  if (typeof document !== "undefined") {
    const from = document.getElementById("fromDate");
    const to = document.getElementById("toDate");
    if (from) from.value = filterState.fromDate;
    if (to) to.value = filterState.toDate;
  }
}

function filterByPeriod(recs) {
  return recs.filter(r => {
    if (filterState.fromDate && r.date < filterState.fromDate) return false;
    if (filterState.toDate && r.date > filterState.toDate) return false;
    // 转账的转出和转入账户都属于筛选范围。
    if (filterState.account && String(r.account) !== filterState.account && String(r.toAccount) !== filterState.account) return false;
    if (filterState.category && r.category !== filterState.category) return false;
    return true;
  });
}

// 搜索关键字：匹配备注 / 押金对象 / 类别 / 类型（不区分大小写）
function matchesSearch(r) {
  const k = filterState.searchKey.trim().toLowerCase();
  if (!k) return true;
  const hay = ((r.note || "") + " " + (r.depositTarget || "") + " " + r.category + " " + r.type).toLowerCase();
  return hay.includes(k);
}

function filteredRecords() {
  return filterByPeriod(recordsInDetailPeriod(dataState.records, currentDetailPeriod())).filter(matchesSearch);
}

// 这个账户是不是负债账户
function isLiabAccount(id) {
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  return a && a.kind === "负债";
}
