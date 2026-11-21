/**
 * @file seed.ts
 * Idempotent seeder for instruments, accounts, and initial double-entry ledger grants.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { OFFICIAL_ARTWORKS } from '../apps/server/src/artworks.js';


try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}
try { process.loadEnvFile(); } catch {}

export async function runSeed(connectionUrl?: string): Promise<void> {
  const url = connectionUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set for seeder');
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin_darkhold_2026';
    const demoPass = process.env.DEMO_PASSWORD || 'demo_darkhold_2026';

    const instrumentsPath = fileURLToPath(new URL('./seed/instruments.json', import.meta.url));
    const accountsPath = fileURLToPath(new URL('./seed/accounts.json', import.meta.url));

    const instruments = JSON.parse(fs.readFileSync(instrumentsPath, 'utf-8'));
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

    await client.query('BEGIN');

    // 0. Full Atomic Table Truncation to guarantee clean slate
    await client.query(`
      TRUNCATE TABLE
        postings,
        journals,
        trades,
        deals,
        orders,
        auctions,
        escrows,
        deposits,
        withdrawals,
        balances,
        holdings,
        ledger_accounts,
        instruments,
        users,
        sessions,
        solvency_snapshots,
        audit_events,
        organizations,
        organization_memberships,
        products,
        product_variants,
        drops,
        drop_items,
        events,
        ticket_tiers,
        store_orders,
        store_order_items,
        issued_tickets,
        community_listings
      RESTART IDENTITY CASCADE;
    `);

    // 1. Seed Instruments
    for (const inst of instruments) {
      await client.query(
        `INSERT INTO instruments (id, symbol, name, face_value, collar_bps, tick_size, min_qty, max_qty_per_order, escrow_required, is_benchmark)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           face_value = EXCLUDED.face_value,
           collar_bps = EXCLUDED.collar_bps,
           tick_size = EXCLUDED.tick_size;`,
        [
          inst.id,
          inst.symbol,
          inst.name,
          inst.faceValue,
          inst.collarBps,
          inst.tickSize,
          inst.minQty,
          inst.maxQtyPerOrder,
          inst.escrowRequired,
          inst.isBenchmark,
        ]
      );
    }

    // 2. Ensure System ISSUER and TREASURY accounts exist
    await client.query(`
      INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
      VALUES 
        ('acc_issuer_cash', 'ISSUER', NULL, NULL),
        ('acc_treasury_inr', 'TREASURY', NULL, NULL),
        ('acc_platform_fee', 'PLATFORM_FEE', NULL, NULL)
      ON CONFLICT (id) DO NOTHING;
    `);

    for (const inst of instruments) {
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'ISSUER', NULL, $2)
         ON CONFLICT (id) DO NOTHING;`,
        [`acc_issuer_${inst.symbol}`, inst.id]
      );
    }

    // 3. Seed Accounts, Credentials, and Initial Grants
    let seedSeq = 1;

    for (const acc of accounts) {
      const password = acc.role === 'admin' ? adminPass : demoPass;
      const pwdHash = await hash(password, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });

      await client.query(
        `INSERT INTO users (id, username, password_hash, role, is_demo, is_simulated)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role;`,
        [acc.id, acc.username, pwdHash, acc.role, acc.isDemo, acc.isSimulated]
      );

      // Ledger accounts for user
      const cashAvail = `acc_${acc.id}_cash_avail`;
      const cashRes = `acc_${acc.id}_cash_res`;
      const cashEsc = `acc_${acc.id}_cash_esc`;

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES
           ($1, 'USER_AVAILABLE', $2, NULL),
           ($3, 'USER_RESERVED', $2, NULL),
           ($4, 'ESCROW', $2, NULL)
         ON CONFLICT (id) DO NOTHING;`,
        [cashAvail, acc.id, cashRes, cashEsc]
      );

      for (const inst of instruments) {
        await client.query(
          `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
           VALUES
             ($1, 'USER_AVAILABLE', $4, $5),
             ($2, 'USER_RESERVED', $4, $5),
             ($3, 'ESCROW', $4, $5)
           ON CONFLICT (id) DO NOTHING;`,
          [
            `acc_${acc.id}_${inst.symbol}_avail`,
            `acc_${acc.id}_${inst.symbol}_res`,
            `acc_${acc.id}_${inst.symbol}_esc`,
            acc.id,
            inst.id,
          ]
        );
      }

      // Check if user already has an initial balance grant journal
      const grantRes = await client.query(
        `SELECT id FROM journals WHERE ref_type = 'INITIAL_GRANT' AND ref_id = $1`,
        [acc.id]
      );

      if (grantRes.rowCount === 0 && acc.initialDkc > 0) {
        const jId = `j_grant_${acc.id}_cash`;
        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id)
           VALUES ($1, 'GRANT', 'INITIAL_GRANT', $2)`,
          [jId, acc.id]
        );

        // Double-entry postings: Issuer -amount, User +amount -> SUM = 0
        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES
             ($1, 'acc_issuer_cash', 'CASH', $2, $3),
             ($1, $4, 'CASH', $5, $6)`,
          [jId, -acc.initialDkc, seedSeq++, cashAvail, acc.initialDkc, seedSeq++]
        );

        await client.query(
          `INSERT INTO balances (user_id, available, reserved, escrow)
           VALUES ($1, $2, 0, 0)
           ON CONFLICT (user_id) DO UPDATE SET available = EXCLUDED.available;`,
          [acc.id, acc.initialDkc]
        );

        if (['usr_alice', 'usr_bob', 'usr_carol'].includes(acc.id)) {
          await client.query(
            `INSERT INTO deposits (id, user_id, amount_dkc, amount_inr, method, reference, status, journal_id, created_at)
             VALUES ($1, $2, $3, $4, 'UPI', $5, 'COMPLETED', $6, NOW())
             ON CONFLICT (reference) DO NOTHING`,
            [`dep_grant_${acc.id}`, acc.id, acc.initialDkc, (acc.initialDkc / 100), `GRANT_SEED_${acc.id.toUpperCase()}`, jId]
          );
        }
      } else {
        await client.query(
          `INSERT INTO balances (user_id, available, reserved, escrow)
           VALUES ($1, 0, 0, 0)
           ON CONFLICT (user_id) DO NOTHING;`,
          [acc.id]
        );
      }

      // Seed Initial Inventory Grants
      for (const [symbol, qty] of Object.entries(acc.initialInventory || {})) {
        const inst = instruments.find((i: any) => i.symbol === symbol);
        if (!inst || (qty as number) <= 0) continue;

        const invGrantRes = await client.query(
          `SELECT id FROM journals WHERE ref_type = 'INITIAL_INV_GRANT' AND ref_id = $1`,
          [`${acc.id}:${inst.id}`]
        );

        if (invGrantRes.rowCount === 0) {
          const jId = `j_grant_${acc.id}_${inst.symbol}`;
          await client.query(
            `INSERT INTO journals (id, kind, ref_type, ref_id)
             VALUES ($1, 'GRANT', 'INITIAL_INV_GRANT', $2)`,
            [jId, `${acc.id}:${inst.id}`]
          );

          await client.query(
            `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
             VALUES
               ($1, $2, $3, $4, $5),
               ($1, $6, $3, $7, $8)`,
            [
              jId,
              `acc_issuer_${inst.symbol}`,
              inst.symbol,
              -(qty as number),
              seedSeq++,
              `acc_${acc.id}_${inst.symbol}_avail`,
              qty as number,
              seedSeq++,
            ]
          );

          await client.query(
            `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow)
             VALUES ($1, $2, $3, 0, 0)
             ON CONFLICT (user_id, instrument_id) DO UPDATE SET available = EXCLUDED.available;`,
            [acc.id, inst.id, qty as number]
          );
        }
      }

      // Ensure remaining instruments exist in holdings with 0
      for (const inst of instruments) {
        await client.query(
          `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow)
           VALUES ($1, $2, 0, 0, 0)
           ON CONFLICT (user_id, instrument_id) DO NOTHING;`,
          [acc.id, inst.id]
        );
      }
    }

    // 4. Seed Official Organizations & Permissions
    await client.query(`
      INSERT INTO organizations (id, name, slug, org_type, description, affiliation, contact_email, public_contact, status, is_verified, created_by, approved_by)
      VALUES
        ('org_fest_council', 'Official MNNIT Fest Organizing Committee', 'mnnit-fest-council', 'festival', 'Apex university organizing body for Culrav-Avishkar annual national collegiate festivals.', 'MNNIT Allahabad / Student Activity Centre', 'fest-council@mnnit.ac.in', 'SAC Building Ground Floor', 'APPROVED', TRUE, 'usr_admin', 'usr_admin'),
        ('org_robotics_club', 'Robotics & Automation Society', 'robotics-society', 'club', 'Premier campus technical society specializing in autonomous robotics, drones, and mechatronics.', 'Department of Electronics & Computer Science', 'robotics@mnnit.ac.in', 'Robotics Lab 3', 'APPROVED', TRUE, 'usr_bob', 'usr_admin'),
        ('org_literary_soc', 'Campus Literary & Dramatics Society', 'cul-lit-dramatics', 'society', 'Creative writing, debate, theatrical productions, and annual national dramatics festival.', 'Cultural Committee MNNIT', 'lit-dramatics@mnnit.ac.in', 'MP Hall Green Room', 'APPROVED', TRUE, 'usr_alice', 'usr_admin'),
        ('org_pending_dance', 'Campus Street Dance Crew', 'street-dance-crew', 'club', 'Collegiate hip-hop and contemporary dance crew.', 'Cultural Wing', 'dance@mnnit.ac.in', 'SAC Open Air Theatre', 'PENDING', FALSE, 'usr_carol', NULL)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 5. Seed Organization Memberships
    await client.query(`
      INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
      VALUES
        ('mem_fest_admin', 'org_fest_council', 'usr_admin', 'owner', 'ACTIVE'),
        ('mem_fest_alice', 'org_fest_council', 'usr_alice', 'admin', 'ACTIVE'),
        ('mem_fest_bob', 'org_fest_council', 'usr_bob', 'merch_manager', 'ACTIVE'),
        ('mem_fest_carol', 'org_fest_council', 'usr_carol', 'fulfillment', 'ACTIVE'),
        ('mem_robo_bob', 'org_robotics_club', 'usr_bob', 'owner', 'ACTIVE'),
        ('mem_robo_alice', 'org_robotics_club', 'usr_alice', 'event_manager', 'ACTIVE'),
        ('mem_lit_alice', 'org_literary_soc', 'usr_alice', 'owner', 'ACTIVE'),
        ('mem_dance_carol', 'org_pending_dance', 'usr_carol', 'owner', 'ACTIVE')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 6. Seed Merchandise Products
    await client.query(
      `INSERT INTO products (id, organization_id, name, description, category, images, base_price_dkc, base_price_inr, comparison_price_dkc, status, fulfillment_type, pickup_location, pickup_instructions, max_per_customer)
      VALUES
        ('prod_cloak', 'org_fest_council', 'Darkhold Official Fest Stealth Cloak / Hoodie', 'Heavyweight 240 GSM organic cotton-poly blend fleece with oversized cyberpunk drop-shoulder cut, dual tactical zipper pockets, and cryptographic heat-press crest.', 'APPAREL', $1::jsonb, 80000, 800.00, 120000, 'PUBLISHED', 'PICKUP', 'Student Activity Centre (SAC) Counter 2', 'Show OTP/pickup token on order detail screen at collection counter.', 3),
        ('prod_mug', 'org_fest_council', 'Festival Official Ceramic Cyber Mug', '11oz Matte-finish ceramic mug with reactive neon thermal festival emblem.', 'ACCESSORY', $2::jsonb, 35000, 350.00, 45000, 'PUBLISHED', 'PICKUP', 'SAC Counter 2', 'Collect between 10:00 AM - 6:00 PM during festival week.', 5),
        ('prod_poster', 'org_fest_council', 'A1 Commemorative Holographic Festival Poster', 'Limited print 300 GSM metallic foil commemorative festival poster designed by MNNIT Media Cell.', 'PRINT', $3::jsonb, 20000, 200.00, 30000, 'PUBLISHED', 'PICKUP', 'SAC Counter 2', 'Comes packaged in protective cylindrical kraft tube.', 5)
      ON CONFLICT (id) DO UPDATE SET images = EXCLUDED.images, status = 'PUBLISHED'`,
      [
        JSON.stringify([OFFICIAL_ARTWORKS.hoodie]),
        JSON.stringify([OFFICIAL_ARTWORKS.cyberMug]),
        JSON.stringify([OFFICIAL_ARTWORKS.poster]),
      ]
    );

    // 7. Seed Explicit Custom Variants (NO forced S/M/L/XL! Only what organizer created!)
    await client.query(`
      INSERT INTO product_variants (id, product_id, title, sku, attributes, price_adjustment_dkc, stock, reserved_stock, is_available)
      VALUES
        ('var_cloak_s', 'prod_cloak', 'Size S', 'CLK-S', '{"size": "S"}'::jsonb, 0, 50, 0, TRUE),
        ('var_cloak_m', 'prod_cloak', 'Size M', 'CLK-M', '{"size": "M"}'::jsonb, 0, 80, 0, TRUE),
        ('var_cloak_l', 'prod_cloak', 'Size L', 'CLK-L', '{"size": "L"}'::jsonb, 0, 100, 0, TRUE),
        ('var_cloak_xl', 'prod_cloak', 'Size XL', 'CLK-XL', '{"size": "XL"}'::jsonb, 0, 40, 0, TRUE),
        ('var_cloak_xxl', 'prod_cloak', 'Size XXL', 'CLK-XXL', '{"size": "XXL"}'::jsonb, 5000, 20, 0, TRUE),
        ('var_mug_black', 'prod_mug', 'Matte Obsidian Black', 'MUG-BLK', '{"color": "Matte Obsidian Black"}'::jsonb, 0, 75, 0, TRUE),
        ('var_mug_cyan', 'prod_mug', 'Neon Cyber Cyan', 'MUG-CYN', '{"color": "Neon Cyber Cyan"}'::jsonb, 0, 60, 0, TRUE),
        ('var_poster_std', 'prod_poster', 'Standard Metallic Foil Edition', 'POST-FOIL', '{"edition": "Standard Foil"}'::jsonb, 0, 150, 0, TRUE)
      ON CONFLICT (id) DO UPDATE SET stock = EXCLUDED.stock, is_available = TRUE;
    `);

    // 8. Seed Timed Drops
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

    // 9. Seed Events & Ticket Tiers
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

    // 10. Seed Community Marketplace Listings
    await client.query(`
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS buyer_user_id VARCHAR(64);
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS pickup_otp VARCHAR(32);
      ALTER TABLE community_listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;
    `).catch(() => {});

    await client.query(
      `INSERT INTO community_listings (id, user_id, title, description, category, condition, images, price_dkc, listing_type, trade_terms, contact_method, status)
      VALUES
        ('comm_calc_alice', 'usr_alice', 'TI-84 Plus CE Color Graphing Calculator', 'Pre-owned graphing calculator in pristine condition. Includes charging cable and slide case. Essential for engineering math and physics.', 'ELECTRONICS', 'EXCELLENT', $1::jsonb, 350000, 'SALE', 'Hostel 4 or SAC Desk', 'Hostel 4, Room 214 or reach @alice in-app', 'ACTIVE'),
        ('comm_clrs_bob', 'usr_bob', 'Introduction to Algorithms (CLRS 4th Edition)', 'Hardcover edition with clean pages and no markings. Looking to sell or trade for operating systems textbooks.', 'BOOKS', 'LIKE_NEW', $2::jsonb, 120000, 'BOTH', 'Library 2nd Floor Study Desk', 'Library 2nd Floor study desk or @bob in-app', 'ACTIVE'),
        ('comm_lamp_carol', 'usr_carol', 'Ergonomic Cyberpunk LED Study Lamp', 'Multi-pivot dimmable desk lamp with warm and cool modes plus integrated wireless phone charging pad.', 'ELECTRONICS', 'LIKE_NEW', $3::jsonb, 80000, 'SALE', 'Hostel 5 Common Room', 'Hostel 5 Common Room or reach @carol in-app', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET images = EXCLUDED.images, price_dkc = EXCLUDED.price_dkc, status = 'ACTIVE'`,
      [
        JSON.stringify([OFFICIAL_ARTWORKS.calculator]),
        JSON.stringify([OFFICIAL_ARTWORKS.clrsBook]),
        JSON.stringify([OFFICIAL_ARTWORKS.dormLamp]),
      ]
    );

    // Update instruments table with visual artwork
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

    // Mathematical Invariant Verification before COMMIT
    const { rows: unitImbalances } = await client.query<{ unit: string; total: string }>(`
      SELECT unit, SUM(amount) AS total
      FROM postings
      GROUP BY unit
      HAVING SUM(amount) <> 0;
    `);
    if (unitImbalances.length > 0) {
      throw new Error(`[SEED_ERROR] Global unit imbalance detected: ${JSON.stringify(unitImbalances)}`);
    }

    await client.query('COMMIT');
    console.log('[SEED] Seeding completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Error during seeding:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}