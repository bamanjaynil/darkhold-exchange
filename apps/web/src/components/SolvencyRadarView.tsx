import React from 'react';
import { formatDKC, SolvencyInclusionProof } from '@darkhold/shared';

export interface SolvencyRadarViewProps {
  user: { id: string; username: string; role: string } | null;
  solvencyProof: SolvencyInclusionProof | null;
  solvencyChecks: { check1: boolean | null; check2: boolean | null; check3: boolean | null };
  onRunVerification: () => void;
  onSimulateTamper: () => void;
}

export const SolvencyRadarView: React.FC<SolvencyRadarViewProps> = ({
  user,
  solvencyProof,
  solvencyChecks,
  onRunVerification,
  onSimulateTamper,
}) => {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        background: '#040711',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #161F30',
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: '#F8FAFC', margin: 0, letterSpacing: '0.04em' }}>
              CRYPTOGRAPHIC SOLVENCY RADAR
            </h2>
            <span
              style={{
                fontSize: 10,
                color: '#10B981',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              MERKLE SUM TREE
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
            Zero-knowledge cryptographic proof that user balances are fully collateralized and verifiable without disclosing private positions.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onRunVerification}
            style={{
              background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
              color: '#06080F',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: '0 0 14px rgba(16, 185, 129, 0.3)',
            }}
          >
            ✓ RUN PROOF VERIFICATION
          </button>
          <button
            onClick={onSimulateTamper}
            disabled={!solvencyProof}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#EF4444',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 6,
              padding: '8px 14px',
              fontWeight: 800,
              fontSize: 11,
              cursor: solvencyProof ? 'pointer' : 'not-allowed',
            }}
          >
            🧪 SIMULATE TAMPER REJECTION
          </button>
        </div>
      </div>

      {/* 3 Invariant Verification Verification Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8' }}>LEAF INCLUSION</span>
            <span
              style={{
                fontSize: 10,
                color: solvencyChecks.check1 === true ? '#10B981' : solvencyChecks.check1 === false ? '#EF4444' : '#64748B',
                fontWeight: 800,
              }}
            >
              {solvencyChecks.check1 === true ? '✓ VERIFIED' : solvencyChecks.check1 === false ? '❌ FAILED' : 'PENDING'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 8 }}>
            Hash of user identity and balance salt exists within the authenticated state tree.
          </div>
        </div>

        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8' }}>NON-NEGATIVE LIABILITIES</span>
            <span
              style={{
                fontSize: 10,
                color: solvencyChecks.check2 === true ? '#10B981' : solvencyChecks.check2 === false ? '#EF4444' : '#64748B',
                fontWeight: 800,
              }}
            >
              {solvencyChecks.check2 === true ? '✓ VERIFIED' : solvencyChecks.check2 === false ? '❌ FAILED' : 'PENDING'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 8 }}>
            Every branch node liabilities strictly positive; no hidden fractional reserve deficits.
          </div>
        </div>

        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8' }}>ROOT HASH COLLATERAL</span>
            <span
              style={{
                fontSize: 10,
                color: solvencyChecks.check3 === true ? '#10B981' : solvencyChecks.check3 === false ? '#EF4444' : '#64748B',
                fontWeight: 800,
              }}
            >
              {solvencyChecks.check3 === true ? '✓ VERIFIED' : solvencyChecks.check3 === false ? '❌ FAILED' : 'PENDING'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 8 }}>
            Computed sum of liabilities matches the published on-chain Merkle root commitment.
          </div>
        </div>
      </div>

      {/* Merkle Inclusion Proof Details */}
      {solvencyProof && (
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 18 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#00F0FF', letterSpacing: '0.04em' }}>
            AUTHENTICATED PROOF PAYLOAD (SHA-256 SUM TREE)
          </span>

          <div
            style={{
              marginTop: 12,
              background: '#040711',
              border: '1px solid #161F30',
              borderRadius: 6,
              padding: 14,
              fontFamily: 'monospace',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              <span style={{ color: '#64748B' }}>User Identifier: </span>
              <span style={{ color: '#F8FAFC' }}>
                {solvencyProof.userId} {user?.username ? `(@${user.username})` : ''}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Recorded Balance: </span>
              <strong style={{ color: '#10B981' }}>{formatDKC(solvencyProof.balance)}</strong>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Leaf Hash: </span>
              <span style={{ color: '#00F0FF' }}>{solvencyProof.leafHash}</span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Expected Merkle Root: </span>
              <span style={{ color: '#F59E0B' }}>{solvencyProof.expectedRoot}</span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Merkle Branch Siblings: </span>
              <span style={{ color: '#A855F7' }}>{solvencyProof.siblings.length} inclusion witness nodes</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
