-- 001_init.sql
-- Core schema for Darkhold Exchange

CREATE TABLE IF NOT EXISTS instruments (
  id VARCHAR(64) PRIMARY KEY,
  symbol VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  face_value BIGINT NOT NULL,
  collar_bps INT NOT NULL DEFAULT 1000,
  tick_size BIGINT NOT NULL DEFAULT 100,
  min_qty INT NOT NULL DEFAULT 1,
  max_qty_per_order INT NOT NULL DEFAULT 10,
  escrow_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_benchmark BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(256) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  session_token_hash VARCHAR(64) UNIQUE NOT NULL,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id VARCHAR(64) PRIMARY KEY,
  kind VARCHAR(32) NOT NULL,
  owner_user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
  instrument_id VARCHAR(64) REFERENCES instruments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_owner ON ledger_accounts(owner_user_id);

CREATE TABLE IF NOT EXISTS journals (
  id VARCHAR(64) PRIMARY KEY,
  kind VARCHAR(32) NOT NULL,
  ref_type VARCHAR(32) NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS postings (
  id BIGSERIAL PRIMARY KEY,
  journal_id VARCHAR(64) NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  account_id VARCHAR(64) NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  unit VARCHAR(32) NOT NULL,
  amount BIGINT NOT NULL,
  seq BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_postings_journal ON postings(journal_id);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);
CREATE INDEX IF NOT EXISTS idx_postings_unit ON postings(unit);

CREATE TABLE IF NOT EXISTS balances (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  escrow BIGINT NOT NULL DEFAULT 0 CHECK (escrow >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holdings (
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id VARCHAR(64) NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  available BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  escrow BIGINT NOT NULL DEFAULT 0 CHECK (escrow >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  client_order_id VARCHAR(64) NOT NULL,
  seq BIGINT NOT NULL,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id VARCHAR(64) NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  side VARCHAR(8) NOT NULL,
  type VARCHAR(8) NOT NULL,
  tif VARCHAR(8) NOT NULL,
  price BIGINT NOT NULL,
  qty INT NOT NULL,
  remaining_qty INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, client_order_id)
);


CREATE TABLE IF NOT EXISTS trades (
  id VARCHAR(64) PRIMARY KEY,
  seq BIGINT NOT NULL,
  instrument_id VARCHAR(64) NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  buy_order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sell_order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  buyer_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price BIGINT NOT NULL,
  qty INT NOT NULL,
  buyer_refund BIGINT NOT NULL DEFAULT 0,
  is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_inst ON trades(instrument_id);
CREATE INDEX IF NOT EXISTS idx_trades_seq ON trades(seq);

CREATE TABLE IF NOT EXISTS auctions (
  id VARCHAR(64) PRIMARY KEY,
  instrument_id VARCHAR(64) NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  seller_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qty_total INT NOT NULL,
  qty_remaining INT NOT NULL,
  start_price BIGINT NOT NULL,
  floor_price BIGINT NOT NULL,
  step_amount BIGINT NOT NULL,
  step_interval_ms INT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  clearing_price BIGINT,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);

CREATE TABLE IF NOT EXISTS escrows (
  id VARCHAR(64) PRIMARY KEY,
  trade_id VARCHAR(64) NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  instrument_id VARCHAR(64) NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  buyer_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qty INT NOT NULL,
  amount BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'LOCKED',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);

CREATE TABLE IF NOT EXISTS solvency_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  as_of_seq BIGINT NOT NULL,
  root_hash VARCHAR(64) NOT NULL,
  total_liabilities BIGINT NOT NULL,
  snapshot_salt VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  user_id VARCHAR(64),
  ip VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _migrations (
  name VARCHAR(128) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);