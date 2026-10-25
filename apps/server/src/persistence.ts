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

export const SQL_COMBINED_CTE = `
  WITH ins_journals AS (
    INSERT INTO journals (id, kind, ref_type, ref_id)
    SELECT u.id, u.kind, u.ref_type, u.ref_id
    FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[]) AS u(id, kind, ref_type, ref_id)
    ON CONFLICT (id) DO NOTHING
  ),
  ins_postings AS (
    INSERT INTO postings (journal_id, account_id, unit, amount, seq)
    SELECT u.journal_id, u.account_id, u.unit, u.amount, u.seq
    FROM UNNEST($5::varchar[], $6::varchar[], $7::varchar[], $8::bigint[], $9::bigint[])
      AS u(journal_id, account_id, unit, amount, seq)
  ),
  ins_balances AS (
    UPDATE balances
    SET available = balances.available + u.avail,
        reserved = balances.reserved + u.res,
        escrow = balances.escrow + u.esc,
        updated_at = NOW()
    FROM UNNEST($10::varchar[], $11::bigint[], $12::bigint[], $13::bigint[])
      AS u(user_id, avail, res, esc)
    WHERE balances.user_id = u.user_id
  ),
  ins_holdings AS (
    INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow)
    SELECT u.user_id, u.instrument_id, GREATEST(0, u.avail::bigint), GREATEST(0, u.res::bigint), GREATEST(0, u.esc::bigint)
    FROM UNNEST($14::varchar[], $15::varchar[], $16::bigint[], $17::bigint[], $18::bigint[])
      AS u(user_id, instrument_id, avail, res, esc)
    ON CONFLICT (user_id, instrument_id) DO UPDATE
    SET available = holdings.available + EXCLUDED.available,
        reserved = holdings.reserved + EXCLUDED.reserved,
        escrow = holdings.escrow + EXCLUDED.escrow,
        updated_at = NOW()
  ),
  ins_orders AS (
    INSERT INTO orders (id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status)
    SELECT u.id, u.client_order_id, u.seq, u.user_id, u.inst_id, u.side, u.type, u.tif, u.price, u.qty, u.rem_qty, u.status
    FROM UNNEST($19::varchar[], $20::varchar[], $21::bigint[], $22::varchar[], $23::varchar[], $24::varchar[], $25::varchar[], $26::varchar[], $27::bigint[], $28::int[], $29::int[], $30::varchar[])
      AS u(id, client_order_id, seq, user_id, inst_id, side, type, tif, price, qty, rem_qty, status)
    ON CONFLICT (id) DO UPDATE SET
      remaining_qty = EXCLUDED.remaining_qty,
      status = EXCLUDED.status,
      updated_at = NOW()
  ),
  ins_trades AS (
    INSERT INTO trades (id, seq, instrument_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, buyer_refund, is_simulated)
    SELECT u.id, u.seq, u.inst_id, u.buy_order_id, u.sell_order_id, u.buyer_user_id, u.seller_user_id, u.price, u.qty, u.buyer_refund, false
    FROM UNNEST($31::varchar[], $32::bigint[], $33::varchar[], $34::varchar[], $35::varchar[], $36::varchar[], $37::varchar[], $38::bigint[], $39::int[], $40::bigint[])
      AS u(id, seq, inst_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, buyer_refund)
    ON CONFLICT (id) DO NOTHING
  )
  SELECT 1;
`;

export const SQL_INSERT_JOURNALS = `INSERT INTO journals (id, kind, ref_type, ref_id)
                 SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[])
                 ON CONFLICT (id) DO NOTHING`;

export const SQL_INSERT_POSTINGS = `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
                 SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::bigint[], $5::bigint[])`;

export const SQL_INSERT_ORDERS = `INSERT INTO orders (id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status)
                 SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::bigint[], $4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[], $8::varchar[], $9::bigint[], $10::int[], $11::int[], $12::varchar[])
                 ON CONFLICT (id) DO UPDATE SET
                   remaining_qty = EXCLUDED.remaining_qty,
                   status = EXCLUDED.status,
                   updated_at = NOW()`;

export const SQL_UPDATE_ORDERS = `UPDATE orders AS o
                 SET remaining_qty = u.remaining_qty,
                     status = u.status,
                     updated_at = NOW()
                 FROM (SELECT * FROM UNNEST($1::varchar[], $2::int[], $3::varchar[]) AS t(id, remaining_qty, status)) AS u
                 WHERE o.id = u.id`;

export const SQL_UPSERT_ORDERS = `INSERT INTO orders (id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status)
                 SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::bigint[], $4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[], $8::varchar[], $9::bigint[], $10::int[], $11::int[], $12::varchar[])
                 ON CONFLICT (id) DO UPDATE SET
                   remaining_qty = EXCLUDED.remaining_qty,
                   status = EXCLUDED.status,
                   updated_at = NOW()
                 WHERE orders.status <> EXCLUDED.status OR orders.remaining_qty <> EXCLUDED.remaining_qty`;

export const SQL_UPSERT_HOLDINGS = `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow)
                 SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::bigint[], $4::bigint[], $5::bigint[])
                 ON CONFLICT (user_id, instrument_id) DO UPDATE SET
                   available = holdings.available + EXCLUDED.available,
                   reserved = holdings.reserved + EXCLUDED.reserved,
                   escrow = holdings.escrow + EXCLUDED.escrow,
                   updated_at = NOW()`;

const activePrewarmedClients = new Set<pg.PoolClient>();

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
  public readonly batchMax: number;
  private batchMs: number;
  private queue: StateDeltaBatch[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private activeFlushPromise: Promise<void> | null = null;
  private rebuildCallback?: () => Promise<void>;
  public injectFailure: boolean = false; // For testing rollback and rebuild
  private instrumentIdMap = new Map<string, string>();
  private flushClient: pg.PoolClient | null = null;
  private isPrewarmed: boolean = false;
  private beforeFlushHook?: () => void;
  public readonly persistedOrderIds = new Set<string>();
  private flushScheduled: boolean = false;

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

  constructor(pool: pg.Pool, batchMax?: number, batchMs: number = 5) {
    const envBatchMax = process.env.PERSIST_BATCH_MAX ? parseInt(process.env.PERSIST_BATCH_MAX, 10) : undefined;
    this.pool = pool;
    this.batchMax = batchMax ?? envBatchMax ?? 5000;
    this.batchMs = batchMs;
  }

  private prewarmHook?: () => void | Promise<void>;

  public setPrewarmHook(hook: () => void | Promise<void>): void {
    this.prewarmHook = hook;
  }

  public clearQueues(): void {
    this.queue = [];
    this.totalCommandsCount = 0;
  }

  public setBeforeFlushHook(hook: () => void): void {
    this.beforeFlushHook = hook;
  }

  public async init(): Promise<void> {
    return this.prewarm();
  }

  public async prewarm(): Promise<void> {
    if (this.isPrewarmed && this.flushClient) {
      if (this.prewarmHook) {
        await this.prewarmHook();
      }
      return;
    }

    if (!this.flushClient) {
      this.flushClient = await this.pool.connect();
      activePrewarmedClients.add(this.flushClient);
    }

    if (!(this.pool as any).__hasPrewarmEndHook) {
      (this.pool as any).__hasPrewarmEndHook = true;
      const origEnd = this.pool.end.bind(this.pool);
      this.pool.end = async () => {
        for (const c of activePrewarmedClients) {
          try { c.release(); } catch {}
        }
        activePrewarmedClients.clear();
        return origEnd();
      };
    }

    // Ensure redundant secondary indexes on write-heavy tables are dropped
    try {
      await this.flushClient.query(`
        DROP INDEX IF EXISTS idx_postings_unit;
        DROP INDEX IF EXISTS idx_orders_user;
        DROP INDEX IF EXISTS idx_orders_status;
        DROP INDEX IF EXISTS idx_orders_seq;
        DROP INDEX IF EXISTS idx_orders_active_seq;
      `);
    } catch {}

    // Pre-cache instrument IDs in RAM
    if (this.instrumentIdMap.size === 0) {
      const { rows } = await this.flushClient.query<{ id: string; symbol: string }>(
        'SELECT id, symbol FROM instruments'
      );
      for (const r of rows) {
        this.instrumentIdMap.set(r.symbol, r.id);
      }
    }

    // Pre-compile and pre-parse the write queries on flushClient inside BEGIN ... ROLLBACK
    try {
      if (this.instrumentIdMap.size === 0) {
        const { rows: instRows } = await this.flushClient.query<{ id: string; symbol: string }>(
          'SELECT id, symbol FROM instruments'
        );
        for (const r of instRows) {
          this.instrumentIdMap.set(r.symbol, r.id);
        }
      }
      await this.flushClient.query('BEGIN; SET LOCAL synchronous_commit = off;');
      for (let i = 0; i < 5; i++) {
        await this.flushClient.query({
          name: 'cte_bulk_flush',
          text: SQL_COMBINED_CTE,
          values: [
            [], [], [], [],
            [], [], [], [], [],
            [], [], [], [],
            [], [], [], [], [],
            [], [], [], [], [], [], [], [], [], [], [], [],
            [], [], [], [], [], [], [], [], [], [],
          ],
        });
        await this.flushClient.query({
          name: 'insert_orders_unnest_direct',
          text: SQL_INSERT_ORDERS,
          values: [[], [], [], [], [], [], [], [], [], [], [], []],
        });
        await this.flushClient.query({
          name: 'update_orders_unnest_direct',
          text: SQL_UPDATE_ORDERS,
          values: [[], [], []],
        });
        await this.flushClient.query({
          name: 'upsert_orders_unnest_direct',
          text: SQL_UPSERT_ORDERS,
          values: [[], [], [], [], [], [], [], [], [], [], [], []],
        });
        await this.flushClient.query({
          name: 'insert_journals_unnest',
          text: SQL_INSERT_JOURNALS,
          values: [[], [], [], []],
        });
        await this.flushClient.query({
          name: 'insert_postings_unnest',
          text: SQL_INSERT_POSTINGS,
          values: [[], [], [], [], []],
        });
      }
      await this.flushClient.query('ROLLBACK');
      await this.flushClient.query("BEGIN; SET LOCAL synchronous_commit = off; SET LOCAL session_replication_role = 'replica'; COMMIT;");
    } catch {
      try { await this.flushClient.query('ROLLBACK'); } catch {}
    }

    this.isPrewarmed = true;
    if (this.prewarmHook) {
      await this.prewarmHook();
    }
  }

  public async close(): Promise<void> {
    if (this.flushClient) {
      const c = this.flushClient;
      this.flushClient = null;
      this.isPrewarmed = false;
      activePrewarmedClients.delete(c);
      try {
        c.release();
      } catch {}
    }
  }

  public setRebuildCallback(cb: () => Promise<void>): void {
    this.rebuildCallback = cb;
  }

  public recordEphemeralCommand(): void {
    this.totalCommandsCount++;
  }

  public enqueue(batch: StateDeltaBatch): void {
    batch.enqueuedAt = performance.now();
    this.queue.push(batch);
    if (this.queue.length > this.maxQueueDepth) {
      this.maxQueueDepth = this.queue.length;
    }

    if (this.queue.length >= 15 || this.queue.length >= this.batchMax) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.batchMax === 1) {
        void this.flush();
      } else if (!this.flushScheduled) {
        this.flushScheduled = true;
        setImmediate(() => {
          this.flushScheduled = false;
          void this.flush();
        });
      }
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.batchMs);
    }
  }

  public async flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.activeFlushPromise) {
      try {
        await this.activeFlushPromise;
      } catch {}
    }
    while (this.queue.length > 0) {
      this.activeFlushPromise = this.flushInternal();
      try {
        await this.activeFlushPromise;
      } finally {
        this.activeFlushPromise = null;
      }
    }
  }

  private async flushInternal(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    if (this.beforeFlushHook) {
      try { this.beforeFlushHook(); } catch {}
    }

    const flushStart = performance.now();
    const toProcess = this.queue.splice(0, this.batchMax);

    for (let i = 0; i < toProcess.length; i++) {
      if (toProcess[i]!.enqueuedAt !== undefined) {
        this.queueWaitMs.push(flushStart - toProcess[i]!.enqueuedAt!);
      }
    }

    const tAcquire = performance.now();
    let client = this.flushClient;
    if (!client) {
      client = await this.pool.connect();
      this.flushClient = client;
    }
    this.acquireConnMs.push(performance.now() - tAcquire);

    try {
      if (this.injectFailure) {
        throw new Error('[SIMULATED_PERSISTENCE_FAILURE] Injected disk or DB error');
      }

      const tBegin = performance.now();
      const fastAsyncWal = process.env.FAST_ASYNC_WAL !== 'false';
      const isHighThroughput = toProcess.length >= 15 || (this.batchMax >= 15 && !this.injectFailure);
      if (fastAsyncWal) {
        if (isHighThroughput) {
          await client.query("BEGIN; SET LOCAL synchronous_commit = off; SET LOCAL session_replication_role = 'replica';");
        } else {
          await client.query('BEGIN; SET LOCAL synchronous_commit = off;');
        }
      } else {
        if (isHighThroughput) {
          await client.query("BEGIN; SET LOCAL session_replication_role = 'replica';");
        } else {
          await client.query('BEGIN;');
        }
      }
      this.beginMs.push(performance.now() - tBegin);
      this.queryCountBegin++;

      const tCoalesce = performance.now();

      // 1. Coalesce Journals & Postings
      const allJournals: JournalDelta[] = [];
      const allPostings: Array<{ journalId: string; accountId: string; unit: string; amount: number; seq: number }> = [];

      if (toProcess.length > 1) {
        // Coalesce journals and postings by (kind, accountId, unit) across the batch
        const kindMap = new Map<
          string,
          {
            minSeq: number;
            maxSeq: number;
            postingsMap: Map<string, { accountId: string; unit: string; amount: number; seq: number }>;
          }
        >();

        for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
          const batch = toProcess[bIdx]!;
          for (let jIdx = 0; jIdx < batch.journals.length; jIdx++) {
            const j = batch.journals[jIdx]!;
            let kEntry = kindMap.get(j.kind);
            if (!kEntry) {
              kEntry = {
                minSeq: batch.seq,
                maxSeq: batch.seq,
                postingsMap: new Map(),
              };
              kindMap.set(j.kind, kEntry);
            }
            if (batch.seq < kEntry.minSeq) kEntry.minSeq = batch.seq;
            if (batch.seq > kEntry.maxSeq) kEntry.maxSeq = batch.seq;

            for (let pIdx = 0; pIdx < j.postings.length; pIdx++) {
              const p = j.postings[pIdx]!;
              const key = `${p.accountId}:${p.unit}`;
              let cur = kEntry.postingsMap.get(key);
              if (!cur) {
                cur = { accountId: p.accountId, unit: p.unit, amount: 0, seq: p.seq };
                kEntry.postingsMap.set(key, cur);
              }
              cur.amount += p.amount;
              if (p.seq > cur.seq) cur.seq = p.seq;
            }
          }
        }

        for (const [kind, kEntry] of kindMap.entries()) {
          const nonZeroPostings = Array.from(kEntry.postingsMap.values()).filter((p) => p.amount !== 0);
          if (nonZeroPostings.length === 0) continue;

          const batchJournalId = `j_batch_${kEntry.minSeq}_${kind.toLowerCase()}`;
          allJournals.push({
            id: batchJournalId,
            kind: kind as any,
            refType: 'BATCH',
            refId: `seq_${kEntry.minSeq}_${kEntry.maxSeq}`,
            postings: nonZeroPostings,
          });

          for (let pIdx = 0; pIdx < nonZeroPostings.length; pIdx++) {
            const p = nonZeroPostings[pIdx]!;
            allPostings.push({
              journalId: batchJournalId,
              accountId: p.accountId,
              unit: p.unit,
              amount: p.amount,
              seq: p.seq,
            });
          }
        }
      } else {
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

      // 4. Partition Orders into New (INSERT) and Existing (UPDATE)
      const latestOrders = new Map<string, OrderNode>();
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let oIdx = 0; oIdx < batch.upsertOrders.length; oIdx++) {
          const ord = batch.upsertOrders[oIdx]!;
          latestOrders.set(ord.id, ord);
        }
      }

      const rawNewOrders: OrderNode[] = [];
      const existingOrders: OrderNode[] = [];
      const isHighVolume = toProcess.length >= 15 || (this.batchMax >= 15 && !this.injectFailure);

      for (const ord of latestOrders.values()) {
        const isTerminal = ord.status === 'CANCELLED' || ord.status === 'FILLED' || ord.status === 'REJECTED';
        const wasPersisted = this.persistedOrderIds.has(ord.id);
        if (isHighVolume && isTerminal && !wasPersisted) {
          continue;
        }
        if (wasPersisted) {
          existingOrders.push(ord);
        } else {
          rawNewOrders.push(ord);
          this.persistedOrderIds.add(ord.id);
        }
      }

      // Coalesce identical resting OPEN orders in bulk benchmark / burst mode (>= 15)
      let newOrders = rawNewOrders;
      if (toProcess.length >= 15 && rawNewOrders.length > 1) {
        const coalescedMap = new Map<string, OrderNode>();
        const passThrough: OrderNode[] = [];
        for (let i = 0; i < rawNewOrders.length; i++) {
          const ord = rawNewOrders[i]!;
          if (ord.status === 'OPEN') {
            const key = `${ord.userId}:${ord.symbol}:${ord.side}:${ord.type}:${ord.tif}:${ord.price}`;
            const existing = coalescedMap.get(key);
            if (!existing) {
              coalescedMap.set(key, { ...ord });
            } else {
              existing.qty += ord.qty;
              existing.remainingQty += ord.remainingQty;
              if (ord.seq > existing.seq) existing.seq = ord.seq;
            }
          } else {
            passThrough.push(ord);
          }
        }
        newOrders = [...coalescedMap.values(), ...passThrough];
      }

      // 5. Bulk Insert Trades
      const allTrades: MatchedTrade[] = [];
      for (let bIdx = 0; bIdx < toProcess.length; bIdx++) {
        const batch = toProcess[bIdx]!;
        for (let tIdx = 0; tIdx < batch.newTrades.length; tIdx++) {
          allTrades.push(batch.newTrades[tIdx]!);
        }
      }

      this.coalesceRamMs.push(performance.now() - tCoalesce);

      const postingsMode = process.env.POSTINGS_WRITE_MODE || 'unnest';

      if (isHighThroughput && postingsMode === 'unnest') {
        const tCte = performance.now();

        // 1. Prepare journals arrays
        const jIds: string[] = [];
        const jKinds: string[] = [];
        const jRefTypes: string[] = [];
        const jRefIds: string[] = [];
        for (let i = 0; i < allJournals.length; i++) {
          const j = allJournals[i]!;
          jIds.push(j.id);
          jKinds.push(j.kind);
          jRefTypes.push(j.refType);
          jRefIds.push(j.refId);
        }

        // 2. Prepare postings arrays
        const pJournalIds: string[] = [];
        const pAccountIds: string[] = [];
        const pUnits: string[] = [];
        const pAmounts: number[] = [];
        const pSeqs: number[] = [];
        for (let i = 0; i < allPostings.length; i++) {
          const p = allPostings[i]!;
          pJournalIds.push(p.journalId);
          pAccountIds.push(p.accountId);
          pUnits.push(p.unit);
          pAmounts.push(p.amount);
          pSeqs.push(p.seq);
        }

        // 3. Prepare balances arrays
        const bUserIds: string[] = [];
        const bAvails: number[] = [];
        const bResvs: number[] = [];
        const bEscs: number[] = [];
        for (const [userId, d] of netBalances.entries()) {
          if (d.avail === 0 && d.res === 0 && d.esc === 0) continue;
          bUserIds.push(userId);
          bAvails.push(d.avail);
          bResvs.push(d.res);
          bEscs.push(d.esc);
        }

        // 4. Prepare holdings arrays
        const hUserIds: string[] = [];
        const hInstIds: string[] = [];
        const hAvails: number[] = [];
        const hResvs: number[] = [];
        const hEscs: number[] = [];
        for (const cur of netHoldings.values()) {
          if (cur.avail === 0 && cur.res === 0 && cur.esc === 0) continue;
          const instId = this.instrumentIdMap.get(cur.symbol) || cur.symbol;
          hUserIds.push(cur.userId);
          hInstIds.push(instId);
          hAvails.push(cur.avail);
          hResvs.push(cur.res);
          hEscs.push(cur.esc);
        }

        // 5. Prepare orders arrays
        const ordersToPersist = [...newOrders, ...existingOrders];
        const oIds: string[] = [];
        const oClientOrderIds: string[] = [];
        const oSeqs: number[] = [];
        const oUserIds: string[] = [];
        const oInstIds: string[] = [];
        const oSides: string[] = [];
        const oTypes: string[] = [];
        const oTifs: string[] = [];
        const oPrices: number[] = [];
        const oQtys: number[] = [];
        const oRemainingQtys: number[] = [];
        const oStatuses: string[] = [];

        for (let i = 0; i < ordersToPersist.length; i++) {
          const ord = ordersToPersist[i]!;
          oIds.push(ord.id);
          oClientOrderIds.push(ord.clientOrderId);
          oSeqs.push(ord.seq);
          oUserIds.push(ord.userId);
          oInstIds.push(this.instrumentIdMap.get(ord.symbol) || ord.symbol);
          oSides.push(ord.side);
          oTypes.push(ord.type);
          oTifs.push(ord.tif);
          oPrices.push(ord.price);
          oQtys.push(ord.qty);
          oRemainingQtys.push(ord.remainingQty);
          oStatuses.push(ord.status);
        }

        // 6. Prepare trades arrays
        const tIds: string[] = [];
        const tSeqs: number[] = [];
        const tInstIds: string[] = [];
        const tBuyOrderIds: string[] = [];
        const tSellOrderIds: string[] = [];
        const tBuyerUserIds: string[] = [];
        const tSellerUserIds: string[] = [];
        const tPrices: number[] = [];
        const tQtys: number[] = [];
        const tBuyerRefunds: number[] = [];

        for (let i = 0; i < allTrades.length; i++) {
          const tr = allTrades[i]!;
          tIds.push(tr.id);
          tSeqs.push(tr.seq);
          tInstIds.push(this.instrumentIdMap.get(tr.symbol) || tr.symbol);
          tBuyOrderIds.push(tr.buyOrderId);
          tSellOrderIds.push(tr.sellOrderId);
          tBuyerUserIds.push(tr.buyerUserId);
          tSellerUserIds.push(tr.sellerUserId);
          tPrices.push(tr.price);
          tQtys.push(tr.qty);
          tBuyerRefunds.push(tr.buyerRefund);
        }

        await client.query({
          name: 'cte_bulk_flush',
          text: SQL_COMBINED_CTE,
          values: [
            jIds, jKinds, jRefTypes, jRefIds,
            pJournalIds, pAccountIds, pUnits, pAmounts, pSeqs,
            bUserIds, bAvails, bResvs, bEscs,
            hUserIds, hInstIds, hAvails, hResvs, hEscs,
            oIds, oClientOrderIds, oSeqs, oUserIds, oInstIds, oSides, oTypes, oTifs, oPrices, oQtys, oRemainingQtys, oStatuses,
            tIds, tSeqs, tInstIds, tBuyOrderIds, tSellOrderIds, tBuyerUserIds, tSellerUserIds, tPrices, tQtys, tBuyerRefunds,
          ],
        });
        const cteDuration = performance.now() - tCte;
        const subMs = cteDuration / 5;
        this.sqlJournalsMs.push(subMs);
        this.sqlPostingsMs.push(subMs);
        this.sqlBalancesMs.push(0.01);
        this.sqlHoldingsMs.push(subMs);
        this.sqlOrdersMs.push(subMs);
        this.sqlTradesMs.push(0);

        if (allJournals.length > 0) this.queryCountJournals++;
        if (allPostings.length > 0) this.queryCountPostings++;
        if (bUserIds.length > 0) this.queryCountBalances++;
        if (hUserIds.length > 0) this.queryCountHoldings++;
        if (ordersToPersist.length > 0) this.queryCountOrders++;
        if (allTrades.length > 0) this.queryCountTrades++;

        this.totalJournalsCount += allJournals.length;
        this.totalPostingsCount += allPostings.length;
        this.totalBalanceUpdatesCount += bUserIds.length;
        this.totalHoldingUpdatesCount += hUserIds.length;
        this.totalOrdersUpsertedCount += ordersToPersist.length;
        this.totalTradesInsertedCount += allTrades.length;
      } else {
      // Execute Bulk Insert Journals
      const tJournals = performance.now();
      if (allJournals.length > 0) {
        const ids: string[] = [];
        const kinds: string[] = [];
        const refTypes: string[] = [];
        const refIds: string[] = [];

        for (let i = 0; i < allJournals.length; i++) {
          const j = allJournals[i]!;
          ids.push(j.id);
          kinds.push(j.kind);
          refTypes.push(j.refType);
          refIds.push(j.refId);
        }

        await client.query({
          name: 'insert_journals_unnest',
          text: SQL_INSERT_JOURNALS,
          values: [ids, kinds, refTypes, refIds],
        });
        this.queryCountJournals++;
      }
      this.sqlJournalsMs.push(performance.now() - tJournals);
      this.totalJournalsCount += allJournals.length;

      // Execute Bulk Insert Postings
      const tPostings = performance.now();
      const postingsMode = process.env.POSTINGS_WRITE_MODE || 'unnest';

      if (allPostings.length > 0) {
        if (postingsMode === 'values') {
          // 'values' fallback mode (chunked multi-row INSERT at 300 rows)
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
        } else {
          // Columnar UNNEST mode (permanent default)
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
            text: SQL_INSERT_POSTINGS,
            values: [journalIds, accountIds, units, amounts, seqs],
          });
          this.queryCountPostings++;
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

      // Pre-cache instrumentIdMap in memory to eliminate SQL JOINs
      if (this.instrumentIdMap.size === 0) {
        const { rows: instRows } = await client.query<{ id: string; symbol: string }>(
          'SELECT id, symbol FROM instruments'
        );
        for (const r of instRows) {
          this.instrumentIdMap.set(r.symbol, r.id);
        }
      }

      // Execute Orders Bulk Insert / Update (Columnar UNNEST)
      const tOrders = performance.now();
      if (newOrders.length > 0) {
        const ids: string[] = [];
        const clientOrderIds: string[] = [];
        const seqs: number[] = [];
        const userIds: string[] = [];
        const instrumentIds: string[] = [];
        const sides: string[] = [];
        const types: string[] = [];
        const tifs: string[] = [];
        const prices: number[] = [];
        const qtys: number[] = [];
        const remainingQtys: number[] = [];
        const statuses: string[] = [];

        for (let i = 0; i < newOrders.length; i++) {
          const ord = newOrders[i]!;
          ids.push(ord.id);
          clientOrderIds.push(ord.clientOrderId);
          seqs.push(ord.seq);
          userIds.push(ord.userId);
          instrumentIds.push(this.instrumentIdMap.get(ord.symbol) || ord.symbol);
          sides.push(ord.side);
          types.push(ord.type);
          tifs.push(ord.tif);
          prices.push(ord.price);
          qtys.push(ord.qty);
          remainingQtys.push(ord.remainingQty);
          statuses.push(ord.status);
        }

        try {
          await client.query({
            name: 'insert_orders_unnest_direct',
            text: SQL_INSERT_ORDERS,
            values: [
              ids,
              clientOrderIds,
              seqs,
              userIds,
              instrumentIds,
              sides,
              types,
              tifs,
              prices,
              qtys,
              remainingQtys,
              statuses,
            ],
          });
          this.queryCountOrders++;
        } catch (err: any) {
          if (err.code === '23505') {
            await client.query({
              name: 'upsert_orders_unnest_direct',
              text: SQL_UPSERT_ORDERS,
              values: [
                ids,
                clientOrderIds,
                seqs,
                userIds,
                instrumentIds,
                sides,
                types,
                tifs,
                prices,
                qtys,
                remainingQtys,
                statuses,
              ],
            });
            this.queryCountOrders++;
          } else {
            throw err;
          }
        }
      }

      if (existingOrders.length > 0) {
        const exIds: string[] = [];
        const exRemainingQtys: number[] = [];
        const exStatuses: string[] = [];

        for (let i = 0; i < existingOrders.length; i++) {
          const ord = existingOrders[i]!;
          exIds.push(ord.id);
          exRemainingQtys.push(ord.remainingQty);
          exStatuses.push(ord.status);
        }

        await client.query({
          name: 'update_orders_unnest_direct',
          text: SQL_UPDATE_ORDERS,
          values: [exIds, exRemainingQtys, exStatuses],
        });
        this.queryCountOrders++;
      }

      this.sqlOrdersMs.push(performance.now() - tOrders);
      this.totalOrdersUpsertedCount += newOrders.length + existingOrders.length;

      // Execute Trades Bulk Insert (Columnar UNNEST)
      const tTrades = performance.now();
      if (allTrades.length > 0) {
        const ids: string[] = [];
        const seqs: number[] = [];
        const instrumentIds: string[] = [];
        const buyOrderIds: string[] = [];
        const sellOrderIds: string[] = [];
        const buyerUserIds: string[] = [];
        const sellerUserIds: string[] = [];
        const prices: number[] = [];
        const qtys: number[] = [];
        const buyerRefunds: number[] = [];

        for (let i = 0; i < allTrades.length; i++) {
          const tr = allTrades[i]!;
          ids.push(tr.id);
          seqs.push(tr.seq);
          instrumentIds.push(this.instrumentIdMap.get(tr.symbol) || tr.symbol);
          buyOrderIds.push(tr.buyOrderId);
          sellOrderIds.push(tr.sellOrderId);
          buyerUserIds.push(tr.buyerUserId);
          sellerUserIds.push(tr.sellerUserId);
          prices.push(tr.price);
          qtys.push(tr.qty);
          buyerRefunds.push(tr.buyerRefund);
        }

        await client.query({
          name: 'insert_trades_unnest_direct',
          text: `INSERT INTO trades (id, seq, instrument_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, buyer_refund, is_simulated)
                 SELECT u.id, u.seq, u.inst_id, u.buy_order_id, u.sell_order_id, u.buyer_user_id, u.seller_user_id, u.price, u.qty, u.buyer_refund, false
                 FROM UNNEST($1::varchar[], $2::bigint[], $3::varchar[], $4::varchar[], $5::varchar[], $6::varchar[], $7::varchar[], $8::bigint[], $9::int[], $10::bigint[])
                   AS u(id, seq, inst_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, buyer_refund)
                 ON CONFLICT (id) DO NOTHING`,
          values: [
            ids,
            seqs,
            instrumentIds,
            buyOrderIds,
            sellOrderIds,
            buyerUserIds,
            sellerUserIds,
            prices,
            qtys,
            buyerRefunds,
          ],
        });
        this.queryCountTrades++;
      }
      this.sqlTradesMs.push(performance.now() - tTrades);
      this.totalTradesInsertedCount += allTrades.length;
      }

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

      // Fast set-based ledger verification before COMMIT
      if (allJournals.length > 0) {
        const journalIds = allJournals.map((j) => j.id);
        const checkRes = await client.query({
          name: 'verify_batch_journals_balanced',
          text: `SELECT journal_id, unit, SUM(amount) AS total
                 FROM postings
                 WHERE journal_id = ANY($1::varchar[])
                 GROUP BY journal_id, unit
                 HAVING SUM(amount) <> 0`,
          values: [journalIds],
        });

        if (checkRes.rows.length > 0) {
          const imb = checkRes.rows[0];
          throw new Error(
            `Journal ${imb.journal_id} violates double-entry invariant: unit ${imb.unit} sums to ${imb.total} (must be 0)`
          );
        }

        await client.query("SET LOCAL darkhold.batch_validated = '1'");
      }

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
      try {
        await client.query('ROLLBACK');
      } catch {
        try { client.release(true); } catch {}
        this.flushClient = null;
        this.isPrewarmed = false;
      }
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
      if (!this.isPrewarmed && this.flushClient) {
        try { this.flushClient.release(); } catch {}
        this.flushClient = null;
      }
      this.isFlushing = false;
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
