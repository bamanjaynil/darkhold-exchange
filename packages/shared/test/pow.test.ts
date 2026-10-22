import { describe, it, expect } from 'vitest';
import {
  computeChallengeMac,
  verifyPoWSolution,
  solvePoW,
  PoWSolution,
} from '../src/pow.js';

describe('pow.ts Proof-of-Work verifier', () => {
  const secret = 'test_pow_secret_darkhold_2026';
  const now = 1700000000;
  const challengeId = 'ch_123';
  const seed = 'seed_xyz_890';
  const difficultyBits = 8; // Small difficulty for fast test execution
  const expiresAt = now + 60;

  it('generates valid solution that passes verification', () => {
    const mac = computeChallengeMac(secret, challengeId, seed, difficultyBits, expiresAt);
    const nonce = solvePoW(seed, difficultyBits, 100000);
    expect(nonce).not.toBeNull();

    const solution: PoWSolution = {
      challengeId,
      seed,
      difficultyBits,
      expiresAt,
      mac,
      nonce: nonce!,
    };

    const res = verifyPoWSolution(solution, secret, now);
    expect(res.valid).toBe(true);
  });

  it('rejects expired challenge', () => {
    const mac = computeChallengeMac(secret, challengeId, seed, difficultyBits, expiresAt);
    const solution: PoWSolution = {
      challengeId,
      seed,
      difficultyBits,
      expiresAt,
      mac,
      nonce: '1',
    };

    const res = verifyPoWSolution(solution, secret, expiresAt + 1);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('POW_EXPIRED');
  });

  it('rejects tampered MAC', () => {
    const solution: PoWSolution = {
      challengeId,
      seed,
      difficultyBits,
      expiresAt,
      mac: 'tampered_fake_mac',
      nonce: '1',
    };

    const res = verifyPoWSolution(solution, secret, now);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('POW_INVALID_MAC');
  });

  it('rejects nonce with insufficient difficulty', () => {
    const mac = computeChallengeMac(secret, challengeId, seed, 20, expiresAt);
    const solution: PoWSolution = {
      challengeId,
      seed,
      difficultyBits: 20, // High difficulty
      expiresAt,
      mac,
      nonce: 'invalid_nonce_0',
    };

    const res = verifyPoWSolution(solution, secret, now);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('POW_INSUFFICIENT_DIFFICULTY');
  });
});