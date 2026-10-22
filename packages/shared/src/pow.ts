/**
 * @file pow.ts
 * Proof-of-Work (PoW) verification and solver for anti-bot protection.
 * Pure TypeScript (compatible with Node.js, Web Workers, and browsers).
 */

import { sha256Bytes, sha256Hex } from './merkle.js';

export type PoWChallenge = {
  challengeId: string;
  seed: string;
  difficultyBits: number;
  expiresAt: number;
  mac: string;
};

export type PoWSolution = {
  challengeId: string;
  seed: string;
  difficultyBits: number;
  expiresAt: number;
  mac: string;
  nonce: string;
};

/**
 * Pure HMAC-SHA256 implementation using the pure sha256Bytes function.
 */
export function hmacSha256(key: string, message: string): string {
  const encoder = new TextEncoder();
  let keyBytes: Uint8Array = new Uint8Array(encoder.encode(key));

  if (keyBytes.length > 64) {
    keyBytes = sha256Bytes(keyBytes);
  }

  const kPadded = new Uint8Array(64);
  kPadded.set(keyBytes);

  const iPad = new Uint8Array(64);
  const oPad = new Uint8Array(64);

  for (let i = 0; i < 64; i++) {
    iPad[i] = kPadded[i] ^ 0x36;
    oPad[i] = kPadded[i] ^ 0x5c;
  }

  const msgBytes = encoder.encode(message);
  const inner = new Uint8Array(64 + msgBytes.length);
  inner.set(iPad, 0);
  inner.set(msgBytes, 64);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(64 + 32);
  outer.set(oPad, 0);
  outer.set(innerHash, 64);
  return sha256Hex(outer);
}

export function computeChallengeMac(
  secret: string,
  challengeId: string,
  seed: string,
  difficultyBits: number,
  expiresAt: number
): string {
  const payload = `${challengeId}:${seed}:${difficultyBits}:${expiresAt}`;
  return hmacSha256(secret, payload);
}

export function countLeadingZeroBits(bytes: Uint8Array): number {
  let zeros = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) {
      zeros += 8;
    } else {
      zeros += Math.clz32(b) - 24;
      break;
    }
  }
  return zeros;
}

export function verifyPoWSolution(
  solution: PoWSolution,
  secret: string,
  currentTime: number
): { valid: boolean; reason?: string } {
  // 1. Expiry check
  if (solution.expiresAt <= currentTime) {
    return { valid: false, reason: 'POW_EXPIRED' };
  }

  // 2. MAC authenticity check
  const expectedMac = computeChallengeMac(
    secret,
    solution.challengeId,
    solution.seed,
    solution.difficultyBits,
    solution.expiresAt
  );
  if (solution.mac !== expectedMac) {
    return { valid: false, reason: 'POW_INVALID_MAC' };
  }

  // 3. Difficulty leading zero bit verification
  const candidateBytes = new TextEncoder().encode(`${solution.seed}:${solution.nonce}`);
  const hashBytes = sha256Bytes(candidateBytes);
  const leadingZeros = countLeadingZeroBits(hashBytes);

  if (leadingZeros < solution.difficultyBits) {
    return { valid: false, reason: 'POW_INSUFFICIENT_DIFFICULTY' };
  }

  return { valid: true };
}

/**
 * Client-side / Worker solver that increments a nonce until the hash satisfies difficultyBits.
 */
export function solvePoW(
  seed: string,
  difficultyBits: number,
  maxIterations: number = 2_000_000
): string | null {
  const encoder = new TextEncoder();
  let nonceNum = 0;

  while (nonceNum < maxIterations) {
    const nonce = nonceNum.toString(16);
    const candidate = encoder.encode(`${seed}:${nonce}`);
    const hash = sha256Bytes(candidate);
    if (countLeadingZeroBits(hash) >= difficultyBits) {
      return nonce;
    }
    nonceNum++;
  }

  return null;
}