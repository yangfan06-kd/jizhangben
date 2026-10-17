const test = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('./runtime.cjs');

test('compact calendar generates actual days with Monday-first alignment, including leap years',()=>{
  const runtime=createRuntime();
  for(const year of [1900,2000,2026,2028,2100]) for(let month=1;month<=12;month++) {
    const cells=Array.from(runtime.run(`calendarMonthCells(${year},${month})`));
    const first=(new Date(year,month-1,1).getDay()+6)%7;
    const dates=cells.filter(Boolean);
    assert.equal(cells.indexOf(dates[0]),first);
    assert.equal(dates.length,new Date(year,month,0).getDate());
    assert.equal(new Set(dates).size,dates.length);
    assert.ok(dates.every(value=>runtime.run(`!!parseLocalDate(${JSON.stringify(value)})`)));
  }
  assert.equal(runtime.run('calendarMonthCells(2026,13).length'),0);
});
