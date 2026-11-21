/**
 * @file deal-lifecycle.test.ts
 * Comprehensive test suite for P2P Transaction Lifecycle, Escrow Custody,
 * Mutual Meetup Coordination State Machine, Handover/Receipt Confirmation,
 * 1% Cancellation Penalty Engine, and Wallet History.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { FastifyInstance } from 'fastify';
import { setupTestDatabase } from './setup.js';
import { buildServer } from '../src/server.js';

describe('P2P Deal Lifecycle & Escrow Suite', () => {
  let pool: pg.Pool;
  let server: FastifyInstance;
  let core: any;

  let aliceCookie: string;
  let aliceCsrf: string;
  let bobCookie: string;
  let bobCsrf: string;
  let adminCookie: string;
  let adminCsrf: string;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    const bootstrapped = await buildServer(pool);
    server = bootstrapped.server;
    core = bootstrapped.core;
    await server.ready();

    // 1. Log in Alice (Seller - holds FEST-GA)
    const aliceLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: 'alice', password: 'demo_darkhold_2026' },
    });
    expect(aliceLogin.statusCode).toBe(200);
    aliceCookie = aliceLogin.cookies.find((c) => c.name === 'dk_session')!.value;
    aliceCsrf = aliceLogin.cookies.find((c) => c.name === 'dk_csrf')!.value;

    // 2. Log in Bob (Buyer - holds ample DKC cash)
    const bobLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: 'bob', password: 'demo_darkhold_2026' },
    });
    expect(bobLogin.statusCode).toBe(200);
    bobCookie = bobLogin.cookies.find((c) => c.name === 'dk_session')!.value;
    bobCsrf = bobLogin.cookies.find((c) => c.name === 'dk_csrf')!.value;

    // 3. Log in Admin
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      payload: { username: 'admin', password: 'admin_darkhold_2026' },
    });
    expect(adminLogin.statusCode).toBe(200);
    adminCookie = adminLogin.cookies.find((c) => c.name === 'dk_session')!.value;
    adminCsrf = adminLogin.cookies.find((c) => c.name === 'dk_csrf')!.value;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  it('1. Matching FEST-GA creates deal in escrow custody (MATCHED_PENDING_HANDOVER)', async () => {
    // Alice submits resting SELL order for 1x FEST-GA @ 1500.00 DKC (150,000 paise)
    const sellRes = await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'Content-Type': 'application/json',
        'x-bench-bypass': 'true',
        'x-csrf-token': aliceCsrf,
      },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: {
        symbol: 'FEST-GA',
        side: 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 1,
        clientOrderId: `test_sell_${Date.now()}`,
      },
    });
    expect(sellRes.statusCode).toBe(200);
    const sellData = JSON.parse(sellRes.payload);
    expect(sellData.success).toBe(true);

    // Bob submits crossing BUY order for 1x FEST-GA @ 1500.00 DKC
    const buyRes = await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'Content-Type': 'application/json',
        'x-bench-bypass': 'true',
        'x-csrf-token': bobCsrf,
      },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: {
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 1,
        clientOrderId: `test_buy_${Date.now()}`,
      },
    });
    expect(buyRes.statusCode).toBe(200);
    const buyData = JSON.parse(buyRes.payload);
    expect(buyData.success).toBe(true);
    expect(buyData.trades.length).toBeGreaterThan(0);

    // Check Alice active deals
    const aliceDealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    expect(aliceDealsRes.statusCode).toBe(200);
    const aliceDeals = JSON.parse(aliceDealsRes.payload);
    expect(aliceDeals.length).toBeGreaterThan(0);
    const deal = aliceDeals[0];
    expect(deal.symbol).toBe('FEST-GA');
    expect(deal.status).toBe('MATCHED_PENDING_HANDOVER');
    expect(Number(deal.amount)).toBe(150000);
    expect(Number(deal.price)).toBe(150000);
    expect(Number(deal.qty)).toBe(1);

    // Check Bob active deals
    const bobDealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });
    expect(bobDealsRes.statusCode).toBe(200);
    const bobDeals = JSON.parse(bobDealsRes.payload);
    expect(bobDeals.length).toBeGreaterThan(0);
    expect(bobDeals[0].id).toBe(deal.id);
  });

  it('2. Meetup coordination state machine (PROPOSE -> CONFIRM -> MEETUP_SCHEDULED)', async () => {
    // Get the active deal
    const dealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    const deal = JSON.parse(dealsRes.payload)[0];

    // Alice proposes meetup
    const proposeRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/propose-meetup`,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': aliceCsrf,
      },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: {
        date: '2026-11-05',
        time: '17:30',
        location: 'Student Activity Center - North Gate',
        instructions: 'Will be wearing black Darkhold jacket',
      },
    });
    expect(proposeRes.statusCode).toBe(200);
    const proposed = JSON.parse(proposeRes.payload);
    expect(proposed.deal.status).toBe('AWAITING_MEETUP_CONFIRMATION');
    expect(proposed.deal.meetupLocation).toBe('Student Activity Center - North Gate');
    expect(proposed.deal.buyerConfirmedMeetup).toBe(false);
    expect(proposed.deal.sellerConfirmedMeetup).toBe(true);

    // Bob confirms meetup
    const confirmRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/confirm-meetup`,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': bobCsrf,
      },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = JSON.parse(confirmRes.payload);
    expect(confirmed.deal.status).toBe('MEETUP_SCHEDULED');
    expect(confirmed.deal.buyerConfirmedMeetup).toBe(true);
    expect(confirmed.deal.sellerConfirmedMeetup).toBe(true);
    expect(confirmed.deal.meetupConfirmedAt).toBeDefined();
  });

  it('3. In-person handover and buyer receipt confirmation atomically settles funds & item', async () => {
    // Get the active deal
    const dealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    const deal = JSON.parse(dealsRes.payload)[0];
    expect(deal.status).toBe('MEETUP_SCHEDULED');

    // 1. Seller Alice marks item handed over
    const handoverRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/handover`,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': aliceCsrf,
      },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    expect(handoverRes.statusCode).toBe(200);
    const handoverData = JSON.parse(handoverRes.payload);
    expect(handoverData.deal.status).toBe('AWAITING_BUYER_CONFIRMATION');

    // Check balances before confirmation
    const aliceBalBefore = { ...core.getReconciledBalance('usr_alice') };
    const bobBalBefore = { ...core.getReconciledBalance('usr_bob') };
    const bobHoldBefore = core.getHolding('usr_bob', 'FEST-GA').available;

    // 2. Buyer Bob inspects and confirms receipt
    const receiptRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/confirm-receipt`,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': bobCsrf,
      },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });
    expect(receiptRes.statusCode).toBe(200);
    const receiptData = JSON.parse(receiptRes.payload);
    expect(receiptData.deal.status).toBe('COMPLETED');

    // Check balances after settlement
    const aliceBalAfter = core.getReconciledBalance('usr_alice');
    const bobBalAfter = core.getReconciledBalance('usr_bob');
    const bobHoldAfter = core.getHolding('usr_bob', 'FEST-GA').available;

    // Bob escrow decreased by 150000
    expect(bobBalBefore.escrow - bobBalAfter.escrow).toBe(150000);
    // Alice available increased by 150000
    expect(aliceBalAfter.available - aliceBalBefore.available).toBe(150000);
    // Bob available holding increased by 1 unit
    expect(bobHoldAfter - bobHoldBefore).toBe(1);

    // Active deals should now be empty for this deal
    const activeDealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    const activeDeals = JSON.parse(activeDealsRes.payload);
    expect(activeDeals.find((d: any) => d.id === deal.id)).toBeUndefined();

    // Deal should appear in history
    const historyDealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/history',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    const historyDeals = JSON.parse(historyDealsRes.payload);
    expect(historyDeals.find((d: any) => d.id === deal.id)).toBeDefined();
  });

  it('4. Buyer cancellation AFTER meetup confirmed charges 1% penalty and credits seller', async () => {
    // Alice sells another FEST-GA @ 1600.00 DKC (within collar ceiling 1650.00 DKC), Bob buys
    const sellRes = await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'Content-Type': 'application/json',
        'x-bench-bypass': 'true',
        'x-csrf-token': aliceCsrf,
      },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: {
        symbol: 'FEST-GA',
        side: 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price: 160000, // 1600.00 DKC
        qty: 1,
        clientOrderId: `penalty_sell_${Date.now()}`,
      },
    });
    expect(sellRes.statusCode).toBe(200);

    const buyRes = await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'Content-Type': 'application/json',
        'x-bench-bypass': 'true',
        'x-csrf-token': bobCsrf,
      },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: {
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 160000,
        qty: 1,
        clientOrderId: `penalty_buy_${Date.now()}`,
      },
    });
    expect(buyRes.statusCode).toBe(200);

    // Find the new active deal
    const dealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });
    const deal = JSON.parse(dealsRes.payload).find((d: any) => Number(d.amount) === 160000);
    expect(deal).toBeDefined();

    // Mutual meetup confirmation
    await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/propose-meetup`,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: { date: '2026-11-06', time: '14:00', location: 'Main Quad', instructions: 'Library steps' },
    });

    await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/confirm-meetup`,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': bobCsrf },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });

    const bobBalBefore = { ...core.getReconciledBalance('usr_bob') };
    const aliceBalBefore = { ...core.getReconciledBalance('usr_alice') };

    // Bob (buyer) cancels AFTER meetup confirmed
    const cancelRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/cancel`,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': bobCsrf },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: { reason: 'Cannot make it to campus' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelData = JSON.parse(cancelRes.payload);
    expect(cancelData.deal.status).toBe('CANCELLED_BY_BUYER');

    // 1% of 160000 = 1600 DKC (paise)
    // Refund = 158400 DKC (99%)
    // Compensation = 1600 DKC (1%)
    expect(Number(cancelData.deal.cancellationCharge)).toBe(1600);
    expect(Number(cancelData.deal.buyerRefundAmount)).toBe(158400);
    expect(Number(cancelData.deal.sellerCompensationAmount)).toBe(1600);

    const bobBalAfter = core.getReconciledBalance('usr_bob');
    const aliceBalAfter = core.getReconciledBalance('usr_alice');

    // Bob available refunded 158400
    expect(bobBalAfter.available - bobBalBefore.available).toBe(158400);
    // Bob escrow decreased by 160000
    expect(bobBalBefore.escrow - bobBalAfter.escrow).toBe(160000);
    // Alice compensated 1600 DKC available cash
    expect(aliceBalAfter.available - aliceBalBefore.available).toBe(1600);
  });

  it('5. Buyer cancellation BEFORE meetup confirmed results in 100% refund (0 fee)', async () => {
    // Alice sells, Bob buys
    await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'Content-Type': 'application/json', 'x-bench-bypass': 'true', 'x-csrf-token': aliceCsrf },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: { symbol: 'FEST-GA', side: 'SELL', type: 'LIMIT', tif: 'GTC', price: 150000, qty: 1, clientOrderId: `refund_sell_${Date.now()}` },
    });
    await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'Content-Type': 'application/json', 'x-bench-bypass': 'true', 'x-csrf-token': bobCsrf },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: { symbol: 'FEST-GA', side: 'BUY', type: 'LIMIT', tif: 'GTC', price: 150000, qty: 1, clientOrderId: `refund_buy_${Date.now()}` },
    });

    const dealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
    });
    const deal = JSON.parse(dealsRes.payload).find((d: any) => d.status === 'MATCHED_PENDING_HANDOVER');
    expect(deal).toBeDefined();

    const bobBalBefore = { ...core.getReconciledBalance('usr_bob') };

    // Cancel BEFORE meetup confirmed
    const cancelRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/cancel`,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': bobCsrf },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: { reason: 'Found a friend pass' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelData = JSON.parse(cancelRes.payload);

    // 100% refund
    expect(Number(cancelData.deal.cancellationCharge)).toBe(0);
    expect(Number(cancelData.deal.buyerRefundAmount)).toBe(150000);
    expect(Number(cancelData.deal.sellerCompensationAmount)).toBe(0);

    const bobBalAfter = core.getReconciledBalance('usr_bob');
    expect(bobBalAfter.available - bobBalBefore.available).toBe(150000);
  });

  it('6. Seller cancellation results in 100% refund to buyer with 0 penalty', async () => {
    // Alice sells, Bob buys
    await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'Content-Type': 'application/json', 'x-bench-bypass': 'true', 'x-csrf-token': aliceCsrf },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: { symbol: 'FEST-GA', side: 'SELL', type: 'LIMIT', tif: 'GTC', price: 150000, qty: 1, clientOrderId: `seller_cancel_${Date.now()}` },
    });
    await server.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'Content-Type': 'application/json', 'x-bench-bypass': 'true', 'x-csrf-token': bobCsrf },
      cookies: { dk_session: bobCookie, dk_csrf: bobCsrf },
      payload: { symbol: 'FEST-GA', side: 'BUY', type: 'LIMIT', tif: 'GTC', price: 150000, qty: 1, clientOrderId: `seller_buy_${Date.now()}` },
    });

    const dealsRes = await server.inject({
      method: 'GET',
      url: '/api/deals/active',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    const deal = JSON.parse(dealsRes.payload).find((d: any) => d.status === 'MATCHED_PENDING_HANDOVER');
    expect(deal).toBeDefined();

    const bobBalBefore = { ...core.getReconciledBalance('usr_bob') };

    // Alice (seller) cancels
    const cancelRes = await server.inject({
      method: 'POST',
      url: `/api/deals/${deal.id}/cancel`,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': aliceCsrf },
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
      payload: { reason: 'Misplaced physical wristband' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelData = JSON.parse(cancelRes.payload);
    expect(cancelData.deal.status).toBe('CANCELLED_BY_SELLER');
    expect(Number(cancelData.deal.buyerRefundAmount)).toBe(150000);
    expect(Number(cancelData.deal.cancellationCharge)).toBe(0);

    const bobBalAfter = core.getReconciledBalance('usr_bob');
    expect(bobBalAfter.available - bobBalBefore.available).toBe(150000);
  });

  it('7. UPI Wallet history displays active escrow holds, completed deals, compensation, and penalties', async () => {
    const historyRes = await server.inject({
      method: 'GET',
      url: '/api/wallet/history',
      cookies: { dk_session: aliceCookie, dk_csrf: aliceCsrf },
    });
    expect(historyRes.statusCode).toBe(200);
    const historyData = JSON.parse(historyRes.payload);
    expect(Array.isArray(historyData.items)).toBe(true);

    // Alice should have SELLER_COMPENSATION or COMPLETED deal entries in wallet history
    const types = historyData.items.map((i: any) => i.type);
    expect(types.some((t: string) => t === 'DEAL_ESCROW_SETTLEMENT' || t === 'SELLER_COMPENSATION' || t === 'TRADE' || t === 'COMPENSATION')).toBe(true);
  });
});
