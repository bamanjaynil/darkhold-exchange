/**
 * @file pow-worker.ts
 * Web Worker for non-blocking client-side Proof-of-Work (PoW) computation.
 */

import { solvePoW } from '@darkhold/shared';

self.onmessage = (e: MessageEvent<{ seed: string; difficultyBits: number }>) => {
  const { seed, difficultyBits } = e.data;
  const t0 = performance.now();
  const nonce = solvePoW(seed, difficultyBits, 5_000_000);
  const elapsedMs = Math.round(performance.now() - t0);

  self.postMessage({ nonce, elapsedMs });
};