/**
 * @file reset.ts
 * Clean demo state reset handler.
 * Re-seeds demo accounts with realistic balances, clean inventory, fresh long-duration auctions, and resting orders
 * with strictly balanced double-entry ledger postings.
 */

import pg from 'pg';
import { ExchangeCore } from './core.js';
import { hydrateFromDb } from './recovery.js';
import { SolvencyCoordinator } from './solvency.js';

export async function performDemoReset(
  core: ExchangeCore,
  pool: pg.Pool,
  solvency?: SolvencyCoordinator
): Promise<void> {
  // 0. Drain pending persistence batches
  await core.persistence.flush();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Truncate all mutable tables
    await client.query(
      'TRUNCATE orders, trades, escrows, auctions, journals, postings, balances, holdings, solvency_snapshots CASCADE'
    );

    let seedSeq = 1;

    // 2. Resolve instruments
    const { rows: instruments } = await client.query<{ id: string; symbol: string }>(
      'SELECT id, symbol FROM instruments WHERE active = TRUE'
    );

    // 3. Ensure system ISSUER accounts exist
    await client.query(`
      INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
      VALUES ('acc_issuer_cash', 'ISSUER', NULL, NULL)
      ON CONFLICT (id) DO NOTHING
    `);

    for (const inst of instruments) {
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'ISSUER', NULL, $2)
         ON CONFLICT (id) DO NOTHING`,
        [`acc_issuer_${inst.symbol}`, inst.id]
      );
    }

    const allUserIds = ['usr_admin', 'usr_alice', 'usr_bob', 'usr_carol', 'usr_bench_bot', 'usr_bench_maker', 'usr_bench_taker'];

    // 4. Ensure demo & benchmark user ledger accounts exist
    for (const uId of allUserIds) {
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES 
           ($1, 'USER_AVAILABLE', $2, NULL),
           ($3, 'USER_RESERVED', $2, NULL),
           ($4, 'ESCROW', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [`acc_${uId}_cash_avail`, uId, `acc_${uId}_cash_res`, `acc_${uId}_cash_esc`]
      );

      for (const inst of instruments) {
        await client.query(
          `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
           VALUES 
             ($1, 'USER_AVAILABLE', $2, $3),
             ($4, 'USER_RESERVED', $2, $3),
             ($5, 'ESCROW', $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [
            `acc_${uId}_${inst.symbol}_avail`,
            uId,
            inst.id,
            `acc_${uId}_${inst.symbol}_res`,
            `acc_${uId}_${inst.symbol}_esc`,
          ]
        );
      }
    }

    // 5. Clean balanced cash grants (50k DKC for demo traders; 10M DKC for admin & benchmark bots)
    const userCashGrants: Record<string, number> = {
      usr_admin: 1000000000,
      usr_alice: 5000000,
      usr_bob: 5000000,
      usr_carol: 5000000,
      usr_bench_bot: 1000000000,
      usr_bench_maker: 1000000000,
      usr_bench_taker: 1000000000,
    };

    let totalCashMinor = 0;
    for (const uId of allUserIds) {
      totalCashMinor += userCashGrants[uId] || 0;
    }
    const cashJournalId = 'j_demo_grant_cash';

    await client.query(
      `INSERT INTO journals (id, kind, ref_type, ref_id)
       VALUES ($1, 'GRANT', 'INITIAL_GRANT', 'SYSTEM')`,
      [cashJournalId]
    );

    // Credit each user account
    for (const uId of allUserIds) {
      const grantAmt = userCashGrants[uId] || 0;
      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES ($1, $2, 'CASH', $3, $4)`,
        [cashJournalId, `acc_${uId}_cash_avail`, grantAmt, seedSeq++]
      );
      await client.query(
        `INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
         VALUES ($1, $2, 0, 0, NOW())`,
        [uId, grantAmt]
      );
    }

    // Debit issuer account (exact negative sum)
    await client.query(
      `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
       VALUES ($1, 'acc_issuer_cash', 'CASH', $2, $3)`,
      [cashJournalId, -totalCashMinor, seedSeq++]
    );

    // 6. Starting inventories
    const inventories: Record<string, Record<string, number>> = {
      usr_admin: { 'FEST-GA': 50, 'FEST-VIP': 20, 'MERCH-CLOAK': 30, 'RELIC-AGAMOTTO': 2, 'BENCH-X': 100000 },
      usr_alice: { 'FEST-GA': 25, 'FEST-VIP': 10, 'MERCH-CLOAK': 15, 'RELIC-AGAMOTTO': 1 },
      usr_bob:   { 'FEST-GA': 20, 'FEST-VIP': 8,  'MERCH-CLOAK': 12, 'RELIC-AGAMOTTO': 1 },
      usr_carol: { 'FEST-GA': 15, 'FEST-VIP': 5,  'MERCH-CLOAK': 10, 'RELIC-AGAMOTTO': 0 },
      usr_bench_bot: { 'BENCH-X': 100000 },
      usr_bench_maker: { 'BENCH-X': 100000 },
      usr_bench_taker: { 'BENCH-X': 100000 },
    };

    for (const inst of instruments) {
      let totalQty = 0;
      for (const uId of allUserIds) {
        totalQty += inventories[uId]?.[inst.symbol] || 0;
      }
      if (totalQty > 0) {
        const invJId = `j_demo_grant_${inst.symbol}`;
        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id)
           VALUES ($1, 'GRANT', 'INITIAL_INV_GRANT', $2)`,
          [invJId, inst.symbol]
        );

        for (const uId of allUserIds) {
          const qty = inventories[uId]?.[inst.symbol] || 0;
          if (qty > 0) {
            await client.query(
              `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
               VALUES ($1, $2, $3, $4, $5)`,
              [invJId, `acc_${uId}_${inst.symbol}_avail`, inst.symbol, qty, seedSeq++]
            );
          }
          await client.query(
            `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow, updated_at)
             VALUES ($1, $2, $3, 0, 0, NOW())`,
            [uId, inst.id, qty]
          );
        }

        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES ($1, $2, $3, $4, $5)`,
          [invJId, `acc_issuer_${inst.symbol}`, inst.symbol, -totalQty, seedSeq++]
        );
      }
    }

    // 7. Seed 2 active Dutch Auctions
    const instFestGa = instruments.find((i) => i.symbol === 'FEST-GA');
    const instMerch = instruments.find((i) => i.symbol === 'MERCH-CLOAK');

    if (instFestGa && instMerch) {
      // Auction 1: FEST-GA by Bob (5 units)
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
      await client.query(
        `UPDATE holdings SET available = available - 5, reserved = reserved + 5
         WHERE user_id = 'usr_bob' AND instrument_id = $1`,
        [instFestGa.id]
      );
      const jBobAuc = `j_demo_auc_fest_ga_${Date.now()}`;
      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id) VALUES ($1, 'RESERVE', 'AUCTION', 'usr_bob')`,
        [jBobAuc]
      );
      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES 
           ($1, 'acc_usr_bob_FEST-GA_avail', 'FEST-GA', -5, $2),
           ($1, 'acc_usr_bob_FEST-GA_res', 'FEST-GA', 5, $3)`,
        [jBobAuc, seedSeq++, seedSeq++]
      );

      // Auction 2: MERCH-CLOAK by Alice (3 units)
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
      await client.query(
        `UPDATE holdings SET available = available - 3, reserved = reserved + 3
         WHERE user_id = 'usr_alice' AND instrument_id = $1`,
        [instMerch.id]
      );
      const jAliceAuc = `j_demo_auc_merch_${Date.now()}`;
      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id) VALUES ($1, 'RESERVE', 'AUCTION', 'usr_alice')`,
        [jAliceAuc]
      );
      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES 
           ($1, 'acc_usr_alice_MERCH-CLOAK_avail', 'MERCH-CLOAK', -3, $2),
           ($1, 'acc_usr_alice_MERCH-CLOAK_res', 'MERCH-CLOAK', 3, $3)`,
        [jAliceAuc, seedSeq++, seedSeq++]
      );
    }

    // 8. Seed clean resting orders
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
          [`ord_demo_bid_${i + 1}`, `demo_bid_${i + 1}`, seedSeq++, uId, instFestGa.id]
        );
        await client.query(
          `UPDATE balances SET available = available - 150000, reserved = reserved + 150000 WHERE user_id = $1`,
          [uId]
        );
        const jBid = `j_demo_order_bid_${uId}_${i + 1}`;
        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id) VALUES ($1, 'RESERVE', 'ORDER', $2)`,
          [jBid, uId]
        );
        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES 
             ($1, $2, 'CASH', -150000, $3),
             ($1, $4, 'CASH', 150000, $5)`,
          [jBid, `acc_${uId}_cash_avail`, seedSeq++, `acc_${uId}_cash_res`, seedSeq++]
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
          [`ord_demo_ask_${i + 1}`, `demo_ask_${i + 1}`, seedSeq++, instFestGa.id]
        );
      }
      await client.query(
        `UPDATE holdings SET available = available - 3, reserved = reserved + 3
         WHERE user_id = 'usr_admin' AND instrument_id = $1`,
        [instFestGa.id]
      );
      const jAdminAsk = `j_demo_order_ask_admin_${Date.now()}`;
      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id) VALUES ($1, 'RESERVE', 'ORDER', 'usr_admin')`,
        [jAdminAsk]
      );
      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES 
           ($1, 'acc_usr_admin_FEST-GA_avail', 'FEST-GA', -3, $2),
           ($1, 'acc_usr_admin_FEST-GA_res', 'FEST-GA', 3, $3)`,
        [jAdminAsk, seedSeq++, seedSeq++]
      );

      // Seed 2 initial trades on FEST-GA
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

    // 9. Rebuild Matching Engine & In-Memory ExchangeCore RAM state
    for (const inst of core.instruments.values()) {
      core.engine.registerInstrument(inst);
    }
    await hydrateFromDb(core, client);

    core.cachedL2Snapshots.clear();
    core.cachedTrades.clear();

    // 10. Generate pristine Solvency Snapshot immediately
    if (solvency) {
      await solvency.createSnapshot(core);
    }

    console.log('[RESET] Demo state successfully reset to pristine baseline with 100% balanced double-entry ledger.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[RESET] Failed to reset demo state:', err);
    throw err;
  } finally {
    client.release();
  }
}

