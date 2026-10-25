import React, { useState } from 'react';
import { formatDKC } from '@darkhold/shared';
import { BookLevel, LiquidityCanvas } from './LiquidityCanvas.js';

export interface OpenOrder {
  id: string;
  client_order_id: string;
  user_id?: string;
  side: 'BUY' | 'SELL';
  type: string;
  tif?: string;
  price: number;
  qty: number;
  remaining_qty: number;
  symbol: string;
  status?: string;
}

export interface TradeItem {
  id: string;
  price: number;
  qty: number;
  created_at: string;
  is_simulated: boolean;
  side?: string;
}

export interface SpatialHorizonProps {
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  lastPrice: number | null;
  selectedInstrument: {
    id: string;
    symbol: string;
    name: string;
    faceValue: number;
    collarBps: number;
    collarCeiling?: number;
    minPrice?: number;
  };
  trades: TradeItem[];
  marketOrders: OpenOrder[];
  currentUserId?: string;
  onSelectPrice: (price: number, side: 'BUY' | 'SELL', qty?: number) => void;
  onCancelOrder: (orderId: string, symbol: string) => void;
  cancellingOrderIds: Set<string>;
}

export const SpatialHorizon: React.FC<SpatialHorizonProps> = ({
  bids,
  asks,
  spread,
  lastPrice,
  selectedInstrument,
  trades,
  marketOrders,
  currentUserId,
  onSelectPrice,
  onCancelOrder,
  cancellingOrderIds,
}) => {
  const [horizonView, setHorizonView] = useState<'ladder' | 'radar' | 'hybrid'>('hybrid');
  const [hoveredLevel, setHoveredLevel] = useState<{ price: number; side: 'BUY' | 'SELL' } | null>(null);

  // Calculate cumulative depth maximums for volume fills
  const maxAskTotal = asks.length > 0 ? Math.max(...asks.map((a) => a.total)) : 1;
  const maxBidTotal = bids.length > 0 ? Math.max(...bids.map((b) => b.total)) : 1;
  const maxCumulative = Math.max(maxAskTotal, maxBidTotal, 1);

  // Group market orders by price level for direct anchor pins
  const ordersByPrice = new Map<number, OpenOrder[]>();
  for (const ord of marketOrders) {
    if (ord.symbol === selectedInstrument.symbol) {
      const list = ordersByPrice.get(ord.price) || [];
      list.push(ord);
      ordersByPrice.set(ord.price, list);
    }
  }

  // Reverse asks so highest ask is at top and best ask (lowest price) is nearest the spread nexus
  const displayAsks = [...asks].reverse();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#040711',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* 1. Spatial Instrument Ribbon: Instrument Identity, View Mode & Spread Nexus */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          background: 'rgba(10, 15, 29, 0.95)',
          borderBottom: '1px solid #161F30',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC', letterSpacing: '0.04em' }}>
            {selectedInstrument.symbol}
          </span>
          <span style={{ fontSize: 12, color: '#94A3B8' }}>{selectedInstrument.name}</span>
          <span
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#00F0FF',
              background: 'rgba(0, 240, 255, 0.08)',
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid rgba(0, 240, 255, 0.25)',
            }}
          >
            REF: {formatDKC(selectedInstrument.faceValue)}
          </span>
          {selectedInstrument.collarCeiling && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: '#F59E0B',
                background: 'rgba(245, 158, 11, 0.08)',
                padding: '2px 6px',
                borderRadius: 3,
                border: '1px solid rgba(245, 158, 11, 0.25)',
              }}
            >
              CAP: {formatDKC(selectedInstrument.collarCeiling)}
            </span>
          )}
        </div>

        {/* View Mode Toggle: Hybrid (Ladder + Radar) | Ladder Only | Radar Only */}
        <div
          style={{
            display: 'flex',
            background: '#04060A',
            border: '1px solid #1E293B',
            borderRadius: 5,
            padding: 2,
            gap: 2,
          }}
        >
          <button
            onClick={() => setHorizonView('hybrid')}
            style={{
              background: horizonView === 'hybrid' ? '#1E293B' : 'transparent',
              color: horizonView === 'hybrid' ? '#00F0FF' : '#64748B',
              border: 'none',
              borderRadius: 3,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            HYBRID SPATIAL
          </button>
          <button
            onClick={() => setHorizonView('ladder')}
            style={{
              background: horizonView === 'ladder' ? '#1E293B' : 'transparent',
              color: horizonView === 'ladder' ? '#00F0FF' : '#64748B',
              border: 'none',
              borderRadius: 3,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            LADDER MATRIX
          </button>
          <button
            onClick={() => setHorizonView('radar')}
            style={{
              background: horizonView === 'radar' ? '#1E293B' : 'transparent',
              color: horizonView === 'radar' ? '#00F0FF' : '#64748B',
              border: 'none',
              borderRadius: 3,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            KINETIC RADAR
          </button>
        </div>
      </div>

      {/* 2. Main Spatial Surface: Dual-Plane Continuum */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: horizonView === 'hybrid' ? '1fr 340px' : horizonView === 'ladder' ? '1fr' : '1fr',
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Left / Primary: Interactive Price Horizon Ladder */}
        {(horizonView === 'hybrid' || horizonView === 'ladder') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              borderRight: horizonView === 'hybrid' ? '1px solid #161F30' : 'none',
              background: 'linear-gradient(180deg, rgba(255, 42, 84, 0.03) 0%, rgba(0, 0, 0, 0.4) 48%, rgba(0, 240, 255, 0.03) 100%)',
              padding: '8px 12px',
            }}
          >
            {/* Header Columns */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 80px 100px 1fr 100px',
                padding: '4px 8px',
                fontSize: 10,
                color: '#64748B',
                fontWeight: 700,
                borderBottom: '1px solid #161F30',
                textTransform: 'uppercase',
                fontFamily: 'monospace',
              }}
            >
              <span>PRICE LEVEL</span>
              <span style={{ textAlign: 'right' }}>QUANTITY</span>
              <span style={{ textAlign: 'right' }}>CUMULATIVE</span>
              <span style={{ textAlign: 'center' }}>ACTIVE RESTING ORDERS</span>
              <span style={{ textAlign: 'right' }}>QUICK ACTION</span>
            </div>

            {/* Asks Sub-Plane (Sellers - Red/Rose Horizon) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {displayAsks.length === 0 ? (
                <div style={{ padding: '12px 8px', fontSize: 11, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                  No resting asks in book
                </div>
              ) : (
                displayAsks.map((level) => {
                  const depthPct = (level.total / maxCumulative) * 100;
                  const isHovered = hoveredLevel?.price === level.price;
                  const anchoredOrders = ordersByPrice.get(level.price) || [];

                  return (
                    <div
                      key={`ask-${level.price}`}
                      onMouseEnter={() => setHoveredLevel({ price: level.price, side: 'BUY' })}
                      onMouseLeave={() => setHoveredLevel(null)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 80px 100px 1fr 100px',
                        padding: '5px 8px',
                        alignItems: 'center',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        position: 'relative',
                        background: isHovered ? 'rgba(255, 42, 84, 0.12)' : 'rgba(255, 42, 84, 0.02)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'background 0.12s ease',
                      }}
                      onClick={() => onSelectPrice(level.price, 'BUY', level.qty)}
                    >
                      {/* Depth Bar Fill */}
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: `${depthPct}%`,
                          background: 'rgba(255, 42, 84, 0.08)',
                          borderLeft: '2px solid rgba(255, 42, 84, 0.4)',
                          pointerEvents: 'none',
                          borderRadius: 4,
                        }}
                      />

                      {/* Level Price */}
                      <span style={{ color: '#FF2A54', fontWeight: 800, zIndex: 1 }}>
                        {formatDKC(level.price)}
                      </span>

                      {/* Level Qty */}
                      <span style={{ textAlign: 'right', color: '#F8FAFC', fontWeight: 600, zIndex: 1 }}>
                        {level.qty}
                      </span>

                      {/* Cumulative Total */}
                      <span style={{ textAlign: 'right', color: '#94A3B8', zIndex: 1 }}>
                        {level.total}
                      </span>

                      {/* Anchored Resting Orders */}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 12, zIndex: 1, overflowX: 'auto' }}>
                        {anchoredOrders.map((ord) => {
                          const isOwned = ord.user_id === currentUserId;
                          return (
                            <span
                              key={ord.id}
                              style={{
                                fontSize: 9,
                                padding: '1px 5px',
                                borderRadius: 3,
                                background: isOwned ? 'rgba(0, 240, 255, 0.18)' : 'rgba(15, 23, 42, 0.8)',
                                color: isOwned ? '#00F0FF' : '#94A3B8',
                                border: isOwned ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid #334155',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span>{isOwned ? 'YOU' : ord.user_id?.replace('usr_', '').toUpperCase()} ({ord.remaining_qty})</span>
                              {isOwned && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCancelOrder(ord.id, ord.symbol);
                                  }}
                                  disabled={cancellingOrderIds.has(ord.id)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#FF2A54',
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: 9,
                                    fontWeight: 900,
                                  }}
                                  title="Cancel Order"
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      {/* Quick Snipe Action */}
                      <div style={{ textAlign: 'right', zIndex: 1 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPrice(level.price, 'BUY', level.qty);
                          }}
                          style={{
                            background: isHovered ? '#10B981' : 'rgba(16, 185, 129, 0.15)',
                            color: isHovered ? '#06080F' : '#10B981',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: 3,
                            padding: '2px 6px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          BUY @ {formatDKC(level.price)}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* EQUATOR / SPREAD NEXUS (The Zero-Crossing Zone) */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                margin: '8px 0',
                padding: '10px 14px',
                background: 'linear-gradient(90deg, rgba(0, 240, 255, 0.08) 0%, rgba(255, 42, 84, 0.08) 100%)',
                borderTop: '1px solid #1E293B',
                borderBottom: '1px solid #1E293B',
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, letterSpacing: '0.04em' }}>
                  SPREAD NEXUS:
                </span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#F8FAFC', fontFamily: 'monospace' }}>
                  {spread !== null ? formatDKC(spread) : 'NONE'}
                </span>
                {spread !== null && (
                  <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
                    ({spread} minor units)
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {lastPrice !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#64748B' }}>LAST MATCH:</span>
                    <strong style={{ fontSize: 13, color: '#00F0FF', fontFamily: 'monospace' }}>
                      {formatDKC(lastPrice)}
                    </strong>
                  </div>
                )}

                {asks.length > 0 && bids.length > 0 && (
                  <button
                    onClick={() => onSelectPrice(asks[0].price, 'BUY', 1)}
                    style={{
                      background: 'rgba(0, 240, 255, 0.15)',
                      color: '#00F0FF',
                      border: '1px solid rgba(0, 240, 255, 0.4)',
                      borderRadius: 3,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ CROSS SPREAD (BUY 1 @ {formatDKC(asks[0].price)})
                  </button>
                )}
              </div>
            </div>

            {/* Bids Sub-Plane (Buyers - Cyan/Emerald Horizon) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
              {bids.length === 0 ? (
                <div style={{ padding: '12px 8px', fontSize: 11, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                  No resting bids in book
                </div>
              ) : (
                bids.map((level) => {
                  const depthPct = (level.total / maxCumulative) * 100;
                  const isHovered = hoveredLevel?.price === level.price;
                  const anchoredOrders = ordersByPrice.get(level.price) || [];

                  return (
                    <div
                      key={`bid-${level.price}`}
                      onMouseEnter={() => setHoveredLevel({ price: level.price, side: 'SELL' })}
                      onMouseLeave={() => setHoveredLevel(null)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 80px 100px 1fr 100px',
                        padding: '5px 8px',
                        alignItems: 'center',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        position: 'relative',
                        background: isHovered ? 'rgba(0, 240, 255, 0.12)' : 'rgba(0, 240, 255, 0.02)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'background 0.12s ease',
                      }}
                      onClick={() => onSelectPrice(level.price, 'SELL', level.qty)}
                    >
                      {/* Depth Bar Fill */}
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: `${depthPct}%`,
                          background: 'rgba(0, 240, 255, 0.08)',
                          borderLeft: '2px solid rgba(0, 240, 255, 0.4)',
                          pointerEvents: 'none',
                          borderRadius: 4,
                        }}
                      />

                      {/* Level Price */}
                      <span style={{ color: '#00F0FF', fontWeight: 800, zIndex: 1 }}>
                        {formatDKC(level.price)}
                      </span>

                      {/* Level Qty */}
                      <span style={{ textAlign: 'right', color: '#F8FAFC', fontWeight: 600, zIndex: 1 }}>
                        {level.qty}
                      </span>

                      {/* Cumulative Total */}
                      <span style={{ textAlign: 'right', color: '#94A3B8', zIndex: 1 }}>
                        {level.total}
                      </span>

                      {/* Anchored Resting Orders */}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 12, zIndex: 1, overflowX: 'auto' }}>
                        {anchoredOrders.map((ord) => {
                          const isOwned = ord.user_id === currentUserId;
                          return (
                            <span
                              key={ord.id}
                              style={{
                                fontSize: 9,
                                padding: '1px 5px',
                                borderRadius: 3,
                                background: isOwned ? 'rgba(0, 240, 255, 0.18)' : 'rgba(15, 23, 42, 0.8)',
                                color: isOwned ? '#00F0FF' : '#94A3B8',
                                border: isOwned ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid #334155',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span>{isOwned ? 'YOU' : ord.user_id?.replace('usr_', '').toUpperCase()} ({ord.remaining_qty})</span>
                              {isOwned && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCancelOrder(ord.id, ord.symbol);
                                  }}
                                  disabled={cancellingOrderIds.has(ord.id)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#FF2A54',
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: 9,
                                    fontWeight: 900,
                                  }}
                                  title="Cancel Order"
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      {/* Quick Sell Action */}
                      <div style={{ textAlign: 'right', zIndex: 1 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPrice(level.price, 'SELL', level.qty);
                          }}
                          style={{
                            background: isHovered ? '#FF2A54' : 'rgba(255, 42, 84, 0.15)',
                            color: isHovered ? '#06080F' : '#FF2A54',
                            border: '1px solid rgba(255, 42, 84, 0.4)',
                            borderRadius: 3,
                            padding: '2px 6px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          SELL @ {formatDKC(level.price)}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Right / Secondary: Kinetic Canvas Radar & Order Flow Shockwaves */}
        {(horizonView === 'hybrid' || horizonView === 'radar') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: '#030509',
              position: 'relative',
            }}
          >
            <div
              style={{
                flex: 1,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <LiquidityCanvas
                bids={bids}
                asks={asks}
                spread={spread}
                lastPrice={lastPrice}
                trades={trades.map((t) => ({
                  id: t.id,
                  price: t.price,
                  qty: t.qty,
                  side: t.side,
                  timestamp: new Date(t.created_at).getTime(),
                }))}
                onSelectPrice={(p, s) => onSelectPrice(p, s)}
              />
            </div>

            {/* Compact Live Execution Tape */}
            <div
              style={{
                height: 140,
                borderTop: '1px solid #161F30',
                background: 'rgba(6, 9, 18, 0.95)',
                display: 'flex',
                flexDirection: 'column',
                padding: '6px 10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', fontWeight: 700, marginBottom: 4 }}>
                <span>REAL-TIME EXECUTION TAPE</span>
                <span>{trades.length} RECENT FILLS</span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {trades.slice(0, 8).map((tr) => (
                  <div
                    key={tr.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      fontFamily: 'monospace',
                      padding: '2px 4px',
                      borderRadius: 3,
                      background: 'rgba(15, 23, 42, 0.4)',
                    }}
                  >
                    <span style={{ color: tr.side === 'BUY' ? '#00F0FF' : '#FF2A54', fontWeight: 700 }}>
                      {tr.side || 'FILL'}
                    </span>
                    <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{formatDKC(tr.price)}</span>
                    <span style={{ color: '#94A3B8' }}>{tr.qty} unit(s)</span>
                    <span style={{ color: '#475569', fontSize: 10 }}>
                      {new Date(tr.created_at).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
