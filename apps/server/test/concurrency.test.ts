import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { setupTestDatabase, resetTestDatabase } from './setup.js';
import { bootstrapCore } from '../src/recovery.js';
import { FakeClock } from '../src/clock.js';
import { runReconciliation } from '../src/reconciliation.js';
import { ExchangeCore } from '../src/core.js';

describe('Concurrency & Non-Overspend Suite', () => {
  let pool: pg.Pool;
  let core: ExchangeCore;
  let clock: FakeClock;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    clock = new FakeClock();
    core = await bootstrapCore(pool, clock, 10, 5, true);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('competing orders against limited cash: no overspend, zero balance anomalies', async () => {
    // Alice has 1,000,000 DKC minor units
    // Submit 5 concurrent buy orders, each reserving 300,000 units (total 1,500,000 > 1,000,000)
    const promises = Array.from({ length: 5 }).map((_, i) =>
      core.dispatch<any>({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: `conc_ord_${i}`,
          clientOrderId: `conc_cid_${i}`,
          seq: 0,
          userId: 'usr_alice',
          symbol: 'FEST-GA',
          side: 'BUY',
          type: 'LIMIT',
          tif: 'GTC',
          price: 150000,
          qty: 2, // 2 * 150000 = 300000
        },
      })
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => r.success);
    const rejected = results.filter((r) => !r.success);

    // Alice could only afford 3 orders (3 * 300,000 = 900,000 <= 1,000,000)
    expect(successful.length).toBe(3);
    expect(rejected.length).toBe(2);

    const bal = core.getBalance('usr_alice');
    expect(bal.available).toBe(100000);
    expect(bal.reserved).toBe(900000);

    // Full persistence flush & reconciliation
    await core.persistence.flush();
    const rep = await runReconciliation(pool, core);
    expect(rep.balanced).toBe(true);
  });

  it('duplicate clientOrderId race returns identical result and mutates state once', async () => {
    const promises = Array.from({ length: 3 }).map(() =>
      core.dispatch<any>({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: `race_ord_1`,
          clientOrderId: `race_unique_cid_777`,
          seq: 0,
          userId: 'usr_bob',
          symbol: 'FEST-VIP',
          side: 'BUY',
          type: 'LIMIT',
          tif: 'GTC',
          price: 350000,
          qty: 1,
        },
      })
    );

    const results = await Promise.all(promises);
    const successList = results.filter((r) => r.success);
    expect(successList.length).toBe(3);

    // Exactly one fresh submission, others flagged isDuplicate
    const duplicates = results.filter((r) => r.isDuplicate);
    expect(duplicates.length).toBe(2);

    await core.persistence.flush();
    const rep = await runReconciliation(pool, core);
    expect(rep.balanced).toBe(true);
  });
});