import React from 'react';
import { formatDKC } from '@darkhold/shared';

export interface ApertureStripProps {
  instruments: Array<{
    id: string;
    symbol: string;
    name: string;
    faceValue: number;
    collarBps: number;
    collarCeiling?: number;
  }>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  activeMode: 'horizon' | 'vault' | 'auctions' | 'custody' | 'solvency' | 'diagnostics';
  onSelectMode: (mode: 'horizon' | 'vault' | 'auctions' | 'custody' | 'solvency' | 'diagnostics') => void;
  engineSeq: number;
  activeOrderCount: number;
  wsConnected: boolean;
  user: { id: string; username: string; role: string } | null;
  balance: { available: number; reserved: number; escrow: number; total: number };
  onSwitchPersona: (persona: string) => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  logoutLoading: boolean;
  onToggleActionBlade: () => void;
  isActionBladeOpen: boolean;
  liveAuctionCount?: number;
  autoPilot?: boolean;
  onToggleAutoPilot?: () => void;
}

export const ApertureStrip: React.FC<ApertureStripProps> = ({
  instruments,
  selectedSymbol,
  onSelectSymbol,
  activeMode,
  onSelectMode,
  engineSeq,
  activeOrderCount,
  wsConnected,
  user,
  balance,
  onSwitchPersona,
  onOpenAuth,
  onLogout,
  logoutLoading,
  onToggleActionBlade,
  isActionBladeOpen,
  liveAuctionCount = 0,
  autoPilot = false,
  onToggleAutoPilot,
}) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#04060A',
        borderBottom: '1px solid #161F30',
        height: 52,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        userSelect: 'none',
      }}
    >
      {/* 1. Left: Monogram, Engine Pulse & Instrument Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 5,
              background: 'linear-gradient(135deg, #00F0FF 0%, #0369A1 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: 14,
              color: '#06080F',
              boxShadow: '0 0 12px rgba(0, 240, 255, 0.4)',
            }}
          >
            Δ
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.08em', color: '#F8FAFC' }}>
              DARKHOLD
            </div>
            <div style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
              EXCHANGE CORE
            </div>
          </div>
        </div>

        {/* Engine Operational Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            background: 'rgba(15, 23, 42, 0.7)',
            borderRadius: 4,
            border: '1px solid #1E293B',
            fontSize: 10,
            fontFamily: 'monospace',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: wsConnected ? '#10B981' : '#EF4444',
              boxShadow: wsConnected ? '0 0 6px #10B981' : 'none',
            }}
          />
          <span style={{ color: '#94A3B8' }}>SEQ #{engineSeq}</span>
        </div>

        {onToggleAutoPilot && (
          <button
            onClick={onToggleAutoPilot}
            title={autoPilot ? 'Auto-Pilot Simulator Active' : 'Start Auto-Pilot Simulation'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 8px',
              background: autoPilot ? 'rgba(0, 240, 255, 0.15)' : 'rgba(15, 23, 42, 0.5)',
              border: autoPilot ? '1px solid rgba(0, 240, 255, 0.5)' : '1px solid #1E293B',
              borderRadius: 4,
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              color: autoPilot ? '#00F0FF' : '#64748B',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <span>{autoPilot ? '⚡ SIM [ON]' : '⚡ SIM [OFF]'}</span>
          </button>
        )}

        {/* Interactive Instrument Switcher */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#090D1A',
            border: '1px solid #1E293B',
            borderRadius: 5,
            padding: '2px 4px',
            gap: 4,
          }}
        >
          {instruments.map((inst) => {
            const isSelected = inst.symbol === selectedSymbol;
            return (
              <button
                key={inst.symbol}
                onClick={() => onSelectSymbol(inst.symbol)}
                style={{
                  background: isSelected ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  color: isSelected ? '#00F0FF' : '#94A3B8',
                  border: isSelected ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid transparent',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: isSelected ? 800 : 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'monospace',
                }}
              >
                <span>{inst.symbol}</span>
                {isSelected && (
                  <span style={{ fontSize: 9, color: '#64748B' }}>
                    {formatDKC(inst.faceValue)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Center: The Aperture Mode Navigator */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#080C16',
          border: '1px solid #161F30',
          borderRadius: 6,
          padding: 3,
          gap: 3,
        }}
      >
        <button
          onClick={() => onSelectMode('horizon')}
          style={{
            background: activeMode === 'horizon' ? '#1E293B' : 'transparent',
            color: activeMode === 'horizon' ? '#00F0FF' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>HORIZON</span>
          <span
            style={{
              fontSize: 9,
              background: 'rgba(0, 240, 255, 0.12)',
              color: '#00F0FF',
              padding: '1px 5px',
              borderRadius: 3,
              fontFamily: 'monospace',
            }}
          >
            {activeOrderCount} ORDERS
          </span>
        </button>

        <button
          onClick={() => onSelectMode('vault')}
          style={{
            background: activeMode === 'vault' ? '#1E293B' : 'transparent',
            color: activeMode === 'vault' ? '#00F0FF' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          VAULT
        </button>

        <button
          onClick={() => onSelectMode('auctions')}
          style={{
            background: activeMode === 'auctions' ? '#1E293B' : 'transparent',
            color: activeMode === 'auctions' ? '#F59E0B' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>AUCTIONS</span>
          {liveAuctionCount > 0 && (
            <span
              style={{
                fontSize: 9,
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#F59E0B',
                padding: '1px 5px',
                borderRadius: 3,
                fontFamily: 'monospace',
                fontWeight: 800,
              }}
            >
              {liveAuctionCount} LIVE
            </span>
          )}
        </button>

        <button
          onClick={() => onSelectMode('custody')}
          style={{
            background: activeMode === 'custody' ? '#1E293B' : 'transparent',
            color: activeMode === 'custody' ? '#A855F7' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ESCROW
        </button>

        <button
          onClick={() => onSelectMode('solvency')}
          style={{
            background: activeMode === 'solvency' ? '#1E293B' : 'transparent',
            color: activeMode === 'solvency' ? '#10B981' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          SOLVENCY
        </button>

        <button
          onClick={() => onSelectMode('diagnostics')}
          style={{
            background: activeMode === 'diagnostics' ? '#1E293B' : 'transparent',
            color: activeMode === 'diagnostics' ? '#F8FAFC' : '#94A3B8',
            border: 'none',
            borderRadius: 4,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          DIAGNOSTICS
        </button>
      </nav>

      {/* 3. Right: Persona Switcher, Capital Status & Trade Blade Summon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Persona Switcher Chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#090D1A',
            border: '1px solid #1E293B',
            borderRadius: 5,
            padding: '2px 4px',
            gap: 2,
          }}
        >
          {['alice', 'bob', 'carol', 'admin'].map((persona) => {
            const isCurrent = user?.username === persona;
            return (
              <button
                key={persona}
                onClick={() => onSwitchPersona(persona)}
                style={{
                  background: isCurrent ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  color: isCurrent ? '#00F0FF' : '#64748B',
                  border: isCurrent ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid transparent',
                  borderRadius: 3,
                  padding: '3px 6px',
                  fontSize: 10,
                  fontWeight: isCurrent ? 800 : 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  fontFamily: 'monospace',
                }}
              >
                {persona}
              </button>
            );
          })}
        </div>

        {/* Available Balance Pill */}
        {user ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid #1E293B',
              borderRadius: 5,
              padding: '3px 8px',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ fontSize: 9, color: '#64748B' }}>AVAILABLE DKC</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#00F0FF' }}>
              {formatDKC(balance.available)}
            </div>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            style={{
              background: '#00F0FF',
              color: '#06080F',
              border: 'none',
              borderRadius: 4,
              padding: '5px 12px',
              fontWeight: 800,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            CONNECT
          </button>
        )}

        {/* Tactical Order Execution Button */}
        <button
          onClick={onToggleActionBlade}
          style={{
            background: isActionBladeOpen
              ? '#1E293B'
              : 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
            color: isActionBladeOpen ? '#00F0FF' : '#06080F',
            border: isActionBladeOpen ? '1px solid #00F0FF' : 'none',
            borderRadius: 5,
            padding: '6px 14px',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            boxShadow: isActionBladeOpen ? 'none' : '0 0 14px rgba(0, 240, 255, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>{isActionBladeOpen ? '✕ CLOSE' : '⚡ TRADE'}</span>
        </button>

        {user && (
          <button
            onClick={onLogout}
            disabled={logoutLoading}
            style={{
              background: 'transparent',
              color: '#64748B',
              border: 'none',
              fontSize: 14,
              cursor: 'pointer',
              padding: 4,
            }}
            title="Log out"
          >
            ⏻
          </button>
        )}
      </div>
    </header>
  );
};
