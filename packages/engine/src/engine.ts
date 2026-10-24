/**
 * @file engine.ts
 * Multi-instrument matching engine coordinator.
 * Isolates each instrument into its own OrderBook instance.
 */

import { InstrumentConfig, EngineOrderCommand, EngineResult, OrderNode } from './types.js';
import { OrderBook } from './orderbook.js';

export class MatchingEngine {
  private books: Map<string, OrderBook> = new Map();
  private lastSymbol?: string;
  private lastBook?: OrderBook;

  constructor(instruments: InstrumentConfig[]) {
    for (const inst of instruments) {
      this.registerInstrument(inst);
    }
  }

  public registerInstrument(inst: InstrumentConfig): void {
    const book = new OrderBook(inst);
    this.books.set(inst.symbol, book);
    if (this.lastSymbol === inst.symbol) {
      this.lastBook = book;
    }
  }

  public getBook(symbol: string): OrderBook | undefined {
    if (symbol === this.lastSymbol && this.lastBook) return this.lastBook;
    const b = this.books.get(symbol);
    if (b) {
      this.lastSymbol = symbol;
      this.lastBook = b;
    }
    return b;
  }

  public submitOrder(cmd: EngineOrderCommand): EngineResult {
    const book = (cmd.symbol === this.lastSymbol && this.lastBook)
      ? this.lastBook
      : this.books.get(cmd.symbol);
    if (!book) {
      return {
        success: false,
        seq: cmd.seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'INSTRUMENT_NOT_FOUND',
      };
    }
    this.lastSymbol = cmd.symbol;
    this.lastBook = book;
    return book.processOrder(cmd);
  }

  public cancelOrder(symbol: string, orderId: string, seq: number): EngineResult {
    const book = (symbol === this.lastSymbol && this.lastBook)
      ? this.lastBook
      : this.books.get(symbol);
    if (!book) {
      return {
        success: false,
        seq,
        trades: [],
        cancelledOrders: [],
        rejectedReason: 'INSTRUMENT_NOT_FOUND',
      };
    }
    this.lastSymbol = symbol;
    this.lastBook = book;
    return book.cancelOrder(orderId, seq);
  }

  public getOrder(symbol: string, orderId: string): OrderNode | undefined {
    const book = this.getBook(symbol);
    return book?.getOrder(orderId);
  }

  public getL2Snapshot(symbol: string, depth?: number) {
    const book = this.getBook(symbol);
    if (!book) return null;
    return book.getL2Snapshot(depth);
  }
}
