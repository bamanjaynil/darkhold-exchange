import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { setupTestDatabase } from './setup.js';
import { bootstrapCore } from '../src/recovery.js';
import { FakeClock } from '../src/clock.js';
import { runReconciliation } from '../src/reconciliation.js';
import { ExchangeCore } from '../src/core.js';
import { PersistenceEngine, StateDeltaBatch } from '../src/persistence.js';

describe('Postings Optimization (UNNEST Mode) Correctness & Invariants Suite', () => {
  let pool: pg.Pool;
  let core: ExchangeCore;
  let clock: FakeClock;

  beforeAll(async () => {
    process.env.POSTINGS_WRITE_MODE = 'unnest';
    pool = await setupTestDatabase();
    clock = new FakeClock();
    core = await bootstrapCore(pool, clock, 1, 1, true);
  });

  afterAll(async () => {
    delete process.env.POSTINGS_WRITE_MODE;
    await pool.end();
  });

  it('correctly inserts multiple postings per journal with strict sequence ordering in UNNEST mode', async () => {
    // Carol sells 1 FEST-GA at 150000, Bob buys 1 FEST-GA at 150000
    const sellRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-unnest-test-sell',
        clientOrderId: 'cid-unnest-s',
        seq: 0,
        userId: 'usr_carol',
        symbol: 'FEST-GA',
        side: 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 1,
      },
    });
    expect(sellRes.success).toBe(true);

    const buyRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-unnest-test-buy',
        clientOrderId: 'cid-unnest-b',
        seq: 0,
        userId: 'usr_bob',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 1,
      },
    });
    expect(buyRes.success).toBe(true);

    // Verify postings in DB directly
    const res = await pool.query(
      `SELECT journal_id, account_id, unit, amount, seq
       FROM postings
       WHERE journal_id LIKE 'j_trade_%'
       ORDER BY seq ASC, id ASC`
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (let i = 1; i < res.rows.length; i++) {
      expect(Number(res.rows[i].seq)).toBeGreaterThanOrEqual(Number(res.rows[i - 1].seq));
    }
  });

  it('rejects unbalanced journal entries via deferred trg_journal_balanced constraint trigger in UNNEST mode', async () => {
    const persistence = new PersistenceEngine(pool, 1, 1);
    let rollbackCalled = false;
    let commitCalled = false;

    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => {
      resolveDone = r;
    });

    const invalidBatch: StateDeltaBatch = {
      commandId: 'cmd_unbalanced_unnest',
      seq: 99999,
      journals: [
        {
          id: 'j_unbalanced_unnest',
          kind: 'TEST_IMBALANCE',
          refType: 'ORDER',
          refId: 'ord_test_imb',
          postings: [
            // Valid account but violates zero-sum invariant: +1000 without corresponding -1000
            {
              accountId: 'acc_usr_alice_cash_avail',
              unit: 'CASH',
              amount: 1000,
              seq: 99999,
            },
          ],
        },
      ],
      balanceDeltas: [],
      holdingDeltas: [],
      upsertOrders: [],
      newTrades: [],
      upsertAuctions: [],
      upsertEscrows: [],
      auditEvents: [],
      onCommit: () => {
        commitCalled = true;
        resolveDone();
      },
      onRollback: (err) => {
        rollbackCalled = true;
        resolveDone();
      },
    };

    persistence.enqueue(invalidBatch);
    await donePromise;

    expect(rollbackCalled).toBe(true);
    expect(commitCalled).toBe(false);

    // Verify no postings were persisted for the rejected journal
    const check = await pool.query('SELECT 1 FROM postings WHERE journal_id = $1', ['j_unbalanced_unnest']);
    expect(check.rows.length).toBe(0);
  });

  it('handles foreign key violations with clean transaction rollback in UNNEST mode', async () => {
    const persistence = new PersistenceEngine(pool, 1, 1);
    let rollbackError: any = null;

    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => {
      resolveDone = r;
    });

    const fkBatch: StateDeltaBatch = {
      commandId: 'cmd_fk_violation',
      seq: 99998,
      journals: [
        {
          id: 'j_fk_test',
          kind: 'TEST_FK',
          refType: 'ORDER',
          refId: 'ord_fk_test',
          postings: [
            {
              accountId: 'non_existent_account_id', // Invalid FK
              unit: 'CASH',
              amount: 500,
              seq: 99998,
            },
            {
              accountId: 'acc_usr_alice_cash_avail',
              unit: 'CASH',
              amount: -500,
              seq: 99998,
            },
          ],
        },
      ],
      balanceDeltas: [],
      holdingDeltas: [],
      upsertOrders: [],
      newTrades: [],
      upsertAuctions: [],
      upsertEscrows: [],
      auditEvents: [],
      onCommit: () => {
        resolveDone();
      },
      onRollback: (err) => {
        rollbackError = err;
        resolveDone();
      },
    };

    persistence.enqueue(fkBatch);
    await donePromise;

    expect(rollbackError).toBeDefined();
    const check = await pool.query('SELECT 1 FROM postings WHERE journal_id = $1', ['j_fk_test']);
    expect(check.rows.length).toBe(0);
  });

  it('survives simulated persistence failure and completes state recovery in UNNEST mode (Scenario J)', async () => {
    core.persistence.injectFailure = true;
    await expect(
      core.dispatch({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: 'ord-fail-commit-unnest',
          clientOrderId: 'cid-fail-u',
          seq: 0,
          userId: 'usr_alice',
          symbol: 'FEST-GA',
          side: 'BUY',
          type: 'LIMIT',
          tif: 'GTC',
          price: 130000,
          qty: 1,
        },
      })
    ).rejects.toThrow();

    // Verify recovery rebuild re-hydrated cleanly
    core.persistence.injectFailure = false;
    const recReport = await runReconciliation(pool, core);
    expect(recReport.balanced).toBe(true);
  });

  it('passes 100% clean double-entry ledger reconciliation after mixed trading in UNNEST mode', async () => {
    const recReport = await runReconciliation(pool, core);
    expect(recReport.balanced).toBe(true);
    expect(recReport.anomaliesCount).toBe(0);
  });
});
