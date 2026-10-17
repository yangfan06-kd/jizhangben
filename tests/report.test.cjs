const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime.cjs");

function value(runtime, expression) {
  return JSON.parse(runtime.run("JSON.stringify(" + expression + ")"));
}
function loadCharts(runtime) {
  runtime.run(fs.readFileSync(path.join(__dirname, "..", "js/charts.js"), "utf8"));
}

test("首页日期刻度覆盖首日与当天且不在末尾追加相邻日期", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  assert.deepEqual(value(runtime, "homeTrendDateIndices(1)"), [0]);
  assert.deepEqual(value(runtime, "homeTrendDateIndices(17)"), [0, 5, 11, 16]);
  for (let days = 2; days <= 31; days++) {
    const indices = value(runtime, `homeTrendDateIndices(${days})`);
    assert.equal(indices[0], 0);
    assert.equal(indices.at(-1), days - 1);
    assert.ok(indices.length <= 4);
    assert.equal(new Set(indices).size, indices.length);
    // 最近两刻度至少相隔五分之一绘图区，不产生临近的末尾补标。
    const gaps = indices.slice(1).map((n, i) => (n - indices[i]) / (days - 1));
    assert.ok(Math.min(...gaps) >= 0.2);
  }
});

test("报表月份包含整月与闰日，月初月末按本地日期筛选", () => {
  const runtime = createRuntime();
  runtime.run('Object.assign(reportState,{periodMode:"month",month:"2024-02"});dataState.records=["2024-01-31","2024-02-01","2024-02-29","2024-03-01"].map(date=>({date}))');
  assert.deepEqual(value(runtime, "reportPeriodBounds()"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(value(runtime, "reportRecords().map(record=>record.date)"), ["2024-02-01", "2024-02-29"]);
});

test("报表支持年份、今天及跨年的本周", () => {
  const runtime = createRuntime();
  assert.deepEqual(value(runtime, 'reportPeriodBounds({periodMode:"year",year:"2025"})'), { start: "2025-01-01", end: "2025-12-31" });
  assert.deepEqual(value(runtime, 'reportPeriodBounds({periodMode:"today"},"2026-01-02")'), { start: "2026-01-02", end: "2026-01-02" });
  assert.deepEqual(value(runtime, 'reportPeriodBounds({periodMode:"week"},"2026-01-02")'), { start: "2025-12-29", end: "2026-01-02" });
});

test("报表自选日期包含两端，拒绝不存在或倒置的日期", () => {
  const runtime = createRuntime();
  runtime.run('dataState.records=[{date:"2026-09-01"},{date:"2026-09-30"},{date:"2026-10-01"}]');
  assert.equal(runtime.run('reportRecords(dataState.records,{periodMode:"range",fromDate:"2026-09-01",toDate:"2026-09-30"}).length'), 2);
  assert.throws(() => runtime.run('reportPeriodBounds({periodMode:"range",fromDate:"2026-02-30",toDate:"2026-03-01"})'), /有效/);
  assert.throws(() => runtime.run('reportPeriodBounds({periodMode:"range",fromDate:"2026-10-02",toDate:"2026-10-01"})'), /不能晚于/);
  assert.throws(() => runtime.run('reportPeriodBounds({periodMode:"month",month:"2026-13"})'), /有效/);
});

test("报表时期独立于流水筛选，读取不修改记录及存储", () => {
  const runtime = createRuntime({ jizhangben_records_1: '[{"id":1,"date":"2026-10-01"}]' });
  runtime.run('dataState.records=[{id:1,date:"2026-10-01"},{id:2,date:"2025-01-01"}];Object.assign(filterState,{fromDate:"2000-01-01",toDate:"2000-01-02",account:"missing",category:"missing",searchKey:"missing"});reportState.periodMode="all"');
  const stored = runtime.localStorage.toObject(), records = value(runtime, "dataState.records");
  assert.equal(runtime.run("reportRecords().length"), 2);
  assert.equal(runtime.run("reportRecords() === dataState.records"), false);
  assert.deepEqual(value(runtime, "dataState.records"), records);
  assert.deepEqual(runtime.localStorage.toObject(), stored);
});

test("报表用整数分汇总，押金本金和基金转账中性，保留负收入", () => {
  const runtime = createRuntime();
  const records = [
    {id:1,type:"支出",category:"餐饮",amountCents:10},
    {id:2,type:"支出",category:"餐饮",amountCents:20},
    {id:3,type:"收入",category:"工资",amountCents:10000},
    {id:4,type:"收入",category:"工资",amountCents:-2000},
    {id:5,type:"转账",category:"基金",amountCents:40000},
    {id:6,type:"押金",category:"租房",amountCents:100000,depositDir:"付"},
    {id:7,type:"押金",category:"租房",amountCents:70000,depositDir:"退回",depositLinkId:6,depositFinal:true}
  ];
  runtime.run("dataState.records=" + JSON.stringify(records));
  const summary = value(runtime, "aggregateReportCategories(dataState.records)");
  assert.equal(summary.incomeCents, 8000);
  assert.equal(summary.expenseCents, 30030);
  assert.equal(summary.categories.find(item => item.category === "餐饮").expenseCents, 30);
  assert.equal(summary.categories.some(item => item.category === "基金"), false);
});

test("报表退款和超额报销同时计入支出抵减与收入，保留跨期原始关联", () => {
  const runtime = createRuntime();
  const records = [
    {id:"cost1",type:"支出",category:"购物",amountCents:10000,date:"2026-09-01"},
    {id:"refund",type:"退款",category:"购物",amountCents:7000,refundLinkId:"cost1",date:"2026-10-01"},
    {id:"cost2",type:"支出",category:"工作",amountCents:10000,date:"2026-09-01"},
    {id:"reim",type:"报销",category:"工作",amountCents:12000,reimbursementLinkId:"cost2",date:"2026-10-02"}
  ];
  runtime.run('Object.assign(reportState,{periodMode:"month",month:"2026-10"});dataState.records=' + JSON.stringify(records));
  const summary = value(runtime, "aggregateReportCategories(reportRecords())");
  assert.equal(summary.incomeCents, 2000);
  assert.equal(summary.expenseCents, -17000);
  assert.equal(summary.categories.find(item => item.category === "工作").expenseCents, -10000);
});

test("无效报表时期保留上次结果和流水条件，有效切换不写存储", () => {
  const runtime = createRuntime({ jizhangben_category_system: '{"groups":[],"hidden":[]}' });
  runtime.run('globalThis.messages={};globalThis.document={getElementById(){return messages;}};renderReportPeriodControls=()=>{};globalThis.rendered=0;globalThis.renderChart=()=>{rendered++;};Object.assign(reportState,{periodMode:"range",fromDate:"2026-10-01",toDate:"2026-10-10"})');
  const before = value(runtime, "reportState"), filters = value(runtime, "filterState"), stored = runtime.localStorage.toObject();
  assert.equal(runtime.run('updateReportPeriod({fromDate:"2026-10-11"})'), false);
  assert.deepEqual(value(runtime, "reportState"), before);
  assert.equal(runtime.run("rendered"), 0);
  assert.match(runtime.run("messages.textContent"), /不能晚于/);
  assert.equal(runtime.run('updateReportPeriod({periodMode:"year",year:"2025"})'), true);
  assert.deepEqual(value(runtime, "filterState"), filters);
  assert.deepEqual(runtime.localStorage.toObject(), stored);
});

test("横向柱形保留两位金额和占比，类别名称作为文本安全显示", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};uiState.chartKind="expense";renderBarChart(box,[["餐饮<script>",0.1],["交通",0.2]])');
  const html = runtime.run("box.innerHTML");
  assert.match(html, /¥0\.10/);
  assert.match(html, /33\.3%/);
  assert.match(html, /餐饮&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<svg/);
});

test("含负金额的柱形以中线区分，综合图分别显示收支及明确占比口径", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};uiState.chartKind="income";renderBarChart(box,[["工资",100],["调整",-20]])');
  assert.match(runtime.run("box.innerHTML"), /−¥20\.00/);
  assert.match(runtime.run("box.innerHTML"), /不计占比/);
  assert.match(runtime.run("box.innerHTML"), /signed/);
  runtime.run('renderCombinedBarChart(box,["餐饮","工资"],{"工资":100},{"餐饮":50})');
  assert.match(runtime.run("box.innerHTML"), /收入、支出占比分别按各自合计/);
  assert.match(runtime.run("box.innerHTML"), /100\.0%/);
  assert.doesNotMatch(runtime.run("box.innerHTML"), /NaN|Infinity/);
});

test("只有一个类别时扇形图仍显示完整圆形和百分比", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};uiState.chartKind="expense";renderPieChart(box,[["餐饮",12.5]],12.5)');
  assert.match(runtime.run("box.innerHTML"), /<circle/);
  assert.match(runtime.run("box.innerHTML"), /100\.0%/);
  runtime.run('renderCombinedPieChart(box,["餐饮"],{},{"餐饮":12.5})');
  assert.match(runtime.run("box.innerHTML"), /<circle/);
});

test("综合柱形不显示不存在的方向或双零类别，不修改数据", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  const stored = runtime.localStorage.toObject();
  runtime.run('globalThis.box={innerHTML:""};globalThis.inc={工资:100,抵消:0};globalThis.exp={餐饮:50,抵消:0};renderCombinedBarChart(box,["餐饮","工资","抵消"],inc,exp)');
  const rows = runtime.run("box.innerHTML").match(/<li class="report-bar-item">[\s\S]*?<\/li>/g);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /支出/);
  assert.doesNotMatch(rows[0], /收入/);
  assert.match(rows[1], /收入/);
  assert.doesNotMatch(rows[1], /支出/);
  assert.doesNotMatch(runtime.run("box.innerHTML"), /¥0\.00|抵消/);
  assert.deepEqual(value(runtime, "inc"), {工资:100,抵消:0});
  assert.deepEqual(value(runtime, "exp"), {餐饮:50,抵消:0});
  assert.deepEqual(runtime.localStorage.toObject(), stored);
  runtime.run('renderCombinedBarChart(box,["抵消"],{抵消:0},{抵消:0})');
  assert.match(runtime.run("box.innerHTML"), /这个时期还没有收入或支出/);
});

test("综合柱形同名类别确有双向金额时保留两行，负金额不会被误隐藏", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};renderCombinedBarChart(box,["工作"],{工作:30},{工作:-100})');
  const html = runtime.run("box.innerHTML");
  assert.equal((html.match(/class="report-bar-figures"/g) || []).length, 2);
  assert.match(html, /−¥100\.00/);
  assert.match(html, /¥30\.00/);
  assert.match(html, /kind-expense/);
  assert.match(html, /kind-income/);
});

test("扇形图前二十块颜色独立且与图例一致，保留金额和百分比", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};uiState.chartKind="expense";renderPieChart(box,Array.from({length:20},(_,i)=>["类别"+(i+1),100]),2000)');
  const html = runtime.run("box.innerHTML");
  const sliceColors = [...html.matchAll(/<path[^>]+fill="(#[A-Fa-f0-9]+)"/g)].map(match => match[1]);
  const legendColors = [...html.matchAll(/class="dot" style="background:(#[A-Fa-f0-9]+)"/g)].map(match => match[1]);
  assert.equal(new Set(sliceColors).size, 20);
  assert.deepEqual(sliceColors, legendColors);
  assert.doesNotMatch(html, /<text\b|<g\b|#FFFFFF|序号/);
  assert.match(html, /支出·类别20 ¥100\.00 · 5\.0%/);
  for (const match of html.matchAll(/<path[^>]+fill="(#[A-Fa-f0-9]+)" stroke="(#[A-Fa-f0-9]+)"/g)) {
    assert.equal(match[1], match[2]);
  }
});

test("综合扇形图连续分配类别颜色，极小扇区保留图例，图面不含序号或白边", () => {
  const runtime = createRuntime();
  loadCharts(runtime);
  runtime.run('globalThis.box={innerHTML:""};renderCombinedPieChart(box,["工资","餐饮","零星<script>"],{"工资":1000},{"餐饮":1000,"零星<script>":1})');
  const html = runtime.run("box.innerHTML");
  const colors = [...html.matchAll(/<path[^>]+fill="(#[A-Fa-f0-9]+)"/g)].map(match => match[1]);
  assert.equal(new Set(colors).size, 3);
  assert.match(html, /收入·工资/);
  assert.match(html, /支出·零星&lt;script&gt; ¥1\.00 · ＜0\.1%/);
  assert.doesNotMatch(html, /<text\b|<g\b|#FFFFFF|序号/);
});
