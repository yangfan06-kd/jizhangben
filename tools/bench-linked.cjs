const {performance} = require("node:perf_hooks");
const {createRuntime} = require("../tests/runtime.cjs");
const {linkedRecords} = require("../tests/fixtures/linked-records.cjs");
const cases = [];
for (const groups of [10, 100, 300]) {
  const runtime = createRuntime();
  runtime.run(`dataState.records=${JSON.stringify(linkedRecords(groups))};
    function measureLinkedTotals() {
      const calculate=()=>dataState.records.reduce((totals,record)=>{
        totals.income+=toCents(incomeEffect(record));totals.expense+=toCents(expenseEffect(record));return totals;
      },{income:0,expense:0});
      return typeof withRecordCalculationIndex === "function" ? withRecordCalculationIndex(dataState.records,calculate) : calculate();
    }`);
  const times = [];
  let totals;
  for (let attempt=0;attempt<4;attempt++) {
    const start=performance.now();
    totals=JSON.parse(runtime.run("JSON.stringify(measureLinkedTotals())"));
    if(attempt)times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  if(totals.income!==groups*3000||totals.expense!==groups*30000)throw new Error("关联金额与独立预期不符");
  cases.push({groups,records:groups*9,medianMs:Number(times[1].toFixed(2)),...totals});
}
process.stdout.write(JSON.stringify({cases,note:"Node 合成关联计算，不含 DOM 或手机帧率"},null,2)+"\n");
