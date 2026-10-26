/**
 * @file recovery.ts
 * Boot hydration and restart recovery.
 * Hydrates in-memory order books, balances, holdings, auctions, and escrows from PostgreSQL.
 */

import pg from 'pg';
import { ExchangeCore, CoreAuction, CoreEscrow } from './core.js';
import { InstrumentConfig, EngineOrderCommand } from '@darkhold/engine';
import { PersistenceEngine } from './persistence.js';
import { Clock } from './clock.js';
import { runReconciliation } from './reconciliation.js';
import { acquireWriterLock } from './db.js';

export async function bootstrapCore(
  pool: pg.Pool,
  clock: Clock,
  batchMax: number = 500,
  batchMs: number = 5,
  forceStart: boolean = false
): Promise<ExchangeCore> {
  // 1. Acquire exclusive PostgreSQL single-writer advisory lock
  const locked = await acquireWriterLock(pool);
  if (!locked) {
    throw new Error(
      '[SINGLE_WRITER_VIOLATION] Could not acquire exclusive PostgreSQL advisory lock. Another exchange instance is running!'
    );
  }

  const client = await pool.connect();
  let core: ExchangeCore;

  try {
    // 2. Load Instruments
    const { rows: instRows } = await client.query<{
      id: string;
      symbol: string;
      name: string;
      face_value: string;
      collar_bps: number;
      tick_size: string;
      min_qty: number;
      max_qty_per_order: number;
      escrow_required: boolean;
      is_benchmark: boolean;
    }>('SELECT * FROM instruments WHERE active = TRUE');

    const instruments: InstrumentConfig[] = instRows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      faceValue: Number(r.face_value),
      collarBps: r.collar_bps,
      tickSize: Number(r.tick_size),
      minQty: r.min_qty,
      maxQtyPerOrder: r.max_qty_per_order,
      escrowRequired: r.escrow_required,
      isBenchmark: r.is_benchmark,
    }));

    const persistence = new PersistenceEngine(pool, batchMax, batchMs);
    await persistence.prewarm();
    core = new ExchangeCore(instruments, persistence, clock);

    // Wire rebuild callback for group-commit rollback path
    persistence.setRebuildCallback(async () => {
      console.warn('[RECOVERY] Rebuilding in-memory ExchangeCore state from database...');
      await hydrateFromDb(core, client);
    });

    // Self-healing: Repair any unbalanced orphan journals or drifted cache tables before hydrating
    await selfHealLedger(client);

    // 3. Hydrate state
    await hydrateFromDb(core, client);

    // 4. Run full reconciliation at boot
    const report = await runReconciliation(pool, core);
    if (!report.balanced && !forceStart) {
      throw new Error(
        `[BOOT_RECONCILIATION_FAILED] Startup halted due to ${report.anomaliesCount} ledger anomalies: ${report.anomalies.join('; ')}`
      );
    }

    console.log(`[BOOT] Recovery complete. In-memory state hydrated. Seq = ${core.seq}`);
    return core;
  } finally {
    client.release();
  }
}

export async function selfHealLedger(client: pg.PoolClient): Promise<void> {
  // 1. Detect and purge any unbalanced orphaned journals (e.g. from an unclean crash)
  const { rows: unbalancedJournals } = await client.query<{ journal_id: string }>(`
    SELECT journal_id
    FROM postings
    GROUP BY journal_id, unit
    HAVING SUM(amount) <> 0
  `);

  if (unbalancedJournals.length > 0) {
    console.warn(`[RECOVERY_SELF_HEAL] Detected ${unbalancedJournals.length} unbalanced journals. Purging orphaned postings...`);
    for (const uj of unbalancedJournals) {
      await client.query('DELETE FROM postings WHERE journal_id = $1', [uj.journal_id]);
      await client.query('DELETE FROM journals WHERE id = $1', [uj.journal_id]);
    }
  }

  // 2. Re-materialize balances from SUM(postings) for all users
  const { rows: cashPostings } = await client.query<{
    user_id: string;
    kind: string;
    total: string;
  }>(`
    SELECT la.owner_user_id AS user_id, la.kind, COALESCE(SUM(p.amount), 0) AS total
    FROM ledger_accounts la
    LEFT JOIN postings p ON la.id = p.account_id AND p.unit = 'CASH'
    WHERE la.owner_user_id IS NOT NULL AND la.instrument_id IS NULL
    GROUP BY la.owner_user_id, la.kind
  `);

  const userCashMap = new Map<string, { available: number; reserved: number; escrow: number }>();
  for (const r of cashPostings) {
    let b = userCashMap.get(r.user_id);
    if (!b) {
      b = { available: 0, reserved: 0, escrow: 0 };
      userCashMap.set(r.user_id, b);
    }
    const amt = Number(r.total);
    if (r.kind === 'USER_AVAILABLE') b.available = amt;
    else if (r.kind === 'USER_RESERVED') b.reserved = amt;
    else if (r.kind === 'ESCROW') b.escrow = amt;
  }

  for (const [userId, bal] of userCashMap.entries()) {
    await client.query(`
      INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        available = EXCLUDED.available,
        reserved = EXCLUDED.reserved,
        escrow = EXCLUDED.escrow,
        updated_at = NOW()
    `, [userId, bal.available, bal.reserved, bal.escrow]);
  }

  // 3. Re-materialize holdings from SUM(postings) for all user instrument holdings
  const { rows: holdingPostings } = await client.query<{
    user_id: string;
    instrument_id: string;
    kind: string;
    total: string;
  }>(`
    SELECT la.owner_user_id AS user_id, la.instrument_id, la.kind, COALESCE(SUM(p.amount), 0) AS total
    FROM ledger_accounts la
    LEFT JOIN instruments i ON la.instrument_id = i.id
    LEFT JOIN postings p ON la.id = p.account_id AND p.unit = i.symbol
    WHERE la.owner_user_id IS NOT NULL AND la.instrument_id IS NOT NULL
    GROUP BY la.owner_user_id, la.instrument_id, la.kind
  `);

  const userHoldingMap = new Map<string, { available: number; reserved: number; escrow: number }>();
  for (const r of holdingPostings) {
    const key = `${r.user_id}:${r.instrument_id}`;
    let h = userHoldingMap.get(key);
    if (!h) {
      h = { available: 0, reserved: 0, escrow: 0 };
      userHoldingMap.set(key, h);
    }
    const amt = Number(r.total);
    if (r.kind === 'USER_AVAILABLE') h.available = amt;
    else if (r.kind === 'USER_RESERVED') h.reserved = amt;
    else if (r.kind === 'ESCROW') h.escrow = amt;
  }

  for (const [key, hold] of userHoldingMap.entries()) {
    const [userId, instId] = key.split(':');
    await client.query(`
      INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, instrument_id) DO UPDATE SET
        available = EXCLUDED.available,
        reserved = EXCLUDED.reserved,
        escrow = EXCLUDED.escrow,
        updated_at = NOW()
    `, [userId, instId, hold.available, hold.reserved, hold.escrow]);
  }
}

export async function hydrateFromDb(core: ExchangeCore, client: pg.PoolClient): Promise<void> {
  // Clear existing RAM state
  core.balances.clear();
  core.holdings.clear();
  core.auctions.clear();
  core.escrows.clear();
  core.persistence.persistedOrderIds.clear();

  // Load Max Seq
  const { rows: seqRows } = await client.query<{ max_seq: string }>(`
    SELECT GREATEST(
      COALESCE((SELECT MAX(seq) FROM orders), 0),
      COALESCE((SELECT MAX(seq) FROM postings), 0),
      COALESCE((SELECT MAX(seq) FROM trades), 0)
    ) AS max_seq
  `);
  core.seq = Number(seqRows[0]?.max_seq || 0);

  // Load Balances
  const { rows: balRows } = await client.query<{
    user_id: string;
    available: string;
    reserved: string;
    escrow: string;
  }>('SELECT user_id, available, reserved, escrow FROM balances');

  for (const b of balRows) {
    core.balances.set(b.user_id, {
      available: Number(b.available),
      reserved: Number(b.reserved),
      escrow: Number(b.escrow),
    });
  }

  // Load Holdings
  const { rows: holdRows } = await client.query<{
    user_id: string;
    symbol: string;
    available: string;
    reserved: string;
    escrow: string;
  }>(`
    SELECT h.user_id, i.symbol, h.available, h.reserved, h.escrow
    FROM holdings h
    JOIN instruments i ON h.instrument_id = i.id
  `);

  for (const h of holdRows) {
    core.holdings.set(`${h.user_id}:${h.symbol}`, {
      available: Number(h.available),
      reserved: Number(h.reserved),
      escrow: Number(h.escrow),
    });
  }

  // Rebuild Books from active orders in seq order
  const { rows: orderRows } = await client.query<{
    id: string;
    client_order_id: string;
    seq: string;
    user_id: string;
    symbol: string;
    side: string;
    type: string;
    tif: string;
    price: string;
    remaining_qty: number;
    status: string;
  }>(`
    SELECT o.id, o.client_order_id, o.seq, o.user_id, i.symbol, o.side, o.type, o.tif, o.price, o.remaining_qty, o.status
    FROM orders o
    JOIN instruments i ON o.instrument_id = i.id
    WHERE o.status IN ('OPEN', 'PARTIALLY_FILLED')
    ORDER BY o.seq ASC
  `);

  for (const o of orderRows) {
    core.persistence.persistedOrderIds.add(o.id);
    const cmd: EngineOrderCommand = {
      id: o.id,
      clientOrderId: o.client_order_id,
      seq: Number(o.seq),
      userId: o.user_id,
      symbol: o.symbol,
      side: o.side as any,
      type: o.type as any,
      tif: 'GTC', // Active resting orders are treated as GTC
      price: Number(o.price),
      qty: o.remaining_qty,
    };
    core.engine.submitOrder(cmd);
  }

  // Load Active Auctions
  const { rows: aucRows } = await client.query<{
    id: string;
    symbol: string;
    seller_user_id: string;
    qty_total: number;
    qty_remaining: number;
    start_price: string;
    floor_price: string;
    step_amount: string;
    step_interval_ms: number;
    starts_at: Date;
    ends_at: Date;
    status: string;
    clearing_price?: string | null;
    ended_at?: Date | null;
  }>(`
    SELECT a.id, i.symbol, a.seller_user_id, a.qty_total, a.qty_remaining, a.start_price, a.floor_price, a.step_amount, a.step_interval_ms, a.starts_at, a.ends_at, a.status, a.clearing_price, a.ended_at
    FROM auctions a
    JOIN instruments i ON a.instrument_id = i.id
    WHERE a.status IN ('ACTIVE', 'SOLD_OUT', 'CANCELLED')
    ORDER BY a.starts_at DESC
    LIMIT 100
  `);

  for (const a of aucRows) {
    const auc: CoreAuction = {
      id: a.id,
      symbol: a.symbol,
      sellerUserId: a.seller_user_id,
      qtyTotal: a.qty_total,
      qtyRemaining: a.qty_remaining,
      startPrice: Number(a.start_price),
      floorPrice: Number(a.floor_price),
      stepAmount: Number(a.step_amount),
      stepIntervalMs: a.step_interval_ms,
      startsAt: a.starts_at.getTime(),
      endsAt: a.ends_at.getTime(),
      status: a.status as any,
      clearingPrice: a.clearing_price != null ? Number(a.clearing_price) : undefined,
      endedAt: a.ended_at ? a.ended_at.getTime() : undefined,
    };
    core.auctions.set(a.id, auc);
  }

  // Load Locked Escrows
  const { rows: escRows } = await client.query<{
    id: string;
    trade_id: string;
    symbol: string;
    buyer_user_id: string;
    seller_user_id: string;
    qty: number;
    amount: string;
    status: string;
    expires_at: Date;
  }>(`
    SELECT e.id, e.trade_id, i.symbol, e.buyer_user_id, e.seller_user_id, e.qty, e.amount, e.status, e.expires_at
    FROM escrows e
    JOIN instruments i ON e.instrument_id = i.id
    WHERE e.status = 'LOCKED'
  `);

  for (const e of escRows) {
    const esc: CoreEscrow = {
      id: e.id,
      tradeId: e.trade_id,
      symbol: e.symbol,
      buyerUserId: e.buyer_user_id,
      sellerUserId: e.seller_user_id,
      qty: e.qty,
      amount: Number(e.amount),
      status: e.status as any,
      expiresAt: e.expires_at.getTime(),
    };
    core.escrows.set(e.id, esc);
  }
}