import React from 'react';
import { formatDKC, toMinorUnits } from '@darkhold/shared';

export interface ExecutionBladeProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInstrument: {
    id: string;
    symbol: string;
    name: string;
    faceValue: number;
    collarBps: number;
    collarCeiling?: number;
    minPrice?: number;
  };
  side: 'BUY' | 'SELL';
  setSide: (side: 'BUY' | 'SELL') => void;
  orderType: 'LIMIT' | 'MARKET';
  setOrderType: (type: 'LIMIT' | 'MARKET') => void;
  tif: 'GTC' | 'IOC' | 'FOK';
  setTif: (tif: 'GTC' | 'IOC' | 'FOK') => void;
  priceInput: string;
  setPriceInput: (price: string) => void;
  qtyInput: string;
  setQtyInput: (qty: string) => void;
  balance: { available: number; reserved: number; escrow: number; total: number };
  userHolding: number;
  onSubmitOrder: (e: React.FormEvent) => void;
  submitting: boolean;
  message: { text: string; error: boolean } | null;
  bestBidPrice?: number | null;
  bestAskPrice?: number | null;
}

export const ExecutionBlade: React.FC<ExecutionBladeProps> = ({
  isOpen,
  onClose,
  selectedInstrument,
  side,
  setSide,
  orderType,
  setOrderType,
  tif,
  setTif,
  priceInput,
  setPriceInput,
  qtyInput,
  setQtyInput,
  balance,
  userHolding,
  onSubmitOrder,
  submitting,
  message,
  bestBidPrice,
  bestAskPrice,
}) => {
  if (!isOpen) return null;

  const ceilingMinor = selectedInstrument.collarCeiling || Math.floor(selectedInstrument.faceValue * (1 + selectedInstrument.collarBps / 10000));
  const ceilingDKC = ceilingMinor / 100;
  const numPrice = parseFloat(priceInput) || 0;
  const numQty = parseInt(qtyInput, 10) || 0;
  const totalMinor = toMinorUnits(numPrice) * numQty;

  const isCollarViolated = side === 'BUY' && orderType === 'LIMIT' && toMinorUnits(numPrice) > ceilingMinor;
  const isInsufficientFunds = side === 'BUY' && balance.available < totalMinor;
  const isInsufficientHoldings = side === 'SELL' && userHolding < numQty;

  // Projected balances
  const projectedCash = side === 'BUY' ? Math.max(0, balance.available - totalMinor) : balance.available + totalMinor;
  const projectedHolding = side === 'BUY' ? userHolding + numQty : Math.max(0, userHolding - numQty);

  // Set fractional quantity based on buying power or inventory
  const setRiskFraction = (fraction: number) => {
    if (side === 'BUY') {
      const priceMinor = toMinorUnits(numPrice || (selectedInstrument.faceValue / 100));
      if (priceMinor > 0) {
        const maxAffordable = Math.floor(balance.available / priceMinor);
        const target = Math.max(1, Math.floor(maxAffordable * fraction));
        setQtyInput(String(target));
      }
    } else {
      const target = Math.max(1, Math.floor(userHolding * fraction));
      setQtyInput(String(target));
    }
  };

  return (
    <aside
      style={{
        position: 'fixed',
        right: 0,
        top: 52,
        bottom: 0,
        width: 360,
        background: '#060A14',
        borderLeft: '1px solid #1E293B',
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.7)',
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideInRight 0.2s ease',
      }}
    >
      {/* Blade Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #161F30',
          background: 'rgba(15, 23, 42, 0.7)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#00F0FF', letterSpacing: '0.06em' }}>
            EXECUTION BLADE
          </span>
          <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
            {selectedInstrument.symbol}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#64748B',
            fontSize: 16,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      {/* Main Order Configuration Form */}
      <form onSubmit={onSubmitOrder} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 1. Side Switcher: BUY vs SELL */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            type="button"
            onClick={() => setSide('BUY')}
            style={{
              background: side === 'BUY' ? 'rgba(0, 240, 255, 0.18)' : '#090D1A',
              color: side === 'BUY' ? '#00F0FF' : '#64748B',
              border: side === 'BUY' ? '1px solid #00F0FF' : '1px solid #1E293B',
              borderRadius: 5,
              padding: '10px 0',
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            BUY / BID
          </button>
          <button
            type="button"
            onClick={() => setSide('SELL')}
            style={{
              background: side === 'SELL' ? 'rgba(255, 42, 84, 0.18)' : '#090D1A',
              color: side === 'SELL' ? '#FF2A54' : '#64748B',
              border: side === 'SELL' ? '1px solid #FF2A54' : '1px solid #1E293B',
              borderRadius: 5,
              padding: '10px 0',
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            SELL / ASK
          </button>
        </div>

        {/* 2. Order Type & Time In Force Selector */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ fontSize: 10, color: '#64748B', fontWeight: 700, display: 'block', marginBottom: 3 }}>
              ORDER TYPE
            </label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as any)}
              style={{
                width: '100%',
                background: '#090D1A',
                border: '1px solid #1E293B',
                color: '#F8FAFC',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 11,
              }}
            >
              <option value="LIMIT">LIMIT</option>
              <option value="MARKET">MARKET (IOC)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, color: '#64748B', fontWeight: 700, display: 'block', marginBottom: 3 }}>
              TIME IN FORCE
            </label>
            <select
              value={tif}
              onChange={(e) => setTif(e.target.value as any)}
              disabled={orderType === 'MARKET'}
              style={{
                width: '100%',
                background: '#090D1A',
                border: '1px solid #1E293B',
                color: orderType === 'MARKET' ? '#475569' : '#F8FAFC',
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: 11,
              }}
            >
              <option value="GTC">GTC (Good-Til-Cancel)</option>
              <option value="IOC">IOC (Immediate-Or-Cancel)</option>
              <option value="FOK">FOK (Fill-Or-Kill)</option>
            </select>
          </div>
        </div>

        {/* 3. Limit Price Input & Quick Pegs */}
        {orderType === 'LIMIT' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>LIMIT PRICE (DKC)</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {bestBidPrice && (
                  <button
                    type="button"
                    onClick={() => setPriceInput(String(bestBidPrice / 100))}
                    style={{
                      background: '#1E293B',
                      color: '#00F0FF',
                      border: 'none',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: 9,
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                    }}
                  >
                    Bid: {bestBidPrice / 100}
                  </button>
                )}
                {bestAskPrice && (
                  <button
                    type="button"
                    onClick={() => setPriceInput(String(bestAskPrice / 100))}
                    style={{
                      background: '#1E293B',
                      color: '#FF2A54',
                      border: 'none',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: 9,
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                    }}
                  >
                    Ask: {bestAskPrice / 100}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPriceInput(String(ceilingDKC))}
                  style={{
                    background: '#1E293B',
                    color: '#F59E0B',
                    border: 'none',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 9,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                  }}
                >
                  Cap: {ceilingDKC}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setPriceInput(String(Math.max(1, numPrice - 1)))}
                style={{
                  background: '#0F172A',
                  color: '#94A3B8',
                  border: '1px solid #1E293B',
                  borderRadius: 4,
                  padding: '0 10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                -
              </button>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                style={{
                  flex: 1,
                  background: '#090D1A',
                  border: `1px solid ${isCollarViolated ? '#EF4444' : '#1E293B'}`,
                  color: isCollarViolated ? '#EF4444' : '#F8FAFC',
                  borderRadius: 4,
                  padding: '8px 10px',
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                onClick={() => setPriceInput(String(numPrice + 1))}
                style={{
                  background: '#0F172A',
                  color: '#94A3B8',
                  border: '1px solid #1E293B',
                  borderRadius: 4,
                  padding: '0 10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>

            {isCollarViolated && (
              <div style={{ fontSize: 10, color: '#EF4444', marginTop: 3 }}>
                ❌ Exceeds collar cap of {formatDKC(ceilingMinor)} (+{selectedInstrument.collarBps / 100}%)
              </div>
            )}
          </div>
        )}

        {/* 4. Quantity Controller & Risk Fraction Sliders */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>QUANTITY (UNITS)</label>
            <span style={{ fontSize: 10, color: '#64748B', fontFamily: 'monospace' }}>
              {side === 'BUY' ? `Power: ~${formatDKC(balance.available)}` : `Inventory: ${userHolding} Units`}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => setQtyInput(String(Math.max(1, numQty - 1)))}
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #1E293B',
                borderRadius: 4,
                padding: '0 10px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              -
            </button>
            <input
              type="number"
              min="1"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              style={{
                flex: 1,
                background: '#090D1A',
                border: `1px solid ${isInsufficientHoldings ? '#EF4444' : '#1E293B'}`,
                color: isInsufficientHoldings ? '#EF4444' : '#F8FAFC',
                borderRadius: 4,
                padding: '8px 10px',
                fontSize: 13,
                fontWeight: 800,
                fontFamily: 'monospace',
              }}
            />
            <button
              type="button"
              onClick={() => setQtyInput(String(numQty + 1))}
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #1E293B',
                borderRadius: 4,
                padding: '0 10px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </button>
          </div>

          {/* Quick Risk Fraction Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            <button
              type="button"
              onClick={() => setRiskFraction(0.25)}
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #1E293B',
                borderRadius: 3,
                padding: '3px 0',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              25%
            </button>
            <button
              type="button"
              onClick={() => setRiskFraction(0.5)}
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #1E293B',
                borderRadius: 3,
                padding: '3px 0',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => setRiskFraction(0.75)}
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #1E293B',
                borderRadius: 3,
                padding: '3px 0',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              75%
            </button>
            <button
              type="button"
              onClick={() => setRiskFraction(1.0)}
              style={{
                background: 'rgba(0, 240, 255, 0.1)',
                color: '#00F0FF',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                borderRadius: 3,
                padding: '3px 0',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              MAX
            </button>
          </div>

          {isInsufficientHoldings && (
            <div style={{ fontSize: 10, color: '#EF4444', marginTop: 4 }}>
              ❌ Insufficient inventory: You only own {userHolding} units of {selectedInstrument.symbol}.
            </div>
          )}
        </div>

        {/* 5. Pre-Flight Double-Entry Impact Telemetry */}
        <div
          style={{
            background: '#030509',
            border: '1px solid #1E293B',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 11,
            fontFamily: 'monospace',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 10, color: '#64748B', fontWeight: 800 }}>
            PRE-FLIGHT LEDGER AUDIT
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#94A3B8' }}>Commitment Value:</span>
            <strong style={{ color: side === 'BUY' ? '#00F0FF' : '#FF2A54' }}>
              {formatDKC(totalMinor)}
            </strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
            <span>Projected Cash:</span>
            <span style={{ color: isInsufficientFunds ? '#EF4444' : '#94A3B8' }}>
              {formatDKC(balance.available)} ➔ {formatDKC(projectedCash)}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
            <span>Projected Holding:</span>
            <span>
              {userHolding} ➔ {projectedHolding} Units
            </span>
          </div>

          {isInsufficientFunds && (
            <div style={{ color: '#EF4444', fontSize: 10, marginTop: 2 }}>
              ⚠️ Insufficient Available DKC for order reservation.
            </div>
          )}
        </div>

        {/* Feedback message */}
        {message && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'monospace',
              background: message.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: message.error ? '#EF4444' : '#10B981',
              border: `1px solid ${message.error ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            }}
          >
            {message.text}
          </div>
        )}

        {/* Submit Execution Button */}
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <button
            type="submit"
            disabled={submitting || isCollarViolated || isInsufficientFunds || isInsufficientHoldings}
            style={{
              width: '100%',
              background: (submitting || isCollarViolated || isInsufficientFunds || isInsufficientHoldings)
                ? '#1E293B'
                : side === 'BUY'
                ? 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)'
                : 'linear-gradient(135deg, #FF2A54 0%, #BE123C 100%)',
              color: (submitting || isCollarViolated || isInsufficientFunds || isInsufficientHoldings)
                ? '#64748B'
                : '#06080F',
              border: 'none',
              borderRadius: 5,
              padding: '12px 16px',
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: '0.04em',
              cursor: (submitting || isCollarViolated || isInsufficientFunds || isInsufficientHoldings)
                ? 'not-allowed'
                : 'pointer',
              boxShadow: (submitting || isCollarViolated || isInsufficientFunds || isInsufficientHoldings)
                ? 'none'
                : side === 'BUY'
                ? '0 0 16px rgba(0, 240, 255, 0.35)'
                : '0 0 16px rgba(255, 42, 84, 0.35)',
            }}
          >
            {submitting
              ? 'TRANSMITTING ORDER...'
              : `TRANSMIT ${side} ${numQty} @ ${orderType === 'MARKET' ? 'MARKET' : formatDKC(toMinorUnits(numPrice))}`}
          </button>
        </div>
      </form>
    </aside>
  );
};
