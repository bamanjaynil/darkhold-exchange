-- 006_withdrawals_and_deposits.sql
-- Tables for deposits, withdrawals, and treasury accounting

ALTER TABLE balances ADD COLUMN IF NOT EXISTS pending_withdrawals BIGINT NOT NULL DEFAULT 0 CHECK (pending_withdrawals >= 0);

CREATE TABLE IF NOT EXISTS deposits (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_dkc BIGINT NOT NULL,
  amount_inr NUMERIC(14, 2) NOT NULL,
  method VARCHAR(32) NOT NULL DEFAULT 'UPI',
  reference VARCHAR(128) UNIQUE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  journal_id VARCHAR(64) REFERENCES journals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_ref ON deposits(reference);

CREATE TABLE IF NOT EXISTS withdrawals (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_dkc BIGINT NOT NULL,
  amount_inr NUMERIC(14, 2) NOT NULL,
  upi_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  hold_journal_id VARCHAR(64) REFERENCES journals(id),
  settle_journal_id VARCHAR(64) REFERENCES journals(id),
  payout_ref VARCHAR(128),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
VALUES
  ('acc_treasury_inr', 'TREASURY', NULL, NULL),
  ('acc_platform_fee', 'PLATFORM_FEE', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
