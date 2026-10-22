/**
 * @file reconciliation.ts
 * Real-time and audit reconciliation engine.
 * Recomputes all balances and holdings directly from immutable postings,
 * comparing against DB cache tables and in-memory ExchangeCore state.
 */

import pg from 'pg';
import { ExchangeCore } from './core.js';

export type ReconciliationReport = {
  timestamp: string;
  balanced: boolean;
  globalUnitSums: Record<string, number>;
  anomaliesCount: number;
  anomalies: string[];
};

export async function runReconciliation(
  pool: pg.Pool,
  core?: ExchangeCore
): Promise<ReconciliationReport> {
  const client = await pool.connect();
  const anomalies: string[] = [];

  try {
    // 1. Verify Global Conservation: Every Unit Must Sum to Exactly 0
    const { rows: unitRows } = await client.query<{ unit: string; total: string }>(`
      SELECT unit, COALESCE(SUM(amount), 0) AS total
      FROM postings
      GROUP BY unit
    `);

    const globalUnitSums: Record<string, number> = {};
    for (const r of unitRows) {
      const sum = Number(r.total);
      globalUnitSums[r.unit] = sum;
      if (sum !== 0) {
        anomalies.push(`[GLOBAL_IMBALANCE] Unit ${r.unit} does not sum to 0. Total = ${sum}`);
      }
    }

    // 2. Recompute User Cash Balances from Postings
    const { rows: cashRows } = await client.query<{
      owner_user_id: string;
      kind: string;
      total: string;
    }>(`
      SELECT la.owner_user_id, la.kind, COALESCE(SUM(p.amount), 0) AS total
      FROM ledger_accounts la
      LEFT JOIN postings p ON la.id = p.account_id AND p.unit = 'CASH'
      WHERE la.owner_user_id IS NOT NULL AND la.instrument_id IS NULL
      GROUP BY la.owner_user_id, la.kind
    `);

    const computedBalances = new Map<string, { available: number; reserved: number; escrow: number }>();
    for (const r of cashRows) {
      let b = computedBalances.get(r.owner_user_id);
      if (!b) {
        b = { available: 0, reserved: 0, escrow: 0 };
        computedBalances.set(r.owner_user_id, b);
      }
      const amt = Number(r.total);
      if (r.kind === 'USER_AVAILABLE') b.available = amt;
      else if (r.kind === 'USER_RESERVED') b.reserved = amt;
      else if (r.kind === 'ESCROW') b.escrow = amt;
    }

    // 3. Compare with DB Balances Cache
    const { rows: dbBalRows } = await client.query<{
      user_id: string;
      available: string;
      reserved: string;
      escrow: string;
    }>('SELECT user_id, available, reserved, escrow FROM balances');

    for (const r of dbBalRows) {
      const comp = computedBalances.get(r.user_id) || { available: 0, reserved: 0, escrow: 0 };
      if (Number(r.available) !== comp.available) {
        anomalies.push(
          `[BALANCE_CACHE_DIVERGENCE] User ${r.user_id} available cache ${r.available} != ledger ${comp.available}`
        );
      }
      if (Number(r.reserved) !== comp.reserved) {
        anomalies.push(
          `[BALANCE_CACHE_DIVERGENCE] User ${r.user_id} reserved cache ${r.reserved} != ledger ${comp.reserved}`
        );
      }
      if (Number(r.escrow) !== comp.escrow) {
        anomalies.push(
          `[BALANCE_CACHE_DIVERGENCE] User ${r.user_id} escrow cache ${r.escrow} != ledger ${comp.escrow}`
        );
      }

      // Check against Core RAM state if provided
      if (core) {
        const coreBal = core.getBalance(r.user_id);
        if (coreBal.available !== comp.available || coreBal.reserved !== comp.reserved || coreBal.escrow !== comp.escrow) {
          anomalies.push(
            `[RAM_CACHE_DIVERGENCE] User ${r.user_id} in-memory balance differs from reconstructed ledger`
          );
        }
      }
    }

    return {
      timestamp: new Date().toISOString(),
      balanced: anomalies.length === 0,
      globalUnitSums,
      anomaliesCount: anomalies.length,
      anomalies,
    };
  } finally {
    client.release();
  }
}