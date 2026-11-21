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

let writerLockClient: pg.PoolClient | null = null;
let writerLockPool: pg.Pool | null = null;

/**
 * Attempts to acquire an exclusive PostgreSQL advisory lock.
 * Ensures strictly one authoritative writer process per database.
 * Retains the dedicated connection for the lifetime of the process.
 */
export async function acquireWriterLock(pool: pg.Pool): Promise<boolean> {
  if (writerLockClient && writerLockPool === pool) {
    return true;
  }
  if (writerLockClient) {
    await releaseWriterLock();
  }
  const client = await pool.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [ADVISORY_LOCK_KEY]
    );
    const locked = Boolean(res.rows[0]?.locked);
    if (locked) {
      writerLockClient = client;
      writerLockPool = pool;

      // Ensure that if the pool is terminated (e.g. test teardown or graceful shutdown),
      // the dedicated writer lock client is released cleanly before pool.end resolves.
      const origEnd = pool.end.bind(pool);
      pool.end = async () => {
        if (writerLockClient && writerLockPool === pool) {
          await releaseWriterLock();
        }
        return origEnd();
      };

      return true;
    } else {
      client.release();
      return false;
    }
  } catch (err) {
    client.release();
    throw err;
  }
}

export async function releaseWriterLock(pool?: pg.Pool): Promise<void> {
  if (writerLockClient) {
    try {
      await writerLockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // client might already be disconnected
    } finally {
      writerLockClient.release();
      writerLockClient = null;
      writerLockPool = null;
    }
  } else if (pool) {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } finally {
      client.release();
    }
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