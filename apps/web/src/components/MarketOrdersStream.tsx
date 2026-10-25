import React from 'react';
import { formatDKC } from '@darkhold/shared';
import { OpenOrder } from './SpatialHorizon.js';

export interface MarketOrdersStreamProps {
  orders: OpenOrder[];
  currentUserId?: string;
  selectedSymbol: string;
  orderViewMode: 'market' | 'my';
  setOrderViewMode: (mode: 'market' | 'my') => void;
  onMatchOrder: (ord: OpenOrder) => void;
  onCancelOrder: (orderId: string, symbol: string) => void;
  cancellingOrderIds: Set<string>;
}

function getTraderBadge(userId?: string, currentUserId?: string) {
  if (!userId) return { label: 'MARKET', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.1)' };
  if (userId === currentUserId) return { label: 'YOU', color: '#00F0FF', bg: 'rgba(0, 240, 255, 0.18)' };
  if (userId.includes('alice')) return { label: 'ALICE', color: '#00F0FF', bg: 'rgba(0, 240, 255, 0.12)' };
  if (userId.includes('bob')) return { label: 'BOB', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' };
  if (userId.includes('carol')) return { label: 'CAROL', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.12)' };
  if (userId.includes('admin')) return { label: 'ADMIN', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' };
  return { label: userId.replace('usr_', '').toUpperCase(), color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.1)' };
}

export const MarketOrdersStream: React.FC<MarketOrdersStreamProps> = ({
  orders,
  currentUserId,
  selectedSymbol,
  orderViewMode,
  setOrderViewMode,
  onMatchOrder,
  onCancelOrder,
  cancellingOrderIds,
}) => {
  const filteredOrders = orders.filter((o) => {
    if (o.symbol === 'BENCH-X') return false;
    if (orderViewMode === 'my') {
      return o.user_id === currentUserId && o.symbol === selectedSymbol;
    }
    return o.symbol === selectedSymbol;
  });

  return (
    <div
      style={{
        borderTop: '1px solid #161F30',
        background: '#040711',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 180,
      }}
    >
      {/* Stream Control Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 14px',
          background: 'rgba(10, 15, 29, 0.95)',
          borderBottom: '1px solid #161F30',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.04em' }}>
            ACTIVE RESTING ORDERS STREAM
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#00F0FF',
              background: 'rgba(0, 240, 255, 0.08)',
              padding: '1px 6px',
              borderRadius: 3,
            }}
          >
            {filteredOrders.length} RESTING
          </span>
        </div>

        {/* View Mode Toggle: All Market Orders vs My Orders */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setOrderViewMode('market')}
            style={{
              background: orderViewMode === 'market' ? '#1E293B' : 'transparent',
              color: orderViewMode === 'market' ? '#00F0FF' : '#64748B',
              border: 'none',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            MARKET ORDERS ({selectedSymbol})
          </button>
          <button
            onClick={() => setOrderViewMode('my')}
            style={{
              background: orderViewMode === 'my' ? '#1E293B' : 'transparent',
              color: orderViewMode === 'my' ? '#00F0FF' : '#64748B',
              border: 'none',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            MY ORDERS
          </button>
        </div>
      </div>

      {/* Orders Chip List */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '8px 14px',
          overflowY: 'auto',
          alignItems: 'center',
        }}
      >
        {filteredOrders.length === 0 ? (
          <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic', padding: '6px 0' }}>
            No resting orders currently recorded for {selectedSymbol} under {orderViewMode === 'my' ? 'your account' : 'the market'}.
          </div>
        ) : (
          filteredOrders.map((ord) => {
            const isOwned = ord.user_id === currentUserId;
            const badge = getTraderBadge(ord.user_id, currentUserId);
            const isCancelling = cancellingOrderIds.has(ord.id);

            return (
              <div
                key={ord.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: isOwned ? 'rgba(0, 240, 255, 0.05)' : 'rgba(15, 23, 42, 0.7)',
                  border: isOwned ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid #1E293B',
                  fontSize: 11,
                  fontFamily: 'monospace',
                }}
              >
                {/* Side Tag */}
                <span
                  style={{
                    color: ord.side === 'BUY' ? '#00F0FF' : '#FF2A54',
                    fontWeight: 900,
                    fontSize: 10,
                  }}
                >
                  {ord.side}
                </span>

                {/* Trader badge */}
                <span
                  style={{
                    fontSize: 9,
                    color: badge.color,
                    background: badge.bg,
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontWeight: 800,
                  }}
                >
                  {badge.label}
                </span>

                {/* Price & Qty */}
                <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
                  {formatDKC(ord.price)}
                </span>
                <span style={{ color: '#94A3B8' }}>
                  ({ord.remaining_qty}/{ord.qty})
                </span>

                {/* Action button */}
                {isOwned ? (
                  <button
                    onClick={() => onCancelOrder(ord.id, ord.symbol)}
                    disabled={isCancelling}
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#EF4444',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: isCancelling ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isCancelling ? '...' : '✕ CANCEL'}
                  </button>
                ) : (
                  <button
                    onClick={() => onMatchOrder(ord)}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#10B981',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    🎯 MATCH
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
