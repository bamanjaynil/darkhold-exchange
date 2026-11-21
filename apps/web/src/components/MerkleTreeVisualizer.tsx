/**
 * @file MerkleTreeVisualizer.tsx
 * Interactive 2D Merkle Sum Tree Diagram and Cryptographic Proof Inspector.
 * Demonstrates hierarchical leaf summation, sibling hash paths, and instant fraud rejection.
 */

import React, { useState } from 'react';
import { formatDKC, SolvencyInclusionProof } from '@darkhold/shared';

interface MerkleTreeVisualizerProps {
  proof: SolvencyInclusionProof | null;
  activeUsername?: string;
  isTampered: boolean;
  tamperedInfo: {
    forgedBalance: number;
    delta: number;
    calculatedRoot: string;
    expectedRoot: string;
    calculatedTotal: number;
    expectedTotal: number;
    reason: string;
  } | null;
}

export const MerkleTreeVisualizer: React.FC<MerkleTreeVisualizerProps> = ({
  proof,
  activeUsername = 'YOU',
  isTampered,
  tamperedInfo,
}) => {
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  if (!proof) {
    return (
      <div
        className="card"
        style={{
          padding: 32,
          textAlign: 'center',
          color: '#64748B',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>🌲</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>
          Merkle Sum Tree Offline
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', maxWidth: 360 }}>
          Click <strong>RUN LIVE SOLVENCY AUDIT</strong> on the left to hydrate your account inclusion proof and construct the live cryptographic tree.
        </div>
      </div>
    );
  }

  const userBalance = isTampered && tamperedInfo ? tamperedInfo.forgedBalance : proof.balance;
  const userLeafHash = isTampered && tamperedInfo ? tamperedInfo.calculatedRoot : proof.leafHash;
  const totalLiabilities = proof.expectedTotal;

  // Sibling nodes from proof
  const siblings = proof.siblings || [];
  const sib1 = siblings[0] || { sum: 5000000, hash: 'b8b3638a642c5bebccaaa825f0d2a1625863745e3248eeeaa40a084b69e2e704', isLeft: true };
  const sib2 = siblings[1] || { sum: 10000000, hash: '0e531c0c0d0a5cc4ea640d777010c8f6665728ef88ee10c8dc99c96c4b7c991d', isLeft: false };

  // Intermediate branch sums
  const leftBranchSum = sib2.isLeft ? sib2.sum : 10000000;
  const rightBranchSum = isTampered && tamperedInfo
    ? (sib1.sum + userBalance)
    : 10000000;

  const handleCopyProof = () => {
    navigator.clipboard.writeText(JSON.stringify(isTampered && tamperedInfo ? { ...proof, ...tamperedInfo } : proof, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Visualizer Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌲</span>
          <div>
            <strong style={{ fontSize: 14, color: '#00F0FF', letterSpacing: '0.04em' }}>
              MERKLE SUM TREE TOPOLOGY
            </strong>
            <div style={{ fontSize: 10, color: '#64748B' }}>
              Hierarchical zero-knowledge liability summation
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowRawJson(!showRawJson)}
            style={{
              background: showRawJson ? 'rgba(0, 240, 255, 0.2)' : '#0F172A',
              border: '1px solid #1E293B',
              color: showRawJson ? '#00F0FF' : '#94A3B8',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            {showRawJson ? 'HIDE JSON' : 'RAW PROOF JSON'}
          </button>
          <button
            type="button"
            onClick={handleCopyProof}
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid #10B981',
              color: '#10B981',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            {copied ? '✓ COPIED!' : 'COPY PROOF'}
          </button>
        </div>
      </div>

      {showRawJson ? (
        <pre
          style={{
            margin: 0,
            background: '#040711',
            border: '1px solid #1E293B',
            borderRadius: 6,
            padding: 12,
            fontSize: 11,
            color: '#00F0FF',
            maxHeight: 450,
            overflowY: 'auto',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {JSON.stringify(isTampered && tamperedInfo ? { ...proof, ...tamperedInfo } : proof, null, 2)}
        </pre>
      ) : (
        /* The Merkle Tree Diagram */
        <div
          style={{
            background: '#040711',
            border: `1px solid ${isTampered ? 'rgba(255, 42, 84, 0.4)' : '#161F30'}`,
            borderRadius: 8,
            padding: '20px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            position: 'relative',
            overflowX: 'auto',
            transition: 'border-color 0.3s ease',
          }}
        >
          {/* LEVEL 2: Merkle Root Node */}
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: isTampered
                ? 'linear-gradient(135deg, rgba(255, 42, 84, 0.25) 0%, rgba(30, 10, 15, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 20, 20, 0.95) 100%)',
              border: `2px solid ${isTampered ? '#FF2A54' : '#10B981'}`,
              borderRadius: 8,
              padding: '12px 16px',
              textAlign: 'center',
              boxShadow: isTampered ? '0 0 25px rgba(255, 42, 84, 0.3)' : '0 0 20px rgba(16, 185, 129, 0.2)',
              position: 'relative',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: isTampered ? '#FF2A54' : '#10B981', letterSpacing: '0.08em' }}>
                LEVEL 2 • MERKLE ROOT
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: isTampered ? 'rgba(255, 42, 84, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  color: isTampered ? '#FF2A54' : '#10B981',
                  border: `1px solid ${isTampered ? '#FF2A54' : '#10B981'}`,
                }}
              >
                {isTampered ? '✕ HASH MISMATCH' : '✓ 100% SOLVENT'}
              </span>
            </div>

            <div style={{ fontSize: 18, fontWeight: 900, color: '#F8FAFC', margin: '4px 0' }}>
              {isTampered && tamperedInfo ? formatDKC(tamperedInfo.calculatedTotal) : formatDKC(totalLiabilities)}
            </div>

            <div style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
              Root Hash:{' '}
              <span style={{ color: isTampered ? '#FF2A54' : '#00F0FF', fontWeight: 600 }}>
                {isTampered && tamperedInfo ? `${tamperedInfo.calculatedRoot.slice(0, 16)}...` : `${proof.expectedRoot.slice(0, 16)}...`}
              </span>
            </div>

            {isTampered && tamperedInfo && (
              <div style={{ marginTop: 6, fontSize: 9, color: '#FF2A54', fontWeight: 700 }}>
                🚨 Recomputed root hash does not match canonical exchange liability root!
              </div>
            )}
          </div>

          {/* Connectors: Level 2 to Level 1 */}
          <svg width="280" height="24" viewBox="0 0 280 24" style={{ overflow: 'visible' }}>
            <line
              x1="140"
              y1="0"
              x2="70"
              y2="24"
              stroke={isTampered ? '#64748B' : '#10B981'}
              strokeWidth="2"
              strokeDasharray={isTampered ? '4 2' : 'none'}
            />
            <line
              x1="140"
              y1="0"
              x2="210"
              y2="24"
              stroke={isTampered ? '#FF2A54' : '#10B981'}
              strokeWidth="2"
            />
          </svg>

          {/* LEVEL 1: Intermediate Branch Nodes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%', maxWidth: 460 }}>
            {/* Left Branch (Unaffected) */}
            <div
              style={{
                background: '#0B101E',
                border: '1px solid #1E293B',
                borderRadius: 6,
                padding: '10px 12px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 800, color: '#64748B', marginBottom: 2 }}>
                BRANCH L (SIBLING)
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC' }}>
                {formatDKC(leftBranchSum)}
              </div>
              <div style={{ fontSize: 9, color: '#64748B', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>
                Hash: {sib2.hash.slice(0, 10)}...
              </div>
            </div>

            {/* Right Branch (User's Branch Path) */}
            <div
              style={{
                background: isTampered ? 'rgba(255, 42, 84, 0.12)' : '#0B101E',
                border: `1px solid ${isTampered ? '#FF2A54' : 'rgba(0, 240, 255, 0.4)'}`,
                borderRadius: 6,
                padding: '10px 12px',
                textAlign: 'center',
                boxShadow: isTampered ? '0 0 12px rgba(255, 42, 84, 0.25)' : 'none',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 800, color: isTampered ? '#FF2A54' : '#00F0FF', marginBottom: 2 }}>
                BRANCH R {isTampered ? '✕ CORRUPTED' : '(INCLUSION PATH)'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: isTampered ? '#FF2A54' : '#F8FAFC' }}>
                {formatDKC(rightBranchSum)}
              </div>
              <div style={{ fontSize: 9, color: isTampered ? '#FF2A54' : '#64748B', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>
                {isTampered ? 'Sum inflated by +10,000 DKC' : 'Verified User Branch'}
              </div>
            </div>
          </div>

          {/* Connectors: Level 1 to Level 0 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%', maxWidth: 460 }}>
            <svg width="100%" height="20" viewBox="0 0 200 20" style={{ overflow: 'visible' }}>
              <line x1="100" y1="0" x2="50" y2="20" stroke="#334155" strokeWidth="1.5" />
              <line x1="100" y1="0" x2="150" y2="20" stroke="#334155" strokeWidth="1.5" />
            </svg>
            <svg width="100%" height="20" viewBox="0 0 200 20" style={{ overflow: 'visible' }}>
              <line x1="100" y1="0" x2="50" y2="20" stroke={isTampered ? '#64748B' : '#00F0FF'} strokeWidth="1.5" />
              <line
                x1="100"
                y1="0"
                x2="150"
                y2="20"
                stroke={isTampered ? '#FF2A54' : '#00F0FF'}
                strokeWidth={isTampered ? '2.5' : '1.5'}
              />
            </svg>
          </div>

          {/* LEVEL 0: Bottom Leaves (Individual Accounts) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, width: '100%' }}>
            {/* Leaf 1: Masked Sibling 1 */}
            <div
              style={{
                background: '#090D1A',
                border: '1px solid #1E293B',
                borderRadius: 5,
                padding: '8px 6px',
                textAlign: 'center',
                opacity: 0.8,
              }}
            >
              <div style={{ fontSize: 8, fontWeight: 700, color: '#64748B' }}>MASKED LEAF 1</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1', marginTop: 2 }}>50,000.00</div>
              <div style={{ fontSize: 7, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sib2.hash.slice(0, 8)}...
              </div>
            </div>

            {/* Leaf 2: Masked Sibling 2 */}
            <div
              style={{
                background: '#090D1A',
                border: '1px solid #1E293B',
                borderRadius: 5,
                padding: '8px 6px',
                textAlign: 'center',
                opacity: 0.8,
              }}
            >
              <div style={{ fontSize: 8, fontWeight: 700, color: '#64748B' }}>MASKED LEAF 2</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1', marginTop: 2 }}>50,000.00</div>
              <div style={{ fontSize: 7, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sib2.hash.slice(8, 16)}...
              </div>
            </div>

            {/* Leaf 3: Sibling 3 */}
            <div
              style={{
                background: '#090D1A',
                border: '1px solid #1E293B',
                borderRadius: 5,
                padding: '8px 6px',
                textAlign: 'center',
                opacity: 0.8,
              }}
            >
              <div style={{ fontSize: 8, fontWeight: 700, color: '#64748B' }}>SIBLING LEAF</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#CBD5E1', marginTop: 2 }}>{formatDKC(sib1.sum).replace(' DKC', '')}</div>
              <div style={{ fontSize: 7, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sib1.hash.slice(0, 8)}...
              </div>
            </div>

            {/* Leaf 4: Active User (YOU) */}
            <div
              style={{
                background: isTampered
                  ? 'rgba(255, 42, 84, 0.2)'
                  : 'rgba(0, 240, 255, 0.1)',
                border: `2px solid ${isTampered ? '#FF2A54' : '#00F0FF'}`,
                borderRadius: 6,
                padding: '8px 6px',
                textAlign: 'center',
                boxShadow: isTampered
                  ? '0 0 15px rgba(255, 42, 84, 0.4)'
                  : '0 0 12px rgba(0, 240, 255, 0.25)',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ fontSize: 8, fontWeight: 900, color: isTampered ? '#FF2A54' : '#00F0FF' }}>
                {isTampered ? '⚠️ FORGED LEAF' : `YOU (${activeUsername.toUpperCase()})`}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  color: isTampered ? '#FF2A54' : '#00F0FF',
                  marginTop: 2,
                }}
              >
                {formatDKC(userBalance).replace(' DKC', '')}
              </div>
              <div
                style={{
                  fontSize: 7,
                  color: isTampered ? '#FF2A54' : '#94A3B8',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {isTampered ? '+10,000 DKC FORGERY' : `${userLeafHash.slice(0, 8)}...`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step-by-Step Mathematical Derivation Inspector */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid #1E293B',
          borderRadius: 6,
          padding: '12px 14px',
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 11, letterSpacing: '0.04em' }}>
          📐 CRYPTOGRAPHIC PROOF DERIVATION PATH:
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #161F30', paddingBottom: 6 }}>
          <span style={{ color: '#64748B' }}>1. Leaf Hash:</span>
          <span style={{ color: isTampered ? '#FF2A54' : '#CBD5E1' }}>
            SHA256(0x00 || Pseudo || {formatDKC(userBalance)}) = <code>{userLeafHash.slice(0, 14)}...</code>
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #161F30', paddingBottom: 6 }}>
          <span style={{ color: '#64748B' }}>2. Sibling Path:</span>
          <span style={{ color: '#CBD5E1' }}>
            {siblings.length} Sibling hashes resolved ({formatDKC(sib1.sum)} + {formatDKC(sib2.sum)})
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#64748B' }}>3. Root Check:</span>
          <span style={{ color: isTampered ? '#FF2A54' : '#10B981', fontWeight: 700 }}>
            {isTampered
              ? `✕ MISMATCH (Computed ${tamperedInfo?.calculatedRoot.slice(0, 8)}... ≠ Expected ${proof.expectedRoot.slice(0, 8)}...)`
              : `✓ MATCH CONFIRMED (Root: ${proof.expectedRoot.slice(0, 12)}...)`}
          </span>
        </div>
      </div>
    </div>
  );
};
