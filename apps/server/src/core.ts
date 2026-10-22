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
  | { type: 'ESCROW_DELIVER'; escrowId: string; sellerUserId: string; resolve: (val: any) => void; reject: (err: any) => void }
  | { type: 'ESCROW_SWEEP'; resolve: (val: any) => void; reject: (err: any) => void };

export class ExchangeCore {
  public readonly engine: MatchingEngine;
  public readonly ledger: LedgerManager;
  public readonly persistence: PersistenceEngine;
  public readonly clock: Clock;

  public seq: number = 0;
  public readonly instruments: Map<string, InstrumentConfig> = new Map();
  public readonly balances: Map<string, UserBalance> = new Map();
  public readonly holdings: Map<string, UserHolding> = new Map(); // Key: `${userId}:${symbol}`
  public readonly auctions: Map<string, CoreAuction> = new Map();
  public readonly escrows: Map<string, CoreEscrow> = new Map();

  private commandQueue: Command[] = [];
  private isProcessing: boolean = false;
  private wsBroadcastCallback?: (event: { channel: string; type: string; data: any; seq: number }) => void;

  private maxCommandQueueDepth: number = 0;
  private commandExecutionTimesMs: number[] = [];
  private totalCommandsDispatched: number = 0;
  private totalCommandsRejected: number = 0;

  constructor(
    instruments: InstrumentConfig[],
    persistence: PersistenceEngine,
    clock: Clock
  ) {
    this.engine = new MatchingEngine(instruments);
    this.ledger = new LedgerManager();
    this.persistence = persistence;
    this.clock = clock;

    for (const inst of instruments) {
      this.instruments.set(inst.symbol, inst);
    }
  }

  public setWsBroadcast(cb: (event: any) => void): void {
    this.wsBroadcastCallback = cb;
  }

  public getBalance(userId: string): UserBalance {
    let bal = this.balances.get(userId);
    if (!bal) {
      bal = { available: 0, reserved: 0, escrow: 0 };
      this.balances.set(userId, bal);
    }
    return bal;
  }

  public getHolding(userId: string, symbol: string): UserHolding {
    const key = `${userId}:${symbol}`;
    let h = this.holdings.get(key);
    if (!h) {
      h = { available: 0, reserved: 0, escrow: 0 };
      this.holdings.set(key, h);
    }
    return h;
  }

  public dispatch<T>(cmd: any): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.totalCommandsDispatched++;
      this.commandQueue.push({ ...(cmd as any), resolve, reject });
      if (this.commandQueue.length > this.maxCommandQueueDepth) {
        this.maxCommandQueueDepth = this.commandQueue.length;
      }
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift()!;
      const t0 = performance.now();
      try {
        await this.executeCommand(item);
        this.commandExecutionTimesMs.push(performance.now() - t0);
      } catch (err) {
        this.totalCommandsRejected++;
        item.reject(err);
      }
    }

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

  private async executeCommand(item: Command): Promise<void> {
    this.seq++;
    const currentSeq = this.seq;

    switch (item.type) {
      case 'ORDER_SUBMIT': {
        const { cmd, resolve, reject } = item;
        cmd.seq = currentSeq;

        const inst = this.instruments.get(cmd.symbol);
        if (!inst) {
          return resolve({ success: false, rejectedReason: 'INSTRUMENT_NOT_FOUND', seq: currentSeq });
        }

        const ceiling = calculateCollarCeiling(inst.faceValue, inst.collarBps);
        const buyer = this.getBalance(cmd.userId);
        const sellerHolding = this.getHolding(cmd.userId, cmd.symbol);

        // Pre-Flight Financial Checks & Reservations
        let reservationCash = 0;
        let reservationQty = 0;

        if (cmd.side === 'BUY') {
          const reqPrice = cmd.type === 'LIMIT' ? (cmd.price ?? 0) : ceiling;
          reservationCash = reqPrice * cmd.qty;
          if (buyer.available < reservationCash) {
            return resolve({ success: false, rejectedReason: 'INSUFFICIENT_FUNDS', seq: currentSeq });
          }
        } else {
          reservationQty = cmd.qty;
          if (sellerHolding.available < reservationQty) {
            return resolve({ success: false, rejectedReason: 'INSUFFICIENT_INVENTORY', seq: currentSeq });
          }
        }

        // Apply In-Memory Reservation
        const journals: JournalDelta[] = [];
        const balanceDeltas: BalanceDelta[] = [];
        const holdingDeltas: HoldingDelta[] = [];

        if (reservationCash > 0) {
          buyer.available -= reservationCash;
          buyer.reserved += reservationCash;
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
          sellerHolding.available -= reservationQty;
          sellerHolding.reserved += reservationQty;
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

        // Execute Pure Synchronous Matching
        const result = this.engine.submitOrder(cmd);

        if (!result.success) {
          // Revert reservations on validation failure
          if (reservationCash > 0) {
            buyer.available += reservationCash;
            buyer.reserved -= reservationCash;
            const { journal, balanceDelta } = this.ledger.releaseCash(
              cmd.userId,
              reservationCash,
              'ORDER_REJECT',
              cmd.id,
              currentSeq
            );
            journals.push(journal);
            balanceDeltas.push(balanceDelta);
          }
          if (reservationQty > 0) {
            sellerHolding.available += reservationQty;
            sellerHolding.reserved -= reservationQty;
            const { journal, holdingDelta } = this.ledger.releaseAsset(
              cmd.userId,
              cmd.symbol,
              reservationQty,
              'ORDER_REJECT',
              cmd.id,
              currentSeq
            );
            journals.push(journal);
            holdingDeltas.push(holdingDelta);
          }

          return resolve(result);
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
            // Emit WebSockets only after successful DB commit
            this.broadcastMarketUpdates(cmd.symbol, currentSeq, result.trades);
            resolve(result);
          },
          onRollback: (err) => reject(err),
        };

        this.persistence.enqueue(deltaBatch);
        break;
      }

      case 'ORDER_CANCEL': {
        const { orderId, symbol, userId, resolve, reject } = item;
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
            resolve(cancelRes);
          },
          onRollback: (err) => reject(err),
        };

        this.persistence.enqueue(deltaBatch);
        break;
      }

      case 'AUCTION_CREATE': {
        const { data, resolve, reject } = item;
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

        const startsAt = this.clock.now();
        const endsAt = startsAt + data.durationSec * 1000;

        const auction: CoreAuction = {
          id: aucId,
          symbol: data.symbol,
          sellerUserId: data.sellerUserId,
          qtyTotal: data.qty,
          qtyRemaining: data.qty,
          startPrice: data.startPrice,
          floorPrice: data.floorPrice,
          stepAmount: data.stepAmount,
          stepIntervalMs: data.stepIntervalMs,
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
          onCommit: () => resolve({ success: true, auction }),
          onRollback: (err) => reject(err),
        };

        this.persistence.enqueue(deltaBatch);
        break;
      }

      case 'AUCTION_BUY': {
        const { auctionId, buyerUserId, qty, maxPrice, resolve, reject } = item;
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
        if (auc.qtyRemaining === 0) {
          auc.status = 'SOLD_OUT';
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
          onCommit: () => resolve({ success: true, price: currentPrice, qty, auction: auc }),
          onRollback: (err) => reject(err),
        };

        this.persistence.enqueue(deltaBatch);
        break;
      }

      case 'ESCROW_DELIVER': {
        const { escrowId, sellerUserId, resolve, reject } = item;
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
          onCommit: () => resolve({ success: true, escrow: esc }),
          onRollback: (err) => reject(err),
        };

        this.persistence.enqueue(deltaBatch);
        break;
      }

      case 'ESCROW_SWEEP': {
        const { resolve } = item;
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
    if (!this.wsBroadcastCallback) return;

    const snap = this.engine.getL2Snapshot(symbol, 20);
    if (snap) {
      this.wsBroadcastCallback({
        channel: `book:${symbol}`,
        type: 'delta',
        seq,
        data: snap,
      });
    }

    for (const t of trades) {
      this.wsBroadcastCallback({
        channel: `trades:${symbol}`,
        type: 'delta',
        seq,
        data: {
          id: t.id,
          symbol: t.symbol,
          price: t.price,
          qty: t.qty,
          side: t.takerSide,
          timestamp: this.clock.now(),
          isSimulated: false,
        },
      });
    }
  }
}