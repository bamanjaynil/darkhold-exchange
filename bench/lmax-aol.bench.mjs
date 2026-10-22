import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { OrderBook } from '../packages/engine/dist/index.js';
import { AppendOnlyJournal } from '../apps/server/dist/aol.js';
import { LockFreeRingBuffer } from '../apps/server/dist/ringbuffer.js';

const festGA = {
  id: 'inst_fest_ga',
  symbol: 'FEST-GA',
  name: 'General Admission Pass',
  faceValue: 150000,
  collarBps: 1000,
  tickSize: 100,
  minQty: 1,
  maxQtyPerOrder: 1000,
  escrowRequired: false,
  isBenchmark: false,
};

const N = 100_000;
const tempLog = path.join(os.tmpdir(), `bench_lmax_${Date.now()}.aol`);

async function runLmaxBenchmark() {
  console.log('================================================================');
  console.log(`  LMAX DISRUPTOR + BINARY APPEND-ONLY JOURNAL BENCHMARK`);
  console.log(`  Target: ${N.toLocaleString()} Orders through In-Memory Engine + Binary AOL`);
  console.log('================================================================\n');

  const book = new OrderBook(festGA);
  const journal = new AppendOnlyJournal(tempLog, 128 * 1024); // 128KB page buffer
  const ring = new LockFreeRingBuffer(65536, 128);

  const slotBuf = new Uint8Array(128);

  const startTime = performance.now();

  for (let i = 1; i <= N; i++) {
    const isBuy = i % 2 === 0;

    // 1. In-Memory OrderBook Matching
    const res = book.processOrder({
      id: `ord_${i}`,
      clientOrderId: `cid_${i}`,
      seq: i,
      userId: isBuy ? 'usr_alice' : 'usr_bob',
      symbol: 'FEST-GA',
      side: isBuy ? 'BUY' : 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 1,
    });

    // 2. Binary Journaling to Page-Cached AOL
    journal.append({
      seq: i,
      timestamp: Date.now(),
      cmdType: 1,
      price: 150000,
      qty: 1,
      side: isBuy ? 0 : 1,
      orderId: `ord_${i}`,
      userId: isBuy ? 'usr_alice' : 'usr_bob',
      symbol: 'FEST-GA',
    });

    // 3. Lock-Free Ring Buffer Push (for worker projection)
    ring.tryPush(slotBuf);
  }

  journal.flushSync();
  const durationMs = performance.now() - startTime;
  journal.close();

  const throughput = Math.round((N / durationMs) * 1000);
  const avgLatencyUs = ((durationMs / N) * 1000).toFixed(2);
  const fileSizeMb = (fs.statSync(tempLog).size / 1024 / 1024).toFixed(2);

  console.log(`  Throughput:       ${throughput.toLocaleString()} orders/sec`);
  console.log(`  Total Duration:   ${durationMs.toFixed(2)} ms`);
  console.log(`  Average Latency:  ${avgLatencyUs} µs / persistent order`);
  console.log(`  Binary Log Size:  ${fileSizeMb} MB`);
  console.log('\n================================================================');

  if (fs.existsSync(tempLog)) fs.unlinkSync(tempLog);
}

runLmaxBenchmark().catch(console.error);
