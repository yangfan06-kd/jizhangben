// Playwright CLI run-code；与 linked-records.cjs 相同业务样例，仅生成预览内存数据。
async page => {
  await page.setViewportSize({width:375,height:812});
  const result=await page.evaluate(()=>{
    window.makeLinkedFixture=groups=>{
      const rows=[];
      for(let group=0;group<groups;group++) {
        const id=group*10;
        const add=(offset,type,cents,date,extra={})=>rows.push({id:id+offset,type,amountCents:cents,amount:cents/100,account:1,date,note:'模拟关联 '+(id+offset),...(type==='押金'?{category:'其他',depositTarget:'模拟房东'}:{}),...extra});
        add(1,'支出',10000,'2025-12-31',{category:'餐饮'});
        add(2,'退款',6000,'2026-01-02',{refundLinkId:id+1});
        add(3,'退款',5000,'2026-02-02',{refundLinkId:id+1});
        add(4,'支出',20000,'2025-12-31',{category:'交通'});
        add(5,'报销',12000,'2026-01-03',{reimbursementLinkId:id+4});
        add(6,'报销',10000,'2026-02-03',{reimbursementLinkId:id+4});
        add(7,'押金',100000,'2025-12-31',{depositDir:'付'});
        add(8,'押金',20000,'2026-01-04',{depositDir:'退回',depositLinkId:id+7,depositFinal:false});
        add(9,'押金',50000,'2026-02-04',{depositDir:'退回',depositLinkId:id+7,depositFinal:true});
      }
      return rows;
    };
    switchTab('detail');resetFilterState();filterState.periodMode='all';uiState.detailExpanded=true;
    dataState.accounts=[{id:1,name:'模拟微信',kind:'资金',initial:1000000,initialCents:100000000}];
    const stored=JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])));
    const cases=[];
    for(const groups of [100,300,1000]) {
      dataState.records=makeLinkedFixture(groups);uiState.detailVisibleCount=100;
      const samples=[];
      for(let attempt=0;attempt<4;attempt++) {
        const start=performance.now();renderList();document.getElementById('list').getBoundingClientRect();
        if(attempt)samples.push(performance.now()-start);
      }
      samples.sort((a,b)=>a-b);
      const summary=document.getElementById('detailPeriodTotals').textContent;
      cases.push({records:groups*9,medianMs:Number(samples[1].toFixed(2)),rows:document.querySelectorAll('#list .row').length,
        correct:summary.includes('¥'+(groups*30).toFixed(2))&&summary.includes('¥'+(groups*300).toFixed(2))&&summary.includes('共 '+groups*9+' 笔')});
    }
    dataState.records=makeLinkedFixture(1);renderAccountSelects();refreshDetail();
    return {cases,storageUnchanged:stored===JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))};
  });
  await page.evaluate(result=>{window.linkedBrowserBenchmark=result;},result);
  return result;
}
