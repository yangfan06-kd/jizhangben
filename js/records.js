// 记账计算模块：负责把一笔记录转换成收入、支出和账户资金变化。
// 押金本金只影响资金流；最终结算差额才进入收入或支出。

function isIncome(r) {
  if (r.type === "收入") return true;
  if (r.type === "押金") return false;
  const ct = customTypeInfo(r.type);
  return !!(ct && ct.side === "income");
}

function isExpense(r) {
  if (r.type === "支出") return true;
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

function incomeEffect(r) {
  if (r.type === "收入") return amountOf(r);
  if (r.type === "押金") return depositSettlementInfo(r, r.id).income;
  const ct = customTypeInfo(r.type);
  if (ct && ct.side === "income") return amountOf(r);
  return 0;
}

function expenseEffect(r) {
  if (r.type === "支出") return amountOf(r);
  if (r.type === "退款" || r.type === "报销") return -amountOf(r);
  if (r.type === "押金") return depositSettlementInfo(r, r.id).expense;
  const ct = customTypeInfo(r.type);
  if (ct && ct.side === "expense") return amountOf(r);
  return 0;
}

function amountText(r) {
  const n = amountOf(r).toFixed(2);
  if (r.type === "收入") return { text: "+¥" + n, cls: "income" };
  if (r.type === "退款" || r.type === "报销") return { text: "+¥" + n, cls: "income" };
  if (r.type === "押金") {
    const d = depositInfo(r.depositDir);
    const plus = (d && d.flow === "in");
    return { text: (plus ? "+¥" : "−¥") + n, cls: "neutral" };
  }
  if (r.type === "支出") return { text: "−¥" + n, cls: "expense" };
  const ct = customTypeInfo(r.type);
  if (ct) {
    if (ct.side === "income") return { text: "+¥" + n, cls: "income" };
    if (ct.side === "expense") return { text: "−¥" + n, cls: "expense" };
  }
  return { text: "¥" + n, cls: "neutral" };
}

function flowDir(r) {
  const type = r.type;
  if (type === "押金") {
    const d = depositInfo(r.depositDir);
    return (d && d.flow === "in") ? "in" : "out";
  }
  if (type === "收入" || type === "报销" || type === "退款") return "in";
  if (type === "支出" || type === "代付") return "out";
  if (type === "转账") return "transfer";
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
  recs.forEach(r => {
    const dir = flowDir(r);
    if (dir === "none") return;
    const amountCents = toCents(amountOf(r));
    const a = accs.find(x => String(x.id) === String(r.account));
    if (!a) return;
    if (dir === "in") {
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
