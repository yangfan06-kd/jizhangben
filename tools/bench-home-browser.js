// Playwright CLI run-code 模板；启动前将夹具源码插入标记，数据仅在隔离来源生成。
async page => {
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.evaluate(() => {
    /* fixture-source */
    window.makeStage6Fixture = homeFixture;
  });
  const result = await page.evaluate(() => {
    const month = todayStr().slice(0,7), cases=[];
    dataState.currentBookId=1; dataState.books=[{id:1,name:'合成性能账本',category:'个人'}];
    dataState.backendOverview=null;dataState.backendSession=null;dataState.fundProjects=[];dataState.fixedIncomePlan=null;
    resetFilterState();filterState.periodMode='all';uiState.detailExpanded=true;uiState.activeTab='home';
    for(const groups of [10,100,300]) {
      const fixture=makeStage6Fixture(groups,month);
      dataState.records=fixture.records;dataState.accounts=fixture.accounts;
      saveBooks();saveAccounts();save();
      const before=JSON.stringify({records:dataState.records,accounts:dataState.accounts,categories:dataState.categorySystem,icons:dataState.customCategoryIcons});
      const stored=JSON.stringify(Object.entries(localStorage).sort());
      const timings={};
      for(const [name,calculate] of Object.entries({stats:()=>renderStats(),overview:()=>renderOverview(),full:()=>render()})) {
        const samples=[];
        for(let attempt=0;attempt<4;attempt++){
          const start=performance.now();calculate();document.querySelector('.app').getBoundingClientRect();
          if(attempt)samples.push(performance.now()-start);
        }
        samples.sort((a,b)=>a-b);timings[name]={medianMs:+samples[1].toFixed(2),samplesMs:samples.map(n=>+n.toFixed(2))};
      }
      const display={income:document.getElementById('incomeTotal').textContent,expense:document.getElementById('expenseTotal').textContent,net:document.getElementById('netWorth').textContent,recent:document.querySelectorAll('#homeRecentList [data-home-date]').length};
      const netText=(fixture.expected.netCents<0?'−¥':'¥')+(Math.abs(fixture.expected.netCents)/100).toFixed(2);
      const correct=display.income==='+¥'+(fixture.expected.monthIncomeCents/100).toFixed(2)&&display.expense==='−¥'+(fixture.expected.monthExpenseCents/100).toFixed(2)&&display.net===netText;
      const unchanged=before===JSON.stringify({records:dataState.records,accounts:dataState.accounts,categories:dataState.categorySystem,icons:dataState.customCategoryIcons})&&stored===JSON.stringify(Object.entries(localStorage).sort());
      if(!correct||!unchanged)throw Error('金额或只读边界不一致：'+JSON.stringify({groups,display,correct,unchanged}));
      cases.push({groups,records:fixture.records.length,timings,display,correct,unchanged});
    }
    return{cases,userAgent:navigator.userAgent,note:'同一桌面 Edge 来源、390×844；预热一次、三次取中位数；同步调用及强制布局，不等于呈现帧、Android 或冷启动。'};
  });
  return result;
}
