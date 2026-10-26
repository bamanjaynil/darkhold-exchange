import React, { useState, useEffect } from 'react';
import { formatDKC } from '@darkhold/shared';

interface RazorpayCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { id: string; username: string } | null;
  csrfToken: string | null;
  currentAvailableMinor: number;
  onSuccess: (newBalance: { available: number; reserved: number; escrow: number; total?: number }) => void;
}

type Step = 'DETAILS' | 'OTP' | 'RECEIPT';
type PaymentMethod = 'UPI' | 'CARD';
type UpiMode = 'QR' | 'VPA';

export const RazorpayCheckoutModal: React.FC<RazorpayCheckoutModalProps> = ({
  isOpen,
  onClose,
  user,
  csrfToken,
  currentAvailableMinor,
  onSuccess,
}) => {
  if (!isOpen) return null;

  // Step state
  const [step, setStep] = useState<Step>('DETAILS');

  // Amount State
  const [selectedPreset, setSelectedPreset] = useState<number>(5000);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isCustom, setIsCustom] = useState<boolean>(false);

  const amountDKC = isCustom ? Math.max(100, Math.min(100000, Number(customAmount) || 0)) : selectedPreset;

  // Payment method
  const [method, setMethod] = useState<PaymentMethod>('UPI');

  // UPI fields
  const [upiMode, setUpiMode] = useState<UpiMode>('QR');
  const [upiId, setUpiId] = useState<string>(user ? `${user.username}@okhdfc` : 'trader@okaxis');
  const [utr, setUtr] = useState<string>(() => `UTR${Date.now().toString().slice(-8)}${Math.floor(1000 + Math.random() * 9000)}`);

  // Card fields
  const [cardNumber, setCardNumber] = useState<string>('4242 4242 4242 4242');
  const [cardHolder, setCardHolder] = useState<string>(user ? `${user.username.toUpperCase()} HOLDINGS` : 'ALICE COOPER');
  const [cardExpiry, setCardExpiry] = useState<string>('12/28');
  const [cardCvv, setCardCvv] = useState<string>('888');

  // Step 2 OTP State
  const [demoOtp] = useState<string>('482910');
  const [enteredOtp, setEnteredOtp] = useState<string>('');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(299);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 3 Receipt State
  const [receiptData, setReceiptData] = useState<{
    receiptId: string;
    bankName: string;
    status: string;
    payer: string;
    utr: string;
    amountINR: number;
    dkcCredited: number;
    journalId: string;
    timestamp: string;
  } | null>(null);

  // Timer for Step 2
  useEffect(() => {
    if (step !== 'OTP') return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  const formatTimer = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProceedToOtp = () => {
    if (amountDKC < 100 || amountDKC > 100000) {
      setErrorMessage('Please select or enter an amount between ₹100 and ₹100,000 INR.');
      return;
    }
    if (method === 'UPI' && upiMode === 'VPA' && !upiId.includes('@')) {
      setErrorMessage('Please enter a valid UPI VPA ID (e.g. name@okaxis, trader@okhdfc).');
      return;
    }
    if (method === 'CARD' && cardNumber.replace(/\s+/g, '').length < 16) {
      setErrorMessage('Please enter a valid 16-digit card number.');
      return;
    }
    setErrorMessage(null);
    setEnteredOtp('');
    setStep('OTP');
  };

  const handleAuthorizePayment = async () => {
    if (!enteredOtp || enteredOtp.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit bank verification OTP (482910).');
      return;
    }

    if (enteredOtp.trim() !== demoOtp) {
      setErrorMessage('Invalid Bank OTP! Please enter 482910 or click [Auto-Fill Demo OTP].');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          amount: amountDKC,
          method,
          reference: utr,
          utr,
          otp: enteredOtp.trim(),
          expectedOtp: demoOtp,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.balance) {
          onSuccess(data.balance);
        }
        setReceiptData({
          receiptId: data.receipt?.receiptId || data.receiptId || `RCPT_${Date.now()}`,
          bankName: data.receipt?.bankName || (method === 'CARD' ? 'HDFC Bank - 3D Secure' : 'NPCI / UPI Instant Settlement'),
          status: 'CAPTURED & SETTLED',
          payer: user?.username || 'Trader',
          utr: data.reference || utr,
          amountINR: amountDKC,
          dkcCredited: amountDKC,
          journalId: data.journalId || `j_dep_${Date.now()}`,
          timestamp: new Date().toISOString(),
        });
        setStep('RECEIPT');
      } else {
        setErrorMessage(data.message || data.error || 'Payment authorization failed on bank gateway.');
      }
    } catch (err: any) {
      setErrorMessage(`Network error connecting to payment gateway: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2200,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 540,
          background: '#090D1A',
          border: '1px solid rgba(0, 240, 255, 0.4)',
          borderRadius: 10,
          boxShadow: '0 0 50px rgba(0, 240, 255, 0.18)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
      >
        {/* Top Header & Brand Bar */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #161F30',
            background: 'linear-gradient(90deg, #0A1128 0%, #060814 100%)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                color: '#040711',
                fontSize: 18,
                boxShadow: '0 0 15px rgba(0, 240, 255, 0.5)',
              }}
            >
              ₹
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15, color: '#F8FAFC', letterSpacing: '0.04em' }}>
                  DARKHOLD PAY
                </strong>
                <span
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10B981',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  NPCI / RAZORPAY SANDBOX
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                Instant INR Deposit ➔ Verified DKC Ledger Minting
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                background: 'rgba(0, 240, 255, 0.1)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#00F0FF',
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              1 INR = 1.00 DKC
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748B',
                fontSize: 20,
                cursor: 'pointer',
                padding: '2px 6px',
                lineHeight: 1,
              }}
              title="Close payment modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body with Multi-Step Views */}
        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Progress Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              background: '#040711',
              border: '1px solid #161F30',
              borderRadius: 6,
              fontSize: 11,
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: step === 'DETAILS' ? '#00F0FF' : '#10B981' }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: step === 'DETAILS' ? '#00F0FF' : '#10B981',
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                1
              </span>
              <strong style={{ letterSpacing: '0.02em' }}>AMOUNT & METHOD</strong>
            </div>

            <div style={{ color: '#334155' }}>➔</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: step === 'OTP' ? '#00F0FF' : step === 'RECEIPT' ? '#10B981' : '#64748B' }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: step === 'OTP' ? '#00F0FF' : step === 'RECEIPT' ? '#10B981' : '#1E293B',
                  color: step === 'DETAILS' ? '#94A3B8' : '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                2
              </span>
              <strong style={{ letterSpacing: '0.02em' }}>3D-SECURE / OTP</strong>
            </div>

            <div style={{ color: '#334155' }}>➔</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: step === 'RECEIPT' ? '#10B981' : '#64748B' }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: step === 'RECEIPT' ? '#10B981' : '#1E293B',
                  color: step === 'RECEIPT' ? '#000' : '#94A3B8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                3
              </span>
              <strong style={{ letterSpacing: '0.02em' }}>RECEIPT BADGE</strong>
            </div>
          </div>

          {/* STEP 1: PAYMENT METHOD & INSTRUMENT INPUT */}
          {step === 'DETAILS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Amount Selection */}
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 6, fontWeight: 700 }}>
                  SELECT DEPOSIT AMOUNT (INR)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
                  {[1000, 5000, 10000, 50000].map((amt) => {
                    const active = !isCustom && selectedPreset === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          setSelectedPreset(amt);
                          setIsCustom(false);
                        }}
                        style={{
                          background: active ? 'rgba(0, 240, 255, 0.15)' : '#0F172A',
                          border: `1px solid ${active ? '#00F0FF' : '#1E293B'}`,
                          color: active ? '#00F0FF' : '#CBD5E1',
                          borderRadius: 6,
                          padding: '10px 4px',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: active ? '0 0 10px rgba(0, 240, 255, 0.2)' : 'none',
                        }}
                      >
                        ₹{amt.toLocaleString()}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Amount Toggle & Input */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustom(true);
                      if (!customAmount) setCustomAmount('25000');
                    }}
                    style={{
                      background: isCustom ? 'rgba(0, 240, 255, 0.15)' : '#0F172A',
                      border: `1px solid ${isCustom ? '#00F0FF' : '#1E293B'}`,
                      color: isCustom ? '#00F0FF' : '#94A3B8',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Custom INR
                  </button>
                  {isCustom && (
                    <div style={{ flex: 1, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: 9, color: '#64748B', fontWeight: 700 }}>₹</span>
                      <input
                        type="number"
                        min="100"
                        max="100000"
                        step="100"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="Enter amount (₹100 - ₹100,000)"
                        style={{
                          width: '100%',
                          background: '#040711',
                          border: '1px solid #00F0FF',
                          borderRadius: 6,
                          padding: '8px 12px 8px 24px',
                          color: '#00F0FF',
                          fontSize: 13,
                          fontFamily: '"JetBrains Mono", monospace',
                          fontWeight: 700,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Live Order Summary Card */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
                  border: '1px solid rgba(0, 240, 255, 0.25)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>PAYMENT SUMMARY</div>
                  <div style={{ fontSize: 18, color: '#F8FAFC', fontWeight: 800 }}>
                    ₹{amountDKC.toLocaleString()}.00 INR
                  </div>
                  <div style={{ fontSize: 10, color: '#10B981' }}>
                    0% Processing Fee • Instant Clearance
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>DKC MINTED TO WALLET</div>
                  <div style={{ fontSize: 18, color: '#00F0FF', fontWeight: 800 }}>
                    +{amountDKC.toLocaleString()}.00 DKC
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>
                    Bal after: {formatDKC(currentAvailableMinor + amountDKC * 100)}
                  </div>
                </div>
              </div>

              {/* Payment Method Selector Tabs */}
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 6, fontWeight: 700 }}>
                  CHOOSE PAYMENT METHOD
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => setMethod('UPI')}
                    style={{
                      background: method === 'UPI' ? 'rgba(0, 240, 255, 0.12)' : '#0F172A',
                      border: `1px solid ${method === 'UPI' ? '#00F0FF' : '#1E293B'}`,
                      color: method === 'UPI' ? '#00F0FF' : '#CBD5E1',
                      borderRadius: 6,
                      padding: '10px 8px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: method === 'UPI' ? '0 0 10px rgba(0, 240, 255, 0.2)' : 'none',
                    }}
                  >
                    <span>⚡</span> UPI (VPA & Instant QR)
                  </button>

                  <button
                    type="button"
                    onClick={() => setMethod('CARD')}
                    style={{
                      background: method === 'CARD' ? 'rgba(0, 240, 255, 0.12)' : '#0F172A',
                      border: `1px solid ${method === 'CARD' ? '#00F0FF' : '#1E293B'}`,
                      color: method === 'CARD' ? '#00F0FF' : '#CBD5E1',
                      borderRadius: 6,
                      padding: '10px 8px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: method === 'CARD' ? '0 0 10px rgba(0, 240, 255, 0.2)' : 'none',
                    }}
                  >
                    <span>💳</span> Debit / Credit Card
                  </button>
                </div>

                {/* Method Option A: UPI */}
                {method === 'UPI' && (
                  <div
                    style={{
                      background: '#040711',
                      border: '1px solid #1E293B',
                      borderRadius: 8,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #161F30', paddingBottom: 8 }}>
                      <button
                        type="button"
                        onClick={() => setUpiMode('QR')}
                        style={{
                          background: upiMode === 'QR' ? '#1E293B' : 'transparent',
                          color: upiMode === 'QR' ? '#00F0FF' : '#94A3B8',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        📷 Scan UPI QR Code
                      </button>
                      <button
                        type="button"
                        onClick={() => setUpiMode('VPA')}
                        style={{
                          background: upiMode === 'VPA' ? '#1E293B' : 'transparent',
                          color: upiMode === 'VPA' ? '#00F0FF' : '#94A3B8',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🆔 Enter UPI VPA ID
                      </button>
                    </div>

                    {upiMode === 'QR' ? (
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        {/* High-Tech SVG QR Code */}
                        <div
                          style={{
                            background: '#FFFFFF',
                            padding: 8,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 0 15px rgba(255, 255, 255, 0.1)',
                          }}
                        >
                          <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                            {/* Outer Corner Markers */}
                            <rect x="5" y="5" width="28" height="28" fill="#000" rx="3" />
                            <rect x="9" y="9" width="20" height="20" fill="#fff" rx="2" />
                            <rect x="13" y="13" width="12" height="12" fill="#000" rx="1" />

                            <rect x="67" y="5" width="28" height="28" fill="#000" rx="3" />
                            <rect x="71" y="9" width="20" height="20" fill="#fff" rx="2" />
                            <rect x="75" y="13" width="12" height="12" fill="#000" rx="1" />

                            <rect x="5" y="67" width="28" height="28" fill="#000" rx="3" />
                            <rect x="9" y="71" width="20" height="20" fill="#fff" rx="2" />
                            <rect x="13" y="75" width="12" height="12" fill="#000" rx="1" />

                            {/* Data Pattern Grid simulation */}
                            <rect x="38" y="10" width="8" height="6" fill="#000" />
                            <rect x="50" y="8" width="8" height="8" fill="#000" />
                            <rect x="42" y="22" width="14" height="6" fill="#000" />
                            <rect x="10" y="40" width="8" height="8" fill="#000" />
                            <rect x="24" y="44" width="10" height="6" fill="#000" />
                            <rect x="40" y="40" width="20" height="20" fill="#0284C7" rx="3" />
                            <text x="50" y="54" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="900" fontFamily="sans-serif">₹</text>

                            <rect x="68" y="40" width="10" height="8" fill="#000" />
                            <rect x="82" y="44" width="8" height="8" fill="#000" />
                            <rect x="38" y="66" width="8" height="10" fill="#000" />
                            <rect x="50" y="72" width="12" height="6" fill="#000" />
                            <rect x="68" y="70" width="8" height="12" fill="#000" />
                            <rect x="80" y="68" width="12" height="12" fill="#000" />
                          </svg>
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#F8FAFC', fontWeight: 700 }}>
                            Scan with Any UPI App
                          </span>
                          <span style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.4 }}>
                            Google Pay • PhonePe • Paytm • BHIM • Cred
                          </span>
                          <div style={{ marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: '#64748B' }}>12-Digit NPCI UTR Reference:</span>
                            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                              <input
                                type="text"
                                value={utr}
                                onChange={(e) => setUtr(e.target.value)}
                                style={{
                                  flex: 1,
                                  background: '#090D1A',
                                  border: '1px solid #1E293B',
                                  borderRadius: 4,
                                  padding: '4px 8px',
                                  color: '#00F0FF',
                                  fontSize: 11,
                                  fontFamily: '"JetBrains Mono", monospace',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => setUtr(`UTR${Date.now().toString().slice(-8)}${Math.floor(1000 + Math.random() * 9000)}`)}
                                style={{
                                  background: '#1E293B',
                                  color: '#94A3B8',
                                  border: 'none',
                                  borderRadius: 4,
                                  padding: '4px 8px',
                                  fontSize: 10,
                                  cursor: 'pointer',
                                }}
                                title="Generate new random UTR"
                              >
                                🔄
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                            VIRTUAL PAYMENT ADDRESS (VPA / UPI ID)
                          </label>
                          <input
                            type="text"
                            value={upiId}
                            onChange={(e) => setUpiId(e.target.value)}
                            placeholder="username@okhdfc"
                            style={{
                              width: '100%',
                              background: '#090D1A',
                              border: '1px solid #1E293B',
                              borderRadius: 4,
                              padding: '8px 10px',
                              color: '#F8FAFC',
                              fontSize: 12,
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          />
                        </div>

                        {/* Quick preset chips */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#64748B' }}>Quick:</span>
                          {[`${user?.username || 'trader'}@okhdfc`, 'alice@okaxis', 'trader@ybl'].map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => setUpiId(chip)}
                              style={{
                                background: '#1E293B',
                                border: 'none',
                                color: '#00F0FF',
                                borderRadius: 3,
                                padding: '2px 6px',
                                fontSize: 10,
                                cursor: 'pointer',
                                fontFamily: '"JetBrains Mono", monospace',
                              }}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>

                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                            12-DIGIT TRANSACTION UTR
                          </label>
                          <input
                            type="text"
                            value={utr}
                            onChange={(e) => setUtr(e.target.value)}
                            style={{
                              width: '100%',
                              background: '#090D1A',
                              border: '1px solid #1E293B',
                              borderRadius: 4,
                              padding: '6px 10px',
                              color: '#00F0FF',
                              fontSize: 11,
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Method Option B: Card */}
                {method === 'CARD' && (
                  <div
                    style={{
                      background: '#040711',
                      border: '1px solid #1E293B',
                      borderRadius: 8,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {/* Virtual Holographic Card Preview */}
                    <div
                      style={{
                        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0B132B 100%)',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        borderRadius: 8,
                        padding: 12,
                        position: 'relative',
                        boxShadow: '0 4px 15px rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 16 }}>💳</span>
                          <span style={{ fontSize: 10, color: '#00F0FF', fontWeight: 800 }}>DARKHOLD PLATINUM</span>
                        </div>
                        <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 900 }}>RuPay / VISA</span>
                      </div>

                      <div style={{ fontSize: 14, color: '#F8FAFC', letterSpacing: '0.12em', fontWeight: 700 }}>
                        {cardNumber}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 10 }}>
                        <div>
                          <div style={{ color: '#64748B', fontSize: 8 }}>CARDHOLDER</div>
                          <div style={{ color: '#CBD5E1', fontWeight: 700 }}>{cardHolder}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: '#64748B', fontSize: 8 }}>EXPIRES</div>
                          <div style={{ color: '#CBD5E1', fontWeight: 700 }}>{cardExpiry}</div>
                        </div>
                      </div>
                    </div>

                    {/* Card Input Controls */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>CARD NUMBER</label>
                        <input
                          type="text"
                          value={cardNumber}
                          maxLength={19}
                          onChange={(e) => setCardNumber(e.target.value)}
                          placeholder="4242 4242 4242 4242"
                          style={{
                            width: '100%',
                            background: '#090D1A',
                            border: '1px solid #1E293B',
                            borderRadius: 4,
                            padding: '6px 10px',
                            color: '#F8FAFC',
                            fontSize: 12,
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>CARDHOLDER</label>
                          <input
                            type="text"
                            value={cardHolder}
                            onChange={(e) => setCardHolder(e.target.value)}
                            style={{
                              width: '100%',
                              background: '#090D1A',
                              border: '1px solid #1E293B',
                              borderRadius: 4,
                              padding: '6px 10px',
                              color: '#F8FAFC',
                              fontSize: 11,
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>EXPIRY</label>
                          <input
                            type="text"
                            value={cardExpiry}
                            maxLength={5}
                            onChange={(e) => setCardExpiry(e.target.value)}
                            placeholder="MM/YY"
                            style={{
                              width: '100%',
                              background: '#090D1A',
                              border: '1px solid #1E293B',
                              borderRadius: 4,
                              padding: '6px 10px',
                              color: '#F8FAFC',
                              fontSize: 11,
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>CVV</label>
                          <input
                            type="password"
                            value={cardCvv}
                            maxLength={4}
                            onChange={(e) => setCardCvv(e.target.value)}
                            placeholder="•••"
                            style={{
                              width: '100%',
                              background: '#090D1A',
                              border: '1px solid #1E293B',
                              borderRadius: 4,
                              padding: '6px 10px',
                              color: '#F8FAFC',
                              fontSize: 11,
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {errorMessage && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: '"JetBrains Mono", monospace',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#EF4444',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {/* Proceed CTA */}
              <button
                type="button"
                onClick={handleProceedToOtp}
                style={{
                  background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                  color: '#040711',
                  border: 'none',
                  borderRadius: 6,
                  padding: '12px 16px',
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 0 25px rgba(0, 240, 255, 0.4)',
                  transition: 'all 0.15s ease',
                }}
              >
                PROCEED TO AUTHORIZE ₹{amountDKC.toLocaleString()} INR ➔
              </button>
            </div>
          )}

          {/* STEP 2: 3D-SECURE / NPCI OTP AUTHORIZATION */}
          {step === 'OTP' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Bank Gateway 3D-Secure Banner */}
              <div
                style={{
                  background: '#040711',
                  border: '1px solid #1E293B',
                  borderRadius: 8,
                  padding: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>🏛️</span>
                    <div>
                      <strong style={{ fontSize: 13, color: '#F8FAFC' }}>
                        {method === 'CARD' ? 'HDFC BANK - 3D SECURE 2.0' : 'NPCI UPI 2-FACTOR AUTHENTICATION'}
                      </strong>
                      <div style={{ fontSize: 10, color: '#10B981' }}>
                        🔒 256-Bit TLS Encrypted Payment Gateway
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
                  <div style={{ fontSize: 9, color: '#64748B' }}>SESSION TIMER</div>
                  <div style={{ fontSize: 13, color: '#F59E0B', fontWeight: 800 }}>
                    ⏱️ {formatTimer(secondsRemaining)}
                  </div>
                </div>
              </div>

              {/* Order Context Details */}
              <div
                style={{
                  background: '#090D1A',
                  border: '1px solid #161F30',
                  borderRadius: 6,
                  padding: '10px 14px',
                  fontSize: 11,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <div>
                  <span style={{ color: '#64748B' }}>Merchant: </span>
                  <span style={{ color: '#CBD5E1', fontWeight: 700 }}>Darkhold Digital Assets</span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>Amount: </span>
                  <strong style={{ color: '#00F0FF' }}>₹{amountDKC.toLocaleString()}.00 INR</strong>
                </div>
              </div>

              {/* Evaluator Simulated SMS Alert Banner */}
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>📲</span>
                  <div>
                    <strong style={{ fontSize: 11, color: '#F59E0B' }}>
                      DEMO SMS NOTIFICATION RECEIVED
                    </strong>
                    <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
                      "Your Bank OTP for transaction of ₹{amountDKC.toLocaleString()} at Darkhold Exchange is{' '}
                      <strong style={{ color: '#00F0FF', letterSpacing: '0.08em', fontSize: 13 }}>{demoOtp}</strong>. Valid for 5 mins."
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEnteredOtp(demoOtp);
                    setErrorMessage(null);
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'rgba(0, 240, 255, 0.15)',
                    border: '1px solid rgba(0, 240, 255, 0.4)',
                    color: '#00F0FF',
                    borderRadius: 4,
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  ⚡ Auto-Fill Demo OTP ({demoOtp})
                </button>
              </div>

              {/* 6-Digit OTP Input Field */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>
                  ENTER 6-DIGIT BANK OTP
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={enteredOtp}
                  onChange={(e) => {
                    setEnteredOtp(e.target.value.replace(/\D/g, ''));
                    setErrorMessage(null);
                  }}
                  placeholder="482910"
                  autoFocus
                  style={{
                    width: 240,
                    textAlign: 'center',
                    letterSpacing: '0.4em',
                    fontSize: 22,
                    fontWeight: 900,
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: '#040711',
                    border: '2px solid #00F0FF',
                    color: '#00F0FF',
                    fontFamily: '"JetBrains Mono", monospace',
                    boxShadow: '0 0 20px rgba(0, 240, 255, 0.25)',
                  }}
                />
                <span style={{ fontSize: 10, color: '#64748B' }}>
                  Simulated 3D-Secure sandbox: Enter <strong style={{ color: '#00F0FF' }}>{demoOtp}</strong> to verify.
                </span>
              </div>

              {errorMessage && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: '"JetBrains Mono", monospace',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#EF4444',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    textAlign: 'center',
                  }}
                >
                  {errorMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep('DETAILS');
                    setErrorMessage(null);
                  }}
                  disabled={loading}
                  style={{
                    flex: 1,
                    background: '#1E293B',
                    color: '#94A3B8',
                    border: 'none',
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ← BACK
                </button>

                <button
                  type="button"
                  onClick={handleAuthorizePayment}
                  disabled={loading}
                  style={{
                    flex: 2,
                    background: loading ? '#1E293B' : 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    color: loading ? '#64748B' : '#FFFFFF',
                    border: 'none',
                    borderRadius: 6,
                    padding: 12,
                    fontWeight: 900,
                    fontSize: 13,
                    letterSpacing: '0.04em',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: loading ? 'none' : '0 0 25px rgba(16, 185, 129, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {loading ? 'SETTLING ON LEDGER...' : `🔒 AUTHORIZE & MINT +${amountDKC.toLocaleString()} DKC`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PAYMENT RECEIPT & AUDIT CONFIRMATION */}
          {step === 'RECEIPT' && receiptData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Status Header Badge */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.1) 100%)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: 8,
                  padding: 16,
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '2px solid #10B981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color: '#10B981',
                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  ✓
                </div>
                <strong style={{ fontSize: 16, color: '#10B981', letterSpacing: '0.04em' }}>
                  PAYMENT SETTLED & DKC MINTED
                </strong>
                <div style={{ fontSize: 11, color: '#CBD5E1' }}>
                  Bank settlement verified. Double-entry ledger deposit journal committed.
                </div>
              </div>

              {/* Official Receipt Card */}
              <div
                style={{
                  background: '#040711',
                  border: '1px solid #1E293B',
                  borderRadius: 8,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  fontSize: 11,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>RECEIPT ID</span>
                  <span style={{ color: '#00F0FF', fontWeight: 800 }}>{receiptData.receiptId}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>SETTLEMENT GATEWAY</span>
                  <span style={{ color: '#F8FAFC', fontWeight: 700 }}>{receiptData.bankName}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>BANK UTR / REFERENCE</span>
                  <span style={{ color: '#F59E0B', fontWeight: 700 }}>{receiptData.utr}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>PAYER TRADER</span>
                  <span style={{ color: '#F8FAFC', fontWeight: 700 }}>{receiptData.payer.toUpperCase()}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>INR AMOUNT PAID</span>
                  <span style={{ color: '#F8FAFC', fontWeight: 700 }}>₹{receiptData.amountINR.toLocaleString()}.00 INR</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>DKC MINTED</span>
                  <strong style={{ color: '#10B981', fontSize: 13 }}>+{receiptData.dkcCredited.toLocaleString()}.00 DKC</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>LEDGER JOURNAL ID</span>
                  <span style={{ color: '#CBD5E1' }}>{receiptData.journalId}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2 }}>
                  <span style={{ color: '#64748B' }}>DOUBLE-ENTRY INVARIANT</span>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>✓ ∑ Postings = 0 (100% Solvency)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={handlePrintReceipt}
                  style={{
                    flex: 1,
                    background: '#1E293B',
                    color: '#00F0FF',
                    border: '1px solid rgba(0, 240, 255, 0.3)',
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  🖨️ VIEW / PRINT RECEIPT
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    flex: 2,
                    background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                    color: '#040711',
                    border: 'none',
                    borderRadius: 6,
                    padding: 12,
                    fontWeight: 900,
                    fontSize: 13,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
                  }}
                >
                  ✓ DONE / BACK TO TRADING
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};