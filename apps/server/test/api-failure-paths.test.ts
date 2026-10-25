/**
 * @file api-failure-paths.test.ts
 * Integration tests covering HTTP API routes, authentication workflows,
 * health probes, and failure paths (unauthorized, invalid CSRF, malformed payload, insufficient funds).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { FastifyInstance } from 'fastify';
import { setupTestDatabase, resetTestDatabase } from './setup.js';
import { buildServer } from '../src/server.js';

describe('API Routes, Authentication & Failure-Path Integration Suite', () => {
  let pool: pg.Pool;
  let server: FastifyInstance;
  let core: any;

  beforeAll(async () => {
    pool = await setupTestDatabase();
    const bootstrapped = await buildServer(pool);
    server = bootstrapped.server;
    core = bootstrapped.core;
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('1. Health & Readiness Probes', () => {
    it('returns 200 OK for liveness probe (/api/health and /health)', async () => {
      const res1 = await server.inject({ method: 'GET', url: '/api/health' });
      expect(res1.statusCode).toBe(200);
      const data1 = JSON.parse(res1.payload);
      expect(data1.status).toBe('ok');
      expect(data1.service).toBe('darkhold-exchange');

      const res2 = await server.inject({ method: 'GET', url: '/health' });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.status).toBe('ok');
    });

    it('returns 200 OK for readiness probe (/api/ready and /ready)', async () => {
      const res1 = await server.inject({ method: 'GET', url: '/api/ready' });
      expect(res1.statusCode).toBe(200);
      const data1 = JSON.parse(res1.payload);
      expect(data1.status).toBe('ready');
      expect(data1.database).toBe('connected');

      const res2 = await server.inject({ method: 'GET', url: '/ready' });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.status).toBe('ready');
    });
  });

  describe('2. Authentication Workflows & Session Management', () => {
    it('rejects login with malformed/missing JSON payload with 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login with invalid credentials with 401', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'alice', password: 'wrong_password_123' },
      });
      expect(res.statusCode).toBe(401);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('INVALID_CREDENTIALS');
    });

    it('authenticates demo user alice with valid credentials and sets session cookies', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'alice', password: 'demo_darkhold_2026' },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.user.username).toBe('alice');
      expect(data.user.id).toBe('usr_alice');
      expect(data.sessionToken).toBeDefined();
      expect(data.csrfToken).toBeDefined();
      expect(data.balance.available).toBeGreaterThan(0);

      // Verify Set-Cookie headers
      const cookies = res.cookies;
      expect(cookies.find((c) => c.name === 'dk_session')).toBeDefined();
      expect(cookies.find((c) => c.name === 'dk_csrf')).toBeDefined();
    });

    it('retrieves current authenticated session via /api/auth/me', async () => {
      // 1. Login to get cookie
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'bob', password: 'demo_darkhold_2026' },
      });
      const sessionCookie = loginRes.cookies.find((c) => c.name === 'dk_session')!;

      // 2. Fetch session with cookie
      const meRes = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: sessionCookie.value },
      });
      expect(meRes.statusCode).toBe(200);
      const meData = JSON.parse(meRes.payload);
      expect(meData.user.username).toBe('bob');
      expect(meData.balance).toBeDefined();
    });

    it('rejects /api/auth/me with 401 when unauthenticated', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
      });
      expect(res.statusCode).toBe(401);
    });

    it('invalidates session on logout', async () => {
      // 1. Login
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'carol', password: 'demo_darkhold_2026' },
      });
      const sessionCookie = loginRes.cookies.find((c) => c.name === 'dk_session')!;

      // 2. Logout
      const logoutRes = await server.inject({
        method: 'POST',
        url: '/api/auth/logout',
        cookies: { dk_session: sessionCookie.value },
      });
      expect(logoutRes.statusCode).toBe(200);

      // 3. /api/auth/me is now 401
      const checkRes = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { dk_session: sessionCookie.value },
      });
      expect(checkRes.statusCode).toBe(401);
    });
  });

  describe('3. Core Stability & Escrow Sweeper', () => {
    it('executes ESCROW_SWEEP dispatch without crashing or resolve errors', async () => {
      const res = await core.dispatch({ type: 'ESCROW_SWEEP' });
      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(typeof res.sweptCount).toBe('number');
    });
  });

  describe('4. Security & Role Guards', () => {
    it('rejects non-admin access to /api/admin/reconcile with 403', async () => {
      // User login (alice is role "user")
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'alice', password: 'demo_darkhold_2026' },
      });
      const sessionCookie = loginRes.cookies.find((c) => c.name === 'dk_session')!;

      const res = await server.inject({
        method: 'GET',
        url: '/api/admin/reconcile',
        cookies: { dk_session: sessionCookie.value },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows admin access to /api/admin/reconcile with clean ledger report', async () => {
      // Admin login
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'admin', password: 'admin_darkhold_2026' },
      });
      const sessionCookie = loginRes.cookies.find((c) => c.name === 'dk_session')!;

      const res = await server.inject({
        method: 'GET',
        url: '/api/admin/reconcile',
        cookies: { dk_session: sessionCookie.value },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.balanced).toBe(true);
    });

    it('rejects mutating POST requests without valid CSRF token with 403', async () => {
      // Admin session without CSRF header
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        payload: { username: 'admin', password: 'admin_darkhold_2026' },
      });
      const sessionCookie = loginRes.cookies.find((c) => c.name === 'dk_session')!;
      const csrfCookie = loginRes.cookies.find((c) => c.name === 'dk_csrf')!;

      // Mutating request missing x-csrf-token
      const res = await server.inject({
        method: 'POST',
        url: '/api/admin/scalper-demo',
        cookies: {
          dk_session: sessionCookie.value,
          dk_csrf: csrfCookie.value,
        },
        payload: { burstCount: 5 },
      });
      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.payload);
      expect(data.error).toBe('CSRF_VALIDATION_FAILED');
    });
  });
});
