-- 004_drop_redundant_indexes.sql
-- Drop redundant secondary indexes on write-heavy tables to eliminate B-tree write amplification

DROP INDEX IF EXISTS idx_postings_unit;
DROP INDEX IF EXISTS idx_orders_user;
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_seq;

-- Partial index strictly for crash-recovery hydration of active resting orders
CREATE INDEX IF NOT EXISTS idx_orders_active_seq ON orders (seq) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
