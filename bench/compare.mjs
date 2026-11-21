import fs from 'node:fs';

function loadRuns(mode) {
  return [1, 2, 3, 4, 5].map((i) =>
    JSON.parse(fs.readFileSync(`bench/results/core-bench-${mode}-run-${i}.json`, 'utf-8'))
  );
}

const valuesRuns = loadRuns('values');
const unnestRuns = loadRuns('unnest');

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  const mean = sum / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return {
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
  };
}

console.log('=== OVERALL THROUGHPUT (OPS/SEC) ===');
const valTput = valuesRuns.map((r) => r.metrics.throughputOpsSec);
const unnTput = unnestRuns.map((r) => r.metrics.throughputOpsSec);
console.log('Values Throughput:', valTput, stats(valTput));
console.log('UNNEST Throughput:', unnTput, stats(unnTput));

console.log('\n=== WALL-CLOCK RUN DURATION (MS) ===');
const valDur = valuesRuns.map((r) => r.metrics.durationMs);
const unnDur = unnestRuns.map((r) => r.metrics.durationMs);
console.log('Values Duration:', valDur, stats(valDur));
console.log('UNNEST Duration:', unnDur, stats(unnDur));

console.log('\n=== HEAP USED DELTA (MB) ===');
const valHeap = valuesRuns.map((r) => r.metrics.heapUsedDeltaMb);
const unnHeap = unnestRuns.map((r) => r.metrics.heapUsedDeltaMb);
console.log('Values Heap Delta:', valHeap, stats(valHeap));
console.log('UNNEST Heap Delta:', unnHeap, stats(unnHeap));

const stages = [
  'queueWait',
  'acquireConnection',
  'begin',
  'coalesceRam',
  'sqlJournals',
  'sqlPostings',
  'sqlBalances',
  'sqlHoldings',
  'sqlOrders',
  'sqlTrades',
  'sqlMisc',
  'commit',
  'postCommitCallbacks',
  'totalFlushDuration',
];

console.log('\n=== STAGE-BY-STAGE COMPARISON ===');
stages.forEach((st) => {
  const valSum = valuesRuns.map((r) => r.persistenceTelemetry.stages[st].sumMs);
  const unnSum = unnestRuns.map((r) => r.persistenceTelemetry.stages[st].sumMs);
  const valMean = valuesRuns.map((r) => r.persistenceTelemetry.stages[st].meanMs);
  const unnMean = unnestRuns.map((r) => r.persistenceTelemetry.stages[st].meanMs);
  const valP50 = valuesRuns.map((r) => r.persistenceTelemetry.stages[st].p50Ms);
  const unnP50 = unnestRuns.map((r) => r.persistenceTelemetry.stages[st].p50Ms);
  const valP95 = valuesRuns.map((r) => r.persistenceTelemetry.stages[st].p95Ms);
  const unnP95 = unnestRuns.map((r) => r.persistenceTelemetry.stages[st].p95Ms);
  const valP99 = valuesRuns.map((r) => r.persistenceTelemetry.stages[st].p99Ms);
  const unnP99 = unnestRuns.map((r) => r.persistenceTelemetry.stages[st].p99Ms);

  const avgValSum = (valSum.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgUnnSum = (unnSum.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgValMean = (valMean.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgUnnMean = (unnMean.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgValP50 = (valP50.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgUnnP50 = (unnP50.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgValP95 = (valP95.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgUnnP95 = (unnP95.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgValP99 = (valP99.reduce((a, b) => a + b, 0) / 5).toFixed(2);
  const avgUnnP99 = (unnP99.reduce((a, b) => a + b, 0) / 5).toFixed(2);

  const deltaMs = (Number(avgUnnSum) - Number(avgValSum)).toFixed(2);
  const deltaPct = (((Number(avgUnnSum) - Number(avgValSum)) / Number(avgValSum)) * 100).toFixed(2);

  console.log(
    `${st.padEnd(20)} | Values: ${avgValSum.padStart(8)}ms (Mean/Bat ${avgValMean.padStart(6)}ms, P50 ${avgValP50.padStart(6)}ms, P95 ${avgValP95.padStart(6)}ms, P99 ${avgValP99.padStart(6)}ms) | UNNEST: ${avgUnnSum.padStart(8)}ms (Mean/Bat ${avgUnnMean.padStart(6)}ms, P50 ${avgUnnP50.padStart(6)}ms, P95 ${avgUnnP95.padStart(6)}ms, P99 ${avgUnnP99.padStart(6)}ms) | Delta: ${deltaMs.padStart(8)}ms (${deltaPct}%)`
  );
});

console.log('\n=== FLUSH PERCENTAGE COMPARISON ===');
const totalValFlush = valuesRuns.reduce((acc, r) => acc + r.persistenceTelemetry.stages.totalFlushDuration.sumMs, 0) / 5;
const totalUnnFlush = unnestRuns.reduce((acc, r) => acc + r.persistenceTelemetry.stages.totalFlushDuration.sumMs, 0) / 5;

stages.forEach((st) => {
  if (st === 'queueWait' || st === 'totalFlushDuration') return;
  const valStageSum = valuesRuns.reduce((acc, r) => acc + r.persistenceTelemetry.stages[st].sumMs, 0) / 5;
  const unnStageSum = unnestRuns.reduce((acc, r) => acc + r.persistenceTelemetry.stages[st].sumMs, 0) / 5;
  const valPct = ((valStageSum / totalValFlush) * 100).toFixed(2);
  const unnPct = ((unnStageSum / totalUnnFlush) * 100).toFixed(2);
  console.log(`${st.padEnd(20)} | Values: ${valPct.padStart(6)}% | UNNEST: ${unnPct.padStart(6)}%`);
});
