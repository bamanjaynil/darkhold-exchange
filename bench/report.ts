/**
 * @file report.ts
 * Injects latest benchmark telemetry results into README.md
 * between <!-- BENCH:START --> and <!-- BENCH:END --> markers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run() {
  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  const enginePath = path.join(resultsDir, 'engine-bench.json');
  const corePath = path.join(resultsDir, 'core-bench.json');
  const httpPath = path.join(resultsDir, 'http-bench.json');

  let reportMd = '### Measured Benchmark Performance\n\n';

  if (fs.existsSync(enginePath)) {
    const e = JSON.parse(fs.readFileSync(enginePath, 'utf-8'));
    reportMd += `#### 1. In-Process Matching Engine Benchmark (\`BENCH-X\`)\n`;
    reportMd += `- **Throughput:** ${e.metrics.throughputOpsSec.toLocaleString()} orders/sec\n`;
    reportMd += `- **p50 Latency:** ${e.metrics.latency.p50} µs\n`;
    reportMd += `- **p95 Latency:** ${e.metrics.latency.p95} µs\n`;
    reportMd += `- **p99 Latency:** ${e.metrics.latency.p99} µs\n`;
    reportMd += `- **Total Orders / Trades:** ${e.metrics.totalOrders.toLocaleString()} / ${e.metrics.tradesExecuted.toLocaleString()}\n\n`;
  }

  if (fs.existsSync(corePath)) {
    const c = JSON.parse(fs.readFileSync(corePath, 'utf-8'));
    reportMd += `#### 2. ExchangeCore with Group-Commit Persistence Benchmark\n`;
    reportMd += `- **Throughput:** ${c.metrics.throughputOpsSec.toLocaleString()} orders/sec\n`;
    reportMd += `- **Batch Settings:** max ${c.config.batchMax} orders or ${c.config.batchMs} ms\n`;
    reportMd += `- **Post-Benchmark Ledger Reconciliation:** ${c.metrics.postReconciliationBalanced ? 'CLEAN (100% Balanced)' : 'IMBALANCED'}\n\n`;
  }

  if (fs.existsSync(httpPath)) {
    const h = JSON.parse(fs.readFileSync(httpPath, 'utf-8'));
    reportMd += `#### 3. HTTP Pipeline Benchmark\n`;
    reportMd += `- **Throughput:** ${h.metrics.throughputOpsSec.toLocaleString()} req/sec\n`;
    reportMd += `- **p50 Latency:** ${h.metrics.latencyMs.p50} ms\n`;
    reportMd += `- **p95 Latency:** ${h.metrics.latencyMs.p95} ms\n\n`;
  }

  const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
  if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf-8');
    const startTag = '<!-- BENCH:START -->';
    const endTag = '<!-- BENCH:END -->';
    if (readme.includes(startTag) && readme.includes(endTag)) {
      const before = readme.substring(0, readme.indexOf(startTag) + startTag.length);
      const after = readme.substring(readme.indexOf(endTag));
      readme = `${before}\n\n${reportMd}\n${after}`;
      fs.writeFileSync(readmePath, readme, 'utf-8');
      console.log('[BENCH:REPORT] Injected benchmark results into README.md');
    }
  }
}

run();