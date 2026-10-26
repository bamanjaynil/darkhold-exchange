/**
 * @file routes.ts
 * Fastify REST API routes.
 * Enforces session authentication, CSRF validation, anti-bot PoW, and role guards.
 */

import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ExchangeCore } from './core.js';
import { AuthManager, SessionUser } from './auth.js';
import { AntiBotManager } from './antibot.js';
import { SolvencyCoordinator } from './solvency.js';
import { generateMockIssuerReceipt, verifyEscrowReceipt } from './escrow.js';
import { runReconciliation } from './reconciliation.js';
import { performDemoReset } from './reset.js';
import { config } from './config.js';
import {
  SubmitOrderSchema,
  CreateAuctionSchema,
  BuyAuctionSchema,
  RegisterUserSchema,
  LoginUserSchema,
  calculateCollarCeiling,
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
  solvency: SolvencyCoordinator
): void {
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
        req.url.startsWith('/api/faucet') ||
        req.url.startsWith('/api/wallet/faucet') ||
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
            total: bal.available + bal.reserved + bal.escrow,
          },
        });
    } catch (err: any) {
      if (err.message === 'RATE_LIMITED') {
        return reply.status(429).send({ error: 'RATE_LIMITED' });
      }
      reply.status(400).send({ error: err.message || 'REGISTRATION_FAILED' });
    }
  });

  server.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_CREDENTIALS' });
    }

    try {
      const { user, sessionToken, csrfToken } = await auth.login(
        parsed.data.username,
        parsed.data.password,
        req.ip
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
            total: bal.available + bal.reserved + bal.escrow,
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
        total: bal.available + bal.reserved + bal.escrow,
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
        total: bal.available + bal.reserved + bal.escrow,
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

      return {
        ...auc,
        currentPrice,
        decayPerSec,
        timeRemainingSec,
        totalSteps,
      };
    });
    reply.send(list);
  });

  server.post('/api/auctions/create', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = CreateAuctionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.format() });
    }

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
    reply.send(res);
  });

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
    const list = Array.from(core.escrows.values()).filter(
      (e) => e.buyerUserId === userId || e.sellerUserId === userId
    );
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
    const { receipt } = req.body as { receipt: string };

    const esc = core.escrows.get(id);
    if (!esc) return reply.status(404).send({ error: 'ESCROW_NOT_FOUND' });

    const isValid = verifyEscrowReceipt(receipt, esc.id, esc.buyerUserId, esc.sellerUserId, esc.symbol);
    if (!isValid) {
      return reply.status(400).send({ error: 'INVALID_DELIVERY_RECEIPT' });
    }

    const res = await core.dispatch<any>({
      type: 'ESCROW_DELIVER',
      escrowId: id,
      sellerUserId: req.sessionUser!.id,
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

  server.get('/api/solvency/proof', { preHandler: requireAuth }, async (req, reply) => {
    const proof = await solvency.getProofForUser(req.sessionUser!.id, core);
    if (!proof) {
      return reply.status(404).send({ error: 'NO_LIABILITIES_FOR_USER' });
    }
    reply.send(proof);
  });

  server.get('/api/solvency/status', async (_req, reply) => {
    let snapshot = solvency.getLatestSnapshot();
    if (!snapshot) {
      snapshot = await solvency.createSnapshot(core);
    }
    const report = await runReconciliation(core.persistence['pool'], core);
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
    const snapshot = await solvency.createSnapshot(core);
    reply.send(snapshot);
  });

  // --- 7. ADMIN, RECONCILIATION & SCALPER DEMO ---

  server.get('/api/admin/reconcile', { preHandler: requireAdmin }, async (_req, reply) => {
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
      await performDemoReset(core, core.persistence['pool']);
      reply.send({ success: true, message: 'Market state reset successfully.' });
    } catch (err: any) {
      reply.status(500).send({ error: err.message || 'RESET_FAILED' });
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

  server.post('/api/wallet/faucet', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.sessionUser!;
    const body = (typeof req.body === 'object' && req.body !== null) ? (req.body as { amount?: number }) : {};
    const amountDKC = Math.max(1, Math.min(100000, Number(body.amount) || 5000));
    const amountMinor = Math.round(amountDKC * 100);

    const client = await core.persistence['pool'].connect();
    try {
      await client.query('BEGIN');
      const journalId = `j_faucet_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const seq = ++core.seq;

      await client.query(
        `INSERT INTO journals (id, kind, ref_type, ref_id, created_at)
         VALUES ($1, 'DEPOSIT', 'FAUCET', $2, NOW())`,
        [journalId, user.id]
      );

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

      await client.query(
        `INSERT INTO balances (user_id, available, reserved, escrow, updated_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           available = balances.available + EXCLUDED.available,
           updated_at = NOW()`,
        [user.id, amountMinor]
      );

      await client.query('COMMIT');

      const bal = core.getBalance(user.id);
      bal.available += amountMinor;

      const reconciled = core.getReconciledBalance(user.id);
      reply.send({
        success: true,
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
}