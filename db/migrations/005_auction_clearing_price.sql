-- 005_auction_clearing_price.sql
-- Adds clearing_price and ended_at columns to auctions table for post-clearing freeze

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS clearing_price BIGINT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
