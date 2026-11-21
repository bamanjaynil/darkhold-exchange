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
import { OFFICIAL_ARTWORKS } from './artworks.js';

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
      'TRUNCATE orders, trades, deals, escrows, auctions, deposits, withdrawals, journals, postings, balances, holdings, solvency_snapshots, store_orders, store_order_items, issued_tickets CASCADE'
    );

    let seedSeq = 1;

    // 2. Resolve instruments
    const { rows: instruments } = await client.query<{ id: string; symbol: string }>(
      'SELECT id, symbol FROM instruments WHERE active = TRUE'
    );

    // 3. Ensure system ISSUER and TREASURY accounts exist
    await client.query(`
      INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
      VALUES 
        ('acc_issuer_cash', 'ISSUER', NULL, NULL),
        ('acc_treasury_inr', 'TREASURY', NULL, NULL),
        ('acc_platform_fee', 'PLATFORM_FEE', NULL, NULL)
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

      if (['usr_alice', 'usr_bob', 'usr_carol'].includes(uId)) {
        await client.query(
          `INSERT INTO deposits (id, user_id, amount_dkc, amount_inr, method, reference, status, journal_id, created_at)
           VALUES ($1, $2, $3, $4, 'UPI', $5, 'COMPLETED', $6, NOW())
           ON CONFLICT (reference) DO NOTHING`,
          [`dep_reset_${uId}`, uId, grantAmt, (grantAmt / 100), `SEED_DEPOSIT_${uId.toUpperCase()}`, cashJournalId]
        );
      }
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

    // 9. Update Instruments with Official Visual Artworks
    await client.query('ALTER TABLE instruments ADD COLUMN IF NOT EXISTS image_url TEXT;').catch(() => {});
    await client.query(
      `UPDATE instruments SET image_url = CASE
        WHEN symbol = 'FEST-GA' THEN $1
        WHEN symbol = 'FEST-VIP' THEN $2
        WHEN symbol = 'MERCH-CLOAK' THEN $3
        WHEN symbol = 'RELIC-AGAMOTTO' THEN $4
        ELSE image_url
      END`,
      [
        OFFICIAL_ARTWORKS.festGa,
        OFFICIAL_ARTWORKS.festVip,
        OFFICIAL_ARTWORKS.merchCloak,
        OFFICIAL_ARTWORKS.relicAgamotto,
      ]
    );

    // 10. Seed Official Fest Organizing Council & Campus Products
    await client.query(`
      INSERT INTO organizations (id, name, slug, org_type, description, affiliation, contact_email, public_contact, status, is_verified, created_by, approved_by)
      VALUES ('org_fest_council', 'Fest Organizing Council', 'fest-council', 'festival', 'Official Student Fest Core Team and Council', 'MNNIT Allahabad / Student Activity Centre', 'fest@mnnit.ac.in', 'SAC Ground Floor', 'APPROVED', TRUE, 'usr_admin', 'usr_admin')
      ON CONFLICT (id) DO UPDATE SET is_verified = TRUE, status = 'APPROVED';
    `);

    await client.query(
      `INSERT INTO products (id, organization_id, name, description, category, images, base_price_dkc, base_price_inr, comparison_price_dkc, status, fulfillment_type, pickup_location, pickup_instructions, max_per_customer)
      VALUES
        ('prod_cloak', 'org_fest_council', 'Darkhold Official Fest Stealth Cloak / Hoodie', 'Heavyweight 240 GSM organic cotton-poly blend fleece with oversized cyberpunk drop-shoulder cut, dual tactical zipper pockets, and cryptographic heat-press crest.', 'APPAREL', $1::jsonb, 80000, 800.00, 120000, 'PUBLISHED', 'PICKUP', 'Student Activity Centre (SAC) Counter 2', 'Show OTP/pickup token on order detail screen at collection counter.', 3),
        ('prod_mug', 'org_fest_council', 'Festival Official Ceramic Cyber Mug', '11oz Matte-finish ceramic mug with reactive neon thermal festival emblem.', 'ACCESSORY', $2::jsonb, 35000, 350.00, 45000, 'PUBLISHED', 'PICKUP', 'SAC Counter 2', 'Collect between 10:00 AM - 6:00 PM during festival week.', 5),
        ('prod_poster', 'org_fest_council', 'A1 Commemorative Holographic Festival Poster', 'Limited print 300 GSM metallic foil commemorative festival poster designed by MNNIT Media Cell.', 'PRINT', $3::jsonb, 20000, 200.00, 30000, 'PUBLISHED', 'PICKUP', 'SAC Counter 2', 'Comes packaged in protective cylindrical kraft tube.', 5)
      ON CONFLICT (id) DO UPDATE SET
        images = EXCLUDED.images,
        base_price_dkc = EXCLUDED.base_price_dkc,
        status = 'PUBLISHED'`,
      [
        JSON.stringify([OFFICIAL_ARTWORKS.hoodie]),
        JSON.stringify([OFFICIAL_ARTWORKS.cyberMug]),
        JSON.stringify([OFFICIAL_ARTWORKS.poster]),
      ]
    );

    // Product Variants with initial stock
    await client.query(`
      INSERT INTO product_variants (id, product_id, title, sku, attributes, price_adjustment_dkc, stock, reserved_stock, is_available)
      VALUES
        ('var_cloak_s', 'prod_cloak', 'Size S', 'CLK-S', '{"size": "S"}'::jsonb, 0, 50, 0, TRUE),
        ('var_cloak_m', 'prod_cloak', 'Size M', 'CLK-M', '{"size": "M"}'::jsonb, 0, 80, 0, TRUE),
        ('var_cloak_l', 'prod_cloak', 'Size L', 'CLK-L', '{"size": "L"}'::jsonb, 0, 100, 0, TRUE),
        ('var_cloak_xl', 'prod_cloak', 'Size XL', 'CLK-XL', '{"size": "XL"}'::jsonb, 0, 40, 0, TRUE),
        ('var_mug_black', 'prod_mug', 'Matte Obsidian Black', 'MUG-BLK', '{"color": "Matte Obsidian Black"}'::jsonb, 0, 75, 0, TRUE),
        ('var_mug_cyan', 'prod_mug', 'Neon Cyber Cyan', 'MUG-CYN', '{"color": "Neon Cyber Cyan"}'::jsonb, 0, 60, 0, TRUE),
        ('var_poster_std', 'prod_poster', 'Standard Metallic Foil Edition', 'POST-FOIL', '{"edition": "Standard Foil"}'::jsonb, 0, 150, 0, TRUE)
      ON CONFLICT (id) DO UPDATE SET
        stock = EXCLUDED.stock,
        is_available = TRUE;
    `);

    // Drops & Drops Items
    await client.query(
      `INSERT INTO drops (id, organization_id, title, description, cover_url, status, starts_at, ends_at, pickup_location, pickup_window, customer_instructions)
      VALUES
        ('drop_spring_2026', 'org_fest_council', 'Official Fest Spring 2026 Primary Merch Drop', 'Official festival merchandise collection released directly by the Fest Organizing Committee.', $1, 'LIVE', NOW() - INTERVAL '1 day', NOW() + INTERVAL '14 days', 'Student Activity Centre (SAC) Counter 2', '10:00 AM - 6:00 PM Daily', 'Bring your student ID card along with order QR / pickup code.')
      ON CONFLICT (id) DO UPDATE SET cover_url = EXCLUDED.cover_url, status = 'LIVE'`,
      [OFFICIAL_ARTWORKS.festivalBanner]
    );

    await client.query(`
      INSERT INTO drop_items (id, drop_id, product_id, allocated_stock, sold_count, sort_order)
      VALUES
        ('ditem_cloak', 'drop_spring_2026', 'prod_cloak', 290, 14, 1),
        ('ditem_mug', 'drop_spring_2026', 'prod_mug', 135, 8, 2),
        ('ditem_poster', 'drop_spring_2026', 'prod_poster', 150, 12, 3)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Events & Ticket Tiers
    await client.query(
      `INSERT INTO events (id, organization_id, title, description, venue, cover_url, starts_at, ends_at, sales_open_at, sales_close_at, total_capacity, status, checkin_instructions)
      VALUES
        ('evt_pronite_2026', 'org_fest_council', 'Culrav-Avishkar Annual Pronite Festival 2026', 'Three days of live headline performances, EDM night, fusion concerts, and laser pyrotechnics.', 'Gymkhana Main Arena, MNNIT Campus', $1, NOW() + INTERVAL '10 days', NOW() + INTERVAL '13 days', NOW() - INTERVAL '3 days', NOW() + INTERVAL '9 days', 5000, 'PUBLISHED', 'Scan your ticket QR at Gate 1 (General) or Gate 3 (VIP Pit). Physical wristbands provided at turnstiles.')
      ON CONFLICT (id) DO UPDATE SET cover_url = EXCLUDED.cover_url, status = 'PUBLISHED'`,
      [OFFICIAL_ARTWORKS.festivalBanner]
    );

    await client.query(`
      INSERT INTO ticket_tiers (id, event_id, name, description, price_dkc, price_inr, capacity, sold_count, is_vip, benefits, max_per_customer, status)
      VALUES
        ('tier_pronite_ga', 'evt_pronite_2026', 'Pronite General Admission Pass', 'Full 3-day arena standing access to all headline pronite artist performances.', 150000, 1500.00, 4500, 120, FALSE, '["3-Day Standing Arena Access", "Main Stage Pyrotechnics View", "Collar-Capped Verified Resale"]'::jsonb, 4, 'ACTIVE'),
        ('tier_pronite_vip', 'evt_pronite_2026', 'VIP All-Access Backstage Pass', 'Front-row barricade pit access, backstage green-room artist meet & greet, and fast-track express entry.', 500000, 5000.00, 500, 35, TRUE, '["Front-Row Barricade Pit Access", "Backstage Green-Room Meet & Greet", "Fast-Track Turnstile Lane", "Exclusive Fest Lanyard & Badge"]'::jsonb, 2, 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
    `);

    // 11. Seed Active Community Marketplace Listings with Real SVG Artworks
    await client.query(`
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS buyer_user_id VARCHAR(64);
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS pickup_otp VARCHAR(32);
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;
    `).catch(() => {});

    await client.query(
      `INSERT INTO community_listings (
        id, user_id, title, description, category, condition, images, price_dkc, listing_type, trade_terms, contact_method, status
      ) VALUES
        ('comm_calc_alice', 'usr_alice', 'TI-84 Plus CE Color Graphing Calculator', 'Pre-owned graphing calculator in pristine condition. Includes charging cable and slide case. Essential for engineering math and physics.', 'ELECTRONICS', 'EXCELLENT', $1::jsonb, 350000, 'SALE', 'Hostel 4 or SAC Desk', 'Hostel 4, Room 214 or reach @alice in-app', 'ACTIVE'),
        ('comm_clrs_bob', 'usr_bob', 'Introduction to Algorithms (CLRS 4th Edition)', 'Hardcover edition with clean pages and no markings. Essential textbook for competitive programming and data structures.', 'BOOKS', 'LIKE_NEW', $2::jsonb, 120000, 'BOTH', 'Library 2nd Floor Study Desk', 'Library 2nd Floor study desk or @bob in-app', 'ACTIVE'),
        ('comm_lamp_carol', 'usr_carol', 'Ergonomic Cyberpunk LED Study Lamp', 'Multi-pivot dimmable desk lamp with warm and cool modes plus integrated wireless phone charging pad.', 'ELECTRONICS', 'LIKE_NEW', $3::jsonb, 80000, 'SALE', 'Hostel 5 Common Room', 'Hostel 5 Common Room or reach @carol in-app', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET
        images = EXCLUDED.images,
        price_dkc = EXCLUDED.price_dkc,
        status = 'ACTIVE'`,
      [
        JSON.stringify([OFFICIAL_ARTWORKS.calculator]),
        JSON.stringify([OFFICIAL_ARTWORKS.clrsBook]),
        JSON.stringify([OFFICIAL_ARTWORKS.dormLamp]),
      ]
    );

    await client.query('COMMIT');

    // 9. Rebuild Matching Engine & In-Memory ExchangeCore RAM state
    for (const inst of core.instruments.values()) {
      core.engine.registerInstrument(inst);
    }
    await hydrateFromDb(core, client);

    for (const inst of core.instruments.values()) {
      if (inst.symbol === 'FEST-GA') (inst as any).imageUrl = OFFICIAL_ARTWORKS.festGa;
      if (inst.symbol === 'FEST-VIP') (inst as any).imageUrl = OFFICIAL_ARTWORKS.festVip;
      if (inst.symbol === 'MERCH-CLOAK') (inst as any).imageUrl = OFFICIAL_ARTWORKS.merchCloak;
      if (inst.symbol === 'RELIC-AGAMOTTO') (inst as any).imageUrl = OFFICIAL_ARTWORKS.relicAgamotto;
    }

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

