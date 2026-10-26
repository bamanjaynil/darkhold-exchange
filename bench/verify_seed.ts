import pg from 'pg';
import { runReconciliation } from '../apps/server/src/reconciliation.js';

try { process.loadEnvFile('.env'); } catch {}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://darkhold:local_dev_only_change_me@localhost:5433/darkhold_exchange?schema=public'
  });

  const report = await runReconciliation(pool);
  console.log('Reconciliation Report after Seed:');
  console.log('Balanced:', report.balanced);
  console.log('Anomalies count:', report.anomaliesCount);
  console.log('Anomalies:', report.anomalies);
  await pool.end();

  if (!report.balanced || report.anomaliesCount > 0) {
    process.exit(1);
  } else {
    console.log('SUCCESS: 0 anomalies detected!');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
