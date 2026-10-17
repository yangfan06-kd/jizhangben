// 每组：退款超额10元、报销超额20元、付押金少退300元。
// 原支出跨年，关联返回跨月；每组净收入30元、支出300元。
function linkedRecords(groups) {
  const rows = [];
  for (let group = 0; group < groups; group++) {
    const id = group * 10;
    const add = (offset, type, amountCents, date, extra = {}) => rows.push({
      id: id + offset, type, amountCents, amount: amountCents / 100,
      account: 1, date, note: "模拟关联账目", ...extra
    });
    add(1, "支出", 10000, "2025-12-31", {category:"餐饮"});
    add(2, "退款", 6000, "2026-01-02", {refundLinkId:id+1});
    add(3, "退款", 5000, "2026-02-02", {refundLinkId:id+1});
    add(4, "支出", 20000, "2025-12-31", {category:"交通"});
    add(5, "报销", 12000, "2026-01-03", {reimbursementLinkId:id+4});
    add(6, "报销", 10000, "2026-02-03", {reimbursementLinkId:id+4});
    add(7, "押金", 100000, "2025-12-31", {depositDir:"付"});
    add(8, "押金", 20000, "2026-01-04", {depositDir:"退回",depositLinkId:id+7,depositFinal:false});
    add(9, "押金", 50000, "2026-02-04", {depositDir:"退回",depositLinkId:id+7,depositFinal:true});
  }
  return rows;
}
module.exports = { linkedRecords };
