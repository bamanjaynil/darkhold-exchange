/**
 * @file store.ts
 * Enterprise Campus Commerce & Organization Management Service.
 * Implements organization workspaces, multi-user role-based permissions,
 * organizer-defined product variants, timed drop lifecycles, concurrency-safe inventory allocation,
 * event ticketing with cryptographic QR issuance, secure OTP pickup verification,
 * duplicate-proof ticket check-in, and community listings.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { ExchangeCore } from './core.js';

export type OrgRole =
  | 'owner'
  | 'admin'
  | 'merch_manager'
  | 'event_manager'
  | 'fulfillment'
  | 'scanner'
  | 'finance';

// Helper: generate unguessable pickup token
export function generatePickupToken(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let token = 'PK-';
  for (let i = 0; i < 6; i++) {
    token += chars[crypto.randomInt(chars.length)];
  }
  return token;
}

// Helper: generate unguessable ticket code
export function generateTicketCode(): string {
  return `TKT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

// Helper: generate order number
export function generateOrderNumber(): string {
  return `DK-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(1000, 9999)}`;
}

export class StoreService {
  constructor(private pool: pg.Pool) {}

  // ==========================================
  // 1. ORGANIZATION MANAGEMENT & PERMISSIONS
  // ==========================================

  public async getUserOrgRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const { rows } = await this.pool.query<{ role: OrgRole }>(
      `SELECT role FROM organization_memberships 
       WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
      [orgId, userId]
    );
    return rows[0]?.role || null;
  }

  public async hasOrgPermission(orgId: string, userId: string, allowedRoles: OrgRole[]): Promise<boolean> {
    const role = await this.getUserOrgRole(orgId, userId);
    if (!role) return false;
    if (role === 'owner') return true;
    return allowedRoles.includes(role);
  }

  public async applyForOrganization(
    userId: string,
    data: {
      name: string;
      slug: string;
      orgType?: string;
      description?: string;
      affiliation?: string;
      contactEmail: string;
      publicContact?: string;
    }
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orgId = `org_${crypto.randomBytes(8).toString('hex')}`;
      const slug = data.slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');

      const existing = await client.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error('SLUG_TAKEN');
      }

      await client.query(
        `INSERT INTO organizations (
          id, name, slug, org_type, description, affiliation, contact_email, public_contact,
          status, is_verified, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', FALSE, $9)`,
        [
          orgId,
          data.name.trim(),
          slug,
          data.orgType || 'club',
          data.description || null,
          data.affiliation || null,
          data.contactEmail.trim(),
          data.publicContact || null,
          userId,
        ]
      );

      // Creator automatically becomes Owner
      await client.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
         VALUES ($1, $2, $3, 'owner', 'ACTIVE')`,
        [`mem_${crypto.randomBytes(8).toString('hex')}`, orgId, userId]
      );

      await client.query('COMMIT');
      return { id: orgId, slug, status: 'PENDING' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async listApprovedOrganizations() {
    const { rows } = await this.pool.query(`
      SELECT o.*, 
        COUNT(DISTINCT m.user_id) as member_count,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'LIVE') as active_drops_count,
        COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'PUBLISHED') as active_events_count
      FROM organizations o
      LEFT JOIN organization_memberships m ON o.id = m.organization_id AND m.status = 'ACTIVE'
      LEFT JOIN drops d ON o.id = d.organization_id
      LEFT JOIN events e ON o.id = e.organization_id
      WHERE o.status = 'APPROVED'
      GROUP BY o.id
      ORDER BY o.name ASC
    `);
    return rows;
  }

  public async listMyOrganizations(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT o.*, m.role, m.created_at as joined_at
       FROM organizations o
       JOIN organization_memberships m ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.status = 'ACTIVE'
       ORDER BY o.name ASC`,
      [userId]
    );
    return rows;
  }

  public async getOrganizationBySlug(slug: string) {
    const { rows } = await this.pool.query(
      `SELECT o.*, u.username as creator_username
       FROM organizations o
       JOIN users u ON o.created_by = u.id
       WHERE o.slug = $1`,
      [slug]
    );
    if (rows.length === 0) return null;
    const org = rows[0]!;

    const drops = await this.getDropsByOrg(org.id, false);
    const events = await this.getEventsByOrg(org.id, false);
    const products = await this.getProductsByOrg(org.id, false);

    return { ...org, drops, events, products };
  }

  public async getWorkspace(orgId: string, userId: string) {
    const role = await this.getUserOrgRole(orgId, userId);
    if (!role) throw new Error('FORBIDDEN_NOT_A_MEMBER');

    const { rows: orgRows } = await this.pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
    if (orgRows.length === 0) throw new Error('ORGANIZATION_NOT_FOUND');
    const org = orgRows[0]!;

    const members = await this.getOrgMembers(orgId);
    const products = await this.getProductsByOrg(orgId, true);
    const drops = await this.getDropsByOrg(orgId, true);
    const events = await this.getEventsByOrg(orgId, true);
    const recentOrders = await this.getOrgOrders(orgId);

    return {
      organization: org,
      userRole: role,
      members,
      products,
      drops,
      events,
      recentOrders,
    };
  }

  public async getOrgMembers(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.user_id, u.username, u.role as platform_role, m.role, m.status, m.created_at
       FROM organization_memberships m
       JOIN users u ON m.user_id = u.id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [orgId]
    );
    return rows;
  }

  public async addOrgMember(orgId: string, requesterUserId: string, targetUsername: string, role: OrgRole) {
    const allowed = await this.hasOrgPermission(orgId, requesterUserId, ['admin']);
    if (!allowed) throw new Error('FORBIDDEN_MUST_BE_ADMIN_OR_OWNER');

    const { rows: userRows } = await this.pool.query('SELECT id FROM users WHERE username = $1', [targetUsername]);
    if (userRows.length === 0) throw new Error('USER_NOT_FOUND');
    const targetUserId = userRows[0]!.id;

    const memId = `mem_${crypto.randomBytes(8).toString('hex')}`;
    await this.pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (organization_id, user_id) 
       DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', updated_at = NOW()`,
      [memId, orgId, targetUserId, role]
    );
    return { success: true, memberId: memId, userId: targetUserId, role };
  }

  public async removeOrgMember(orgId: string, requesterUserId: string, targetUserId: string) {
    const allowed = await this.hasOrgPermission(orgId, requesterUserId, []);
    if (!allowed) throw new Error('FORBIDDEN_ONLY_OWNER_CAN_REMOVE_MEMBERS');
    if (requesterUserId === targetUserId) throw new Error('CANNOT_REMOVE_YOURSELF_AS_OWNER');

    await this.pool.query(
      'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, targetUserId]
    );
    return { success: true };
  }

  public async adminListAllOrganizations() {
    const { rows } = await this.pool.query(`
      SELECT o.*, u.username as creator_username,
        COUNT(DISTINCT m.user_id) as member_count
      FROM organizations o
      LEFT JOIN users u ON o.created_by = u.id
      LEFT JOIN organization_memberships m ON o.id = m.organization_id
      GROUP BY o.id, u.username
      ORDER BY o.created_at DESC
    `);
    return rows;
  }

  public async adminReviewOrganization(
    orgId: string,
    adminUserId: string,
    action: 'APPROVE' | 'REJECT' | 'SUSPEND',
    reason?: string
  ) {
    const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
    const isVerified = action === 'APPROVE';

    await this.pool.query(
      `UPDATE organizations 
       SET status = $1, is_verified = $2, approved_by = $3, rejection_reason = $4, updated_at = NOW()
       WHERE id = $5`,
      [status, isVerified, adminUserId, reason || null, orgId]
    );
    return { success: true, status, isVerified };
  }

  // ==========================================
  // 2. PRODUCTS & EXPLICIT CUSTOM VARIANTS
  // ==========================================

  public async createProduct(
    orgId: string,
    userId: string,
    data: {
      name: string;
      description?: string;
      category?: string;
      images?: string[];
      basePriceDkc: number;
      comparisonPriceDkc?: number;
      fulfillmentType?: 'PICKUP' | 'SHIPPING' | 'BOTH';
      pickupLocation?: string;
      pickupInstructions?: string;
      maxPerCustomer?: number;
      variants: Array<{
        title: string;
        sku?: string;
        attributes?: Record<string, string>;
        priceAdjustmentDkc?: number;
        stock: number;
      }>;
    }
  ) {
    const allowed = await this.hasOrgPermission(orgId, userId, ['admin', 'merch_manager']);
    if (!allowed) throw new Error('FORBIDDEN_MERCH_MANAGER_ONLY');

    if (!data.variants || data.variants.length === 0) {
      throw new Error('MUST_SPECIFY_AT_LEAST_ONE_VARIANT');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const prodId = `prod_${crypto.randomBytes(8).toString('hex')}`;
      const basePriceMinor = Math.round(data.basePriceDkc * 100);
      const basePriceInr = Number((basePriceMinor / 100).toFixed(2));

      await client.query(
        `INSERT INTO products (
          id, organization_id, name, description, category, images,
          base_price_dkc, base_price_inr, comparison_price_dkc, status,
          fulfillment_type, pickup_location, pickup_instructions, max_per_customer
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUBLISHED', $10, $11, $12, $13)`,
        [
          prodId,
          orgId,
          data.name.trim(),
          data.description || null,
          data.category || 'APPAREL',
          JSON.stringify(data.images || []),
          basePriceMinor,
          basePriceInr,
          data.comparisonPriceDkc ? Math.round(data.comparisonPriceDkc * 100) : null,
          data.fulfillmentType || 'PICKUP',
          data.pickupLocation || 'Campus Store Counter',
          data.pickupInstructions || null,
          data.maxPerCustomer || 5,
        ]
      );

      // Create explicit variants as defined by organizer
      for (const v of data.variants) {
        const varId = `var_${crypto.randomBytes(8).toString('hex')}`;
        const adjMinor = Math.round((v.priceAdjustmentDkc || 0) * 100);
        await client.query(
          `INSERT INTO product_variants (
            id, product_id, title, sku, attributes, price_adjustment_dkc, stock, reserved_stock, is_available
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, TRUE)`,
          [
            varId,
            prodId,
            v.title.trim(),
            v.sku || null,
            JSON.stringify(v.attributes || {}),
            adjMinor,
            Math.max(0, v.stock || 0),
          ]
        );
      }

      await client.query('COMMIT');
      return this.getProduct(prodId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async getProduct(productId: string) {
    const { rows: prodRows } = await this.pool.query(
      `SELECT p.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified
       FROM products p
       JOIN organizations o ON p.organization_id = o.id
       WHERE p.id = $1`,
      [productId]
    );
    if (prodRows.length === 0) return null;
    const prod = prodRows[0]!;

    const { rows: variants } = await this.pool.query(
      `SELECT * FROM product_variants WHERE product_id = $1 ORDER BY price_adjustment_dkc ASC, title ASC`,
      [productId]
    );

    return { ...prod, variants };
  }

  public async getProductsByOrg(orgId: string, includeDrafts: boolean = false) {
    const statusClause = includeDrafts ? '' : "AND p.status = 'PUBLISHED'";
    const { rows: products } = await this.pool.query(
      `SELECT p.*, 
         COALESCE(SUM(v.stock), 0) as total_stock,
         COUNT(v.id) as variant_count
       FROM products p
       LEFT JOIN product_variants v ON p.id = v.product_id
       WHERE p.organization_id = $1 ${statusClause}
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [orgId]
    );

    const result = [];
    for (const p of products) {
      const { rows: variants } = await this.pool.query(
        'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY title ASC',
        [p.id]
      );
      result.push({ ...p, variants });
    }
    return result;
  }

  public async listAllPublishedProducts(category?: string) {
    const params: any[] = [];
    let catFilter = '';
    if (category && category !== 'ALL') {
      params.push(category);
      catFilter = `AND p.category = $1`;
    }

    const { rows: products } = await this.pool.query(
      `SELECT p.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified,
         COALESCE(SUM(v.stock), 0)::int as total_stock,
         COUNT(v.id)::int as variant_count
       FROM products p
       JOIN organizations o ON p.organization_id = o.id
       LEFT JOIN product_variants v ON p.id = v.product_id
       WHERE p.status = 'PUBLISHED' AND o.status = 'APPROVED' ${catFilter}
       GROUP BY p.id, o.name, o.slug, o.is_verified
       ORDER BY p.created_at DESC`,
      params
    );

    const result = [];
    for (const p of products) {
      const { rows: variants } = await this.pool.query(
        'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY price_adjustment_dkc ASC, title ASC',
        [p.id]
      );
      result.push({ ...p, variants });
    }
    return result;
  }

  public async updateVariantStock(variantId: string, userId: string, newStock: number) {
    const { rows } = await this.pool.query(
      `SELECT p.organization_id 
       FROM product_variants v 
       JOIN products p ON v.product_id = p.id 
       WHERE v.id = $1`,
      [variantId]
    );
    if (rows.length === 0) throw new Error('VARIANT_NOT_FOUND');
    const orgId = rows[0]!.organization_id;

    const allowed = await this.hasOrgPermission(orgId, userId, ['admin', 'merch_manager']);
    if (!allowed) throw new Error('FORBIDDEN_MERCH_MANAGER_ONLY');

    await this.pool.query(
      `UPDATE product_variants 
       SET stock = $1, is_available = ($1 > 0), updated_at = NOW() 
       WHERE id = $2`,
      [Math.max(0, newStock), variantId]
    );
    return { success: true, variantId, stock: Math.max(0, newStock) };
  }

  // ==========================================
  // 3. TIMED DROPS (LIFECYCLE & SCHEDULES)
  // ==========================================

  public async createDrop(
    orgId: string,
    userId: string,
    data: {
      title: string;
      description?: string;
      coverUrl?: string;
      startsAt: string;
      endsAt: string;
      pickupLocation?: string;
      pickupWindow?: string;
      customerInstructions?: string;
      productIds: string[];
    }
  ) {
    const allowed = await this.hasOrgPermission(orgId, userId, ['admin', 'merch_manager']);
    if (!allowed) throw new Error('FORBIDDEN_MERCH_MANAGER_ONLY');

    const startDate = new Date(data.startsAt);
    const endDate = new Date(data.endsAt);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) throw new Error('INVALID_DATES');
    if (endDate <= startDate) throw new Error('END_DATE_MUST_BE_AFTER_START_DATE');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dropId = `drop_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date();
      const status = now >= startDate && now <= endDate ? 'LIVE' : now < startDate ? 'SCHEDULED' : 'ENDED';

      await client.query(
        `INSERT INTO drops (
          id, organization_id, title, description, cover_url, status,
          starts_at, ends_at, pickup_location, pickup_window, customer_instructions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          dropId,
          orgId,
          data.title.trim(),
          data.description || null,
          data.coverUrl || null,
          status,
          startDate,
          endDate,
          data.pickupLocation || 'Campus Store Counter',
          data.pickupWindow || 'Standard Hours',
          data.customerInstructions || null,
        ]
      );

      for (let i = 0; i < (data.productIds || []).length; i++) {
        const pId = data.productIds[i]!;
        await client.query(
          `INSERT INTO drop_items (id, drop_id, product_id, allocated_stock, sold_count, sort_order)
           VALUES ($1, $2, $3, 100, 0, $4)
           ON CONFLICT DO NOTHING`,
          [`ditem_${crypto.randomBytes(8).toString('hex')}`, dropId, pId, i + 1]
        );
      }

      await client.query('COMMIT');
      return this.getDrop(dropId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async listDrops() {
    // Dynamic lifecycle update based on UTC time
    await this.pool.query(`
      UPDATE drops 
      SET status = CASE
        WHEN NOW() < starts_at THEN 'SCHEDULED'
        WHEN NOW() >= starts_at AND NOW() <= ends_at AND status NOT IN ('PAUSED', 'CANCELLED') THEN 'LIVE'
        WHEN NOW() > ends_at AND status NOT IN ('CANCELLED') THEN 'ENDED'
        ELSE status
      END
      WHERE status NOT IN ('DRAFT', 'CANCELLED', 'PAUSED')
    `);

    const { rows } = await this.pool.query(`
      SELECT d.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified,
        COUNT(di.product_id) as product_count
      FROM drops d
      JOIN organizations o ON d.organization_id = o.id
      LEFT JOIN drop_items di ON d.id = di.drop_id
      WHERE d.status != 'DRAFT'
      GROUP BY d.id, o.name, o.slug, o.is_verified
      ORDER BY 
        CASE d.status 
          WHEN 'LIVE' THEN 1 
          WHEN 'SCHEDULED' THEN 2 
          WHEN 'ENDED' THEN 3 
          ELSE 4 
        END,
        d.starts_at ASC
    `);
    return rows;
  }

  public async getDrop(dropId: string) {
    const { rows: dropRows } = await this.pool.query(
      `SELECT d.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified
       FROM drops d
       JOIN organizations o ON d.organization_id = o.id
       WHERE d.id = $1`,
      [dropId]
    );
    if (dropRows.length === 0) return null;
    const drop = dropRows[0]!;

    const { rows: products } = await this.pool.query(
      `SELECT p.*, di.allocated_stock, di.sold_count
       FROM drop_items di
       JOIN products p ON di.product_id = p.id
       WHERE di.drop_id = $1
       ORDER BY di.sort_order ASC`,
      [dropId]
    );

    const items = [];
    for (const p of products) {
      const { rows: variants } = await this.pool.query(
        'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY price_adjustment_dkc ASC, title ASC',
        [p.id]
      );
      items.push({ ...p, variants });
    }

    return { ...drop, products: items };
  }

  public async getDropsByOrg(orgId: string, includeDrafts: boolean = false) {
    const statusClause = includeDrafts ? '' : "AND d.status != 'DRAFT'";
    const { rows } = await this.pool.query(
      `SELECT d.*, COUNT(di.product_id) as product_count
       FROM drops d
       LEFT JOIN drop_items di ON d.id = di.drop_id
       WHERE d.organization_id = $1 ${statusClause}
       GROUP BY d.id
       ORDER BY d.created_at DESC`,
      [orgId]
    );
    return rows;
  }

  public async updateDropStatus(dropId: string, userId: string, newStatus: string) {
    const { rows } = await this.pool.query('SELECT organization_id FROM drops WHERE id = $1', [dropId]);
    if (rows.length === 0) throw new Error('DROP_NOT_FOUND');
    const orgId = rows[0]!.organization_id;

    const allowed = await this.hasOrgPermission(orgId, userId, ['admin', 'merch_manager']);
    if (!allowed) throw new Error('FORBIDDEN_MERCH_MANAGER_ONLY');

    await this.pool.query(
      'UPDATE drops SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, dropId]
    );
    return { success: true, dropId, status: newStatus };
  }

  // ==========================================
  // 4. EVENTS & TICKET TIERS
  // ==========================================

  public async createEvent(
    orgId: string,
    userId: string,
    data: {
      title: string;
      description?: string;
      venue: string;
      coverUrl?: string;
      startsAt: string;
      endsAt: string;
      salesOpenAt: string;
      salesCloseAt: string;
      totalCapacity: number;
      checkinInstructions?: string;
      tiers: Array<{
        name: string;
        description?: string;
        priceDkc: number;
        capacity: number;
        isVip?: boolean;
        benefits?: string[];
        maxPerCustomer?: number;
      }>;
    }
  ) {
    const allowed = await this.hasOrgPermission(orgId, userId, ['admin', 'event_manager']);
    if (!allowed) throw new Error('FORBIDDEN_EVENT_MANAGER_ONLY');

    const startDate = new Date(data.startsAt);
    const endDate = new Date(data.endsAt);
    const salesOpen = new Date(data.salesOpenAt);
    const salesClose = new Date(data.salesCloseAt);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) throw new Error('INVALID_EVENT_DATES');
    if (endDate <= startDate) throw new Error('END_DATE_MUST_BE_AFTER_START');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eventId = `evt_${crypto.randomBytes(8).toString('hex')}`;

      await client.query(
        `INSERT INTO events (
          id, organization_id, title, description, venue, cover_url,
          starts_at, ends_at, sales_open_at, sales_close_at, total_capacity,
          status, checkin_instructions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PUBLISHED', $12)`,
        [
          eventId,
          orgId,
          data.title.trim(),
          data.description || null,
          data.venue.trim(),
          data.coverUrl || null,
          startDate,
          endDate,
          salesOpen,
          salesClose,
          data.totalCapacity,
          data.checkinInstructions || 'Present ticket QR code at security check-in.',
        ]
      );

      for (const t of data.tiers) {
        const tierId = `tier_${crypto.randomBytes(8).toString('hex')}`;
        const priceMinor = Math.round(t.priceDkc * 100);
        const priceInr = Number((priceMinor / 100).toFixed(2));

        await client.query(
          `INSERT INTO ticket_tiers (
            id, event_id, name, description, price_dkc, price_inr,
            capacity, sold_count, is_vip, benefits, max_per_customer, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, 'ACTIVE')`,
          [
            tierId,
            eventId,
            t.name.trim(),
            t.description || null,
            priceMinor,
            priceInr,
            t.capacity,
            t.isVip || false,
            JSON.stringify(t.benefits || []),
            t.maxPerCustomer || 4,
          ]
        );
      }

      await client.query('COMMIT');
      return this.getEvent(eventId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async listEvents() {
    const { rows: events } = await this.pool.query(`
      SELECT e.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified
      FROM events e
      JOIN organizations o ON e.organization_id = o.id
      WHERE e.status = 'PUBLISHED'
      ORDER BY e.starts_at ASC
    `);

    const result = [];
    for (const e of events) {
      const { rows: tiers } = await this.pool.query(
        'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY price_dkc ASC',
        [e.id]
      );
      result.push({ ...e, tiers });
    }
    return result;
  }

  public async getEvent(eventId: string) {
    const { rows: eventRows } = await this.pool.query(
      `SELECT e.*, o.name as organization_name, o.slug as organization_slug, o.is_verified as org_verified
       FROM events e
       JOIN organizations o ON e.organization_id = o.id
       WHERE e.id = $1`,
      [eventId]
    );
    if (eventRows.length === 0) return null;
    const evt = eventRows[0]!;

    const { rows: tiers } = await this.pool.query(
      'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY price_dkc ASC',
      [eventId]
    );

    return { ...evt, tiers };
  }

  public async getEventsByOrg(orgId: string, includeDrafts: boolean = false) {
    const statusClause = includeDrafts ? '' : "AND e.status = 'PUBLISHED'";
    const { rows } = await this.pool.query(
      `SELECT e.*, COUNT(t.id) as tier_count
       FROM events e
       LEFT JOIN ticket_tiers t ON e.id = t.event_id
       WHERE e.organization_id = $1 ${statusClause}
       GROUP BY e.id
       ORDER BY e.starts_at ASC`,
      [orgId]
    );
    return rows;
  }

  // ==========================================
  // 5. ATOMIC CHECKOUT & CONCURRENCY PROTECTION
  // ==========================================

  public async checkout(
    buyerUserId: string,
    core: ExchangeCore,
    data: {
      orderType: 'MERCHANDISE' | 'TICKET';
      organizationId: string;
      items: Array<{
        productId?: string;
        variantId?: string;
        ticketTierId?: string;
        quantity: number;
      }>;
      attendeeName?: string;
      attendeeEmail?: string;
      shippingAddress?: any;
      notes?: string;
    }
  ) {
    if (!data.items || data.items.length === 0) throw new Error('EMPTY_CHECKOUT');
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      let subtotalMinor = 0;
      const orderItemsToInsert: any[] = [];
      const ticketsToIssue: any[] = [];

      // A. Merchandise Workflow
      if (data.orderType === 'MERCHANDISE') {
        for (const it of data.items) {
          if (!it.variantId || it.quantity <= 0) throw new Error('INVALID_QUANTITY');

          // Atomic check-and-decrement to prevent overselling
          const { rows: varRows } = await client.query(
            `UPDATE product_variants 
             SET stock = stock - $1, reserved_stock = reserved_stock + $1, updated_at = NOW()
             WHERE id = $2 AND stock >= $1 AND is_available = TRUE
             RETURNING id, product_id, title, price_adjustment_dkc, stock`,
            [it.quantity, it.variantId]
          );

          if (varRows.length === 0) {
            throw new Error(`INSUFFICIENT_STOCK_OR_UNAVAILABLE`);
          }

          const variant = varRows[0]!;
          const { rows: prodRows } = await client.query(
            'SELECT name, base_price_dkc, organization_id FROM products WHERE id = $1',
            [variant.product_id]
          );
          if (prodRows.length === 0) throw new Error('PRODUCT_NOT_FOUND');
          const prod = prodRows[0]!;

          const unitPrice = Number(prod.base_price_dkc) + Number(variant.price_adjustment_dkc);
          const lineTotal = unitPrice * it.quantity;
          subtotalMinor += lineTotal;

          orderItemsToInsert.push({
            id: `sitem_${crypto.randomBytes(8).toString('hex')}`,
            productId: variant.product_id,
            variantId: variant.id,
            itemTitle: prod.name,
            variantTitle: variant.title,
            unitPriceDkc: unitPrice,
            quantity: it.quantity,
            totalPriceDkc: lineTotal,
          });
        }
      } 
      // B. Ticketing Workflow
      else if (data.orderType === 'TICKET') {
        for (const it of data.items) {
          if (!it.ticketTierId || it.quantity <= 0) throw new Error('INVALID_QUANTITY');

          // Atomic capacity allocation
          const { rows: tierRows } = await client.query(
            `UPDATE ticket_tiers
             SET sold_count = sold_count + $1, updated_at = NOW()
             WHERE id = $2 AND sold_count + $1 <= capacity AND status = 'ACTIVE'
             RETURNING id, event_id, name, price_dkc, is_vip, sold_count, capacity`,
            [it.quantity, it.ticketTierId]
          );

          if (tierRows.length === 0) {
            throw new Error('TIER_CAPACITY_EXCEEDED');
          }

          const tier = tierRows[0]!;
          const { rows: evtRows } = await client.query(
            'SELECT title, status, sales_close_at, organization_id FROM events WHERE id = $1',
            [tier.event_id]
          );
          if (evtRows.length === 0) throw new Error('EVENT_NOT_FOUND');
          const evt = evtRows[0]!;
          if (evt.status !== 'PUBLISHED') throw new Error('EVENT_NOT_OPEN_FOR_SALE');

          const tierPrice = Number(tier.price_dkc);
          const lineTotal = tierPrice * it.quantity;
          subtotalMinor += lineTotal;

          orderItemsToInsert.push({
            id: `sitem_${crypto.randomBytes(8).toString('hex')}`,
            ticketTierId: tier.id,
            itemTitle: evt.title,
            variantTitle: tier.name,
            unitPriceDkc: tierPrice,
            quantity: it.quantity,
            totalPriceDkc: lineTotal,
          });

          // Prepare individual tickets
          for (let q = 0; q < it.quantity; q++) {
            ticketsToIssue.push({
              id: `tkt_${crypto.randomBytes(8).toString('hex')}`,
              ticketCode: generateTicketCode(),
              eventId: tier.event_id,
              ticketTierId: tier.id,
              userId: buyerUserId,
              attendeeName: data.attendeeName || 'Attendee',
              attendeeEmail: data.attendeeEmail || null,
              isVip: tier.is_vip,
            });
          }
        }
      }

      // Check Buyer Wallet Balance
      const buyerBal = core.getBalance(buyerUserId);
      if (buyerBal.available < subtotalMinor) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Debit buyer wallet
      buyerBal.available -= subtotalMinor;

      // Ensure treasury account exists
      await client.query(`
        INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
        VALUES ('acc_treasury_inr', 'TREASURY', NULL, NULL)
        ON CONFLICT (id) DO NOTHING;
      `);

      // Credit platform / treasury ledger journal (double-entry zero sum)
      const journalId = `j_store_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id)
         VALUES ($1, 'TRANSFER', 'STORE_PURCHASE', $2)`,
        [journalId, buyerUserId]
      );

      const seqRes = await client.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM postings');
      const startSeq = Number(seqRes.rows[0].next_seq);

      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES
           ($1, $2, 'CASH', $3, $4),
           ($1, 'acc_treasury_inr', 'CASH', $5, $6)`,
        [
          journalId,
          `acc_${buyerUserId}_cash_avail`,
          -subtotalMinor,
          startSeq,
          subtotalMinor,
          startSeq + 1,
        ]
      );

      await client.query(
        `UPDATE balances SET available = available - $1 WHERE user_id = $2`,
        [subtotalMinor, buyerUserId]
      );

      // Create Store Order
      const orderId = `ord_store_${crypto.randomBytes(8).toString('hex')}`;
      const orderNumber = generateOrderNumber();
      const pickupToken = generatePickupToken();

      await client.query(
        `INSERT INTO store_orders (
          id, order_number, user_id, organization_id, order_type,
          subtotal_dkc, fee_dkc, total_dkc, currency, status,
          payment_status, payment_method, journal_id, pickup_token,
          shipping_address, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 'DKC', 'PAID', 'PAID', 'DKC_WALLET', $7, $8, $9, $10)`,
        [
          orderId,
          orderNumber,
          buyerUserId,
          data.organizationId,
          data.orderType,
          subtotalMinor,
          journalId,
          pickupToken,
          JSON.stringify(data.shippingAddress || {}),
          data.notes || null,
        ]
      );

      // Insert Order Items snapshot
      for (const itm of orderItemsToInsert) {
        await client.query(
          `INSERT INTO store_order_items (
            id, order_id, product_id, variant_id, ticket_tier_id,
            item_title, variant_title, unit_price_dkc, quantity, total_price_dkc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            itm.id,
            orderId,
            itm.productId || null,
            itm.variantId || null,
            itm.ticketTierId || null,
            itm.itemTitle,
            itm.variantTitle || null,
            itm.unitPriceDkc,
            itm.quantity,
            itm.totalPriceDkc,
          ]
        );
      }

      // Insert Tickets
      for (const tkt of ticketsToIssue) {
        await client.query(
          `INSERT INTO issued_tickets (
            id, ticket_code, order_id, event_id, ticket_tier_id,
            user_id, attendee_name, attendee_email, status, is_vip
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VALID', $9)`,
          [
            tkt.id,
            tkt.ticketCode,
            orderId,
            tkt.eventId,
            tkt.ticketTierId,
            tkt.userId,
            tkt.attendeeName,
            tkt.attendeeEmail,
            tkt.isVip,
          ]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        orderId,
        orderNumber,
        pickupToken,
        orderType: data.orderType,
        totalDkc: subtotalMinor / 100,
        tickets: ticketsToIssue,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // 6. CUSTOMER ORDERS & TICKETS
  // ==========================================

  public async getCustomerOrders(userId: string) {
    const { rows: orders } = await this.pool.query(
      `SELECT o.*, org.name as organization_name, org.slug as organization_slug
       FROM store_orders o
       JOIN organizations org ON o.organization_id = org.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId]
    );

    const result = [];
    for (const ord of orders) {
      const { rows: items } = await this.pool.query(
        'SELECT * FROM store_order_items WHERE order_id = $1',
        [ord.id]
      );
      const { rows: tickets } = await this.pool.query(
        'SELECT * FROM issued_tickets WHERE order_id = $1',
        [ord.id]
      );
      result.push({ ...ord, items, tickets });
    }
    return result;
  }

  public async getCustomerTickets(userId: string) {
    const { rows } = await this.pool.query(
      `SELECT t.*, e.title as event_title, e.venue as event_venue, e.starts_at as event_starts_at,
              tt.name as tier_name, tt.benefits as tier_benefits, org.name as organization_name
       FROM issued_tickets t
       JOIN events e ON t.event_id = e.id
       JOIN ticket_tiers tt ON t.ticket_tier_id = tt.id
       JOIN organizations org ON e.organization_id = org.id
       WHERE t.user_id = $1
       ORDER BY e.starts_at ASC, t.created_at DESC`,
      [userId]
    );
    return rows;
  }

  // ==========================================
  // 7. FULFILLMENT & CAMPUS PICKUP VERIFICATION
  // ==========================================

  public async getOrgOrders(orgId: string, statusFilter?: string) {
    const filterClause = statusFilter ? 'AND o.status = $2' : '';
    const params = statusFilter ? [orgId, statusFilter] : [orgId];

    const { rows: orders } = await this.pool.query(
      `SELECT o.*, u.username as customer_username
       FROM store_orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.organization_id = $1 ${filterClause}
       ORDER BY o.created_at DESC`,
      params
    );

    const result = [];
    for (const ord of orders) {
      const { rows: items } = await this.pool.query(
        'SELECT * FROM store_order_items WHERE order_id = $1',
        [ord.id]
      );
      result.push({ ...ord, items });
    }
    return result;
  }

  public async verifyCampusPickup(orgId: string, staffUserId: string, orderId: string, pickupToken: string) {
    const allowed = await this.hasOrgPermission(orgId, staffUserId, ['admin', 'fulfillment']);
    if (!allowed) throw new Error('FORBIDDEN_FULFILLMENT_STAFF_ONLY');

    const cleanToken = pickupToken.toUpperCase().trim();
    const { rows } = await this.pool.query(
      `SELECT * FROM store_orders 
       WHERE id = $1 AND organization_id = $2`,
      [orderId, orgId]
    );

    if (rows.length === 0) throw new Error('ORDER_NOT_FOUND');
    const order = rows[0]!;

    if (order.status === 'COLLECTED') {
      return { success: false, error: 'ALREADY_COLLECTED', message: 'Order was already handed over.' };
    }
    const tokenMatches =
      order.pickup_token === cleanToken ||
      order.pickup_token.replace(/^PK-/, '') === cleanToken ||
      `PK-${cleanToken}` === order.pickup_token;
    if (!tokenMatches) {
      return { success: false, error: 'INVALID_TOKEN', message: 'Invalid OTP / pickup token.' };
    }

    await this.pool.query(
      `UPDATE store_orders 
       SET status = 'COLLECTED', pickup_verified_at = NOW(), pickup_verified_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [staffUserId, orderId]
    );

    return {
      success: true,
      orderId,
      status: 'COLLECTED',
      message: 'Pickup verified and order marked as collected!',
    };
  }

  public async reportOrderDispute(orderId: string, customerUserId: string, reason: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM store_orders WHERE id = $1 AND user_id = $2',
      [orderId, customerUserId]
    );
    if (rows.length === 0) throw new Error('ORDER_NOT_FOUND');

    await this.pool.query(
      `UPDATE store_orders 
       SET status = 'DISPUTED', dispute_reason = $1, dispute_status = 'OPEN', updated_at = NOW()
       WHERE id = $2`,
      [reason.trim(), orderId]
    );

    return { success: true, orderId, status: 'DISPUTED' };
  }

  // ==========================================
  // 8. TICKET CHECK-IN & DUPLICATE PREVENTION
  // ==========================================

  public async checkinTicket(eventId: string, staffUserId: string, ticketCode: string) {
    const { rows: evtRows } = await this.pool.query('SELECT organization_id FROM events WHERE id = $1', [eventId]);
    if (evtRows.length === 0) throw new Error('EVENT_NOT_FOUND');
    const orgId = evtRows[0]!.organization_id;

    const allowed = await this.hasOrgPermission(orgId, staffUserId, ['admin', 'event_manager', 'scanner']);
    if (!allowed) throw new Error('FORBIDDEN_SCANNER_ONLY');

    const cleanCode = ticketCode.toUpperCase().trim();
    const { rows: tktRows } = await this.pool.query(
      `SELECT t.*, tt.name as tier_name, e.title as event_title
       FROM issued_tickets t
       JOIN ticket_tiers tt ON t.ticket_tier_id = tt.id
       JOIN events e ON t.event_id = e.id
       WHERE t.ticket_code = $1`,
      [cleanCode]
    );

    if (tktRows.length === 0) {
      return { result: 'INVALID_TICKET', message: 'Ticket code does not exist.' };
    }

    const tkt = tktRows[0]!;
    if (tkt.event_id !== eventId) {
      return { result: 'WRONG_EVENT', message: `Ticket is for a different event (${tkt.event_title}).` };
    }

    if (tkt.status === 'CHECKED_IN') {
      return {
        result: 'ALREADY_CHECKED_IN',
        message: `Ticket was already used at ${new Date(tkt.checked_in_at).toLocaleTimeString()}`,
        checkedInAt: tkt.checked_in_at,
        attendeeName: tkt.attendee_name,
        isVip: tkt.is_vip,
      };
    }

    if (tkt.status !== 'VALID') {
      return { result: 'INVALID_STATUS', message: `Ticket has status ${tkt.status} (refunded or revoked).` };
    }

    // Atomic update
    const updateRes = await this.pool.query(
      `UPDATE issued_tickets 
       SET status = 'CHECKED_IN', checked_in_at = NOW(), checked_in_by = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'VALID'
       RETURNING id, attendee_name, is_vip, checked_in_at`,
      [staffUserId, tkt.id]
    );

    if (updateRes.rowCount === 0) {
      return { result: 'ALREADY_CHECKED_IN', message: 'Ticket was just scanned concurrently by another turnstile.' };
    }

    return {
      result: 'VALID',
      message: '✓ Valid Entry Approved',
      attendeeName: tkt.attendee_name,
      tierName: tkt.tier_name,
      isVip: tkt.is_vip,
      checkedInAt: updateRes.rows[0]!.checked_in_at,
    };
  }

  // ==========================================
  // 9. COMMUNITY MARKETPLACE LISTINGS
  // ==========================================

  public async listCommunityListings(category?: string, listingType?: string) {
    let query = `
      SELECT cl.*, u.username as seller_username
      FROM community_listings cl
      JOIN users u ON cl.user_id = u.id
      WHERE cl.status = 'ACTIVE'
    `;
    const params: any[] = [];
    if (category) {
      params.push(category);
      query += ` AND cl.category = $${params.length}`;
    }
    if (listingType) {
      params.push(listingType);
      query += ` AND cl.listing_type = $${params.length}`;
    }
    query += ' ORDER BY cl.created_at DESC';

    const { rows } = await this.pool.query(query, params);
    return rows;
  }

  public async createCommunityListing(
    userId: string,
    data: {
      title: string;
      description?: string;
      category: string;
      condition: string;
      images?: string[];
      priceDkc?: number;
      listingType?: string;
      tradeTerms?: string;
      contactMethod: string;
    }
  ) {
    const listId = `comm_${crypto.randomBytes(8).toString('hex')}`;
    const priceMinor = data.priceDkc ? Math.round(data.priceDkc * 100) : null;

    await this.pool.query(
      `INSERT INTO community_listings (
        id, user_id, title, description, category, condition, images,
        price_dkc, listing_type, trade_terms, contact_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE')`,
      [
        listId,
        userId,
        data.title.trim(),
        data.description || null,
        data.category.trim(),
        data.condition || 'GOOD',
        JSON.stringify(data.images || []),
        priceMinor,
        data.listingType || 'SALE',
        data.tradeTerms || null,
        data.contactMethod.trim(),
      ]
    );

    return { id: listId, success: true };
  }

  public async updateListingStatus(listingId: string, userId: string, status: string) {
    const { rows } = await this.pool.query('SELECT user_id FROM community_listings WHERE id = $1', [listingId]);
    if (rows.length === 0) throw new Error('LISTING_NOT_FOUND');
    if (rows[0]!.user_id !== userId) throw new Error('FORBIDDEN');

    await this.pool.query(
      'UPDATE community_listings SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, listingId]
    );
    return { success: true, listingId, status };
  }
}
