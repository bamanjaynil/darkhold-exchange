/**
 * @file reset.ts
 * Clean demo state reset handler.
 * Re-seeds demo accounts with realistic balances, clean inventory, fresh long-duration auctions, and resting orders.
 */

import pg from 'pg';
import { ExchangeCore } from './core.js';
import { hydrateFromDb } from './recovery.js';

export async function performDemoReset(core: ExchangeCore, pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Truncate operational tables (removes benchmark junk and old orders)
    await client.query('TRUNCATE orders, trades, escrows, auctions CASCADE');

    // 2. Clean balances: 50,000.00 DKC (5,000,000 minor units) for demo personas
    const demoUserIds = ['usr_admin', 'usr_alice', 'usr_bob', 'usr_carol'];
    await client.query(
      `UPDATE balances
       SET available = 5000000, reserved = 0, escrow = 0, updated_at = NOW()
       WHERE user_id = ANY($1::varchar[])`,
      [demoUserIds]
    );

    // 3. Clean starting inventories
    const inventories: Record<string, Record<string, number>> = {
      usr_admin: { 'FEST-GA': 50, 'FEST-VIP': 20, 'MERCH-CLOAK': 30, 'RELIC-AGAMOTTO': 2 },
      usr_alice: { 'FEST-GA': 25, 'FEST-VIP': 10, 'MERCH-CLOAK': 15, 'RELIC-AGAMOTTO': 1 },
      usr_bob:   { 'FEST-GA': 20, 'FEST-VIP': 8,  'MERCH-CLOAK': 12, 'RELIC-AGAMOTTO': 1 },
      usr_carol: { 'FEST-GA': 15, 'FEST-VIP': 5,  'MERCH-CLOAK': 10, 'RELIC-AGAMOTTO': 0 },
    };

    const { rows: instruments } = await client.query<{ id: string; symbol: string }>(
      'SELECT id, symbol FROM instruments WHERE active = TRUE'
    );

    for (const [userId, items] of Object.entries(inventories)) {
      for (const inst of instruments) {
        const qty = items[inst.symbol] || 0;
        await client.query(
          `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow, updated_at)
           VALUES ($1, $2, $3, 0, 0, NOW())
           ON CONFLICT (user_id, instrument_id) DO UPDATE SET
             available = EXCLUDED.available,
             reserved = 0,
             escrow = 0,
             updated_at = NOW()`,
          [userId, inst.id, qty]
        );
      }
    }

    // 4. Seed 2 fresh, long-duration (3600 seconds) active Dutch Auctions
    const instFestGa = instruments.find((i) => i.symbol === 'FEST-GA');
    const instMerch = instruments.find((i) => i.symbol === 'MERCH-CLOAK');

    if (instFestGa && instMerch) {
      // Auction 1: FEST-GA by Bob (5 units, 1,650 -> 1,000 DKC, 1 hour)
      await client.query(
        `INSERT INTO auctions (
          id, instrument_id, seller_user_id, qty_total, qty_remaining,
          start_price, floor_price, step_amount, step_interval_ms,
          starts_at, ends_at, status
        ) VALUES (
          $1, $2, 'usr_bob', 5, 5,
          165000, 100000, 18, 1000,
          NOW(), NOW() + INTERVAL '3600 seconds', 'ACTIVE'
        )`,
        [`auc_demo_fest_ga_${Date.now()}`, instFestGa.id]
      );
      // Reserve Bob's 5 FEST-GA
      await client.query(
        `UPDATE holdings SET available = available - 5, reserved = reserved + 5
         WHERE user_id = 'usr_bob' AND instrument_id = $1`,
        [instFestGa.id]
      );

      // Auction 2: MERCH-CLOAK by Alice (3 units, 880 -> 500 DKC, 1 hour)
      await client.query(
        `INSERT INTO auctions (
          id, instrument_id, seller_user_id, qty_total, qty_remaining,
          start_price, floor_price, step_amount, step_interval_ms,
          starts_at, ends_at, status
        ) VALUES (
          $1, $2, 'usr_alice', 3, 3,
          88000, 50000, 10, 1000,
          NOW(), NOW() + INTERVAL '3600 seconds', 'ACTIVE'
        )`,
        [`auc_demo_merch_${Date.now()}`, instMerch.id]
      );
      // Reserve Alice's 3 MERCH-CLOAK
      await client.query(
        `UPDATE holdings SET available = available - 3, reserved = reserved + 3
         WHERE user_id = 'usr_alice' AND instrument_id = $1`,
        [instMerch.id]
      );
    }

    // 5. Seed clean resting orders
    if (instFestGa) {
      // 3 Bids on FEST-GA @ 1,500.00 DKC (150,000 minor)
      const bidUsers = ['usr_alice', 'usr_bob', 'usr_carol'];
      for (let i = 0; i < bidUsers.length; i++) {
        const uId = bidUsers[i]!;
        await client.query(
          `INSERT INTO orders (
            id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status
          ) VALUES (
            $1, $2, $3, $4, $5, 'BUY', 'LIMIT', 'GTC', 150000, 1, 1, 'OPEN'
          )`,
          [`ord_demo_bid_${i + 1}`, `demo_bid_${i + 1}`, i + 1, uId, instFestGa.id]
        );
        await client.query(
          `UPDATE balances SET available = available - 150000, reserved = reserved + 150000 WHERE user_id = $1`,
          [uId]
        );
      }

      // 3 Asks on FEST-GA @ 1,502.00 DKC (150,200 minor) from Admin
      for (let i = 0; i < 3; i++) {
        await client.query(
          `INSERT INTO orders (
            id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status
          ) VALUES (
            $1, $2, $3, 'usr_admin', $4, 'SELL', 'LIMIT', 'GTC', 150200, 1, 1, 'OPEN'
          )`,
          [`ord_demo_ask_${i + 1}`, `demo_ask_${i + 1}`, i + 4, instFestGa.id]
        );
      }
      await client.query(
        `UPDATE holdings SET available = available - 3, reserved = reserved + 3
         WHERE user_id = 'usr_admin' AND instrument_id = $1`,
        [instFestGa.id]
      );

      // Seed 2 initial trades on FEST-GA so the recent trades tape is populated
      await client.query(
        `INSERT INTO trades (
          id, seq, instrument_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, price, qty, is_simulated, created_at
        ) VALUES
          ($1, 1, $2, 'ord_demo_bid_1', 'ord_demo_ask_1', 'usr_alice', 'usr_admin', 150000, 1, false, NOW() - INTERVAL '3 minutes'),
          ($3, 2, $2, 'ord_demo_bid_2', 'ord_demo_ask_2', 'usr_bob', 'usr_alice', 150100, 2, false, NOW() - INTERVAL '1 minute')`,
        [`tr_demo_1_${Date.now()}`, instFestGa.id, `tr_demo_2_${Date.now()}`]
      );
    }

    await client.query('COMMIT');

    // 6. Rebuild Matching Engine & In-Memory ExchangeCore RAM state
    for (const inst of core.instruments.values()) {
      core.engine.registerInstrument(inst);
    }
    await hydrateFromDb(core, client);

    // 7. Clear RAM snapshots and trade caches
    core.cachedL2Snapshots.clear();
    core.cachedTrades.clear();

    console.log('[RESET] Demo state successfully reset to pristine baseline.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[RESET] Failed to reset demo state:', err);
    throw err;
  } finally {
    client.release();
  }
}
