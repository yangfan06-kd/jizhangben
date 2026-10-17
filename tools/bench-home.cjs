// 不访问真实账本：VM 内生成账目，计时不包含夹具生成或运行时加载。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createRuntime } = require('../tests/runtime.cjs');
const { homeFixture } = require('../tests/fixtures/home-records.cjs');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const cases = [];
for (const groups of [10, 100, 300]) {
  const fixture = homeFixture(groups);
  const runtime = createRuntime({ untouched: '保留样例存储' }, { sourceRoot: source });
  runtime.run(fs.readFileSync(path.join(source, 'js/view.js'), 'utf8'));
  runtime.run(`dataState.accounts=${JSON.stringify(fixture.accounts)};dataState.records=${JSON.stringify(fixture.records)};
    globalThis.nodes={};globalThis.document={getElementById(id){return nodes[id]||(nodes[id]={textContent:''});}};
    isThisMonth=date=>String(date).startsWith('2026-10');`);
  const before = runtime.run('JSON.stringify({records:dataState.records,accounts:dataState.accounts})');
  const stored = runtime.localStorage.toObject();
  const timings = {};
  for (const [name, expression] of Object.entries({ net: 'computeNetWorthFor(dataState.accounts,dataState.records)', stats: 'renderStats()' })) {
    const samples = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const start = performance.now();
      runtime.run(expression);
      if (attempt) samples.push(performance.now() - start);
    }
    samples.sort((a,b)=>a-b);
    timings[name] = { medianMs: Number(samples[1].toFixed(2)), samplesMs: samples.map(n=>Number(n.toFixed(2))) };
  }
  const netCents = runtime.run('toCents(computeNetWorthFor(dataState.accounts,dataState.records))');
  assert.equal(netCents, fixture.expected.netCents);
  assert.equal(runtime.run('nodes.incomeTotal.textContent'), '+¥' + (fixture.expected.monthIncomeCents / 100).toFixed(2));
  assert.equal(runtime.run('nodes.expenseTotal.textContent'), '−¥' + (fixture.expected.monthExpenseCents / 100).toFixed(2));
  assert.equal(runtime.run('JSON.stringify({records:dataState.records,accounts:dataState.accounts})'), before);
  assert.deepEqual(runtime.localStorage.toObject(), stored);
  cases.push({ groups, records: fixture.records.length, timings, netCents, correct: true, unchanged: true });
}
process.stdout.write(JSON.stringify({ source, node: process.version, cpu: os.cpus()[0]?.model,
  cases, note: '同机 Node/VM 同步计算；不含 DOM、手机帧率、冷启动或长期内存。预热一次，三次取中位数。' }, null, 2) + '\n');
