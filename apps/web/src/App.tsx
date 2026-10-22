import React, { useEffect, useState } from 'react';
import { fromMicro, toMicro, OrderBookSnapshot, L2Level, HttpBenchmarkResult } from '@darkhold/shared';

type SnapshotWithTelemetry = OrderBookSnapshot & { ops: number; totalOrders: number };

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Clean Minimalist SVG Depth Chart
function MarketDepthChart({ bids, asks }: { bids: L2Level[]; asks: L2Level[] }) {
  const width = 420; const height = 120;
  const maxCum = Math.max(bids[bids.length - 1]?.cumulativeQuantity || 1, asks[asks.length - 1]?.cumulativeQuantity || 1, 1);

  const bidPoints = bids.map((b, i) => `${width / 2 - ((i + 1) / Math.max(bids.length, 1)) * (width / 2 - 10)},${height - (b.cumulativeQuantity / maxCum) * (height - 20) - 5}`);
  const bidPolygon = bids.length > 0 ? `${width / 2},${height - 5} ${bidPoints.join(' ')} 10,${height - 5}` : '';

  const askPoints = asks.map((a, i) => `${width / 2 + ((i + 1) / Math.max(asks.length, 1)) * (width / 2 - 10)},${height - (a.cumulativeQuantity / maxCum) * (height - 20) - 5}`);
  const askPolygon = asks.length > 0 ? `${width / 2},${height - 5} ${askPoints.join(' ')} ${width - 10},${height - 5}` : '';

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>
        <span style={{ color: '#00e5ff' }}>BID DEPTH</span>
        <span>SPREAD</span>
        <span style={{ color: '#ff2a70' }}>ASK DEPTH</span>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={width / 2} y1={0} x2={width / 2} y2={height} stroke="rgba(255,255,255,0.1)" strokeDasharray="2,2" />
        {bidPolygon && <polygon points={bidPolygon} fill="rgba(0, 229, 255, 0.15)" stroke="#00e5ff" strokeWidth="1.5" />}
        {askPolygon && <polygon points={askPolygon} fill="rgba(255, 42, 112, 0.15)" stroke="#ff2a70" strokeWidth="1.5" />}
      </svg>
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<SnapshotWithTelemetry | null>(null);
  const [activeUserId, setActiveUserId] = useState<string>('usr_strange');
  const [jwtToken, setJwtToken] = useState<string>('');
  
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [timeInForce, setTimeInForce] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [price, setPrice] = useState('2040');
  const [qty, setQty] = useState('3');
  const [simulateBot, setSimulateBot] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const [solvencyProof, setSolvencyProof] = useState<any>(null);
  const [clientVerifiedLeaf, setClientVerifiedLeaf] = useState<string>('');
  const [httpBench, setHttpBench] = useState<HttpBenchmarkResult | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  const loginOperative = async (userId: string, username?: string, archetype?: string) => {
    const res = await fetch('http://localhost:3001/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username, archetype })
    });
    const data = await res.json();
    if (res.ok) {
      setActiveUserId(data.profile.userId);
      setJwtToken(data.token);
    }
  };

  useEffect(() => {
    loginOperative('usr_strange');
    const ws = new WebSocket('ws://localhost:3001/ws/market');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'L2_SNAPSHOT') setSnap(msg.data);
    };
    return () => ws.close();
  }, []);

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('http://localhost:3001/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}) },
      body: JSON.stringify({
        marketId: 'mkt_darkhold_vip', side, type: orderType, timeInForce,
        priceMicro: toMicro(Number(price)).toString(), quantity: Number(qty),
        powNonce: `0000_pow_${Date.now()}`, simulateScalperBot: simulateBot
      })
    });
    const data = await res.json();
    setStatusMsg(res.ok ? `✓ ORDER EXECUTED | ${data.matchedTradesCount} matches locked in Escrow.` : `✕ BLOCKED: ${data.message || data.error}`);
  };

  const cancelOrder = async (id: string) => {
    await fetch(`http://localhost:3001/api/v1/orders/${id}`, { method: 'DELETE' });
    setStatusMsg(`✓ Order cancelled, funds unlocked.`);
  };

  const triggerHttpBenchmark = async () => {
    setIsBenchmarking(true);
    setStatusMsg('Initiating Autocannon TCP Stress Test...');
    try {
      const res = await fetch('http://localhost:3001/api/v1/sim/http-benchmark', { method: 'POST' });
      setHttpBench(await res.json());
      setStatusMsg('');
    } finally { setIsBenchmarking(false); }
  };

  const verifySolvency = async () => {
    const res = await fetch(`http://localhost:3001/api/v1/solvency/${activeUserId}`);
    const data = await res.json();
    setSolvencyProof(data);
    setClientVerifiedLeaf(await sha256Hex(`${data.userId}:${data.userNonce}:${data.userBalanceMicro}`));
  };

  if (!snap) return <div style={{ padding: 40, color: '#00e5ff' }}>CONNECTING TO EXCHANGE NODE...</div>;

  const activeProfile = snap.users[activeUserId] || Object.values(snap.users)[0];
  const maxBidVol = Math.max(...snap.bids.map((b) => b.quantity), 1);
  const maxAskVol = Math.max(...snap.asks.map((a) => a.quantity), 1);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* Sleek Minimalist Header */}
      <header className="glass-panel" style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="jp-text" style={{ fontSize: 24, color: '#fff', letterSpacing: 2 }}>DARKHOLD <span style={{ color: '#00e5ff' }}>取引所</span></div>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
          <div className="mono" style={{ fontSize: 12, color: '#64748b' }}>HFT SECONDARY MARKET</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="mono" style={{ fontSize: 11, display: 'flex', gap: 16, marginRight: 16 }}>
            <div>FACE VALUE: <span style={{ color: '#fff' }}>₹{fromMicro(snap.faceValueMicro)}</span></div>
            <div>OPS: <span style={{ color: '#00e5ff' }}>{snap.ops}/s</span></div>
            <div>LEDGER: <span style={{ color: snap.ledgerInvariantBalanced ? '#00e5ff' : '#ff2a70' }}>{snap.ledgerInvariantBalanced ? 'BALANCED' : 'DRIFT'}</span></div>
          </div>
          {(['usr_strange', 'usr_wanda'] as const).map((uid) => {
            const u = snap.users[uid];
            if (!u) return null;
            return (
              <button
                key={uid} onClick={() => loginOperative(uid)}
                className="btn-sharp"
                style={{
                  padding: '6px 12px', fontSize: 11,
                  background: activeUserId === uid ? '#fff' : 'transparent',
                  color: activeUserId === uid ? '#000' : '#fff',
                  border: '1px solid rgba(255,255,255,0.2)'
                }}
              >
                {u.username.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </header>

      {/* Active User Wallet Bar */}
      {activeProfile && (
        <div className="mono" style={{ marginBottom: 24, display: 'flex', gap: 32, fontSize: 12, color: '#94a3b8' }}>
          <div>IDENTITY: <span style={{ color: '#fff' }}>{activeProfile.username}</span></div>
          <div>AVAILABLE: <span style={{ color: '#00e5ff' }}>₹{fromMicro(activeProfile.availableMicro).toLocaleString()}</span></div>
          <div>ESCROW: <span style={{ color: '#fff' }}>₹{fromMicro(activeProfile.escrowMicro).toLocaleString()}</span></div>
          <div>INVENTORY: <span style={{ color: '#fff' }}>{activeProfile.relicInventory} PASSES</span></div>
        </div>
      )}

      {/* 3-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr', gap: 24 }}>
        
        {/* Panel 1: Order Book & Depth */}
        <section className="glass-panel" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 16 }}>L2 ORDER BOOK</div>
          <div className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              {snap.bids.map((b) => (
                <div key={b.priceMicro} onClick={() => setPrice(String(fromMicro(b.priceMicro)))} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(b.quantity / maxBidVol) * 100}%`, background: 'rgba(0, 229, 255, 0.1)' }} />
                  <span style={{ color: '#00e5ff', zIndex: 1 }}>₹{fromMicro(b.priceMicro)}</span>
                  <span style={{ color: '#fff', zIndex: 1 }}>{b.quantity}</span>
                </div>
              ))}
            </div>
            <div>
              {snap.asks.map((a) => (
                <div key={a.priceMicro} onClick={() => setPrice(String(fromMicro(a.priceMicro)))} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, cursor: 'pointer' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(a.quantity / maxAskVol) * 100}%`, background: 'rgba(255, 42, 112, 0.1)' }} />
                  <span style={{ color: '#ff2a70', zIndex: 1 }}>₹{fromMicro(a.priceMicro)}</span>
                  <span style={{ color: '#fff', zIndex: 1 }}>{a.quantity}</span>
                </div>
              ))}
            </div>
          </div>
          <MarketDepthChart bids={snap.bids} asks={snap.asks} />
        </section>

        {/* Panel 2: Execution & Dutch Auction */}
        <section className="glass-panel" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 16 }}>ORDER DISPATCH</div>
          <form onSubmit={submitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setSide('BUY')} className="btn-sharp" style={{ flex: 1, padding: 10, background: side === 'BUY' ? '#00e5ff' : 'rgba(255,255,255,0.05)', color: side === 'BUY' ? '#000' : '#fff', border: 'none' }}>BUY</button>
              <button type="button" onClick={() => setSide('SELL')} className="btn-sharp" style={{ flex: 1, padding: 10, background: side === 'SELL' ? '#ff2a70' : 'rgba(255,255,255,0.05)', color: side === 'SELL' ? '#fff' : '#fff', border: 'none' }}>SELL</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['LIMIT', 'MARKET'] as const).map(t => (
                <button key={t} type="button" onClick={() => setOrderType(t)} className="btn-sharp" style={{ flex: 1, padding: 8, fontSize: 11, background: orderType === t ? '#fff' : 'transparent', color: orderType === t ? '#000' : '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>{t}</button>
              ))}
            </div>
            
            <div className="mono" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (₹)" style={{ flex: 2, padding: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" style={{ flex: 1, padding: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b', cursor: 'pointer', marginTop: 8 }}>
              <input type="checkbox" checked={simulateBot} onChange={(e) => setSimulateBot(e.target.checked)} />
              Simulate Scalper (Omit PoW)
            </label>

            <button type="submit" className="btn-sharp" style={{ padding: 12, marginTop: 8, background: '#fff', color: '#000', border: 'none' }}>
              EXECUTE
            </button>
          </form>

          {statusMsg && <div className="mono" style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.05)', fontSize: 11, color: '#fff' }}>{statusMsg}</div>}
        </section>

        {/* Panel 3: Diagnostics & Ledger */}
        <section className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>SYSTEM DIAGNOSTICS</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={triggerHttpBenchmark} disabled={isBenchmarking} className="btn-sharp" style={{ flex: 1, padding: 10, background: 'rgba(255, 42, 112, 0.1)', color: '#ff2a70', border: '1px solid #ff2a70', fontSize: 11 }}>
                {isBenchmarking ? 'RUNNING...' : 'NETWORK STRESS TEST'}
              </button>
              <button onClick={verifySolvency} className="btn-sharp" style={{ flex: 1, padding: 10, background: 'rgba(0, 229, 255, 0.1)', color: '#00e5ff', border: '1px solid #00e5ff', fontSize: 11 }}>
                VERIFY SOLVENCY
              </button>
            </div>
            
            {httpBench && (
              <div className="mono" style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.3)', borderLeft: '2px solid #ff2a70', fontSize: 11, color: '#fff' }}>
                <div style={{ color: '#64748b', marginBottom: 4 }}>AUTOCANNON RESULTS</div>
                <div>AVG: <span style={{ color: '#00e5ff' }}>{httpBench.requestsPerSecAvg.toLocaleString()} RPS</span></div>
                <div>P99: <span>{httpBench.latencyP99Ms}ms</span></div>
              </div>
            )}

            {solvencyProof && (
              <div className="mono" style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.3)', borderLeft: '2px solid #00e5ff', fontSize: 11, color: '#fff', wordBreak: 'break-all' }}>
                <div style={{ color: '#00e5ff', marginBottom: 4 }}>✓ ASSETS == LIABILITIES</div>
                <div style={{ color: '#64748b' }}>ROOT: {solvencyProof.merkleRootHash.slice(0, 20)}...</div>
                <div style={{ color: '#64748b' }}>LEAF: {clientVerifiedLeaf.slice(0, 20)}...</div>
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>DOUBLE-ENTRY AUDIT</div>
            <div className="mono" style={{ flex: 1, overflowY: 'auto', maxHeight: 150, fontSize: 10 }}>
              {snap.recentLedger.map((entry) => (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span><span style={{ color: '#ff2a70' }}>DR</span> {entry.debitAccount.split(':')[0]} <span style={{ color: '#64748b' }}>→</span> <span style={{ color: '#00e5ff' }}>CR</span> {entry.creditAccount.split(':')[0]}</span>
                  <span style={{ color: '#fff' }}>₹{fromMicro(entry.amountMicro).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
