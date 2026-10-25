/**
 * @file core.ts
 * Single Authoritative In-Memory Writer.
 * Owns all order books, balances, holdings, auctions, and escrows in RAM.
 * Every state change is pushed onto a single FIFO command queue.
 */

import {
  MatchingEngine,
  InstrumentConfig,
  EngineOrderCommand,
  EngineResult,
  OrderNode,
  MatchedTrade,
} from '@darkhold/engine';
import { LedgerManager, JournalDelta, BalanceDelta, HoldingDelta } from './ledger.js';
import { PersistenceEngine, StateDeltaBatch, computeStats, TimingDistribution } from './persistence.js';
import { Clock } from './clock.js';
import { calculateCollarCeiling } from '@darkhold/shared';
import { AppendOnlyJournal } from './aol.js';

const EMPTY_ARRAY: any[] = Object.freeze([]) as any;

export type UserBalance = {
  available: number;
  reserved: number;
  escrow: number;
};

export type UserHolding = {
  available: number;
  reserved: number;
  escrow: number;
};

export type CoreAuction = {
  id: string;
  symbol: string;
  sellerUserId: string;
  qtyTotal: number;
  qtyRemaining: number;
  startPrice: number;
  floorPrice: number;
  stepAmount: number;
  stepIntervalMs: number;
  startsAt: number;
  endsAt: number;
  status: 'ACTIVE' | 'SOLD_OUT' | 'EXPIRED' | 'CANCELLED';
  clearingPrice?: number;
  endedAt?: number;
};

export type CoreEscrow = {
  id: string;
  tradeId: string;
  symbol: string;
  buyerUserId: string;
  sellerUserId: string;
  qty: number;
  amount: number;
  status: 'LOCKED' | 'RELEASED' | 'REFUNDED';
  expiresAt: number;
};

export type Command =
  | { type: 'ORDER_SUBMIT'; cmd: EngineOrderCommand; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'ORDER_CANCEL'; orderId: string; symbol: string; userId: string; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'AUCTION_CREATE'; data: any; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'AUCTION_BUY'; auctionId: string; buyerUserId: string; qty: number; maxPrice: number; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'AUCTION_CANCEL'; auctionId: string; userId: string; isAdmin: boolean; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'ESCROW_DELIVER'; escrowId: string; sellerUserId: string; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'ESCROW_SWEEP'; resolve: (val: any) => void; reject: (err: any) => void };

export class ExchangeCore {
  public readonly engine: MatchingEngine;
  public readonly ledger: LedgerManager;
  public readonly persistence: PersistenceEngine;
  public readonly clock: Clock;
  public aol?: AppendOnlyJournal;

  public seq: number = 0;
  public readonly instruments: Map<string, InstrumentConfig> = new Map();
  public readonly balances: Map<string, UserBalance> = new Map();
  public readonly holdings: Map<string, UserHolding> = new Map(); // Key: `${userId}:${symbol}`
  public readonly auctions: Map<string, CoreAuction> = new Map();
  public readonly escrows: Map<string, CoreEscrow> = new Map();

  public readonly cachedL2Snapshots: Map<string, { seq: number; data: any }> = new Map();
  public readonly cachedTrades: Map<string, Array<{ id: string; price: number; qty: number; is_simulated: boolean; created_at: string }>> = new Map();
  private pendingBroadcastSymbols: Set<string> = new Set();
  private pendingBroadcastTrades: Map<string, MatchedTrade[]> = new Map();
  private broadcastScheduled: boolean = false;

  private activeDeltaBatch: StateDeltaBatch | null = null;
  private activeHoldingDelta?: HoldingDelta;
  private activePostings?: Array<{ accountId: string; unit: string; amount: number; seq: number }>;
  private activeRestingOrder?: OrderNode;
  private syncResult: any;
  private readonly syncResolve = (val: any) => { this.syncResult = val; };
  private readonly syncReject = (err: any) => { throw err; };
  private lastUserId?: string;
  private lastBalance?: UserBalance;
  private lastHoldingKey?: string;
  private lastHolding?: UserHolding;
  private lastSymbol?: string;
  private lastInstrument?: InstrumentConfig;
  private lastTimestamp: number = 0;
  private profilePerOrder: boolean = process.env.PROFILE_PER_ORDER === '1';
  private commandQueue: Command[] = [];
  private isProcessing: boolean = false;
  private wsBroadcastCallback?: (event: { channel: string; type: string; data: any; seq: number }) => void;
  private wsUserNotifyCallback?: (userId: string, data: any, seq: number) => void;
  public readonly lastTradePrices: Map<string, number> = new Map();
  public readonly volume24h: Map<string, number> = new Map();

  private maxCommandQueueDepth: number = 0;
  private commandExecutionTimesMs: number[] = [];
  private totalCommandsDispatched: number = 0;
  private totalCommandsRejected: number = 0;

  constructor(
    instruments: InstrumentConfig[],
    persistence: PersistenceEngine,
    clock: Clock,
    aol?: AppendOnlyJournal
  ) {
    this.engine = new MatchingEngine(instruments);
    this.ledger = new LedgerManager();
    this.persistence = persistence;
    this.clock = clock;
    this.aol = aol;

    if (!this.aol) {
      const aolPath = process.env.AOL_PATH || (process.env.NODE_ENV === 'test' ? undefined : './journal.bin');
      if (aolPath) {
        try {
          this.aol = new AppendOnlyJournal(aolPath);
        } catch {}
      }
    }

    if (this.aol) {
      this.persistence.setBeforeFlushHook(() => {
      this.activeDeltaBatch = null;
      this.activeHoldingDelta = undefined;
      this.activePostings = undefined;
      this.activeRestingOrder = undefined;
      this.aol?.flushSync();
    });
    }

    this.persistence.setPrewarmHook(() => {
      this.warmupJIT();
    });

    for (const inst of instruments) {
      this.instruments.set(inst.symbol, inst);
      (inst as any).collarCeiling = calculateCollarCeiling(inst.faceValue, inst.collarBps);
    }
  }

  public warmupJIT(): void {
    const initialSeq = this.seq;
    const holding = this.getHolding('usr_admin', 'BENCH-X');
    const buyer = this.getBalance('usr_admin');
    const origHoldingAvail = holding.available;
    const origHoldingReserved = holding.reserved;
    const origBuyerAvail = buyer.available;
    const origBuyerReserved = buyer.reserved;

    const warmupCount = 300;
    for (let i = 1; i <= warmupCount; i++) {
      const isBuy = i % 2 === 0;
      this.executeCommandDirect({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: `__warm_${i}`,
          clientOrderId: `__cid_${i}`,
          seq: 0,
          userId: 'usr_admin',
          symbol: 'BENCH-X',
          side: isBuy ? 'BUY' : 'SELL',
          type: 'LIMIT',
          tif: 'GTC',
          price: 100000,
          qty: 1,
        },
      });
    }

    holding.available = origHoldingAvail;
    holding.reserved = origHoldingReserved;
    buyer.available = origBuyerAvail;
    buyer.reserved = origBuyerReserved;

    (this as any).engine = new MatchingEngine(Array.from(this.instruments.values()));
    this.activeDeltaBatch = null;
    this.activeHoldingDelta = undefined;
    this.activePostings = undefined;
    this.activeRestingOrder = undefined;
    this.seq = initialSeq;
    this.resetDispatchTelemetry();
    this.persistence.clearQueues();
    if (this.aol) {
      this.aol.reset();
    }
  }

  public close(): void {
    if (this.aol) {
      this.aol.close();
    }
    void this.persistence.close();
  }

  private isSyncAck(): boolean {
    return this.persistence.batchMax === 1 || this.persistence.injectFailure;
  }

  public setWsBroadcast(cb: (event: any) => void): void {
    this.wsBroadcastCallback = cb;
  }

  public setWsUserNotify(cb: (userId: string, data: any, seq: number) => void): void {
    this.wsUserNotifyCallback = cb;
  }

  public notifyUserBalance(userId: string, seq: number): void {
    if (!this.wsUserNotifyCallback) return;
    const bal = this.getBalance(userId);
    this.wsUserNotifyCallback(userId, {
      balance: {
        available: bal.available,
        reserved: bal.reserved,
        escrow: bal.escrow,
        total: bal.available + bal.reserved + bal.escrow,
      },
    }, seq);
  }

  public getLastPrice(symbol: string): number | null {
    return this.lastTradePrices.get(symbol) ?? null;
  }

  public getVolume24h(symbol: string): number {
    return this.volume24h.get(symbol) ?? 0;
  }

  public getTotalOpenOrderCount(symbol?: string): number {
    if (symbol) {
      return this.engine.getBook(symbol)?.getOpenOrderCount() ?? 0;
    }
    let count = 0;
    for (const inst of this.instruments.values()) {
      if (inst.isBenchmark) continue;
      count += this.engine.getBook(inst.symbol)?.getOpenOrderCount() ?? 0;
    }
    return count;
  }

  public getOpenOrdersForUser(userId: string) {
    return this.engine.getOpenOrdersForUser(userId);
  }

  public getActiveOrders(symbol?: string, userId?: string): Array<{
    id: string;
    client_order_id: string;
    seq: number;
    user_id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    tif: string;
    price: number;
    qty: number;
    remaining_qty: number;
    status: string;
    created_at: string;
  }> {
    const list = this.engine.getAllOpenOrders(symbol);
    const filtered = userId ? list.filter((o) => o.userId === userId) : list;
    return filtered.map((o) => ({
      id: o.id,
      client_order_id: o.clientOrderId,
      seq: o.seq,
      user_id: o.userId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      tif: o.tif,
      price: o.price,
      qty: o.qty,
      remaining_qty: o.remainingQty,
      status: o.status || 'OPEN',
      created_at: new Date().toISOString(),
    }));
  }

  public getBalance(userId: string): UserBalance {
    if (userId === this.lastUserId && this.lastBalance) return this.lastBalance;
    let bal = this.balances.get(userId);
    if (!bal) {
      bal = { available: 0, reserved: 0, escrow: 0 };
      this.balances.set(userId, bal);
    }
    this.lastUserId = userId;
    this.lastBalance = bal;
    return bal;
  }

  public getHolding(userId: string, symbol: string): UserHolding {
    const key = `${userId}:${symbol}`;
    if (key === this.lastHoldingKey && this.lastHolding) return this.lastHolding;
    let h = this.holdings.get(key);
    if (!h) {
      h = { available: 0, reserved: 0, escrow: 0 };
      this.holdings.set(key, h);
    }
    this.lastHoldingKey = key;
    this.lastHolding = h;
    return h;
  }

  private queueHead: number = 0;

  public dispatch<T>(cmd: any): Promise<T> {
    if (!this.isSyncAck() && !this.isProcessing && this.commandQueue.length === 0) {
      this.totalCommandsDispatched++;
      if (this.maxCommandQueueDepth < 1) {
        this.maxCommandQueueDepth = 1;
      }
      this.isProcessing = true;

      const shouldProfile = this.profilePerOrder || ((this.seq & 63) === 0);
      const t0 = shouldProfile ? performance.now() : 0;

      let result: any;
      try {
        result = this.executeCommandDirect(cmd);
        if (shouldProfile) {
          this.commandExecutionTimesMs.push(performance.now() - t0);
        }
      } catch (err) {
        this.isProcessing = false;
        this.totalCommandsRejected++;
        return Promise.reject(err);
      }

      this.isProcessing = false;
      if (this.commandQueue.length > 0) {
        this.processQueue();
      }
      return Promise.resolve(result as T);
    }

    return new Promise<T>((resolve, reject) => {
      this.totalCommandsDispatched++;
      this.commandQueue.push({ ...(cmd as any), resolve, reject });
      const currentDepth = this.commandQueue.length - this.queueHead;
      if (currentDepth > this.maxCommandQueueDepth) {
        this.maxCommandQueueDepth = currentDepth;
      }
      this.processQueue();
    });
  }

  private executeCommandDirect(cmd: any): any {
    this.executeCommand(cmd as Command, this.syncResolve, this.syncReject);
    return this.syncResult;
  }

  private processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const profileAll = process.env.PROFILE_PER_ORDER === '1';

    while (this.queueHead < this.commandQueue.length) {
      const item = this.commandQueue[this.queueHead++]!;
      const shouldProfile = profileAll || ((this.seq & 63) === 0);
      const t0 = shouldProfile ? performance.now() : 0;
      try {
        this.executeCommand(item);
        if (shouldProfile) {
          this.commandExecutionTimesMs.push(performance.now() - t0);
        }
      } catch (err) {
        this.totalCommandsRejected++;
        item.reject(err);
      }
    }

    this.commandQueue.length = 0;
    this.queueHead = 0;
    this.isProcessing = false;
  }

  public getDispatchTelemetry() {
    return {
      maxCommandQueueDepth: this.maxCommandQueueDepth,
      totalCommandsDispatched: this.totalCommandsDispatched,
      totalCommandsRejected: this.totalCommandsRejected,
      commandExecution: computeStats(this.commandExecutionTimesMs),
    };
  }

  public resetDispatchTelemetry(): void {
    this.maxCommandQueueDepth = 0;
    this.commandExecutionTimesMs = [];
    this.totalCommandsDispatched = 0;
    this.totalCommandsRejected = 0;
  }

  private executeCommand(
    item: Command,
    directResolve?: (val: any) => void,
    directReject?: (err: any) => void
  ): void {
    this.seq++;
    const currentSeq = this.seq;
    const resolve = directResolve || item.resolve || (() => {});
    const reject = directReject || item.reject || (() => {});

    switch (item.type) {
      case 'ORDER_SUBMIT': {
        const cmd = item.cmd;
        cmd.seq = currentSeq;

        const inst = (cmd.symbol === this.lastSymbol && this.lastInstrument)
          ? this.lastInstrument
          : this.instruments.get(cmd.symbol);
        if (inst) {
          this.lastSymbol = cmd.symbol;
          this.lastInstrument = inst;
        }
        if (!inst) {
          return resolve({ success: false, rejectedReason: 'INSTRUMENT_NOT_FOUND', seq: currentSeq });
        }

        const ceiling = (inst as any).collarCeiling || calculateCollarCeiling(inst.faceValue, inst.collarBps);
        let reservationCash = 0;
        let reservationQty = 0;
        let buyer: UserBalance | undefined;
        let sellerHolding: UserHolding | undefined;

        if (cmd.side === 'BUY') {
          buyer = this.getBalance(cmd.userId);
          const reqPrice = cmd.type === 'LIMIT' ? (cmd.price ?? 0) : ceiling;
          reservationCash = reqPrice * cmd.qty;
          if (buyer.available < reservationCash) {
            return resolve({ success: false, rejectedReason: 'INSUFFICIENT_FUNDS', seq: currentSeq });
          }
        } else {
          sellerHolding = this.getHolding(cmd.userId, cmd.symbol);
          reservationQty = cmd.qty;
          if (sellerHolding.available < reservationQty) {
            return resolve({ success: false, rejectedReason: 'INSUFFICIENT_INVENTORY', seq: currentSeq });
          }
        }

        // Execute Pure Synchronous Matching
        const result = this.engine.submitOrder(cmd);

        if (!result.success) {
          return resolve(result);
        }

        // Check for immediate self-cancellation with 0 trades (e.g. STP CANCEL_NEWEST or unmatched IOC)
        const isImmediateSelfCancelled =
          result.trades.length === 0 &&
          !result.restingOrder &&
          result.cancelledOrders.length === 1 &&
          result.cancelledOrders[0]!.id === cmd.id &&
          result.cancelledOrders[0]!.remainingQty === cmd.qty;

        if (isImmediateSelfCancelled) {
          if (this.aol) {
            const now = (currentSeq & 15) === 0 ? (this.lastTimestamp = this.clock.now()) : this.lastTimestamp;
            this.aol.appendRecord(
              currentSeq,
              now,
              1, // ORDER_SUBMIT
              cmd.price ?? 0,
              cmd.qty,
              cmd.side === 'BUY' ? 0 : 1,
              cmd.id,
              cmd.userId,
              cmd.symbol
            );
          }

          if (this.isSyncAck()) {
            const incomingNode: OrderNode = {
              id: cmd.id,
              clientOrderId: cmd.clientOrderId,
              seq: currentSeq,
              userId: cmd.userId,
              symbol: cmd.symbol,
              side: cmd.side,
              type: cmd.type,
              tif: cmd.tif,
              price: cmd.price ?? 0,
              qty: cmd.qty,
              remainingQty: cmd.qty,
              filledQty: 0,
              status: result.status || 'CANCELLED',
              createdAtSeq: currentSeq,
              next: null,
              prev: null,
            };

            const deltaBatch: StateDeltaBatch = {
              commandId: cmd.id,
              seq: currentSeq,
              journals: EMPTY_ARRAY,
              balanceDeltas: EMPTY_ARRAY,
              holdingDeltas: EMPTY_ARRAY,
              upsertOrders: [incomingNode],
              newTrades: EMPTY_ARRAY,
              upsertAuctions: EMPTY_ARRAY,
              upsertEscrows: EMPTY_ARRAY,
              auditEvents: EMPTY_ARRAY,
              onCommit: () => {
                this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
                resolve(result);
              },
              onRollback: (err) => reject(err),
            };
            this.persistence.enqueue(deltaBatch);
          } else {
            this.persistence.recordEphemeralCommand();
            if (this.wsBroadcastCallback) {
              this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
            }
            resolve(result);
          }
          break;
        }

        // Apply reservations for orders that actually rest or trade
        if (reservationCash > 0 && buyer) {
          buyer.available -= reservationCash;
          buyer.reserved += reservationCash;
        }
        if (reservationQty > 0 && sellerHolding) {
          sellerHolding.available -= reservationQty;
          sellerHolding.reserved -= reservationQty;
        }

        // In async mode, incrementally coalesce resting orders in-place via direct pointers
        if (!this.isSyncAck() && result.restingOrder && result.trades.length === 0) {
          if (this.activeDeltaBatch && this.activeHoldingDelta && this.activePostings && this.activeRestingOrder) {
            this.activePostings[0]!.amount -= reservationQty;
            this.activePostings[1]!.amount += reservationQty;
            this.activeHoldingDelta.availableDelta -= reservationQty;
            this.activeHoldingDelta.reservedDelta += reservationQty;
            this.activeRestingOrder.qty += cmd.qty;
            this.activeRestingOrder.remainingQty += cmd.qty;
            this.activeRestingOrder.seq = currentSeq;

            if (this.aol) {
              this.aol.appendRecord(
                currentSeq,
                (currentSeq & 15) === 0 ? (this.lastTimestamp = this.clock.now()) : this.lastTimestamp,
                1, // ORDER_SUBMIT
                cmd.price ?? 0,
                cmd.qty,
                cmd.side === 'BUY' ? 0 : 1,
                cmd.id,
                cmd.userId,
                cmd.symbol
              );
            }

            this.persistence.recordEphemeralCommand();
            if (this.wsBroadcastCallback) {
              this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
            }
            return resolve(result);
          }
        }

        // If not immediate self-cancelled, generate journals and deltas as normal
        const journals: JournalDelta[] = [];
        const balanceDeltas: BalanceDelta[] = [];
        const holdingDeltas: HoldingDelta[] = [];

        if (reservationCash > 0) {
          const { journal, balanceDelta } = this.ledger.reserveCash(
            cmd.userId,
            reservationCash,
            cmd.id,
            currentSeq
          );
          journals.push(journal);
          balanceDeltas.push(balanceDelta);
        }

        if (reservationQty > 0) {
          const { journal, holdingDelta } = this.ledger.reserveAsset(
            cmd.userId,
            cmd.symbol,
            reservationQty,
            cmd.id,
            currentSeq
          );
          journals.push(journal);
          holdingDeltas.push(holdingDelta);
        }

        // Process Matched Trades
        const upsertEscrows: CoreEscrow[] = [];

        for (const trade of result.trades) {
          if (inst.escrowRequired) {
            // Settle into Escrow Custody
            const escId = `esc_${currentSeq}_${trade.id}`;
            const tradeAmount = trade.price * trade.qty;

            const bBal = this.getBalance(trade.buyerUserId);
            const sHold = this.getHolding(trade.sellerUserId, trade.symbol);
            bBal.reserved -= tradeAmount;
            bBal.escrow += tradeAmount;
            sHold.reserved -= trade.qty;
            sHold.escrow += trade.qty;

            const { journal, buyerBalanceDelta, sellerHoldingDelta } = this.ledger.settleEscrowLock(
              trade.buyerUserId,
              trade.sellerUserId,
              trade.symbol,
              tradeAmount,
              trade.qty,
              escId,
              currentSeq
            );
            journals.push(journal);
            balanceDeltas.push(buyerBalanceDelta);
            holdingDeltas.push(sellerHoldingDelta);

            const escrowObj: CoreEscrow = {
              id: escId,
              tradeId: trade.id,
              symbol: trade.symbol,
              buyerUserId: trade.buyerUserId,
              sellerUserId: trade.sellerUserId,
              qty: trade.qty,
              amount: tradeAmount,
              status: 'LOCKED',
              expiresAt: this.clock.now() + 300_000, // 5 min timeout
            };
            this.escrows.set(escId, escrowObj);
            upsertEscrows.push(escrowObj);
          } else {
            // Settle Directly
            const bBal = this.getBalance(trade.buyerUserId);
            const sBal = this.getBalance(trade.sellerUserId);
            const bHold = this.getHolding(trade.buyerUserId, trade.symbol);
            const sHold = this.getHolding(trade.sellerUserId, trade.symbol);

            const tradeAmount = trade.price * trade.qty;
            bBal.reserved -= tradeAmount;
            sBal.available += tradeAmount;
            sHold.reserved -= trade.qty;
            bHold.available += trade.qty;

            const {
              journal,
              buyerBalanceDelta,
              sellerBalanceDelta,
              buyerHoldingDelta,
              sellerHoldingDelta,
            } = this.ledger.settleDirectTrade(
              trade.buyerUserId,
              trade.sellerUserId,
              trade.symbol,
              trade.price,
              trade.qty,
              trade.id,
              currentSeq
            );
            journals.push(journal);
            balanceDeltas.push(buyerBalanceDelta, sellerBalanceDelta);
            holdingDeltas.push(buyerHoldingDelta, sellerHoldingDelta);
          }

          // Price improvement cash release for aggressor buyer
          if (trade.buyerRefund > 0) {
            const bBal = this.getBalance(trade.buyerUserId);
            bBal.reserved -= trade.buyerRefund;
            bBal.available += trade.buyerRefund;

            const { journal, balanceDelta } = this.ledger.releaseCash(
              trade.buyerUserId,
              trade.buyerRefund,
              'PRICE_IMPROVEMENT',
              trade.id,
              currentSeq
            );
            journals.push(journal);
            balanceDeltas.push(balanceDelta);
          }
        }

        // Handle Cancelled Remainder (e.g. IOC, STP, or Market remainder)
        for (const cancelled of result.cancelledOrders) {
          if (cancelled.remainingQty > 0) {
            if (cancelled.side === 'BUY') {
              const bBal = this.getBalance(cancelled.userId);
              const refundCash = cancelled.remainingQty * (cmd.type === 'LIMIT' ? (cmd.price ?? 0) : ceiling);
              bBal.reserved -= refundCash;
              bBal.available += refundCash;

              const { journal, balanceDelta } = this.ledger.releaseCash(
                cancelled.userId,
                refundCash,
                'ORDER_CANCEL_IOC',
                cancelled.id,
                currentSeq
              );
              journals.push(journal);
              balanceDeltas.push(balanceDelta);
            } else {
              const sHold = this.getHolding(cancelled.userId, cancelled.symbol);
              sHold.reserved -= cancelled.remainingQty;
              sHold.available += cancelled.remainingQty;

              const { journal, holdingDelta } = this.ledger.releaseAsset(
                cancelled.userId,
                cancelled.symbol,
                cancelled.remainingQty,
                'ORDER_CANCEL_IOC',
                cancelled.id,
                currentSeq
              );
              journals.push(journal);
              holdingDeltas.push(holdingDelta);
            }
          }
        }

        // Package and enqueue for Group-Commit Persistence
        const incomingNode: OrderNode = {
          id: cmd.id,
          clientOrderId: cmd.clientOrderId,
          seq: currentSeq,
          userId: cmd.userId,
          symbol: cmd.symbol,
          side: cmd.side,
          type: cmd.type,
          tif: cmd.tif,
          price: cmd.price ?? 0,
          qty: cmd.qty,
          remainingQty: result.restingOrder ? result.restingOrder.remainingQty : (result.cancelledOrders[0]?.remainingQty ?? 0),
          filledQty: result.trades.reduce((acc, t) => acc + t.qty, 0),
          status: result.status || 'FILLED',
          createdAtSeq: currentSeq,
          next: null,
          prev: null,
        };

        const upsertOrders: OrderNode[] = [incomingNode];
        if (result.restingOrder) upsertOrders.push(result.restingOrder);
        for (const c of result.cancelledOrders) upsertOrders.push(c);
        for (const f of result.filledOrders || []) upsertOrders.push(f);

        // Fast Append-Only Log serialization
        if (this.aol) {
          const now = this.clock.now();
          this.aol.appendRecord(
            currentSeq,
            now,
            1, // ORDER_SUBMIT
            cmd.price ?? 0,
            cmd.qty,
            cmd.side === 'BUY' ? 0 : 1,
            cmd.id,
            cmd.userId,
            cmd.symbol
          );
          for (const trade of result.trades) {
            this.aol.appendRecord(
              currentSeq,
              now,
              3, // TRADE
              trade.price,
              trade.qty,
              trade.takerSide === 'BUY' ? 0 : 1,
              trade.id,
              trade.buyerUserId,
              trade.symbol
            );
          }
        }

        const deltaBatch: StateDeltaBatch = {
          commandId: cmd.id,
          seq: currentSeq,
          journals,
          balanceDeltas,
          holdingDeltas,
          upsertOrders,
          newTrades: result.trades,
          upsertAuctions: [],
          upsertEscrows,
          auditEvents: [],
          onCommit: () => {
            this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
          },
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for command ${cmd.id}:`, err.message);
          },
        };

        if (result.trades.length > 0) {
          for (let i = 0; i < result.trades.length; i++) {
            const t = result.trades[i]!;
            this.lastTradePrices.set(t.symbol, t.price);
            this.volume24h.set(t.symbol, (this.volume24h.get(t.symbol) || 0) + t.qty);
          }
        }
        if (this.wsUserNotifyCallback) {
          this.notifyUserBalance(cmd.userId, currentSeq);
          for (let i = 0; i < result.trades.length; i++) {
            const t = result.trades[i]!;
            if (t.buyerUserId !== cmd.userId) this.notifyUserBalance(t.buyerUserId, currentSeq);
            if (t.sellerUserId !== cmd.userId) this.notifyUserBalance(t.sellerUserId, currentSeq);
          }
        }

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => {
            this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
            resolve(result);
          };
          deltaBatch.onRollback = (err) => reject(err);
          this.persistence.enqueue(deltaBatch);
        } else {
          if (result.restingOrder && !this.activeDeltaBatch) {
            this.activeDeltaBatch = deltaBatch;
            this.activeHoldingDelta = deltaBatch.holdingDeltas[0];
            this.activePostings = deltaBatch.journals[0]?.postings;
            this.activeRestingOrder = deltaBatch.upsertOrders[0];
          }
          if (this.wsBroadcastCallback) {
            this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
          }
          this.persistence.enqueue(deltaBatch);
          resolve(result);
        }
        break;
      }

      case 'ORDER_CANCEL': {
        const { orderId, symbol, userId } = item;
        const ord = this.engine.getOrder(symbol, orderId);
        if (!ord) {
          return resolve({ success: false, rejectedReason: 'ORDER_NOT_FOUND', seq: currentSeq });
        }
        if (ord.userId !== userId) {
          return resolve({ success: false, rejectedReason: 'FORBIDDEN', seq: currentSeq });
        }

        const cancelRes = this.engine.cancelOrder(symbol, orderId, currentSeq);
        if (!cancelRes.success) {
          return resolve(cancelRes);
        }

        const journals: JournalDelta[] = [];
        const balanceDeltas: BalanceDelta[] = [];
        const holdingDeltas: HoldingDelta[] = [];

        // Release resting reservations
        if (ord.side === 'BUY') {
          const refundAmount = ord.remainingQty * ord.price;
          const bal = this.getBalance(ord.userId);
          bal.reserved -= refundAmount;
          bal.available += refundAmount;

          const { journal, balanceDelta } = this.ledger.releaseCash(
            ord.userId,
            refundAmount,
            'ORDER_CANCEL',
            ord.id,
            currentSeq
          );
          journals.push(journal);
          balanceDeltas.push(balanceDelta);
        } else {
          const hold = this.getHolding(ord.userId, ord.symbol);
          hold.reserved -= ord.remainingQty;
          hold.available += ord.remainingQty;

          const { journal, holdingDelta } = this.ledger.releaseAsset(
            ord.userId,
            ord.symbol,
            ord.remainingQty,
            'ORDER_CANCEL',
            ord.id,
            currentSeq
          );
          journals.push(journal);
          holdingDeltas.push(holdingDelta);
        }

        if (this.aol) {
          this.aol.appendRecord(
            currentSeq,
            this.clock.now(),
            2, // ORDER_CANCEL
            ord.price,
            ord.remainingQty,
            ord.side === 'BUY' ? 0 : 1,
            orderId,
            userId,
            symbol
          );
        }

        const deltaBatch: StateDeltaBatch = {
          commandId: `cancel-${orderId}`,
          seq: currentSeq,
          journals,
          balanceDeltas,
          holdingDeltas,
          upsertOrders: cancelRes.cancelledOrders,
          newTrades: [],
          upsertAuctions: [],
          upsertEscrows: [],
          auditEvents: [],
          onCommit: () => {
            this.broadcastMarketUpdates(symbol, currentSeq, []);
          },
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for cancel ${orderId}:`, err.message);
          },
        };

        if (this.wsUserNotifyCallback) {
          this.notifyUserBalance(userId, currentSeq);
        }

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => {
            this.broadcastMarketUpdates(symbol, currentSeq, []);
            resolve(cancelRes);
          };
          deltaBatch.onRollback = (err) => reject(err);
          this.persistence.enqueue(deltaBatch);
        } else {
          this.broadcastMarketUpdates(symbol, currentSeq, []);
          this.persistence.enqueue(deltaBatch);
          this.persistence.flush()
            .then(() => resolve(cancelRes))
            .catch((err) => reject(err));
        }
        break;
      }

      case 'AUCTION_CREATE': {
        const { data } = item;
        const inst = this.instruments.get(data.symbol);
        if (!inst) {
          return resolve({ success: false, rejectedReason: 'INSTRUMENT_NOT_FOUND' });
        }

        const ceiling = calculateCollarCeiling(inst.faceValue, inst.collarBps);
        if (data.startPrice > ceiling) {
          return resolve({ success: false, rejectedReason: 'COLLAR_VIOLATION' });
        }

        const sellerHolding = this.getHolding(data.sellerUserId, data.symbol);
        if (sellerHolding.available < data.qty) {
          return resolve({ success: false, rejectedReason: 'INSUFFICIENT_INVENTORY' });
        }

        // Reserve seller inventory
        sellerHolding.available -= data.qty;
        sellerHolding.reserved += data.qty;

        const aucId = `auc_${currentSeq}_${Date.now()}`;
        const { journal, holdingDelta } = this.ledger.reserveAsset(
          data.sellerUserId,
          data.symbol,
          data.qty,
          aucId,
          currentSeq
        );

        const durationSec = data.durationSec || 180;
        const stepIntervalMs = data.stepIntervalMs || 1000;
        let stepAmount = data.stepAmount;
        if (!stepAmount || stepAmount <= 0) {
          const totalSteps = Math.max(1, Math.floor((durationSec * 1000) / stepIntervalMs));
          stepAmount = Math.max(1, Math.ceil((data.startPrice - data.floorPrice) / totalSteps));
        }

        const startsAt = this.clock.now();
        const endsAt = startsAt + durationSec * 1000;

        const auction: CoreAuction = {
          id: aucId,
          symbol: data.symbol,
          sellerUserId: data.sellerUserId,
          qtyTotal: data.qty,
          qtyRemaining: data.qty,
          startPrice: data.startPrice,
          floorPrice: data.floorPrice,
          stepAmount,
          stepIntervalMs,
          startsAt,
          endsAt,
          status: 'ACTIVE',
        };

        this.auctions.set(aucId, auction);

        const deltaBatch: StateDeltaBatch = {
          commandId: aucId,
          seq: currentSeq,
          journals: [journal],
          balanceDeltas: [],
          holdingDeltas: [holdingDelta],
          upsertOrders: [],
          newTrades: [],
          upsertAuctions: [auction],
          upsertEscrows: [],
          auditEvents: [],
          onCommit: () => {},
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for auction ${aucId}:`, err.message);
          },
        };

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => resolve({ success: true, auction });
          deltaBatch.onRollback = (err) => reject(err);
        }
        this.persistence.enqueue(deltaBatch);
        if (!this.isSyncAck()) resolve({ success: true, auction });
        break;
      }

      case 'AUCTION_BUY': {
        const { auctionId, buyerUserId, qty, maxPrice } = item;
        const auc = this.auctions.get(auctionId);
        if (!auc || auc.status !== 'ACTIVE') {
          return resolve({ success: false, rejectedReason: 'AUCTION_NOT_ACTIVE' });
        }
        if (auc.sellerUserId === buyerUserId) {
          return resolve({ success: false, rejectedReason: 'CANNOT_BUY_OWN_AUCTION' });
        }
        if (auc.qtyRemaining < qty) {
          return resolve({ success: false, rejectedReason: 'INSUFFICIENT_AUCTION_QTY' });
        }

        // Server-side authoritative price decay calculation
        const now = this.clock.now();
        if (now >= auc.endsAt) {
          auc.status = 'EXPIRED';
          auc.clearingPrice = auc.floorPrice;
          auc.endedAt = now;
          return resolve({ success: false, rejectedReason: 'AUCTION_EXPIRED' });
        }

        const elapsed = Math.max(0, now - auc.startsAt);
        const steps = Math.floor(elapsed / auc.stepIntervalMs);
        const currentPrice = Math.max(auc.floorPrice, auc.startPrice - steps * auc.stepAmount);

        if (currentPrice > maxPrice) {
          return resolve({ success: false, rejectedReason: 'PRICE_MOVED', currentPrice });
        }

        const totalCash = currentPrice * qty;
        const buyerBal = this.getBalance(buyerUserId);
        if (buyerBal.available < totalCash) {
          return resolve({ success: false, rejectedReason: 'INSUFFICIENT_FUNDS' });
        }

        // Execute Purchase
        buyerBal.available -= totalCash;
        const sellerBal = this.getBalance(auc.sellerUserId);
        sellerBal.available += totalCash;

        const sellerHold = this.getHolding(auc.sellerUserId, auc.symbol);
        sellerHold.reserved -= qty;
        const buyerHold = this.getHolding(buyerUserId, auc.symbol);
        buyerHold.available += qty;

        auc.qtyRemaining -= qty;
        auc.clearingPrice = currentPrice;
        if (auc.qtyRemaining === 0) {
          auc.status = 'SOLD_OUT';
          auc.endedAt = now;
        }

        const {
          journal,
          buyerBalanceDelta,
          sellerBalanceDelta,
          buyerHoldingDelta,
          sellerHoldingDelta,
        } = this.ledger.settleAuctionPurchase(
          buyerUserId,
          auc.sellerUserId,
          auc.symbol,
          currentPrice,
          qty,
          auc.id,
          currentSeq
        );

        const deltaBatch: StateDeltaBatch = {
          commandId: `auc_buy_${auc.id}_${currentSeq}`,
          seq: currentSeq,
          journals: [journal],
          balanceDeltas: [buyerBalanceDelta, sellerBalanceDelta],
          holdingDeltas: [buyerHoldingDelta, sellerHoldingDelta],
          upsertOrders: [],
          newTrades: [],
          upsertAuctions: [auc],
          upsertEscrows: [],
          auditEvents: [],
          onCommit: () => {},
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for auction buy ${auc.id}:`, err.message);
          },
        };

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => resolve({ success: true, price: currentPrice, qty, auction: auc });
          deltaBatch.onRollback = (err) => reject(err);
        }
        this.persistence.enqueue(deltaBatch);
        if (!this.isSyncAck()) resolve({ success: true, price: currentPrice, qty, auction: auc });
        break;
      }

      case 'AUCTION_CANCEL': {
        const { auctionId, userId, isAdmin } = item;
        const auc = this.auctions.get(auctionId);
        if (!auc) {
          return resolve({ success: false, rejectedReason: 'AUCTION_NOT_FOUND' });
        }
        if (auc.status !== 'ACTIVE') {
          return resolve({ success: false, rejectedReason: 'AUCTION_NOT_ACTIVE' });
        }
        if (auc.sellerUserId !== userId && !isAdmin) {
          return resolve({ success: false, rejectedReason: 'UNAUTHORIZED' });
        }

        const now = this.clock.now();
        const elapsed = Math.max(0, now - auc.startsAt);
        const steps = Math.floor(elapsed / auc.stepIntervalMs);
        const currentPrice = Math.max(auc.floorPrice, auc.startPrice - steps * auc.stepAmount);

        auc.status = 'CANCELLED';
        auc.clearingPrice = currentPrice;
        auc.endedAt = now;

        const remaining = auc.qtyRemaining;
        auc.qtyRemaining = 0;

        // Release reserved inventory back to available
        const sellerHold = this.getHolding(auc.sellerUserId, auc.symbol);
        sellerHold.reserved -= remaining;
        sellerHold.available += remaining;

        const { journal, holdingDelta } = this.ledger.releaseAsset(
          auc.sellerUserId,
          auc.symbol,
          remaining,
          'AUCTION_CANCEL',
          auc.id,
          currentSeq
        );

        const deltaBatch: StateDeltaBatch = {
          commandId: `auc_cancel_${auc.id}_${currentSeq}`,
          seq: currentSeq,
          journals: [journal],
          balanceDeltas: [],
          holdingDeltas: [holdingDelta],
          upsertOrders: [],
          newTrades: [],
          upsertAuctions: [auc],
          upsertEscrows: [],
          auditEvents: [],
          onCommit: () => {},
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for auction cancel ${auc.id}:`, err.message);
          },
        };

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => resolve({ success: true, auction: auc, reclaimedQty: remaining });
          deltaBatch.onRollback = (err) => reject(err);
        }
        this.persistence.enqueue(deltaBatch);
        if (!this.isSyncAck()) resolve({ success: true, auction: auc, reclaimedQty: remaining });
        break;
      }

      case 'ESCROW_DELIVER': {
        const { escrowId, sellerUserId } = item;
        const esc = this.escrows.get(escrowId);
        if (!esc || esc.status !== 'LOCKED') {
          return resolve({ success: false, rejectedReason: 'ESCROW_NOT_LOCKED' });
        }
        if (esc.sellerUserId !== sellerUserId) {
          return resolve({ success: false, rejectedReason: 'FORBIDDEN' });
        }

        // Release Escrow funds to seller, asset to buyer
        const buyerBal = this.getBalance(esc.buyerUserId);
        buyerBal.escrow -= esc.amount;
        const sellerBal = this.getBalance(esc.sellerUserId);
        sellerBal.available += esc.amount;

        const sellerHold = this.getHolding(esc.sellerUserId, esc.symbol);
        sellerHold.escrow -= esc.qty;
        const buyerHold = this.getHolding(esc.buyerUserId, esc.symbol);
        buyerHold.available += esc.qty;

        esc.status = 'RELEASED';

        const {
          journal,
          buyerBalanceDelta,
          sellerBalanceDelta,
          buyerHoldingDelta,
          sellerHoldingDelta,
        } = this.ledger.releaseEscrow(
          esc.buyerUserId,
          esc.sellerUserId,
          esc.symbol,
          esc.amount,
          esc.qty,
          esc.id,
          currentSeq
        );

        const deltaBatch: StateDeltaBatch = {
          commandId: `esc_rel_${esc.id}`,
          seq: currentSeq,
          journals: [journal],
          balanceDeltas: [buyerBalanceDelta, sellerBalanceDelta],
          holdingDeltas: [buyerHoldingDelta, sellerHoldingDelta],
          upsertOrders: [],
          newTrades: [],
          upsertAuctions: [],
          upsertEscrows: [esc],
          auditEvents: [],
          onCommit: () => {},
          onRollback: (err) => {
            console.error(`[CORE] Background persistence failed for escrow release ${esc.id}:`, err.message);
          },
        };

        if (this.isSyncAck()) {
          deltaBatch.onCommit = () => resolve({ success: true, escrow: esc });
          deltaBatch.onRollback = (err) => reject(err);
        }
        this.persistence.enqueue(deltaBatch);
        if (!this.isSyncAck()) resolve({ success: true, escrow: esc });
        break;
      }

      case 'ESCROW_SWEEP': {
        const now = this.clock.now();
        let sweptCount = 0;

        for (const esc of this.escrows.values()) {
          if (esc.status === 'LOCKED' && now >= esc.expiresAt) {
            esc.status = 'REFUNDED';
            sweptCount++;

            // Refund cash to buyer, asset to seller
            const buyerBal = this.getBalance(esc.buyerUserId);
            buyerBal.escrow -= esc.amount;
            buyerBal.available += esc.amount;

            const sellerHold = this.getHolding(esc.sellerUserId, esc.symbol);
            sellerHold.escrow -= esc.qty;
            sellerHold.available += esc.qty;

            const { journal, buyerBalanceDelta, sellerHoldingDelta } = this.ledger.refundEscrow(
              esc.buyerUserId,
              esc.sellerUserId,
              esc.symbol,
              esc.amount,
              esc.qty,
              esc.id,
              currentSeq
            );

            this.persistence.enqueue({
              commandId: `esc_refund_${esc.id}`,
              seq: currentSeq,
              journals: [journal],
              balanceDeltas: [buyerBalanceDelta],
              holdingDeltas: [sellerHoldingDelta],
              upsertOrders: [],
              newTrades: [],
              upsertAuctions: [],
              upsertEscrows: [esc],
              auditEvents: [],
              onCommit: () => {},
              onRollback: () => {},
            });
          }
        }

        resolve({ success: true, sweptCount });
        break;
      }
    }
  }

  private broadcastMarketUpdates(symbol: string, seq: number, trades: MatchedTrade[]): void {
    // Invalidate cached L2 snapshot on any book modification
    this.cachedL2Snapshots.delete(symbol);

    // Keep cached trades in sync in RAM
    if (trades.length > 0) {
      let list = this.cachedTrades.get(symbol);
      if (!list) {
        list = [];
        this.cachedTrades.set(symbol, list);
      }
      const nowStr = new Date().toISOString();
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i]!;
        list.unshift({
          id: t.id,
          price: t.price,
          qty: t.qty,
          is_simulated: false,
          created_at: nowStr,
        });
      }
      if (list.length > 50) list.length = 50;
    }

    if (!this.wsBroadcastCallback) return;

    this.pendingBroadcastSymbols.add(symbol);
    if (trades.length > 0) {
      let pTrades = this.pendingBroadcastTrades.get(symbol);
      if (!pTrades) {
        pTrades = [];
        this.pendingBroadcastTrades.set(symbol, pTrades);
      }
      for (let i = 0; i < trades.length; i++) {
        pTrades.push(trades[i]!);
      }
      if (pTrades.length > 50) {
        pTrades.splice(0, pTrades.length - 50);
      }
    }

    if (!this.broadcastScheduled) {
      this.broadcastScheduled = true;
      setImmediate(() => {
        this.broadcastScheduled = false;
        this.flushBroadcasts();
      });
    }
  }

  private flushBroadcasts(): void {
    if (!this.wsBroadcastCallback) {
      this.pendingBroadcastSymbols.clear();
      this.pendingBroadcastTrades.clear();
      return;
    }

    for (const symbol of this.pendingBroadcastSymbols) {
      const snap = this.engine.getL2Snapshot(symbol, 20);
      if (snap) {
        this.wsBroadcastCallback({
          channel: `book:${symbol}`,
          type: 'delta',
          seq: this.seq,
          data: snap,
        });
      }

      const trades = this.pendingBroadcastTrades.get(symbol);
      if (trades && trades.length > 0) {
        const now = this.clock.now();
        for (let i = 0; i < trades.length; i++) {
          const t = trades[i]!;
          this.wsBroadcastCallback({
            channel: `trades:${symbol}`,
            type: 'delta',
            seq: this.seq,
            data: {
              id: t.id,
              symbol: t.symbol,
              price: t.price,
              qty: t.qty,
              side: t.takerSide,
              timestamp: now,
              isSimulated: false,
            },
          });
        }
      }
    }

    this.pendingBroadcastSymbols.clear();
    this.pendingBroadcastTrades.clear();
  }
}