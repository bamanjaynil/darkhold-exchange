/**
 * @file solvency.ts
 * Proof of Solvency snapshot and inclusion proof coordinator.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { MerkleSumTree, SolvencyInclusionProof } from '@darkhold/shared';
import { ExchangeCore } from './core.js';

export type SnapshotRecord = {
  id: string;
  asOfSeq: number;
  rootHash: string;
  totalLiabilities: number;
  snapshotSalt: string;
  createdAt: string;
};

export class SolvencyCoordinator {
  private pool: pg.Pool;
  private latestTree: MerkleSumTree | null = null;
  private latestSnapshot: SnapshotRecord | null = null;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async createSnapshot(core: ExchangeCore): Promise<SnapshotRecord> {
    const salt = crypto.randomBytes(16).toString('hex');

    // Aggregate liabilities: available + reserved + escrow
    const userLiabilities: Array<{ userId: string; balance: number }> = [];
    for (const [userId, bal] of core.balances.entries()) {
      const total = bal.available + bal.reserved + bal.escrow;
      if (total > 0) {
        userLiabilities.push({ userId, balance: total });
      }
    }

    const tree = new MerkleSumTree(userLiabilities, salt);
    this.latestTree = tree;

    const snapshotId = `solv_${Date.now()}`;
    const asOfSeq = core.seq;

    await this.pool.query(
      `INSERT INTO solvency_snapshots (id, as_of_seq, root_hash, total_liabilities, snapshot_salt)
       VALUES ($1, $2, $3, $4, $5)`,
      [snapshotId, asOfSeq, tree.rootHash, tree.totalSum, salt]
    );

    this.latestSnapshot = {
      id: snapshotId,
      asOfSeq,
      rootHash: tree.rootHash,
      totalLiabilities: tree.totalSum,
      snapshotSalt: salt,
      createdAt: new Date().toISOString(),
    };

    return this.latestSnapshot;
  }

  public clearSnapshot(): void {
    this.latestTree = null;
    this.latestSnapshot = null;
  }

  public async getProofForUser(userId: string, core: ExchangeCore): Promise<SolvencyInclusionProof | null> {
    if (!this.latestTree || !this.latestSnapshot || this.latestSnapshot.asOfSeq !== core.seq) {
      // Create fresh snapshot if none exists or if state sequence evolved
      await this.createSnapshot(core);
    }

    return this.latestTree!.getProof(userId, this.latestSnapshot!.asOfSeq);
  }

  public getLatestSnapshot(): SnapshotRecord | null {
    return this.latestSnapshot;
  }
}