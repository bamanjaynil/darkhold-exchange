import React, { useState } from 'react';
import { formatDKC } from '@darkhold/shared';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { id: string; username: string } | null;
  csrfToken: string | null;
  currentAvailableMinor: number;
  onSuccess: (newBalance: { available: number; reserved: number; escrow: number; pendingWithdrawals?: number; total?: number }) => void;
}

interface MerchPreset {
  id: string;
  title: string;
  priceDKC: number;
  sellerUsername: string;
  icon: string;
  category: string;
}

const MERCH_CATALOG: MerchPreset[] = [
  {
    id: 'merch-cloak',
    title: 'Darkhold Official Fest Stealth Cloak / Hoodie',
    priceDKC: 800,
    sellerUsername: 'admin',
    icon: '🧥',
    category: 'Official Merchandise (Club Store)',
  },
  {
    id: 'merch-fest-pass',
    title: 'Pronite General Admission Pass',
    priceDKC: 1500,
    sellerUsername: 'admin',
    icon: '🎫',
    category: 'Box Office Ticket',
  },
  {
    id: 'merch-vip-key',
    title: 'VIP All-Access Backstage Pass',
    priceDKC: 5000,
    sellerUsername: 'admin',
    icon: '👑',
    category: 'VIP Sanctum Pass',
  },
];

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  user,
  csrfToken,
  currentAvailableMinor,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const currentAvailableDKC = currentAvailableMinor / 100;

  const [mode, setMode] = useState<'merch' | 'peer'>('merch');
  const [selectedMerch, setSelectedMerch] = useState<MerchPreset>(MERCH_CATALOG[0]);

  // Peer transfer fields
  const [recipient, setRecipient] = useState<string>('bob');
  const [amountInput, setAmountInput] = useState<string>('100');
  const [memo, setMemo] = useState<string>('Peer settlement');

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);

  const transferAmount = mode === 'merch' ? selectedMerch.priceDKC : parseFloat(amountInput) || 0;
  const isAmountValid = transferAmount > 0 && transferAmount <= currentAvailableDKC;

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAmountValid) {
      setErrorMsg(`Insufficient available funds. Need ${transferAmount} DKC, available: ${currentAvailableDKC.toLocaleString()} DKC.`);
      return;
    }

    const sellerTarget = mode === 'merch' ? selectedMerch.sellerUsername : recipient.trim();
    if (!sellerTarget) {
      setErrorMsg('Please specify a recipient username.');
      return;
    }

    if (user && sellerTarget.toLowerCase() === user.username.toLowerCase()) {
      setErrorMsg('Cannot transfer DKC or purchase items from yourself.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setReceipt(null);

    try {
      const endpoint = mode === 'merch' ? '/api/merch/purchase' : '/api/wallet/transfer';
      const itemSymbol = selectedMerch.id === 'merch-cloak' ? 'MERCH-CLOAK' : selectedMerch.id === 'merch-fest-pass' ? 'FEST-GA' : 'FEST-VIP';
      const payload = mode === 'merch'
        ? {
            sellerUsername: selectedMerch.sellerUsername,
            amount: selectedMerch.priceDKC,
            itemTitle: selectedMerch.title,
            symbol: itemSymbol,
            itemSymbol: itemSymbol,
            qty: 1,
          }
        : {
            recipient: sellerTarget,
            amount: transferAmount,
            memo: memo || 'Peer Transfer',
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setReceipt(data);
        if (data.buyerBalance) {
          onSuccess(data.buyerBalance);
        }
      } else {
        setErrorMsg(data.message || data.error || 'Transfer failed.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error occurred during transfer.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2500,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: 540,
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#070A14',
          border: '1px solid #1E293B',
          borderRadius: 8,
          boxShadow: '0 0 45px rgba(0, 240, 255, 0.15)',
          padding: 24,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid #A855F7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              🛍️
            </div>
            <div>
              <div style={{ color: '#A855F7', fontWeight: 800, fontSize: 15, letterSpacing: 0.5 }}>
                SPEND & TRANSFER DKC (DKC ⇄ DKC)
              </div>
              <div style={{ color: '#64748B', fontSize: 11 }}>
                Atomic Double-Entry Ledger Transfers Between User Wallets
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748B',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {receipt ? (
          /* Receipt Screen */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid #10B981',
                borderRadius: 6,
                padding: 18,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
              <div style={{ color: '#10B981', fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
                LEDGER TRANSFER SETTLED
              </div>
              <div style={{ color: '#CBD5E1', fontSize: 12, marginBottom: 14 }}>
                Transferred <strong style={{ color: '#00F0FF' }}>{receipt.amountDKC} DKC</strong> to{' '}
                <strong style={{ color: '#F8FAFC' }}>{receipt.seller || receipt.sellerUsername}</strong>
              </div>

              <div
                style={{
                  background: '#04060A',
                  border: '1px solid #161F30',
                  borderRadius: 4,
                  padding: 12,
                  fontSize: 11,
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Journal Entry:</span>
                  <strong style={{ color: '#00F0FF' }}>{receipt.transferId || receipt.journalId}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Item / Purpose:</span>
                  <span style={{ color: '#F8FAFC' }}>{receipt.item || 'Transfer'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Platform Fee:</span>
                  <span style={{ color: '#10B981' }}>0.00 DKC (0%)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Double-Entry Conservation:</span>
                  <span style={{ color: '#10B981' }}>✓ ∑ Postings = 0</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                setReceipt(null);
                onClose();
              }}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                borderRadius: 4,
                padding: '10px 16px',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              DONE
            </button>
          </div>
        ) : (
          <form onSubmit={handleExecute} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Mode Switcher Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                type="button"
                onClick={() => setMode('merch')}
                style={{
                  padding: '8px',
                  background: mode === 'merch' ? 'rgba(168, 85, 247, 0.2)' : '#04060A',
                  color: mode === 'merch' ? '#A855F7' : '#64748B',
                  border: `1px solid ${mode === 'merch' ? '#A855F7' : '#1E293B'}`,
                  borderRadius: 4,
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                🛍️ BUY OFFICIAL MERCH
              </button>
              <button
                type="button"
                onClick={() => setMode('peer')}
                style={{
                  padding: '8px',
                  background: mode === 'peer' ? 'rgba(0, 240, 255, 0.2)' : '#04060A',
                  color: mode === 'peer' ? '#00F0FF' : '#64748B',
                  border: `1px solid ${mode === 'peer' ? '#00F0FF' : '#1E293B'}`,
                  borderRadius: 4,
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ⇄ PEER-TO-PEER TRANSFER
              </button>
            </div>

            {/* Available Balance Strip */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid #1E293B',
                borderRadius: 6,
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ color: '#64748B', fontSize: 11 }}>YOUR AVAILABLE DKC:</span>
              <strong style={{ color: '#00F0FF', fontSize: 14 }}>
                {formatDKC(currentAvailableMinor)}
              </strong>
            </div>

            {mode === 'merch' ? (
              /* Merch Catalog Selection */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>
                  CHOOSE MERCHANDISE ITEM:
                </span>
                {MERCH_CATALOG.map((item) => {
                  const isSelected = selectedMerch.id === item.id;
                  const canAfford = currentAvailableDKC >= item.priceDKC;

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedMerch(item)}
                      style={{
                        background: isSelected ? 'rgba(168, 85, 247, 0.15)' : '#04060A',
                        border: `1px solid ${isSelected ? '#A855F7' : '#1E293B'}`,
                        borderRadius: 6,
                        padding: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{item.icon}</span>
                        <div>
                          <div style={{ color: '#F8FAFC', fontWeight: 700, fontSize: 12 }}>
                            {item.title}
                          </div>
                          <div style={{ color: '#64748B', fontSize: 10 }}>
                            Seller: <span style={{ color: '#F59E0B' }}>@{item.sellerUsername}</span> • {item.category}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 13 }}>
                          {item.priceDKC} DKC
                        </div>
                        <div style={{ fontSize: 10, color: canAfford ? '#10B981' : '#FF2A54' }}>
                          {canAfford ? '✓ In Budget' : '✕ Low Balance'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Peer Transfer Fields */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    RECIPIENT USERNAME
                  </label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {['bob', 'alice', 'carol', 'admin'].filter((u) => u !== user?.username).map((demoUser) => (
                      <button
                        key={demoUser}
                        type="button"
                        onClick={() => setRecipient(demoUser)}
                        style={{
                          background: recipient === demoUser ? 'rgba(0, 240, 255, 0.2)' : '#04060A',
                          border: `1px solid ${recipient === demoUser ? '#00F0FF' : '#1E293B'}`,
                          color: recipient === demoUser ? '#00F0FF' : '#94A3B8',
                          borderRadius: 3,
                          padding: '3px 8px',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        @{demoUser}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Recipient username"
                    required
                    style={{
                      width: '100%',
                      background: '#04060A',
                      border: '1px solid #1E293B',
                      borderRadius: 4,
                      padding: '8px 12px',
                      color: '#F8FAFC',
                      fontSize: 12,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    TRANSFER AMOUNT (DKC)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={currentAvailableDKC}
                    step="any"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      background: '#04060A',
                      border: `1px solid ${transferAmount > currentAvailableDKC ? '#FF2A54' : '#1E293B'}`,
                      borderRadius: 4,
                      padding: '8px 12px',
                      color: '#F8FAFC',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    PAYMENT MEMO / NOTE
                  </label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="e.g. For festival ticket split"
                    style={{
                      width: '100%',
                      background: '#04060A',
                      border: '1px solid #1E293B',
                      borderRadius: 4,
                      padding: '8px 12px',
                      color: '#F8FAFC',
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                style={{
                  background: 'rgba(255, 42, 84, 0.15)',
                  border: '1px solid #FF2A54',
                  borderRadius: 4,
                  padding: 8,
                  color: '#FF2A54',
                  fontSize: 11,
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                style={{
                  background: 'transparent',
                  border: '1px solid #1E293B',
                  color: '#94A3B8',
                  borderRadius: 4,
                  padding: '10px 14px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                CANCEL
              </button>
              <button
                type="submit"
                disabled={loading || !isAmountValid}
                style={{
                  background: loading || !isAmountValid ? '#1E293B' : mode === 'merch' ? '#A855F7' : '#00F0FF',
                  color: loading || !isAmountValid ? '#64748B' : '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: loading || !isAmountValid ? 'not-allowed' : 'pointer',
                  letterSpacing: 0.5,
                }}
              >
                {loading
                  ? 'SETTLING JOURNAL TRANSFER...'
                  : mode === 'merch'
                  ? `BUY FOR ${selectedMerch.priceDKC} DKC`
                  : `TRANSFER ${transferAmount} DKC`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
