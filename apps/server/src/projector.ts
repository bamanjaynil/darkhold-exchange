/**
 * @file projector.ts
 * Asynchronous CQRS Projection Worker.
 *
 * Consumes committed binary event frames from the Append-Only Log or Ring Buffer
 * and asynchronously projects them into PostgreSQL read-tables without blocking the
 * critical matching engine execution path.
 */

import pg from 'pg';
import { AppendOnlyJournal, AolRecord } from './aol.js';

export class AsyncPostgresProjector {
  private pool: pg.Pool;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private pendingRecords: AolRecord[] = [];
  private lastProjectedSeq: number = 0;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public enqueue(record: AolRecord): void {
    this.pendingRecords.push(record);
    if (this.pendingRecords.length >= 1000) {
      void this.flush();
    }
  }

  public start(intervalMs: number = 100): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async flush(): Promise<number> {
    if (this.pendingRecords.length === 0) return 0;
    const batch = this.pendingRecords.splice(0, 5000);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const values: any[] = [];
      const rows = batch.map((r, idx) => {
        const base = idx * 10;
        values.push(
          r.orderId,
          `cid_${r.seq}`,
          r.seq,
          r.userId,
          r.symbol,
          r.side === 0 ? 'BUY' : 'SELL',
          r.cmdType === 1 ? 'LIMIT' : 'CANCELLED',
          'GTC',
          r.price,
          r.qty
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, (SELECT id FROM instruments WHERE symbol = $${base + 5}), $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, 0, 'FILLED')`;
      });

      await client.query(
        `INSERT INTO orders (id, client_order_id, seq, user_id, instrument_id, side, type, tif, price, qty, remaining_qty, status)
         VALUES ${rows.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = NOW()`,
        values
      );

      await client.query('COMMIT');
      this.lastProjectedSeq = batch[batch.length - 1]!.seq;
      return batch.length;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PROJECTOR] Async projection flush failed:', err);
      // Re-queue on failure
      this.pendingRecords.unshift(...batch);
      return 0;
    } finally {
      client.release();
    }
  }

  public getLastProjectedSeq(): number {
    return this.lastProjectedSeq;
  }
}
