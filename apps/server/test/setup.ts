/**
 * @file setup.ts
 * Vitest environment setup for server integration tests using real PostgreSQL test DB.
 */

import pg from 'pg';
import { runMigrations } from '../../../db/migrator.js';
import { runSeed } from '../../../db/seed.js';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://darkhold:local_dev_only_change_me@localhost:5433/darkhold_test?schema=public';

export async function setupTestDatabase(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  const client = await pool.connect();
  try {
    // Truncate all mutable tables before test run to ensure pristine state
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
          TRUNCATE orders, trades, escrows, auctions, journals, postings, balances, holdings, ledger_accounts, users, sessions CASCADE;
        END IF;
      END $$;
    `);
  } catch {
    // Tables may not exist yet on very first run
  } finally {
    client.release();
  }

  await runMigrations(TEST_DB_URL);
  await runSeed(TEST_DB_URL);
  return pool;
}

export async function resetTestDatabase(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE orders, trades, escrows, auctions, journals, postings, balances, holdings CASCADE');
    await runSeed(TEST_DB_URL);
  } finally {
    client.release();
  }
}