import React, { useState, useEffect, useCallback } from 'react';
import { formatDKC } from '@darkhold/shared';

interface WalletViewProps {
  user: { id: string; username: string; role: string } | null;
  balance: { available: number; reserved: number; escrow: number; pendingWithdrawals?: number; total: number };
  csrfToken: string | null;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenTransfer: () => void;
  onBalanceUpdated: () => void;
  onNavigateToStore?: () => void;
}

interface HistoryItem {
  id: string;
  type: string;
  amountDKC: number;
  amountINR: number;
  counterparty: string;
  reference: string;
  status: string;
  failureReason?: string;
  createdAt: string;
}

export const WalletView: React.FC<WalletViewProps> = ({
  user,
  balance,
  csrfToken,
  onOpenDeposit,
  onOpenWithdraw,
  onOpenTransfer,
  onBalanceUpdated,
  onNavigateToStore,
}) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>('ALL');
  const [merchBuying, setMerchBuying] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch('/api/wallet/history', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.items || data.history || []);
        setHistory(items);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, balance.available]);

  // Quick 1-click merch purchase handler
  const handleQuickBuyMerch = async (itemTitle: string, amountDKC: number, sellerUsername: string, itemSymbol?: string) => {
    if (!user) return;
    if (user.username === sellerUsername) {
      setActionNotice({ text: 'Cannot purchase merch from your own seller account.', error: true });
      return;
    }

    setMerchBuying(itemTitle);
    setActionNotice(null);

    try {
      const res = await fetch('/api/merch/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          sellerUsername,
          amount: amountDKC,
          itemTitle,
          itemSymbol,
          symbol: itemSymbol,
          qty: 1,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice({
          text: `✓ Purchased "${itemTitle}" for ${amountDKC} DKC! Ledger Journal: ${data.transferId || data.journalId}`,
          error: false,
        });
        onBalanceUpdated();
        fetchHistory();
      } else {
        setActionNotice({
          text: data.message || data.error || 'Merch purchase failed.',
          error: true,
        });
      }
    } catch (err: any) {
      setActionNotice({ text: err.message || 'Network error.', error: true });
    } finally {
      setMerchBuying(null);
    }
  };

  const filteredHistory = history.filter((item) => {
    if (filter === 'ALL') return true;
    return item.type === filter;
  });

  const availableDKC = balance.available / 100;
  const reservedDKC = balance.reserved / 100;
  const escrowDKC = balance.escrow / 100;
  const pendingWthDKC = (balance.pendingWithdrawals || 0) / 100;
  const totalDKC = availableDKC + reservedDKC + escrowDKC + pendingWthDKC;

  return (
    <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', fontFamily: '"JetBrains Mono", monospace' }}>
      {/* Title & Economy Overview */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 20, color: '#00F0FF', margin: 0, letterSpacing: '0.04em' }}>
              💳 WALLET & UPI ECONOMY
            </h2>
            <span
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid #10B981',
                color: '#10B981',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              1 DKC = ₹1.00 INR (100% FULL-RESERVE BACKED)
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0', maxWidth: 800 }}>
            DKC is the in-app trading currency. UPI is the fiat on-ramp (deposit) and off-ramp (withdraw). All internal purchases and secondary market trades settle atomically in DKC without lock-in.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onOpenDeposit}
            style={{
              background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.2) 0%, rgba(16, 185, 129, 0.2) 100%)',
              border: '1px solid #00F0FF',
              color: '#00F0FF',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>💳 DEPOSIT INR ➔ DKC</span>
          </button>
          <button
            onClick={onOpenWithdraw}
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10B981',
              color: '#10B981',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>💸 WITHDRAW DKC ➔ UPI</span>
          </button>
          <button
            onClick={onOpenTransfer}
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              border: '1px solid #A855F7',
              color: '#A855F7',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>🛍️ SPEND / TRANSFER DKC</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div
          style={{
            background: actionNotice.error ? 'rgba(255, 42, 84, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${actionNotice.error ? '#FF2A54' : '#10B981'}`,
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            color: actionNotice.error ? '#FF2A54' : '#10B981',
            fontSize: 11,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{actionNotice.text}</span>
          <button
            onClick={() => setActionNotice(null)}
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Top 5 Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {/* Metric 1: Available */}
        <div className="card" style={{ padding: 14, borderLeft: '4px solid #00F0FF' }}>
          <div style={{ color: '#64748B', fontSize: 10, fontWeight: 700 }}>AVAILABLE FOR TRADING / WITHDRAWAL</div>
          <div style={{ color: '#00F0FF', fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {formatDKC(balance.available)}
          </div>
          <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
            ₹{availableDKC.toLocaleString('en-IN', { minimumFractionDigits: 2 })} INR
          </div>
        </div>

        {/* Metric 2: Locked in Orders */}
        <div className="card" style={{ padding: 14, borderLeft: '4px solid #F59E0B' }}>
          <div style={{ color: '#64748B', fontSize: 10, fontWeight: 700 }}>LOCKED IN RESTING ORDERS</div>
          <div style={{ color: '#F59E0B', fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {formatDKC(balance.reserved)}
          </div>
          <div style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
            Resting bids in order book
          </div>
        </div>

        {/* Metric 3: Escrow Custody */}
        <div className="card" style={{ padding: 14, borderLeft: '4px solid #A855F7' }}>
          <div style={{ color: '#64748B', fontSize: 10, fontWeight: 700 }}>ESCROW CUSTODY (FROZEN)</div>
          <div style={{ color: '#A855F7', fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {formatDKC(balance.escrow)}
          </div>
          <div style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
            Relic of Agamotto soulbound custody
          </div>
        </div>

        {/* Metric 4: Pending Withdrawals */}
        <div className="card" style={{ padding: 14, borderLeft: '4px solid #38BDF8' }}>
          <div style={{ color: '#64748B', fontSize: 10, fontWeight: 700 }}>PENDING WITHDRAWALS (HOLD)</div>
          <div style={{ color: '#38BDF8', fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {formatDKC(balance.pendingWithdrawals || 0)}
          </div>
          <div style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
            Awaiting NPCI settlement
          </div>
        </div>

        {/* Metric 5: Total Net Worth */}
        <div className="card" style={{ padding: 14, borderLeft: '4px solid #10B981' }}>
          <div style={{ color: '#64748B', fontSize: 10, fontWeight: 700 }}>TOTAL PORTFOLIO NET WORTH</div>
          <div style={{ color: '#10B981', fontSize: 20, fontWeight: 800, marginTop: 4 }}>
            {totalDKC.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC
          </div>
          <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
            ₹{totalDKC.toLocaleString('en-IN', { minimumFractionDigits: 2 })} INR Backed
          </div>
        </div>
      </div>

      {/* Merch Purchase Showcase Strip */}
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ color: '#F8FAFC', fontSize: 13, letterSpacing: 0.5 }}>
              🛍️ SPEND DKC ON OFFICIAL CAMPUS FESTIVAL MERCH & PASSES
            </strong>
            <span style={{ fontSize: 11, color: '#64748B', marginLeft: 10 }}>
              (Primary inventory from Official Fest Organizing Committee (@admin) • Balanced double-entry settlement)
            </span>
          </div>
          {onNavigateToStore && (
            <button
              onClick={onNavigateToStore}
              style={{
                background: 'rgba(0, 240, 255, 0.1)',
                border: '1px solid #00F0FF',
                color: '#00F0FF',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              🏪 View Full Fest Storefront →
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {/* Item 1: Stealth Cloak */}
          <div
            style={{
              background: '#04060A',
              border: '1px solid #161F30',
              borderRadius: 6,
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🧥</span>
              <div>
                <strong style={{ color: '#F8FAFC', fontSize: 12 }}>Darkhold Official Fest Stealth Cloak / Hoodie</strong>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                  Seller: <span style={{ color: '#F59E0B' }}>Official Fest Merch Club (@admin)</span> • 240 GSM
                </div>
                <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 13, marginTop: 4 }}>
                  800.00 DKC (₹800)
                </div>
              </div>
            </div>
            <button
              onClick={() => handleQuickBuyMerch('Darkhold Official Fest Stealth Cloak / Hoodie', 800, 'admin', 'MERCH-CLOAK')}
              disabled={merchBuying === 'Darkhold Official Fest Stealth Cloak / Hoodie' || availableDKC < 800}
              style={{
                background: availableDKC < 800 ? '#1E293B' : 'rgba(168, 85, 247, 0.2)',
                border: `1px solid ${availableDKC < 800 ? '#334155' : '#A855F7'}`,
                color: availableDKC < 800 ? '#64748B' : '#A855F7',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 10,
                fontWeight: 800,
                cursor: availableDKC < 800 || merchBuying ? 'not-allowed' : 'pointer',
              }}
            >
              {merchBuying === 'Darkhold Official Fest Stealth Cloak / Hoodie' ? 'BUYING...' : 'BUY 800 DKC'}
            </button>
          </div>

          {/* Item 2: Festival GA Pass */}
          <div
            style={{
              background: '#04060A',
              border: '1px solid #161F30',
              borderRadius: 6,
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🎟️</span>
              <div>
                <strong style={{ color: '#F8FAFC', fontSize: 12 }}>Pronite General Admission Pass</strong>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                  Seller: <span style={{ color: '#00F0FF' }}>Official Festival Committee (@admin)</span> • 3-Day Pass
                </div>
                <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 13, marginTop: 4 }}>
                  1,500.00 DKC (₹1,500)
                </div>
              </div>
            </div>
            <button
              onClick={() => handleQuickBuyMerch('Pronite General Admission Pass', 1500, 'admin', 'FEST-GA')}
              disabled={merchBuying === 'Pronite General Admission Pass' || availableDKC < 1500}
              style={{
                background: availableDKC < 1500 ? '#1E293B' : 'rgba(0, 240, 255, 0.2)',
                border: `1px solid ${availableDKC < 1500 ? '#334155' : '#00F0FF'}`,
                color: availableDKC < 1500 ? '#64748B' : '#00F0FF',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 10,
                fontWeight: 800,
                cursor: availableDKC < 1500 || merchBuying ? 'not-allowed' : 'pointer',
              }}
            >
              {merchBuying === 'Pronite General Admission Pass' ? 'BUYING...' : 'BUY 1,500 DKC'}
            </button>
          </div>

          {/* Item 3: VIP Pass */}
          <div
            style={{
              background: '#04060A',
              border: '1px solid #161F30',
              borderRadius: 6,
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🗝️</span>
              <div>
                <strong style={{ color: '#F8FAFC', fontSize: 12 }}>VIP All-Access Backstage Pass</strong>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                  Seller: <span style={{ color: '#10B981' }}>Official Festival Committee (@admin)</span> • Meet &amp; Greet
                </div>
                <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 13, marginTop: 4 }}>
                  5,000.00 DKC (₹5,000)
                </div>
              </div>
            </div>
            <button
              onClick={() => handleQuickBuyMerch('VIP All-Access Backstage Pass', 5000, 'admin', 'FEST-VIP')}
              disabled={merchBuying === 'VIP All-Access Backstage Pass' || availableDKC < 5000}
              style={{
                background: availableDKC < 5000 ? '#1E293B' : 'rgba(16, 185, 129, 0.2)',
                border: `1px solid ${availableDKC < 5000 ? '#334155' : '#10B981'}`,
                color: availableDKC < 5000 ? '#64748B' : '#10B981',
                borderRadius: 4,
                padding: '6px 12px',
                fontSize: 10,
                fontWeight: 800,
                cursor: availableDKC < 5000 || merchBuying ? 'not-allowed' : 'pointer',
              }}
            >
              {merchBuying === 'VIP All-Access Backstage Pass' ? 'BUYING...' : 'BUY 5,000 DKC'}
            </button>
          </div>
        </div>
      </div>

      {/* Transaction History Section */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>TRANSACTION HISTORY (DEPOSITS, WITHDRAWALS & TRANSFERS)</span>
            <span style={{ fontSize: 10, color: '#64748B' }}>[{filteredHistory.length} ENTRIES]</span>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Filter Pills */}
            {['ALL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                  border: `1px solid ${filter === f ? '#00F0FF' : '#1E293B'}`,
                  color: filter === f ? '#00F0FF' : '#94A3B8',
                  borderRadius: 3,
                  padding: '2px 8px',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontWeight: filter === f ? 700 : 400,
                }}
              >
                {f}
              </button>
            ))}

            <button
              onClick={fetchHistory}
              disabled={loading}
              style={{
                background: 'transparent',
                border: '1px solid #1E293B',
                color: '#64748B',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 10,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '...' : '↻ REFRESH'}
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: 0 }}>
          {filteredHistory.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748B', fontSize: 11 }}>
              {loading ? 'Loading ledger transactions...' : 'No transactions recorded yet in your wallet history.'}
            </div>
          ) : (
            <table className="ladder-table">
              <thead>
                <tr>
                  <th>TIMESTAMP</th>
                  <th>TYPE</th>
                  <th>COUNTERPARTY / DESTINATION</th>
                  <th>REFERENCE / UTR</th>
                  <th>AMOUNT (DKC)</th>
                  <th>EQUIV INR</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item, idx) => {
                  const isCredit = item.amountDKC > 0;
                  const absDKC = Math.abs(item.amountDKC);
                  const absINR = Math.abs(item.amountINR);

                  return (
                    <tr key={item.id || idx}>
                      <td style={{ color: '#64748B', fontSize: 10 }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background:
                              item.type === 'DEPOSIT'
                                ? 'rgba(0, 240, 255, 0.15)'
                                : item.type === 'WITHDRAWAL'
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(168, 85, 247, 0.15)',
                            color:
                              item.type === 'DEPOSIT'
                                ? '#00F0FF'
                                : item.type === 'WITHDRAWAL'
                                ? '#F59E0B'
                                : '#A855F7',
                          }}
                        >
                          {item.type}
                        </span>
                      </td>
                      <td style={{ color: '#F8FAFC', fontSize: 11 }}>{item.counterparty}</td>
                      <td style={{ color: '#64748B', fontSize: 10 }}>{item.reference || item.id}</td>
                      <td style={{ color: isCredit ? '#10B981' : '#FF2A54', fontWeight: 700 }}>
                        {isCredit ? '+' : '-'}{absDKC.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC
                      </td>
                      <td style={{ color: '#94A3B8' }}>
                        ₹{absINR.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 3,
                            background:
                              item.status === 'COMPLETED'
                                ? 'rgba(16, 185, 129, 0.15)'
                                : item.status === 'FAILED'
                                ? 'rgba(255, 42, 84, 0.15)'
                                : 'rgba(245, 158, 11, 0.15)',
                            color:
                              item.status === 'COMPLETED'
                                ? '#10B981'
                                : item.status === 'FAILED'
                                ? '#FF2A54'
                                : '#F59E0B',
                          }}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
