/**
 * @file orderbook.ts
 * High-performance, pure synchronous Limit Order Book.
 * Single instrument, Price-Time Priority (FIFO), $O(1)$ order cancellation.
 * Zero I/O, zero Date.now(), zero Math.random().
 */

import {
  Side,
  OrderType,
  TimeInForce,
  OrderStatus,
  OrderNode,
  PriceLevel,
  MatchedTrade,
  EngineOrderCommand,
  EngineResult,
  InstrumentConfig,
} from './types.js';
import { calculateCollarCeiling } from '@darkhold/shared';

export class OrderBook {
  public readonly instrument: InstrumentConfig;
  public readonly ceiling: number;

  // Sorted price arrays: bids descending (bids[0] is best bid), asks ascending (asks[0] is best ask)
  public bids: number[] = [];
  public asks: number[] = [];

  // Lookups
  private levels: Map<number, PriceLevel> = new Map();
  private ordersById: Map<string, OrderNode> = new Map();
  private clientOrderHistory: Map<string, EngineResult> = new Map();

  constructor(instrument: InstrumentConfig) {
    this.instrument = instrument;
    this.ceiling = calculateCollarCeiling(instrument.faceValue, instrument.collarBps);
  }

  public getBestBid(): number | null {
    return this.bids.length > 0 ? this.bids[0] : null;
  }

  public getBestAsk(): number | null {
    return this.asks.length > 0 ? this.asks[0] : null;
  }

  public getOrder(orderId: string): OrderNode | undefined {
    return this.ordersById.get(orderId);
  }

  /**
   * Submits an order into the order book.
   */
  public processOrder(cmd: EngineOrderCommand): EngineResult {
    // 1. Idempotency Check per user
    const idempKey = `${cmd.userId}:${cmd.clientOrderId}`;
    const existingResult = this.clientOrderHistory.get(idempKey);
    if (existingResult) {
      return {
        ...existingResult,
        isDuplicate: true,
      };
    }

    // 2. Reject unsupported combinations (MARKET + GTC)
    if (cmd.type === 'MARKET' && cmd.tif === 'GTC') {
      const errRes: EngineResult = {
        success: false,
        seq: cmd.seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'UNSUPPORTED_COMBINATION',
      };
      this.recordClientOrder(idempKey, errRes);
      return errRes;
    }

    // 3. Price validation & Collar Enforcements
    let orderPrice = cmd.price ?? 0;
    if (cmd.type === 'LIMIT') {
      if (!orderPrice || orderPrice <= 0) {
        return this.reject(idempKey, cmd.seq, 'INVALID_PRICE');
      }
      if (orderPrice % this.instrument.tickSize !== 0) {
        return this.reject(idempKey, cmd.seq, 'PRICE_OFF_TICK');
      }
      if (orderPrice > this.ceiling) {
        return this.reject(idempKey, cmd.seq, 'COLLAR_VIOLATION');
      }
    } else {
      // For MARKET orders
      orderPrice = cmd.side === 'BUY' ? this.ceiling : 0;
    }

    // 4. Quantity validation
    if (cmd.qty < this.instrument.minQty) {
      return this.reject(idempKey, cmd.seq, 'QTY_BELOW_MIN');
    }
    if (cmd.qty > this.instrument.maxQtyPerOrder) {
      return this.reject(idempKey, cmd.seq, 'QTY_EXCEEDS_MAX');
    }

    // 5. FOK Pre-flight Dry Run (All-or-Nothing check without mutation)
    if (cmd.tif === 'FOK') {
      const fillable = this.canFillFOK(cmd, orderPrice);
      if (!fillable) {
        return this.reject(idempKey, cmd.seq, 'FOK_NOT_FILLABLE');
      }
    }

    // 6. Matching Execution
    const incoming: OrderNode = {
      id: cmd.id,
      clientOrderId: cmd.clientOrderId,
      seq: cmd.seq,
      userId: cmd.userId,
      symbol: cmd.symbol,
      side: cmd.side,
      type: cmd.type,
      tif: cmd.tif,
      price: orderPrice,
      qty: cmd.qty,
      remainingQty: cmd.qty,
      filledQty: 0,
      status: 'OPEN',
      createdAtSeq: cmd.seq,
      next: null,
      prev: null,
    };

    const trades: MatchedTrade[] = [];
    const cancelledOrders: OrderNode[] = [];
    const filledOrders: OrderNode[] = [];
    let tradeCounter = 1;

    const isBuy = incoming.side === 'BUY';

    while (incoming.remainingQty > 0) {
      const bestOppositePrice = isBuy ? this.getBestAsk() : this.getBestBid();
      if (bestOppositePrice === null) break;

      // Check if price crosses
      if (isBuy) {
        if (incoming.type === 'LIMIT' && bestOppositePrice > incoming.price) break;
        if (bestOppositePrice > this.ceiling) break; // Collar bound on Market Buys
      } else {
        if (incoming.type === 'LIMIT' && bestOppositePrice < incoming.price) break;
      }

      const level = this.levels.get(bestOppositePrice)!;
      let resting = level.head;

      while (resting !== null && incoming.remainingQty > 0) {
        // Self-Trade Prevention: matching halts immediately if trading against own order
        if (resting.userId === incoming.userId) {
          // Cancel incoming remainder immediately (never rests); leave resting order untouched
          incoming.status = incoming.filledQty > 0 ? 'PARTIALLY_FILLED' : 'CANCELLED';
          cancelledOrders.push({ ...incoming });
          incoming.remainingQty = 0;
          break;
        }

        const matchQty = Math.min(incoming.remainingQty, resting.remainingQty);
        const execPrice = resting.price; // Resting order sets the price

        // Price improvement refund for aggressor BUY
        let buyerRefund = 0;
        if (isBuy && incoming.type === 'LIMIT' && incoming.price > execPrice) {
          buyerRefund = (incoming.price - execPrice) * matchQty;
        }

        const tradeId = `${cmd.id}-t-${tradeCounter++}`;
        trades.push({
          id: tradeId,
          seq: cmd.seq,
          symbol: cmd.symbol,
          buyOrderId: isBuy ? incoming.id : resting.id,
          sellOrderId: isBuy ? resting.id : incoming.id,
          buyerUserId: isBuy ? incoming.userId : resting.userId,
          sellerUserId: isBuy ? resting.userId : incoming.userId,
          price: execPrice,
          qty: matchQty,
          buyerRefund,
          takerSide: incoming.side,
        });

        // Mutate quantities
        incoming.remainingQty -= matchQty;
        incoming.filledQty += matchQty;
        resting.remainingQty -= matchQty;
        resting.filledQty += matchQty;
        level.totalQty -= matchQty;

        const nextResting = resting.next;

        if (resting.remainingQty === 0) {
          resting.status = 'FILLED';
          filledOrders.push({ ...resting });
          this.removeOrderFromLevel(resting, level);
          this.ordersById.delete(resting.id);
        } else {
          resting.status = 'PARTIALLY_FILLED';
          filledOrders.push({ ...resting });
        }

        resting = nextResting;
      }

      if (level.orderCount === 0) {
        this.removeLevel(bestOppositePrice, !isBuy);
      }

      if (incoming.remainingQty === 0) break;
    }

    // 7. Handle Post-Match Remainder
    let finalStatus: OrderStatus = 'FILLED';
    let restingOrder: OrderNode | undefined = undefined;

    if (incoming.remainingQty > 0) {
      if (incoming.tif === 'GTC' && incoming.type === 'LIMIT') {
        finalStatus = incoming.filledQty > 0 ? 'PARTIALLY_FILLED' : 'OPEN';
        incoming.status = finalStatus;
        this.insertRestingOrder(incoming);
        restingOrder = incoming;
      } else {
        // IOC or MARKET orders cancel unfilled remainder immediately
        finalStatus = incoming.filledQty > 0 ? 'PARTIALLY_FILLED' : 'CANCELLED';
        incoming.status = finalStatus;
        cancelledOrders.push({ ...incoming });
      }
    } else {
      incoming.status = 'FILLED';
    }

    const result: EngineResult = {
      success: true,
      orderId: cmd.id,
      seq: cmd.seq,
      status: incoming.status,
      trades,
      restingOrder,
      cancelledOrders,
      filledOrders,
    };

    this.recordClientOrder(idempKey, result);
    return result;
  }

  /**
   * Cancels an existing resting order in O(1).
   */
  public cancelOrder(orderId: string, seq: number): EngineResult {
    const node = this.ordersById.get(orderId);
    if (!node) {
      return {
        success: false,
        seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'ORDER_NOT_FOUND',
      };
    }

    const level = this.levels.get(node.price);
    if (level) {
      this.removeOrderFromLevel(node, level);
      if (level.orderCount === 0) {
        this.removeLevel(node.price, node.side === 'BUY');
      }
    }

    this.ordersById.delete(orderId);
    node.status = 'CANCELLED';

    return {
      success: true,
      orderId,
      seq,
      status: 'CANCELLED',
      trades: [],
      cancelledOrders: [node],
    };
  }

  /**
   * Aggregates top K levels for the Level 2 book ladder and cumulative depth chart.
   */
  public getL2Snapshot(maxDepth: number = 20): {
    symbol: string;
    bids: Array<{ price: number; qty: number; orders: number; total: number }>;
    asks: Array<{ price: number; qty: number; orders: number; total: number }>;
    spread: number | null;
  } {
    const bidsResult: Array<{ price: number; qty: number; orders: number; total: number }> = [];
    let bidRunningTotal = 0;
    const bidLimit = Math.min(this.bids.length, maxDepth);
    for (let i = 0; i < bidLimit; i++) {
      const price = this.bids[i];
      const level = this.levels.get(price);
      if (level && level.totalQty > 0) {
        bidRunningTotal += level.totalQty;
        bidsResult.push({
          price: level.price,
          qty: level.totalQty,
          orders: level.orderCount,
          total: bidRunningTotal,
        });
      }
    }

    const asksResult: Array<{ price: number; qty: number; orders: number; total: number }> = [];
    let askRunningTotal = 0;
    const askLimit = Math.min(this.asks.length, maxDepth);
    for (let i = 0; i < askLimit; i++) {
      const price = this.asks[i];
      const level = this.levels.get(price);
      if (level && level.totalQty > 0) {
        askRunningTotal += level.totalQty;
        asksResult.push({
          price: level.price,
          qty: level.totalQty,
          orders: level.orderCount,
          total: askRunningTotal,
        });
      }
    }

    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return {
      symbol: this.instrument.symbol,
      bids: bidsResult,
      asks: asksResult,
      spread,
    };
  }

  private canFillFOK(cmd: EngineOrderCommand, orderPrice: number): boolean {
    let fillableQty = 0;
    const isBuy = cmd.side === 'BUY';
    const prices = isBuy ? this.asks : this.bids;

    for (const p of prices) {
      if (isBuy) {
        if (cmd.type === 'LIMIT' && p > orderPrice) break;
        if (p > this.ceiling) break;
      } else {
        if (cmd.type === 'LIMIT' && p < orderPrice) break;
      }

      const level = this.levels.get(p);
      if (!level) continue;

      let cur = level.head;
      while (cur !== null) {
        // STP violation halts matching
        if (cur.userId === cmd.userId) {
          return false;
        }
        fillableQty += cur.remainingQty;
        if (fillableQty >= cmd.qty) {
          return true;
        }
        cur = cur.next;
      }
    }

    return fillableQty >= cmd.qty;
  }

  private insertRestingOrder(node: OrderNode): void {
    let level = this.levels.get(node.price);
    if (!level) {
      level = {
        price: node.price,
        totalQty: 0,
        orderCount: 0,
        head: null,
        tail: null,
      };
      this.levels.set(node.price, level);
      this.insertSortedPrice(node.price, node.side === 'BUY');
    }

    // Append to FIFO doubly-linked list
    if (level.tail === null) {
      level.head = node;
      level.tail = node;
      node.prev = null;
      node.next = null;
    } else {
      level.tail.next = node;
      node.prev = level.tail;
      node.next = null;
      level.tail = node;
    }

    level.totalQty += node.remainingQty;
    level.orderCount += 1;
    this.ordersById.set(node.id, node);
  }

  private removeOrderFromLevel(node: OrderNode, level: PriceLevel): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      level.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      level.tail = node.prev;
    }

    level.totalQty -= node.remainingQty;
    level.orderCount -= 1;
    node.prev = null;
    node.next = null;
  }

  private insertSortedPrice(price: number, isBid: boolean): void {
    const arr = isBid ? this.bids : this.asks;
    // Bids descending; asks ascending
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const compare = isBid ? arr[mid] < price : arr[mid] > price;
      if (compare) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    arr.splice(low, 0, price);
  }

  private removeLevel(price: number, isBid: boolean): void {
    this.levels.delete(price);
    const arr = isBid ? this.bids : this.asks;
    const idx = arr.indexOf(price);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  private recordClientOrder(idempKey: string, result: EngineResult): void {
    if (this.clientOrderHistory.size >= 50000) {
      const oldestKey = this.clientOrderHistory.keys().next().value;
      if (oldestKey !== undefined) {
        this.clientOrderHistory.delete(oldestKey);
      }
    }
    this.clientOrderHistory.set(idempKey, result);
  }

  private reject(idempKey: string, seq: number, reason: string): EngineResult {
    const res: EngineResult = {
      success: false,
      seq,
      trades: [],
      cancelledOrders: [],
      rejectedReason: reason,
    };
    this.recordClientOrder(idempKey, res);
    return res;
  }
}