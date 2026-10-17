// 仅供内存基准及回归；每组 26 笔。本金中性，跨月退款/报销和押金最终差额保留。
const { linkedRecords } = require('./linked-records.cjs');

function homeFixture(groups, month = '2026-10') {
  const [year, mon] = month.split('-').map(Number);
  const previous = new Date(year, mon - 1, 0);
  const previousDay = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`;
  const accounts = [
    { id: 1, name: '模拟微信', kind: '资金', initialCents: 100000000 },
    { id: 2, name: '模拟银行卡', kind: '资金', initialCents: 200000000 },
    { id: 3, name: '模拟信用卡', kind: '负债', initialCents: 500000 },
    { id: 4, name: '模拟基金专户', kind: '资金', fundOnly: true, initialCents: 0 }
  ];
  const records = [];
  for (let group = 0; group < groups; group++) {
    const base = group * 100;
    for (const record of linkedRecords(1)) {
      const copy = { ...record, id: base + record.id, date: record.date === '2025-12-31' ? previousDay : month + (record.date.startsWith('2026-01') ? '-02' : '-03') };
      for (const key of ['refundLinkId', 'reimbursementLinkId', 'depositLinkId']) if (copy[key]) copy[key] += base;
      if (copy.type === '押金') Object.assign(copy, { category: '其他', depositTarget: '模拟房东' });
      records.push(copy);
    }
    const add = (id, type, amountCents, extra = {}) => records.push({ id: base + id, type, amountCents, account: 1, date: month + '-04', category: '其他', note: '纯合成性能样例', ...extra });
    add(10, '借贷', 100000, { loanMode: '借入', loanTarget: '模拟亲友' });
    add(11, '借贷', 40000, { loanMode: '偿还', loanLinkId: base + 10 });
    add(12, '借贷', 80000, { loanMode: '借出', loanTarget: '模拟亲友' });
    add(13, '借贷', 30000, { loanMode: '收回', loanLinkId: base + 12 });
    add(14, '代付', 100000, { payMode: '代付', payTarget: '模拟同学' });
    add(15, '代付', 40000, { payMode: '收回', payLinkId: base + 14 });
    add(16, '代付', 20000, { payMode: '转为支出', payLinkId: base + 14 });
    add(17, '押金', 100000, { depositDir: '付', depositTarget: '模拟房东' });
    add(18, '押金', 20000, { depositDir: '退回', depositLinkId: base + 17, depositFinal: false });
    add(19, '押金', 50000, { depositDir: '收', depositTarget: '模拟租客' });
    add(20, '押金', 10000, { depositDir: '退', depositLinkId: base + 19, depositFinal: false });
    add(21, '收入', -500);
    add(22, '转账', 10000, { toAccount: 4, fundProjectId: '模拟基金' });
    add(23, '基金结算', 1000, { fundResult: 'income' });
    add(24, '支出', 10000, { account: 3 });
    add(25, '收入', 20000, { category: '退休金' });
    add(26, '支出', 7500);
  }
  return { accounts, records, expected: {
    count: groups * 26, incomeCents: groups * 23500, expenseCents: groups * 67500,
    monthIncomeCents: groups * 23500, monthExpenseCents: groups * 37500,
    netCents: 299500000 - groups * 44000,
    balancesCents: { 1: 100000000 - groups * 114000, 2: 200000000, 3: 500000 + groups * 10000, 4: groups * 10000 }
  } };
}
module.exports = { homeFixture };
