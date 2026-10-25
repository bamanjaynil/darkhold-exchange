import React from 'react';
import { formatDKC } from '@darkhold/shared';

export interface EscrowItem {
  id: string;
  symbol: string;
  qty: number;
  cashMinor: number;
  buyerUserId: string;
  sellerUserId: string;
  status: 'LOCKED' | 'RELEASED' | 'REFUNDED';
  expiresAt: string;
}

export interface EscrowCustodyViewProps {
  escrows: EscrowItem[];
  user: { id: string; username: string; role: string } | null;
  onDeliverEscrow: (escrowId: string) => void;
  onRefreshEscrows: () => void;
}

export const EscrowCustodyView: React.FC<EscrowCustodyViewProps> = ({
  escrows,
  user,
  onDeliverEscrow,
  onRefreshEscrows,
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
              ESCROW & PHYSICAL CUSTODY
            </h2>
            <span
              style={{
                fontSize: 10,
                color: '#A855F7',
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              TWO-PHASE DVP
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
            Two-phase Delivery-versus-Payment protocol with cryptographic receipt verification and automatic timeout sweeping.
          </p>
        </div>

        <button
          onClick={onRefreshEscrows}
          style={{
            background: '#0F172A',
            color: '#94A3B8',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🔄 Refresh Escrows
        </button>
      </div>

      {/* Escrow Items Grid */}
      {escrows.length === 0 ? (
        <div style={{ background: '#090D1A', border: '1px solid #1E293B', borderRadius: 8, padding: 48, textAlign: 'center', color: '#64748B' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#94A3B8', marginBottom: 6 }}>
            No Active Escrows
          </div>
          <div style={{ fontSize: 12 }}>
            Trading physical custody instruments (such as RELIC-AGAMOTTO) locks counterparty collateral until physical receipt delivery.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {escrows.map((e) => {
            const isSeller = user?.id === e.sellerUserId;
            const isBuyer = user?.id === e.buyerUserId;

            return (
              <div
                key={e.id}
                style={{
                  background: '#090D1A',
                  border: '1px solid #1E293B',
                  borderRadius: 6,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: '#F8FAFC', fontSize: 14 }}>{e.symbol}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: e.status === 'LOCKED' ? '#F59E0B' : e.status === 'RELEASED' ? '#10B981' : '#EF4444',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid #334155',
                      padding: '2px 6px',
                      borderRadius: 3,
                    }}
                  >
                    {e.status}
                  </span>
                </div>

                <div style={{ fontSize: 11, fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><span style={{ color: '#64748B' }}>Escrow ID: </span>{e.id}</div>
                  <div><span style={{ color: '#64748B' }}>Locked Cash: </span><strong style={{ color: '#00F0FF' }}>{formatDKC(e.cashMinor)}</strong></div>
                  <div><span style={{ color: '#64748B' }}>Asset Qty: </span>{e.qty} Units</div>
                  <div><span style={{ color: '#64748B' }}>Buyer: </span>{isBuyer ? 'YOU' : e.buyerUserId}</div>
                  <div><span style={{ color: '#64748B' }}>Seller: </span>{isSeller ? 'YOU' : e.sellerUserId}</div>
                </div>

                {e.status === 'LOCKED' && isSeller && (
                  <button
                    onClick={() => onDeliverEscrow(e.id)}
                    style={{
                      background: '#10B981',
                      color: '#06080F',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px 12px',
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    📦 Deliver & Release Funds
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
