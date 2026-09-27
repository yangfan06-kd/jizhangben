// 记账计算模块：负责把一笔记录转换成收入、支出和账户资金变化。
// 押金本金只影响资金流；最终结算差额才进入收入或支出。

function isIncome(r) {
  if (r.type === "收入") return true;
  if (r.type === "基金结算") return r.fundResult === "income";
  if (r.type === "借贷") return false;
  if (r.type === "退款") return refundEffect(r).income > 0;
  if (r.type === "押金") return false;
  const ct = customTypeInfo(r.type);
  return !!(ct && ct.side === "income");
}

function isExpense(r) {
  if (r.type === "支出") return true;
  if (r.type === "基金结算") return r.fundResult === "expense";
  if (r.type === "借贷") return false;
  if (r.type === "代付") return r.payMode === "转为支出";
  if (r.type === "押金") return false;
  const ct = customTypeInfo(r.type);
  return !!(ct && ct.side === "expense");
}

function depositInfo(dir) {
  return DEPOSIT_DIRS.find(x => x.key === dir) || null;
}

function depositLabel(dir) {
  const d = depositInfo(dir);
  return d ? d.label : (dir || "");
}

// 借贷本金的未结清金额：借入对应偿还，借出对应收回。
// 这只是债务/应收关系，不计入收入或支出。
function loanOutstandingFor(record, records = dataState.records) {
  if (!record || record.type !== "借贷") return 0;
  const originalMode = record.loanMode === "借入" || record.loanMode === "借出";
  if (!originalMode) return 0;
  const settleMode = record.loanMode === "借入" ? "偿还" : "收回";
  const settled = (Array.isArray(records) ? records : []).reduce((sum, item) => {
    if (item.type !== "借贷" || item.loanMode !== settleMode) return sum;
    if (String(item.loanLinkId || "") !== String(record.id || "")) return sum;
    return sum + toCents(amountOf(item));
  }, 0);
  return Math.max(0, toCents(amountOf(record)) - settled) / 100;
}

function incomeEffect(r) {
  if (r.type === "收入") return amountOf(r);
  if (r.type === "基金结算") return r.fundResult === "income" ? amountOf(r) : 0;
  if (r.type === "借贷") return 0;
  if (r.type === "报销") return reimbursementEffect(r).income;
  if (r.type === "退款") return refundEffect(r).income;
  if (r.type === "押金") return depositSettlementInfo(r, r.id).income;
  const ct = customTypeInfo(r.type);
  if (ct && ct.side === "income") return amountOf(r);
  return 0;
}

function expenseEffect(r) {
  if (r.type === "支出") return amountOf(r);
  if (r.type === "基金结算") return r.fundResult === "expense" ? amountOf(r) : 0;
  if (r.type === "借贷") return 0;
  if (r.type === "代付") return r.payMode === "转为支出" ? amountOf(r) : 0;
  if (r.type === "报销") return reimbursementEffect(r).expense;
  if (r.type === "退款") return refundEffect(r).expense;
  if (r.type === "押金") return depositSettlementInfo(r, r.id).expense;
  const ct = customTypeInfo(r.type);
  if (ct && ct.side === "expense") return amountOf(r);
  return 0;
}

function amountText(r) {
  const n = amountOf(r).toFixed(2);
  if (r.type === "基金结算") return { text: (r.fundResult === "income" ? "+¥" : "−¥") + n, cls: r.fundResult === "income" ? "income" : "expense" };
  if (r.type === "收入") return { text: "+¥" + n, cls: "income" };
  if (r.type === "报销") {
    const effect = reimbursementEffect(r);
    return { text: "+¥" + n, cls: effect.income > 0 ? "income" : "neutral" };
  }
  if (r.type === "退款") {
    const effect = refundEffect(r);
    return { text: "+¥" + n, cls: effect.income > 0 ? "income" : "neutral" };
  }
  if (r.type === "押金") {
    const d = depositInfo(r.depositDir);
    const plus = (d && d.flow === "in");
    return { text: (plus ? "+¥" : "−¥") + n, cls: "neutral" };
  }
  if (r.type === "支出") return { text: "−¥" + n, cls: "expense" };
  if (r.type === "余额") return { text: "¥" + n, cls: "neutral" };
  if (r.type === "借贷") {
    const direction = flowDir(r);
    return { text: (direction === "in" ? "+¥" : direction === "out" ? "−¥" : "¥") + n, cls: "neutral" };
  }
  if (r.type === "代付") {
    const direction = flowDir(r);
    if (r.payMode === "转为支出") return { text: "−¥" + n, cls: "expense" };
    return { text: (direction === "in" ? "+¥" : direction === "out" ? "−¥" : "¥") + n, cls: "neutral" };
  }
  const ct = customTypeInfo(r.type);
  if (ct) {
    if (ct.side === "income") return { text: "+¥" + n, cls: "income" };
    if (ct.side === "expense") return { text: "−¥" + n, cls: "expense" };
  }
  return { text: "¥" + n, cls: "neutral" };
}

function flowDir(r) {
  const type = r.type;
  if (type === "基金结算") return r.fundResult === "income" ? "in" : "out";
  if (type === "余额") return "balance";
  if (type === "借贷") {
    if (r.loanMode === "借入" || r.loanMode === "收回") return "in";
    if (r.loanMode === "借出" || r.loanMode === "偿还") return "out";
    return "none";
  }
  if (type === "代付") {
    // 旧代付记录没有 payMode，继续按原来的现金支出方向兼容读取。
    if (!r.payMode || r.payMode === "代付") return "out";
    if (r.payMode === "收回") return "in";
    return "none";
  }
  if (type === "押金") {
    const d = depositInfo(r.depositDir);
    return (d && d.flow === "in") ? "in" : "out";
  }
  if (type === "收入" || type === "报销" || type === "退款") return "in";
  if (type === "支出" || type === "代付") return "out";
  if (type === "转账") return r.transferMode === "转账他人" ? "out" : "transfer";
  const ct = customTypeInfo(type);
  if (ct) {
    if (ct.side === "income") return "in";
    if (ct.side === "expense") return "out";
  }
  return "none";
}

function accountName(id) {
  const a = dataState.accounts.find(x => String(x.id) === String(id));
  return a ? a.name : "未指定";
}

function computeBalancesFor(accs, recs) {
  // 余额变化全程按“分”累加，只在返回结果时转换成“元”。
  // 这样 0.10 + 0.20 不会变成 0.30000000000000004。
  const balCents = {};
  accs.forEach(a => { balCents[a.id] = toCents(initialOf(a)); });
  // 余额校准是“截至这一天的实际余额”，要按日期重放；同一天保持原记录顺序。
  const orderedRecords = recs.map((record, index) => ({ record, index })).sort((a, b) => {
    const dateCompare = String(a.record.date || "").localeCompare(String(b.record.date || ""));
    return dateCompare !== 0 ? dateCompare : a.index - b.index;
  }).map(item => item.record);
  orderedRecords.forEach(r => {
    const dir = flowDir(r);
    if (dir === "none") return;
    const amountCents = toCents(amountOf(r));
    const a = accs.find(x => String(x.id) === String(r.account));
    if (!a) return;
    if (dir === "balance") {
      // 资产账户和负债账户都使用账户页面看到的绝对余额校准。
      balCents[a.id] = amountCents;
    } else if (dir === "in") {
      balCents[a.id] += (a.kind === "负债") ? -amountCents : amountCents;
    } else if (dir === "out") {
      balCents[a.id] += (a.kind === "负债") ? amountCents : -amountCents;
    } else {
      const b = accs.find(x => String(x.id) === String(r.toAccount));
      if (b) {
        balCents[a.id] += (a.kind === "负债") ? amountCents : -amountCents;
        balCents[b.id] += (b.kind === "负债") ? -amountCents : amountCents;
      }
    }
  });
  return Object.fromEntries(
    Object.entries(balCents).map(([accountId, cents]) => [accountId, cents / 100])
  );
}

function computeBalances() {
  return computeBalancesFor(dataState.accounts, dataState.records);
}

// 借入的未还本金是负债，借出的未收本金是应收资产；把它们纳入净资产后，
// 借钱进来和借钱出去都不会凭空增加或减少真实财富。
function loanNetWorthAdjustment(records = dataState.records) {
  const adjustmentCents = (Array.isArray(records) ? records : []).reduce((sum, record) => {
    if (record.type !== "借贷" || !isLoanOriginalModeForCalculation(record.loanMode)) return sum;
    const remainingCents = toCents(loanOutstandingFor(record, records));
    return sum + (record.loanMode === "借出" ? remainingCents : -remainingCents);
  }, 0);
  return adjustmentCents / 100;
}

// 尚未结清的押金也是资产或负债：付出的押金可收回，收到的押金仍需退还。
// 最终结算后，差额已体现在账户余额和收入/支出中，不再重复计入净资产。
function depositNetWorthAdjustment(records = dataState.records) {
  const list = Array.isArray(records) ? records : [];
  const adjustmentCents = list.reduce((sum, original) => {
    if (original.type !== "押金" || original.id == null || (original.depositDir !== "付" && original.depositDir !== "收")) return sum;
    const linkedReturns = list.filter(record => record.type === "押金" && String(record.depositLinkId || "") === String(original.id));
    if (linkedReturns.some(record => record.depositFinal)) return sum;
    const returnedCents = linkedReturns.reduce((returned, record) => returned + toCents(amountOf(record)), 0);
    const outstandingCents = Math.max(0, toCents(amountOf(original)) - returnedCents);
    return sum + (original.depositDir === "付" ? outstandingCents : -outstandingCents);
  }, 0);
  return adjustmentCents / 100;
}

function isLoanOriginalModeForCalculation(mode) {
  return mode === "借入" || mode === "借出";
}

function computeNetWorthFor(accs, recs) {
  const balances = computeBalancesFor(accs, recs);
  let net = 0;
  accs.forEach(account => {
    net += account.kind === "负债" ? -balances[account.id] : balances[account.id];
  });
  return net + loanNetWorthAdjustment(recs) + payNetWorthAdjustment(recs) + depositNetWorthAdjustment(recs);
}

// 报销优先冲减被报销的原支出；超过原支出的部分才算新增收入。
// 这样“先个人垫付、后单位报销”不会把同一笔钱重复算成收入。
function reimbursementEntriesFor(original, records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index }))
    .filter(item => item.record.type === "报销" &&
      String(item.record.reimbursementLinkId || "") === String(original && original.id || ""))
    .sort((a, b) => String(a.record.date || "").localeCompare(String(b.record.date || "")) || a.index - b.index);
}

function reimbursementEffect(record, records = dataState.records) {
  if (!record || record.type !== "报销") return { income: 0, expense: 0, applied: 0, excess: 0 };
  const original = (Array.isArray(records) ? records : []).find(item =>
    String(item.id) === String(record.reimbursementLinkId || "")
  );
  if (!original) {
    // 兼容早期未关联原支出的报销记录：仍按原有“冲减支出”语义读取。
    return { income: 0, expense: -amountOf(record), applied: amountOf(record), excess: 0 };
  }
  const baseCents = Math.max(0, toCents(expenseEffect(original)));
  const entries = reimbursementEntriesFor(original, records);
  const currentIndex = entries.findIndex(item => String(item.record.id) === String(record.id));
  const priorEntries = currentIndex < 0 ? [] : entries.slice(0, currentIndex);
  let priorApplied = 0;
  priorEntries.forEach(item => {
    priorApplied += Math.min(toCents(amountOf(item.record)), Math.max(0, baseCents - priorApplied));
  });
  const remainingBefore = Math.max(0, baseCents - priorApplied);
  const amountCents = toCents(amountOf(record));
  const appliedCents = Math.min(amountCents, remainingBefore);
  return {
    income: (amountCents - appliedCents) / 100,
    expense: -appliedCents / 100,
    applied: appliedCents / 100,
    excess: (amountCents - appliedCents) / 100,
    original
  };
}

function reimbursementOutstandingFor(original, records = dataState.records, excludeId = null) {
  if (!original) return 0;
  const baseCents = Math.max(0, toCents(expenseEffect(original)));
  let remaining = baseCents;
  reimbursementEntriesFor(original, records).forEach(item => {
    if (excludeId !== null && String(item.record.id) === String(excludeId)) return;
    remaining = Math.max(0, remaining - toCents(amountOf(item.record)));
  });
  return remaining / 100;
}

function refundEntriesFor(original, records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index }))
    .filter(item => item.record.type === "退款" &&
      String(item.record.refundLinkId || "") === String(original && original.id || ""))
    .sort((a, b) => String(a.record.date || "").localeCompare(String(b.record.date || "")) || a.index - b.index);
}

function refundEffect(record, records = dataState.records) {
  if (!record || record.type !== "退款") return { income: 0, expense: 0, applied: 0, excess: 0 };
  const original = (Array.isArray(records) ? records : []).find(item =>
    String(item.id) === String(record.refundLinkId || "")
  );
  if (!original) {
    // 兼容旧版未关联原支出的退款记录：仍按旧版“冲减支出”读取。
    return { income: 0, expense: -amountOf(record), applied: amountOf(record), excess: 0 };
  }
  const baseCents = Math.max(0, toCents(expenseEffect(original)));
  const entries = refundEntriesFor(original, records);
  const currentIndex = entries.findIndex(item => String(item.record.id) === String(record.id));
  const priorEntries = currentIndex < 0 ? [] : entries.slice(0, currentIndex);
  let priorApplied = 0;
  priorEntries.forEach(item => {
    priorApplied += Math.min(toCents(amountOf(item.record)), Math.max(0, baseCents - priorApplied));
  });
  const remainingBefore = Math.max(0, baseCents - priorApplied);
  const amountCents = toCents(amountOf(record));
  const appliedCents = Math.min(amountCents, remainingBefore);
  return {
    income: (amountCents - appliedCents) / 100,
    expense: -appliedCents / 100,
    applied: appliedCents / 100,
    excess: (amountCents - appliedCents) / 100,
    original
  };
}

function refundOutstandingFor(original, records = dataState.records, excludeId = null) {
  if (!original) return 0;
  const baseCents = Math.max(0, toCents(expenseEffect(original)));
  let remaining = baseCents;
  refundEntriesFor(original, records).forEach(item => {
    if (excludeId !== null && String(item.record.id) === String(excludeId)) return;
    remaining = Math.max(0, remaining - toCents(amountOf(item.record)));
  });
  return remaining / 100;
}

// 代付的未收回金额：收回和确认无法收回都会结算原代付，但只有后者进入支出。
function payOutstandingFor(record, records = dataState.records) {
  if (!record || record.type !== "代付" || record.payMode !== "代付") return 0;
  const settled = (Array.isArray(records) ? records : []).reduce((sum, item) => {
    if (item.type !== "代付" || (item.payMode !== "收回" && item.payMode !== "转为支出")) return sum;
    if (String(item.payLinkId || "") !== String(record.id || "")) return sum;
    return sum + toCents(amountOf(item));
  }, 0);
  return Math.max(0, toCents(amountOf(record)) - settled) / 100;
}

function payNetWorthAdjustment(records = dataState.records) {
  const adjustmentCents = (Array.isArray(records) ? records : []).reduce((sum, record) => {
    if (record.type !== "代付" || record.payMode !== "代付") return sum;
    return sum + toCents(payOutstandingFor(record, records));
  }, 0);
  return adjustmentCents / 100;
}

function depositSettlementInfo(r, excludeId) {
  if (!r || r.type !== "押金" || !r.depositLinkId || !r.depositFinal) return { income: 0, expense: 0, difference: 0 };
  const original = dataState.records.find(x => String(x.id) === String(r.depositLinkId));
  if (!original || original.type !== "押金") return { income: 0, expense: 0, difference: 0 };
  const returnedCents = dataState.records.reduce((sum, x) => {
    if (x.type !== "押金" || String(x.depositLinkId) !== String(original.id) || String(x.id) === String(excludeId)) return sum;
    return sum + toCents(amountOf(x));
  }, 0) + toCents(amountOf(r));
  const differenceCents = Math.max(0, toCents(amountOf(original)) - returnedCents);
  const difference = differenceCents / 100;
  if (original.depositDir === "付") return { income: 0, expense: difference, difference: difference };
  if (original.depositDir === "收") return { income: difference, expense: 0, difference: difference };
  return { income: 0, expense: 0, difference: 0 };
}
