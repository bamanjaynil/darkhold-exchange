/**
 * @file http-bench.mjs
 * Dependency-light Node HTTP pipeline benchmark.
 * Measures end-to-end HTTP order placement latency and throughput against the Fastify server.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DURATION_SEC = 5;

async function run() {
  console.log(`[BENCH:HTTP] Starting HTTP order pipeline benchmark against ${BASE_URL}...`);

  // 1. Authenticate admin user
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin_darkhold_2026' }),
  });

  if (!loginRes.ok) {
    console.warn('[BENCH:HTTP] Could not connect to live server. Ensure "pnpm dev:server" is running.');
    return;
  }

  const setCookie = loginRes.headers.get('set-cookie') || '';
  const cookies = setCookie.split(',').map((c) => c.split(';')[0]).join('; ');
  const loginData = await loginRes.json();
  const csrfToken = loginData.csrfToken;

  const latenciesMs = [];
  let submitted = 0;
  let accepted = 0;
  let rejected = 0;

  const endTime = Date.now() + DURATION_SEC * 1000;
  const startTime = Date.now();

  while (Date.now() < endTime) {
    submitted++;
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies,
          'x-csrf-token': csrfToken,
          'x-bench-bypass': 'true',
        },
        body: JSON.stringify({
          clientOrderId: `http_bench_${Date.now()}_${submitted}`,
          symbol: 'BENCH-X',
          side: submitted % 2 === 0 ? 'BUY' : 'SELL',
          type: 'LIMIT',
          tif: 'GTC',
          price: 100000,
          qty: 1,
        }),
      });

      const t1 = performance.now();
      latenciesMs.push(t1 - t0);

      if (res.ok) accepted++;
      else rejected++;
    } catch {
      rejected++;
    }
  }

  const durationMs = Date.now() - startTime;
  const throughput = Math.round((submitted / (durationMs / 1000)));

  latenciesMs.sort((a, b) => a - b);
  const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)] || 0;
  const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)] || 0;
  const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)] || 0;

  const results = {
    benchmark: 'HTTP Order Pipeline Benchmark',
    timestamp: new Date().toISOString(),
    host: {
      platform: os.platform(),
      node: process.version,
    },
    metrics: {
      durationSec: DURATION_SEC,
      ordersSubmitted: submitted,
      ordersAccepted: accepted,
      ordersRejected: rejected,
      throughputOpsSec: throughput,
      latencyMs: {
        p50: Math.round(p50 * 100) / 100,
        p95: Math.round(p95 * 100) / 100,
        p99: Math.round(p99 * 100) / 100,
      },
    },
  };

  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'http-bench.json'), JSON.stringify(results, null, 2));

  console.log(`[BENCH:HTTP] Completed: ${throughput} req/sec | p50: ${p50.toFixed(2)} ms`);
}

run().catch(console.error);