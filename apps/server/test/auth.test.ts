import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { setupTestDatabase, resetTestDatabase, TEST_DB_URL } from './setup.js';
import { AuthManager } from '../src/auth.js';
import { FakeClock } from '../src/clock.js';
import { bootstrapCore } from '../src/recovery.js';

describe('Auth & Security Isolation Test Suite', () => {
  let pool: pg.Pool;
  let auth: AuthManager;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    auth = new AuthManager(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verifies valid login and rejects invalid credentials', async () => {
    const valid = await auth.login('alice', 'demo_darkhold_2026', '127.0.0.1');
    expect(valid.user.username).toBe('alice');
    expect(valid.sessionToken.length).toBe(64);

    await expect(auth.login('alice', 'wrong_password', '127.0.0.1')).rejects.toThrow(
      'INVALID_CREDENTIALS'
    );
    await expect(auth.login('unknown_user_999', 'any_pass', '127.0.0.1')).rejects.toThrow(
      'INVALID_CREDENTIALS'
    );
  });

  it('validates active session and invalidates on logout', async () => {
    const { sessionToken, user } = await auth.login('bob', 'demo_darkhold_2026', '127.0.0.1');
    const validated = await auth.validateSession(sessionToken);
    expect(validated).not.toBeNull();
    expect(validated!.id).toBe(user.id);

    await auth.logout(sessionToken);
    const postLogout = await auth.validateSession(sessionToken);
    expect(postLogout).toBeNull();
  });

  it('prevents registration with duplicate username', async () => {
    const core = await bootstrapCore(pool, new FakeClock(), 1, 1, true);
    await expect(auth.register('alice', 'secure_password_10chars', '127.0.0.1', core)).rejects.toThrow(
      'USERNAME_TAKEN'
    );
  });
});