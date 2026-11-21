import { describe, it, expect, beforeEach } from 'vitest';
import { OrderBook } from '../src/orderbook.js';
import { InstrumentConfig, EngineOrderCommand } from '../src/types.js';

describe('OrderBook Unit and Invariant Suite', () => {
  const festGA: InstrumentConfig = {
    id: 'inst_fest_ga',
    symbol: 'FEST-GA',
    name: 'General Admission Pass',
    faceValue: 150000, // 1,500.00 DKC
    collarBps: 1000,   // 10% collar -> ceiling = 165000 (1,650.00 DKC)
    tickSize: 100,     // 1.00 DKC
    minQty: 1,
    maxQtyPerOrder: 10,
    escrowRequired: false,
    isBenchmark: false,
  };

  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook(festGA);
  });

  it('calculates collar ceiling correctly and enforces ceiling boundary', () => {
    expect(book.ceiling).toBe(165000);

    // Order at exact ceiling passes
    const atCeiling: EngineOrderCommand = {
      id: 'o-ceil-1',
      clientOrderId: 'cid-1',
      seq: 1,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 165000,
      qty: 2,
    };
    const res1 = book.processOrder(atCeiling);
    expect(res1.success).toBe(true);
    expect(res1.status).toBe('OPEN');

    // Order 1 tick above ceiling is rejected
    const aboveCeiling: EngineOrderCommand = {
      id: 'o-ceil-2',
      clientOrderId: 'cid-2',
      seq: 2,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 165100,
      qty: 2,
    };
    const res2 = book.processOrder(aboveCeiling);
    expect(res2.success).toBe(false);
    expect(res2.rejectedReason).toBe('COLLAR_VIOLATION');
  });

  it('matches price priority: highest bid matches first, aggressor gets price improvement', () => {
    // Two resting asks: ask1 at 155000 (qty 2), ask2 at 150000 (qty 2)
    book.processOrder({
      id: 'ask-1',
      clientOrderId: 'c-a1',
      seq: 1,
      userId: 'usr_seller_1',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 155000,
      qty: 2,
    });
    book.processOrder({
      id: 'ask-2',
      clientOrderId: 'c-a2',
      seq: 2,
      userId: 'usr_seller_2',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    // Incoming buyer bids 160000 for qty 1 -> must match against ask-2 (lowest price 150000)
    const buyRes = book.processOrder({
      id: 'buy-1',
      clientOrderId: 'c-b1',
      seq: 3,
      userId: 'usr_buyer',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 160000,
      qty: 1,
    });

    expect(buyRes.success).toBe(true);
    expect(buyRes.trades.length).toBe(1);
    expect(buyRes.trades[0].price).toBe(150000); // Executed at resting price
    expect(buyRes.trades[0].buyerRefund).toBe(10000); // (160000 - 150000) * 1
    expect(buyRes.trades[0].sellOrderId).toBe('ask-2');
  });

  it('preserves FIFO priority at the same price level', () => {
    // Two resting bids at same price: bid1 submitted first, bid2 second
    book.processOrder({
      id: 'bid-1',
      clientOrderId: 'cb-1',
      seq: 1,
      userId: 'usr_buyer_1',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });
    book.processOrder({
      id: 'bid-2',
      clientOrderId: 'cb-2',
      seq: 2,
      userId: 'usr_buyer_2',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    // Seller sells 2 units -> must match against bid-1 (FIFO first)
    const sellRes = book.processOrder({
      id: 'sell-1',
      clientOrderId: 'cs-1',
      seq: 3,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'IOC',
      price: 150000,
      qty: 2,
    });

    expect(sellRes.trades.length).toBe(1);
    expect(sellRes.trades[0].buyOrderId).toBe('bid-1');
  });

  it('supports multi-fill across multiple counterparties and partial fill', () => {
    book.processOrder({
      id: 'ask-1',
      clientOrderId: 'c-a1',
      seq: 1,
      userId: 'usr_seller_1',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });
    book.processOrder({
      id: 'ask-2',
      clientOrderId: 'c-a2',
      seq: 2,
      userId: 'usr_seller_2',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 152000,
      qty: 3,
    });

    // Buyer buys 4 units -> fills 2 from ask-1, 2 from ask-2, leaving 1 on ask-2
    const res = book.processOrder({
      id: 'buy-1',
      clientOrderId: 'c-b1',
      seq: 3,
      userId: 'usr_buyer',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 155000,
      qty: 4,
    });

    expect(res.trades.length).toBe(2);
    expect(res.trades[0].qty).toBe(2);
    expect(res.trades[0].price).toBe(150000);
    expect(res.trades[1].qty).toBe(2);
    expect(res.trades[1].price).toBe(152000);

    // Resting ask-2 should have 1 remaining
    const remainingAsk2 = book.getOrder('ask-2');
    expect(remainingAsk2).toBeDefined();
    expect(remainingAsk2!.remainingQty).toBe(1);
    expect(remainingAsk2!.status).toBe('PARTIALLY_FILLED');
  });

  it('rejects MARKET+GTC with UNSUPPORTED_COMBINATION', () => {
    const res = book.processOrder({
      id: 'mkt-gtc',
      clientOrderId: 'c-mkt-gtc',
      seq: 1,
      userId: 'usr_trader',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'MARKET',
      tif: 'GTC',
      qty: 2,
    });

    expect(res.success).toBe(false);
    expect(res.rejectedReason).toBe('UNSUPPORTED_COMBINATION');
  });

  it('enforces FOK all-or-nothing dry run with zero side effects on failure', () => {
    // Only 2 units available on ask side
    book.processOrder({
      id: 'ask-1',
      clientOrderId: 'c-a1',
      seq: 1,
      userId: 'usr_seller',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    // Buyer wants 4 units FOK -> must fail completely
    const fokRes = book.processOrder({
      id: 'buy-fok',
      clientOrderId: 'c-bfok',
      seq: 2,
      userId: 'usr_buyer',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'FOK',
      price: 150000,
      qty: 4,
    });

    expect(fokRes.success).toBe(false);
    expect(fokRes.rejectedReason).toBe('FOK_NOT_FILLABLE');
    expect(fokRes.trades.length).toBe(0);

    // Book state must be 100% untouched
    const restingAsk = book.getOrder('ask-1');
    expect(restingAsk).toBeDefined();
    expect(restingAsk!.remainingQty).toBe(2);
    expect(restingAsk!.status).toBe('OPEN');
  });

  it('enforces Self-Trade Prevention: cancels incoming remainder and does not fill against own order', () => {
    book.processOrder({
      id: 'bid-self',
      clientOrderId: 'c-self-1',
      seq: 1,
      userId: 'usr_alice',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 3,
    });

    // Alice submits matching sell order -> STP halts matching and cancels incoming
    const sellRes = book.processOrder({
      id: 'sell-self',
      clientOrderId: 'c-self-2',
      seq: 2,
      userId: 'usr_alice',
      symbol: 'FEST-GA',
      side: 'SELL',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    expect(sellRes.trades.length).toBe(0);
    expect(sellRes.cancelledOrders.length).toBe(1);
    expect(sellRes.cancelledOrders[0].id).toBe('sell-self');

    // Alice's resting bid remains untouched in book
    const resting = book.getOrder('bid-self');
    expect(resting).toBeDefined();
    expect(resting!.remainingQty).toBe(3);
  });

  it('cancels resting order in O(1) and rejects cancel on unknown or filled order', () => {
    book.processOrder({
      id: 'bid-1',
      clientOrderId: 'c-b1',
      seq: 1,
      userId: 'usr_alice',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 2,
    });

    const cancelRes = book.cancelOrder('bid-1', 2);
    expect(cancelRes.success).toBe(true);
    expect(cancelRes.status).toBe('CANCELLED');
    expect(book.getOrder('bid-1')).toBeUndefined();

    // Cancel again -> ORDER_NOT_FOUND
    const cancelAgain = book.cancelOrder('bid-1', 3);
    expect(cancelAgain.success).toBe(false);
    expect(cancelAgain.rejectedReason).toBe('ORDER_NOT_FOUND');
  });

  it('returns idempotent cached result on duplicate clientOrderId', () => {
    const cmd: EngineOrderCommand = {
      id: 'ord-dup',
      clientOrderId: 'unique-cid-999',
      seq: 1,
      userId: 'usr_bob',
      symbol: 'FEST-GA',
      side: 'BUY',
      type: 'LIMIT',
      tif: 'GTC',
      price: 150000,
      qty: 1,
    };

    const first = book.processOrder(cmd);
    expect(first.success).toBe(true);
    expect(first.isDuplicate).toBeFalsy();

    const second = book.processOrder(cmd);
    expect(second.success).toBe(true);
    expect(second.isDuplicate).toBe(true);
    expect(second.orderId).toBe(first.orderId);
  });
});