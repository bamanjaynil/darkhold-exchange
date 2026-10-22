/**
 * @file migrator.ts
 * Lightweight, zero-ORM PostgreSQL migration runner.
 * Reads sorted .sql files from db/migrations/ and executes them atomically.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';


try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}
try { process.loadEnvFile(); } catch {}

export async function runMigrations(connectionUrl?: string): Promise<string[]> {
  const url = connectionUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set for migration runner');
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM _migrations');
    const appliedSet = new Set(rows.map((r) => r.name));

    const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`[MIGRATION] Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`[MIGRATION] Applied ${file} successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATION] Failed to apply ${file}:`, err);
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  return applied;
}

if (process.argv[1]?.endsWith('migrator.ts') || process.argv[1]?.endsWith('migrator.js')) {
  runMigrations()
    .then((applied) => {
      console.log(`[MIGRATION] Finished. Applied ${applied.length} new migrations.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATION] Fatal error running migrations:', err);
      process.exit(1);
    });
}