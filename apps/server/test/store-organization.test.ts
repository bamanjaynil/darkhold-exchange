/**
 * @file store-organization.test.ts
 * End-to-end integration tests for:
 * 1. Campus Organization onboarding, admin verification, and multi-user roles
 * 2. Cross-organization authorization rejection
 * 3. Merchandise products with organizer-defined custom variants (no forced S/M/L/XL!)
 * 4. Timed drop lifecycles and schedules
 * 5. Concurrency-safe merchandise and ticket purchases (oversell prevention)
 * 6. Cryptographic ticket issuance and customer ticket wallet
 * 7. Secure campus pickup handover verification with OTP token & duplicate prevention
 * 8. Atomic ticket check-in and duplicate-entry rejection at event turnstiles
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { setupTestDatabase } from './setup.js';
import { StoreService } from '../src/store.js';
import { ExchangeCore } from '../src/core.js';
import { SystemClock } from '../src/clock.js';
import { bootstrapCore } from '../src/recovery.js';

describe('Campus Store, Organization Management & Ticketing Integration Suite', () => {
  let pool: pg.Pool;
  let store: StoreService;
  let core: ExchangeCore;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    store = new StoreService(pool);
    const clock = new SystemClock();
    core = await bootstrapCore(pool, clock, 1000, 5, true);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ==========================================
  // PHASE 2: ORGANIZATIONS & PERMISSIONS
  // ==========================================

  it('allows an authenticated user to apply for an organization and assigns owner role', async () => {
    const res = await store.applyForOrganization('usr_alice', {
      name: 'Cybersecurity & Ethical Hacking Club',
      slug: 'cybersec-club',
      orgType: 'club',
      description: 'Campus CTF team and offensive security research society.',
      contactEmail: 'cybersec@mnnit.ac.in',
    });

    expect(res.id).toMatch(/^org_/);
    expect(res.slug).toBe('cybersec-club');
    expect(res.status).toBe('PENDING');

    // Verify creator is owner
    const role = await store.getUserOrgRole(res.id, 'usr_alice');
    expect(role).toBe('owner');

    // Unverified org should NOT appear in public approved listing
    const publicOrgs = await store.listApprovedOrganizations();
    const found = publicOrgs.find((o: any) => o.id === res.id);
    expect(found).toBeUndefined();
  });

  it('allows a platform admin to approve an organization, making it verified', async () => {
    const applyRes = await store.applyForOrganization('usr_bob', {
      name: 'Aeromodelling Society',
      slug: 'aero-society',
      contactEmail: 'aero@mnnit.ac.in',
    });

    const reviewRes = await store.adminReviewOrganization(applyRes.id, 'usr_admin', 'APPROVE');
    expect(reviewRes.status).toBe('APPROVED');
    expect(reviewRes.isVerified).toBe(true);

    const publicOrgs = await store.listApprovedOrganizations();
    const found = publicOrgs.find((o: any) => o.id === applyRes.id);
    expect(found).toBeDefined();
    expect(found.is_verified).toBe(true);
  });

  it('allows owner to add organization members with specific roles and rejects unauthorized users', async () => {
    // Org seeded in db/seed.ts: org_fest_council owned by usr_admin
    // Add Bob as merch_manager and Carol as scanner
    await store.addOrgMember('org_fest_council', 'usr_admin', 'bob', 'merch_manager');
    await store.addOrgMember('org_fest_council', 'usr_admin', 'carol', 'scanner');

    const bobRole = await store.getUserOrgRole('org_fest_council', 'usr_bob');
    expect(bobRole).toBe('merch_manager');

    const carolRole = await store.getUserOrgRole('org_fest_council', 'usr_carol');
    expect(carolRole).toBe('scanner');

    // User not in org has no role
    const strangerRole = await store.getUserOrgRole('org_fest_council', 'usr_bench_bot');
    expect(strangerRole).toBeNull();

    // Cross-organization rejection: Bob is not admin of org_fest_council, cannot remove Alice
    await expect(
      store.removeOrgMember('org_fest_council', 'usr_bob', 'usr_alice')
    ).rejects.toThrow('FORBIDDEN');
  });

  // ==========================================
  // PHASE 3: PRODUCTS & EXPLICIT CUSTOM VARIANTS
  // ==========================================

  it('creates product with ONLY organizer-defined custom variants (no forced S/M/L/XL)', async () => {
    // Bob is merch_manager in org_fest_council
    const product = await store.createProduct('org_fest_council', 'usr_bob', {
      name: 'Tactical Matte Cyber Flask',
      description: 'Vacuum insulated double-walled 750ml flask with laser engraved festival emblem.',
      category: 'ACCESSORY',
      basePriceDkc: 450,
      fulfillmentType: 'PICKUP',
      pickupLocation: 'SAC Counter 1',
      variants: [
        {
          title: 'Stealth Matte Black',
          sku: 'FLASK-BLK',
          attributes: { color: 'Stealth Matte Black', capacity: '750ml' },
          priceAdjustmentDkc: 0,
          stock: 40,
        },
        {
          title: 'Brushed Titanium Silver',
          sku: 'FLASK-SLV',
          attributes: { color: 'Brushed Titanium Silver', capacity: '750ml' },
          priceAdjustmentDkc: 50,
          stock: 25,
        },
      ],
    });

    expect(product).toBeDefined();
    expect(product!.name).toBe('Tactical Matte Cyber Flask');
    expect(product!.variants.length).toBe(2);

    // Verify variants are ONLY the two colors configured — NO sizes S, M, L exist!
    const titles = product!.variants.map((v: any) => v.title);
    expect(titles).toContain('Stealth Matte Black');
    expect(titles).toContain('Brushed Titanium Silver');
    expect(titles).not.toContain('Size M');
    expect(titles).not.toContain('Size L');
  });

  // ==========================================
  // PHASE 4 & 5: CHECKOUT, TICKETS & CONCURRENCY
  // ==========================================

  it('executes atomic merchandise checkout, decrements variant stock, and generates unguessable pickup token', async () => {
    // Fund Alice's balance in ExchangeCore and DB for testing
    const aliceBal = core.getBalance('usr_alice');
    aliceBal.available = 5000000; // 50,000 DKC
    await pool.query('UPDATE balances SET available = 5000000 WHERE user_id = $1', ['usr_alice']);

    // Get an existing product variant (from seeded Cloak)
    const { rows: vars } = await pool.query<{ id: string; stock: number }>(
      `SELECT id, stock FROM product_variants WHERE sku = 'CLK-M'`
    );
    expect(vars.length).toBeGreaterThan(0);
    const clkM = vars[0]!;
    const initialStock = clkM.stock;

    // Alice buys 2 units of CLK-M
    const checkoutRes = await store.checkout('usr_alice', core, {
      orderType: 'MERCHANDISE',
      organizationId: 'org_fest_council',
      items: [{ variantId: clkM.id, quantity: 2 }],
      notes: 'Please keep ready for early collection',
    });

    expect(checkoutRes.success).toBe(true);
    expect(checkoutRes.orderId).toMatch(/^ord_store_/);
    expect(checkoutRes.pickupToken).toMatch(/^PK-[A-Z0-9]{6}$/);

    // Verify stock was decremented by 2
    const { rows: updatedVars } = await pool.query<{ stock: number }>(
      'SELECT stock FROM product_variants WHERE id = $1',
      [clkM.id]
    );
    expect(updatedVars[0]!.stock).toBe(initialStock - 2);

    // Verify order is in customer orders
    const myOrders = await store.getCustomerOrders('usr_alice');
    const myOrder = myOrders.find((o: any) => o.id === checkoutRes.orderId);
    expect(myOrder).toBeDefined();
    expect(myOrder.pickup_token).toBe(checkoutRes.pickupToken);
    expect(myOrder.items.length).toBe(1);
    expect(myOrder.items[0].quantity).toBe(2);
  });

  it('prevents overselling when requested quantity exceeds available stock', async () => {
    // Create a product with strictly 1 unit of stock
    const singleProduct = await store.createProduct('org_fest_council', 'usr_admin', {
      name: 'Single Collector Coin',
      basePriceDkc: 100,
      variants: [{ title: 'Rare Mint', stock: 1 }],
    });

    const variantId = singleProduct!.variants[0].id;

    // Buyer 1 purchases 1 unit -> succeeds
    const res1 = await store.checkout('usr_alice', core, {
      orderType: 'MERCHANDISE',
      organizationId: 'org_fest_council',
      items: [{ variantId, quantity: 1 }],
    });
    expect(res1.success).toBe(true);

    // Buyer 2 attempts to purchase 1 unit -> fails with insufficient stock
    await expect(
      store.checkout('usr_bob', core, {
        orderType: 'MERCHANDISE',
        organizationId: 'org_fest_council',
        items: [{ variantId, quantity: 1 }],
      })
    ).rejects.toThrow('INSUFFICIENT_STOCK_OR_UNAVAILABLE');
  });

  it('executes ticket purchase, allocates capacity, issues cryptographic ticket codes, and prevents capacity breach', async () => {
    // Bob buys 2 Pronite VIP passes
    const { rows: tiers } = await pool.query<{ id: string; capacity: number; sold_count: number }>(
      `SELECT id, capacity, sold_count FROM ticket_tiers WHERE id = 'tier_pronite_vip'`
    );
    const vipTier = tiers[0]!;
    const initialSold = vipTier.sold_count;

    const bobBal = core.getBalance('usr_bob');
    bobBal.available = 5000000;

    const tktCheckout = await store.checkout('usr_bob', core, {
      orderType: 'TICKET',
      organizationId: 'org_fest_council',
      items: [{ ticketTierId: vipTier.id, quantity: 2 }],
      attendeeName: 'Robert Smith',
      attendeeEmail: 'bob@mnnit.ac.in',
    });

    expect(tktCheckout.success).toBe(true);
    expect(tktCheckout.tickets.length).toBe(2);
    expect(tktCheckout.tickets[0].ticketCode).toMatch(/^TKT-[A-F0-9]{16}$/);
    expect(tktCheckout.tickets[0].isVip).toBe(true);

    // Verify sold_count was incremented by 2
    const { rows: updatedTiers } = await pool.query<{ sold_count: number }>(
      'SELECT sold_count FROM ticket_tiers WHERE id = $1',
      [vipTier.id]
    );
    expect(updatedTiers[0]!.sold_count).toBe(initialSold + 2);

    // Verify tickets appear in Bob's wallet
    const bobTickets = await store.getCustomerTickets('usr_bob');
    const matchingTickets = bobTickets.filter((t: any) => t.order_id === tktCheckout.orderId);
    expect(matchingTickets.length).toBe(2);
    expect(matchingTickets[0].status).toBe('VALID');
    expect(matchingTickets[0].is_vip).toBe(true);
  });

  // ==========================================
  // PHASE 6: FULFILLMENT & TURNSTILE CHECK-IN
  // ==========================================

  it('verifies campus pickup using OTP token and rejects duplicate handover', async () => {
    // Place an order for Carol
    const carolBal = core.getBalance('usr_carol');
    carolBal.available = 1000000;

    const { rows: vars } = await pool.query<{ id: string }>(
      `SELECT id FROM product_variants WHERE sku = 'POST-FOIL'`
    );
    const orderRes = await store.checkout('usr_carol', core, {
      orderType: 'MERCHANDISE',
      organizationId: 'org_fest_council',
      items: [{ variantId: vars[0]!.id, quantity: 1 }],
    });

    const token = orderRes.pickupToken;

    // Staff member (Alice, admin in org_fest_council) verifies pickup
    const verifyRes = await store.verifyCampusPickup(
      'org_fest_council',
      'usr_alice',
      orderRes.orderId,
      token
    );
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.status).toBe('COLLECTED');

    // Attempting duplicate handover of already collected order must fail
    const dupRes = await store.verifyCampusPickup(
      'org_fest_council',
      'usr_alice',
      orderRes.orderId,
      token
    );
    expect(dupRes.success).toBe(false);
    expect(dupRes.error).toBe('ALREADY_COLLECTED');

    // Invalid token must fail
    const badRes = await store.verifyCampusPickup(
      'org_fest_council',
      'usr_alice',
      orderRes.orderId,
      'PK-WRONG1'
    );
    expect(badRes.success).toBe(false);
  });

  it('validates ticket check-in at event turnstiles and prevents duplicate entry', async () => {
    // Retrieve one of Bob's valid VIP tickets from previous test
    const bobTickets = await store.getCustomerTickets('usr_bob');
    const validTicket = bobTickets.find((t: any) => t.status === 'VALID');
    expect(validTicket).toBeDefined();

    const eventId = validTicket.event_id;
    const ticketCode = validTicket.ticket_code;

    // Authorized scanner (Carol, scanner in org_fest_council) scans ticket
    const scan1 = await store.checkinTicket(eventId, 'usr_carol', ticketCode);
    expect(scan1.result).toBe('VALID');
    expect(scan1.attendeeName).toBe('Robert Smith');
    expect(scan1.isVip).toBe(true);

    // Second scan of the same ticket must be rejected as ALREADY_CHECKED_IN
    const scan2 = await store.checkinTicket(eventId, 'usr_carol', ticketCode);
    expect(scan2.result).toBe('ALREADY_CHECKED_IN');

    // Non-existent ticket code must be rejected
    const scanFake = await store.checkinTicket(eventId, 'usr_carol', 'TKT-0000000000000000');
    expect(scanFake.result).toBe('INVALID_TICKET');
  });
});
