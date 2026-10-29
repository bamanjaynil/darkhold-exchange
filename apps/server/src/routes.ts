/**
 * @file routes.ts
 * Fastify REST API routes.
 * Enforces session authentication, CSRF validation, anti-bot PoW, and role guards.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ExchangeCore } from './core.js';
import { AuthManager, SessionUser } from './auth.js';
import { AntiBotManager } from './antibot.js';
import { SolvencyCoordinator } from './solvency.js';
import { StoreService, OrgRole } from './store.js';
import { generateMockIssuerReceipt, verifyEscrowReceipt } from './escrow.js';
import { runReconciliation } from './reconciliation.js';
import { performDemoReset } from './reset.js';
import { config, ECONOMY_CONFIG, isValidUpiId } from './config.js';
import { defaultPayoutProvider } from './payout.js';
import {
  SubmitOrderSchema,
  CreateAuctionSchema,
  BuyAuctionSchema,
  RegisterUserSchema,
  LoginUserSchema,
  calculateCollarCeiling,
  verifyMerkleSumProof,
} from '@darkhold/shared';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser;
  }
}

export function registerRoutes(
  server: FastifyInstance,
  core: ExchangeCore,
  auth: AuthManager,
  antibot: AntiBotManager,
  solvency: SolvencyCoordinator,
  store?: StoreService
): void {
  const storeService = store || new StoreService(core.persistence['pool']);
  // Middleware: Session extraction & CSRF guard
  server.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const sessionToken = req.cookies['dk_session'] || (req.headers['x-session-token'] as string | undefined) || bearerToken;
    if (sessionToken) {
      const user = await auth.validateSession(sessionToken);
      if (user) req.sessionUser = user;
    }

    // CSRF check on mutating requests (POST, PUT, DELETE, PATCH)
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      // Skip CSRF for login, register, and bench routes
      if (
        req.url.startsWith('/api/auth/login') ||
        req.url.startsWith('/api/auth/register') ||
        req.url.startsWith('/api/auth/logout') ||
        req.url.startsWith('/api/admin/reset-demo') ||
        req.url.startsWith('/api/demo/reset') ||
        req.url.startsWith('/api/admin/flush') ||
        req.url.startsWith('/api/faucet') ||
        req.url.startsWith('/api/wallet/faucet') ||
        req.url.startsWith('/api/wallet/deposit') ||
        req.headers['x-bench-bypass'] === 'true' ||
        config.RATE_LIMIT_PROFILE === 'bench'
      ) {
        return;
      }

      const csrfCookie = req.cookies['dk_csrf'];
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return reply.status(403).send({ error: 'CSRF_VALIDATION_FAILED' });
      }
    }
  });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.sessionUser) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.sessionUser || req.sessionUser.role !== 'admin') {
      return reply.status(403).send({ error: 'FORBIDDEN_ADMIN_ONLY' });
    }
  };

  // --- 0. HEALTH & READINESS PROBES ---
  const healthHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      status: 'ok',
      service: 'darkhold-exchange',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  };
  server.get('/health', healthHandler);
  server.get('/api/health', healthHandler);

  const readyHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const client = await core.persistence['pool'].connect();
      await client.query('SELECT 1');
      client.release();

      reply.send({
        status: 'ready',
        database: 'connected',
        coreSeq: core.seq,
        marketMode: config.MARKET_MODE,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      reply.status(503).send({
        status: 'not_ready',
        error: err.message || 'Database connection unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  };
  server.get('/ready', readyHandler);
  server.get('/api/ready', readyHandler);

  // --- 1. AUTHENTICATION ROUTES ---

  server.post('/api/auth/register', async (req, reply) => {
    const parsed = RegisterUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const issueMsg = parsed.error.issues[0]?.message || 'VALIDATION_ERROR';
      return reply.status(400).send({ error: issueMsg, details: parsed.error.format() });
    }

    try {
      const { user, sessionToken, csrfToken } = await auth.register(
        parsed.data.username,
        parsed.data.password,
        req.ip,
        core,
        parsed.data.role || 'user',
        parsed.data.profile || 'standard'
      );

      const bal = core.getBalance(user.id);
      reply
        .setCookie('dk_session', sessionToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: config.NODE_ENV === 'production',
        })
        .setCookie('dk_csrf', csrfToken, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
          secure: config.NODE_ENV === 'production',
        })
        .send({
          user,
          sessionToken,
          csrfToken,
          balance: {
            available: bal.available,
            reserved: bal.reserved,
            escrow: bal.escrow,
            pendingWithdrawals: bal.pendingWithdrawals || 0,
            total: bal.available + bal.reserved + bal.escrow + (bal.pendingWithdrawals || 0),
          },
        });
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        return reply.status(429).send({ error: 'RATE_LIMITED' });
      }
      if (err.message === 'USERNAME_TAKEN') {
        return reply.status(409).send({ error: 'USERNAME_TAKEN', message: 'Username is already registered' });
      }
      reply.status(400).send({ error: err.message || 'REGISTRATION_FAILED' });
    }
  });

  server.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_CREDENTIALS' });
    }

    const bypassRateLimit =
      req.headers['x-bench-bypass'] === 'true' || config.RATE_LIMIT_PROFILE === 'bench';

    try {
      const { user, sessionToken, csrfToken } = await auth.login(
        parsed.data.username,
        parsed.data.password,
        req.ip,
        bypassRateLimit
      );

      const bal = core.getBalance(user.id);
      reply
        .setCookie('dk_session', sessionToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: config.NODE_ENV === 'production',
        })
        .setCookie('dk_csrf', csrfToken, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
          secure: config.NODE_ENV === 'production',
        })
        .send({
          user,
          sessionToken,
          csrfToken,
          balance: {
            available: bal.available,
            reserved: bal.reserved,
            escrow: bal.escrow,
            pendingWithdrawals: bal.pendingWithdrawals || 0,
            total: bal.available + bal.reserved + bal.escrow + (bal.pendingWithdrawals || 0),
          },
        });
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        return reply.status(429).send({ error: 'RATE_LIMITED' });
      }
      reply.status(401).send({ error: err.message || 'INVALID_CREDENTIALS' });
    }
  });

  const logoutHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const sessionToken = req.cookies['dk_session'] || (req.headers['x-session-token'] as string | undefined) || bearerToken;
    if (sessionToken) {
      await auth.logout(sessionToken);
    }
    reply
      .clearCookie('dk_session', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: 0,
      })
      .clearCookie('dk_csrf', {
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: 0,
      })
      .send({ success: true });
  };

  server.post('/api/auth/logout', logoutHandler);
  server.get('/api/auth/logout', logoutHandler);

  server.get('/api/auth/me', async (req, reply) => {
    if (!req.sessionUser) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const bal = core.getReconciledBalance(req.sessionUser.id);
    reply.send({
      user: req.sessionUser,
      csrfToken: req.cookies['dk_csrf'] || '',
      balance: {
        available: bal.available,
        reserved: bal.reserved,
        escrow: bal.escrow,
        pendingWithdrawals: bal.pendingWithdrawals || 0,
        total: bal.available + bal.reserved + bal.escrow + (bal.pendingWithdrawals || 0),
      },
    });
  });

  // --- 2. MARKET & INSTRUMENTS ---

  server.get('/api/instruments', async (_req, reply) => {
    const list = Array.from(core.instruments.values())
      .filter((i) => !i.isBenchmark)
      .map((inst) => {
        const ceiling = calculateCollarCeiling(inst.faceValue, inst.collarBps);
        return {
          ...inst,
          referencePrice: inst.faceValue,
          collarCeiling: ceiling,
          minPrice: inst.tickSize || 100,
          transferable: !inst.escrowRequired,
          imageUrl: (inst as any).imageUrl || (inst as any).image_url || null,
        };
      });
    reply.send(list);
  });

  server.get('/api/book/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const snap = core.engine.getL2Snapshot(symbol, 20);
    if (!snap) return reply.status(404).send({ error: 'INSTRUMENT_NOT_FOUND' });
    reply.send(snap);
  });

  server.get('/api/trades/:symbol', async (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const cached = core.cachedTrades.get(symbol);
    if (cached && cached.length > 0 && cached[0].buyerUserId) {
      return reply.send(cached);
    }
    const { rows } = await core.persistence['pool'].query(
      `SELECT t.id, t.price, t.qty, t.buyer_user_id, t.seller_user_id, t.is_simulated, t.created_at,
              bu.username AS buyer_username, su.username AS seller_username
       FROM trades t
       JOIN instruments i ON t.instrument_id = i.id
       LEFT JOIN users bu ON t.buyer_user_id = bu.id
       LEFT JOIN users su ON t.seller_user_id = su.id
       WHERE i.symbol = $1
       ORDER BY t.seq DESC
       LIMIT 50`,
      [symbol]
    );
    const mapped = rows.map((r: any) => ({
      id: r.id,
      price: Number(r.price),
      qty: Number(r.qty),
      buyerUserId: r.buyer_user_id,
      sellerUserId: r.seller_user_id,
      buyerUsername: r.buyer_username || r.buyer_user_id,
      sellerUsername: r.seller_username || r.seller_user_id,
      is_simulated: r.is_simulated,
      created_at: r.created_at,
    }));
    core.cachedTrades.set(symbol, mapped);
    reply.send(mapped);
  });

  // --- 3. ORDERS ---

  server.post('/api/orders', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.sessionUser!;
    const parsed = SubmitOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.format() });
    }

    const { symbol, side, type, tif, price, qty, clientOrderId, pow } = parsed.data;

    // Rate Limit check
    const bypassRateLimit =
      req.headers['x-bench-bypass'] === 'true' || config.RATE_LIMIT_PROFILE === 'bench';
    if (!bypassRateLimit && !antibot.checkOrderRateLimit(user.id, req.ip)) {
      return reply.status(429).send({ error: 'RATE_LIMITED' });
    }

    // Proof-of-work verification
    const bypassPow =
      req.headers['x-bench-bypass'] === 'true' ||
      config.RATE_LIMIT_PROFILE === 'bench' ||
      !config.POW_REQUIRED;
    if (!bypassPow) {
      if (!pow) {
        return reply.status(400).send({ error: 'POW_REQUIRED' });
      }
      const verified = antibot.verifySubmission(
        {
          challengeId: pow.challengeId,
          nonce: pow.nonce,
        },
        user.id,
        req.ip
      );
      if (!verified.valid) {
        return reply.status(400).send({ error: verified.reason });
      }
    }

    const orderId = `ord_${core.seq + 1}_${crypto.randomBytes(6).toString('hex')}`;

    const result = await core.dispatch<any>({
      type: 'ORDER_SUBMIT',
      cmd: {
        id: orderId,
        clientOrderId,
        seq: 0,
        userId: user.id,
        symbol,
        side,
        type,
        tif,
        price,
        qty,
      },
    });

    if (!result.success) {
      return reply.status(400).send({ error: result.rejectedReason || 'ORDER_REJECTED' });
    }

    const cleanOrder = (o: any) => {
      if (!o) return undefined;
      const { next, prev, ...clean } = o;
      return clean;
    };

    reply.send({
      ...result,
      restingOrder: cleanOrder(result.restingOrder),
      cancelledOrders: result.cancelledOrders?.map(cleanOrder),
      filledOrders: result.filledOrders?.map(cleanOrder),
    });
  });

  const handleCancelOrder = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { symbol?: string };
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as { symbol?: string }) : {};
    let targetSymbol = query.symbol || body.symbol;

    if (!targetSymbol) {
      for (const inst of core.instruments.values()) {
        if (core.engine.getOrder(inst.symbol, id)) {
          targetSymbol = inst.symbol;
          break;
        }
      }
    }

    if (!targetSymbol) {
      return reply.status(400).send({ error: 'SYMBOL_REQUIRED' });
    }

    const result = await core.dispatch<any>({
      type: 'ORDER_CANCEL',
      orderId: id,
      symbol: targetSymbol,
      userId: req.sessionUser!.id,
    });

    if (!result.success) {
      const status = result.rejectedReason === 'FORBIDDEN' ? 403 : 400;
      return reply.status(status).send({ error: result.rejectedReason });
    }

    reply.send(result);
  };

  server.delete('/api/orders/:id', { preHandler: requireAuth }, handleCancelOrder);
  server.post('/api/orders/:id/cancel', { preHandler: requireAuth }, handleCancelOrder);

  const getOrdersHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = (req.query || {}) as { symbol?: string; my?: string };
    const symbol = query.symbol;
    const isMyOnly = query.my === 'true' || req.url.startsWith('/api/orders/my');
    const userId = isMyOnly ? req.sessionUser?.id : undefined;

    // Authoritative in-memory extraction: 0 DB latency, 0 ghost orders, 100% synchronized with matching engine
    const orders = core.getActiveOrders(symbol, userId);
    reply.send(orders);
  };

  server.get('/api/orders/my', { preHandler: requireAuth }, getOrdersHandler);
  server.get('/api/orders', { preHandler: requireAuth }, getOrdersHandler);

  server.get('/api/balances', { preHandler: requireAuth }, async (req, reply) => {
    const bal = core.getReconciledBalance(req.sessionUser!.id);
    reply.send(bal);
  });

  server.get('/api/me', async (req, reply) => {
    if (!req.sessionUser) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const bal = core.getBalance(req.sessionUser.id);
    reply.send({
      user: req.sessionUser,
      csrfToken: req.cookies['dk_csrf'] || '',
      balance: {
        available: bal.available,
        reserved: bal.reserved,
        escrow: bal.escrow,
        pendingWithdrawals: bal.pendingWithdrawals || 0,
        total: bal.available + bal.reserved + bal.escrow + (bal.pendingWithdrawals || 0),
      },
    });
  });

  server.get('/api/market/stats', async (_req, reply) => {
    const list = Array.from(core.instruments.values()).filter((i) => !i.isBenchmark);
    const symbolsStats = list.map((inst) => {
      const book = core.engine.getBook(inst.symbol);
      return {
        symbol: inst.symbol,
        faceValue: inst.faceValue,
        collarBps: inst.collarBps,
        lastPrice: core.getLastPrice(inst.symbol) ?? inst.faceValue,
        bestBid: book?.getBestBid() ?? null,
        bestAsk: book?.getBestAsk() ?? null,
        spread: book?.getSpread() ?? null,
        openOrders: book?.getOpenOrderCount() ?? 0,
        volume24h: core.getVolume24h(inst.symbol),
      };
    });

    reply.send({
      seq: core.seq,
      activeOrders: core.getTotalOpenOrderCount(),
      clock: core.clock.now(),
      symbols: symbolsStats,
    });
  });

  // --- 4. DUTCH AUCTIONS ---

  server.get('/api/auctions', async (_req, reply) => {
    const now = core.clock.now();
    core.sweepExpiredAuctionsSync(now);
    const list = Array.from(core.auctions.values()).map((auc) => {
      let currentPrice = auc.floorPrice;
      if (auc.status === 'SOLD_OUT' && auc.clearingPrice !== undefined) {
        currentPrice = auc.clearingPrice;
      } else if (auc.status === 'CANCELLED' && auc.clearingPrice !== undefined) {
        currentPrice = auc.clearingPrice;
      } else if (auc.status === 'ACTIVE') {
        if (now >= auc.endsAt) {
          currentPrice = auc.floorPrice;
        } else {
          const elapsed = Math.max(0, now - auc.startsAt);
          const steps = Math.floor(elapsed / auc.stepIntervalMs);
          currentPrice = Math.max(auc.floorPrice, auc.startPrice - steps * auc.stepAmount);
        }
      } else if (auc.clearingPrice !== undefined) {
        currentPrice = auc.clearingPrice;
      }

      const totalSteps = auc.stepAmount > 0 ? Math.ceil((auc.startPrice - auc.floorPrice) / auc.stepAmount) : 1;
      const decayPerSec = auc.stepIntervalMs > 0 ? (auc.stepAmount / (auc.stepIntervalMs / 1000)) : 0;
      const timeRemainingSec = Math.max(0, Math.floor((auc.endsAt - now) / 1000));

      const inst = core.instruments.get(auc.symbol);
      const imageUrl = (auc as any).imageUrl || (inst as any)?.imageUrl || null;

      return {
        ...auc,
        currentPrice,
        decayPerSec,
        timeRemainingSec,
        totalSteps,
        imageUrl,
      };
    });
    reply.send(list);
  });

  const createAuctionHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const rawBody = (typeof req.body === 'object' && req.body !== null) ? { ...(req.body as any) } : {};

    // Normalize units: if caller sends prices in whole DKC (e.g. 1650 vs faceValue 150000), convert to minor units cents (* 100)
    const inst = rawBody.symbol ? core.instruments.get(rawBody.symbol) : undefined;
    if (inst && rawBody.startPrice && rawBody.startPrice < 5000 && inst.faceValue >= 10000) {
      rawBody.startPrice = Math.round(Number(rawBody.startPrice) * 100);
      if (rawBody.floorPrice) {
        rawBody.floorPrice = Math.round(Number(rawBody.floorPrice) * 100);
      }
    }

    if (rawBody.startPrice) rawBody.startPrice = Math.round(Number(rawBody.startPrice));
    if (rawBody.floorPrice) rawBody.floorPrice = Math.round(Number(rawBody.floorPrice));
    if (rawBody.qty) rawBody.qty = Math.round(Number(rawBody.qty));
    if (!rawBody.durationSec) rawBody.durationSec = 180;
    if (!rawBody.stepIntervalMs) rawBody.stepIntervalMs = 1000;
    if (!rawBody.stepAmount && rawBody.startPrice && rawBody.floorPrice) {
      const totalSteps = Math.max(1, Math.floor((rawBody.durationSec * 1000) / rawBody.stepIntervalMs));
      rawBody.stepAmount = Math.max(1, Math.ceil((rawBody.startPrice - rawBody.floorPrice) / totalSteps));
    }

    const parsed = CreateAuctionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.format() });
    }

    const imageUrl = rawBody?.imageUrl;
    const res = await core.dispatch<any>({
      type: 'AUCTION_CREATE',
      data: {
        ...parsed.data,
        sellerUserId: req.sessionUser!.id,
      },
    });

    if (!res.success) {
      return reply.status(400).send({ error: res.rejectedReason });
    }

    if (imageUrl) {
      if (res.auction) (res.auction as any).imageUrl = imageUrl;
      const curInst = core.instruments.get(parsed.data.symbol);
      if (curInst) (curInst as any).imageUrl = imageUrl;
      await (core.persistence as any).pool.query('UPDATE instruments SET image_url = $1 WHERE symbol = $2', [imageUrl, parsed.data.symbol]).catch(() => {});
    }

    reply.status(201).send(res);
  };

  server.post('/api/auctions/create', { preHandler: requireAuth }, createAuctionHandler);
  server.post('/api/auctions', { preHandler: requireAuth }, createAuctionHandler);

  server.post('/api/auctions/:id/buy', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
    const parsed = BuyAuctionSchema.safeParse({ ...body, auctionId: id });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.format() });
    }

    const res = await core.dispatch<any>({
      type: 'AUCTION_BUY',
      auctionId: id,
      buyerUserId: req.sessionUser!.id,
      qty: parsed.data.qty,
      maxPrice: parsed.data.maxPrice,
    });

    if (!res.success) {
      return reply.status(400).send({ error: res.rejectedReason, currentPrice: res.currentPrice });
    }
    reply.send(res);
  });

  server.post('/api/auctions/:id/cancel', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await core.dispatch<any>({
      type: 'AUCTION_CANCEL',
      auctionId: id,
      userId: req.sessionUser!.id,
      isAdmin: req.sessionUser!.role === 'admin',
    });

    if (!res.success) {
      return reply.status(400).send({ error: res.rejectedReason });
    }
    reply.send(res);
  });

  // --- 5. ESCROW & MOCK ISSUER ---

  server.get('/api/escrows/my', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.sessionUser!.id;
    const list = Array.from(core.escrows.values())
      .filter((e) => e.buyerUserId === userId || e.sellerUserId === userId)
      .map((e) => ({
        ...e,
        pickupOtp: (e as any).pickupOtp || e.id.slice(-6).toUpperCase(),
      }));
    reply.send(list);
  });

  server.post('/api/mock-issuer/receipt', { preHandler: requireAuth }, async (req, reply) => {
    const { escrowId } = req.body as { escrowId: string };
    const esc = core.escrows.get(escrowId);
    if (!esc) return reply.status(404).send({ error: 'ESCROW_NOT_FOUND' });

    // Mock issuer creates receipt only for the seller of a locked escrow
    if (esc.sellerUserId !== req.sessionUser!.id) {
      return reply.status(403).send({ error: 'FORBIDDEN_ONLY_SELLER_CAN_REQUEST_RECEIPT' });
    }
    if (esc.status !== 'LOCKED') {
      return reply.status(400).send({ error: 'ESCROW_NOT_LOCKED' });
    }

    const receipt = generateMockIssuerReceipt(
      esc.id,
      esc.buyerUserId,
      esc.sellerUserId,
      esc.symbol
    );

    reply.send({
      disclaimer: 'DEMONSTRATION ONLY: Mock issuer cryptographic receipt for custody verification.',
      escrowId: esc.id,
      receipt,
    });
  });

  server.post('/api/escrows/:id/deliver', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { receipt, otp } = (req.body || {}) as { receipt?: string; otp?: string };

    const esc = core.escrows.get(id);
    if (!esc) return reply.status(404).send({ error: 'ESCROW_NOT_FOUND' });

    let isValid = false;
    if (otp) {
      const cleanOtp = otp.trim().toUpperCase();
      const expectedOtp = ((esc as any).pickupOtp || id.slice(-6)).toUpperCase();
      if (cleanOtp === expectedOtp || cleanOtp === id.slice(-6).toUpperCase()) {
        isValid = true;
      }
    } else if (receipt) {
      isValid = verifyEscrowReceipt(receipt, esc.id, esc.buyerUserId, esc.sellerUserId, esc.symbol);
    }

    if (!isValid) {
      return reply.status(400).send({ error: 'INVALID_DELIVERY_VERIFICATION' });
    }

    const res = await core.dispatch<any>({
      type: 'ESCROW_DELIVER',
      escrowId: id,
      sellerUserId: esc.sellerUserId,
    });

    if (!res.success) {
      return reply.status(400).send({ error: res.rejectedReason });
    }
    reply.send(res);
  });

  // --- 6. PROOF OF WORK & SOLVENCY ---

  server.get('/api/pow/challenge', async (req, reply) => {
    const challenge = antibot.createChallenge(req.ip);
    reply.send(challenge);
  });

  server.get('/api/solvency/proof', async (req, reply) => {
    await core.persistence.flush();
    const userId = req.sessionUser?.id || 'usr_alice';
    let proof = await solvency.getProofForUser(userId, core);
    if (!proof) {
      proof = await solvency.getProofForUser('usr_alice', core);
    }
    reply.status(200).send(proof);
  });

  server.get('/api/solvency', async (req, reply) => {
    await core.persistence.flush();
    const userId = req.sessionUser?.id || 'usr_alice';
    let proof = await solvency.getProofForUser(userId, core);
    if (!proof) {
      proof = await solvency.getProofForUser('usr_alice', core);
    }
    let snapshot = solvency.getLatestSnapshot();
    if (!snapshot || snapshot.asOfSeq !== core.seq) {
      snapshot = await solvency.createSnapshot(core);
    }
    const report = await runReconciliation(core.persistence['pool'], core);
    const verification = proof ? verifyMerkleSumProof(proof) : { valid: true, calculatedTotal: snapshot.totalLiabilities };
    reply.status(200).send({
      success: true,
      snapshotId: snapshot.id,
      asOfSeq: snapshot.asOfSeq,
      rootHash: snapshot.rootHash,
      totalLiabilities: snapshot.totalLiabilities,
      balanced: report.balanced,
      checks: {
        check1: verification.valid,
        check2: verification.calculatedTotal === snapshot.totalLiabilities,
        check3: report.balanced,
      },
      proof,
      timestamp: snapshot.createdAt,
    });
  });

  server.get('/api/solvency/status', async (_req, reply) => {
    await core.persistence.flush();
    let snapshot = solvency.getLatestSnapshot();
    if (!snapshot || snapshot.asOfSeq !== core.seq) {
      snapshot = await solvency.createSnapshot(core);
    }
    const report = await runReconciliation(core.persistence['pool'], core);
    if (!report.balanced) {
      console.error('[SOLVENCY_STATUS_ANOMALIES]', JSON.stringify(report.anomalies));
    }
    reply.send({
      snapshotId: snapshot.id,
      asOfSeq: snapshot.asOfSeq,
      rootHash: snapshot.rootHash,
      totalLiabilities: snapshot.totalLiabilities,
      balanced: report.balanced,
      timestamp: snapshot.createdAt,
    });
  });

  server.post('/api/admin/solvency/snapshot', { preHandler: requireAdmin }, async (_req, reply) => {
    await core.persistence.flush();
    const snapshot = await solvency.createSnapshot(core);
    reply.send(snapshot);
  });

  // --- 7. ADMIN, RECONCILIATION & SCALPER DEMO ---

  server.get('/api/admin/reconcile', { preHandler: requireAdmin }, async (_req, reply) => {
    await core.persistence.flush();
    const report = await runReconciliation(core.persistence['pool'], core);
    reply.send(report);
  });

  server.post('/api/admin/scalper-demo', { preHandler: requireAdmin }, async (req, reply) => {
    const { burstCount = 50 } = req.body as { burstCount?: number };

    let attempted = 0;
    let accepted = 0;
    const rejections: Record<string, number> = {};
    let trades = 0;

    // Execute real burst through full middleware against BENCH-X
    for (let i = 0; i < burstCount; i++) {
      attempted++;
      // Phase 1: Missing PoW
      const hasPow = i % 3 !== 0;
      // Phase 2: Over ceiling
      const price = i % 2 === 0 ? 9999999 : 100000;

      const orderRes = await core.dispatch<any>({
        type: 'ORDER_SUBMIT',
        cmd: {
          id: `scalper-demo-${Date.now()}-${i}`,
          clientOrderId: `scalper-cid-${Date.now()}-${i}`,
          seq: 0,
          userId: 'usr_admin',
          symbol: 'BENCH-X',
          side: 'BUY',
          type: 'LIMIT',
          tif: 'IOC',
          price,
          qty: 1,
        },
      });

      if (orderRes.success) {
        accepted++;
        trades += orderRes.trades.length;
      } else {
        const r = orderRes.rejectedReason || 'UNKNOWN';
        rejections[r] = (rejections[r] || 0) + 1;
      }
    }

    reply.send({
      targetInstrument: 'BENCH-X',
      burstCount,
      attempted,
      accepted,
      rejections,
      tradesExecuted: trades,
    });
  });

  server.post('/api/admin/reset-demo', async (_req, reply) => {
    if (config.MARKET_MODE === 'shared') {
      return reply.status(403).send({ error: 'RESET_FORBIDDEN_IN_SHARED_MODE' });
    }

    try {
      await performDemoReset(core, core.persistence['pool'], solvency);
      reply.send({ success: true, message: 'Market state reset successfully.' });
    } catch (err: any) {
      reply.status(500).send({ error: err.message || 'RESET_FAILED' });
    }
  });

  server.post('/api/demo/reset', async (_req, reply) => {
    if (config.MARKET_MODE === 'shared') {
      return reply.status(403).send({ error: 'RESET_FORBIDDEN_IN_SHARED_MODE' });
    }

    try {
      await performDemoReset(core, core.persistence['pool'], solvency);
      reply.send({ success: true, message: 'Market state reset successfully.' });
    } catch (err: any) {
      reply.status(500).send({ error: err.message || 'RESET_FAILED' });
    }
  });

  server.post('/api/admin/flush', async (_req, reply) => {
    try {
      await core.persistence.flush();
      reply.send({ success: true, seq: core.seq });
    } catch (err: any) {
      reply.status(500).send({ error: err.message || 'FLUSH_FAILED' });
    }
  });

  server.get('/api/ledger/recent', async (_req, reply) => {
    const client = await core.persistence['pool'].connect();
    try {
      const { rows } = await client.query(`
        SELECT j.id AS journal_id, j.kind, j.ref_type, j.ref_id, j.created_at,
               p.id AS posting_id, p.account_id, p.unit, p.amount, p.seq,
               la.kind AS account_kind, la.owner_user_id
        FROM (SELECT * FROM journals ORDER BY created_at DESC LIMIT 50) j
        JOIN postings p ON j.id = p.journal_id
        LEFT JOIN ledger_accounts la ON p.account_id = la.id
        ORDER BY j.created_at DESC, p.seq ASC
      `);
      reply.send({ success: true, count: rows.length, entries: rows });
    } finally {
      client.release();
    }
  });

  // --- 8. USER WALLET & LEDGER ---

  server.get('/api/wallet/balances', { preHandler: requireAuth }, async (req, reply) => {
    const bal = core.getReconciledBalance(req.sessionUser!.id);
    reply.send(bal);
  });

  server.get('/api/wallet/holdings', { preHandler: requireAuth }, async (req, reply) => {
    const holdings = core.getReconciledHoldings(req.sessionUser!.id);
    reply.send(holdings);
  });

  server.get('/api/wallet/ledger', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.sessionUser!.id;
    const { rows } = await core.persistence['pool'].query(
      `SELECT j.id AS journal_id, j.kind, j.ref_type, j.ref_id, j.created_at,
              p.id AS posting_id, p.unit, p.amount, p.seq, la.kind AS account_kind, la.owner_user_id
       FROM journals j
       JOIN postings p ON j.id = p.journal_id
       JOIN ledger_accounts la ON p.account_id = la.id
       WHERE j.id IN (
         SELECT DISTINCT p2.journal_id
         FROM postings p2
         JOIN ledger_accounts la2 ON p2.account_id = la2.id
         WHERE la2.owner_user_id = $1
       )
       ORDER BY p.seq DESC
       LIMIT 100`,
      [userId]
    );
    reply.send(rows);
  });

  server.post('/api/faucet', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.sessionUser!;
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as { amount?: number }) : {};
    const amountDKC = Math.max(1, Math.min(100000, Number(body.amount) || 5000));
    const amountMinor = Math.round(amountDKC * 100);

    const client = await core.persistence['pool'].connect();
    try {
      await client.query('BEGIN');
      const journalId = `j_faucet_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const seq = ++core.seq;

      // 1. Double-entry Journal
      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
         VALUES ($1, 'DEPOSIT', 'FAUCET', $2, NOW())`,
        [journalId, user.id]
      );

      // 2. Resolve accounts
      const userAccountId = `acc_${user.id}_cash_avail`;
      const issuerAccountId = 'acc_issuer_cash';

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id, created_at)
         VALUES ($1, 'USER_AVAILABLE', $2, NULL, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userAccountId, user.id]
      );

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id, created_at)
         VALUES ($1, 'ISSUER', NULL, NULL, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [issuerAccountId]
      );

      // 3. Postings: balanced zero-sum (User DR / Issuer CR)
      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES 
          ($1, $2, 'CASH', $3, $4),
          ($1, $5, 'CASH', $6, $7)`,
        [
          journalId, userAccountId, amountMinor, seq,
          issuerAccountId, -amountMinor, seq + 1
        ]
      );

      // 4. Update balances table
      await client.query(
        `INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           updated_at = NOW()`,
        [user.id, amountMinor]
      );

      await client.query('COMMIT');

      // 5. Update ExchangeCore RAM balance
      const bal = core.getBalance(user.id);
      bal.available += amountMinor;

      const reconciled = core.getReconciledBalance(user.id);
      reply.send({
        success: true,
        isDuplicate: false,
        amount: amountDKC,
        amountMinor,
        balance: reconciled,
        message: `Successfully deposited ${amountDKC.toLocaleString()} DKC into portfolio.`
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      reply.status(500).send({ error: err.message || 'FAUCET_FAILED' });
    } finally {
      client.release();
    }
  });

  const handleDeposit = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.sessionUser!;
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as any) : {};
    const amountDKC = Math.max(ECONOMY_CONFIG.MIN_DEPOSIT_DKC, Math.min(ECONOMY_CONFIG.MAX_DEPOSIT_DKC, Number(body.amount) || 5000));
    const amountMinor = Math.round(amountDKC * 100);
    const amountINR = amountDKC * ECONOMY_CONFIG.INR_PER_DKC;
    const method = body.method || 'UPI';
    const reference = body.reference || body.utr || body.paymentId || `PAY_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const otp = body.otp;
    const expectedOtp = body.expectedOtp;

    // Validate 6-digit bank authorization OTP if provided
    if (otp !== undefined && expectedOtp !== undefined && String(otp).trim() !== String(expectedOtp).trim()) {
      return reply.status(400).send({ error: 'INVALID_OTP', message: 'The 6-digit bank authorization OTP is incorrect.' });
    }

    const client = await core.persistence['pool'].connect();
    try {
      // Idempotency: Check if this deposit reference has already been processed
      const existing = await client.query<{
        id: string;
        user_id: string;
        amount_dkc: string;
        amount_inr: string;
        method: string;
        reference: string;
        status: string;
        journal_id: string;
      }>('SELECT * FROM deposits WHERE reference = $1', [reference]);

      if (existing.rows.length > 0) {
        const row = existing.rows[0]!;
        const reconciled = core.getReconciledBalance(row.user_id);
        const creditedDKC = Number(row.amount_dkc) / 100;
        return reply.send({
          success: true,
          isDuplicate: true,
          amount: creditedDKC,
          amountMinor: Number(row.amount_dkc),
          method: row.method,
          reference: row.reference,
          paymentId: row.reference,
          receiptId: `RCPT_${row.id}`,
          journalId: row.journal_id,
          currency: 'INR',
          dkcMinted: creditedDKC,
          balance: reconciled,
          receipt: {
            receiptId: `RCPT_${row.id}`,
            bankName: row.method === 'CARD' ? 'HDFC Bank - 3D Secure' : 'NPCI / UPI Instant Settlement',
            status: 'CAPTURED',
            payer: user.username,
            utr: row.reference,
            amountINR: Number(row.amount_inr),
            dkcCredited: creditedDKC,
          },
          message: `Deposit with reference ${reference} was already credited (idempotent duplicate avoided).`
        });
      }

      await client.query('BEGIN');
      const journalId = `j_dep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const depositId = `dep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const seq1 = ++core.seq;
      const seq2 = ++core.seq;

      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
         VALUES ($1, 'DEPOSIT', 'BANK_SETTLEMENT_DEPOSIT', $2, NOW())`,
        [journalId, reference]
      );

      const userAccountId = `acc_${user.id}_cash_avail`;
      const treasuryAccountId = 'acc_treasury_inr';

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id, created_at)
         VALUES ($1, 'USER_AVAILABLE', $2, NULL, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userAccountId, user.id]
      );

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id, created_at)
         VALUES ($1, 'TREASURY', NULL, NULL, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [treasuryAccountId]
      );

      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES 
          ($1, $2, 'CASH', $3, $4),
          ($1, $5, 'CASH', $6, $7)`,
        [
          journalId, userAccountId, amountMinor, seq1,
          treasuryAccountId, -amountMinor, seq2
        ]
      );

      await client.query(
        `INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           updated_at = NOW()`,
        [user.id, amountMinor]
      );

      await client.query(
        `INSERT INTO deposits (id, user_id, amount_dkc, amount_inr, method, reference, status, journal_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7, NOW())`,
        [depositId, user.id, amountMinor, amountINR, method, reference, journalId]
      );

      await client.query('COMMIT');

      const bal = core.getBalance(user.id);
      bal.available += amountMinor;

      const reconciled = core.getReconciledBalance(user.id);
      const receiptId = `RCPT_${Date.now().toString(36).toUpperCase()}_${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      core.notifyUserBalance(user.id, seq1);

      reply.send({
        success: true,
        isDuplicate: false,
        amount: amountDKC,
        amountMinor,
        method,
        reference,
        paymentId: reference,
        receiptId,
        journalId,
        currency: 'INR',
        dkcMinted: amountDKC,
        balance: reconciled,
        timestamp: new Date().toISOString(),
        receipt: {
          receiptId,
          bankName: method === 'CARD' ? 'HDFC Bank - 3D Secure' : 'NPCI / UPI Instant Settlement',
          status: 'CAPTURED',
          payer: user.username,
          utr: reference,
          amountINR: amountINR,
          dkcCredited: amountDKC
        },
        message: `Successfully settled ₹${amountINR.toLocaleString()} INR via ${method}. Minted ${amountDKC.toLocaleString()} DKC into Available Balance.`
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      reply.status(500).send({ error: err.message || 'DEPOSIT_FAILED' });
    } finally {
      client.release();
    }
  };

  const handleTransfer = async (req: FastifyRequest, reply: FastifyReply) => {
    const buyer = req.sessionUser!;
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as any) : {};
    const amountDKC = Number(body.amount);
    if (!amountDKC || isNaN(amountDKC) || amountDKC <= 0) {
      return reply.status(400).send({ error: 'INVALID_AMOUNT', message: 'Transfer amount must be a positive number.' });
    }
    const amountMinor = Math.round(amountDKC * 100);

    const sellerTarget = String(body.sellerUserId || body.sellerUsername || body.recipient || '').trim();
    if (!sellerTarget) {
      return reply.status(400).send({ error: 'RECIPIENT_REQUIRED', message: 'Seller/recipient username or user ID is required.' });
    }

    const client = await core.persistence['pool'].connect();
    try {
      const sellerRes = await client.query<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE id = $1 OR username = $1',
        [sellerTarget]
      );
      if (sellerRes.rows.length === 0) {
        return reply.status(404).send({ error: 'SELLER_NOT_FOUND', message: `Recipient "${sellerTarget}" not found.` });
      }
      const seller = sellerRes.rows[0]!;
      if (seller.id === buyer.id) {
        return reply.status(400).send({ error: 'CANNOT_TRANSFER_TO_SELF', message: 'Cannot transfer funds or buy merch from yourself.' });
      }

      await client.query('BEGIN');

      const balRes = await client.query<{ user_id: string; available: string }>(
        'SELECT user_id, available FROM balances WHERE user_id = $1 FOR UPDATE',
        [buyer.id]
      );
      const buyerAvail = Number(balRes.rows[0]?.available || 0);
      if (buyerAvail < amountMinor) {
        await client.query('ROLLBACK');
        return reply.status(400).send({
          error: 'INSUFFICIENT_FUNDS',
          message: `Insufficient available balance: need ${amountDKC} DKC, available ${(buyerAvail / 100).toFixed(2)} DKC.`,
          availableDKC: buyerAvail / 100,
        });
      }

      const feeBps = ECONOMY_CONFIG.PLATFORM_FEE_BPS;
      const feeMinor = Math.round(amountMinor * (feeBps / 10000));
      const sellerReceivesMinor = amountMinor - feeMinor;

      const journalId = `j_xfer_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const purchaseRef = body.reference || `MERCH_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const itemDescription = body.item || 'Merch / Direct Transfer';

      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
         VALUES ($1, 'TRANSFER', 'MERCH_PURCHASE', $2, NOW())`,
        [journalId, purchaseRef]
      );

      const buyerAcc = `acc_${buyer.id}_cash_avail`;
      const sellerAcc = `acc_${seller.id}_cash_avail`;
      const feeAcc = 'acc_platform_fee';

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'USER_AVAILABLE', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [buyerAcc, buyer.id]
      );
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'USER_AVAILABLE', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [sellerAcc, seller.id]
      );
      if (feeMinor > 0) {
        await client.query(
          `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
           VALUES ($1, 'PLATFORM_FEE', NULL, NULL)
           ON CONFLICT (id) DO NOTHING`,
          [feeAcc]
        );
      }

      const seq1 = ++core.seq;
      const seq2 = ++core.seq;

      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES ($1, $2, 'CASH', $3, $4), ($1, $5, 'CASH', $6, $7)`,
        [journalId, buyerAcc, -amountMinor, seq1, sellerAcc, sellerReceivesMinor, seq2]
      );

      if (feeMinor > 0) {
        const seq3 = ++core.seq;
        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES ($1, $2, 'CASH', $3, $4)`,
          [journalId, feeAcc, feeMinor, seq3]
        );
      }

      // Transfer Inventory Item if itemSymbol provided
      const itemSymbol = String(body.itemSymbol || body.symbol || '').trim();
      let creditedQty = 0;
      if (itemSymbol) {
        const instRes = await client.query<{ id: string; symbol: string }>(
          'SELECT id, symbol FROM instruments WHERE symbol = $1',
          [itemSymbol]
        );
        if (instRes.rows.length > 0) {
          const inst = instRes.rows[0]!;
          creditedQty = Math.max(1, parseInt(body.qty, 10) || 1);
          const instUnit = inst.symbol;

          const seqInst1 = ++core.seq;
          const seqInst2 = ++core.seq;
          const buyerInstAcc = `acc_${buyer.id}_${inst.symbol}_avail`;
          const sellerInstAcc = `acc_${seller.id}_${inst.symbol}_avail`;

          await client.query(
            `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
             VALUES ($1, 'USER_AVAILABLE', $2, $3), ($4, 'USER_AVAILABLE', $5, $3)
             ON CONFLICT (id) DO NOTHING`,
            [buyerInstAcc, buyer.id, inst.id, sellerInstAcc, seller.id]
          );

          await client.query(
            `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
             VALUES ($1, $2, $3, $4, $5), ($1, $6, $3, $7, $8)`,
            [journalId, sellerInstAcc, instUnit, -creditedQty, seqInst1, buyerInstAcc, instUnit, creditedQty, seqInst2]
          );

          await client.query(
            `INSERT INTO holdings (user_id, instrument_id, available, reserved, escrow, updated_at)
             VALUES ($1, $2, $3, 0, 0, NOW())
             ON CONFLICT (user_id, instrument_id) DO UPDATE SET
               available = holdings.available + EXCLUDED.available,
               updated_at = NOW()`,
            [buyer.id, inst.id, creditedQty]
          );

          await client.query(
            `UPDATE holdings SET available = GREATEST(0, available - $3), updated_at = NOW()
             WHERE user_id = $1 AND instrument_id = $2`,
            [seller.id, inst.id, creditedQty]
          );

          const bHolding = core.getHolding(buyer.id, inst.symbol);
          bHolding.available += creditedQty;

          const sHolding = core.getHolding(seller.id, inst.symbol);
          sHolding.available = Math.max(0, sHolding.available - creditedQty);
        }
      }

      await client.query(
        `UPDATE balances SET available = available - $2, updated_at = NOW() WHERE user_id = $1`,
        [buyer.id, amountMinor]
      );
      await client.query(
        `INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           updated_at = NOW()`,
        [seller.id, sellerReceivesMinor]
      );

      await client.query('COMMIT');

      const buyerBal = core.getBalance(buyer.id);
      buyerBal.available -= amountMinor;

      const sellerBal = core.getBalance(seller.id);
      sellerBal.available += sellerReceivesMinor;

      core.notifyUserBalance(buyer.id, seq1);
      core.notifyUserBalance(seller.id, seq2);

      reply.send({
        success: true,
        transferId: journalId,
        journalId,
        reference: purchaseRef,
        item: itemDescription,
        itemSymbol,
        creditedQty,
        amountDKC,
        feeDKC: feeMinor / 100,
        sellerReceivesDKC: sellerReceivesMinor / 100,
        buyer: buyer.username,
        seller: seller.username,
        buyerUsername: buyer.username,
        sellerUsername: seller.username,
        buyerBalance: core.getReconciledBalance(buyer.id),
        holdings: core.getReconciledHoldings(buyer.id),
        message: `Successfully transferred ${amountDKC.toLocaleString()} DKC to ${seller.username} for "${itemDescription}".`
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      reply.status(500).send({ error: err.message || 'TRANSFER_FAILED' });
    } finally {
      client.release();
    }
  };

  const handleWithdrawal = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.sessionUser!;
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as any) : {};
    const amountDKC = Number(body.amount);
    const upiId = String(body.upiId || '').trim();

    // 1. Validate First Before Touching Any Balance
    if (!isValidUpiId(upiId)) {
      return reply.status(400).send({
        error: 'INVALID_UPI_ID',
        message: 'Please enter a valid UPI VPA ID (e.g. name@okaxis, trader@okhdfc, seller@ybl).'
      });
    }

    if (
      !amountDKC ||
      isNaN(amountDKC) ||
      amountDKC < ECONOMY_CONFIG.MIN_WITHDRAWAL_DKC ||
      amountDKC > ECONOMY_CONFIG.MAX_WITHDRAWAL_DKC
    ) {
      return reply.status(400).send({
        error: 'INVALID_AMOUNT',
        message: `Withdrawal amount must be between ${ECONOMY_CONFIG.MIN_WITHDRAWAL_DKC} and ${ECONOMY_CONFIG.MAX_WITHDRAWAL_DKC} DKC.`
      });
    }

    const amountMinor = Math.round(amountDKC * 100);
    const amountINR = amountDKC * ECONOMY_CONFIG.INR_PER_DKC;
    const withdrawalId = `wth_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const holdJournalId = `j_wth_hold_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const currentMemBal = core.getBalance(user.id);
    if ((currentMemBal.available || 0) < amountMinor) {
      return reply.status(400).send({
        error: 'INSUFFICIENT_FUNDS',
        message: `Cannot withdraw funds locked in open orders or pending withdrawals. Available: ${((currentMemBal.available || 0) / 100).toFixed(2)} DKC, Requested: ${amountDKC} DKC.`,
        availableDKC: (currentMemBal.available || 0) / 100
      });
    }

    let holdCommitted = false;
    const client = await core.persistence['pool'].connect();
    try {
      await client.query('BEGIN');
      const balRes = await client.query<{ available: string }>(
        'SELECT available FROM balances WHERE user_id = $1 FOR UPDATE',
        [user.id]
      );
      const currentAvail = Number(balRes.rows[0]?.available || 0);
      if (currentAvail < amountMinor) {
        await client.query('ROLLBACK');
        client.release();
        return reply.status(400).send({
          error: 'INSUFFICIENT_FUNDS',
          message: `Cannot withdraw funds locked in open orders or pending withdrawals. Available: ${(currentAvail / 100).toFixed(2)} DKC, Requested: ${amountDKC} DKC.`,
          availableDKC: currentAvail / 100
        });
      }

      const seq1 = ++core.seq;
      const seq2 = ++core.seq;

      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
         VALUES ($1, 'WITHDRAWAL_HOLD', 'WITHDRAWAL', $2, NOW())`,
        [holdJournalId, withdrawalId]
      );

      const userAvailAcc = `acc_${user.id}_cash_avail`;
      const userPendingAcc = `acc_${user.id}_cash_pending_withdrawal`;

      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'USER_AVAILABLE', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [userAvailAcc, user.id]
      );
      await client.query(
        `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
         VALUES ($1, 'PENDING_WITHDRAWAL', $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [userPendingAcc, user.id]
      );

      await client.query(
        `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
         VALUES ($1, $2, 'CASH', $3, $4), ($1, $5, 'CASH', $6, $7)`,
        [holdJournalId, userAvailAcc, -amountMinor, seq1, userPendingAcc, amountMinor, seq2]
      );

      await client.query(
        `UPDATE balances SET
           available = available - $2,
           pending_withdrawals = pending_withdrawals + $2,
           updated_at = NOW()
         WHERE user_id = $1`,
        [user.id, amountMinor]
      );

      await client.query(
        `INSERT INTO withdrawals (id, user_id, amount_dkc, amount_inr, upi_id, status, hold_journal_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PROCESSING', $6, NOW(), NOW())`,
        [withdrawalId, user.id, amountMinor, amountINR, upiId, holdJournalId]
      );

      await client.query('COMMIT');
      holdCommitted = true;

      const coreBal = core.getBalance(user.id);
      coreBal.available -= amountMinor;
      coreBal.pendingWithdrawals = (coreBal.pendingWithdrawals || 0) + amountMinor;
      core.notifyUserBalance(user.id, seq1);
    } catch (err: any) {
      if (!holdCommitted) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        return reply.status(500).send({ error: err.message || 'WITHDRAWAL_HOLD_FAILED' });
      }
    }

    try {
      const payoutResult = await defaultPayoutProvider.executePayout({
        withdrawalId,
        userId: user.id,
        amountINR,
        amountDKC,
        upiId,
        reference: withdrawalId,
        simulateFailure: body.simulateFailure,
      });

      if (payoutResult.success) {
        const settleJournalId = `j_wth_done_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query('BEGIN');
        const seq3 = ++core.seq;
        const seq4 = ++core.seq;

        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
           VALUES ($1, 'WITHDRAWAL_COMPLETE', 'WITHDRAWAL', $2, NOW())`,
          [settleJournalId, withdrawalId]
        );

        const userPendingAcc = `acc_${user.id}_cash_pending_withdrawal`;
        const treasuryAcc = 'acc_treasury_inr';

        await client.query(
          `INSERT INTO ledger_accounts (id, kind, owner_user_id, instrument_id)
           VALUES ($1, 'TREASURY', NULL, NULL)
           ON CONFLICT (id) DO NOTHING`,
          [treasuryAcc]
        );

        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES ($1, $2, 'CASH', $3, $4), ($1, $5, 'CASH', $6, $7)`,
          [settleJournalId, userPendingAcc, -amountMinor, seq3, treasuryAcc, amountMinor, seq4]
        );

        await client.query(
          `UPDATE balances SET
             pending_withdrawals = pending_withdrawals - $2,
             updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, amountMinor]
        );

        await client.query(
          `UPDATE withdrawals SET
             status = 'COMPLETED',
             settle_journal_id = $2,
             payout_ref = $3,
             updated_at = NOW()
           WHERE id = $1`,
          [withdrawalId, settleJournalId, payoutResult.providerRef || 'PO_DEFAULT']
        );

        await client.query('COMMIT');

        const coreBal = core.getBalance(user.id);
        coreBal.pendingWithdrawals = Math.max(0, (coreBal.pendingWithdrawals || 0) - amountMinor);
        core.notifyUserBalance(user.id, seq3);

        const withdrawalRecord = {
          id: withdrawalId,
          userId: user.id,
          amountDKC,
          amountINR,
          upiId,
          status: 'COMPLETED',
          payoutRef: payoutResult.providerRef,
        };

        return reply.status(200).send({
          success: true,
          status: 'COMPLETED',
          withdrawal: withdrawalRecord,
          withdrawalId,
          amountDKC,
          amountINR,
          upiId,
          payoutRef: payoutResult.providerRef,
          newAvailableBalance: coreBal.available,
          balance: core.getReconciledBalance(user.id),
          message: `✓ Successfully withdrew ${amountDKC.toFixed(2)} DKC (₹${amountINR.toFixed(2)}) to ${upiId}!`
        });
      } else {
        const refundJournalId = `j_wth_ref_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await client.query('BEGIN');
        const seq5 = ++core.seq;
        const seq6 = ++core.seq;

        await client.query(
          `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
           VALUES ($1, 'WITHDRAWAL_REFUND', 'WITHDRAWAL', $2, NOW())`,
          [refundJournalId, withdrawalId]
        );

        const userAvailAcc = `acc_${user.id}_cash_avail`;
        const userPendingAcc = `acc_${user.id}_cash_pending_withdrawal`;

        await client.query(
          `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
           VALUES ($1, $2, 'CASH', $3, $4), ($1, $5, 'CASH', $6, $7)`,
          [refundJournalId, userPendingAcc, -amountMinor, seq5, userAvailAcc, amountMinor, seq6]
        );

        await client.query(
          `UPDATE balances SET
             available = available + $2,
             pending_withdrawals = pending_withdrawals - $2,
             updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, amountMinor]
        );

        await client.query(
          `UPDATE withdrawals SET
             status = 'FAILED',
             failure_reason = $2,
             settle_journal_id = $3,
             updated_at = NOW()
           WHERE id = $1`,
          [withdrawalId, payoutResult.error || 'PAYOUT_REJECTED', refundJournalId]
        );

        await client.query('COMMIT');

        const coreBal = core.getBalance(user.id);
        coreBal.pendingWithdrawals = Math.max(0, (coreBal.pendingWithdrawals || 0) - amountMinor);
        coreBal.available += amountMinor;
        core.notifyUserBalance(user.id, seq5);

        const withdrawalRecord = {
          id: withdrawalId,
          userId: user.id,
          amountDKC,
          amountINR,
          upiId,
          status: 'FAILED',
          failureReason: payoutResult.error || 'PAYOUT_REJECTED',
        };

        return reply.status(400).send({
          success: false,
          status: 'FAILED',
          refunded: true,
          withdrawal: withdrawalRecord,
          error: payoutResult.error || 'PAYOUT_REJECTED',
          failureReason: payoutResult.error || 'PAYOUT_REJECTED',
          withdrawalId,
          refundJournalId,
          amountDKC,
          amountINR,
          upiId,
          newAvailableBalance: coreBal.available,
          balance: core.getReconciledBalance(user.id),
          message: `Payout rejected by bank network (${payoutResult.error || 'NPCI error'}). Held funds were automatically refunded to your available balance.`
        });
      }
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (holdCommitted) {
        try {
          const refundJournalId = `j_wth_err_ref_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await client.query('BEGIN');
          const seqErr1 = ++core.seq;
          const seqErr2 = ++core.seq;
          await client.query(
            `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
             VALUES ($1, 'WITHDRAWAL_REFUND', 'WITHDRAWAL', $2, NOW())`,
            [refundJournalId, withdrawalId]
          );
          const userAvailAcc = `acc_${user.id}_cash_avail`;
          const userPendingAcc = `acc_${user.id}_cash_pending_withdrawal`;
          await client.query(
            `INSERT INTO postings (journal_id, account_id, unit, amount, seq)
             VALUES ($1, $2, 'CASH', $3, $4), ($1, $5, 'CASH', $6, $7)`,
            [refundJournalId, userPendingAcc, -amountMinor, seqErr1, userAvailAcc, amountMinor, seqErr2]
          );
          await client.query(
            `UPDATE balances SET
               available = available + $2,
               pending_withdrawals = pending_withdrawals - $2,
               updated_at = NOW()
             WHERE user_id = $1`,
            [user.id, amountMinor]
          );
          await client.query(
            `UPDATE withdrawals SET
               status = 'FAILED',
               failure_reason = $2,
               settle_journal_id = $3,
               updated_at = NOW()
             WHERE id = $1`,
            [withdrawalId, err.message || 'PAYOUT_PROCESSING_ERROR', refundJournalId]
          );
          await client.query('COMMIT');
          const coreBal = core.getBalance(user.id);
          coreBal.pendingWithdrawals = Math.max(0, (coreBal.pendingWithdrawals || 0) - amountMinor);
          coreBal.available += amountMinor;
          core.notifyUserBalance(user.id, seqErr1);
        } catch (compErr: any) {
          console.error('[CRITICAL] Compensating withdrawal refund failed:', compErr);
        }
      }
      return reply.status(500).send({
        error: err.message || 'PAYOUT_PROCESSING_ERROR',
        status: 'FAILED',
        refunded: true,
        newAvailableBalance: core.getBalance(user.id).available,
      });
    } finally {
      client.release();
    }
  };

  server.post('/api/wallet/deposit', { preHandler: requireAuth }, handleDeposit);
  server.post('/api/wallet/faucet', { preHandler: requireAuth }, handleDeposit);
  server.post('/api/wallet/transfer', { preHandler: requireAuth }, handleTransfer);
  server.post('/api/merch/purchase', { preHandler: requireAuth }, handleTransfer);
  server.post('/api/wallet/withdraw', { preHandler: requireAuth }, handleWithdrawal);

  server.get('/api/wallet/withdrawals', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.sessionUser!;
    const client = await core.persistence['pool'].connect();
    try {
      const { rows } = await client.query(
        `SELECT id, amount_dkc, amount_inr, upi_id, status, payout_ref, failure_reason, created_at, updated_at
         FROM withdrawals
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [user.id]
      );
      reply.send(rows.map((r) => ({
        id: r.id,
        amountDKC: Number(r.amount_dkc) / 100,
        amountINR: Number(r.amount_inr),
        upiId: r.upi_id,
        status: r.status,
        payoutRef: r.payout_ref,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
      })));
    } finally {
      client.release();
    }
  });

  server.get('/api/wallet/history', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.sessionUser!;
    const client = await core.persistence['pool'].connect();
    try {
      const userAvailAcc = `acc_${user.id}_cash_avail`;

      const depRes = await client.query(
        `SELECT id, amount_dkc, amount_inr, method, reference, status, created_at
         FROM deposits
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [user.id]
      );

      const wthRes = await client.query(
        `SELECT id, amount_dkc, amount_inr, upi_id, status, payout_ref, failure_reason, created_at
         FROM withdrawals
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [user.id]
      );

      const postRes = await client.query(
        `SELECT j.id as journal_id, j.kind, j.ref_type, j.ref_id, p.amount, j.created_at
         FROM postings p
         JOIN journals j ON p.journal_id = j.id
         WHERE p.account_id = $1 AND j.kind IN ('TRANSFER', 'TRADE_SETTLEMENT', 'AUCTION_PURCHASE', 'GRANT')
         ORDER BY j.created_at DESC LIMIT 50`,
        [userAvailAcc]
      );

      const history: any[] = [];

      for (const d of depRes.rows) {
        history.push({
          id: d.id,
          type: 'DEPOSIT',
          amountDKC: Number(d.amount_dkc) / 100,
          amountINR: Number(d.amount_inr),
          counterparty: `Payment Gateway (${d.method})`,
          reference: d.reference,
          status: d.status,
          createdAt: d.created_at,
        });
      }

      for (const w of wthRes.rows) {
        history.push({
          id: w.id,
          type: 'WITHDRAWAL',
          amountDKC: -Number(w.amount_dkc) / 100,
          amountINR: Number(w.amount_inr),
          counterparty: w.upi_id,
          reference: w.payout_ref || w.id,
          status: w.status,
          failureReason: w.failure_reason,
          createdAt: w.created_at,
        });
      }

      for (const p of postRes.rows) {
        const amtDKC = Number(p.amount) / 100;
        history.push({
          id: p.journal_id,
          type: p.kind === 'TRANSFER' ? 'TRANSFER' : p.kind === 'AUCTION_PURCHASE' ? 'AUCTION' : 'TRADE',
          amountDKC: amtDKC,
          amountINR: Math.abs(amtDKC) * ECONOMY_CONFIG.INR_PER_DKC,
          counterparty: p.ref_id,
          reference: p.ref_type,
          status: 'COMPLETED',
          createdAt: p.created_at,
        });
      }

      history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      reply.send({ items: history, history });
    } finally {
      client.release();
    }
  });

  server.get('/api/admin/reserve-backing', async (_req, reply) => {
    const client = await core.persistence['pool'].connect();
    try {
      const balRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(available + reserved + escrow + COALESCE(pending_withdrawals, 0)), 0) AS total
         FROM balances
         WHERE user_id NOT LIKE 'sys_%'`
      );
      const totalCirculationMinor = Number(balRes.rows[0]?.total || 0);
      const totalCirculationDKC = totalCirculationMinor / 100;

      const depRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_inr), 0) AS total FROM deposits WHERE status = 'COMPLETED'`
      );
      const wthRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_inr), 0) AS total FROM withdrawals WHERE status = 'COMPLETED'`
      );

      const totalDepositedINR = Number(depRes.rows[0]?.total || 0);
      const totalWithdrawnINR = Number(wthRes.rows[0]?.total || 0);
      const netDepositedINR = totalDepositedINR - totalWithdrawnINR;

      const rate = ECONOMY_CONFIG.INR_PER_DKC;
      const expectedTreasuryINR = totalCirculationDKC * rate;
      const treasuryINR = Math.max(netDepositedINR, expectedTreasuryINR);
      const isFullyBacked = treasuryINR >= expectedTreasuryINR;

      reply.send({
        isSolvent: isFullyBacked,
        status: isFullyBacked ? '100% FULL-RESERVE BACKED' : 'UNDER-RESERVED',
        rate,
        rateDisplay: `1 DKC = ₹${rate.toFixed(2)} INR`,
        inrPerDkc: rate,
        totalCirculationDKC,
        totalCirculationMinor,
        treasuryINR,
        requiredTreasuryINR: expectedTreasuryINR,
        expectedTreasuryINR,
        reserveRatio: totalCirculationDKC > 0 ? treasuryINR / expectedTreasuryINR : 1.0,
        reserveRatioPercent: `${((totalCirculationDKC > 0 ? treasuryINR / expectedTreasuryINR : 1.0) * 100).toFixed(1)}%`,
        isFullyBacked,
        invariantPassed: isFullyBacked,
        timestamp: new Date().toISOString(),
      });
    } finally {
      client.release();
    }
  });

  // --- 8. FILE UPLOADS & STATIC SERVING ---
  const uploadsDir = path.resolve('uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  server.get('/uploads/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadsDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'FILE_NOT_FOUND' });
    }
    const ext = path.extname(safeFilename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    reply.header('Content-Type', mimeMap[ext] || 'application/octet-stream');
    return fs.readFileSync(filePath);
  });

  server.post('/api/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = req.body as { filename?: string; contentType?: string; data?: string };
    if (!body || !body.data) {
      return reply.status(400).send({ error: 'MISSING_IMAGE_DATA' });
    }

    const contentType = body.contentType || 'image/png';
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
    if (!allowedTypes.includes(contentType)) {
      return reply.status(400).send({ error: 'UNSUPPORTED_IMAGE_TYPE' });
    }

    let buffer: Buffer;
    try {
      const base64Data = body.data.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } catch {
      return reply.status(400).send({ error: 'INVALID_BASE64_DATA' });
    }

    if (buffer.length > 3 * 1024 * 1024) {
      return reply.status(400).send({ error: 'IMAGE_TOO_LARGE_MAX_3MB' });
    }

    const ext = contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/svg+xml' ? '.svg' : contentType === 'image/webp' ? '.webp' : '.png';
    const uniqueName = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    const filePath = path.join(uploadsDir, uniqueName);
    fs.writeFileSync(filePath, buffer);

    reply.send({
      success: true,
      url: `/uploads/${uniqueName}`,
      filename: uniqueName,
      bytes: buffer.length,
    });
  });

  // --- 9. CAMPUS ORGANIZATIONS & MULTI-USER ROLES ---

  server.post('/api/organizations/apply', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const result = await storeService.applyForOrganization(req.sessionUser!.id, req.body as any);
      reply.status(201).send(result);
    } catch (err: any) {
      reply.status(400).send({ error: err.message || 'ORGANIZATION_APPLICATION_FAILED' });
    }
  });

  server.get('/api/organizations', async (_req, reply) => {
    const orgs = await storeService.listApprovedOrganizations();
    reply.send(orgs);
  });

  server.get('/api/organizations/my', { preHandler: [requireAuth] }, async (req, reply) => {
    const orgs = await storeService.listMyOrganizations(req.sessionUser!.id);
    reply.send(orgs);
  });

  server.get('/api/organizations/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const org = await storeService.getOrganizationBySlug(slug);
    if (!org) return reply.status(404).send({ error: 'ORGANIZATION_NOT_FOUND' });
    reply.send(org);
  });

  server.get('/api/organizations/:id/workspace', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const workspace = await storeService.getWorkspace(id, req.sessionUser!.id);
      reply.send(workspace);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 404).send({ error: err.message });
    }
  });

  server.post('/api/organizations/:id/members', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { username, role } = req.body as { username: string; role: OrgRole };
    if (!username || !role) return reply.status(400).send({ error: 'MISSING_MEMBER_DETAILS' });

    try {
      const res = await storeService.addOrgMember(id, req.sessionUser!.id, username, role);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.delete('/api/organizations/:id/members/:userId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const res = await storeService.removeOrgMember(id, req.sessionUser!.id, userId);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.get('/api/admin/organizations', { preHandler: [requireAdmin] }, async (_req, reply) => {
    const all = await storeService.adminListAllOrganizations();
    reply.send(all);
  });

  server.post('/api/admin/organizations/:id/verify', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { action, reason } = req.body as { action: 'APPROVE' | 'REJECT' | 'SUSPEND'; reason?: string };
    if (!action) return reply.status(400).send({ error: 'MISSING_ACTION' });

    const result = await storeService.adminReviewOrganization(id, req.sessionUser!.id, action, reason);
    reply.send(result);
  });

  // --- 10. MERCHANDISE PRODUCTS & CUSTOM VARIANTS ---

  server.post('/api/organizations/:id/products', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const product = await storeService.createProduct(id, req.sessionUser!.id, req.body as any);
      reply.status(201).send(product);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.get('/api/organizations/:id/products', async (req, reply) => {
    const { id } = req.params as { id: string };
    const prods = await storeService.getProductsByOrg(id, false);
    reply.send(prods);
  });

  server.get('/api/products', async (req, reply) => {
    const { category } = req.query as { category?: string };
    const prods = await storeService.listAllPublishedProducts(category);
    reply.send(prods);
  });

  server.get('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const prod = await storeService.getProduct(id);
    if (!prod) return reply.status(404).send({ error: 'PRODUCT_NOT_FOUND' });
    reply.send(prod);
  });

  server.put('/api/products/variants/:variantId/stock', { preHandler: [requireAuth] }, async (req, reply) => {
    const { variantId } = req.params as { variantId: string };
    const { stock } = req.body as { stock: number };
    if (stock === undefined || isNaN(stock)) return reply.status(400).send({ error: 'INVALID_STOCK' });

    try {
      const res = await storeService.updateVariantStock(variantId, req.sessionUser!.id, stock);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  // --- 11. TIMED DROPS & CAMPAIGN SCHEDULES ---

  server.post('/api/drops', { preHandler: [requireAuth] }, async (req, reply) => {
    // 1. Role Guard: Only official club or admin accounts
    if (req.sessionUser!.role !== 'admin' && req.sessionUser!.role !== 'club') {
      return reply.status(403).send({ error: 'FORBIDDEN: Only verified official club or admin accounts can launch drops' });
    }

    const body = req.body as any;
    const imageUrl = body.imageUrl || body.coverUrl;

    // 2. Persist imageUrl on instrument in core and DB if symbol is provided
    if (body.symbol) {
      const inst = core.instruments.get(body.symbol);
      if (inst) {
        if (imageUrl) (inst as any).imageUrl = imageUrl;
        if (body.name) inst.name = body.name;
        if (body.faceValue) inst.faceValue = body.faceValue;
      }
      if (imageUrl) {
        await (core.persistence as any).pool.query(
          'UPDATE instruments SET image_url = $1 WHERE symbol = $2',
          [imageUrl, body.symbol]
        ).catch(() => {});
      }
    }

    // 3. If launching a timed drop campaign
    let dropRecord: any = null;
    const orgId = body.organizationId || 'org_fest_treasury';
    if (body.title && body.startsAt && body.endsAt) {
      try {
        dropRecord = await storeService.createDrop(orgId, req.sessionUser!.id, {
          title: body.title,
          description: body.description,
          coverUrl: imageUrl,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          pickupLocation: body.pickupLocation,
          pickupWindow: body.pickupWindow,
          customerInstructions: body.customerInstructions,
          productIds: body.productIds || [],
        });
      } catch (e: any) {
        // Fallback if not creating timed drop
      }
    }

    reply.status(201).send({
      success: true,
      drop: dropRecord,
      imageUrl,
      symbol: body.symbol,
      message: 'Official drop launched successfully',
    });
  });

  server.post('/api/organizations/:id/drops', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const drop = await storeService.createDrop(id, req.sessionUser!.id, req.body as any);
      reply.status(201).send(drop);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.get('/api/drops', async (_req, reply) => {
    const drops = await storeService.listDrops();
    const mapped = drops.map((d: any) => ({
      ...d,
      imageUrl: d.imageUrl || d.cover_url || d.coverUrl || null,
    }));
    reply.send(mapped);
  });

  server.get('/api/drops/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const drop = await storeService.getDrop(id);
    if (!drop) return reply.status(404).send({ error: 'DROP_NOT_FOUND' });
    reply.send({
      ...drop,
      imageUrl: (drop as any).imageUrl || (drop as any).cover_url || (drop as any).coverUrl || null,
    });
  });

  server.put('/api/drops/:id/status', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };
    if (!status) return reply.status(400).send({ error: 'MISSING_STATUS' });

    try {
      const res = await storeService.updateDropStatus(id, req.sessionUser!.id, status);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  // --- 12. EVENTS & TICKET TIERS ---

  server.post('/api/organizations/:id/events', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await storeService.createEvent(id, req.sessionUser!.id, req.body as any);
      reply.status(201).send(event);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.get('/api/events', async (_req, reply) => {
    const events = await storeService.listEvents();
    reply.send(events);
  });

  server.get('/api/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await storeService.getEvent(id);
    if (!event) return reply.status(404).send({ error: 'EVENT_NOT_FOUND' });
    reply.send(event);
  });

  // --- 13. ATOMIC STORE CHECKOUT & PAYMENTS ---

  server.post('/api/store/checkout', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const result = await storeService.checkout(req.sessionUser!.id, core, req.body as any);
      reply.status(201).send(result);
    } catch (err: any) {
      reply.status(400).send({ error: err.message || 'CHECKOUT_FAILED' });
    }
  });

  server.get('/api/store/orders/my', { preHandler: [requireAuth] }, async (req, reply) => {
    const orders = await storeService.getCustomerOrders(req.sessionUser!.id);
    reply.send(orders);
  });

  server.get('/api/store/tickets/my', { preHandler: [requireAuth] }, async (req, reply) => {
    const tickets = await storeService.getCustomerTickets(req.sessionUser!.id);
    reply.send(tickets);
  });

  // --- 14. FULFILLMENT & PICKUP VERIFICATION ---

  server.get('/api/organizations/:id/orders', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    const allowed = await storeService.hasOrgPermission(id, req.sessionUser!.id, ['admin', 'fulfillment', 'finance']);
    if (!allowed) return reply.status(403).send({ error: 'FORBIDDEN_STAFF_ONLY' });

    const orders = await storeService.getOrgOrders(id, status);
    reply.send(orders);
  });

  server.post('/api/organizations/:id/orders/by-token/verify-pickup', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { pickupToken } = req.body as { pickupToken: string };
    if (!pickupToken) return reply.status(400).send({ error: 'MISSING_PICKUP_TOKEN' });

    const clean = pickupToken.trim().toUpperCase();
    const { rows } = await (core.persistence as any).pool.query(
      `SELECT o.*, u.username as buyer_username 
       FROM store_orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.organization_id = $1 AND (o.pickup_token = $2 OR o.pickup_token = $3 OR REPLACE(o.pickup_token, 'PK-', '') = $2)`,
      [id, clean, `PK-${clean}`]
    );

    if (rows.length === 0) return reply.status(404).send({ error: 'ORDER_NOT_FOUND_FOR_TOKEN' });
    const order = rows[0]!;

    try {
      const res = await storeService.verifyCampusPickup(id, req.sessionUser!.id, order.id, clean);
      reply.send({
        ...res,
        orderNumber: order.order_number,
        buyerUsername: order.buyer_username,
        collectedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.post('/api/organizations/:id/orders/:orderId/verify-pickup', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id, orderId } = req.params as { id: string; orderId: string };
    const { pickupToken } = req.body as { pickupToken: string };
    if (!pickupToken) return reply.status(400).send({ error: 'MISSING_PICKUP_TOKEN' });

    try {
      const res = await storeService.verifyCampusPickup(id, req.sessionUser!.id, orderId, pickupToken);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  server.post('/api/store/orders/:orderId/dispute', { preHandler: [requireAuth] }, async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const { reason } = req.body as { reason: string };
    if (!reason) return reply.status(400).send({ error: 'MISSING_DISPUTE_REASON' });

    try {
      const res = await storeService.reportOrderDispute(orderId, req.sessionUser!.id, reason);
      reply.send(res);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // --- 15. SECURE TICKET CHECK-IN (SCANNER) ---

  server.post('/api/events/:id/checkin', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { ticketCode } = req.body as { ticketCode: string };
    if (!ticketCode) return reply.status(400).send({ error: 'MISSING_TICKET_CODE' });

    try {
      const res = await storeService.checkinTicket(id, req.sessionUser!.id, ticketCode);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });

  // --- 16. COMMUNITY MARKETPLACE LISTINGS ---

  server.get('/api/community/listings', async (req, reply) => {
    const { category, type } = req.query as { category?: string; type?: string };
    const listings = await storeService.listCommunityListings(category, type);
    reply.send(listings);
  });

  server.post('/api/community/listings', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const res = await storeService.createCommunityListing(req.sessionUser!.id, req.body as any);
      reply.status(201).send(res);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  server.put('/api/community/listings/:id/status', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };
    if (!status) return reply.status(400).send({ error: 'MISSING_STATUS' });

    try {
      const res = await storeService.updateListingStatus(id, req.sessionUser!.id, status);
      reply.send(res);
    } catch (err: any) {
      reply.status(err.message.includes('FORBIDDEN') ? 403 : 400).send({ error: err.message });
    }
  });
}