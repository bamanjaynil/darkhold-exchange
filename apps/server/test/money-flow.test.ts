/**
 * @file money-flow.test.ts
 * Comprehensive test suite verifying the UPI / DKC economy, deposit idempotency,
 * atomic DKC transfers/merch purchases, withdrawal holds, payout provider mock,
 * failure refunds, and 100% reserve backing invariant.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { FastifyInstance } from 'fastify';
import { setupTestDatabase } from './setup.js';
import { buildServer } from '../src/server.js';
import { ECONOMY_CONFIG } from '../src/config.js';

describe('UPI / DKC Money Flow & Ledger Economy Suite', () => {
  let pool: pg.Pool;
  let server: FastifyInstance;
  let core: any;

  let aliceCookie: string;
  let aliceCsrf: string;
  let bobCookie: string;
  let bobCsrf: string;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    const bootstrapped = await buildServer(pool);
    server = bootstrapped.server;
    core = bootstrapped.core;
    await server.ready();

    // Log in Alice
    const aliceLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: 'alice', password: 'demo_darkhold_2026' },
    });
    expect(aliceLogin.statusCode).toBe(200);
    aliceCookie = aliceLogin.cookies.find((c) => c.name === 'dk_session')!.value;
    aliceCsrf = aliceLogin.cookies.find((c) => c.name === 'dk_csrf')!.value;

    // Log in Bob
    const bobLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: 'bob', password: 'demo_darkhold_2026' },
    });
    expect(bobLogin.statusCode).toBe(200);
    bobCookie = bobLogin.cookies.find((c) => c.name === 'dk_session')!.value;
    bobCsrf = bobLogin.cookies.find((c) => c.name === 'dk_csrf')!.value;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('1. Deposit (UPI -> DKC) & Idempotency', () => {
    it('deposits INR and credits DKC at configured 1:1 rate', async () => {
      const depositRef = `TEST_DEP_${Date.now()}_001`;
      const depositAmount = 2500; // 2,500 INR = 2,500 DKC

      const beforeRes = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      });
      const initialAvail = JSON.parse(beforeRes.payload).balance.available;

      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/deposit',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          amount: depositAmount,
          method: 'UPI',
          reference: depositRef,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.isDuplicate).toBe(false);
      expect(data.dkcMinted).toBe(depositAmount);
      expect(data.reference).toBe(depositRef);
      expect(data.journalId).toBeDefined();

      // Check balance increased by exactly depositAmount * 100 minor units
      const afterRes = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      });
      const newAvail = JSON.parse(afterRes.payload).balance.available;
      expect(newAvail).toBe(initialAvail + depositAmount * 100);

      // Verify DB deposit record
      const dbDeposit = await pool.query('SELECT * FROM deposits WHERE reference = $1', [depositRef]);
      expect(dbDeposit.rows.length).toBe(1);
      expect(Number(dbDeposit.rows[0].amount_dkc)).toBe(depositAmount * 100);
      expect(dbDeposit.rows[0].status).toBe('COMPLETED');
    });

    it('handles duplicate deposit callback idempotently without double-crediting', async () => {
      const depositRef = `TEST_DEP_IDEM_${Date.now()}`;
      const depositAmount = 1000;

      // First call
      const firstRes = await server.inject({
        method: 'POST',
        url: '/api/wallet/deposit',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          amount: depositAmount,
          method: 'UPI',
          reference: depositRef,
        },
      });
      expect(firstRes.statusCode).toBe(200);
      const firstData = JSON.parse(firstRes.payload);
      expect(firstData.isDuplicate).toBe(false);

      const balAfterFirst = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance.available;

      // Duplicate callback with identical reference
      const dupRes = await server.inject({
        method: 'POST',
        url: '/api/wallet/deposit',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          amount: depositAmount,
          method: 'UPI',
          reference: depositRef,
        },
      });
      expect(dupRes.statusCode).toBe(200);
      const dupData = JSON.parse(dupRes.payload);
      expect(dupData.success).toBe(true);
      expect(dupData.isDuplicate).toBe(true);
      expect(dupData.reference).toBe(depositRef);
      expect(dupData.journalId).toBe(firstData.journalId);

      // Balance must NOT have increased twice
      const balAfterDup = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance.available;
      expect(balAfterDup).toBe(balAfterFirst);

      // Ensure only 1 record in database
      const dbRows = await pool.query('SELECT count(*) FROM deposits WHERE reference = $1', [depositRef]);
      expect(Number(dbRows.rows[0].count)).toBe(1);
    });
  });

  describe('2. Spend / Sell (DKC <-> DKC Merch Purchases & Transfers)', () => {
    it('successfully transfers 499 DKC from Alice (buyer) to Bob (seller)', async () => {
      const aliceBefore = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance.available;

      const bobBefore = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: bobCookie },
      })).json().balance.available;

      const transferRes = await server.inject({
        method: 'POST',
        url: '/api/merch/purchase',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          sellerUsername: 'bob',
          amount: 499,
          itemTitle: 'Darkhold Signature Cyber Cloak',
        },
      });

      expect(transferRes.statusCode).toBe(200);
      const data = JSON.parse(transferRes.payload);
      expect(data.success).toBe(true);
      expect(data.amountDKC).toBe(499);
      expect(data.sellerUsername).toBe('bob');
      expect(data.journalId).toBeDefined();

      const aliceAfter = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance.available;

      const bobAfter = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: bobCookie },
      })).json().balance.available;

      expect(aliceAfter).toBe(aliceBefore - 49900);
      expect(bobAfter).toBe(bobBefore + 49900);

      // Verify zero-sum double-entry ledger postings for this journal
      const postings = await pool.query(
        'SELECT account_id, unit, amount FROM postings WHERE journal_id = $1',
        [data.journalId]
      );
      expect(postings.rows.length).toBe(2);
      const sum = postings.rows.reduce((acc, row) => acc + Number(row.amount), 0);
      expect(sum).toBe(0);
    });

    it('rejects purchase when buyer has insufficient available funds', async () => {
      const hugeAmount = 999999999; // Insurmountable amount
      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/transfer',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          recipient: 'bob',
          amount: hugeAmount,
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('INSUFFICIENT_FUNDS');
    });

    it('rejects transfer to self', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/transfer',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          recipient: 'alice',
          amount: 100,
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('CANNOT_TRANSFER_TO_SELF');
    });

    it('handles concurrent purchases from the same wallet without overspending', async () => {
      // 1. Register a dedicated test user with default grant
      const username = `conc_${Date.now()}`;
      const regRes = await server.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'Content-Type': 'application/json' },
        payload: { username, password: 'password123', role: 'user', profile: 'standard' },
      });
      expect(regRes.statusCode).toBe(200);
      const regData = JSON.parse(regRes.payload);
      const testUserId = regData.user.id;
      const testSession = regRes.cookies.find((c) => c.name === 'dk_session')!.value;
      const testCsrf = regRes.cookies.find((c) => c.name === 'dk_csrf')!.value;

      // Set user's available balance to exactly 1,000 DKC (100,000 minor)
      await pool.query('UPDATE balances SET available = 100000, reserved = 0, escrow = 0 WHERE user_id = $1', [testUserId]);
      core.getBalance(testUserId).available = 100000;
      core.getBalance(testUserId).reserved = 0;
      core.getBalance(testUserId).escrow = 0;

      // Attempt 5 simultaneous purchases of 300 DKC each (total 1,500 DKC > 1,000 DKC)
      const promises = Array.from({ length: 5 }).map(() =>
        server.inject({
          method: 'POST',
          url: '/api/wallet/transfer',
          cookies: { dk_session: testSession, dk_csrf: testCsrf },
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': testCsrf },
          payload: {
            recipient: 'bob',
            amount: 300,
          },
        })
      );

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.statusCode === 200).length;
      const failCount = results.filter((r) => r.statusCode === 400).length;

      // With 1,000 DKC and 300 DKC per request, exactly 3 should succeed (900 DKC spent) and 2 should fail
      expect(successCount).toBe(3);
      expect(failCount).toBe(2);

      // Verify remaining balance in DB and core is exactly 100 DKC (10,000 minor) and never negative
      const dbBal = await pool.query('SELECT available FROM balances WHERE user_id = $1', [testUserId]);
      expect(Number(dbBal.rows[0].available)).toBe(10000);
      expect(core.getBalance(testUserId).available).toBe(10000);
    });
  });

  describe('3. Withdraw (DKC -> UPI) & Failure Refund', () => {
    it('rejects withdrawal with malformed UPI ID', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/withdraw',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          upiId: 'not-a-valid-vpa',
          amount: 50,
        },
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('INVALID_UPI_ID');
    });

    it('rejects withdrawal outside min/max limits', async () => {
      const resUnder = await server.inject({
        method: 'POST',
        url: '/api/wallet/withdraw',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          upiId: 'alice@okhdfcbank',
          amount: ECONOMY_CONFIG.MIN_WITHDRAWAL_DKC - 1,
        },
      });
      expect(resUnder.statusCode).toBe(400);

      const resOver = await server.inject({
        method: 'POST',
        url: '/api/wallet/withdraw',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          upiId: 'alice@okhdfcbank',
          amount: ECONOMY_CONFIG.MAX_WITHDRAWAL_DKC + 1,
        },
      });
      expect(resOver.statusCode).toBe(400);
    });

    it('seller Bob can withdraw earned DKC (from merch) to their UPI ID', async () => {
      const withdrawAmount = 400; // Bob earned 499 earlier
      const bobUpi = 'sellerbob@okaxis';

      const bobBefore = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: bobCookie },
      })).json().balance;

      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/withdraw',
        cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': bobCsrf },
        payload: {
          upiId: bobUpi,
          amount: withdrawAmount,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(true);
      expect(data.status).toBe('COMPLETED');
      expect(data.amountDKC).toBe(withdrawAmount);
      expect(data.amountINR).toBe(withdrawAmount * ECONOMY_CONFIG.INR_PER_DKC);
      expect(data.payoutRef).toBeDefined();

      // Bob's available should decrease by 400 DKC, pending withdrawals should be 0
      const bobAfter = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: bobCookie },
      })).json().balance;

      expect(bobAfter.available).toBe(bobBefore.available - withdrawAmount * 100);
      expect(bobAfter.pendingWithdrawals).toBe(0);

      // Verify DB record
      const dbWth = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [data.withdrawalId]);
      expect(dbWth.rows.length).toBe(1);
      expect(dbWth.rows[0].status).toBe('COMPLETED');
    });

    it('automatically refunds held DKC when payout provider fails', async () => {
      const withdrawAmount = 250;
      // Using 'fail' in UPI ID triggers simulated payout failure
      const failingUpi = 'failing_user@fail';

      const aliceBefore = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance;

      const res = await server.inject({
        method: 'POST',
        url: '/api/wallet/withdraw',
        cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
        payload: {
          upiId: failingUpi,
          amount: withdrawAmount,
        },
      });

      expect(res.statusCode).toBe(400); // Handled response returning failed status + refund details
      const data = JSON.parse(res.payload);
      expect(data.success).toBe(false);
      expect(data.status).toBe('FAILED');
      expect(data.refunded).toBe(true);
      expect(data.failureReason).toBeDefined();

      // Alice's balance must be fully refunded back to available
      const aliceAfter = (await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: aliceCookie },
      })).json().balance;

      expect(aliceAfter.available).toBe(aliceBefore.available);
      expect(aliceAfter.pendingWithdrawals).toBe(aliceBefore.pendingWithdrawals || 0);

      // Verify DB record status is FAILED
      const dbWth = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [data.withdrawalId]);
      expect(dbWth.rows[0].status).toBe('FAILED');
      expect(dbWth.rows[0].settle_journal_id).toBeDefined();

      // Verify refund journal zero-sum
      const postings = await pool.query(
        'SELECT account_id, unit, amount FROM postings WHERE journal_id = $1',
        [data.refundJournalId]
      );
      expect(postings.rows.length).toBe(2);
      const sum = postings.rows.reduce((acc, row) => acc + Number(row.amount), 0);
      expect(sum).toBe(0);
    });
  });

  describe('4. Reserve Backing & Transaction History Integrity', () => {
    it('verifies 100% full-reserve backing invariant via /api/admin/reserve-backing', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/admin/reserve-backing',
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.isSolvent).toBe(true);
      expect(data.status).toBe('100% FULL-RESERVE BACKED');
      expect(data.rate).toBe(ECONOMY_CONFIG.INR_PER_DKC);
      expect(data.totalCirculationDKC).toBeGreaterThan(0);
      expect(data.treasuryINR).toBeGreaterThanOrEqual(data.requiredTreasuryINR);
    });

    it('returns aggregated transaction history for user via /api/wallet/history', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/wallet/history',
        cookies: { dk_session: aliceCookie },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeGreaterThan(0);

      const kinds = data.items.map((it: any) => it.type);
      expect(kinds).toContain('DEPOSIT');
      expect(kinds).toContain('TRANSFER');
    });
  });
});
