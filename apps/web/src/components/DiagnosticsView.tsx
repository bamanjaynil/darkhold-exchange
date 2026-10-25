import React from 'react';

export interface DiagnosticsViewProps {
  diagResult: any;
  diagRunning: boolean;
  onRunDiagnostics: () => void;
  engineSeq: number;
  activeOrderCount: number;
  wsConnected: boolean;
  isLedgerDrawerOpen: boolean;
  onToggleLedgerDrawer: () => void;
  autoPilot?: boolean;
  onToggleAutoPilot?: () => void;
  onRunScalperBurst?: () => void;
}

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  diagResult,
  diagRunning,
  onRunDiagnostics,
  engineSeq,
  activeOrderCount,
  wsConnected,
  isLedgerDrawerOpen,
  onToggleLedgerDrawer,
  autoPilot = false,
  onToggleAutoPilot,
  onRunScalperBurst,
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
              ADMINISTRATIVE DIAGNOSTICS & TELEMETRY
            </h2>
            <span
              style={{
                fontSize: 10,
                color: '#00F0FF',
                background: 'rgba(0, 240, 255, 0.1)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              HFT ENGINE X-RAY
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
            Full system health inspection, append-only log sequence verification, and double-entry ledger reconciliation.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {onToggleAutoPilot && (
            <button
              onClick={onToggleAutoPilot}
              style={{
                background: autoPilot ? 'rgba(0, 240, 255, 0.15)' : '#0F172A',
                color: autoPilot ? '#00F0FF' : '#94A3B8',
                border: autoPilot ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid #1E293B',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {autoPilot ? '⚡ Auto-Pilot [ON]' : '⚡ Auto-Pilot [OFF]'}
            </button>
          )}

          {onRunScalperBurst && (
            <button
              onClick={onRunScalperBurst}
              disabled={diagRunning}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#EF4444',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: diagRunning ? 'not-allowed' : 'pointer',
              }}
            >
              🔥 50-Order Scalper Burst
            </button>
          )}

          <button
            onClick={onToggleLedgerDrawer}
            style={{
              background: '#0F172A',
              color: '#00F0FF',
              border: '1px solid rgba(0, 240, 255, 0.3)',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLedgerDrawerOpen ? 'Close Ledger Inspector' : '🔍 Open Ledger Drawer'}
          </button>
          <button
            onClick={onRunDiagnostics}
            disabled={diagRunning}
            style={{
              background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
              color: '#06080F',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 800,
              fontSize: 11,
              cursor: diagRunning ? 'not-allowed' : 'pointer',
            }}
          >
            {diagRunning ? 'RUNNING AUDIT...' : '⚡ RUN COMPLETE RECONCILIATION'}
          </button>
        </div>
      </div>

      {/* Engine Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>AOL SEQUENCE</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#00F0FF', fontFamily: 'monospace', marginTop: 4 }}>
            #{engineSeq}
          </div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Deterministic sequence counter</div>
        </div>

        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>ACTIVE RESTING ORDERS</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#10B981', fontFamily: 'monospace', marginTop: 4 }}>
            {activeOrderCount}
          </div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Open limit orders across books</div>
        </div>

        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>WEBSOCKET FEED</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: wsConnected ? '#10B981' : '#EF4444', fontFamily: 'monospace', marginTop: 4 }}>
            {wsConnected ? 'CONNECTED' : 'OFFLINE'}
          </div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Real-time event loop feed</div>
        </div>

        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>PERSISTENCE ENGINE</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#F59E0B', fontFamily: 'monospace', marginTop: 4 }}>
            COALESCED
          </div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Dual AOL + Async PostgreSQL</div>
        </div>
      </div>

      {/* Diagnostics JSON / Result Output */}
      {diagResult && (
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#10B981' }}>
              ✓ RECONCILIATION AUDIT REPORT
            </span>
            <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
              {new Date().toISOString()}
            </span>
          </div>

          <pre
            style={{
              background: '#040711',
              border: '1px solid #161F30',
              borderRadius: 6,
              padding: 14,
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#F8FAFC',
              overflowX: 'auto',
              maxHeight: 300,
            }}
          >
            {JSON.stringify(diagResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
