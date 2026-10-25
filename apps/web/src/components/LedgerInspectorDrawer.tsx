import React, { useEffect, useState } from 'react';

interface LedgerInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  seq: number;
}

export const LedgerInspectorDrawer: React.FC<LedgerInspectorDrawerProps> = ({
  isOpen,
  onClose,
  seq,
}) => {
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [solvencyStatus, setSolvencyStatus] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ledgerRes, solvencyRes] = await Promise.all([
        fetch('/api/wallet/ledger', { credentials: 'include' }).catch(() => null),
        fetch('/api/solvency/status').catch(() => null),
      ]);

      if (ledgerRes && ledgerRes.ok) {
        const rows = await ledgerRes.json();
        setLedgerEntries(rows || []);
      }
      if (solvencyRes && solvencyRes.ok) {
        const st = await solvencyRes.json();
        setSolvencyStatus(st);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, seq]);

  const handleVerifyInvariants = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/solvency/status');
      if (res.ok) {
        const data = await res.json();
        if (data.balanced) {
          setVerificationResult(`✓ VERIFIED: All double-entry ledger postings sum to exactly 0. Merkle root hash: ${data.rootHash?.slice(0, 16)}...`);
        } else {
          setVerificationResult(`⚠ IMBALANCE DETECTED! Total liabilities: ${data.totalLiabilities}`);
        }
      }
    } catch (err: any) {
      setVerificationResult(`Verification error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 520,
        maxWidth: '90vw',
        background: '#06080F',
        borderLeft: '1px solid #1E293B',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.85)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"JetBrains Mono", monospace',
        color: '#F8FAFC',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #1E293B',
          background: 'rgba(15, 23, 42, 0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔬</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#00F0FF', letterSpacing: 0.5 }}>
              LMAX ENGINE & DOUBLE-ENTRY X-RAY
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              Mathematical Invariants & Solvency Inspector
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94A3B8',
            fontSize: 18,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Invariant Health Card */}
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 6,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#10B981', fontWeight: 700, fontSize: 12 }}>
              ● LEDGER CONSERVATION STATUS
            </span>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>SEQ #{seq}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC' }}>
            Zero-Sum Invariant: ∑ (DEBITS + CREDITS) = 0
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
            Every balance modification generates atomic reciprocal postings across asset and cash accounts. Funds can never be created or destroyed.
          </div>
          <button
            onClick={handleVerifyInvariants}
            disabled={loading}
            style={{
              marginTop: 12,
              background: '#10B981',
              color: '#06080F',
              border: 'none',
              borderRadius: 4,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {loading ? 'VERIFYING...' : 'RUN MATHEMATICAL VERIFICATION'}
          </button>
          {verificationResult && (
            <div style={{ marginTop: 8, fontSize: 11, color: verificationResult.includes('✓') ? '#10B981' : '#F59E0B' }}>
              {verificationResult}
            </div>
          )}
        </div>

        {/* Cryptographic Solvency Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid #1E293B',
            borderRadius: 6,
            padding: 14,
          }}
        >
          <div style={{ color: '#00F0FF', fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            🔐 MERKLE PROOF OF SOLVENCY
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              <span style={{ color: '#64748B' }}>Root Hash: </span>
              <span style={{ color: '#F8FAFC', wordBreak: 'break-all' }}>
                {solvencyStatus?.rootHash || 'Computing...'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>As Of Seq: </span>
              <span style={{ color: '#F8FAFC' }}>#{solvencyStatus?.asOfSeq ?? seq}</span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Total Liabilities: </span>
              <span style={{ color: '#F8FAFC' }}>
                {solvencyStatus?.totalLiabilities ? (solvencyStatus.totalLiabilities / 100).toLocaleString() + ' DKC' : '0 DKC'}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Postings Stream */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: '#F8FAFC', fontWeight: 700, fontSize: 12 }}>
              📜 LIVE DOUBLE-ENTRY POSTINGS STREAM
            </span>
            <button
              onClick={fetchData}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                color: '#94A3B8',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              REFRESH
            </button>
          </div>

          {ledgerEntries.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#64748B', fontSize: 12 }}>
              No recent postings found for active user. Submit a trade or order to see atomic ledger journals.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
              {ledgerEntries.slice(0, 30).map((p, idx) => {
                const isDebit = Number(p.amount) < 0;
                return (
                  <div
                    key={p.posting_id || idx}
                    style={{
                      background: 'rgba(15, 23, 42, 0.45)',
                      border: '1px solid #1E293B',
                      borderRadius: 4,
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                    }}
                  >
                    <div>
                      <div style={{ color: '#F8FAFC', fontWeight: 600 }}>
                        {p.kind || 'JOURNAL'} · {p.account_kind || 'ACCOUNT'}
                      </div>
                      <div style={{ color: '#64748B', fontSize: 10 }}>
                        Ref: {p.ref_id?.slice(0, 16) || p.journal_id?.slice(0, 16)} · Seq #{p.seq}
                      </div>
                    </div>
                    <div
                      style={{
                        color: isDebit ? '#FF2A54' : '#10B981',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {isDebit ? '' : '+'}
                      {(Number(p.amount) / 100).toLocaleString()} {p.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
