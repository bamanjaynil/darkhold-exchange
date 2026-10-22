/**
 * @file persistence.ts
 * High-Throughput Group-Commit Persistence Engine with Forensic Telemetry Instrumentation.
 * Batches and coalesces state deltas into PostgreSQL within a single ACID transaction
 * using multi-row bulk statements and in-memory delta reduction.
 * Resolves command promises and releases events ONLY after commit.
 */

import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { JournalDelta, BalanceDelta, HoldingDelta } from './ledger.js';
import { MatchedTrade, OrderNode } from '@darkhold/engine';

export type StateDeltaBatch = {
  commandId: string;
  seq: number;
  journals: JournalDelta[];
  balanceDeltas: BalanceDelta[];
  holdingDeltas: HoldingDelta[];
  upsertOrders: OrderNode[];
  newTrades: MatchedTrade[];
  upsertAuctions: any[];
  upsertEscrows: any[];
  auditEvents: Array<{
    eventType: string;
    reason: string;
    userId?: string;
    ip?: string;
    metadata?: any;
  }>;
  onCommit: () => void;
  onRollback: (err: Error) => void;
  enqueuedAt?: number;
};

export type TimingDistribution = {
  count: number;
  sumMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type PersistenceTelemetry = {
  counts: {
    flushes: number;
    totalCommands: number;
    totalJournals: number;
    totalPostings: number;
    totalBalanceUpdates: number;
    totalHoldingUpdates: number;
    totalOrdersUpserted: number;
    totalTradesInserted: number;
    totalAuctionsUpserted: number;
    totalEscrowsUpserted: number;
    totalAuditEvents: number;

    queryCountBegin: number;
    queryCountJournals: number;
    queryCountPostings: number;
    queryCountBalances: number;
    queryCountHoldings: number;
    queryCountOrders: number;
    queryCountTrades: number;
    queryCountAuctions: number;
    queryCountEscrows: number;
    queryCountAudit: number;
    queryCountCommit: number;
    queryCountRollback: number;
    totalQueriesExecuted: number;

    maxQueueDepth: number;
    failedTransactions: number;
    rollbacks: number;
  };
  stages: {
    queueWait: TimingDistribution;
    acquireConnection: TimingDistribution;
    begin: TimingDistribution;
    coalesceRam: TimingDistribution;
    sqlJournals: TimingDistribution;
    sqlPostings: TimingDistribution;
    sqlBalances: TimingDistribution;
    sqlHoldings: TimingDistribution;
    sqlOrders: TimingDistribution;
    sqlTrades: TimingDistribution;
    sqlMisc: TimingDistribution;
    commit: TimingDistribution;
    postCommitCallbacks: TimingDistribution;
    totalFlushDuration: TimingDistribution;
  };
  breakdownPct: {
    acquireConnectionPct: number;
    beginPct: number;
    coalesceRamPct: number;
    allSqlQueriesPct: number;
    commitPct: number;
    postCommitCallbacksPct: number;
    otherFlushPct: number;
  };
};

export function computeStats(arr: number[]): TimingDistribution {
  if (arr.length === 0) {
    return { count: 0, sumMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((acc, v) => acc + v, 0);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return {
    count: arr.length,
    sumMs: Math.round(sum * 100) / 100,
    meanMs: Math.round((sum / arr.length) * 100) / 100,
    p50Ms: Math.round(p50 * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    p99Ms: Math.round(p99 * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
  };
}

export class PersistenceEngine {
  private pool: pg.Pool;
  private batchMax: number;
  private batchMs: number;
  private queue: StateDeltaBatch[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private rebuildCallback?: () => Promise<void>;
  public injectFailure: boolean = false; // For testing rollback and rebuild

  // --- Telemetry State ---
  private queueWaitMs: number[] = [];
  private acquireConnMs: number[] = [];
  private beginMs: number[] = [];
  private coalesceRamMs: number[] = [];
  private sqlJournalsMs: number[] = [];
  private sqlPostingsMs: number[] = [];
  private sqlBalancesMs: number[] = [];
  private sqlHoldingsMs: number[] = [];
  private sqlOrdersMs: number[] = [];
  private sqlTradesMs: number[] = [];
  private sqlMiscMs: number[] = [];
  private commitMs: number[] = [];
  private postCommitCallbacksMs: number[] = [];
  private totalFlushMs: number[] = [];

  private flushesCount = 0;
  private totalCommandsCount = 0;
  private totalJournalsCount = 0;
  private totalPostingsCount = 0;
  private totalBalanceUpdatesCount = 0;
  private totalHoldingUpdatesCount = 0;
  private totalOrdersUpsertedCount = 0;
  private totalTradesInsertedCount = 0;
  private totalAuctionsUpsertedCount = 0;
  private totalEscrowsUpsertedCount = 0;
  private totalAuditEventsCount = 0;

  private queryCountBegin = 0;
  private queryCountJournals = 0;
  private queryCountPostings = 0;
  private queryCountBalances = 0;
  private queryCountHoldings = 0;
  private queryCountOrders = 0;
  private queryCountTrades = 0;
  private queryCountAuctions = 0;
  private queryCountEscrows = 0;
  private queryCountAudit = 0;
  private queryCountCommit = 0;
  private queryCountRollback = 0;

  private maxQueueDepth = 0;
  private failedTransactionsCount = 0;
  private rollbacksCount = 0;

  constructor(pool: pg.Pool, batchMax: number = 100, batchMs: number = 5) {
    this.pool = pool;
    this.batchMax = batchMax;
    this.batchMs = batchMs;
  }

  public setRebuildCallback(cb: () => Promise<void>): void {
    this.rebuildCallback = cb;
  }

  public enqueue(batch: StateDeltaBatch): void {
    batch.enqueuedAt = performance.now();
    this.queue.push(batch);
    if (this.queue.length > this.maxQueueDepth) {
      this.maxQueueDepth = this.queue.length;
    }

    if (this.queue.length >= this.batchMax) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.batchMs);
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const flushStart = performance.now();
    const toProcess = this.queue.splice(0, this.batchMax);

    for (let i = 0; i < toProcess.length; i++) {
      if (toProcess[i]!.enqueuedAt !== undefined) {
        this.queueWaitMs.push(flushStart - toProcess[i]!.enqueuedAt!);
      }
    }

    const tAcquire = performance.now();
    const client = await this.pool.connect();
    this.acquireConnMs.push(performance.now() - tAcquire);

    try {
      if (this.injectFailure) {
        throw new Error('[SIMULATED_PERSISTENCE_FAILURE] Injected disk or DB error');
      }

      const tBegin = performance.now();
      await client.query('BEGIN');
      this.beginMs.push(performance.now() - tBegin);
      this.queryCountBegin++;

      const tCoalesce = performance.now();

      // 1. Coalesce Journals & Postings
      const allJournals: JournalDelta[] = [];
      const allPostings: Array<{ journalId: string; accountId: string; unit: string; amount: number; seq: number }> = [];

      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let jIdx = 0; jIdx < batch.journals.length; jIdx++) {
          const j = batch.journals[jIdx]!;
          allJournals.push(j);
          for (let pIdx = 0; pIdx < j.postings.length; pIdx++) {
            const p = j.postings[pIdx]!;
            allPostings.push({
              journalId: j.id,
              accountId: p.accountId,
              unit: p.unit,
              amount: p.amount,
              seq: p.seq,
            });
          }
        }
      }

      // 2. Coalesce Balance Deltas per unique User ID in memory
      const netBalances = new Map<string, { avail: number; res: number; esc: number }>();
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let dIdx = 0; dIdx < batch.balanceDeltas.length; dIdx++) {
          const bd = batch.balanceDeltas[dIdx]!;
          let cur = netBalances.get(bd.userId);
          if (!cur) {
            cur = { avail: 0, res: 0, esc: 0 };
            netBalances.set(bd.userId, cur);
          }
          cur.avail += bd.availableDelta;
          cur.res += bd.reservedDelta;
          cur.esc += bd.escrowDelta;
        }
      }

      // 3. Coalesce Holding Deltas per unique (User, Symbol) in memory
      const netHoldings = new Map<string, { userId: string; symbol: string; avail: number; res: number; esc: number }>();
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let hIdx = 0; hIdx < batch.holdingDeltas.length; hIdx++) {
          const hd = batch.holdingDeltas[hIdx]!;
          const key = `${hd.userId}:${hd.symbol}`;
          let cur = netHoldings.get(key);
          if (!cur) {
            cur = { userId: hd.userId, symbol: hd.symbol, avail: 0, res: 0, esc: 0 };
            netHoldings.set(key, cur);
          }
          cur.avail += hd.availableDelta;
          cur.res += hd.reservedDelta;
          cur.esc += hd.escrowDelta;
        }
      }

      // 4. Bulk Upsert Orders (deduplicate within batch to keep latest order state)
      const latestOrders = new Map<string, OrderNode>();
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let oIdx = 0; oIdx < batch.upsertOrders.length; oIdx++) {
          const ord = batch.upsertOrders[oIdx]!;
          latestOrders.set(ord.id, ord);
        }
      }
      const allOrders = Array.from(latestOrders.values());

      // 5. Bulk Insert Trades
      const allTrades: MatchedTrade[] = [];
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let tIdx = 0; tIdx < batch.newTrades.length; tIdx++) {
          allTrades.push(batch.newTrades[tIdx]!);
        }
      }

      this.coalesceRamMs.push(performance.now() - tCoalesce);

      // Execute Bulk Insert Journals (in chunks of 500)
      const tJournals = performance.now();
      const J_CHUNK = 500;
      for (let i = 0; i < allJournals.length; i += J_CHUNK) {
        const chunk = allJournals.slice(i, i + J_CHUNK);
        const values: any[] = [];
        const rows = chunk.map((j, idx) => {
          const base = idx * 4;
          values.push(j.id, j.kind, j.refType, j.refId);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id)
           VALUES ${rows.join(', ')}
           ON CONFLICT (id) DO NOTHING`,
          values
        );
        this.queryCountJournals++;
      }
      this.sqlJournalsMs.push(performance.now() - tJournals);
      this.totalJournalsCount += allJournals.length;

      // Execute Bulk Insert Postings
      const tPostings = performance.now();
      const postingsMode = process.env.POSTINGS_WRITE_MODE || 'values';

      if (allPostings.length > 0) {
        if (postingsMode === 'unnest') {
          const journalIds: string[] = [];
          const accountIds: string[] = [];
          const units: string[] = [];
          const amounts: number[] = [];
          const seqs: number[] = [];

          for (let i = 0; i < allPostings.length; i++) {
            const p = allPostings[i]!;
            journalIds.push(p.journalId);
            accountIds.push(p.accountId);
            units.push(p.unit);
            amounts.push(p.amount);
            seqs.push(p.seq);
          }

          await client.query({
            name: 'insert_postings_unnest',
            text: `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
                   SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::bigint[], $5::bigint[])`,
            values: [journalIds, accountIds, units, amounts, seqs],
          });
          this.queryCountPostings++;
        } else {
          // 'values' mode (chunked multi-row INSERT at 300 rows)
          const P_CHUNK = 300;
          for (let i = 0; i < allPostings.length; i += P_CHUNK) {
            const chunk = allPostings.slice(i, i + P_CHUNK);
            const values: any[] = [];
            const rows = chunk.map((p, idx) => {
              const base = idx * 5;
              values.push(p.journalId, p.accountId, p.unit, p.amount, p.seq);
              return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
            });
            await client.query(
              `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
               VALUES ${rows.join(', ')}`,
              values
            );
            this.queryCountPostings++;
          }
        }
      }
      this.sqlPostingsMs.push(performance.now() - tPostings);
      this.totalPostingsCount += allPostings.length;

      // Execute Balances Updates
      const tBalances = performance.now();
      for (const [userId, d] of netBalances.entries()) {
        if (d.avail === 0 && d.res === 0 && d.esc === 0) continue;
        await client.query(
          `UPDATE balances
           SET available = available + $2,
               reserved = reserved + $3,
               escrow = escrow + $4,
               updated_at = NOW()
           WHERE user_id = $1`,
          [userId, d.avail, d.res, d.esc]
        );
        this.queryCountBalances++;
        this.totalBalanceUpdatesCount++;
      }
      this.sqlBalancesMs.push(performance.now() - tBalances);

      // Execute Holdings Updates
      const tHoldings = performance.now();
      for (const cur of netHoldings.values()) {
        if (cur.avail === 0 && cur.res === 0 && cur.esc === 0) continue;
        await client.query(
          `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow)
           SELECT $1, i.id, GREATEST(0, $3::bigint), GREATEST(0, $4::bigint), GREATEST(0, $5::bigint)
           FROM instruments i WHERE i.symbol = $2
           ON CONFLICT (user_id, instrument_id) DO UPDATE
           SET available = holdings.available + $3,
               reserved = holdings.reserved + $4,
               escrow = holdings.escrow + $5,
               updated_at = NOW()`,
          [cur.userId, cur.symbol, cur.avail, cur.res, cur.esc]
        );
        this.queryCountHoldings++;
        this.totalHoldingUpdatesCount++;
      }
      this.sqlHoldingsMs.push(performance.now() - tHoldings);

      // Execute Orders Bulk Upsert
      const tOrders = performance.now();
      const O_CHUNK = 200;
      for (let i = 0; i < allOrders.length; i += O_CHUNK) {
        const chunk = allOrders.slice(i, i + O_CHUNK);
        const values: any[] = [];
        const rows = chunk.map((ord, idx) => {
          const base = idx * 12;
          values.push(
            ord.id,
            ord.clientOrderId,
            ord.seq,
            ord.userId,
            ord.symbol,
            ord.side,
            ord.type,
            ord.tif,
            ord.price,
            ord.qty,
            ord.remainingQty,
            ord.status
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, (SELECT id FROM instruments WHERE symbol = $${base + 5}), $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
        });

        await client.query(
          `INSERT INTO orders (id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status)
           VALUES ${rows.join(', ')}
           ON CONFLICT (id) DO UPDATE SET
             remaining_qty = EXCLUDED.remaining_qty,
             status = EXCLUDED.status,
             updated_at = NOW()`,
          values
        );
        this.queryCountOrders++;
      }
      this.sqlOrdersMs.push(performance.now() - tOrders);
      this.totalOrdersUpsertedCount += allOrders.length;

      // Execute Trades Bulk Insert
      const tTrades = performance.now();
      if (allTrades.length > 0) {
        const T_CHUNK = 200;
        for (let i = 0; i < allTrades.length; i += T_CHUNK) {
          const chunk = allTrades.slice(i, i + T_CHUNK);
          const values: any[] = [];
          const rows = chunk.map((tr, idx) => {
            const base = idx * 10;
            values.push(
              tr.id,
              tr.seq,
              tr.symbol,
              tr.buyOrderId,
              tr.sellOrderId,
              tr.buyerUserId,
              tr.sellerUserId,
              tr.price,
              tr.qty,
              tr.buyerRefund
            );
            return `($${base + 1}, $${base + 2}, (SELECT id FROM instruments WHERE symbol = $${base + 3}), $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, false)`;
          });

          await client.query(
            `INSERT INTO trades (id, seq, instrument_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, buyer_refund, is_simulated)
             VALUES ${rows.join(', ')}
             ON CONFLICT (id) DO NOTHING`,
            values
          );
          this.queryCountTrades++;
        }
      }
      this.sqlTradesMs.push(performance.now() - tTrades);
      this.totalTradesInsertedCount += allTrades.length;

      // Execute Auctions / Escrows / Audit Events
      const tMisc = performance.now();
      for (const batch of toProcess) {
        for (const auc of batch.upsertAuctions) {
          await client.query(
            `INSERT INTO auctions (id, instrument_id, seller_user_id, qty_total, qty_remaining, start_price, floor_price, step_amount, step_interval_ms, starts_at, ends_at, status)
             SELECT $1, i.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
             FROM instruments i WHERE i.symbol = $12
             ON CONFLICT (id) DO UPDATE SET
               qty_remaining = EXCLUDED.qty_remaining,
               status = EXCLUDED.status,
               updated_at = NOW()`,
            [
              auc.id,
              auc.sellerUserId,
              auc.qtyTotal,
              auc.qtyRemaining,
              auc.startPrice,
              auc.floorPrice,
              auc.stepAmount,
              auc.stepIntervalMs,
              new Date(auc.startsAt),
              new Date(auc.endsAt),
              auc.status,
              auc.symbol,
            ]
          );
          this.queryCountAuctions++;
          this.totalAuctionsUpsertedCount++;
        }

        for (const esc of batch.upsertEscrows) {
          await client.query(
            `INSERT INTO escrows (id, trade_id, instrument_id, buyer_user_id, seller_user_id, qty, amount, status, expires_at)
             SELECT $1, $2, i.id, $3, $4, $5, $6, $7, $8
             FROM instruments i WHERE i.symbol = $9
             ON CONFLICT (id) DO UPDATE SET
               status = EXCLUDED.status,
               updated_at = NOW()`,
            [
              esc.id,
              esc.tradeId,
              esc.buyerUserId,
              esc.sellerUserId,
              esc.qty,
              esc.amount,
              esc.status,
              new Date(esc.expiresAt),
              esc.symbol,
            ]
          );
          this.queryCountEscrows++;
          this.totalEscrowsUpsertedCount++;
        }

        for (const ev of batch.auditEvents) {
          await client.query(
            `INSERT INTO audit_events (event_type, reason, user_id, ip, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [ev.eventType, ev.reason, ev.userId, ev.ip, ev.metadata ? JSON.stringify(ev.metadata) : null]
          );
          this.queryCountAudit++;
          this.totalAuditEventsCount++;
        }
      }
      this.sqlMiscMs.push(performance.now() - tMisc);

      // Execute COMMIT (includes deferred trigger execution in Postgres)
      const tCommit = performance.now();
      await client.query('COMMIT');
      this.commitMs.push(performance.now() - tCommit);
      this.queryCountCommit++;

      // Release command callbacks ONLY after commit
      const tCallbacks = performance.now();
      for (let i = 0; i < toProcess.length; i++) {
        toProcess[i]!.onCommit();
      }
      this.postCommitCallbacksMs.push(performance.now() - tCallbacks);

      this.totalCommandsCount += toProcess.length;
      this.flushesCount++;
      this.totalFlushMs.push(performance.now() - flushStart);
    } catch (err: any) {
      const tRollback = performance.now();
      await client.query('ROLLBACK');
      this.queryCountRollback++;
      this.failedTransactionsCount++;
      this.rollbacksCount++;

      console.error('[PERSISTENCE_ERROR] Commit failed! Rejecting batch and triggering recovery rebuild.', err);

      for (let i = 0; i < toProcess.length; i++) {
        toProcess[i]!.onRollback(err);
      }

      if (this.rebuildCallback) {
        try {
          await this.rebuildCallback();
        } catch (rebuildErr) {
          console.error('[CRITICAL] State rebuild after rollback failed:', rebuildErr);
        }
      }
    } finally {
      client.release();
      this.isFlushing = false;

      if (this.queue.length > 0) {
        void this.flush();
      }
    }
  }

  public getTelemetry(): PersistenceTelemetry {
    const queueWait = computeStats(this.queueWaitMs);
    const acquireConnection = computeStats(this.acquireConnMs);
    const begin = computeStats(this.beginMs);
    const coalesceRam = computeStats(this.coalesceRamMs);
    const sqlJournals = computeStats(this.sqlJournalsMs);
    const sqlPostings = computeStats(this.sqlPostingsMs);
    const sqlBalances = computeStats(this.sqlBalancesMs);
    const sqlHoldings = computeStats(this.sqlHoldingsMs);
    const sqlOrders = computeStats(this.sqlOrdersMs);
    const sqlTrades = computeStats(this.sqlTradesMs);
    const sqlMisc = computeStats(this.sqlMiscMs);
    const commit = computeStats(this.commitMs);
    const postCommitCallbacks = computeStats(this.postCommitCallbacksMs);
    const totalFlushDuration = computeStats(this.totalFlushMs);

    const totalFlushSum = totalFlushDuration.sumMs || 1;
    const allSqlSum =
      sqlJournals.sumMs +
      sqlPostings.sumMs +
      sqlBalances.sumMs +
      sqlHoldings.sumMs +
      sqlOrders.sumMs +
      sqlTrades.sumMs +
      sqlMisc.sumMs;

    const totalQueries =
      this.queryCountBegin +
      this.queryCountJournals +
      this.queryCountPostings +
      this.queryCountBalances +
      this.queryCountHoldings +
      this.queryCountOrders +
      this.queryCountTrades +
      this.queryCountAuctions +
      this.queryCountEscrows +
      this.queryCountAudit +
      this.queryCountCommit +
      this.queryCountRollback;

    return {
      counts: {
        flushes: this.flushesCount,
        totalCommands: this.totalCommandsCount,
        totalJournals: this.totalJournalsCount,
        totalPostings: this.totalPostingsCount,
        totalBalanceUpdates: this.totalBalanceUpdatesCount,
        totalHoldingUpdates: this.totalHoldingUpdatesCount,
        totalOrdersUpserted: this.totalOrdersUpsertedCount,
        totalTradesInserted: this.totalTradesInsertedCount,
        totalAuctionsUpserted: this.totalAuctionsUpsertedCount,
        totalEscrowsUpserted: this.totalEscrowsUpsertedCount,
        totalAuditEvents: this.totalAuditEventsCount,

        queryCountBegin: this.queryCountBegin,
        queryCountJournals: this.queryCountJournals,
        queryCountPostings: this.queryCountPostings,
        queryCountBalances: this.queryCountBalances,
        queryCountHoldings: this.queryCountHoldings,
        queryCountOrders: this.queryCountOrders,
        queryCountTrades: this.queryCountTrades,
        queryCountAuctions: this.queryCountAuctions,
        queryCountEscrows: this.queryCountEscrows,
        queryCountAudit: this.queryCountAudit,
        queryCountCommit: this.queryCountCommit,
        queryCountRollback: this.queryCountRollback,
        totalQueriesExecuted: totalQueries,

        maxQueueDepth: this.maxQueueDepth,
        failedTransactions: this.failedTransactionsCount,
        rollbacks: this.rollbacksCount,
      },
      stages: {
        queueWait,
        acquireConnection,
        begin,
        coalesceRam,
        sqlJournals,
        sqlPostings,
        sqlBalances,
        sqlHoldings,
        sqlOrders,
        sqlTrades,
        sqlMisc,
        commit,
        postCommitCallbacks,
        totalFlushDuration,
      },
      breakdownPct: {
        acquireConnectionPct: Math.round((acquireConnection.sumMs / totalFlushSum) * 10000) / 100,
        beginPct: Math.round((begin.sumMs / totalFlushSum) * 10000) / 100,
        coalesceRamPct: Math.round((coalesceRam.sumMs / totalFlushSum) * 10000) / 100,
        allSqlQueriesPct: Math.round((allSqlSum / totalFlushSum) * 10000) / 100,
        commitPct: Math.round((commit.sumMs / totalFlushSum) * 10000) / 100,
        postCommitCallbacksPct: Math.round((postCommitCallbacks.sumMs / totalFlushSum) * 10000) / 100,
        otherFlushPct:
          Math.round(
            ((totalFlushSum -
              (acquireConnection.sumMs +
                begin.sumMs +
                coalesceRam.sumMs +
                allSqlSum +
                commit.sumMs +
                postCommitCallbacks.sumMs)) /
              totalFlushSum) *
              10000
          ) / 100,
      },
    };
  }

  public resetTelemetry(): void {
    this.queueWaitMs = [];
    this.acquireConnMs = [];
    this.beginMs = [];
    this.coalesceRamMs = [];
    this.sqlJournalsMs = [];
    this.sqlPostingsMs = [];
    this.sqlBalancesMs = [];
    this.sqlHoldingsMs = [];
    this.sqlOrdersMs = [];
    this.sqlTradesMs = [];
    this.sqlMiscMs = [];
    this.commitMs = [];
    this.postCommitCallbacksMs = [];
    this.totalFlushMs = [];

    this.flushesCount = 0;
    this.totalCommandsCount = 0;
    this.totalJournalsCount = 0;
    this.totalPostingsCount = 0;
    this.totalBalanceUpdatesCount = 0;
    this.totalHoldingUpdatesCount = 0;
    this.totalOrdersUpsertedCount = 0;
    this.totalTradesInsertedCount = 0;
    this.totalAuctionsUpsertedCount = 0;
    this.totalEscrowsUpsertedCount = 0;
    this.totalAuditEventsCount = 0;

    this.queryCountBegin = 0;
    this.queryCountJournals = 0;
    this.queryCountPostings = 0;
    this.queryCountBalances = 0;
    this.queryCountHoldings = 0;
    this.queryCountOrders = 0;
    this.queryCountTrades = 0;
    this.queryCountAuctions = 0;
    this.queryCountEscrows = 0;
    this.queryCountAudit = 0;
    this.queryCountCommit = 0;
    this.queryCountRollback = 0;

    this.maxQueueDepth = 0;
    this.failedTransactionsCount = 0;
    this.rollbacksCount = 0;
  }
}
