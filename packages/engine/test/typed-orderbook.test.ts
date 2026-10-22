import { describe, it, expect, beforeEach } from 'vitest';
import { TypedArrayOrderBook } from '../src/typed-orderbook.js';
import { InstrumentConfig, EngineOrderCommand } from '../src/types.js';

describe('TypedArrayOrderBook Contiguous Memory Suite', () => {
  const festGA: InstrumentConfig = {
    id: 'inst_fest_ga',
    symbol: 'FEST-GA',
    name: 'General Admission Pass',
    faceValue: 150000,
    collarBps: 1000,
    tickSize: 100,
    minQty: 1,
    maxQtyPerOrder: 10,
    escrowRequired: false,
    isBenchmark: false,
  };

  let book: TypedArrayOrderBook;

  beforeEach(() => {
    book = new TypedArrayOrderBook(festGA, 10_000);
  });

  it('matches orders with price-time priority and computes buyer refund accurately', () => {
    // Resting ask at 150000 (qty 2)
    book.processOrder({
      id: 'ask-1',
      clientOrderId: 'ca-1',
      seq: 1,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    // Aggressor buys 1 at 160000 -> executes at 150000 with 10000 refund
    const res = book.processOrder({
      id: 'buy-1',
      clientOrderId: 'cb-1',
      seq: 2,
      userId: 'usr_buyer',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 160000,
      qty: 1,
    });

    expect(res.success).toBe(true);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].price).toBe(150000);
    expect(res.trades[0].qty).toBe(1);
    expect(res.trades[0].buyerRefund).toBe(10000);
  });

  it('enforces Self-Trade Prevention via integer user ID comparison', () => {
    book.processOrder({
      id: 'bid-1',
      clientOrderId: 'ca-1',
      seq: 1,
      userId: 'usr_alice',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 3,
    });

    // Alice matches against self -> cancels incoming remainder
    const res = book.processOrder({
      id: 'sell-1',
      clientOrderId: 'ca-2',
      seq: 2,
      userId: 'usr_alice',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    expect(res.trades.length).toBe(0);
    expect(res.cancelledOrders.length).toBe(1);
    expect(res.cancelledOrders[0].reason).toBe('SELF_TRADE_PREVENTION');
  });

  it('enforces FOK dry-run without mutating contiguous arrays on failure', () => {
    book.processOrder({
      id: 'ask-1',
      clientOrderId: 'ca-1',
      seq: 1,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    // FOK for 5 units when only 2 exist -> rejected with FOK_NOT_FILLABLE
    const res = book.processOrder({
      id: 'buy-fok',
      clientOrderId: 'cb-fok',
      seq: 2,
      userId: 'usr_buyer',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'FOK',
      price: 150000,
      qty: 5,
    });

    expect(res.success).toBe(false);
    expect(res.rejectedReason).toBe('FOK_NOT_FILLABLE');
    expect(book.getBestAsk()).toBe(150000);
  });
});
