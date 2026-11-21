-- 008_deals_and_lifecycle.sql
-- High-integrity P2P deal lifecycle state machine, mutual meetup coordination,
-- and escrow release / 1% cancellation fee tracking.

CREATE TABLE IF NOT EXISTS deals (
  id VARCHAR(64) PRIMARY KEY,
  trade_id VARCHAR(64) REFERENCES trades(id) ON DELETE SET NULL,
  listing_id VARCHAR(64) REFERENCES community_listings(id) ON DELETE SET NULL,
  symbol VARCHAR(64) NOT NULL,
  buyer_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price BIGINT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'MATCHED_PENDING_HANDOVER',
  meetup_date VARCHAR(64),
  meetup_time VARCHAR(64),
  meetup_location TEXT,
  meetup_instructions TEXT,
  buyer_confirmed_meetup BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed_meetup BOOLEAN NOT NULL DEFAULT FALSE,
  meetup_confirmed_at TIMESTAMPTZ,
  handed_over_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  cancellation_charge BIGINT NOT NULL DEFAULT 0,
  buyer_refund_amount BIGINT NOT NULL DEFAULT 0,
  seller_compensation_amount BIGINT NOT NULL DEFAULT 0,
  dispute_reason TEXT,
  disputed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  pickup_otp VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_buyer ON deals(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_trade ON deals(trade_id);
