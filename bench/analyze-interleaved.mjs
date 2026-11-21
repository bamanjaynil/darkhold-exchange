import fs from 'node:fs';

const warmup = JSON.parse(fs.readFileSync('bench/results/interleaved-warmup-values.json', 'utf-8'));

const pairs = [
  {
    pair: 1,
    first: { order: 1, mode: 'values', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair1-1-values.json', 'utf-8')) },
    second: { order: 2, mode: 'unnest', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair1-2-unnest.json', 'utf-8')) },
  },
  {
    pair: 2,
    first: { order: 3, mode: 'unnest', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair2-3-unnest.json', 'utf-8')) },
    second: { order: 4, mode: 'values', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair2-4-values.json', 'utf-8')) },
  },
  {
    pair: 3,
    first: { order: 5, mode: 'values', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair3-5-values.json', 'utf-8')) },
    second: { order: 6, mode: 'unnest', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair3-6-unnest.json', 'utf-8')) },
  },
  {
    pair: 4,
    first: { order: 7, mode: 'unnest', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair4-7-unnest.json', 'utf-8')) },
    second: { order: 8, mode: 'values', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair4-8-values.json', 'utf-8')) },
  },
  {
    pair: 5,
    first: { order: 9, mode: 'values', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair5-9-values.json', 'utf-8')) },
    second: { order: 10, mode: 'unnest', data: JSON.parse(fs.readFileSync('bench/results/interleaved-pair5-10-unnest.json', 'utf-8')) },
  },
];

console.log('=== SACRIFICIAL WARM-UP RUN (DISCARDED FROM PAIRED STATS) ===');
console.log(`Throughput: ${warmup.metrics.throughputOpsSec} ops/s | Duration: ${warmup.metrics.durationMs} ms | Postings Mean: ${warmup.persistenceTelemetry.stages.sqlPostings.meanMs} ms | COMMIT Mean: ${warmup.persistenceTelemetry.stages.commit.meanMs} ms | Reconciliation: ${warmup.metrics.postReconciliationBalanced ? 'CLEAN' : 'IMBALANCED'}`);

console.log('\n=== CHRONOLOGICAL 10 RUNS (RUNS 1 TO 10) ===');
const allRuns = [
  { run: 1, pair: 1, mode: 'values', data: pairs[0].first.data },
  { run: 2, pair: 1, mode: 'unnest', data: pairs[0].second.data },
  { run: 3, pair: 2, mode: 'unnest', data: pairs[1].first.data },
  { run: 4, pair: 2, mode: 'values', data: pairs[1].second.data },
  { run: 5, pair: 3, mode: 'values', data: pairs[2].first.data },
  { run: 6, pair: 3, mode: 'unnest', data: pairs[2].second.data },
  { run: 7, pair: 4, mode: 'unnest', data: pairs[3].first.data },
  { run: 8, pair: 4, mode: 'values', data: pairs[3].second.data },
  { run: 9, pair: 5, mode: 'values', data: pairs[4].first.data },
  { run: 10, pair: 5, mode: 'unnest', data: pairs[4].second.data },
];

allRuns.forEach((r) => {
  const m = r.data.metrics;
  const p = r.data.persistenceTelemetry.stages;
  console.log(`Run ${r.run.toString().padStart(2)} (Pair ${r.pair}, ${r.mode.toUpperCase().padEnd(6)}): Throughput=${m.throughputOpsSec} ops/s, Duration=${m.durationMs}ms, PostingsMean=${p.sqlPostings.meanMs}ms, PostingsP50=${p.sqlPostings.p50Ms}ms, CommitMean=${p.commit.meanMs}ms, FlushMean=${p.totalFlushDuration.meanMs}ms, HeapDelta=${m.heapUsedDeltaMb}MB, Balanced=${m.postReconciliationBalanced}`);
});

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

console.log('\n=== PAIRED COMPARISONS (UNNEST - VALUES WITHIN EACH PAIR) ===');
const pairDeltas = pairs.map((p) => {
  const v = p.first.mode === 'values' ? p.first.data : p.second.data;
  const u = p.first.mode === 'unnest' ? p.first.data : p.second.data;

  const tputDelta = u.metrics.throughputOpsSec - v.metrics.throughputOpsSec;
  const tputDeltaPct = (tputDelta / v.metrics.throughputOpsSec) * 100;

  const durDelta = u.metrics.durationMs - v.metrics.durationMs;
  const durDeltaPct = (durDelta / v.metrics.durationMs) * 100;

  const postingsMeanDelta = u.persistenceTelemetry.stages.sqlPostings.meanMs - v.persistenceTelemetry.stages.sqlPostings.meanMs;
  const postingsMeanDeltaPct = (postingsMeanDelta / v.persistenceTelemetry.stages.sqlPostings.meanMs) * 100;

  const flushMeanDelta = u.persistenceTelemetry.stages.totalFlushDuration.meanMs - v.persistenceTelemetry.stages.totalFlushDuration.meanMs;
  const flushMeanDeltaPct = (flushMeanDelta / v.persistenceTelemetry.stages.totalFlushDuration.meanMs) * 100;

  const commitMeanDelta = u.persistenceTelemetry.stages.commit.meanMs - v.persistenceTelemetry.stages.commit.meanMs;
  const commitMeanDeltaPct = (commitMeanDelta / v.persistenceTelemetry.stages.commit.meanMs) * 100;

  return {
    pair: p.pair,
    order: p.first.mode === 'values' ? 'values -> unnest' : 'unnest -> values',
    valuesTput: v.metrics.throughputOpsSec,
    unnestTput: u.metrics.throughputOpsSec,
    tputDelta,
    tputDeltaPct,
    durDelta,
    durDeltaPct,
    valuesPostingsMean: v.persistenceTelemetry.stages.sqlPostings.meanMs,
    unnestPostingsMean: u.persistenceTelemetry.stages.sqlPostings.meanMs,
    postingsMeanDelta,
    postingsMeanDeltaPct,
    valuesFlushMean: v.persistenceTelemetry.stages.totalFlushDuration.meanMs,
    unnestFlushMean: u.persistenceTelemetry.stages.totalFlushDuration.meanMs,
    flushMeanDelta,
    flushMeanDeltaPct,
    valuesCommitMean: v.persistenceTelemetry.stages.commit.meanMs,
    unnestCommitMean: u.persistenceTelemetry.stages.commit.meanMs,
    commitMeanDelta,
    commitMeanDeltaPct,
  };
});

pairDeltas.forEach((d) => {
  console.log(`Pair ${d.pair} (${d.order.padEnd(17)}): Tput: ${d.valuesTput} -> ${d.unnestTput} (Delta: +${d.tputDelta} ops/s, +${d.tputDeltaPct.toFixed(2)}%) | Postings: ${d.valuesPostingsMean.toFixed(2)} -> ${d.unnestPostingsMean.toFixed(2)}ms (Delta: ${d.postingsMeanDelta.toFixed(2)}ms, ${d.postingsMeanDeltaPct.toFixed(2)}%) | Commit: ${d.valuesCommitMean.toFixed(2)} -> ${d.unnestCommitMean.toFixed(2)}ms (${d.commitMeanDelta.toFixed(2)}ms) | Flush: ${d.valuesFlushMean.toFixed(2)} -> ${d.unnestFlushMean.toFixed(2)}ms (${d.flushMeanDelta.toFixed(2)}ms)`);
});

const tputDeltas = pairDeltas.map((d) => d.tputDelta);
const tputDeltaPcts = pairDeltas.map((d) => d.tputDeltaPct);
const postingsDeltas = pairDeltas.map((d) => d.postingsMeanDelta);
const postingsDeltaPcts = pairDeltas.map((d) => d.postingsMeanDeltaPct);
const flushDeltas = pairDeltas.map((d) => d.flushMeanDelta);
const commitDeltas = pairDeltas.map((d) => d.commitMeanDelta);

console.log('\n=== PAIRED SUMMARY STATS (N=5 PAIRS) ===');
console.log('Throughput Delta (ops/s):', stats(tputDeltas));
console.log('Throughput Delta (%):', stats(tputDeltaPcts));
console.log('Postings Insert Delta (ms/batch):', stats(postingsDeltas));
console.log('Postings Insert Delta (%):', stats(postingsDeltaPcts));
console.log('Total Flush Delta (ms/batch):', stats(flushDeltas));
console.log('COMMIT Delta (ms/batch):', stats(commitDeltas));

const postingsWinCount = pairDeltas.filter((d) => d.postingsMeanDelta < 0).length;
const tputWinCount = pairDeltas.filter((d) => d.tputDelta > 0).length;
console.log(`\nWin Rates: Postings Speedup: ${postingsWinCount} / 5 (${(postingsWinCount / 5) * 100}%) | Throughput Gain: ${tputWinCount} / 5 (${(tputWinCount / 5) * 100}%)`);
