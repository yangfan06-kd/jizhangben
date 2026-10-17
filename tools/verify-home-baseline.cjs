// 与本轮开始的源码快照对照；只读取源码，全部账本使用 VM 内存存储。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createRuntime}=require('../tests/runtime.cjs');
const {homeFixture}=require('../tests/fixtures/home-records.cjs');
const beforeRoot=path.resolve(process.argv[2]||'output/playwright/stage6/before');
const currentRoot=path.resolve(__dirname,'..');
function runtimeFor(root,fixture){
  const runtime=createRuntime({untouched:'样例设置'},{sourceRoot:root});
  runtime.run(fs.readFileSync(path.join(root,'js/view.js'),'utf8'));
  runtime.run(`dataState.accounts=${JSON.stringify(fixture.accounts)};dataState.records=${JSON.stringify(fixture.records)};
    globalThis.nodes={};globalThis.document={getElementById(id){return nodes[id]||(nodes[id]={textContent:''});}};
    isThisMonth=date=>String(date).startsWith('2026-10');`);
  return runtime;
}
const fixture=homeFixture(10),snapshots=[];
for(const source of [beforeRoot,currentRoot]){
  const runtime=runtimeFor(source,fixture),stored=runtime.localStorage.toObject();
  const snapshot=runtime.run(`JSON.stringify({net:computeNetWorthFor(dataState.accounts,dataState.records),balances:computeBalances(),
    rows:dataState.records.map(r=>({id:r.id,income:incomeEffect(r),expense:expenseEffect(r),text:amountText(r),loan:loanOutstandingFor(r),pay:payOutstandingFor(r)}))})`);
  assert.deepEqual(runtime.localStorage.toObject(),stored);snapshots.push(snapshot);
}
assert.equal(snapshots[0],snapshots[1]);
const plain=[];
for(const size of [1000,10000,50000]){
  const fixture={accounts:[{id:1,name:'样例账户',kind:'资金',initialCents:100000000}],records:Array.from({length:size},(_,i)=>({id:i+1,type:i%4===0?'收入':'支出',amountCents:100,account:1,date:'2026-10-'+String(i%16+1).padStart(2,'0')}))};
  const pair={records:size};
  for(const [label,root] of [['before',beforeRoot],['after',currentRoot]]){
    const runtime=runtimeFor(root,fixture),samples=[];
    for(let attempt=0;attempt<6;attempt++){
      const start=performance.now();runtime.run('renderStats()');
      if(attempt)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);pair[label]={medianMs:+samples[2].toFixed(2),samplesMs:samples.map(n=>+n.toFixed(2))};
    assert.equal(runtime.run('toCents(computeNetWorthFor(dataState.accounts,dataState.records))'),100000000-size*50);
    assert.equal(runtime.run('withRecordCalculationIndex(dataState.records,()=>{computeNetWorthFor(dataState.accounts,dataState.records);return activeRecordCalculationIndex.index===null})'),true);
  }
  plain.push(pair);
}
process.stdout.write(JSON.stringify({perRecordComparison:{records:fixture.records.length,identical:true,storageUnchanged:true},plain,
  note:'普通账目不创建关联索引；同机 VM 测量，预热一次、五次取中位数。不是手机耗时。'},null,2)+'\n');
