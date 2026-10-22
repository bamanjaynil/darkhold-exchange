import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CreateOrderSchema,
  calculatePriceCollar,
  calculateDutchPrice,
  toMicro,
  OrderBookSnapshot
} from '@darkhold/shared';
import { LimitOrderBook, OrderNode } from './engine/OrderBook.js';
import { buildMerkleProof } from './ledger/Solvency.js';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const app = Fastify({ logger: false });

const MARKET_ID = 'mkt_darkhold_vip';
const FACE_VALUE = toMicro(2000);
const EVENT_TIME = Date.now() + 7 * 24 * 60 * 60 * 1000;
const DUTCH_START_TIME = Date.now();

const orderBook = new LimitOrderBook();
const wsClients = new Set<WebSocket>();
let isDirty = true;
let totalProcessedOrders = 0;
let lastSecOrders = 0;
let currentOps = 0;

// Seed initial resting maker liquidity so the L2 ladder is alive immediately
function seedInitialOrderBook() {
  const initialQuotes = [
    { side: 'BUY' as const, price: 1950, qty: 12, user: 'usr_trader_2' },
    { side: 'BUY' as const, price: 1900, qty: 25, user: 'usr_trader_2' },
    { side: 'BUY' as const, price: 1850, qty: 40, user: 'usr_trader_2' },
    { side: 'SELL' as const, price: 2050, qty: 10, user: 'usr_trader_2' },
    { side: 'SELL' as const, price: 2100, qty: 18, user: 'usr_trader_2' },
    { side: 'SELL' as const, price: 2150, qty: 30, user: 'usr_trader_2' }
  ];
  for (const q of initialQuotes) {
    orderBook.processOrder({
      id: crypto.randomUUID(),
      userId: q.user,
      marketId: MARKET_ID,
      side: q.side,
      type: 'LIMIT',
      timeInForce: 'GTC',
      price: toMicro(q.price),
      initialQty: q.qty,
      remainingQty: q.qty,
      lockedCash: q.side === 'BUY' ? toMicro(q.price) * BigInt(q.qty) : 0n,
      timestamp: Date.now(),
      prev: null,
      next: null
    });
  }
}

function buildSnapshot(): OrderBookSnapshot & { ops: number; totalOrders: number } {
  const { floor, ceiling } = calculatePriceCollar(FACE_VALUE, 5000, 12000, EVENT_TIME);
  const dutchPrice = calculateDutchPrice(
    toMicro(2350),
    toMicro(1400),
    toMicro(5),
    1000,
    DUTCH_START_TIME
  );
  const depth = orderBook.getL2Depth(12);
  return {
    marketId: MARKET_ID,
    seqId: orderBook.seqId,
    bids: depth.bids,
    asks: depth.asks,
    collarFloorMicro: floor.toString(),
    collarCeilingMicro: ceiling.toString(),
    faceValueMicro: FACE_VALUE.toString(),
    dutchPriceMicro: dutchPrice.toString(),
    ops: currentOps,
    totalOrders: totalProcessedOrders
  };
}

// 20 FPS (50ms) Coalesced WebSocket Broadcast Loop
setInterval(() => {
  if (wsClients.size === 0) return;
  const payload = JSON.stringify({ type: 'L2_SNAPSHOT', data: buildSnapshot() });
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(payload);
  }
  isDirty = false;
}, 50);

// 1-Second OPS Telemetry Counter
setInterval(() => {
  currentOps = lastSecOrders;
  lastSecOrders = 0;
}, 1000);

async function start() {
  await app.register(cors, { origin: true });
  await app.register(websocket);

  seedInitialOrderBook();

  app.get('/ws/market', { websocket: true }, (socket) => {
    wsClients.add(socket);
    socket.send(JSON.stringify({ type: 'L2_SNAPSHOT', data: buildSnapshot() }));
    socket.on('close', () => wsClients.delete(socket));
  });

  app.get('/api/v1/depth', async () => buildSnapshot());

  // Submit Limit or Market Order with Anti-Scalping Collar & Redis Stream Logging
  app.post('/api/v1/orders', async (req, reply) => {
    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const input = parsed.data;
    const { floor, ceiling } = calculatePriceCollar(FACE_VALUE, 5000, 12000, EVENT_TIME);
    const price = input.type === 'MARKET'
      ? (input.side === 'BUY' ? ceiling : floor)
      : BigInt(input.priceMicro);

    // Anti-Scalping Price Collar Enforcement
    if (input.type === 'LIMIT' && (price < floor || price > ceiling)) {
      return reply.code(422).send({
        error: 'ERR_PRICE_COLLAR_VIOLATION',
        message: `Price must be within anti-scalping collar [${Number(floor) / 1e6}, ${Number(ceiling) / 1e6}]`
      });
    }

    const orderNode: OrderNode = {
      id: crypto.randomUUID(),
      userId: input.userId,
      marketId: input.marketId,
      side: input.side,
      type: input.type,
      timeInForce: input.timeInForce,
      price,
      initialQty: input.quantity,
      remainingQty: input.quantity,
      lockedCash: input.side === 'BUY' ? price * BigInt(input.quantity) : 0n,
      timestamp: Date.now(),
      prev: null,
      next: null
    };

    // Append sequenced event to Redis Stream
    await redis.xadd(
      `stream:orders:${MARKET_ID}`,
      'MAXLEN',
      '~',
      '10000',
      '*',
      'orderId',
      orderNode.id,
      'side',
      orderNode.side,
      'price',
      orderNode.price.toString()
    );

    const result = orderBook.processOrder(orderNode);
    totalProcessedOrders++;
    lastSecOrders++;
    isDirty = true;

    return {
      orderId: orderNode.id,
      seqId: orderBook.seqId,
      matchedTradesCount: result.trades.length,
      trades: result.trades.map((t) => ({
        ...t,
        price: t.price.toString(),
        buyerRefund: t.buyerRefund.toString()
      }))
    };
  });

  // High-Concurrency Stress Resilience Simulator (1,000+ Orders/Sec Burst)
  app.post('/api/v1/sim/swarm', async () => {
    const burstSize = 1400; // Fires 1,400 orders across 1 second to prove 1,000+ OPS
    const startTs = performance.now();
    const { floor, ceiling } = calculatePriceCollar(FACE_VALUE, 5000, 12000, EVENT_TIME);
    const minP = Number(floor) / 1e6 + 500;
    const maxP = Number(ceiling) / 1e6 - 100;

    let totalTrades = 0;
    for (let i = 0; i < burstSize; i++) {
      const side = i % 2 === 0 ? 'BUY' : 'SELL';
      const randomPrice = Math.round((minP + Math.random() * (maxP - minP)) / 10) * 10;
      const res = orderBook.processOrder({
        id: crypto.randomUUID(),
        userId: i % 3 === 0 ? 'usr_trader_1' : 'usr_bot_swarm',
        marketId: MARKET_ID,
        side,
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: toMicro(randomPrice),
        initialQty: 1 + (i % 4),
        remainingQty: 1 + (i % 4),
        lockedCash: side === 'BUY' ? toMicro(randomPrice) * BigInt(1 + (i % 4)) : 0n,
        timestamp: Date.now(),
        prev: null,
        next: null
      });
      totalTrades += res.trades.length;
      totalProcessedOrders++;
      lastSecOrders++;
    }
    const elapsedMs = (performance.now() - startTs).toFixed(2);
    isDirty = true;
    return {
      ordersProcessed: burstSize,
      tradesExecuted: totalTrades,
      executionTimeMs: elapsedMs,
      effectiveOps: Math.round((burstSize / Number(elapsedMs)) * 1000)
    };
  });

  // Cryptographic Merkle Sum Tree Proof of Solvency Endpoint
  app.get('/api/v1/solvency/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    const users = await prisma.user.findMany({ include: { accounts: true } });
    const mapped = users.map((u) => ({
      userId: u.id,
      nonce: u.merkleNonce,
      balance: u.accounts.reduce((acc, a) => acc + a.balance, 0n)
    }));
    return buildMerkleProof(mapped, userId);
  });

  await app.listen({ port: 3001, host: '0.0.0.0' });
  console.log('Darkhold Exchange API + Matching Engine listening on http://localhost:3001');
}

start();
