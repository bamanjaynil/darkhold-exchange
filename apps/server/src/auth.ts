/**
 * @file auth.ts
 * Session-based authentication, Argon2id password hashing, CSRF protection,
 * and brute-force rate-limiting buckets.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { hash, verify } from '@node-rs/argon2';
import { config } from './config.js';
import { ExchangeCore } from './core.js';

export type SessionUser = {
  id: string;
  username: string;
  role: 'user' | 'admin';
  isDemo: boolean;
};

// Constant-time dummy hash for unknown users to prevent timing analysis
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlfc2FsdF8xMjM0NTY$Y21jN1NtcFR3WjE1MW8zTkhqV0tNdzJ6VnkyNm13dmw';

// In-memory token bucket for brute-force protection
type RateBucket = { tokens: number; lastRefill: number; lockUntil: number };
const loginBuckets = new Map<string, RateBucket>();

function checkRateLimit(key: string, capacity: number = 5, fillRateSec: number = 1): boolean {
  const now = Date.now();
  let bucket = loginBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now, lockUntil: 0 };
    loginBuckets.set(key, bucket);
  }

  if (now < bucket.lockUntil) return false;

  // Refill tokens
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * fillRateSec);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    bucket.lockUntil = now + 15_000; // 15s cooldown
    return false;
  }

  bucket.tokens -= 1;
  return true;
}

interface CachedSession {
  user: SessionUser;
  expiresAt: number;
  lastDbSync: number;
}

export class AuthManager {
  private pool: pg.Pool;
  private sessionCache = new Map<string, CachedSession>();

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async register(
    username: string,
    passwordPlain: string,
    ip: string,
    core: ExchangeCore
  ): Promise<{ user: SessionUser; sessionToken: string; csrfToken: string }> {
    if (!config.REGISTRATION_ENABLED) {
      throw new Error('REGISTRATION_DISABLED');
    }

    if (config.RATE_LIMIT_PROFILE !== 'bench' && !checkRateLimit(`reg:${ip}`, 3, 0.2)) {
      throw new Error('RATE_LIMITED');
    }

    const client = await this.pool.connect();
    try {
      const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error('USERNAME_TAKEN');
      }

      const pwdHash = await hash(passwordPlain, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });

      const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;

      await client.query('BEGIN');

      await client.query(
        `INSERT INTO users (id, username, password_hash, role, is_demo, is_simulated)
         VALUES ($1, $2, $3, 'user', false, false)`,
        [userId, username, pwdHash]
      );

      // Ledger accounts
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES
           ($1, 'USER_AVAILABLE', $2, NULL),
           ($3, 'USER_RESERVED', $2, NULL),
           ($4, 'ESCROW', $2, NULL)`,
        [`acc_${userId}_cash_avail`, userId, `acc_${userId}_cash_res`, `acc_${userId}_cash_esc`]
      );

      // Initial starter grant
      const grantAmount = config.STARTER_GRANT_DKC;
      if (grantAmount > 0) {
        const jId = `j_grant_${userId}_init`;
        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id)
           VALUES ($1, 'GRANT', 'STARTER_GRANT', $2)`,
          [jId, userId]
        );
        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES
             ($1, 'acc_issuer_cash', 'CASH', $2, 1),
             ($1, $3, 'CASH', $4, 2)`,
          [jId, -grantAmount, `acc_${userId}_cash_avail`, grantAmount]
        );
        await client.query(
          `INSERT INTO balances (user_id, available, reserved, escrow)
           VALUES ($1, $2, 0, 0)`,
          [userId, grantAmount]
        );

        // Update core in-memory balance immediately
        core.getBalance(userId).available = grantAmount;
      } else {
        await client.query(
          `INSERT INTO balances (user_id, available, reserved, escrow)
           VALUES ($1, 0, 0, 0)`,
          [userId]
        );
      }

      // Create session
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

      await client.query(
        `INSERT INTO sessions (id, session_token_hash, user_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [`sess_${crypto.randomBytes(8).toString('hex')}`, tokenHash, userId, expiresAt]
      );

      await client.query('COMMIT');

      const user: SessionUser = { id: userId, username, role: 'user', isDemo: false };
      const csrfToken = crypto.randomBytes(16).toString('hex');
      this.sessionCache.set(rawToken, {
        user,
        expiresAt: expiresAt.getTime(),
        lastDbSync: Date.now(),
      });
      return { user, sessionToken: rawToken, csrfToken };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async login(
    username: string,
    passwordPlain: string,
    ip: string
  ): Promise<{ user: SessionUser; sessionToken: string; csrfToken: string }> {
    if (config.RATE_LIMIT_PROFILE !== 'bench') {
      if (!checkRateLimit(`ip:${ip}`, 10, 0.5) || !checkRateLimit(`usr:${username}`, 5, 0.2)) {
        throw new Error('RATE_LIMITED');
      }
    }

    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      password_hash: string;
      role: 'user' | 'admin';
      is_demo: boolean;
    }>('SELECT id, username, password_hash, role, is_demo FROM users WHERE username = $1', [username]);

    const userRow = rows[0];

    // Timing-safe password verification
    const hashToVerify = userRow ? userRow.password_hash : DUMMY_HASH;
    let isValid = false;
    try {
      isValid = await verify(hashToVerify, passwordPlain);
    } catch {
      isValid = false;
    }

    if (!userRow || !isValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

    await this.pool.query(
      `INSERT INTO sessions (id, session_token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [`sess_${crypto.randomBytes(8).toString('hex')}`, tokenHash, userRow.id, expiresAt]
    );

    const user: SessionUser = {
      id: userRow.id,
      username: userRow.username,
      role: userRow.role,
      isDemo: userRow.is_demo,
    };

    const csrfToken = crypto.randomBytes(16).toString('hex');
    this.sessionCache.set(rawToken, {
      user,
      expiresAt: expiresAt.getTime(),
      lastDbSync: Date.now(),
    });
    return { user, sessionToken: rawToken, csrfToken };
  }

  public async validateSession(sessionToken: string): Promise<SessionUser | null> {
    if (!sessionToken || sessionToken.length !== 64) return null;

    const now = Date.now();
    const cached = this.sessionCache.get(sessionToken);
    if (cached) {
      if (now > cached.expiresAt) {
        this.sessionCache.delete(sessionToken);
        return null;
      }
      // Periodically sync last_seen_at in DB (non-blocking in background, at most once per 60s)
      if (now - cached.lastDbSync > 60_000) {
        cached.lastDbSync = now;
        cached.expiresAt = now + 7 * 24 * 3600 * 1000;
        const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        void this.pool.query(
          `UPDATE sessions SET last_seen_at = NOW(), expires_at = NOW() + INTERVAL '7 days' WHERE session_token_hash = $1`,
          [tokenHash]
        ).catch(() => {});
      }
      return cached.user;
    }

    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    const { rows } = await this.pool.query<{
      session_id: string;
      user_id: string;
      username: string;
      role: 'user' | 'admin';
      is_demo: boolean;
      expires_at: Date;
    }>(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username, u.role, u.is_demo
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.session_token_hash = $1`,
      [tokenHash]
    );

    const row = rows[0];
    if (!row) return null;

    if (now > row.expires_at.getTime()) {
      void this.pool.query('DELETE FROM sessions WHERE id = $1', [row.session_id]).catch(() => {});
      return null;
    }

    const user: SessionUser = {
      id: row.user_id,
      username: row.username,
      role: row.role,
      isDemo: row.is_demo,
    };

    this.sessionCache.set(sessionToken, {
      user,
      expiresAt: row.expires_at.getTime(),
      lastDbSync: now,
    });

    return user;
  }

  public async logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    this.sessionCache.delete(sessionToken);
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await this.pool.query('DELETE FROM sessions WHERE session_token_hash = $1', [tokenHash]);
  }
}