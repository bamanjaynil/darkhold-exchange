/**
 * @file core-bench.ts
 * End-to-end ExchangeCore benchmark including in-memory state mutation,
 * double-entry ledger journals, and PostgreSQL group-commit persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDatabase } from '../apps/server/test/setup.js';
import { bootstrapCore } from '../apps/server/src/recovery.js';
import { SystemClock } from '../apps/server/src/clock.js';
import { runReconciliation } from '../apps/server/src/reconciliation.js';

export async function runCoreBenchmark(iterations = 5_000, batchMax = 500, batchMs = 5) {
  const envBatchMax = process.env.PERSIST_BATCH_MAX ? parseInt(process.env.PERSIST_BATCH_MAX, 10) : undefined;
  const effectiveBatchMax = envBatchMax ?? batchMax;
  const mode = process.env.POSTINGS_WRITE_MODE || 'unnest';
  console.log(`[BENCH:CORE] Setting up test database (POSTINGS_WRITE_MODE=${mode})...`);
  const pool = await setupTestDatabase();
  const clock = new SystemClock();

  console.log(`[BENCH:CORE] Bootstrapping ExchangeCore (PERSIST_BATCH_MAX=${effectiveBatchMax}, PERSIST_BATCH_MS=${batchMs})...`);
  const core = await bootstrapCore(pool, clock, effectiveBatchMax, batchMs, true);

  console.log(`[BENCH:CORE] Submitting ${iterations.toLocaleString()} orders through ExchangeCore + group commit...`);

  if (global.gc) global.gc();
  const initialMemory = process.memoryUsage();
  const startTime = Date.now();
  const promises: Promise<any>[] = [];

  for (let i = 1; i <= iterations; i++) {
    const isBuy = i % 2 === 0;
    const price = 100000;
    const p = core.dispatch({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: `core_bench_${i}`,
        clientOrderId: `core_cid_${i}`,
        seq: 0,
        userId: 'usr_admin',
        symbol: 'BENCH-X',
        side: isBuy ? 'BUY' : 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price,
        qty: 1,
      },
    });
    promises.push(p);
  }

  await Promise.all(promises);
  await core.persistence.flush();

  const totalDurationMs = Date.now() - startTime;
  const finalMemory = process.memoryUsage();
  const heapUsedDeltaMb = Math.round(((finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024)) * 100) / 100;
  const throughputOps = Math.round((iterations / totalDurationMs) * 1000);

  console.log('[BENCH:CORE] Running post-benchmark double-entry ledger reconciliation...');
  const recReport = await runReconciliation(pool, core);

  const persistenceTelemetry = core.persistence.getTelemetry();
  const dispatchTelemetry = core.getDispatchTelemetry();

  const results = {
    benchmark: 'ExchangeCore with Group-Commit Persistence (Instrumented)',
    timestamp: new Date().toISOString(),
    config: {
      batchMax,
      batchMs,
      iterations,
      postingsWriteMode: mode,
    },
    metrics: {
      totalOrders: iterations,
      durationMs: totalDurationMs,
      throughputOpsSec: throughputOps,
      avgLatencyMs: Math.round((totalDurationMs / iterations) * 100) / 100,
      postReconciliationBalanced: recReport.balanced,
      heapUsedDeltaMb,
    },
    dispatchTelemetry,
    persistenceTelemetry,
  };

  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'core-bench.json'), JSON.stringify(results, null, 2));
  if (process.env.RUN_ID) {
    fs.writeFileSync(
      path.join(resultsDir, `core-bench-${mode}-run-${process.env.RUN_ID}.json`),
      JSON.stringify(results, null, 2)
    );
  }

  // Console output formatted report
  const flushes = persistenceTelemetry.counts.flushes;
  const totalFlushSum = persistenceTelemetry.stages.totalFlushDuration.sumMs || 1;

  console.log('\n========================================================================================');
  console.log(`  EXCHANGE CORE PERSISTENCE BENCHMARK RESULTS [MODE: ${mode.toUpperCase()}]`);
  console.log('========================================================================================');
  console.log(`  Throughput:                    ${throughputOps.toLocaleString()} orders/sec`);
  console.log(`  Wall-Clock Run Duration:       ${totalDurationMs} ms (${(totalDurationMs / 1000).toFixed(2)} s)`);
  console.log(`  Cumulative Flush Time:         ${totalFlushSum.toFixed(2)} ms`);
  console.log(`  Reconciliation:                ${recReport.balanced ? 'CLEAN (100% Balanced)' : 'IMBALANCED'}`);
  console.log(`  Heap Used Delta:               ${heapUsedDeltaMb} MB`);
  console.log(`  Total Flushes:                 ${flushes} batches`);
  console.log(`  Avg Batch Size:                ${(iterations / flushes).toFixed(1)} commands/batch`);
  console.log(`  Peak In-Memory Queue Depth:    ${dispatchTelemetry.maxCommandQueueDepth} commands`);
  console.log(`  Peak Persistence Queue Depth:  ${persistenceTelemetry.counts.maxQueueDepth} batches`);
  console.log(`  Failed Txns / Rollbacks:       ${persistenceTelemetry.counts.failedTransactions} / ${persistenceTelemetry.counts.rollbacks}`);

  const qWait = persistenceTelemetry.stages.queueWait;
  console.log(`\n--- ORDER QUEUE LATENCY (INGESTION -> FLUSH START) ---`);
  console.log(`  Cumulative Order-Wait Sum:     ${qWait.sumMs.toFixed(2)} ms (across ${qWait.count} orders)`);
  console.log(`  Per-Order Mean Queue Wait:     ${qWait.meanMs.toFixed(2)} ms`);
  console.log(`  Per-Order P50 / P95 / P99:     ${qWait.p50Ms.toFixed(2)} / ${qWait.p95Ms.toFixed(2)} / ${qWait.p99Ms.toFixed(2)} ms`);

  console.log('\n--- BATCH PERSISTENCE STAGES (CUMULATIVE & PER-BATCH) ---');
  const stageRows: Array<{ name: string; st: any; pct?: number }> = [
    { name: '1. Acquire DB Connection', st: persistenceTelemetry.stages.acquireConnection, pct: persistenceTelemetry.breakdownPct.acquireConnectionPct },
    { name: '2. BEGIN Transaction', st: persistenceTelemetry.stages.begin, pct: persistenceTelemetry.breakdownPct.beginPct },
    { name: '3. Coalesce Deltas in RAM', st: persistenceTelemetry.stages.coalesceRam, pct: persistenceTelemetry.breakdownPct.coalesceRamPct },
    { name: '4a. SQL: Journals Bulk Insert', st: persistenceTelemetry.stages.sqlJournals, pct: Math.round((persistenceTelemetry.stages.sqlJournals.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4b. SQL: Postings Bulk Insert', st: persistenceTelemetry.stages.sqlPostings, pct: Math.round((persistenceTelemetry.stages.sqlPostings.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4c. SQL: Balances Upsert', st: persistenceTelemetry.stages.sqlBalances, pct: Math.round((persistenceTelemetry.stages.sqlBalances.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4d. SQL: Holdings Upsert', st: persistenceTelemetry.stages.sqlHoldings, pct: Math.round((persistenceTelemetry.stages.sqlHoldings.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4e. SQL: Orders Upsert', st: persistenceTelemetry.stages.sqlOrders, pct: Math.round((persistenceTelemetry.stages.sqlOrders.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4f. SQL: Trades Bulk Insert', st: persistenceTelemetry.stages.sqlTrades, pct: Math.round((persistenceTelemetry.stages.sqlTrades.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '4g. SQL: Misc (Auctions/Escrow)', st: persistenceTelemetry.stages.sqlMisc, pct: Math.round((persistenceTelemetry.stages.sqlMisc.sumMs / totalFlushSum) * 10000) / 100 },
    { name: '5. COMMIT (Triggers + WAL fsync)', st: persistenceTelemetry.stages.commit, pct: persistenceTelemetry.breakdownPct.commitPct },
    { name: '6. Post-Commit Callbacks', st: persistenceTelemetry.stages.postCommitCallbacks, pct: persistenceTelemetry.breakdownPct.postCommitCallbacksPct },
    { name: 'TOTAL FLUSH DURATION', st: persistenceTelemetry.stages.totalFlushDuration, pct: 100.0 },
  ];

  console.log(
    '| ' +
      'Persistence Flush Stage'.padEnd(34) +
      ' | ' +
      'Cumul (ms)'.padStart(10) +
      ' | ' +
      'Mean/Bat(ms)'.padStart(12) +
      ' | ' +
      'P50 (ms)'.padStart(9) +
      ' | ' +
      'P95 (ms)'.padStart(9) +
      ' | ' +
      'P99 (ms)'.padStart(9) +
      ' | ' +
      '% Flush'.padStart(8) +
      ' |'
  );
  console.log('|' + '-'.repeat(36) + '|' + '-'.repeat(12) + '|' + '-'.repeat(14) + '|' + '-'.repeat(11) + '|' + '-'.repeat(11) + '|' + '-'.repeat(11) + '|' + '-'.repeat(10) + '|');

  for (const row of stageRows) {
    const pctStr = row.pct !== undefined ? `${row.pct.toFixed(2)}%` : '-';
    console.log(
      '| ' +
        row.name.padEnd(34) +
        ' | ' +
        row.st.sumMs.toFixed(2).padStart(10) +
        ' | ' +
        row.st.meanMs.toFixed(2).padStart(12) +
        ' | ' +
        row.st.p50Ms.toFixed(2).padStart(9) +
        ' | ' +
        row.st.p95Ms.toFixed(2).padStart(9) +
        ' | ' +
        row.st.p99Ms.toFixed(2).padStart(9) +
        ' | ' +
        pctStr.padStart(8) +
        ' |'
    );
  }

  console.log('\n--- QUERY COUNTS PER CATEGORY ---');
  const counts = persistenceTelemetry.counts;
  console.log(`  BEGIN Queries:             ${counts.queryCountBegin} (${(counts.queryCountBegin / flushes).toFixed(1)}/batch)`);
  console.log(`  Journals Queries:          ${counts.queryCountJournals} (${(counts.queryCountJournals / flushes).toFixed(1)}/batch) [${counts.totalJournals} rows]`);
  console.log(`  Postings Queries:          ${counts.queryCountPostings} (${(counts.queryCountPostings / flushes).toFixed(1)}/batch) [${counts.totalPostings} rows]`);
  console.log(`  Balances Queries:          ${counts.queryCountBalances} (${(counts.queryCountBalances / flushes).toFixed(1)}/batch) [${counts.totalBalanceUpdates} coalesced updates]`);
  console.log(`  Holdings Queries:          ${counts.queryCountHoldings} (${(counts.queryCountHoldings / flushes).toFixed(1)}/batch) [${counts.totalHoldingUpdates} coalesced updates]`);
  console.log(`  Orders Queries:            ${counts.queryCountOrders} (${(counts.queryCountOrders / flushes).toFixed(1)}/batch) [${counts.totalOrdersUpserted} upserts]`);
  console.log(`  Trades Queries:            ${counts.queryCountTrades} (${(counts.queryCountTrades / flushes).toFixed(1)}/batch) [${counts.totalTradesInserted} trades]`);
  console.log(`  COMMIT Queries:            ${counts.queryCountCommit} (${(counts.queryCountCommit / flushes).toFixed(1)}/batch)`);
  console.log(`  TOTAL SQL Queries:         ${counts.totalQueriesExecuted} (${(counts.totalQueriesExecuted / flushes).toFixed(1)}/batch)`);

  console.log('\n--- IN-MEMORY DISPATCH & CPU ---');
  console.log(`  Total Commands Dispatched: ${dispatchTelemetry.totalCommandsDispatched}`);
  console.log(`  Mean Engine Exec Time:     ${dispatchTelemetry.commandExecution.meanMs.toFixed(4)} ms`);
  console.log(`  P50 / P95 / P99 Exec Time: ${dispatchTelemetry.commandExecution.p50Ms.toFixed(4)} / ${dispatchTelemetry.commandExecution.p95Ms.toFixed(4)} / ${dispatchTelemetry.commandExecution.p99Ms.toFixed(4)} ms`);
  console.log('========================================================================================\n');

  await pool.end();
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCoreBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
