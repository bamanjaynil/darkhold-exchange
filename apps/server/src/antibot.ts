/**
 * @file antibot.ts
 * Adaptive Proof-of-Work (PoW) challenge generator, replay prevention cache,
 * token-bucket rate limiter, and audit logger.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import {
  computeChallengeMac,
  verifyPoWSolution,
  PoWChallenge,
  PoWSolution,
} from '@darkhold/shared';

type ClientStats = {
  requestCount: number;
  lastReset: number;
};

export class AntiBotManager {
  private secret: string;
  private pool: pg.Pool;
  private clientStats = new Map<string, ClientStats>();
  private usedChallenges = new Set<string>(); // Bounded replay cache
  private orderRateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(pool: pg.Pool, secret: string = config.POW_SECRET) {
    this.pool = pool;
    this.secret = secret;

    // Prune replay cache every 5 minutes
    setInterval(() => {
      this.usedChallenges.clear();
    }, 300_000);
  }

  public getAdaptiveDifficulty(clientId: string): number {
    const now = Date.now();
    let stats = this.clientStats.get(clientId);
    if (!stats || now - stats.lastReset > 60_000) {
      stats = { requestCount: 0, lastReset: now };
      this.clientStats.set(clientId, stats);
    }

    stats.requestCount++;
    const base = config.POW_MIN_DIFFICULTY;
    const max = config.POW_MAX_DIFFICULTY;

    // Adapt upward if more than 20 requests/minute
    if (stats.requestCount > 50) return Math.min(max, base + 8);
    if (stats.requestCount > 20) return Math.min(max, base + 4);
    return base;
  }

  public createChallenge(clientId: string): PoWChallenge {
    const challengeId = `pow_${crypto.randomBytes(12).toString('hex')}`;
    const seed = crypto.randomBytes(16).toString('hex');
    const difficultyBits = this.getAdaptiveDifficulty(clientId);
    const expiresAt = Math.floor(Date.now() / 1000) + 120; // 2 minutes validity

    const mac = computeChallengeMac(
      this.secret,
      challengeId,
      seed,
      difficultyBits,
      expiresAt
    );

    return { challengeId, seed, difficultyBits, expiresAt, mac };
  }

  public verifySubmission(
    solution: PoWSolution,
    userId: string,
    ip: string
  ): { valid: boolean; reason?: string } {
    if (this.usedChallenges.has(solution.challengeId)) {
      void this.logAudit('POW_REPLAY', 'POW_REPLAY_DETECTED', userId, ip);
      return { valid: false, reason: 'POW_REPLAY' };
    }

    const now = Math.floor(Date.now() / 1000);
    const result = verifyPoWSolution(solution, this.secret, now);

    if (!result.valid) {
      void this.logAudit('POW_FAILURE', result.reason || 'POW_INVALID', userId, ip);
      return result;
    }

    this.usedChallenges.add(solution.challengeId);
    return { valid: true };
  }

  public checkOrderRateLimit(userId: string, ip: string): boolean {
    const limit = config.RATE_LIMIT_PROFILE === 'bench' ? 10_000 : config.RATE_LIMIT_ORDERS_PER_SEC;
    const key = `${userId}:${ip}`;
    const now = Date.now();

    let bucket = this.orderRateBuckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      this.orderRateBuckets.set(key, bucket);
    }

    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * limit);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      void this.logAudit('RATE_LIMITED', 'ORDER_RATE_LIMIT_EXCEEDED', userId, ip);
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  public async logAudit(
    eventType: string,
    reason: string,
    userId?: string,
    ip?: string,
    metadata?: any
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_events (event_type, reason, user_id, ip, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventType, reason, userId, ip, metadata ? JSON.stringify(metadata) : null]
      );
    } catch (err) {
      console.error('[AUDIT_ERROR] Could not write audit log:', err);
    }
  }
}