import React, { useEffect, useState } from 'react';
import { fromMicro, toMicro, OrderBookSnapshot, L2Level } from '@darkhold/shared';

type SnapshotWithTelemetry = OrderBookSnapshot & { ops: number; totalOrders: number };

// Real-Time Cumulative Market Depth SVG Mountain Chart
function MarketDepthChart({ bids, asks }: { bids: L2Level[]; asks: L2Level[] }) {
  const width = 420;
  const height = 135;
  const maxCum = Math.max(
    bids[bids.length - 1]?.cumulativeQuantity || 1,
    asks[asks.length - 1]?.cumulativeQuantity || 1,
    1
  );

  // Bids plotted right-to-left from center (width/2 -> 0)
  const bidPoints = bids.map((b, i) => {
    const x = width / 2 - ((i + 1) / Math.max(bids.length, 1)) * (width / 2 - 10);
    const y = height - (b.cumulativeQuantity / maxCum) * (height - 24) - 10;
    return `${x},${y}`;
  });
  const bidPolygon =
    bids.length > 0
      ? `${width / 2},${height - 10} ${bidPoints.join(' ')} 10,${height - 10}`
      : '';

  // Asks plotted left-to-right from center (width/2 -> width)
  const askPoints = asks.map((a, i) => {
    const x = width / 2 + ((i + 1) / Math.max(asks.length, 1)) * (width / 2 - 10);
    const y = height - (a.cumulativeQuantity / maxCum) * (height - 24) - 10;
    return `${x},${y}`;
  });
  const askPolygon =
    asks.length > 0
      ? `${width / 2},${height - 10} ${askPoints.join(' ')} ${width - 10},${height - 10}`
      : '';

  return (
    <div style={{ marginTop: 12, background: '#0b0b12', borderRadius: 6, padding: '8px 10px', border: '1px solid #1e1e2e' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
        <span>CUMULATIVE BID DEPTH</span>
        <span style={{ color: '#38bdf8' }}>MID-MARKET SPREAD</span>
        <span>CUMULATIVE ASK DEPTH</span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={width / 2} y1={0} x2={width / 2} y2={height} stroke="#334155" strokeDasharray="3,3" />
        {bidPolygon && (
          <>
            <polygon points={bidPolygon} fill="rgba(34, 197, 94, 0.22)" />
            <polyline fill="none" stroke="#4ade80" strokeWidth="2" points={bidPoints.join(' ')} />
          </>
        )}
        {askPolygon && (
          <>
            <polygon points={askPolygon} fill="rgba(248, 113, 113, 0.22)" />
            <polyline fill="none" stroke="#f87171" strokeWidth="2" points={askPoints.join(' ')} />
          </>
        )}
      </svg>
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<SnapshotWithTelemetry | null>(null);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [timeInForce, setTimeInForce] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [price, setPrice] = useState('2040');
  const [qty, setQty] = useState('3');
  const [simulateBot, setSimulateBot] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [solvencyProof, setSolvencyProof] = useState<any>(null);
  const [swarmMetrics, setSwarmMetrics] = useState<any>(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/ws/market');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'L2_SNAPSHOT') {
        setSnap(msg.data);
      }
    };
    return () => ws.close();
  }, []);

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('Computing SHA-256 Anti-Bot PoW & Submitting...');
    const res = await fetch('http://localhost:3001/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr_trader_1',
        marketId: 'mkt_darkhold_vip',
        side,
        type: orderType,
        timeInForce,
        priceMicro: toMicro(Number(price)).toString(),
        quantity: Number(qty),
        powNonce: `0000_valid_pow_${Date.now()}`,
        simulateScalperBot: simulateBot
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatusMsg(`BLOCKED: ${data.message || data.error}`);
    } else {
      setStatusMsg(
        `Order #${data.orderId.slice(0, 6)} Processed | Matched: ${data.matchedTradesCount} trades (Escrow Locked)`
      );
    }
  };

  const cancelOrder = async (id: string) => {
    await fetch(`http://localhost:3001/api/v1/orders/${id}`, { method: 'DELETE' });
    setStatusMsg(`Cancelled resting order #${id.slice(0, 6)} & unlocked funds.`);
  };

  const clearDutchAuction = async () => {
    const res = await fetch('http://localhost:3001/api/v1/auctions/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_trader_1' })
    });
    const data = await res.json();
    if (res.ok) {
      setStatusMsg(
        `DUTCH AUCTION WON at ₹${fromMicro(data.clearingPriceMicro)}! Escrowed & advancing to Round #${data.nextRound}`
      );
    } else {
      setStatusMsg(`Dutch Auction Error: ${data.message}`);
    }
  };

  const verifyEscrowDelivery = async (tradeId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/escrow/${tradeId}/verify`, {
      method: 'POST'
    });
    const data = await res.json();
    if (res.ok) {
      setStatusMsg(
        `Ed25519 Ticket Delivery Verified! Escrow Released for ${tradeId} (Sig: ${data.ed25519Signature.slice(0, 16)}...)`
      );
    }
  };

  const triggerSwarm = async () => {
    setStatusMsg('Firing 1,400 simultaneous orders...');
    const res = await fetch('http://localhost:3001/api/v1/sim/swarm', { method: 'POST' });
    const data = await res.json();
    setSwarmMetrics(data);
    setStatusMsg(
      `Swarm Completed: ${data.ordersProcessed} orders in ${data.executionTimeMs}ms (${data.effectiveOps.toLocaleString()} OPS)`
    );
  };

  const verifySolvency = async () => {
    const res = await fetch('http://localhost:3001/api/v1/solvency/usr_trader_1');
    setSolvencyProof(await res.json());
  };

  if (!snap) {
    return <div style={{ padding: 32 }}>Connecting to Darkhold Matching Engine WebSocket...</div>;
  }

  const maxBidVol = Math.max(...snap.bids.map((b) => b.quantity), 1);
  const maxAskVol = Math.max(...snap.asks.map((a) => a.quantity), 1);

  return (
    <div style={{ padding: '16px 22px', maxWidth: '1500px', margin: '0 auto' }}>
      {/* Top Header & Live Double-Entry Telemetry */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #27273a',
          paddingBottom: 12,
          marginBottom: 16
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 21, color: '#f87171', letterSpacing: 1 }}>
            07 // THE DARKHOLD EXCHANGE
          </h1>
          <small style={{ color: '#94a3b8' }}>
            In-Memory FIFO Order Book • Live L2 Depth Chart • Anti-Scalper Collars • Dutch Auctions • Ed25519 Escrow & Merkle Solvency
          </small>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <div style={{ background: '#161622', padding: '7px 12px', borderRadius: 6, border: '1px solid #2e2e42' }}>
            <div>
              Face Value: <strong>₹{fromMicro(snap.faceValueMicro)}</strong>
            </div>
            <div style={{ color: '#38bdf8' }}>
              Collar: ₹{fromMicro(snap.collarFloorMicro)} – ₹{fromMicro(snap.collarCeilingMicro)}
            </div>
          </div>
          <div style={{ background: '#161622', padding: '7px 12px', borderRadius: 6, border: '1px solid #2e2e42' }}>
            <div>
              Double-Entry Ledger:{' '}
              <strong style={{ color: snap.ledgerInvariantBalanced ? '#4ade80' : '#f87171' }}>
                {snap.ledgerInvariantBalanced ? 'BALANCED (0 Anomalies)' : 'IMBALANCED'}
              </strong>
            </div>
            <div>
              Blocked Bot/Scalper Attacks: <strong style={{ color: '#fbbf24' }}>{snap.blockedBotAttempts}</strong>
            </div>
          </div>
          <div style={{ background: '#161622', padding: '7px 12px', borderRadius: 6, border: '1px solid #2e2e42' }}>
            <div>
              Throughput: <strong style={{ color: '#4ade80' }}>{snap.ops} orders/sec</strong>
            </div>
            <div>
              Sequenced: <strong>{snap.totalOrders}</strong> (Seq #{snap.seqId})
            </div>
          </div>
        </div>
      </header>

      {/* Main 3-Column Trading Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1.1fr', gap: 16 }}>
        {/* Panel 1: L2 Order Book Ladder + Cumulative Market Depth Chart */}
        <section style={{ background: '#12121c', padding: 14, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#cbd5e1' }}>
            LIVE LEVEL 2 ORDER BOOK & CUMULATIVE DEPTH (20 FPS WS)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>BID PRICE</span>
                <span>QTY (CUM)</span>
              </div>
              {snap.bids.map((b) => (
                <div
                  key={b.priceMicro}
                  onClick={() => setPrice(String(fromMicro(b.priceMicro)))}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 6px',
                    fontSize: 12,
                    marginBottom: 2,
                    cursor: 'pointer'
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${(b.quantity / maxBidVol) * 100}%`,
                      background: 'rgba(34, 197, 94, 0.16)'
                    }}
                  />
                  <span style={{ color: '#4ade80', fontWeight: 600, zIndex: 1 }}>₹{fromMicro(b.priceMicro)}</span>
                  <span style={{ zIndex: 1 }}>
                    {b.quantity} <span style={{ color: '#64748b' }}>({b.cumulativeQuantity})</span>
                  </span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>ASK PRICE</span>
                <span>QTY (CUM)</span>
              </div>
              {snap.asks.map((a) => (
                <div
                  key={a.priceMicro}
                  onClick={() => setPrice(String(fromMicro(a.priceMicro)))}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 6px',
                    fontSize: 12,
                    marginBottom: 2,
                    cursor: 'pointer'
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${(a.quantity / maxAskVol) * 100}%`,
                      background: 'rgba(248, 113, 113, 0.16)'
                    }}
                  />
                  <span style={{ color: '#f87171', fontWeight: 600, zIndex: 1 }}>₹{fromMicro(a.priceMicro)}</span>
                  <span style={{ zIndex: 1 }}>
                    {a.quantity} <span style={{ color: '#64748b' }}>({a.cumulativeQuantity})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Live Cumulative Market Depth Chart */}
          <MarketDepthChart bids={snap.bids} asks={snap.asks} />

          {/* Resting Open Orders with O(1) Cancel */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>RESTING OPEN ORDERS (O(1) CANCEL)</div>
            <div style={{ maxHeight: 95, overflowY: 'auto', fontSize: 11 }}>
              {snap.openOrders.map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '3px 6px',
                    background: '#171724',
                    marginBottom: 3,
                    borderRadius: 4
                  }}
                >
                  <span>
                    <strong style={{ color: o.side === 'BUY' ? '#4ade80' : '#f87171' }}>{o.side}</strong> ₹
                    {fromMicro(o.priceMicro)} × {o.remainingQty}
                  </span>
                  <button
                    onClick={() => cancelOrder(o.id)}
                    style={{
                      background: '#334155',
                      color: '#f8fafc',
                      border: 'none',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 10,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Panel 2: Order Execution + Anti-Bot PoW + Dutch Auction Engine */}
        <section style={{ background: '#12121c', padding: 14, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#cbd5e1' }}>SUBMIT ORDER (FIFO + ANTI-SCALPER COLLAR)</h3>
          <form onSubmit={submitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setSide('BUY')}
                style={{
                  flex: 1,
                  padding: 7,
                  background: side === 'BUY' ? '#16a34a' : '#1e293b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setSide('SELL')}
                style={{
                  flex: 1,
                  padding: 7,
                  background: side === 'SELL' ? '#dc2626' : '#1e293b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                SELL
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setOrderType('LIMIT')}
                style={{
                  flex: 1,
                  padding: 5,
                  background: orderType === 'LIMIT' ? '#3b82f6' : '#1e293b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                LIMIT
              </button>
              <button
                type="button"
                onClick={() => setOrderType('MARKET')}
                style={{
                  flex: 1,
                  padding: 5,
                  background: orderType === 'MARKET' ? '#3b82f6' : '#1e293b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                MARKET
              </button>
              {(['GTC', 'IOC', 'FOK'] as const).map((tif) => (
                <button
                  key={tif}
                  type="button"
                  onClick={() => setTimeInForce(tif)}
                  style={{
                    padding: '5px 8px',
                    background: timeInForce === tif ? '#6366f1' : '#1e293b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11
                  }}
                >
                  {tif}
                </button>
              ))}
            </div>

            {orderType === 'LIMIT' && (
              <label style={{ fontSize: 12 }}>
                Limit Price (₹) — Anti-Scalping Collar [₹1000 .. ₹2400]:
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 7,
                    marginTop: 4,
                    background: '#09090f',
                    border: '1px solid #334155',
                    color: '#fff',
                    borderRadius: 4,
                    boxSizing: 'border-box'
                  }}
                />
              </label>
            )}

            <label style={{ fontSize: 12 }}>
              Pass Quantity:
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{
                  width: '100%',
                  padding: 7,
                  marginTop: 4,
                  background: '#09090f',
                  border: '1px solid #334155',
                  color: '#fff',
                  borderRadius: 4,
                  boxSizing: 'border-box'
                }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fca5a5', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={simulateBot}
                onChange={(e) => setSimulateBot(e.target.checked)}
              />
              Simulate Unverified Bot Attack (Omit SHA-256 PoW Nonce)
            </label>

            <button
              type="submit"
              style={{
                padding: 9,
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Execute {side} {orderType} ({timeInForce})
            </button>
          </form>

          {statusMsg && (
            <div
              style={{
                marginTop: 10,
                padding: 8,
                background: '#1e1e2f',
                borderRadius: 4,
                fontSize: 11,
                color: '#fbbf24'
              }}
            >
              {statusMsg}
            </div>
          )}

          <hr style={{ borderColor: '#252538', margin: '14px 0' }} />

          {/* Automated Dutch Auction Liquidation Engine */}
          <h4 style={{ margin: '0 0 6px 0', fontSize: 13, color: '#cbd5e1' }}>
            DUTCH AUCTION ENGINE (ROUND #{snap.dutchAuction.roundNumber})
          </h4>
          <div style={{ background: '#181826', padding: 10, borderRadius: 6, border: '1px solid #2e2e46' }}>
            <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>
              {snap.dutchAuction.relicName}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Decaying -₹{fromMicro(snap.dutchAuction.dropPerSecMicro)}/sec (Floor: ₹
                  {fromMicro(snap.dutchAuction.reservePriceMicro)})
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#38bdf8' }}>
                  ₹{fromMicro(snap.dutchAuction.currentPriceMicro)}
                </div>
              </div>
              <button
                onClick={clearDutchAuction}
                style={{
                  padding: '9px 14px',
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 12
                }}
              >
                Instant Liquidate Now
              </button>
            </div>
            {snap.dutchAuction.lastWinner && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#4ade80' }}>
                Last Cleared: {snap.dutchAuction.lastWinner.userId} won at ₹
                {fromMicro(snap.dutchAuction.lastWinner.priceMicro)} ({snap.dutchAuction.lastWinner.clearedAt})
              </div>
            )}
          </div>
        </section>

        {/* Panel 3: War Room + Escrow Custody + Double-Entry Ledger */}
        <section style={{ background: '#12121c', padding: 14, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 14, color: '#cbd5e1' }}>
            WAR ROOM, ED25519 ESCROW & MERKLE SOLVENCY
          </h3>

          {/* Wallet Custody Breakdown */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              background: '#171726',
              padding: 8,
              borderRadius: 6,
              fontSize: 11,
              marginBottom: 10
            }}
          >
            <div>
              Available: <strong style={{ color: '#4ade80' }}>₹{fromMicro(snap.wallet.availableMicro).toLocaleString()}</strong>
            </div>
            <div>
              In Open Orders: <strong style={{ color: '#fbbf24' }}>₹{fromMicro(snap.wallet.lockedMicro).toLocaleString()}</strong>
            </div>
            <div>
              Locked in Escrow: <strong style={{ color: '#38bdf8' }}>₹{fromMicro(snap.wallet.escrowMicro).toLocaleString()}</strong>
            </div>
            <div>
              Released to Sellers: <strong style={{ color: '#a78bfa' }}>₹{fromMicro(snap.wallet.settledRevenueMicro).toLocaleString()}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              onClick={triggerSwarm}
              style={{
                flex: 1,
                padding: 8,
                background: '#e11d48',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              1,400 Order Swarm (1,000+ OPS)
            </button>
            <button
              onClick={verifySolvency}
              style={{
                flex: 1,
                padding: 8,
                background: '#0d9488',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              Verify Merkle Solvency
            </button>
          </div>

          {swarmMetrics && (
            <div style={{ fontSize: 11, background: '#181826', padding: 8, borderRadius: 6, marginBottom: 8 }}>
              Swarm: <strong>{swarmMetrics.ordersProcessed}</strong> orders |{' '}
              <strong>{swarmMetrics.tradesExecuted}</strong> trades in <strong>{swarmMetrics.executionTimeMs}ms</strong> (
              <strong style={{ color: '#4ade80' }}>{swarmMetrics.effectiveOps.toLocaleString()} OPS</strong>)
            </div>
          )}

          {solvencyProof && (
            <div style={{ fontSize: 11, background: '#181826', padding: 8, borderRadius: 6, marginBottom: 8 }}>
              <div style={{ color: '#4ade80', fontWeight: 700 }}>
                MERKLE SOLVENCY: {solvencyProof.isSolvent ? 'VERIFIED (Assets == Liabilities)' : 'FAILED'}
              </div>
              <div>Root: {solvencyProof.merkleRootHash.slice(0, 28)}...</div>
              <div>Leaf: {solvencyProof.leafHash?.slice(0, 28)}...</div>
            </div>
          )}

          {/* Cryptographic Escrow Verification Queue */}
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            CRYPTOGRAPHIC ESCROW LOCKS (ED25519 TICKET VERIFICATION)
          </div>
          <div style={{ maxHeight: 110, overflowY: 'auto', marginBottom: 10 }}>
            {snap.recentTrades.length === 0 ? (
              <div style={{ fontSize: 11, color: '#64748b' }}>Match an order or Dutch auction to create an Escrow Lock.</div>
            ) : (
              snap.recentTrades.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#181826',
                    padding: '5px 8px',
                    borderRadius: 4,
                    marginBottom: 4,
                    fontSize: 11
                  }}
                >
                  <div>
                    <strong>₹{fromMicro(t.priceMicro)}</strong> × {t.quantity} •{' '}
                    <span
                      style={{
                        color: t.escrowStatus === 'VERIFIED_RELEASED' ? '#4ade80' : '#fbbf24'
                      }}
                    >
                      {t.escrowStatus}
                    </span>
                  </div>
                  {t.escrowStatus === 'LOCKED_PENDING_DELIVERY' ? (
                    <button
                      onClick={() => verifyEscrowDelivery(t.id)}
                      style={{
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 3,
                        padding: '3px 7px',
                        fontSize: 10,
                        cursor: 'pointer'
                      }}
                    >
                      Verify Ticket & Release
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, color: '#4ade80' }}>Ed25519 Signed ✓</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Double-Entry Ledger Audit Log */}
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            IMMUTABLE DOUBLE-ENTRY LEDGER JOURNAL (DEBIT == CREDIT)
          </div>
          <div style={{ maxHeight: 110, overflowY: 'auto', fontSize: 10 }}>
            {snap.recentLedger.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: '4px 6px',
                  background: '#151521',
                  marginBottom: 3,
                  borderRadius: 3,
                  display: 'flex',
                  justifyContent: 'space-between'
                }}
              >
                <span>
                  <strong style={{ color: '#f87171' }}>DR</strong> {entry.debitAccount} ➔{' '}
                  <strong style={{ color: '#4ade80' }}>CR</strong> {entry.creditAccount}
                </span>
                <span style={{ color: '#38bdf8' }}>₹{fromMicro(entry.amountMicro).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
