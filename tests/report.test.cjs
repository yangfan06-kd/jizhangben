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

function createReportDrilldownRuntime() {
  const runtime = createRuntime({jizhangben_books:'[{"id":1,"name":"合成账本"}]',unchanged:'保留'});
  loadCharts(runtime);
  runtime.run(`
    dataState.currentBookId=1;
    dataState.records=[
      {id:1,type:"支出",category:"同类",amountCents:10000,date:"2026-09-01",account:1},
      {id:2,type:"退款",category:"同类",amountCents:2000,date:"2026-09-02",account:1,refundLinkId:1},
      {id:3,type:"收入",category:"同类",amountCents:3000,date:"2026-09-03",account:1},
      {id:4,type:"收入",category:"同类",amountCents:-500,date:"2026-09-04",account:1},
      {id:5,type:"转账",category:"同类",amountCents:5000,date:"2026-09-04",account:1,toAccount:2},
      {id:6,type:"支出",category:"别类",amountCents:1200,date:"2026-09-04",account:1},
      {id:7,type:"支出",category:"同类",amountCents:1200,date:"2026-08-31",account:1},
      {id:8,type:"代付",payMode:"转为支出",category:"同类",amountCents:800,date:"2026-09-05",account:1},
      {id:9,type:"押金",depositDir:"付",depositTarget:"合成房东",category:"租房",amountCents:100000,date:"2026-08-01",account:1},
      {id:10,type:"押金",depositDir:"退回",depositTarget:"合成房东",depositLinkId:9,depositFinal:true,category:"同类",amountCents:70000,date:"2026-09-05",account:1},
      {id:11,type:"报销",category:"同类",amountCents:9000,date:"2026-09-06",account:1,reimbursementLinkId:12},
      {id:12,type:"支出",category:"同类",amountCents:7000,date:"2026-08-25",account:1}
    ];
    Object.assign(reportState,{periodMode:"month",month:"2026-09"});
    Object.assign(filterState,{fromDate:"2000-01-01",toDate:"2000-01-02",account:"missing",category:"missing",searchKey:"missing",reportSide:"income"});
    uiState.detailVisibleCount=300;uiState.detailBrowsePosition={scrollTop:5000};
    globalThis.fields={fromDate:{value:"old"},toDate:{value:"old"},filterAccountSel:{value:"missing"},filterCategorySel:{value:"missing"},searchInput:{value:"missing"}};
    globalThis.document={getElementById(id){return fields[id]||null;}};
    globalThis.visited=[];globalThis.switchTab=tab=>{visited.push(tab);uiState.activeTab=tab;};
  `);
  return runtime;
}

test("点击支出柱形保留报表时期，清除遗留条件，包含退款和结算而不混入收入或中性流水", () => {
  const runtime=createReportDrilldownRuntime(), stored=runtime.localStorage.toObject();
  const records=value(runtime,'dataState.records'), report=value(runtime,'reportState');
  assert.equal(runtime.run('openReportCategoryRecords("同类","expense")'),true);
  assert.deepEqual(value(runtime,'filteredRecords().map(record=>record.id)'),[1,2,8,10,11]);
  assert.equal(runtime.run('filteredRecords().reduce((sum,r)=>sum+toCents(expenseEffect(r)),0)'),31800);
  assert.equal(runtime.run('filterState.fromDate'),'2026-09-01');
  assert.equal(runtime.run('filterState.toDate'),'2026-09-30');
  assert.equal(runtime.run('filterState.periodMode'),'month');
  assert.equal(runtime.run('filterState.account'), '');
  assert.equal(runtime.run('filterState.searchKey'), '');
  assert.equal(runtime.run('fields.searchInput.value'), '');
  assert.equal(runtime.run('fields.filterCategorySel.value'), '同类');
  assert.equal(runtime.run('uiState.detailVisibleCount'),100);
  assert.equal(runtime.run('uiState.detailBrowsePosition'),null);
  assert.equal(runtime.run('uiState.detailExpanded'),true);
  assert.deepEqual(value(runtime,'visited'),['detail']);
  assert.deepEqual(value(runtime,'dataState.records'),records);
  assert.deepEqual(value(runtime,'reportState'),report);
  assert.deepEqual(runtime.localStorage.toObject(),stored);
});

test("点击收入柱形保留负收入与超额报销，同名支出不混入且类别合计与图表一致", () => {
  const runtime=createReportDrilldownRuntime();
  runtime.run('openReportCategoryRecords("同类","income")');
  assert.deepEqual(value(runtime,'filteredRecords().map(record=>record.id)'),[3,4,11]);
  assert.equal(runtime.run('filteredRecords().reduce((sum,r)=>sum+toCents(incomeEffect(r)),0)'),4500);
  runtime.run(fs.readFileSync(path.join(__dirname,'../js/view.js'),'utf8'));
  runtime.run('globalThis.totalBox={};renderSelectedCategoryTotal(totalBox)');
  assert.match(runtime.run('totalBox.innerHTML'),/收入/);
  assert.match(runtime.run('totalBox.innerHTML'),/¥45\.00/);
  assert.doesNotMatch(runtime.run('totalBox.innerHTML'),/支出/);
});

test("综合同名类别可查看双向贡献，未分类能找到原空类别，清除筛选后恢复普通流水", () => {
  const runtime=createReportDrilldownRuntime();
  runtime.run('openReportCategoryRecords("同类","combined")');
  assert.deepEqual(value(runtime,'filteredRecords().map(record=>record.id)'),[1,2,3,4,8,10,11]);
  runtime.run('dataState.records.push({id:99,type:"支出",category:"",date:"2026-09-10",amountCents:100});openReportCategoryRecords("未分类","expense")');
  assert.deepEqual(value(runtime,'filteredRecords().map(record=>record.id)'),[99]);
  runtime.run('resetFilterState();filterState.periodMode="all"');
  assert.equal(runtime.run('filterState.reportSide'),'');
  assert.equal(runtime.run('filteredRecords().length'),13);
});

test("报表跳转支持全部日期、自选和整年，非法范围不会破坏现有筛选", () => {
  const runtime=createReportDrilldownRuntime();
  runtime.run('reportState.periodMode="all";openReportCategoryRecords("同类","expense")');
  assert.equal(runtime.run('filterState.periodMode'),'all');
  assert.equal(runtime.run('filterState.fromDate'),'');
  assert.equal(runtime.run('filterState.toDate'),'');
  assert.ok(value(runtime,'filteredRecords().map(r=>r.id)').includes(7));
  runtime.run('Object.assign(reportState,{periodMode:"year",year:"2025"});openReportCategoryRecords("同类","expense")');
  assert.equal(runtime.run('filterState.fromDate'),'2025-01-01');
  assert.equal(runtime.run('filterState.toDate'),'2025-12-31');
  runtime.run('Object.assign(reportState,{periodMode:"range",fromDate:"2026-09-03",toDate:"2026-09-04"});openReportCategoryRecords("同类","income")');
  assert.deepEqual(value(runtime,'filteredRecords().map(r=>r.id)'),[3,4]);
  const before=value(runtime,'filterState');
  runtime.run('reportState.fromDate="2026-09-05";appNotice=()=>{}');
  assert.equal(runtime.run('openReportCategoryRecords("同类","income")'),false);
  assert.deepEqual(value(runtime,'filterState'),before);
});

test("柱形按钮实际绑定正确的类别与方向，综合双向分别跳转且特殊名称安全显示", () => {
  const runtime=createRuntime();loadCharts(runtime);
  runtime.run(`
    globalThis.box={innerHTML:"",querySelectorAll(){globalThis.links=Array.from(this.innerHTML.matchAll(/data-report-link="(\\d+)"/g),match=>({dataset:{reportLink:match[1]}}));return links;}};
    globalThis.calls=[];openReportCategoryRecords=(category,side)=>calls.push({category,side});
    uiState.chartKind="expense";renderBarChart(box,[["餐饮",12]]);links[0].onclick();
    uiState.chartKind="income";renderBarChart(box,[["工资",25]]);links[0].onclick();
    renderCombinedBarChart(box,["同类"],{同类:25},{同类:12});links.forEach(button=>button.onclick());
  `);
  assert.deepEqual(value(runtime,'calls'),[{category:'餐饮',side:'expense'},{category:'工资',side:'income'},{category:'同类',side:'combined'},{category:'同类',side:'expense'},{category:'同类',side:'income'}]);
  runtime.run(`renderBarChart(box,${JSON.stringify([['类别"<script>',12]])})`);
  assert.doesNotMatch(runtime.run('box.innerHTML'),/<script>|onclick=/);
  assert.match(runtime.run('box.innerHTML'),/&quot;&lt;script&gt;/);
});
