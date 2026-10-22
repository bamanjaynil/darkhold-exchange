import React, { useEffect, useState } from 'react';
import { fromMicro, toMicro, OrderBookSnapshot } from '@darkhold/shared';

type SnapshotWithTelemetry = OrderBookSnapshot & { ops: number; totalOrders: number };

export default function App() {
  const [snap, setSnap] = useState<SnapshotWithTelemetry | null>(null);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('2000');
  const [qty, setQty] = useState('2');
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
    setStatusMsg('Submitting...');
    const res = await fetch('http://localhost:3001/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr_trader_1',
        marketId: 'mkt_darkhold_vip',
        side,
        type: orderType,
        timeInForce: 'GTC',
        priceMicro: toMicro(Number(price)).toString(),
        quantity: Number(qty)
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatusMsg(`Blocked: ${data.message || data.error}`);
    } else {
      setStatusMsg(`Order ${data.orderId.slice(0, 8)} Accepted | Matched: ${data.matchedTradesCount} trades`);
    }
  };

  const triggerSwarm = async () => {
    setStatusMsg('Firing 1,400 simultaneous orders...');
    const res = await fetch('http://localhost:3001/api/v1/sim/swarm', { method: 'POST' });
    const data = await res.json();
    setSwarmMetrics(data);
    setStatusMsg(`Swarm Completed: ${data.ordersProcessed} orders in ${data.executionTimeMs}ms (${data.effectiveOps} OPS)`);
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
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header & Telemetry Bar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #27273a', paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#f87171', letterSpacing: 1 }}>07 // THE DARKHOLD EXCHANGE</h1>
          <small style={{ color: '#94a3b8' }}>In-Memory FIFO Order Book • Anti-Scalper Price Collars • Dutch Auction • Merkle Solvency</small>
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
          <div style={{ background: '#161622', padding: '8px 12px', borderRadius: 6, border: '1px solid #2e2e42' }}>
            <div>Face Value: <strong>₹{fromMicro(snap.faceValueMicro)}</strong></div>
            <div style={{ color: '#38bdf8' }}>
              Collar: ₹{fromMicro(snap.collarFloorMicro)} – ₹{fromMicro(snap.collarCeilingMicro)}
            </div>
          </div>
          <div style={{ background: '#161622', padding: '8px 12px', borderRadius: 6, border: '1px solid #2e2e42' }}>
            <div>Throughput: <strong style={{ color: '#4ade80' }}>{snap.ops} orders/sec</strong></div>
            <div>Total Sequenced: <strong>{snap.totalOrders}</strong> (Seq #{snap.seqId})</div>
          </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 20 }}>
        {/* Panel 1: Live Level 2 Order Book Ladder */}
        <section style={{ background: '#12121c', padding: 16, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 15, color: '#cbd5e1' }}>LIVE LEVEL 2 ORDER BOOK (20 FPS WS)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>BIDS (BUYERS)</div>
              {snap.bids.map((b) => (
                <div key={b.priceMicro} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 13, marginBottom: 3 }}>
                  <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(b.quantity / maxBidVol) * 100}%`, background: 'rgba(34, 197, 94, 0.16)' }} />
                  <span style={{ color: '#4ade80', fontWeight: 600, zIndex: 1 }}>₹{fromMicro(b.priceMicro)}</span>
                  <span style={{ zIndex: 1 }}>{b.quantity} ({b.orderCount})</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>ASKS (SELLERS)</div>
              {snap.asks.map((a) => (
                <div key={a.priceMicro} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 13, marginBottom: 3 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(a.quantity / maxAskVol) * 100}%`, background: 'rgba(248, 113, 113, 0.16)' }} />
                  <span style={{ color: '#f87171', fontWeight: 600, zIndex: 1 }}>₹{fromMicro(a.priceMicro)}</span>
                  <span style={{ zIndex: 1 }}>{a.quantity} ({a.orderCount})</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Panel 2: Order Ticket + Anti-Scalping Collar Enforcement */}
        <section style={{ background: '#12121c', padding: 16, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 15, color: '#cbd5e1' }}>SUBMIT ORDER (FIFO ENGINE)</h3>
          <form onSubmit={submitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setSide('BUY')} style={{ flex: 1, padding: 8, background: side === 'BUY' ? '#16a34a' : '#1e293b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>BUY</button>
              <button type="button" onClick={() => setSide('SELL')} style={{ flex: 1, padding: 8, background: side === 'SELL' ? '#dc2626' : '#1e293b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>SELL</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setOrderType('LIMIT')} style={{ flex: 1, padding: 6, background: orderType === 'LIMIT' ? '#3b82f6' : '#1e293b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>LIMIT</button>
              <button type="button" onClick={() => setOrderType('MARKET')} style={{ flex: 1, padding: 6, background: orderType === 'MARKET' ? '#3b82f6' : '#1e293b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>MARKET</button>
            </div>
            {orderType === 'LIMIT' && (
              <label style={{ fontSize: 13 }}>
                Limit Price (₹) — Collar [1000..2400]:
                <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4, background: '#09090f', border: '1px solid #334155', color: '#fff', borderRadius: 4, boxSizing: 'border-box' }} />
              </label>
            )}
            <label style={{ fontSize: 13 }}>
              Pass Quantity:
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4, background: '#09090f', border: '1px solid #334155', color: '#fff', borderRadius: 4, boxSizing: 'border-box' }} />
            </label>
            <button type="submit" style={{ padding: 10, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>
              Execute {side} {orderType} Order
            </button>
          </form>
          {statusMsg && (
            <div style={{ marginTop: 12, padding: 10, background: '#1e1e2f', borderRadius: 4, fontSize: 12, color: '#fbbf24' }}>
              {statusMsg}
            </div>
          )}

          <hr style={{ borderColor: '#252538', margin: '16px 0' }} />
          <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#cbd5e1' }}>DUTCH AUCTION LIQUIDATION</h4>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#181826', padding: 10, borderRadius: 6 }}>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Live Decaying Price (-₹5/sec)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8' }}>₹{fromMicro(snap.dutchPriceMicro)}</div>
            </div>
            <button onClick={() => { setSide('BUY'); setOrderType('LIMIT'); setPrice(String(fromMicro(snap.dutchPriceMicro))); }} style={{ padding: '8px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
              Snap Dutch Price
            </button>
          </div>
        </section>

        {/* Panel 3: Ascended Mastery — 1,000+ OPS Swarm & Merkle Solvency */}
        <section style={{ background: '#12121c', padding: 16, borderRadius: 8, border: '1px solid #252538' }}>
          <h3 style={{ marginTop: 0, fontSize: 15, color: '#cbd5e1' }}>ASCENDED MASTERY WAR ROOM</h3>
          <button onClick={triggerSwarm} style={{ width: '100%', padding: 10, background: '#e11d48', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
            Launch 1,400 Order Swarm Burst (1,000+ OPS)
          </button>
          {swarmMetrics && (
            <div style={{ fontSize: 12, background: '#181826', padding: 10, borderRadius: 6, marginBottom: 14 }}>
              <div>Burst Orders: <strong>{swarmMetrics.ordersProcessed}</strong></div>
              <div>Matched Trades: <strong>{swarmMetrics.tradesExecuted}</strong></div>
              <div>Engine Time: <strong>{swarmMetrics.executionTimeMs} ms</strong></div>
              <div style={{ color: '#4ade80' }}>Throughput: <strong>{swarmMetrics.effectiveOps.toLocaleString()} orders/sec</strong></div>
            </div>
          )}

          <button onClick={verifySolvency} style={{ width: '100%', padding: 10, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>
            Verify Cryptographic Merkle Solvency
          </button>
          {solvencyProof && (
            <div style={{ fontSize: 11, background: '#181826', padding: 10, borderRadius: 6, marginTop: 10, wordBreak: 'break-all' }}>
              <div style={{ color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>
                SOLVENCY VERIFIED: {solvencyProof.isSolvent ? 'TRUE (100% Reserves)' : 'FALSE'}
              </div>
              <div><strong>Merkle Root:</strong> {solvencyProof.merkleRootHash.slice(0, 24)}...</div>
              <div><strong>User Leaf:</strong> {solvencyProof.leafHash?.slice(0, 24)}...</div>
              <div><strong>Total Liabilities:</strong> ₹{fromMicro(solvencyProof.totalLiabilitiesMicro).toLocaleString()}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
