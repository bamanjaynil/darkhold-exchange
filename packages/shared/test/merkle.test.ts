import { describe, it, expect } from 'vitest';
import {
  MerkleSumTree,
  verifyMerkleSumProof,
  EMPTY_SOLVENCY_ROOT,
  computeLeafHash,
  computePseudonym,
} from '../src/merkle.js';

describe('merkle.ts Proof of Solvency Sum Tree', () => {
  const salt = 'test_salt_darkhold_2026';

  it('handles empty trees deterministically', () => {
    const tree = new MerkleSumTree([], salt);
    expect(tree.rootHash).toBe(EMPTY_SOLVENCY_ROOT);
    expect(tree.totalSum).toBe(0);
    expect(tree.getProof('usr_alice', 1)).toBeNull();
  });

  it('handles single-leaf trees', () => {
    const users = [{ userId: 'usr_alice', balance: 500000 }];
    const tree = new MerkleSumTree(users, salt);
    expect(tree.totalSum).toBe(500000);

    const proof = tree.getProof('usr_alice', 10);
    expect(proof).not.toBeNull();
    expect(proof!.siblings.length).toBe(0);

    const res = verifyMerkleSumProof(proof!);
    expect(res.valid).toBe(true);
    expect(res.calculatedRoot).toBe(tree.rootHash);
    expect(res.calculatedTotal).toBe(500000);
  });

  it('handles odd leaf counts (promotes unpaired nodes without duplication)', () => {
    const users = [
      { userId: 'usr_alice', balance: 100000 },
      { userId: 'usr_bob', balance: 200000 },
      { userId: 'usr_carol', balance: 300000 },
    ];
    const tree = new MerkleSumTree(users, salt);
    expect(tree.totalSum).toBe(600000);

    for (const u of users) {
      const proof = tree.getProof(u.userId, 100);
      expect(proof).not.toBeNull();
      const res = verifyMerkleSumProof(proof!);
      expect(res.valid).toBe(true);
      expect(res.calculatedRoot).toBe(tree.rootHash);
      expect(res.calculatedTotal).toBe(600000);
    }
  });

  it('detects tampered balance in proof', () => {
    const users = [
      { userId: 'usr_alice', balance: 100000 },
      { userId: 'usr_bob', balance: 200000 },
    ];
    const tree = new MerkleSumTree(users, salt);
    const proof = tree.getProof('usr_alice', 100)!;

    // Tamper balance
    const tamperedProof = { ...proof, balance: 999999 };
    const res = verifyMerkleSumProof(tamperedProof);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('LEAF_HASH_MISMATCH');
  });

  it('detects tampered sibling hash or sum', () => {
    const users = [
      { userId: 'usr_alice', balance: 100000 },
      { userId: 'usr_bob', balance: 200000 },
    ];
    const tree = new MerkleSumTree(users, salt);
    const proof = tree.getProof('usr_alice', 100)!;

    // Tamper sibling sum
    const badSibling = { ...proof.siblings[0], sum: 500000 };
    const tamperedProof = { ...proof, siblings: [badSibling] };
    const res = verifyMerkleSumProof(tamperedProof);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('ROOT_HASH_MISMATCH');
  });

  it('detects tampered pseudonym', () => {
    const users = [
      { userId: 'usr_alice', balance: 100000 },
      { userId: 'usr_bob', balance: 200000 },
    ];
    const tree = new MerkleSumTree(users, salt);
    const proof = tree.getProof('usr_alice', 100)!;

    const tamperedProof = { ...proof, pseudonym: 'tampered_fake_pseudonym' };
    const res = verifyMerkleSumProof(tamperedProof);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('PSEUDONYM_HASH_MISMATCH');
  });
});