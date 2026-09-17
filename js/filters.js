// 明细筛选模块：把日期、账户、类别和关键字条件组合成可复用的记录集合。
// 筛选状态由 state.js 维护，视图和统计图只消费 filteredRecords() 的结果。

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
  return filterByPeriod(dataState.records).filter(matchesSearch);
}

// 这个账户是不是负债账户
function isLiabAccount(id) {
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  return a && a.kind === "负债";
}
