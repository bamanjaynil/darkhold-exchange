/**
 * @file typed-orderbook.ts
 * Contiguous-Memory Structure-of-Arrays (SoA) Limit Order Book.
 *
 * Utilizes TypedArrays and pointer-index arithmetic to maximize L1/L2 cache locality,
 * avoiding object pointers and V8 hidden-class indirection.
 *
 * Adheres strictly to Problem Statement H1 Financial Integrity Rules:
 * - Integer minor units only (NO floating-point numbers).
 * - Exact price-time priority (FIFO).
 * - Self-Trade Prevention (STP).
 * - Anti-scalping collar enforcement.
 */

import { InstrumentConfig, EngineOrderCommand, EngineResult, MatchedTrade } from './types.js';
import { calculateCollarCeiling } from '@darkhold/shared';

// Bitwise Flags for flags[orderIndex]
export const FLAG_SIDE_SELL = 0x01;        // 0 = BUY, 1 = SELL
export const FLAG_TYPE_MARKET = 0x02;      // 0 = LIMIT, 1 = MARKET
export const FLAG_TIF_IOC = 0x04;          // 0 = GTC, 1 = IOC
export const FLAG_TIF_FOK = 0x08;          // 1 = FOK
export const FLAG_STATUS_OPEN = 0x10;
export const FLAG_STATUS_PARTIAL = 0x20;
export const FLAG_STATUS_FILLED = 0x40;
export const FLAG_STATUS_CANCELLED = 0x80;

const NULL_PTR = -1;

export class TypedArrayOrderBook {
  public readonly instrument: InstrumentConfig;
  public readonly ceiling: number;
  private readonly maxOrders: number;

  // Contiguous Structure-of-Arrays (SoA) Buffers
  private prices: Int32Array;
  private qtys: Int32Array;
  private remainingQtys: Int32Array;
  private filledQtys: Int32Array;
  private userIds: Int32Array;
  private flags: Uint8Array;
  private nextPtrs: Int32Array;
  private prevPtrs: Int32Array;
  private seqs: Int32Array;

  // Free-List Stack for O(1) Slot Allocation without GC
  private freeStack: Int32Array;
  private freeTop: number;

  // Price Level Management (Contiguous Index Tables)
  private levelHead: Map<number, number> = new Map();
  private levelTail: Map<number, number> = new Map();
  private levelTotalQty: Map<number, number> = new Map();
  private levelOrderCount: Map<number, number> = new Map();

  // Price Ladders (Sorted Prices)
  public bids: number[] = [];
  public asks: number[] = [];

  // String Interning Tables for I/O Boundary
  private userStringToInt: Map<string, number> = new Map();
  private userIntToString: string[] = [];
  private orderIdToSlot: Map<string, number> = new Map();
  private slotToOrderId: string[];
  private clientOrderHistory: Map<string, EngineResult> = new Map();

  constructor(instrument: InstrumentConfig, maxOrders: number = 100_000) {
    this.instrument = instrument;
    this.ceiling = calculateCollarCeiling(instrument.faceValue, instrument.collarBps);
    this.maxOrders = maxOrders;

    // Allocate contiguous array buffers upfront
    this.prices = new Int32Array(maxOrders);
    this.qtys = new Int32Array(maxOrders);
    this.remainingQtys = new Int32Array(maxOrders);
    this.filledQtys = new Int32Array(maxOrders);
    this.userIds = new Int32Array(maxOrders);
    this.flags = new Uint8Array(maxOrders);
    this.nextPtrs = new Int32Array(maxOrders);
    this.prevPtrs = new Int32Array(maxOrders);
    this.seqs = new Int32Array(maxOrders);

    this.slotToOrderId = new Array<string>(maxOrders);

    // Initialize free list
    this.freeStack = new Int32Array(maxOrders);
    for (let i = 0; i < maxOrders; i++) {
      this.freeStack[i] = maxOrders - 1 - i;
    }
    this.freeTop = maxOrders;
  }

  private internUser(userId: string): number {
    let intId = this.userStringToInt.get(userId);
    if (intId === undefined) {
      intId = this.userIntToString.length;
      this.userStringToInt.set(userId, intId);
      this.userIntToString.push(userId);
    }
    return intId;
  }

  public getBestBid(): number | null {
    return this.bids.length > 0 ? this.bids[0] : null;
  }

  public getBestAsk(): number | null {
    return this.asks.length > 0 ? this.asks[0] : null;
  }

  /**
   * Processes an incoming order using contiguous memory and pointer arithmetic.
   */
  public processOrder(cmd: EngineOrderCommand): EngineResult {
    const idempKey = `${cmd.userId}:${cmd.clientOrderId}`;
    const existing = this.clientOrderHistory.get(idempKey);
    if (existing) {
      return { ...existing, isDuplicate: true };
    }

    if (cmd.type === 'MARKET' && cmd.tif === 'GTC') {
      const errRes: EngineResult = {
        success: false,
        seq: cmd.seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'UNSUPPORTED_COMBINATION',
      };
      this.clientOrderHistory.set(idempKey, errRes);
      return errRes;
    }

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
      orderPrice = cmd.side === 'BUY' ? this.ceiling : 0;
    }

    if (cmd.qty < this.instrument.minQty) {
      return this.reject(idempKey, cmd.seq, 'QTY_BELOW_MIN');
    }
    if (cmd.qty > this.instrument.maxQtyPerOrder) {
      return this.reject(idempKey, cmd.seq, 'QTY_EXCEEDS_MAX');
    }

    const isBuy = cmd.side === 'BUY';
    const userIntId = this.internUser(cmd.userId);

    // FOK pre-flight check
    if (cmd.tif === 'FOK') {
      let fillable = 0;
      const prices = isBuy ? this.asks : this.bids;
      for (let i = 0; i < prices.length; i++) {
        const p = prices[i]!;
        if (isBuy) {
          if (cmd.type === 'LIMIT' && p > orderPrice) break;
          if (p > this.ceiling) break;
        } else {
          if (cmd.type === 'LIMIT' && p < orderPrice) break;
        }

        let curr = this.levelHead.get(p) ?? NULL_PTR;
        while (curr !== NULL_PTR) {
          if (this.userIds[curr] === userIntId) {
            return this.reject(idempKey, cmd.seq, 'FOK_NOT_FILLABLE');
          }
          fillable += this.remainingQtys[curr]!;
          if (fillable >= cmd.qty) break;
          curr = this.nextPtrs[curr]!;
        }
        if (fillable >= cmd.qty) break;
      }

      if (fillable < cmd.qty) {
        return this.reject(idempKey, cmd.seq, 'FOK_NOT_FILLABLE');
      }
    }

    // Allocate incoming order slot from Free List
    if (this.freeTop === 0) {
      return this.reject(idempKey, cmd.seq, 'ENGINE_CAPACITY_EXHAUSTED');
    }

    this.freeTop--;
    const slot = this.freeStack[this.freeTop]!;

    this.prices[slot] = orderPrice;
    this.qtys[slot] = cmd.qty;
    this.remainingQtys[slot] = cmd.qty;
    this.filledQtys[slot] = 0;
    this.userIds[slot] = userIntId;
    this.seqs[slot] = cmd.seq;
    this.nextPtrs[slot] = NULL_PTR;
    this.prevPtrs[slot] = NULL_PTR;
    this.slotToOrderId[slot] = cmd.id;
    this.orderIdToSlot.set(cmd.id, slot);

    let flagVal = isBuy ? 0 : FLAG_SIDE_SELL;
    if (cmd.type === 'MARKET') flagVal |= FLAG_TYPE_MARKET;
    if (cmd.tif === 'IOC') flagVal |= FLAG_TIF_IOC;
    if (cmd.tif === 'FOK') flagVal |= FLAG_TIF_FOK;
    flagVal |= FLAG_STATUS_OPEN;
    this.flags[slot] = flagVal;

    const trades: MatchedTrade[] = [];
    const cancelledOrders: any[] = [];
    let tradeCounter = 1;

    // Matching loop via pointer traversal
    while (this.remainingQtys[slot]! > 0) {
      const bestPrice = isBuy ? this.getBestAsk() : this.getBestBid();
      if (bestPrice === null) break;

      if (isBuy) {
        if (cmd.type === 'LIMIT' && bestPrice > this.prices[slot]!) break;
        if (bestPrice > this.ceiling) break;
      } else {
        if (cmd.type === 'LIMIT' && bestPrice < this.prices[slot]!) break;
      }

      let restingSlot = this.levelHead.get(bestPrice) ?? NULL_PTR;

      while (restingSlot !== NULL_PTR && this.remainingQtys[slot]! > 0) {
        // Self-Trade Prevention
        if (this.userIds[restingSlot] === this.userIds[slot]) {
          this.flags[slot] = (this.flags[slot]! & ~0xF0) | FLAG_STATUS_CANCELLED;
          cancelledOrders.push({
            id: cmd.id,
            remainingQty: this.remainingQtys[slot]!,
            reason: 'SELF_TRADE_PREVENTION',
          });
          this.remainingQtys[slot] = 0;
          break;
        }

        const matchQty = Math.min(this.remainingQtys[slot]!, this.remainingQtys[restingSlot]!);
        const execPrice = this.prices[restingSlot]!;
        const buyerRefund = isBuy ? (this.prices[slot]! - execPrice) * matchQty : 0;

        this.remainingQtys[slot] -= matchQty;
        this.filledQtys[slot] += matchQty;
        this.remainingQtys[restingSlot] -= matchQty;
        this.filledQtys[restingSlot] += matchQty;

        const restingOrderId = this.slotToOrderId[restingSlot]!;
        const restingUserId = this.userIntToString[this.userIds[restingSlot]!]!;

        trades.push({
          id: `tr_${cmd.seq}_${tradeCounter++}`,
          seq: cmd.seq,
          symbol: this.instrument.symbol,
          buyOrderId: isBuy ? cmd.id : restingOrderId,
          sellOrderId: isBuy ? restingOrderId : cmd.id,
          buyerUserId: isBuy ? cmd.userId : restingUserId,
          sellerUserId: isBuy ? restingUserId : cmd.userId,
          price: execPrice,
          qty: matchQty,
          buyerRefund,
          takerSide: isBuy ? 'BUY' : 'SELL',
        });

        // Update level metrics
        const curLevelQty = this.levelTotalQty.get(bestPrice) ?? 0;
        this.levelTotalQty.set(bestPrice, curLevelQty - matchQty);

        const nextResting = this.nextPtrs[restingSlot]!;

        if (this.remainingQtys[restingSlot] === 0) {
          this.flags[restingSlot] = (this.flags[restingSlot]! & ~0xF0) | FLAG_STATUS_FILLED;
          this.unlinkOrder(restingSlot, bestPrice, !isBuy);
          this.freeSlot(restingSlot);
        } else {
          this.flags[restingSlot] = (this.flags[restingSlot]! & ~0xF0) | FLAG_STATUS_PARTIAL;
        }

        restingSlot = nextResting;
      }
    }

    // Determine incoming order final status
    let finalStatus: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
    if (this.remainingQtys[slot] === 0) {
      finalStatus = 'FILLED';
      this.freeSlot(slot);
    } else if (cmd.tif === 'IOC' || (this.flags[slot]! & FLAG_STATUS_CANCELLED)) {
      finalStatus = 'CANCELLED';
      cancelledOrders.push({
        id: cmd.id,
        remainingQty: this.remainingQtys[slot]!,
        reason: 'IOC_UNFILLED',
      });
      this.freeSlot(slot);
    } else {
      finalStatus = this.filledQtys[slot]! > 0 ? 'PARTIALLY_FILLED' : 'OPEN';
      this.insertRestingOrder(slot, isBuy);
    }

    const result: EngineResult = {
      success: true,
      orderId: cmd.id,
      seq: cmd.seq,
      status: finalStatus,
      trades,
      cancelledOrders,
    };

    this.clientOrderHistory.set(idempKey, result);
    return result;
  }

  private insertRestingOrder(slot: number, isBid: boolean): void {
    const price = this.prices[slot]!;
    let head = this.levelHead.get(price);

    if (head === undefined || head === NULL_PTR) {
      this.levelHead.set(price, slot);
      this.levelTail.set(price, slot);
      this.levelTotalQty.set(price, this.remainingQtys[slot]!);
      this.levelOrderCount.set(price, 1);
      this.nextPtrs[slot] = NULL_PTR;
      this.prevPtrs[slot] = NULL_PTR;
      this.insertSortedPrice(price, isBid);
    } else {
      const tail = this.levelTail.get(price)!;
      this.nextPtrs[tail] = slot;
      this.prevPtrs[slot] = tail;
      this.nextPtrs[slot] = NULL_PTR;
      this.levelTail.set(price, slot);
      this.levelTotalQty.set(price, (this.levelTotalQty.get(price) ?? 0) + this.remainingQtys[slot]!);
      this.levelOrderCount.set(price, (this.levelOrderCount.get(price) ?? 0) + 1);
    }
  }

  private unlinkOrder(slot: number, price: number, isBid: boolean): void {
    const prev = this.prevPtrs[slot]!;
    const next = this.nextPtrs[slot]!;

    if (prev !== NULL_PTR) {
      this.nextPtrs[prev] = next;
    } else {
      this.levelHead.set(price, next);
    }

    if (next !== NULL_PTR) {
      this.prevPtrs[next] = prev;
    } else {
      this.levelTail.set(price, prev);
    }

    const count = (this.levelOrderCount.get(price) ?? 1) - 1;
    this.levelOrderCount.set(price, count);

    if (count <= 0 || this.levelHead.get(price) === NULL_PTR) {
      this.levelHead.delete(price);
      this.levelTail.delete(price);
      this.levelTotalQty.delete(price);
      this.levelOrderCount.delete(price);
      this.removeSortedPrice(price, isBid);
    }
  }

  private freeSlot(slot: number): void {
    const orderId = this.slotToOrderId[slot];
    if (orderId) {
      this.orderIdToSlot.delete(orderId);
    }
    this.freeStack[this.freeTop] = slot;
    this.freeTop++;
  }

  private insertSortedPrice(price: number, isBid: boolean): void {
    const arr = isBid ? this.bids : this.asks;
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const compare = isBid ? arr[mid]! < price : arr[mid]! > price;
      if (compare) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    arr.splice(low, 0, price);
  }

  private removeSortedPrice(price: number, isBid: boolean): void {
    const arr = isBid ? this.bids : this.asks;
    const idx = arr.indexOf(price);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  private reject(idempKey: string, seq: number, reason: string): EngineResult {
    const res: EngineResult = {
      success: false,
      seq,
      trades: [],
      cancelledOrders: [],
      rejectedReason: reason,
    };
    this.clientOrderHistory.set(idempKey, res);
    return res;
  }
}
