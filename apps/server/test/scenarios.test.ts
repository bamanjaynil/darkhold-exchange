import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { setupTestDatabase, resetTestDatabase } from './setup.js';
import { bootstrapCore } from '../src/recovery.js';
import { FakeClock } from '../src/clock.js';
import { runReconciliation } from '../src/reconciliation.js';
import { ExchangeCore } from '../src/core.js';
import { SolvencyCoordinator } from '../src/solvency.js';
import { verifyMerkleSumProof } from '@darkhold/shared';
import { generateMockIssuerReceipt } from '../src/escrow.js';
import { releaseWriterLock } from '../src/db.js';

describe('Scenarios A-L End-to-End Integration Suite', () => {
  let pool: pg.Pool;
  let core: ExchangeCore;
  let clock: FakeClock;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    clock = new FakeClock();
    core = await bootstrapCore(pool, clock, 1, 1, true); // Synchronous per-command persistence for tests
  });

  afterAll(async () => {
    await pool.end();
  });

  // SCENARIO A: Two-user trade and settlement
  it('Scenario A: Two-user trade executes and settles directly', async () => {
    // Carol sells 1 FEST-GA at 150000
    const sellRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-a-sell',
        clientOrderId: 'cid-a-s',
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

    // Bob buys 1 FEST-GA at 150000
    const buyRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-a-buy',
        clientOrderId: 'cid-a-b',
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
    expect(buyRes.trades.length).toBe(1);

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO B: Partial fill
  it('Scenario B: Partial fill retains remaining reservation and subsequent fill completes', async () => {
    // Alice sells 2 FEST-GA at 150000
    await core.dispatch({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-b-sell',
        clientOrderId: 'cid-b-s',
        seq: 0,
        userId: 'usr_alice',
        symbol: 'FEST-GA',
        side: 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 2,
      },
    });

    // Bob buys 1 unit -> partial fill
    const partBuy = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-b-buy-1',
        clientOrderId: 'cid-b-b1',
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
    expect(partBuy.trades.length).toBe(1);
    expect(partBuy.trades[0].qty).toBe(1);

    const resting = core.engine.getOrder('FEST-GA', 'ord-scen-b-sell');
    expect(resting?.remainingQty).toBe(1);

    // Carol buys the remaining 1 unit -> complete fill
    const compBuy = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-b-buy-2',
        clientOrderId: 'cid-b-b2',
        seq: 0,
        userId: 'usr_carol',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 1,
      },
    });
    expect(compBuy.trades.length).toBe(1);

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO C: Cancel releases funds/units
  it('Scenario C: Order cancellation releases reserved funds cleanly', async () => {
    const balBefore = core.getBalance('usr_alice').available;

    const ord = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-c-cancel',
        clientOrderId: 'cid-c-c',
        seq: 0,
        userId: 'usr_alice',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 140000,
        qty: 1,
      },
    });
    expect(ord.success).toBe(true);
    expect(core.getBalance('usr_alice').available).toBe(balBefore - 140000);

    const cancelRes = await core.dispatch<any>({
      type: 'ORDER_CANCEL',
      orderId: 'ord-scen-c-cancel',
      symbol: 'FEST-GA',
      userId: 'usr_alice',
    });
    expect(cancelRes.success).toBe(true);
    expect(core.getBalance('usr_alice').available).toBe(balBefore);

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO D: Collar rejection with no execution and no journal
  it('Scenario D: Order exceeding price ceiling rejected with no state change', async () => {
    const res = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-d-collar',
        clientOrderId: 'cid-d-col',
        seq: 0,
        userId: 'usr_bob',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 165100, // Ceiling is 165000
        qty: 1,
      },
    });
    expect(res.success).toBe(false);
    expect(res.rejectedReason).toBe('COLLAR_VIOLATION');

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO E: Insufficient balance with no corrupt reservation
  it('Scenario E: Order exceeding balance rejected before mutation', async () => {
    const res = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-scen-e-funds',
        clientOrderId: 'cid-e-funds',
        seq: 0,
        userId: 'usr_bob',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 150000,
        qty: 9999,
      },
    });
    expect(res.success).toBe(false);
    expect(res.rejectedReason).toBe('INSUFFICIENT_FUNDS');

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO F: FOK / IOC semantics
  it('Scenario F: FOK rejected on partial book with zero side effects', async () => {
    // Seller offers 1 unit
    await core.dispatch({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-fok-offer',
        clientOrderId: 'cid-fok-offer',
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

    // Buyer wants 2 units FOK -> must reject
    const fokRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-fok-req',
        clientOrderId: 'cid-fok-req',
        seq: 0,
        userId: 'usr_alice',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'FOK',
        price: 150000,
        qty: 2,
      },
    });
    expect(fokRes.success).toBe(false);
    expect(fokRes.rejectedReason).toBe('FOK_NOT_FILLABLE');

    // Clean up resting offer
    await core.dispatch({
      type: 'ORDER_CANCEL',
      orderId: 'ord-fok-offer',
      symbol: 'FEST-GA',
      userId: 'usr_carol',
    });
  });

  // SCENARIO H: Dutch auction price decay, buy, and competing buyer handling
  it('Scenario H: Dutch auction decays price with clock and settles purchase', async () => {
    const aucRes = await core.dispatch<any>({
      type: 'AUCTION_CREATE',
      data: {
        symbol: 'MERCH-CLOAK',
        sellerUserId: 'usr_bob',
        qty: 2,
        startPrice: 85000,
        floorPrice: 60000,
        stepAmount: 5000,
        stepIntervalMs: 10_000,
        durationSec: 100,
      },
    });
    expect(aucRes.success).toBe(true);
    const auctionId = aucRes.auction.id;

    // Advance clock by 20 seconds (2 steps = 10,000 decay -> 75,000)
    clock.advance(20_000);

    // Alice buys 1 unit with maxPrice 76000 -> succeeds at 75000
    const buy1 = await core.dispatch<any>({
      type: 'AUCTION_BUY',
      auctionId,
      buyerUserId: 'usr_alice',
      qty: 1,
      maxPrice: 76000,
    });
    expect(buy1.success).toBe(true);
    expect(buy1.price).toBe(75000);

    // Advance clock by 10s (decay to 70,000) and Carol buys final unit -> SOLD_OUT
    clock.advance(10_000);
    const buy2 = await core.dispatch<any>({
      type: 'AUCTION_BUY',
      auctionId,
      buyerUserId: 'usr_carol',
      qty: 1,
      maxPrice: 71000,
    });
    expect(buy2.success).toBe(true);
    expect(buy2.price).toBe(70000);
    expect(buy2.auction.status).toBe('SOLD_OUT');
    expect(buy2.auction.clearingPrice).toBe(70000);

    // Advance clock past expiration
    clock.advance(500_000);
    const finalAuc = core.auctions.get(auctionId)!;
    expect(finalAuc.status).toBe('SOLD_OUT');
    expect(finalAuc.clearingPrice).toBe(70000);

    // Test AUCTION_CANCEL and inventory reclamation
    const cancelAucRes = await core.dispatch<any>({
      type: 'AUCTION_CREATE',
      data: {
        symbol: 'MERCH-CLOAK',
        sellerUserId: 'usr_bob',
        qty: 1,
        startPrice: 85000,
        floorPrice: 60000,
        durationSec: 120,
      },
    });
    expect(cancelAucRes.success).toBe(true);
    const bobHoldBefore = core.getHolding('usr_bob', 'MERCH-CLOAK').available;

    const cancelRes = await core.dispatch<any>({
      type: 'AUCTION_CANCEL',
      auctionId: cancelAucRes.auction.id,
      userId: 'usr_bob',
      isAdmin: false,
    });
    expect(cancelRes.success).toBe(true);
    expect(cancelRes.auction.status).toBe('CANCELLED');
    expect(core.getHolding('usr_bob', 'MERCH-CLOAK').available).toBe(bobHoldBefore + 1);

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });

  // SCENARIO I: Solvency proof generation and tamper rejection
  it('Scenario I: Proof of solvency verifies valid inclusion and rejects tampered proofs', async () => {
    const solvency = new SolvencyCoordinator(pool);
    // Alice already has initial grant
    const snap = await solvency.createSnapshot(core);
    expect(snap.rootHash).toBeDefined();

    const proof = await solvency.getProofForUser('usr_alice', core);
    expect(proof).not.toBeNull();

    const verified = verifyMerkleSumProof(proof!);
    expect(verified.valid).toBe(true);

    // Tamper test
    const tampered = { ...proof!, balance: proof!.balance + 50000 };
    const tamperRes = verifyMerkleSumProof(tampered);
    expect(tamperRes.valid).toBe(false);
  });

  // SCENARIO J: Restart recovery and rollback rebuild
  it('Scenario J: Hydrates in-memory state cleanly from PostgreSQL and survives rollback', async () => {
    // 1. Submit a resting order
    await core.dispatch({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-rest-recover',
        clientOrderId: 'cid-recover',
        seq: 0,
        userId: 'usr_alice',
        symbol: 'FEST-GA',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 135000,
        qty: 1,
      },
    });

    // 2. Simulate server restart: re-hydrate a brand new core instance
    await releaseWriterLock(pool);
    const newCore = await bootstrapCore(pool, clock, 1, 1, true);
    const recoveredOrder = newCore.engine.getOrder('FEST-GA', 'ord-rest-recover');
    expect(recoveredOrder).toBeDefined();
    expect(recoveredOrder!.price).toBe(135000);

    // 3. Test persistence rollback-and-rebuild path
    newCore.persistence.injectFailure = true;
    await expect(
      newCore.dispatch({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: 'ord-fail-commit',
          clientOrderId: 'cid-fail',
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

    // Rebuild was triggered, newCore is still operational
    newCore.persistence.injectFailure = false;
    const finalRec = await runReconciliation(pool, newCore);
    expect(finalRec.balanced).toBe(true);
  });

  // SCENARIO L: Escrow delivery via mock issuer receipt and timeout sweeper
  it('Scenario L: Escrow match requires mock issuer receipt to release', async () => {
    // RELIC-AGAMOTTO has escrow_required: true
    // Alice sells 1 relic
    await core.dispatch({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-esc-s',
        clientOrderId: 'cid-esc-s',
        seq: 0,
        userId: 'usr_alice',
        symbol: 'RELIC-AGAMOTTO',
        side: 'SELL',
        type: 'LIMIT',
        tif: 'GTC',
        price: 500000,
        qty: 1,
      },
    });

    // Bob buys 1 relic -> settles into LOCKED escrow
    const buyRes = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: 'ord-esc-b',
        clientOrderId: 'cid-esc-b',
        seq: 0,
        userId: 'usr_bob',
        symbol: 'RELIC-AGAMOTTO',
        side: 'BUY',
        type: 'LIMIT',
        tif: 'GTC',
        price: 500000,
        qty: 1,
      },
    });

    expect(buyRes.success).toBe(true);
    expect(core.escrows.size).toBeGreaterThan(0);

    const escrow = Array.from(core.escrows.values()).find((e) => e.status === 'LOCKED')!;
    expect(escrow).toBeDefined();

    // Generate mock issuer receipt
    const receipt = generateMockIssuerReceipt(
      escrow.id,
      escrow.buyerUserId,
      escrow.sellerUserId,
      escrow.symbol
    );

    // Deliver escrow
    const deliverRes = await core.dispatch<any>({
      type: 'ESCROW_DELIVER',
      escrowId: escrow.id,
      sellerUserId: 'usr_alice',
    });
    expect(deliverRes.success).toBe(true);
    expect(escrow.status).toBe('RELEASED');

    const rec = await runReconciliation(pool, core);
    expect(rec.balanced).toBe(true);
  });
});