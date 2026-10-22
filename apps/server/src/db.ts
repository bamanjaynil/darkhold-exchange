/**
 * @file db.ts
 * PostgreSQL connection pooling and authoritative writer advisory lock.
 */

import pg from 'pg';
import { config } from './config.js';

export const ADVISORY_LOCK_KEY = 0x4441524b; // 'DARK' in ASCII

export function createPool(connectionUrl?: string): pg.Pool {
  const url = connectionUrl || config.DATABASE_URL;
  return new pg.Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export const dbPool = createPool();

/**
 * Attempts to acquire an exclusive PostgreSQL advisory lock.
 * Ensures strictly one authoritative writer process per database.
 */
export async function acquireWriterLock(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [ADVISORY_LOCK_KEY]
    );
    return Boolean(res.rows[0]?.locked);
  } finally {
    client.release();
  }
}

export async function releaseWriterLock(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}