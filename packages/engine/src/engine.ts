/**
 * @file engine.ts
 * Multi-instrument matching engine coordinator.
 * Isolates each instrument into its own OrderBook instance.
 */

import { InstrumentConfig, EngineOrderCommand, EngineResult, OrderNode } from './types.js';
import { OrderBook } from './orderbook.js';

export class MatchingEngine {
  private books: Map<string, OrderBook> = new Map();

  constructor(instruments: InstrumentConfig[]) {
    for (const inst of instruments) {
      this.registerInstrument(inst);
    }
  }

  public registerInstrument(inst: InstrumentConfig): void {
    this.books.set(inst.symbol, new OrderBook(inst));
  }

  public getBook(symbol: string): OrderBook | undefined {
    return this.books.get(symbol);
  }

  public submitOrder(cmd: EngineOrderCommand): EngineResult {
    const book = this.books.get(cmd.symbol);
    if (!book) {
      return {
        success: false,
        seq: cmd.seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'INSTRUMENT_NOT_FOUND',
      };
    }
    return book.processOrder(cmd);
  }

  public cancelOrder(symbol: string, orderId: string, seq: number): EngineResult {
    const book = this.books.get(symbol);
    if (!book) {
      return {
        success: false,
        seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'INSTRUMENT_NOT_FOUND',
      };
    }
    return book.cancelOrder(orderId, seq);
  }

  public getOrder(symbol: string, orderId: string): OrderNode | undefined {
    const book = this.books.get(symbol);
    return book?.getOrder(orderId);
  }

  public getL2Snapshot(symbol: string, depth?: number) {
    const book = this.books.get(symbol);
    if (!book) return null;
    return book.getL2Snapshot(depth);
  }
}