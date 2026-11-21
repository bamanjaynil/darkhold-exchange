/**
 * @file server.ts
 * Main application entrypoint.
 * Fastify HTTP & WebSocket server bootstrapping with single-writer advisory lock.
 */

import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import pg from 'pg';
import { config } from './config.js';
import { dbPool, releaseWriterLock } from './db.js';
import { SystemClock } from './clock.js';
import { bootstrapCore } from './recovery.js';
import { AuthManager } from './auth.js';
import { AntiBotManager } from './antibot.js';
import { SolvencyCoordinator } from './solvency.js';
import { StoreService } from './store.js';
import { WebSocketGateway } from './websocket.js';
import { registerRoutes } from './routes.js';

export async function buildServer(customPool?: pg.Pool) {
  const pool = customPool || dbPool;

  const isBench = config.RATE_LIMIT_PROFILE === 'bench' || process.env.BENCH === '1';

  const server = Fastify({
    logger: isBench ? false : config.NODE_ENV !== 'test',
    logController: new LogController({
      disableRequestLogging: true,
    }),
    bodyLimit: 15 * 1024 * 1024, // 15MB limit for large payloads / base64 image uploads
  });

  // Support empty JSON bodies gracefully without throwing FST_ERR_CTP_EMPTY_JSON_BODY
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, defaultDone) => {
    try {
      const json = (typeof body === 'string' && body.trim().length > 0) ? JSON.parse(body) : {};
      defaultDone(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      defaultDone(err, undefined);
    }
  });

  await server.register(cookie, {
    secret: config.SESSION_SECRET,
  });

  await server.register(cors, {
    origin: config.CORS_ORIGIN.split(','),
    credentials: true,
  });

  await server.register(websocket, {
    options: {
      maxPayload: 65536, // 64KB per WS message
    },
  });

  const clock = new SystemClock();

  // Bootstrap authoritative ExchangeCore with PostgreSQL recovery
  const core = await bootstrapCore(
    pool,
    clock,
    config.PERSIST_BATCH_MAX,
    config.PERSIST_BATCH_MS,
    config.FORCE_START
  );

  const auth = new AuthManager(pool);
  const antibot = new AntiBotManager(pool, config.POW_SECRET);
  const solvency = new SolvencyCoordinator(pool);
  const store = new StoreService(pool);
  const wsGateway = new WebSocketGateway(auth, core);

  wsGateway.register(server);
  registerRoutes(server, core, auth, antibot, solvency, store);

  // Escrow sweeper interval
  const sweepInterval = setInterval(() => {
    void core.dispatch({ type: 'ESCROW_SWEEP' });
  }, 10_000);

  // Auction auto-expiration sweeper interval (1s tick)
  const auctionSweepInterval = setInterval(() => {
    void core.dispatch({ type: 'AUCTION_SWEEP' });
  }, 1_000);

  server.addHook('onClose', async () => {
    clearInterval(sweepInterval);
    clearInterval(auctionSweepInterval);
    await core.persistence.flush();
    await releaseWriterLock(pool);
    if (!customPool) {
      await pool.end();
    }
  });

  return { server, core, clock };
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  buildServer()
    .then(({ server, core }) => {
      const shutdown = async (signal: string) => {
        console.log(`[SHUTDOWN] Received ${signal}. Draining persistence and closing...`);
        try {
          await core.persistence.flush();
          await server.close();
          console.log('[SHUTDOWN] Server closed cleanly.');
          process.exit(0);
        } catch (err) {
          console.error('[SHUTDOWN] Error during graceful shutdown:', err);
          process.exit(1);
        }
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      server.listen({ port: config.PORT, host: config.HOST }, (err, address) => {
        if (err) {
          console.error('[FATAL] Server failed to start:', err);
          process.exit(1);
        }
        console.log(`=======================================================`);
        console.log(`  THE DARKHOLD EXCHANGE - OPERATIONAL`);
        console.log(`  Listening at: ${address}`);
        console.log(`  Market Mode:  ${config.MARKET_MODE}`);
        console.log(`  Rate Profile: ${config.RATE_LIMIT_PROFILE}`);
        console.log(`=======================================================`);
      });
    })
    .catch((err) => {
      console.error('[FATAL] Boot failure:', err);
      process.exit(1);
    });
}