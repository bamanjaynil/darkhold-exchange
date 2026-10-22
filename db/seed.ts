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

    // 2. Ensure System ISSUER accounts exist
    await client.query(`
      INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
      VALUES ('acc_issuer_cash', 'ISSUER', NULL, NULL)
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