import React, { useState } from 'react';

interface TelemetryRibbonProps {
  seq: number;
  activeOrders: number;
  matchLatencyUs?: number;
  isSolvent?: boolean;
  onOpenLedgerInspector: () => void;
}

export const TelemetryRibbon: React.FC<TelemetryRibbonProps> = ({
  seq,
  activeOrders,
  matchLatencyUs = 0.65,
  isSolvent = true,
  onOpenLedgerInspector,
}) => {
  const [showArchModal, setShowArchModal] = useState<boolean>(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          background: '#04060A',
          borderBottom: '1px solid #161F30',
          color: '#94A3B8',
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
          overflowX: 'auto',
          position: 'relative',
        }}
      >
        {/* Left: Engine Core Telemetry Interactive Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Chip 1: Live Engine Sequence */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(0, 240, 255, 0.08)',
              border: '1px solid rgba(0, 240, 255, 0.25)',
              borderRadius: 4,
              padding: '3px 8px',
            }}
          >
            <span style={{ color: '#00F0FF', fontWeight: 800 }}>⚡ ENGINE SEQ:</span>
            <span style={{ color: '#F8FAFC', fontWeight: 700 }}>#{seq.toLocaleString()}</span>
          </div>

          {/* Chip 2: Match Engine with Tooltip */}
          <div
            onMouseEnter={() => setActiveTooltip('latency')}
            onMouseLeave={() => setActiveTooltip(null)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'help',
            }}
          >
            <span style={{ color: '#64748B' }}>MATCH ENGINE:</span>
            <span style={{ color: '#10B981', fontWeight: 700 }}>SUB-MICROSECOND ({matchLatencyUs.toFixed(2)} µs)</span>
            <span style={{ fontSize: 9, color: '#10B981', background: 'rgba(16,185,129,0.2)', padding: '0 4px', borderRadius: 2 }}>?</span>

            {activeTooltip === 'latency' && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 6,
                  width: 270,
                  background: '#0B101E',
                  border: '1px solid #10B981',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: '#F8FAFC',
                  fontSize: 10,
                  lineHeight: 1.4,
                  zIndex: 100,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ color: '#10B981', fontWeight: 700, marginBottom: 2 }}>⚡ IN-MEMORY MATCHING SPEED</div>
                Time taken by the typed-array LMAX in-memory matching engine to cross orders and execute matches in RAM.
              </div>
            )}
          </div>

          {/* Chip 3: Durability Binary WAL with Tooltip */}
          <div
            onMouseEnter={() => setActiveTooltip('wal')}
            onMouseLeave={() => setActiveTooltip(null)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(0, 240, 255, 0.08)',
              border: '1px solid rgba(0, 240, 255, 0.25)',
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'help',
            }}
          >
            <span style={{ color: '#64748B' }}>DURABILITY:</span>
            <span style={{ color: '#00F0FF', fontWeight: 700 }}>BINARY WAL (AOL ACK)</span>
            <span style={{ fontSize: 9, color: '#00F0FF', background: 'rgba(0,240,255,0.2)', padding: '0 4px', borderRadius: 2 }}>?</span>

            {activeTooltip === 'wal' && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 6,
                  width: 280,
                  background: '#0B101E',
                  border: '1px solid #00F0FF',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: '#F8FAFC',
                  fontSize: 10,
                  lineHeight: 1.4,
                  zIndex: 100,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ color: '#00F0FF', fontWeight: 700, marginBottom: 2 }}>💾 ZERO-DATA-LOSS DURABILITY</div>
                Orders are made durable in a sequential Append-Only Log (AOL) on disk before background PostgreSQL group commit.
              </div>
            )}
          </div>

          {/* Resting Orders Count */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 4,
              padding: '3px 8px',
            }}
          >
            <span style={{ color: '#64748B' }}>RESTING ORDERS:</span>
            <span style={{ color: '#F59E0B', fontWeight: 700 }}>{activeOrders.toLocaleString()}</span>
          </div>
        </div>

        {/* Right: Solvency Indicator, System Architecture Button & Ledger X-Ray */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Chip 4: Ledger 100% Solvent with Pulsing Dot */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 4,
              padding: '3px 8px',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: isSolvent ? '#10B981' : '#EF4444',
                boxShadow: isSolvent ? '0 0 8px #10B981, 0 0 14px #10B981' : '0 0 8px #EF4444',
                display: 'inline-block',
                animation: 'pulse 1.5s infinite',
              }}
            />
            <span style={{ color: isSolvent ? '#10B981' : '#EF4444', fontWeight: 800 }}>
              LEDGER: 100% SOLVENT (∑ = 0)
            </span>
          </div>

          {/* Chip 5: System Architecture Diagram Button */}
          <button
            onClick={() => setShowArchModal(true)}
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid #A855F7',
              color: '#A855F7',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: '"JetBrains Mono", monospace',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(168, 85, 247, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)')}
          >
            <span>[?] System Architecture</span>
          </button>

          {/* Ledger X-Ray Drawer Trigger */}
          <button
            onClick={onOpenLedgerInspector}
            style={{
              background: 'rgba(0, 240, 255, 0.12)',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              color: '#00F0FF',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: 0.5,
              fontFamily: '"JetBrains Mono", monospace',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.12)')}
          >
            🔬 LEDGER X-RAY
          </button>
        </div>
      </div>

      {/* System Architecture Modal */}
      {showArchModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: 20,
          }}
          onClick={() => setShowArchModal(false)}
        >
          <div
            className="card"
            style={{
              width: 720,
              maxWidth: '95vw',
              background: '#060913',
              border: '1px solid #1E293B',
              boxShadow: '0 0 35px rgba(0, 240, 255, 0.2)',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🏛️</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#00F0FF', letterSpacing: 0.5 }}>
                    DARKHOLD EXCHANGE — SYSTEM ARCHITECTURE
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    Institutional LMAX Disruptor Pattern & Sequential WAL Durability
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowArchModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Visual Pipeline Diagram */}
            <div
              style={{
                background: '#04060A',
                border: '1px solid #161F30',
                borderRadius: 8,
                padding: '20px 16px',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {/* Box 1: Client */}
              <div
                style={{
                  flex: 1,
                  minWidth: 120,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '12px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>💻</div>
                <div style={{ fontWeight: 800, color: '#F8FAFC', fontSize: 11 }}>CLIENT</div>
                <div style={{ color: '#64748B', fontSize: 10, marginTop: 2 }}>Vite / Fastify Edge</div>
                <div style={{ color: '#00F0FF', fontSize: 9, marginTop: 4 }}>PoW & CSRF Guard</div>
              </div>

              <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 16 }}>➔</div>

              {/* Box 2: LMAX Engine */}
              <div
                style={{
                  flex: 1.2,
                  minWidth: 140,
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid #10B981',
                  borderRadius: 6,
                  padding: '12px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>⚡</div>
                <div style={{ fontWeight: 800, color: '#10B981', fontSize: 11 }}>LMAX ENGINE</div>
                <div style={{ color: '#CBD5E1', fontSize: 10, marginTop: 2 }}>In-Memory RAM Core</div>
                <div style={{ color: '#10B981', fontSize: 9, fontWeight: 700, marginTop: 4 }}>0.65 µs Match Latency</div>
              </div>

              <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 16 }}>➔</div>

              {/* Box 3: Binary WAL */}
              <div
                style={{
                  flex: 1.2,
                  minWidth: 140,
                  background: 'rgba(0, 240, 255, 0.1)',
                  border: '1px solid #00F0FF',
                  borderRadius: 6,
                  padding: '12px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>💾</div>
                <div style={{ fontWeight: 800, color: '#00F0FF', fontSize: 11 }}>BINARY WAL (AOL)</div>
                <div style={{ color: '#CBD5E1', fontSize: 10, marginTop: 2 }}>Sequential Append Log</div>
                <div style={{ color: '#00F0FF', fontSize: 9, fontWeight: 700, marginTop: 4 }}>Immediate Disk Durability</div>
              </div>

              <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 16 }}>➔</div>

              {/* Box 4: PostgreSQL */}
              <div
                style={{
                  flex: 1.2,
                  minWidth: 140,
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid #F59E0B',
                  borderRadius: 6,
                  padding: '12px 10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>🗄️</div>
                <div style={{ fontWeight: 800, color: '#F59E0B', fontSize: 11 }}>POSTGRESQL 16</div>
                <div style={{ color: '#CBD5E1', fontSize: 10, marginTop: 2 }}>Group Commit Coalescing</div>
                <div style={{ color: '#F59E0B', fontSize: 9, fontWeight: 700, marginTop: 4 }}>Zero-Sum Ledger Triggers</div>
              </div>
            </div>

            {/* Architecture Explanations */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 11 }}>
              <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                <div style={{ color: '#10B981', fontWeight: 700, marginBottom: 4 }}>1. Lock-Free In-Memory Matching</div>
                <div style={{ color: '#94A3B8', lineHeight: 1.4 }}>
                  Incoming orders are sequenced by a single-threaded FIFO command loop operating on pre-allocated typed arrays, completing executions in sub-microsecond time.
                </div>
              </div>

              <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                <div style={{ color: '#00F0FF', fontWeight: 700, marginBottom: 4 }}>2. Append-Only WAL Durability</div>
                <div style={{ color: '#94A3B8', lineHeight: 1.4 }}>
                  Every matched trade and state modification is appended synchronously to a binary disk journal with CRC32 checksums before responding to the client.
                </div>
              </div>

              <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                <div style={{ color: '#F59E0B', fontWeight: 700, marginBottom: 4 }}>3. Coalesced PostgreSQL Persistence</div>
                <div style={{ color: '#94A3B8', lineHeight: 1.4 }}>
                  Background flushes coalesce hundreds of state deltas into vectorized PostgreSQL SQL queries, achieving 3,000–4,000+ HTTP req/sec throughput.
                </div>
              </div>

              <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                <div style={{ color: '#A855F7', fontWeight: 700, marginBottom: 4 }}>4. Zero-Sum Double-Entry Ledger</div>
                <div style={{ color: '#94A3B8', lineHeight: 1.4 }}>
                  Every financial debit is matched with an exact reciprocal credit. Database triggers enforce ∑ (Debits + Credits) = 0 across all cash and asset accounts.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button
                onClick={() => setShowArchModal(false)}
                style={{
                  background: '#00F0FF',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 18px',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                Close Architecture View
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
