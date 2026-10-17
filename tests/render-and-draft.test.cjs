const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime.cjs");

function loadScript(runtime, name) {
  runtime.run(fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8"));
}

test("首页统计反复刷新仍读取本次账目，负收入、跨期结算及净资产不串用上次结果", () => {
  const {homeFixture} = require('./fixtures/home-records.cjs');
  const fixture=homeFixture(2);
  const runtime=createRuntime({existing:'保留'});
  loadScript(runtime,'view.js');
  runtime.run(`dataState.accounts=${JSON.stringify(fixture.accounts)};dataState.records=${JSON.stringify(fixture.records)};
    globalThis.nodes={};globalThis.document={getElementById(id){return nodes[id]||(nodes[id]={textContent:''});}};
    isThisMonth=date=>String(date).startsWith('2026-10');renderStats();`);
  assert.equal(runtime.run('nodes.incomeTotal.textContent'), '+¥470.00');
  assert.equal(runtime.run('nodes.expenseTotal.textContent'), '−¥750.00');
  assert.equal(runtime.run('nodes.netWorth.textContent'), '¥2994120.00');
  runtime.run('dataState.records.find(r=>r.id===26).amountCents=8500;renderStats()');
  assert.equal(runtime.run('nodes.expenseTotal.textContent'), '−¥760.00');
  assert.equal(runtime.run('nodes.netWorth.textContent'), '¥2994110.00');
  assert.equal(runtime.run('activeRecordCalculationIndex'), null);
  assert.deepEqual(runtime.localStorage.toObject(),{existing:'保留'});
});

function createDraftEventRuntime(initialStorage = {}) {
  const runtime = createRuntime(Object.assign({jizhangben_records_1: '[{"id":9,"amountCents":1200}]'}, initialStorage));
  runtime.run(`
    dataState.currentBookId=1;
    dataState.records=[{id:9,amountCents:1200}];
    dataState.accounts=[{id:2,name:"微信",kind:"资金"}];
    dataState.categorySystem={groups:[{key:"food",name:"食品酒水",side:"expense",items:["餐饮"]}],hidden:[]};
    uiState.activeTab="record";uiState.editingRecordId=null;uiState.selectedType="支出";uiState.selectedCategory="餐饮";
    globalThis.recordKeyboardExpression="12+3";globalThis.recordKeyboardTargetId="amount";
    globalThis.draftFields={amount:{type:"text",value:"15"},note:{type:"text",value:"未保存午餐"},date:{type:"date",value:todayStr()},accountSel:{type:"select-one",value:"2"}};
    Object.values(draftFields).forEach(field=>field.closest=()=>true);
    globalThis.draftDocumentListeners={};globalThis.draftWindowListeners={};globalThis.draftTimers=[];
    globalThis.document={visibilityState:"visible",getElementById(id){return draftFields[id]||null;},addEventListener(name,callback){draftDocumentListeners[name]=callback;}};
    window.addEventListener=(name,callback)=>{draftWindowListeners[name]=callback;};
    window.setTimeout=callback=>{draftTimers.push(callback);};
    renderTypeChips=()=>{};renderCategoryChips=()=>{};updateFormFields=()=>{};syncAccountPickerValue=()=>{};
    setRecordKeyboardExpression=value=>{recordKeyboardExpression=value;};
  `);
  loadScript(runtime,"record-draft.js");
  runtime.run("bindRecordDraftEvents()");
  return runtime;
}

test("最后一次输入即时保存草稿，页面重载后只恢复表单，不生成流水", () => {
  const runtime=createDraftEventRuntime();
  runtime.run('draftDocumentListeners.input({target:draftFields.amount})');
  assert.equal(runtime.run("draftTimers.length"),0);
  assert.equal(runtime.run("readRecordDraft().expression"),"12+3");
  assert.equal(runtime.run("readRecordDraft().fields.note"),"未保存午餐");
  const stored=runtime.localStorage.toObject();
  const restarted=createDraftEventRuntime(stored);
  restarted.run('draftFields.amount.value="";draftFields.note.value="";recordKeyboardExpression=""');
  assert.equal(restarted.run("dataState.records.length"),1);
  assert.equal(restarted.run("draftFields.amount.value"),"");
  restarted.run("restoreRecordDraft(readRecordDraft())");
  assert.equal(restarted.run("draftFields.amount.value"),"15");
  assert.equal(restarted.run("draftFields.note.value"),"未保存午餐");
  assert.equal(restarted.run("recordKeyboardExpression"),"12+3");
  assert.equal(restarted.run("dataState.records.length"),1);
  assert.deepEqual(restarted.localStorage.toObject(),stored);
});

test("切到后台和页面离开补存最后状态，不等待点击回调，也不改写已保存数据", () => {
  const runtime=createDraftEventRuntime();
  const records=runtime.localStorage.getItem("jizhangben_records_1");
  runtime.run('draftDocumentListeners.click({target:draftFields.note});draftFields.note.value="后台前最后一次输入";document.visibilityState="hidden";draftDocumentListeners.visibilitychange()');
  assert.equal(runtime.run("draftTimers.length"),1);
  assert.equal(runtime.run("readRecordDraft().fields.note"),"后台前最后一次输入");
  runtime.run('draftFields.date.value="2026-10-01";draftWindowListeners.pagehide()');
  assert.equal(runtime.run("readRecordDraft().fields.date"),"2026-10-01");
  assert.equal(runtime.localStorage.getItem("jizhangben_records_1"),records);
  runtime.run("dataState.currentBookId=2");
  assert.equal(runtime.run("readRecordDraft()"),null);
});

test("编辑旧流水或恢复中的表单不被后台补存成新草稿", () => {
  const runtime=createDraftEventRuntime();
  runtime.run("saveRecordDraft()");
  const stored=runtime.localStorage.toObject();
  runtime.run('uiState.editingRecordId=9;draftFields.note.value="旧流水编辑内容";document.visibilityState="hidden";draftDocumentListeners.visibilitychange();draftWindowListeners.pagehide()');
  assert.deepEqual(runtime.localStorage.toObject(),stored);
  runtime.run('uiState.editingRecordId=null;recordDraftRestoring=true;draftDocumentListeners.change({target:draftFields.note})');
  assert.deepEqual(runtime.localStorage.toObject(),stored);
});

test("草稿存储失败时保留表单和原草稿，不清除账目", () => {
  const runtime=createDraftEventRuntime();
  runtime.run("saveRecordDraft()");
  const stored=runtime.localStorage.toObject();
  runtime.localStorage.setItem=()=>{throw new Error("模拟存储不可用");};
  assert.doesNotThrow(()=>runtime.run('draftFields.note.value="仍在页面上的新备注";draftDocumentListeners.input({target:draftFields.note})'));
  assert.equal(runtime.run("draftFields.note.value"),"仍在页面上的新备注");
  assert.deepEqual(runtime.localStorage.toObject(),stored);
});

test("未保存的记账草稿使用独立键，跨账本不会恢复，也不改写流水", () => {
  const records = JSON.stringify([{ id: 9, type: "支出", category: "餐饮", amountCents: 1200, date: "2026-10-01" }]);
  const runtime = createRuntime({ jizhangben_records_1: records });
  runtime.run(`
    dataState.currentBookId = 1;
    dataState.accounts = [{ id: 2, name: "微信", kind: "资金" }];
    dataState.categorySystem = { groups: [{ key: "food", name: "食品酒水", side: "expense", items: ["餐饮"] }], hidden: [] };
    uiState.activeTab = "record";
    uiState.selectedType = "支出";
    uiState.selectedCategory = "餐饮";
    globalThis.document = { getElementById(id) { return ({
      amount: { type: "text", value: "28.50" },
      note: { type: "text", value: "午餐" },
      date: { type: "date", value: "2026-10-10" },
      accountSel: { type: "select-one", value: "2" }
    })[id] || null; } };
  `);
  loadScript(runtime, "record-draft.js");
  runtime.run("saveRecordDraft()");
  assert.equal(runtime.localStorage.getItem("jizhangben_records_1"), records);
  assert.equal(runtime.run("readRecordDraft().fields.note"), "午餐");
  runtime.run("dataState.currentBookId = 2");
  assert.equal(runtime.run("readRecordDraft()"), null);
  runtime.run("clearRecordDraft()");
  assert.equal(runtime.localStorage.getItem("record-form-draft-v1"), null);
});

test("流水分批显示时，汇总仍包含全部匹配记录", () => {
  const runtime = createRuntime();
  runtime.run(`
    const nodes = {};
    function node() {
      return { style: {}, children: [], hidden: false, appendChild(child) { this.children.push(child); },
        querySelectorAll() { return []; }, set innerHTML(value) { this.html = value; this.children = []; },
        get innerHTML() { return this.html || ""; } };
    }
    globalThis.document = {
      getElementById(id) { return nodes[id] || (nodes[id] = node()); },
      createElement() { return node(); }
    };
    window.scrollY = 0;
    window.scrollTo = () => {};
    filterState.periodMode = "all";
    uiState.activeTab = "detail";
    uiState.detailExpanded = true;
    dataState.records = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1, type: "支出", category: "餐饮", amount: 1, amountCents: 100,
      date: "2026-10-10", note: ""
    }));
  `);
  loadScript(runtime, "view.js");
  runtime.run("renderList()");
  assert.equal(runtime.run('document.getElementById("list").children.filter(x => x.className === "row").length'), 100);
  assert.match(runtime.run('document.getElementById("detailPeriodTotals").innerHTML'), /共 250 笔/);
  assert.match(runtime.run('document.getElementById("detailLoadMore").textContent'), /剩余 150 笔/);
  runtime.run('document.getElementById("detailLoadMore").onclick()');
  assert.equal(runtime.run('document.getElementById("list").children.filter(x => x.className === "row").length'), 200);
  assert.match(runtime.run('document.getElementById("detailPeriodTotals").innerHTML'), /共 250 笔/);
});

function createDetailNavigationRuntime() {
  const runtime = createRuntime({ old_records: "旧流水", old_categories: "自定义目录" });
  runtime.run(`
    globalThis.nodes = {};
    function detailNode() {
      return { style: {}, children: [], hidden: false,
        appendChild(child) { this.children.push(child); }, querySelectorAll() { return []; },
        setAttribute() {}, set innerHTML(value) { this.html=value;this.children=[]; },
        get innerHTML() { return this.html || ""; } };
    }
    globalThis.document = {
      getElementById(id) { return nodes[id] || (nodes[id]=detailNode()); },
      createElement() { return detailNode(); }, querySelector() { return null; }, querySelectorAll() { return []; }
    };
    window.scrollY=0;window.scrollTo=(_, y)=>{window.scrollY=y;};
    dataState.currentBookId=1;filterState.periodMode="all";
    dataState.records=Array.from({length:250},(_,i)=>({id:i+1,type:"支出",category:"餐饮",account:2,
      amountCents:100,date:"2026-10-10",note:""}));
  `);
  loadScript(runtime, "view.js");
  runtime.run(`renderDetailPeriodCards=()=>{};renderChart=()=>{};renderDetailFilters=()=>{};`);
  return runtime;
}

test("再次进入相同流水保留已加载数量和位置，仍汇总全部账目且不写入存储", () => {
  const runtime=createDetailNavigationRuntime();
  const stored=runtime.localStorage.toObject();
  const records=runtime.run("JSON.stringify(dataState.records)");
  runtime.run('switchTab("detail");document.getElementById("detailLoadMore").onclick();window.scrollY=4200;switchTab("home");window.scrollY=50;switchTab("detail")');
  assert.equal(runtime.run("uiState.detailVisibleCount"),200);
  assert.equal(runtime.run("window.scrollY"),4200);
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="row").length'),200);
  assert.match(runtime.run("nodes.detailPeriodTotals.innerHTML"),/共 250 笔/);
  assert.equal(runtime.run("JSON.stringify(dataState.records)"),records);
  assert.deepEqual(runtime.localStorage.toObject(),stored);
});

test("账户筛选或账本变化时不复用原流水的分页和位置", () => {
  for (const change of ['filterState.account="2"', 'dataState.currentBookId=2', 'filterState.periodMode="year";filterState.year="2025"']) {
    const runtime=createDetailNavigationRuntime();
    runtime.run('switchTab("detail");document.getElementById("detailLoadMore").onclick();window.scrollY=4200;switchTab("home")');
    runtime.run(change);
    runtime.run('switchTab("detail")');
    assert.equal(runtime.run("uiState.detailVisibleCount"),100,change);
    assert.equal(runtime.run("window.scrollY"),0,change);
  }
});

test("重新筛选或重置后旧位置失效，不影响原有返回首页行为", () => {
  const runtime=createDetailNavigationRuntime();
  runtime.run('switchTab("detail");document.getElementById("detailLoadMore").onclick();window.scrollY=4200;switchTab("home");resetFilterState();filterState.periodMode="all";switchTab("detail")');
  assert.equal(runtime.run("uiState.detailVisibleCount"),100);
  assert.equal(runtime.run("window.scrollY"),0);
  runtime.run('document.getElementById("detailLoadMore").onclick();refreshDetail()');
  assert.equal(runtime.run("uiState.detailVisibleCount"),100);
  runtime.run('switchTab("home",{replaceHistory:true})');
  assert.equal(runtime.run("uiState.activeTab"),"home");
});

test("继续加载保留原行，跨日期只补一个标题，汇总始终覆盖全量", () => {
  const runtime=createDetailNavigationRuntime();
  runtime.run('dataState.records.forEach(record=>{record.date=record.id>150?"2026-10-10":"2026-10-09";});switchTab("detail");globalThis.firstRow=nodes.list.children.find(x=>x.className==="row");nodes.detailLoadMore.onclick()');
  assert.equal(runtime.run('nodes.list.children.find(x=>x.className==="row")===firstRow'),true);
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="row").length'),200);
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="date-head").length'),2);
  runtime.run('nodes.detailLoadMore.onclick()');
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="row").length'),250);
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="date-head").length'),2);
  assert.equal(runtime.run('nodes.detailLoadMore.hidden'),true);
  assert.equal(runtime.run('nodes.detailLoadMore.onclick'),null);
  assert.match(runtime.run('nodes.detailPeriodTotals.innerHTML'),/共 250 笔/);
});

test("过期加载事件不能把旧筛选或旧数据追加到新列表，正常刷新仍重算金额", () => {
  const runtime=createDetailNavigationRuntime();
  runtime.run('switchTab("detail");globalThis.oldMore=nodes.detailLoadMore.onclick;filterState.account="不存在";refreshDetail();oldMore()');
  assert.equal(runtime.run('uiState.detailVisibleCount'),100);
  assert.equal(runtime.run('nodes.list.children.length'),0);
  runtime.run('filterState.account="";refreshDetail();oldMore=nodes.detailLoadMore.onclick;oldMore();oldMore()');
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="row").length'),100);
  runtime.run('filterState.account="";refreshDetail();oldMore=nodes.detailLoadMore.onclick;dataState.records=dataState.records.slice(0,2);renderList();oldMore()');
  assert.equal(runtime.run('uiState.detailVisibleCount'),100);
  assert.equal(runtime.run('nodes.list.children.filter(x=>x.className==="row").length'),2);
  runtime.run('dataState.records[0].amountCents=200;renderList()');
  assert.match(runtime.run('nodes.detailPeriodTotals.innerHTML'),/¥3\.00/);
});

test("跨期关联流水刷新与分页沿用完整原账计算，修改后不复用旧索引", () => {
  const runtime=createDetailNavigationRuntime();
  const {linkedRecords}=require("./fixtures/linked-records.cjs");
  runtime.run(`dataState.records=${JSON.stringify(linkedRecords(2))};filterState.fromDate="2026-02-01";filterState.toDate="2026-02-28";uiState.detailExpanded=true;refreshDetail()`);
  assert.match(runtime.run('nodes.detailPeriodTotals.innerHTML'),/¥60\.00/);
  assert.match(runtime.run('nodes.detailPeriodTotals.innerHTML'),/¥360\.00/);
  runtime.run('dataState.records.find(r=>r.id===9).amountCents=60000;refreshDetail()');
  assert.match(runtime.run('nodes.detailPeriodTotals.innerHTML'),/¥260\.00/);
});

test("首页最近五笔按日期及同日编号倒序，读取不改原记录与旧类别存储", () => {
  const saved={jizhangben_records_1:'[{"id":7,"category":"用户餐饮"}]',ledger_category_system_v1:'{"groups":[{"key":"old","name":"旧大类","items":["用户餐饮"]}],"hidden":["隐藏小类"]}'};
  const runtime=createRuntime(saved);
  loadScript(runtime,"view.js");
  const records=[{id:2,date:"2026-10-15"},{id:7,date:"2026-09-01"},{id:3,date:"2026-10-15"},{id:4,date:"2026-10-12"},{id:9,date:"2025-12-31"},{id:5,date:"2026-10-10"},{id:6,date:"2026-10-01"}];
  runtime.run('dataState.records='+JSON.stringify(records));
  const before=runtime.run('JSON.stringify(dataState)');
  assert.equal(runtime.run('homeRecentRecords().map(r=>r.id).join(",")'),"3,2,4,5,6");
  assert.equal(runtime.run('JSON.stringify(dataState)'),before);
  assert.deepEqual(runtime.localStorage.toObject(),saved);
  runtime.run('dataState.records.push({id:"new-local",date:"2026-10-16"})');
  assert.equal(runtime.run('homeRecentRecords()[0].id'),"new-local");
  runtime.run('dataState.records=[]');
  assert.equal(runtime.run('homeRecentRecords().length'),0);
});

test("首页期间汇总不受流水遗留筛选影响，返回完整账本而不改筛选或存储", () => {
  const runtime=createRuntime({old_category_icons:'{"自定义":"dining"}'});
  loadScript(runtime,"view.js");
  runtime.run('dataState.records=[{id:1,date:todayStr(),account:1,category:"餐饮"},{id:2,date:todayStr(),account:2,category:"工资"}];Object.assign(filterState,{account:"missing",category:"missing",searchKey:"missing",fromDate:"2000-01-01",toDate:"2000-01-02"})');
  const before=runtime.run('JSON.stringify({dataState,filterState})'),stored=runtime.localStorage.toObject();
  assert.equal(runtime.run('detailPeriodRecords("today").length'),2);
  assert.equal(runtime.run('JSON.stringify({dataState,filterState})'),before);
  assert.deepEqual(runtime.localStorage.toObject(),stored);
});

test("首页最近流水复用原金额语义并转义用户名称，基金押金本金保持中性", () => {
  const runtime=createRuntime();
  loadScript(runtime,"view.js");
  runtime.run(`globalThis.homeBox={innerHTML:""};globalThis.document={getElementById:id=>id==="homeRecentList"?homeBox:null};
    dataState.accounts=[{id:1,name:'<私人账户>'}];
    dataState.records=[{id:1,type:"收入",category:'<自定义收入>',account:1,amountCents:-100,date:"2026-10-15"},{id:2,type:"押金",category:"租房",depositDir:"付",account:1,amountCents:100000,date:"2026-10-15"},{id:3,type:"转账",category:"基金",fundAction:"contribution",fundMode:"recurring",account:1,amountCents:10000,date:"2026-10-15"}];renderHomeRecentRecords();`);
  const html=runtime.run('homeBox.innerHTML');
  assert.ok(html.includes('&lt;自定义收入&gt;'));
  assert.ok(html.includes('&lt;私人账户&gt;'));
  assert.ok(html.includes('home-recent-amount income">−¥1.00'));
  assert.ok(html.includes('home-recent-amount neutral">−¥1000.00'));
  assert.ok(html.includes('home-recent-amount neutral">¥100.00'));
  assert.ok(html.includes('基金定投'));
});
