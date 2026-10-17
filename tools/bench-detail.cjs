// 只使用内存中生成的账目，测量流水筛选和排序，不读取真实设备或本机账本。
const { performance } = require("node:perf_hooks");
const { createRuntime } = require("../tests/runtime.cjs");

for (const size of [1000, 10000, 50000]) {
  const runtime = createRuntime();
  runtime.run(`
    dataState.records = Array.from({ length: ${size} }, (_, i) => ({
      id: i + 1, type: i % 4 === 0 ? "收入" : "支出", category: "餐饮",
      amountCents: 100, date: "2026-10-" + String(i % 28 + 1).padStart(2, "0"),
      note: "模拟账目 " + i
    }));
    filterState.periodMode = "all";
    filterState.searchKey = "";
  `);
  const times = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    const started = performance.now();
    runtime.run(`(() => {
      const rows = filteredRecords().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return rows.slice(0, 100).length;
    })()`);
    times.push(performance.now() - started);
  }
  times.shift(); // 第一次调用包含运行时预热。
  times.sort((a, b) => a - b);
  const median = (times[2] + times[3]) / 2;
  console.log(`${size} 笔：筛选、排序并选取首批 100 笔，耗时中位数 ${median.toFixed(2)} 毫秒`);
}
