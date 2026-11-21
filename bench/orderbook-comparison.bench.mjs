import { performance } from 'node:perf_hooks';
import { OrderBook, TypedArrayOrderBook, ObjectPool } from '../packages/engine/dist/index.js';

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

const N = 50_000;

function runStandardOrderBook() {
  const book = new OrderBook(festGA);
  const startHeap = process.memoryUsage().heapUsed;
  const start = performance.now();

  for (let i = 1; i <= N; i++) {
    book.processOrder({
      id: `ord_${i}`,
      clientOrderId: `cid_${i}`,
      seq: i,
      userId: i % 2 === 0 ? 'usr_alice' : 'usr_bob',
      symbol: 'FEST-GA',
      side: i % 2 === 0 ? 'BUY' : 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 1,
    });
  }

  const durationMs = performance.now() - start;
  const endHeap = process.memoryUsage().heapUsed;
  return {
    name: 'Standard Doubly-Linked OrderBook (Pointer-based)',
    opsPerSec: Math.round((N / durationMs) * 1000),
    avgMicroseconds: ((durationMs / N) * 1000).toFixed(2),
    heapDeltaMB: ((endHeap - startHeap) / 1024 / 1024).toFixed(2),
  };
}

function runTypedArrayOrderBook() {
  const book = new TypedArrayOrderBook(festGA, N + 1000);
  const startHeap = process.memoryUsage().heapUsed;
  const start = performance.now();

  for (let i = 1; i <= N; i++) {
    book.processOrder({
      id: `ord_${i}`,
      clientOrderId: `cid_${i}`,
      seq: i,
      userId: i % 2 === 0 ? 'usr_alice' : 'usr_bob',
      symbol: 'FEST-GA',
      side: i % 2 === 0 ? 'BUY' : 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 1,
    });
  }

  const durationMs = performance.now() - start;
  const endHeap = process.memoryUsage().heapUsed;
  return {
    name: 'Contiguous TypedArrayOrderBook (SoA + Free-List)',
    opsPerSec: Math.round((N / durationMs) * 1000),
    avgMicroseconds: ((durationMs / N) * 1000).toFixed(2),
    heapDeltaMB: ((endHeap - startHeap) / 1024 / 1024).toFixed(2),
  };
}

console.log('================================================================');
console.log(`  MATCHING ENGINE BENCHMARK: 50,000 Continuous Trades`);
console.log('================================================================\n');

// Warm up V8 JIT
runStandardOrderBook();
runTypedArrayOrderBook();

const res1 = runStandardOrderBook();
const res2 = runTypedArrayOrderBook();

console.log(`1. ${res1.name}:`);
console.log(`   - Throughput:      ${res1.opsPerSec.toLocaleString()} ops/sec`);
console.log(`   - Latency:         ${res1.avgMicroseconds} µs / match`);
console.log(`   - Heap Delta:      ${res1.heapDeltaMB} MB\n`);

console.log(`2. ${res2.name}:`);
console.log(`   - Throughput:      ${res2.opsPerSec.toLocaleString()} ops/sec`);
console.log(`   - Latency:         ${res2.avgMicroseconds} µs / match`);
console.log(`   - Heap Delta:      ${res2.heapDeltaMB} MB\n`);

console.log('================================================================');
