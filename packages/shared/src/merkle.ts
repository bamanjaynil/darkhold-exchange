/**
 * @file merkle.ts
 * Cryptographic Merkle Sum Tree for Proof of Solvency.
 * Pure TypeScript implementation (no IO, no platform-dependent crypto).
 *
 * Leaf = SHA256(0x00 || 2B_pseudonym_len || pseudonym_bytes || 8B_big_endian_balance)
 * Internal = SHA256(0x01 || leftHash_32B || leftSum_8B || rightHash_32B || rightSum_8B)
 * Odd nodes are promoted to the next level without duplication.
 */

// Pure SHA-256 implementation (FIPS 180-4)
function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = data.length;
  const bitLen = len * 8;
  const padLen = (len % 64 < 56) ? (56 - (len % 64)) : (120 - (len % 64));
  const totalLen = len + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

  const W = new Uint32Array(64);

  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
      const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = sha256Bytes(bytes);
  return Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return out;
}

function writeBigUint64BE(view: DataView, offset: number, value: number): void {
  const big = BigInt(value);
  view.setBigUint64(offset, big, false);
}

export const EMPTY_SOLVENCY_ROOT = sha256Hex('DARKHOLD_EMPTY_SOLVENCY_TREE_V1');

export type SolvencyLeafInput = {
  userId: string;
  balance: number;
};

export type MerkleSumNode = {
  hash: string;
  sum: number;
  userId?: string;
  pseudonym?: string;
};

export type MerkleSibling = {
  hash: string;
  sum: number;
  isLeft: boolean; // true if this sibling is to the left of the current node
};

export type SolvencyInclusionProof = {
  userId: string;
  pseudonym: string;
  balance: number;
  leafHash: string;
  asOfSeq: number;
  snapshotSalt: string;
  expectedRoot: string;
  expectedTotal: number;
  siblings: MerkleSibling[];
};

export function computePseudonym(salt: string, userId: string): string {
  return sha256Hex(`${salt}:${userId}`);
}

export function computeLeafHash(pseudonym: string, balance: number): string {
  const pseudoBytes = new TextEncoder().encode(pseudonym);
  const buf = new Uint8Array(1 + 2 + pseudoBytes.length + 8);
  const view = new DataView(buf.buffer);

  buf[0] = 0x00; // Leaf domain separator
  view.setUint16(1, pseudoBytes.length, false); // 2-byte big endian length
  buf.set(pseudoBytes, 3);
  writeBigUint64BE(view, 3 + pseudoBytes.length, balance);

  return sha256Hex(buf);
}

export function computeInternalNode(
  leftHashHex: string,
  leftSum: number,
  rightHashHex: string,
  rightSum: number
): { hash: string; sum: number } {
  const leftHash = hexToBytes(leftHashHex);
  const rightHash = hexToBytes(rightHashHex);
  const buf = new Uint8Array(1 + 32 + 8 + 32 + 8);
  const view = new DataView(buf.buffer);

  buf[0] = 0x01; // Internal node domain separator
  buf.set(leftHash, 1);
  writeBigUint64BE(view, 33, leftSum);
  buf.set(rightHash, 41);
  writeBigUint64BE(view, 73, rightSum);

  const parentHash = sha256Hex(buf);
  const parentSum = leftSum + rightSum;
  return { hash: parentHash, sum: parentSum };
}

export class MerkleSumTree {
  public readonly salt: string;
  public readonly rootHash: string;
  public readonly totalSum: number;
  public readonly levels: MerkleSumNode[][];
  private readonly leafMap: Map<string, { node: MerkleSumNode; index: number }>;

  constructor(inputs: SolvencyLeafInput[], salt: string) {
    this.salt = salt;
    this.leafMap = new Map();

    if (inputs.length === 0) {
      this.rootHash = EMPTY_SOLVENCY_ROOT;
      this.totalSum = 0;
      this.levels = [[{ hash: this.rootHash, sum: 0 }]];
      return;
    }

    // 1. Map to leaves and sort deterministically by pseudonym
    const leaves: MerkleSumNode[] = inputs.map((inp) => {
      const pseudo = computePseudonym(salt, inp.userId);
      const hash = computeLeafHash(pseudo, inp.balance);
      return {
        hash,
        sum: inp.balance,
        userId: inp.userId,
        pseudonym: pseudo,
      };
    });

    leaves.sort((a, b) => a.pseudonym!.localeCompare(b.pseudonym!));

    leaves.forEach((leaf, idx) => {
      this.leafMap.set(leaf.userId!, { node: leaf, index: idx });
    });

    this.levels = [leaves];

    // 2. Build tree upwards, promoting unpaired odd nodes
    let currentLevel = leaves;
    while (currentLevel.length > 1) {
      const nextLevel: MerkleSumNode[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const left = currentLevel[i];
          const right = currentLevel[i + 1];
          const parent = computeInternalNode(left.hash, left.sum, right.hash, right.sum);
          nextLevel.push(parent);
        } else {
          // Odd node is promoted directly without duplication
          nextLevel.push({ ...currentLevel[i] });
        }
      }
      this.levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.rootHash = this.levels[this.levels.length - 1][0].hash;
    this.totalSum = this.levels[this.levels.length - 1][0].sum;
  }

  public getProof(userId: string, asOfSeq: number): SolvencyInclusionProof | null {
    const entry = this.leafMap.get(userId);
    if (!entry) return null;

    const siblings: MerkleSibling[] = [];
    let idx = entry.index;

    for (let l = 0; l < this.levels.length - 1; l++) {
      const level = this.levels[l];
      const isEven = idx % 2 === 0;
      if (isEven) {
        if (idx + 1 < level.length) {
          siblings.push({
            hash: level[idx + 1].hash,
            sum: level[idx + 1].sum,
            isLeft: false, // Sibling is to the right
          });
        }
        // If idx is last and odd, node was promoted; no sibling at this step
      } else {
        siblings.push({
          hash: level[idx - 1].hash,
          sum: level[idx - 1].sum,
          isLeft: true, // Sibling is to the left
        });
      }
      idx = Math.floor(idx / 2);
    }

    return {
      userId,
      pseudonym: entry.node.pseudonym!,
      balance: entry.node.sum,
      leafHash: entry.node.hash,
      asOfSeq,
      snapshotSalt: this.salt,
      expectedRoot: this.rootHash,
      expectedTotal: this.totalSum,
      siblings,
    };
  }
}

/**
 * Pure verification function executed both on server and in browser client.
 */
export function verifyMerkleSumProof(proof: SolvencyInclusionProof): {
  valid: boolean;
  calculatedRoot: string;
  calculatedTotal: number;
  reason?: string;
} {
  // 1. Verify pseudonym derivation
  const expectedPseudo = computePseudonym(proof.snapshotSalt, proof.userId);
  if (proof.pseudonym !== expectedPseudo) {
    return {
      valid: false,
      calculatedRoot: '',
      calculatedTotal: 0,
      reason: 'PSEUDONYM_HASH_MISMATCH',
    };
  }

  // 2. Verify leaf hash derivation
  const calculatedLeaf = computeLeafHash(proof.pseudonym, proof.balance);
  if (calculatedLeaf !== proof.leafHash) {
    return {
      valid: false,
      calculatedRoot: calculatedLeaf,
      calculatedTotal: proof.balance,
      reason: 'LEAF_HASH_MISMATCH',
    };
  }

  // 3. Walk upwards through siblings
  let currentHash = calculatedLeaf;
  let currentSum = proof.balance;

  for (const sibling of proof.siblings) {
    if (sibling.sum < 0) {
      return {
        valid: false,
        calculatedRoot: currentHash,
        calculatedTotal: currentSum,
        reason: 'NEGATIVE_SIBLING_SUM',
      };
    }

    if (sibling.isLeft) {
      const parent = computeInternalNode(sibling.hash, sibling.sum, currentHash, currentSum);
      currentHash = parent.hash;
      currentSum = parent.sum;
    } else {
      const parent = computeInternalNode(currentHash, currentSum, sibling.hash, sibling.sum);
      currentHash = parent.hash;
      currentSum = parent.sum;
    }
  }

  const rootMatches = currentHash === proof.expectedRoot;
  const totalMatches = currentSum === proof.expectedTotal;

  if (!rootMatches) {
    return {
      valid: false,
      calculatedRoot: currentHash,
      calculatedTotal: currentSum,
      reason: 'ROOT_HASH_MISMATCH',
    };
  }

  if (!totalMatches) {
    return {
      valid: false,
      calculatedRoot: currentHash,
      calculatedTotal: currentSum,
      reason: 'TOTAL_LIABILITY_MISMATCH',
    };
  }

  return {
    valid: true,
    calculatedRoot: currentHash,
    calculatedTotal: currentSum,
  };
}