// 由 Playwright CLI run-code 加载；只测隔离预览内存中的模拟账目，不写存储。
async page => {
  await page.setViewportSize({width:375,height:812});
  const results=await page.evaluate(()=>{
    const stored=JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])));
    const original={records:dataState.records,accounts:dataState.accounts,ui:{...uiState},filters:{...filterState}};
    const cases=[];
    try {
      switchTab('detail');
      filterState.periodMode='all';filterState.fromDate='';filterState.toDate='';
      filterState.account='';filterState.category='';filterState.searchKey='';
      uiState.detailExpanded=true;
      dataState.accounts=[{id:2,name:'模拟微信账户',kind:'资金',initialCents:100000000}];
      for(const total of [1000,10000,50000]) {
        dataState.records=Array.from({length:total},(_,i)=>({id:i+1,type:i%4===0?'收入':'支出',
          category:i%4===0?'工资':'餐饮',amountCents:100,account:2,
          date:'2026-10-'+String(i%28+1).padStart(2,'0'),note:'模拟账目 '+(i+1)}));
        const sorted=[...dataState.records].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
        for(const visible of [100,200,1000]) {
          uiState.detailVisibleCount=visible;
          const samples=[];
          for(let attempt=0;attempt<5;attempt++) {
            const start=performance.now();renderList();
            document.getElementById('list').getBoundingClientRect(); // 包括当前 DOM 的样式及布局。
            if(attempt)samples.push(performance.now()-start);
          }
          samples.sort((a,b)=>a-b);
          const list=document.getElementById('list');
          const ids=[...list.querySelectorAll('[data-act="edit"]')].map(button=>Number(button.dataset.id));
          const dates=[...list.querySelectorAll('.date-head')].map(head=>head.textContent);
          const expected=sorted.slice(0,visible);
          const expectedDates=[...new Set(expected.map(record=>record.date))].map(formatDate);
          const summary=document.getElementById('detailPeriodTotals').textContent;
          cases.push({total,visible,medianMs:Number(((samples[1]+samples[2])/2).toFixed(2)),
            rows:list.querySelectorAll('.row').length,dateGroups:dates.length,
            orderCorrect:JSON.stringify(ids)===JSON.stringify(expected.map(record=>record.id)),
            datesCorrect:JSON.stringify(dates)===JSON.stringify(expectedDates),
            totalsCorrect:summary.includes('¥'+(total/4).toFixed(2))&&summary.includes('¥'+(total*3/4).toFixed(2))&&summary.includes('共 '+total+' 笔')});
        }
        for(const from of [100,900]) {
          const samples=[];
          let oldRowsKept=false,scrollKept=false;
          for(let attempt=0;attempt<5;attempt++) {
            uiState.detailVisibleCount=from;renderList();
            const first=document.querySelector('#list .row');
            window.scrollTo(0,1000);const scroll=window.scrollY;
            const start=performance.now();document.getElementById('detailLoadMore').onclick();
            document.getElementById('list').getBoundingClientRect();
            if(attempt)samples.push(performance.now()-start);
            oldRowsKept=first===document.querySelector('#list .row');scrollKept=window.scrollY===scroll;
          }
          samples.sort((a,b)=>a-b);
          cases.push({total,from,visible:from+100,action:'loadMore',medianMs:Number(((samples[1]+samples[2])/2).toFixed(2)),
            rows:document.querySelectorAll('#list .row').length,oldRowsKept,scrollKept});
        }
      }
    } finally {
      dataState.records=original.records;dataState.accounts=original.accounts;
      Object.assign(filterState,original.filters);Object.assign(uiState,original.ui);
      switchTab(original.ui.activeTab,{replaceHistory:true});renderList();
    }
    return {cases,storageUnchanged:stored===JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))),
      note:'桌面浏览器同步筛选、汇总、DOM 和布局，不代表手机帧率或完整启动时间'};
  });
  await page.evaluate(results=>{window.detailBrowserBenchmark=results;},results);
  return results;
}
