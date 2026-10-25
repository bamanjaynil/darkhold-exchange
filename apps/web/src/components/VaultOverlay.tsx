import React from 'react';
import { formatDKC } from '@darkhold/shared';

export interface VaultOverlayProps {
  balance: { available: number; reserved: number; escrow: number; total: number };
  holdings: Array<{ symbol: string; available: number; reserved: number; escrow: number }>;
  instruments: Array<{
    id: string;
    symbol: string;
    name: string;
    faceValue: number;
    collarBps: number;
    collarCeiling?: number;
  }>;
  onTradeInstrument: (symbol: string) => void;
  onOpenAuctionCreate: () => void;
}

function getVisual(symbol: string) {
  switch (symbol) {
    case 'FEST-GA':
      return {
        name: 'General Admission Pass',
        tag: 'Cyber Pass',
        color: '#00F0FF',
        bg: 'rgba(0, 240, 255, 0.08)',
        border: 'rgba(0, 240, 255, 0.3)',
      };
    case 'FEST-VIP':
      return {
        name: 'VIP Sanctum Access Pass',
        tag: 'Holo VIP Access',
        color: '#F59E0B',
        bg: 'rgba(245, 158, 11, 0.08)',
        border: 'rgba(245, 158, 11, 0.3)',
      };
    case 'MERCH-CLOAK':
      return {
        name: 'Cloak of Levitation Replica',
        tag: 'Stealth Cloak',
        color: '#A855F7',
        bg: 'rgba(168, 85, 247, 0.08)',
        border: 'rgba(168, 85, 247, 0.3)',
      };
    case 'RELIC-AGAMOTTO':
      return {
        name: 'Eye of Agamotto Amulet',
        tag: 'Soulbound / Escrow Locked',
        color: '#EF4444',
        bg: 'rgba(239, 68, 68, 0.08)',
        border: 'rgba(239, 68, 68, 0.3)',
      };
    default:
      return {
        name: symbol,
        tag: 'Standard Asset',
        color: '#94A3B8',
        bg: 'rgba(148, 163, 184, 0.08)',
        border: 'rgba(148, 163, 184, 0.3)',
      };
  }
}

export const VaultOverlay: React.FC<VaultOverlayProps> = ({
  balance,
  holdings,
  instruments,
  onTradeInstrument,
  onOpenAuctionCreate,
}) => {
  const totalCash = balance.available + balance.reserved + balance.escrow;
  const availPct = totalCash > 0 ? (balance.available / totalCash) * 100 : 100;
  const resPct = totalCash > 0 ? (balance.reserved / totalCash) * 100 : 0;
  const escPct = totalCash > 0 ? (balance.escrow / totalCash) * 100 : 0;

  // Calculate total portfolio net worth including asset valuation
  let totalAssetValuationMinor = 0;
  for (const h of holdings) {
    const inst = instruments.find((i) => i.symbol === h.symbol);
    const unitPrice = inst ? inst.faceValue : 0;
    totalAssetValuationMinor += (h.available + h.reserved + h.escrow) * unitPrice;
  }
  const totalNetWorth = totalCash + totalAssetValuationMinor;

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
      {/* 1. Vault Header & Total Portfolio Valuation */}
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
              PORTFOLIO & ASSET VAULT
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
              DOUBLE-ENTRY BALANCED
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
            Comprehensive view of Darkhold Credits (DKC) reserves, physical instrument holdings, and escrow custody.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>ESTIMATED TOTAL NET WORTH</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#00F0FF', fontFamily: 'monospace' }}>
            {formatDKC(totalNetWorth)}
          </div>
        </div>
      </div>

      {/* 2. Capital Liquidity Matrix (DKC) */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.5)',
          border: '1px solid #1E293B',
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#F8FAFC' }}>
            DARKHOLD CREDITS (DKC) CAPITAL ALLOCATION
          </span>
          <span style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
            Total Capital: {formatDKC(totalCash)}
          </span>
        </div>

        {/* Proportional Segmented Allocation Meter */}
        <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', background: '#0F172A' }}>
          <div style={{ width: `${availPct}%`, background: '#00F0FF', transition: 'width 0.3s ease' }} title={`Available: ${availPct.toFixed(1)}%`} />
          <div style={{ width: `${resPct}%`, background: '#F59E0B', transition: 'width 0.3s ease' }} title={`Reserved: ${resPct.toFixed(1)}%`} />
          <div style={{ width: `${escPct}%`, background: '#A855F7', transition: 'width 0.3s ease' }} title={`Escrow: ${escPct.toFixed(1)}%`} />
        </div>

        {/* Breakdown Metric Tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#00F0FF', fontWeight: 800 }}>AVAILABLE CAPITAL</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC', fontFamily: 'monospace', marginTop: 4 }}>
              {formatDKC(balance.available)}
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Liquid and ready for spot orders / auctions</div>
          </div>

          <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800 }}>RESERVED FUNDS</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC', fontFamily: 'monospace', marginTop: 4 }}>
              {formatDKC(balance.reserved)}
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Locked in resting limit buy orders</div>
          </div>

          <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#A855F7', fontWeight: 800 }}>ESCROW CUSTODY</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC', fontFamily: 'monospace', marginTop: 4 }}>
              {formatDKC(balance.escrow)}
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Locked in two-phase physical delivery</div>
          </div>
        </div>
      </div>

      {/* 3. Physical Asset Holdings Matrix */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.04em' }}>
            PHYSICAL INSTRUMENTS INVENTORY
          </span>
          <button
            onClick={onOpenAuctionCreate}
            style={{
              background: 'rgba(0, 240, 255, 0.12)',
              color: '#00F0FF',
              border: '1px solid rgba(0, 240, 255, 0.35)',
              borderRadius: 4,
              padding: '5px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Create Dutch Auction for Inventory
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {instruments.filter((i) => i.symbol !== 'BENCH-X').map((inst) => {
            const h = holdings.find((holding) => holding.symbol === inst.symbol) || { available: 0, reserved: 0, escrow: 0 };
            const visual = getVisual(inst.symbol);
            const totalUnits = h.available + h.reserved + h.escrow;
            const assetVal = totalUnits * inst.faceValue;

            return (
              <div
                key={inst.symbol}
                style={{
                  background: '#090D1A',
                  border: `1px solid ${visual.border}`,
                  borderRadius: 6,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#F8FAFC' }}>{inst.symbol}</span>
                    <div style={{ fontSize: 11, color: visual.color, fontWeight: 600 }}>{visual.name}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      background: visual.bg,
                      color: visual.color,
                      border: `1px solid ${visual.border}`,
                      padding: '2px 6px',
                      borderRadius: 3,
                    }}
                  >
                    {visual.tag}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'monospace' }}>
                  <span style={{ color: '#64748B' }}>Total Units Owned:</span>
                  <strong style={{ color: '#F8FAFC' }}>{totalUnits} Units</strong>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    background: '#040711',
                    padding: 8,
                    borderRadius: 4,
                    textAlign: 'center',
                    fontSize: 10,
                    fontFamily: 'monospace',
                  }}
                >
                  <div>
                    <div style={{ color: '#64748B' }}>AVAILABLE</div>
                    <strong style={{ color: '#00F0FF', fontSize: 12 }}>{h.available}</strong>
                  </div>
                  <div>
                    <div style={{ color: '#64748B' }}>RESERVED</div>
                    <strong style={{ color: '#F59E0B', fontSize: 12 }}>{h.reserved}</strong>
                  </div>
                  <div>
                    <div style={{ color: '#64748B' }}>ESCROW</div>
                    <strong style={{ color: '#A855F7', fontSize: 12 }}>{h.escrow}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#64748B' }}>
                    Est. Value: <strong style={{ color: '#94A3B8' }}>{formatDKC(assetVal)}</strong>
                  </div>
                  <button
                    onClick={() => onTradeInstrument(inst.symbol)}
                    style={{
                      background: 'rgba(0, 240, 255, 0.12)',
                      color: '#00F0FF',
                      border: '1px solid rgba(0, 240, 255, 0.3)',
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Trade in Horizon ➔
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
