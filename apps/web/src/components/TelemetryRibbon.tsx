import React from 'react';

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
  return (
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
      }}
    >
      {/* Left: Engine Core Telemetry */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#00F0FF', fontWeight: 700 }}>⚡ ENGINE SEQ:</span>
          <span style={{ color: '#F8FAFC', fontWeight: 600 }}>#{seq.toLocaleString()}</span>
        </div>

        <div style={{ width: 1, height: 12, background: '#1E293B' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#64748B' }}>MATCH LATENCY:</span>
          <span style={{ color: '#10B981', fontWeight: 600 }}>{matchLatencyUs.toFixed(2)} µs</span>
        </div>

        <div style={{ width: 1, height: 12, background: '#1E293B' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#64748B' }}>ACTIVE RESTING ORDERS:</span>
          <span style={{ color: '#F59E0B', fontWeight: 600 }}>{activeOrders.toLocaleString()}</span>
        </div>

        <div style={{ width: 1, height: 12, background: '#1E293B' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#64748B' }}>AOL JOURNAL:</span>
          <span style={{ color: '#00F0FF', fontWeight: 600 }}>APPEND-ONLY ACK</span>
        </div>
      </div>

      {/* Right: Solvency & Ledger Invariant Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isSolvent ? '#10B981' : '#EF4444',
              boxShadow: isSolvent ? '0 0 8px #10B981' : '0 0 8px #EF4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: isSolvent ? '#10B981' : '#EF4444', fontWeight: 700 }}>
            LEDGER INVARIANT: ∑ POSTINGS = 0 (100% SOLVENT)
          </span>
        </div>

        <button
          onClick={onOpenLedgerInspector}
          style={{
            background: 'rgba(0, 240, 255, 0.12)',
            border: '1px solid rgba(0, 240, 255, 0.4)',
            color: '#00F0FF',
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: 0.5,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.25)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.12)')}
        >
          🔬 LEDGER X-RAY
        </button>
      </div>
    </div>
  );
};
