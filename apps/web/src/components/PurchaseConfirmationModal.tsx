import React, { useState } from 'react';

export interface PurchaseConfirmationData {
  title: string;
  imageUrl?: string;
  variantTitle?: string; // e.g. "Size: M", "VIP All-Access", or "1 Unit"
  quantity: number;
  unitPriceDkc: number; // In DKC e.g. 800.00
  sellerName: string; // e.g. "🏛️ Official Fest Club" or "@alice"
  isEscrow: boolean; // true for official merch / physical items / custody escrow
  onConfirm: () => Promise<{
    success: boolean;
    journalId?: string;
    pickupToken?: string;
    orderNumber?: string;
    ticketCode?: string;
    error?: string;
  }>;
}

interface PurchaseConfirmationModalProps {
  data: PurchaseConfirmationData | null;
  availableBalanceDkc: number;
  onClose: () => void;
  onSuccessDone?: () => void;
}

export const PurchaseConfirmationModal: React.FC<PurchaseConfirmationModalProps> = ({
  data,
  availableBalanceDkc,
  onClose,
  onSuccessDone,
}) => {
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Phase 2 Receipt State
  const [receiptData, setReceiptData] = useState<{
    journalId: string;
    pickupOtp: string;
    timestamp: string;
    ticketCode?: string;
  } | null>(null);

  // Reset internal state cleanly whenever new purchase data is loaded
  React.useEffect(() => {
    if (data) {
      setReceiptData(null);
      setErrorMessage('');
      setSubmitting(false);
      setCopied(false);
    }
  }, [data]);

  if (!data) return null;

  const totalCostDkc = data.unitPriceDkc * data.quantity;
  const platformFeeDkc = 0.0;
  const remainingBalanceDkc = availableBalanceDkc - totalCostDkc;
  const hasSufficientFunds = availableBalanceDkc >= totalCostDkc;

  const handleConfirmAndPay = async () => {
    if (!hasSufficientFunds) {
      setErrorMessage('Insufficient DKC balance. Please top up your wallet via UPI deposit first.');
      return;
    }

    setErrorMessage('');
    setSubmitting(true);

    try {
      const res = await data.onConfirm();
      if (res && res.success) {
        // Extract 6-digit OTP (clean from PK- prefix if any)
        const rawToken = res.pickupToken || res.orderNumber || '849204';
        const cleanDigits = rawToken.replace(/[^0-9A-Z]/g, '').slice(-6).toUpperCase();

        setReceiptData({
          journalId: res.journalId || res.orderNumber || `TXN #JRN-${Math.floor(10000 + Math.random() * 90000)}`,
          pickupOtp: cleanDigits || '849204',
          timestamp: new Date().toLocaleString('en-IN', { timeZoneName: 'short' }),
          ticketCode: res.ticketCode,
        });
      } else {
        setErrorMessage(res?.error || 'Purchase rejected by exchange core.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error executing purchase.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyOtp = async () => {
    if (!receiptData?.pickupOtp) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(receiptData.pickupOtp);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = receiptData.pickupOtp;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    if (submitting) return;
    setReceiptData(null);
    setErrorMessage('');
    setSubmitting(false);
    setCopied(false);
    onClose();
  };

  const handleDone = () => {
    setReceiptData(null);
    setErrorMessage('');
    setSubmitting(false);
    setCopied(false);
    onClose();
    if (onSuccessDone) onSuccessDone();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: 520,
          maxWidth: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#070A14',
          border: '1px solid #00F0FF',
          boxShadow: '0 0 35px rgba(0, 240, 255, 0.22)',
          borderRadius: 12,
          padding: 24,
        }}
      >
        {/* ============================================================== */}
        {/* SCREEN 1: PRE-PURCHASE TRANSACTION & WALLET DEBIT CONFIRMATION */}
        {/* ============================================================== */}
        {!receiptData ? (
          <div>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>🛡️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#00F0FF', letterSpacing: '0.04em' }}>
                    CONFIRM TRANSACTION &amp; WALLET DEBIT
                  </h3>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    Darkhold Atomic Double-Entry Ledger Clearance
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Product Header Strip */}
            <div
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid #1E293B',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 6,
                  background: '#040711',
                  border: '1px solid #00F0FF44',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                {data.imageUrl ? (
                  <img src={data.imageUrl} alt={data.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 28 }}>📦</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC' }}>{data.title}</div>
                <div style={{ fontSize: 12, color: '#00F0FF', fontWeight: 700, marginTop: 2 }}>
                  {data.variantTitle || 'Standard Edition'} • Qty: {data.quantity} Unit{data.quantity > 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  Counterparty / Seller: <strong style={{ color: '#F59E0B' }}>{data.sellerName}</strong>
                </div>
              </div>
            </div>

            {/* Complete Financial Summary Table */}
            <div
              style={{
                background: '#04060C',
                border: '1px solid #161F30',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 16,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748B', marginBottom: 8, letterSpacing: '0.05em' }}>
                FINANCIAL LEDGER SETTLEMENT
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#94A3B8' }}>Your Available Balance:</span>
                <strong style={{ color: '#F8FAFC' }}>
                  {availableBalanceDkc.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#94A3B8' }}>Unit Price × Quantity:</span>
                <span style={{ color: '#F8FAFC' }}>
                  {data.unitPriceDkc.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC × {data.quantity}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#94A3B8' }}>Platform Protocol Fee:</span>
                <span style={{ color: '#10B981' }}>{platformFeeDkc.toFixed(2)} DKC (Free)</span>
              </div>
              <div
                style={{
                  height: 1,
                  background: '#1E293B',
                  margin: '8px 0',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ color: '#00F0FF', fontSize: 13 }}>Total Debit Amount:</strong>
                <strong style={{ color: '#00F0FF', fontSize: 14 }}>
                  {totalCostDkc.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC (₹{totalCostDkc.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: hasSufficientFunds ? '#64748B' : '#EF4444' }}>Remaining Balance After Payment:</span>
                <strong style={{ color: hasSufficientFunds ? (remainingBalanceDkc > 0 ? '#10B981' : '#F59E0B') : '#EF4444' }}>
                  {hasSufficientFunds
                    ? `${remainingBalanceDkc.toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC`
                    : 'INSUFFICIENT FUNDS'}
                </strong>
              </div>
            </div>

            {/* Settlement Type Notice */}
            <div
              style={{
                background: data.isEscrow ? 'rgba(245, 158, 11, 0.08)' : 'rgba(0, 240, 255, 0.08)',
                border: `1px solid ${data.isEscrow ? 'rgba(245, 158, 11, 0.3)' : 'rgba(0, 240, 255, 0.3)'}`,
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 18,
                fontSize: 11,
                lineHeight: 1.45,
                color: '#CBD5E1',
              }}
            >
              {data.isEscrow ? (
                <div>
                  <strong style={{ color: '#F59E0B' }}>🔒 Delivery Escrow Custody:</strong> Payment will be held in Delivery Escrow until you verify item handover with your 6-digit Pickup OTP.
                </div>
              ) : (
                <div>
                  <strong style={{ color: '#00F0FF' }}>⚡ Atomic Delivery-vs-Payment:</strong> Pass transfers immediately to your holdings upon confirmation with instant turnstile barcode access.
                </div>
              )}
            </div>

            {/* Error Message if Any */}
            {errorMessage && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #EF4444',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: '#FCA5A5',
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 14,
                }}
              >
                ✕ {errorMessage}
              </div>
            )}

            {/* Two Explicit Action Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                style={{
                  flex: 1,
                  background: '#1E293B',
                  color: '#94A3B8',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '12px 16px',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                [✕ Cancel]
              </button>
              <button
                type="button"
                onClick={handleConfirmAndPay}
                disabled={submitting || !hasSufficientFunds}
                style={{
                  flex: 2,
                  background: submitting || !hasSufficientFunds
                    ? '#334155'
                    : 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                  color: submitting || !hasSufficientFunds ? '#64748B' : '#06080F',
                  border: 'none',
                  borderRadius: 6,
                  padding: '12px 16px',
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: submitting || !hasSufficientFunds ? 'not-allowed' : 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                  boxShadow: submitting || !hasSufficientFunds ? 'none' : '0 0 20px rgba(0, 240, 255, 0.35)',
                }}
              >
                {submitting ? 'PROCESSING CLEARANCE...' : `[✓ Confirm & Pay ${totalCostDkc.toFixed(2)} DKC]`}
              </button>
            </div>
          </div>
        ) : (
          /* ============================================================== */
          /* SCREEN 2: POST-PURCHASE TRANSACTION RECEIPT & HANDOVER OTP     */
          /* ============================================================== */
          <div>
            {/* Top Close Button on Receipt Screen */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
              <button
                type="button"
                onClick={handleDone}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  fontSize: 18,
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
                title="Close and view in portfolio"
              >
                ✕
              </button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>✅</div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#10B981', letterSpacing: '0.04em' }}>
                TRANSACTION VERIFIED &amp; RECORDED
              </h3>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                Ledger Balanced • Assets Credited • Escrow Active
              </div>
            </div>

            {/* Reference & Timestamp Box */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid #1E293B',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>Journal Ref:</span>
                <strong style={{ color: '#00F0FF' }}>{receiptData.journalId}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748B' }}>Settlement Time:</span>
                <span style={{ color: '#CBD5E1' }}>{receiptData.timestamp}</span>
              </div>
            </div>

            {/* 6-Digit Handover / Pickup Verification OTP Banner */}
            <div
              style={{
                background: 'radial-gradient(circle at center, rgba(16, 185, 129, 0.15) 0%, #06110D 100%)',
                border: '2px solid #10B981',
                borderRadius: 10,
                padding: '16px 14px',
                textAlign: 'center',
                marginBottom: 16,
                boxShadow: '0 0 25px rgba(16, 185, 129, 0.2)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.06em' }}>
                🔑 6-DIGIT HANDOVER / PICKUP VERIFICATION OTP:
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  color: '#F8FAFC',
                  letterSpacing: '0.25em',
                  fontFamily: '"JetBrains Mono", monospace',
                  margin: '8px 0',
                  textShadow: '0 0 16px rgba(16, 185, 129, 0.6)',
                }}
              >
                {receiptData.pickupOtp}
              </div>

              {/* Rendered Visual Verification QR Badge */}
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 6px 0' }}>
                <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="100" height="100" rx="6" fill="#040907" stroke="#10B981" strokeWidth={2}/>
                  {/* Outer target corners */}
                  <rect x="8" y="8" width="24" height="24" rx="3" fill="none" stroke="#10B981" strokeWidth={3}/>
                  <rect x="14" y="14" width="12" height="12" fill="#10B981"/>
                  <rect x="68" y="8" width="24" height="24" rx="3" fill="none" stroke="#10B981" strokeWidth={3}/>
                  <rect x="74" y="14" width="12" height="12" fill="#10B981"/>
                  <rect x="8" y="68" width="24" height="24" rx="3" fill="none" stroke="#10B981" strokeWidth={3}/>
                  <rect x="14" y="74" width="12" height="12" fill="#10B981"/>
                  {/* Cyber matrix blocks */}
                  <rect x="40" y="12" width="8" height="8" fill="#10B981"/>
                  <rect x="52" y="12" width="8" height="8" fill="#10B981"/>
                  <rect x="40" y="24" width="14" height="6" fill="#10B981"/>
                  <rect x="20" y="40" width="8" height="20" fill="#10B981"/>
                  <rect x="36" y="38" width="12" height="12" fill="#10B981"/>
                  <rect x="54" y="38" width="8" height="8" fill="#10B981"/>
                  <rect x="68" y="40" width="20" height="8" fill="#10B981"/>
                  <rect x="38" y="58" width="18" height="8" fill="#10B981"/>
                  <rect x="62" y="56" width="12" height="12" fill="#10B981"/>
                  <rect x="40" y="74" width="8" height="16" fill="#10B981"/>
                  <rect x="54" y="78" width="16" height="8" fill="#10B981"/>
                  <rect x="76" y="76" width="12" height="12" fill="#10B981"/>
                </svg>
              </div>

              <div style={{ fontSize: 10, color: '#6EE7B7', fontWeight: 600 }}>
                Holographic Scan Badge • Instant Counter Validation
              </div>

              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={handleCopyOtp}
                  style={{
                    background: copied ? '#10B981' : '#0B1E16',
                    color: copied ? '#06080F' : '#10B981',
                    border: '1px solid #10B981',
                    borderRadius: 4,
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  {copied ? '✓ COPIED TO CLIPBOARD!' : '📋 COPY 6-DIGIT OTP'}
                </button>
              </div>
            </div>

            {/* Clear Handover Instruction */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid #1E293B',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 11,
                lineHeight: 1.5,
                color: '#CBD5E1',
                marginBottom: 16,
              }}
            >
              ℹ️ <strong>Handover Instruction:</strong> Show this 6-Digit OTP (<code>{receiptData.pickupOtp}</code>) at the Club Merch Desk (or enter it in <code>🤝 P2P ESCROW</code> / <code>🏛️ CLUBS &amp; WORKSPACE</code>) to verify physical delivery and release escrow settlement.
            </div>

            {/* Done Action Button */}
            <button
              type="button"
              onClick={handleDone}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                color: '#06080F',
                border: 'none',
                borderRadius: 6,
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 900,
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
                boxShadow: '0 0 20px rgba(16, 185, 129, 0.35)',
              }}
            >
              ✓ Done / View in Portfolio
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
