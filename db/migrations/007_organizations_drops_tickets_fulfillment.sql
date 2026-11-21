-- 007_organizations_drops_tickets_fulfillment.sql
-- Comprehensive schema for campus organizations, verified drops, variant inventory,
-- events, ticket tiers, secure ticket issuance, store orders, pickup fulfillment & community listings.

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(64) UNIQUE NOT NULL,
  org_type VARCHAR(32) NOT NULL DEFAULT 'club',
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  affiliation VARCHAR(128),
  contact_email VARCHAR(128) NOT NULL,
  public_contact VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(64) NOT NULL REFERENCES users(id),
  approved_by VARCHAR(64) REFERENCES users(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_orgs_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_orgs_creator ON organizations(created_by);

-- 2. Organization Memberships
CREATE TABLE IF NOT EXISTS organization_memberships (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_memberships(organization_id);

-- 3. Products (Merchandise Items)
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  category VARCHAR(64) NOT NULL DEFAULT 'APPAREL',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_price_dkc BIGINT NOT NULL CHECK (base_price_dkc >= 0),
  base_price_inr NUMERIC(14, 2) NOT NULL CHECK (base_price_inr >= 0),
  comparison_price_dkc BIGINT,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  fulfillment_type VARCHAR(32) NOT NULL DEFAULT 'PICKUP',
  pickup_location TEXT,
  pickup_instructions TEXT,
  shipping_fee_dkc BIGINT NOT NULL DEFAULT 0,
  return_policy TEXT,
  max_per_customer INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- 4. Product Variants (Explicit Custom Variants only - no forced S/M/L/XL)
CREATE TABLE IF NOT EXISTS product_variants (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title VARCHAR(128) NOT NULL,
  sku VARCHAR(64),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_adjustment_dkc BIGINT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved_stock INT NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- 5. Timed Drops (Timed Campaigns)
CREATE TABLE IF NOT EXISTS drops (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  cover_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  pickup_location TEXT,
  pickup_window TEXT,
  customer_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drops_org ON drops(organization_id);
CREATE INDEX IF NOT EXISTS idx_drops_status ON drops(status);

-- 6. Drop Items
CREATE TABLE IF NOT EXISTS drop_items (
  id VARCHAR(64) PRIMARY KEY,
  drop_id VARCHAR(64) NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  allocated_stock INT NOT NULL DEFAULT 0,
  sold_count INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(drop_id, product_id)
);

-- 7. Events
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  venue VARCHAR(128) NOT NULL,
  cover_url TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  sales_open_at TIMESTAMPTZ NOT NULL,
  sales_close_at TIMESTAMPTZ NOT NULL,
  total_capacity INT NOT NULL CHECK (total_capacity > 0),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  checkin_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_org ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- 8. Ticket Tiers
CREATE TABLE IF NOT EXISTS ticket_tiers (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  price_dkc BIGINT NOT NULL CHECK (price_dkc >= 0),
  price_inr NUMERIC(14, 2) NOT NULL CHECK (price_inr >= 0),
  capacity INT NOT NULL CHECK (capacity > 0),
  sold_count INT NOT NULL DEFAULT 0 CHECK (sold_count <= capacity),
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_per_customer INT NOT NULL DEFAULT 4,
  sales_open_at TIMESTAMPTZ,
  sales_close_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tiers_event ON ticket_tiers(event_id);

-- 9. Store Orders (Merchandise & Event Tickets)
CREATE TABLE IF NOT EXISTS store_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(32) UNIQUE NOT NULL,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  order_type VARCHAR(32) NOT NULL DEFAULT 'MERCHANDISE',
  subtotal_dkc BIGINT NOT NULL,
  fee_dkc BIGINT NOT NULL DEFAULT 0,
  total_dkc BIGINT NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'DKC',
  status VARCHAR(32) NOT NULL DEFAULT 'PAID',
  payment_status VARCHAR(32) NOT NULL DEFAULT 'PAID',
  payment_method VARCHAR(32) NOT NULL DEFAULT 'DKC_WALLET',
  payment_ref VARCHAR(128),
  journal_id VARCHAR(64) REFERENCES journals(id),
  pickup_token VARCHAR(32),
  pickup_verified_at TIMESTAMPTZ,
  pickup_verified_by VARCHAR(64) REFERENCES users(id),
  shipping_address JSONB,
  dispute_reason TEXT,
  dispute_status VARCHAR(32) NOT NULL DEFAULT 'NONE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_orders_user ON store_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_store_orders_org ON store_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders(status);
CREATE INDEX IF NOT EXISTS idx_store_orders_pickup_token ON store_orders(pickup_token);

-- 10. Store Order Items (Historical Snapshot)
CREATE TABLE IF NOT EXISTS store_order_items (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id VARCHAR(64) REFERENCES products(id),
  variant_id VARCHAR(64) REFERENCES product_variants(id),
  ticket_tier_id VARCHAR(64) REFERENCES ticket_tiers(id),
  item_title VARCHAR(128) NOT NULL,
  variant_title VARCHAR(128),
  unit_price_dkc BIGINT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  total_price_dkc BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items(order_id);

-- 11. Issued Tickets & Check-In
CREATE TABLE IF NOT EXISTS issued_tickets (
  id VARCHAR(64) PRIMARY KEY,
  ticket_code VARCHAR(64) UNIQUE NOT NULL,
  order_id VARCHAR(64) NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  event_id VARCHAR(64) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_tier_id VARCHAR(64) NOT NULL REFERENCES ticket_tiers(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendee_name VARCHAR(128) NOT NULL,
  attendee_email VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'VALID',
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  checked_in_by VARCHAR(64) REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_code ON issued_tickets(ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON issued_tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON issued_tickets(user_id);

-- 12. Community Listings
CREATE TABLE IF NOT EXISTS community_listings (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  category VARCHAR(64) NOT NULL,
  condition VARCHAR(32) NOT NULL DEFAULT 'GOOD',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_dkc BIGINT,
  listing_type VARCHAR(32) NOT NULL DEFAULT 'SALE',
  trade_terms TEXT,
  contact_method VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_listings_user ON community_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_comm_listings_status ON community_listings(status);
