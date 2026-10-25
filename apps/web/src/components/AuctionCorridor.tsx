import React from 'react';
import { formatDKC } from '@darkhold/shared';

export interface AuctionItem {
  id: string;
  symbol: string;
  sellerUserId: string;
  qtyTotal: number;
  qtyRemaining: number;
  startPrice: number;
  floorPrice: number;
  stepAmount: number;
  stepIntervalMs: number;
  startsAt: number;
  endsAt: number;
  status: 'ACTIVE' | 'SOLD_OUT' | 'EXPIRED' | 'CANCELLED';
  clearingPrice?: number;
  currentPrice: number;
  decayPerSec?: number;
  timeRemainingSec?: number;
}

export interface AuctionCorridorProps {
  auctions: AuctionItem[];
  user: { id: string; username: string; role: string } | null;
  balance: { available: number; reserved: number; escrow: number; total: number };
  auctionFilter: 'ALL' | 'LIVE' | 'SOLD';
  setAuctionFilter: (f: 'ALL' | 'LIVE' | 'SOLD') => void;
  buyQtyMap: Record<string, number>;
  setBuyQtyMap: (map: Record<string, number>) => void;
  onBuyAuction: (auc: AuctionItem, qty: number) => void;
  onCancelAuction: (auctionId: string) => void;
  onOpenCreateModal: () => void;
  onRefreshAuctions: () => void;
  getInstrumentVisual: (symbol: string) => { name: string; tag: string; color: string; bg: string; border: string; svg: React.ReactNode };
  getTraderLabel: (userId?: string) => string;
  getTraderColor: (userId?: string) => string;
}

export const AuctionCorridor: React.FC<AuctionCorridorProps> = ({
  auctions,
  user,
  balance,
  auctionFilter,
  setAuctionFilter,
  buyQtyMap,
  setBuyQtyMap,
  onBuyAuction,
  onCancelAuction,
  onOpenCreateModal,
  onRefreshAuctions,
  getInstrumentVisual,
  getTraderLabel,
  getTraderColor,
}) => {
  const filtered = auctions.filter((auc) => {
    if (auctionFilter === 'LIVE') return auc.status === 'ACTIVE';
    if (auctionFilter === 'SOLD') return auc.status === 'SOLD_OUT' || auc.status === 'CANCELLED';
    return true;
  });

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
      {/* Header and Quick Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #161F30',
          paddingBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: '#F8FAFC', margin: 0, letterSpacing: '0.04em' }}>
              DUTCH AUCTION CORRIDOR
            </h2>
            <span
              style={{
                fontSize: 10,
                color: '#F59E0B',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              DESCENDING PRICE DECAY
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
            Descending-clock asset distribution with collar ceiling guards and multi-unit instant clearing settlement.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Filter Pills */}
          <div style={{ display: 'flex', background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 3, gap: 4 }}>
            <button
              onClick={() => setAuctionFilter('ALL')}
              style={{
                background: auctionFilter === 'ALL' ? '#1E293B' : 'transparent',
                color: auctionFilter === 'ALL' ? '#00F0FF' : '#94A3B8',
                border: 'none',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ALL ({auctions.length})
            </button>
            <button
              onClick={() => setAuctionFilter('LIVE')}
              style={{
                background: auctionFilter === 'LIVE' ? '#1E293B' : 'transparent',
                color: auctionFilter === 'LIVE' ? '#10B981' : '#94A3B8',
                border: 'none',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ⚡ LIVE ({auctions.filter((a) => a.status === 'ACTIVE').length})
            </button>
            <button
              onClick={() => setAuctionFilter('SOLD')}
              style={{
                background: auctionFilter === 'SOLD' ? '#1E293B' : 'transparent',
                color: auctionFilter === 'SOLD' ? '#F59E0B' : '#94A3B8',
                border: 'none',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✓ CLEARED ({auctions.filter((a) => a.status === 'SOLD_OUT' || a.status === 'CANCELLED').length})
            </button>
          </div>

          <button
            onClick={onRefreshAuctions}
            style={{
              background: '#0F172A',
              color: '#94A3B8',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Refresh Auctions"
          >
            🔄
          </button>

          <button
            onClick={onOpenCreateModal}
            style={{
              background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
              color: '#06080F',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: '0 0 14px rgba(0, 240, 255, 0.3)',
            }}
          >
            + CREATE AUCTION
          </button>
        </div>
      </div>

      {/* Cards Grid */}
      {filtered.length === 0 ? (
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 48, textAlign: 'center', color: '#64748B' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏛️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#94A3B8', marginBottom: 6 }}>
            No {auctionFilter !== 'ALL' ? auctionFilter : ''} Dutch Auctions Found
          </div>
          <div style={{ fontSize: 12, marginBottom: 16 }}>
            Launch descending price auctions to distribute inventory with automated collar guards.
          </div>
          <button
            onClick={onOpenCreateModal}
            style={{
              background: '#00F0FF',
              color: '#06080F',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Launch First Auction
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {filtered.map((auc) => {
            const visual = getInstrumentVisual(auc.symbol);
            const isSeller = user?.id === auc.sellerUserId;
            const selectedQty = buyQtyMap[auc.id] !== undefined ? buyQtyMap[auc.id] : 1;
            const currentPrice = auc.currentPrice;
            const totalMinor = currentPrice * selectedQty;
            const hasFunds = (balance.available || 0) >= totalMinor;

            const priceDiff = Math.max(1, auc.startPrice - auc.floorPrice);
            const currentDiff = Math.max(0, currentPrice - auc.floorPrice);
            const progressPct = auc.status === 'ACTIVE'
              ? Math.max(4, Math.min(100, (currentDiff / priceDiff) * 100))
              : 100;

            return (
              <div
                key={auc.id}
                style={{
                  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.6) 0%, #060913 100%)',
                  border: `1px solid ${visual.border}`,
                  borderRadius: 8,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: isSeller ? '0 0 20px rgba(0, 240, 255, 0.08)' : 'none',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Header: Visual + Symbol + Status */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      background: visual.bg,
                      border: `1px solid ${visual.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {visual.svg}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color: '#F8FAFC', letterSpacing: '0.02em' }}>
                        {auc.symbol}
                      </span>
                      {auc.status === 'ACTIVE' && (
                        <span style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
                          ⚡ ACTIVE DECAY
                        </span>
                      )}
                      {auc.status === 'SOLD_OUT' && (
                        <span style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '3px 8px', borderRadius: 4, fontWeight: 800 }}>
                          ✓ CLEARED & SOLD OUT
                        </span>
                      )}
                      {auc.status === 'CANCELLED' && (
                        <span style={{ fontSize: 10, background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '3px 8px', borderRadius: 4, fontWeight: 800 }}>
                          ✕ CANCELLED
                        </span>
                      )}
                      {auc.status === 'EXPIRED' && (
                        <span style={{ fontSize: 10, background: 'rgba(100, 116, 139, 0.15)', color: '#94A3B8', padding: '3px 8px', borderRadius: 4, fontWeight: 800 }}>
                          ⏱ EXPIRED
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: visual.color, fontWeight: 600 }}>{visual.tag}</span>
                      <span style={{ fontSize: 11, color: '#475569' }}>•</span>
                      <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>#{auc.id.slice(0, 12)}</span>
                    </div>
                  </div>
                </div>

                {/* Seller Badge Bar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    borderRadius: 4,
                    fontSize: 11,
                    border: '1px solid #1E293B',
                  }}
                >
                  <span style={{ color: '#64748B' }}>Seller:</span>
                  {isSeller ? (
                    <span
                      style={{
                        color: '#00F0FF',
                        fontWeight: 800,
                        background: 'rgba(0, 240, 255, 0.12)',
                        padding: '2px 6px',
                        borderRadius: 3,
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                      }}
                    >
                      YOU ({user?.username.toUpperCase()})
                    </span>
                  ) : (
                    <span style={{ color: getTraderColor(auc.sellerUserId), fontWeight: 700 }}>
                      {getTraderLabel(auc.sellerUserId)}
                    </span>
                  )}
                </div>

                {/* Pricing Box */}
                <div
                  style={{
                    background: '#040711',
                    border: '1px solid #1E293B',
                    borderRadius: 6,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600, display: 'block' }}>START CEILING</span>
                      <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700, fontFamily: 'monospace' }}>{formatDKC(auc.startPrice)}</span>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      {auc.status === 'SOLD_OUT' ? (
                        <>
                          <span style={{ fontSize: 10, color: '#10B981', fontWeight: 800 }}>FINAL CLEARING PRICE</span>
                          <div style={{ fontSize: 19, color: '#10B981', fontWeight: 900, fontFamily: 'monospace' }}>
                            {formatDKC(auc.clearingPrice || auc.currentPrice)}
                          </div>
                        </>
                      ) : auc.status === 'CANCELLED' ? (
                        <>
                          <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 800 }}>PRICE AT CANCEL</span>
                          <div style={{ fontSize: 17, color: '#EF4444', fontWeight: 800, fontFamily: 'monospace' }}>
                            {formatDKC(auc.clearingPrice || auc.currentPrice)}
                          </div>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800 }}>LIVE CURRENT PRICE</span>
                          <div style={{ fontSize: 19, color: '#F59E0B', fontWeight: 900, fontFamily: 'monospace' }}>
                            {formatDKC(auc.currentPrice)}
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600, display: 'block' }}>FLOOR MINIMUM</span>
                      <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700, fontFamily: 'monospace' }}>{formatDKC(auc.floorPrice)}</span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div>
                    <div style={{ height: 6, background: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${progressPct}%`,
                          background: auc.status === 'SOLD_OUT'
                            ? '#10B981'
                            : auc.status === 'CANCELLED'
                            ? '#EF4444'
                            : 'linear-gradient(90deg, #F59E0B 0%, #00F0FF 100%)',
                          borderRadius: 3,
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', marginTop: 5, fontFamily: 'monospace' }}>
                      {auc.status === 'ACTIVE' ? (
                        <>
                          <span>📉 Decay: -{(auc.decayPerSec ? auc.decayPerSec / 100 : 1).toFixed(2)} DKC/sec</span>
                          <span>⏱ {auc.timeRemainingSec || 0}s to floor</span>
                        </>
                      ) : auc.status === 'SOLD_OUT' ? (
                        <span style={{ color: '#10B981', fontWeight: 700 }}>✓ Settled at clearing price. Decay stopped.</span>
                      ) : (
                        <span style={{ color: '#EF4444', fontWeight: 700 }}>✕ Auction stopped by seller.</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inventory meter */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'monospace' }}>
                  <span style={{ color: '#64748B' }}>Available Units:</span>
                  <strong style={{ color: '#F8FAFC' }}>{auc.qtyRemaining} / {auc.qtyTotal} Units</strong>
                </div>

                {/* Actions */}
                <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                  {auc.status === 'ACTIVE' ? (
                    isSeller ? (
                      <button
                        onClick={() => onCancelAuction(auc.id)}
                        style={{
                          width: '100%',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#EF4444',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          borderRadius: 5,
                          padding: '10px 14px',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        🛑 Cancel Auction & Reclaim {auc.qtyRemaining} Unit(s)
                      </button>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>QTY:</span>
                          <div style={{ display: 'flex', alignItems: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: 4 }}>
                            <button
                              onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: Math.max(1, selectedQty - 1) })}
                              style={{ background: 'transparent', color: '#94A3B8', border: 'none', padding: '4px 10px', fontWeight: 800, cursor: 'pointer' }}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={auc.qtyRemaining}
                              value={selectedQty}
                              onChange={(e) => {
                                const val = Math.max(1, Math.min(auc.qtyRemaining, parseInt(e.target.value, 10) || 1));
                                setBuyQtyMap({ ...buyQtyMap, [auc.id]: val });
                              }}
                              style={{ width: 44, textAlign: 'center', background: 'transparent', color: '#F8FAFC', border: 'none', fontWeight: 800, fontSize: 13 }}
                            />
                            <button
                              onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: Math.min(auc.qtyRemaining, selectedQty + 1) })}
                              style={{ background: 'transparent', color: '#94A3B8', border: 'none', padding: '4px 10px', fontWeight: 800, cursor: 'pointer' }}
                            >
                              +
                            </button>
                          </div>

                          <button
                            onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: auc.qtyRemaining })}
                            style={{ background: '#1E293B', color: '#00F0FF', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                          >
                            MAX ({auc.qtyRemaining})
                          </button>

                          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 11 }}>
                            <span style={{ color: '#64748B' }}>Total: </span>
                            <strong style={{ color: '#F59E0B', fontFamily: 'monospace' }}>{formatDKC(totalMinor)}</strong>
                          </div>
                        </div>

                        <button
                          onClick={() => onBuyAuction(auc, selectedQty)}
                          disabled={!hasFunds}
                          style={{
                            width: '100%',
                            background: hasFunds ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)' : '#1E293B',
                            color: hasFunds ? '#06080F' : '#64748B',
                            border: 'none',
                            borderRadius: 5,
                            padding: '10px 14px',
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: hasFunds ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {hasFunds ? `⚡ SNIPE ${selectedQty} UNIT(S) @ ${formatDKC(totalMinor)}` : `⚠️ Insufficient DKC`}
                        </button>
                      </div>
                    )
                  ) : auc.status === 'SOLD_OUT' ? (
                    <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 5, padding: '10px', textAlign: 'center', color: '#10B981', fontWeight: 800, fontSize: 12 }}>
                      ✓ SETTLED AT {formatDKC(auc.clearingPrice || auc.currentPrice)} (100% SOLD)
                    </div>
                  ) : (
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 5, padding: '10px', textAlign: 'center', color: '#EF4444', fontWeight: 800, fontSize: 12 }}>
                      ✕ AUCTION CANCELLED
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
