import { describe, it, expect } from 'vitest';
import { OrderBook } from '../src/orderbook.js';
import { InstrumentConfig, EngineOrderCommand } from '../src/types.js';

// Mulberry32 deterministic PRNG
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('OrderBook Property and Fuzz Invariant Test', () => {
  const benchX: InstrumentConfig = {
    id: 'inst_bench_x',
    symbol: 'BENCH-X',
    name: 'Benchmark Instrument',
    faceValue: 100000,
    collarBps: 5000,   // Ceiling = 150000
    tickSize: 100,
    minQty: 1,
    maxQtyPerOrder: 50,
    escrowRequired: false,
    isBenchmark: true,
  };

  it('preserves matching invariants over 10,000 randomized operations', () => {
    const book = new OrderBook(benchX);
    const rng = mulberry32(1337);

    const users = ['usr_fuzz_1', 'usr_fuzz_2', 'usr_fuzz_3', 'usr_fuzz_4', 'usr_fuzz_5'];
    const activeOrderIds: string[] = [];

    let totalSubmittedQty = 0;
    let totalFilledQty = 0;
    let totalCancelledQty = 0;

    const opCount = 10_000;

    for (let seq = 1; seq <= opCount; seq++) {
      const isCancel = activeOrderIds.length > 20 && rng() < 0.25;

      if (isCancel) {
        const cancelIdx = Math.floor(rng() * activeOrderIds.length);
        const orderId = activeOrderIds[cancelIdx];
        const existing = book.getOrder(orderId);
        if (existing) {
          const cancelQty = existing.remainingQty;
          const res = book.cancelOrder(orderId, seq);
          if (res.success) {
            totalCancelledQty += cancelQty;
            activeOrderIds.splice(cancelIdx, 1);
          }
        }
      } else {
        const userId = users[Math.floor(rng() * users.length)];
        const side = rng() < 0.5 ? 'BUY' : 'SELL';
        const type = rng() < 0.85 ? 'LIMIT' : 'MARKET';
        const tif = type === 'MARKET' ? (rng() < 0.5 ? 'IOC' : 'FOK') : (rng() < 0.7 ? 'GTC' : 'IOC');

        // Prices centered around 100000 (90000 to 110000)
        const priceOffset = (Math.floor(rng() * 200) - 100) * 100;
        const price = Math.max(100, Math.min(book.ceiling, 100000 + priceOffset));
        const qty = Math.floor(rng() * 10) + 1;

        const cmd: EngineOrderCommand = {
          id: `fuzz-${seq}`,
          clientOrderId: `fuzz-cid-${seq}`,
          seq,
          userId,
          symbol: 'BENCH-X',
          side,
          type,
          tif,
          price: type === 'LIMIT' ? price : undefined,
          qty,
        };

        const res = book.processOrder(cmd);

        if (res.success) {
          totalSubmittedQty += qty;

          // Account for fills
          for (const t of res.trades) {
            totalFilledQty += t.qty * 2; // Both buy and sell sides filled
          }

          if (res.restingOrder) {
            activeOrderIds.push(res.restingOrder.id);
          }

          for (const cancelled of res.cancelledOrders) {
            totalCancelledQty += cancelled.remainingQty;
          }
        }
      }

      // Check invariant after every single operation:
      // Invariant 1: Book is NEVER crossed (bestBid < bestAsk)
      const bestBid = book.getBestBid();
      const bestAsk = book.getBestAsk();
      if (bestBid !== null && bestAsk !== null) {
        expect(bestBid).toBeLessThan(bestAsk);
      }
    }

    // Invariant 2: Quantity Conservation
    let restingQtyInBook = 0;
    for (const orderId of activeOrderIds) {
      const ord = book.getOrder(orderId);
      if (ord) {
        restingQtyInBook += ord.remainingQty;
      }
    }

    // Total submitted = Total resting + Total cancelled + (Total filled / 2)
    const accountedQty = restingQtyInBook + totalCancelledQty + totalFilledQty;
    expect(accountedQty).toBe(totalSubmittedQty);
  });
});