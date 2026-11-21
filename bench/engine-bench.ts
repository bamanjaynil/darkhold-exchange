/**
 * @file engine-bench.ts
 * In-process micro-benchmark measuring pure Limit Order Book matching latency and throughput.
 * Uses process.hrtime.bigint() for nanosecond resolution.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { OrderBook } from '../packages/engine/src/orderbook.js';
import { InstrumentConfig, EngineOrderCommand } from '../packages/engine/src/types.js';

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const benchX: InstrumentConfig = {
  id: 'inst_bench_x',
  symbol: 'BENCH-X',
  name: 'Synthetic Stress Benchmark Pass',
  faceValue: 100000,
  collarBps: 5000,
  tickSize: 100,
  minQty: 1,
  maxQtyPerOrder: 100,
  escrowRequired: false,
  isBenchmark: true,
};

async function run() {
  console.log('[BENCH:ENGINE] Initializing OrderBook for BENCH-X...');
  const book = new OrderBook(benchX);
  const rng = mulberry32(42);

  const iterations = 50_000;
  const latenciesNs: number[] = new Array(iterations);
  let totalTrades = 0;

  console.log(`[BENCH:ENGINE] Executing ${iterations.toLocaleString()} orders...`);

  const startTime = process.hrtime.bigint();

  for (let seq = 1; seq <= iterations; seq++) {
    const isBuy = rng() < 0.5;
    const priceOffset = (Math.floor(rng() * 40) - 20) * 100;
    const price = Math.max(100, Math.min(book.ceiling, 100000 + priceOffset));
    const qty = Math.floor(rng() * 5) + 1;
    const userId = `usr_bench_${Math.floor(rng() * 10)}`;

    const cmd: EngineOrderCommand = {
      id: `bench_${seq}`,
      clientOrderId: `bcid_${seq}`,
      seq,
      userId,
      symbol: 'BENCH-X',
      side: isBuy ? 'BUY' : 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price,
      qty,
    };

    const t0 = process.hrtime.bigint();
    const res = book.processOrder(cmd);
    const t1 = process.hrtime.bigint();

    latenciesNs[seq - 1] = Number(t1 - t0);
    totalTrades += res.trades.length;
  }

  const endTime = process.hrtime.bigint();
  const totalDurationMs = Number(endTime - startTime) / 1_000_000;
  const throughputOps = Math.round((iterations / totalDurationMs) * 1000);

  latenciesNs.sort((a, b) => a - b);
  const p50Ns = latenciesNs[Math.floor(iterations * 0.5)];
  const p95Ns = latenciesNs[Math.floor(iterations * 0.95)];
  const p99Ns = latenciesNs[Math.floor(iterations * 0.99)];
  const maxNs = latenciesNs[latenciesNs.length - 1];

  const results = {
    benchmark: 'In-Process Pure Matching Engine',
    timestamp: new Date().toISOString(),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      model: os.cpus()[0]?.model,
      nodeVersion: process.version,
    },
    metrics: {
      totalOrders: iterations,
      tradesExecuted: totalTrades,
      durationMs: Math.round(totalDurationMs * 100) / 100,
      throughputOpsSec: throughputOps,
      latency: {
        unit: 'microseconds',
        p50: Math.round((p50Ns / 1000) * 100) / 100,
        p95: Math.round((p95Ns / 1000) * 100) / 100,
        p99: Math.round((p99Ns / 1000) * 100) / 100,
        max: Math.round((maxNs / 1000) * 100) / 100,
      },
    },
  };

  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'engine-bench.json'), JSON.stringify(results, null, 2));

  console.log('=======================================================');
  console.log(`  ENGINE BENCHMARK COMPLETED:`);
  console.log(`  Throughput:  ${throughputOps.toLocaleString()} orders/sec`);
  console.log(`  p50 Latency: ${(p50Ns / 1000).toFixed(2)} µs`);
  console.log(`  p95 Latency: ${(p95Ns / 1000).toFixed(2)} µs`);
  console.log(`  p99 Latency: ${(p99Ns / 1000).toFixed(2)} µs`);
  console.log(`  Trades:      ${totalTrades.toLocaleString()}`);
  console.log('=======================================================');
}

run().catch(console.error);