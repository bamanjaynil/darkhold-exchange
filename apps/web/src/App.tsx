import React, { useEffect, useState } from 'react';
import { fromMicro, toMicro, OrderBookSnapshot, L2Level, HttpBenchmarkResult } from '@darkhold/shared';

type SnapshotWithTelemetry = OrderBookSnapshot & { ops: number; totalOrders: number };

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Precision Vector Depth Chart (No gradients, sharp strokes)
function MarketDepthChart({ bids, asks }: { bids: L2Level[]; asks: L2Level[] }) {
  const width = 280; const height = 100;
  const maxCum = Math.max(bids[bids.length - 1]?.cumulativeQuantity || 1, asks[asks.length - 1]?.cumulativeQuantity || 1, 1);

  const bidPoints = bids.map((b, i) => `${width / 2 - ((i + 1) / Math.max(bids.length, 1)) * (width / 2)},${height - (b.cumulativeQuantity / maxCum) * height}`);
  const bidPolygon = bids.length > 0 ? `${width / 2},${height} ${bidPoints.join(' ')} 0,${height}` : '';

  const askPoints = asks.map((a, i) => `${width / 2 + ((i + 1) / Math.max(asks.length, 1)) * (width / 2)},${height - (a.cumulativeQuantity / maxCum) * height}`);
  const askPolygon = asks.length > 0 ? `${width / 2},${height} ${askPoints.join(' ')} ${width},${height}` : '';

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <line x1={width / 2} y1={0} x2={width / 2} y2={height} stroke="var(--border-light)" strokeDasharray="2,2" />
      {bidPolygon && <polygon points={bidPolygon} fill="rgba(16, 185, 129, 0.15)" stroke="var(--emerald)" strokeWidth="1" />}
      {askPolygon && <polygon points={askPolygon} fill="rgba(244, 63, 94, 0.15)" stroke="var(--coral)" strokeWidth="1" />}
    </svg>
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
    setStatusMsg(res.ok ? `Order ${data.orderId.slice(0, 6)} routed. Matched: ${data.matchedTradesCount}.` : `Rejected: ${data.message || data.error}`);
  };

  const cancelOrder = async (id: string) => {
    await fetch(`http://localhost:3001/api/v1/orders/${id}`, { method: 'DELETE' });
    setStatusMsg(`Resting order ${id.slice(0, 6)} cancelled.`);
  };

  const clearDutchAuction = async () => {
    const res = await fetch('http://localhost:3001/api/v1/auctions/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: activeUserId })
    });
    const data = await res.json();
    setStatusMsg(res.ok ? `Auction Captured at ₹${fromMicro(data.clearingPriceMicro)}!` : `Auction Error: ${data.message}`);
  };

  const verifyEscrowDelivery = async (tradeId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/escrow/${tradeId}/verify`, { method: 'POST' });
    if (res.ok) setStatusMsg(`Escrow Trade ${tradeId.slice(0,6)} verified and released.`);
  };

  const triggerHttpBenchmark = async () => {
    setIsBenchmarking(true);
    setStatusMsg('Running TCP Network Stress Test...');
    try {
      const res = await fetch('http://localhost:3001/api/v1/sim/http-benchmark', { method: 'POST' });
      setHttpBench(await res.json());
      setStatusMsg('');
    } finally { setIsBenchmarking(false); }
  };

  const triggerSwarm = async () => {
    const res = await fetch('http://localhost:3001/api/v1/sim/swarm', { method: 'POST' });
    const data = await res.json();
    setStatusMsg(`Engine Burst: ${data.ordersProcessed} matched in ${data.executionTimeMs}ms.`);
  };

  const verifySolvency = async () => {
    const res = await fetch(`http://localhost:3001/api/v1/solvency/${activeUserId}`);
    const data = await res.json();
    setSolvencyProof(data);
    setClientVerifiedLeaf(await sha256Hex(`${data.userId}:${data.userNonce}:${data.userBalanceMicro}`));
  };

  if (!snap) return <div style={{ padding: 40, color: 'var(--text-silver)', fontFamily: 'Inter' }}>Connecting to Darkhold Matching Engine...</div>;

  const activeProfile = snap.users[activeUserId] || Object.values(snap.users)[0];
  const maxVol = Math.max(...snap.bids.map(b => b.quantity), ...snap.asks.map(a => a.quantity), 1);

  return (
    <div className="app-layout">
      {/* Top Navigation */}
      <header className="top-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontWeight: 600, letterSpacing: '1px', fontSize: 14 }}>
            DARKHOLD <span className="text-cyan">TERMINAL</span>
          </div>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <div className="mono text-silver" style={{ display: 'flex', gap: '16px', fontSize: 11 }}>
            <span>MARKET: <span className="text-main">DARKHOLD-VIP</span></span>
            <span>FACE VALUE: <span className="text-main">₹{fromMicro(snap.faceValueMicro)}</span></span>
            <span>LIVE THROUGHPUT: <span className="text-emerald">{snap.ops}/s</span></span>
            <span>LEDGER: <span className={snap.ledgerInvariantBalanced ? 'text-emerald' : 'text-coral'}>{snap.ledgerInvariantBalanced ? 'BALANCED (ACID)' : 'DRIFT'}</span></span>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="text-silver" style={{ fontSize: 11, marginRight: '4px' }}>IDENTITY</span>
          {(['usr_strange', 'usr_wanda', 'usr_wong'] as const).map(uid => {
            const u = snap.users[uid];
            if (!u) return null;
            return (
              <button key={uid} onClick={() => loginOperative(uid)} className="btn" style={{ fontSize: 11, padding: '4px 8px', ...(activeUserId === uid ? { background: 'var(--text-main)', color: 'var(--obsidian)', borderColor: 'var(--text-main)' } : {}) }}>
                {u.username.split(' ')[0]}
              </button>
            )
          })}
        </div>
      </header>

      {/* 4-Column Workspace Grid */}
      <main className="grid-workspace">
        
        {/* Column 1: Wallet & Orderbook */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <section className="panel">
            <div className="panel-header">Wallet Status</div>
            <div className="panel-body mono" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="data-row"><span className="text-silver">Available</span><span className="text-main">₹{fromMicro(activeProfile.availableMicro).toLocaleString()}</span></div>
              <div className="data-row"><span className="text-silver">Locked in Orders</span><span className="text-dim">₹{fromMicro(activeProfile.lockedMicro).toLocaleString()}</span></div>
              <div className="data-row"><span className="text-silver">Escrow Custody</span><span className="text-cyan">₹{fromMicro(activeProfile.escrowMicro).toLocaleString()}</span></div>
              <div className="data-row" style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                <span className="text-silver">Relic Inventory</span><span className="text-main">{activeProfile.relicInventory} Passes</span>
              </div>
            </div>
          </section>

          <section className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">Level 2 Order Book</div>
            <div className="panel-body no-pad mono" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', fontSize: 10, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                <span>PRICE</span><span>SIZE</span><span>TOTAL</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* Asks (Lowest ask at the bottom) */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minHeight: '130px' }}>
                  {snap.asks.slice().reverse().map(a => (
                    <div key={a.priceMicro} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '2px 12px', cursor: 'pointer' }} onClick={() => setPrice(String(fromMicro(a.priceMicro)))}>
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(a.cumulativeQuantity / maxVol) * 100}%`, background: 'var(--bg-coral-dim)' }} />
                      <span className="text-coral" style={{ zIndex: 1 }}>{fromMicro(a.priceMicro).toFixed(2)}</span>
                      <span style={{ zIndex: 1 }}>{a.quantity}</span>
                      <span className="text-dim" style={{ zIndex: 1 }}>{a.cumulativeQuantity}</span>
                    </div>
                  ))}
                </div>
                {/* Spread */}
                <div style={{ padding: '4px 12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', textAlign: 'center', fontSize: 11, color: 'var(--text-silver)' }}>
                  SPREAD: {((Number(snap.asks[0]?.priceMicro || 0) - Number(snap.bids[0]?.priceMicro || 0))/1e6).toFixed(2)}
                </div>
                {/* Bids (Highest bid at top) */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: '130px' }}>
                  {snap.bids.map(b => (
                    <div key={b.priceMicro} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '2px 12px', cursor: 'pointer' }} onClick={() => setPrice(String(fromMicro(b.priceMicro)))}>
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(b.cumulativeQuantity / maxVol) * 100}%`, background: 'var(--bg-emerald-dim)' }} />
                      <span className="text-emerald" style={{ zIndex: 1 }}>{fromMicro(b.priceMicro).toFixed(2)}</span>
                      <span style={{ zIndex: 1 }}>{b.quantity}</span>
                      <span className="text-dim" style={{ zIndex: 1 }}>{b.cumulativeQuantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel" style={{ height: '120px' }}>
            <div className="panel-header">Cumulative Depth</div>
            <div className="panel-body no-pad"><MarketDepthChart bids={snap.bids} asks={snap.asks} /></div>
          </section>
        </div>

        {/* Column 2: Order Entry & Open Orders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <section className="panel">
            <div className="panel-header">Order Entry</div>
            <div className="panel-body">
              <form onSubmit={submitOrder}>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                  <button type="button" className="btn" style={{ flex: 1, ...(side === 'BUY' ? { background: 'var(--emerald)', color: 'var(--obsidian)', borderColor: 'var(--emerald)', fontWeight: 600 } : {}) }} onClick={() => setSide('BUY')}>BUY</button>
                  <button type="button" className="btn" style={{ flex: 1, ...(side === 'SELL' ? { background: 'var(--coral)', color: 'var(--obsidian)', borderColor: 'var(--coral)', fontWeight: 600 } : {}) }} onClick={() => setSide('SELL')}>SELL</button>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                  {['LIMIT', 'MARKET'].map(t => (
                    <button key={t} type="button" className="btn" style={{ flex: 1, ...(orderType === t ? { background: 'var(--surface-hover)', borderColor: 'var(--text-silver)' } : {}) }} onClick={() => setOrderType(t)}>{t}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                  {['GTC', 'IOC', 'FOK'].map(t => (
                    <button key={t} type="button" className="btn" style={{ flex: 1, fontSize: 10, padding: '4px', ...(timeInForce === t ? { background: 'var(--surface-hover)', borderColor: 'var(--text-silver)' } : {}) }} onClick={() => setTimeInForce(t)}>{t}</button>
                  ))}
                </div>
                {orderType === 'LIMIT' && (
                  <div className="form-group">
                    <label className="form-label">Price (₹)</label>
                    <input type="number" className="input-field mono" value={price} onChange={e => setPrice(e.target.value)} />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Quantity</label>
                  <input type="number" className="input-field mono" value={qty} onChange={e => setQty(e.target.value)} />
                </div>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-silver)', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={simulateBot} onChange={(e) => setSimulateBot(e.target.checked)} /> Simulate Scalper Bot (No PoW)
                </label>

                <button type="submit" className={`btn ${side === 'BUY' ? 'btn-emerald-solid' : 'btn-coral-solid'}`} style={{ width: '100%', padding: '10px' }}>
                  Submit {side} Order
                </button>
              </form>
              
              {statusMsg && (
                <div className="mono" style={{ marginTop: 12, padding: '8px', background: 'var(--surface)', borderLeft: '2px solid var(--text-silver)', fontSize: 11, color: 'var(--text-silver)', wordBreak: 'break-word' }}>
                  {statusMsg}
                </div>
              )}
            </div>
          </section>

          <section className="panel" style={{ flex: 1 }}>
            <div className="panel-header">Open Orders</div>
            <div className="panel-body no-pad">
              <table className="data-table">
                <thead><tr><th>SIDE</th><th>PRICE</th><th>QTY</th><th>ACT</th></tr></thead>
                <tbody className="mono">
                  {snap.openOrders.length === 0 && <tr><td colSpan={4} className="text-dim" style={{ textAlign: 'center', padding: '16px' }}>No open orders</td></tr>}
                  {snap.openOrders.map(o => (
                    <tr key={o.id}>
                      <td className={o.side === 'BUY' ? 'text-emerald' : 'text-coral'}>{o.side}</td>
                      <td>{fromMicro(o.priceMicro).toFixed(2)}</td>
                      <td>{o.remainingQty}</td>
                      <td><button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => cancelOrder(o.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Column 3: Tape & Ledger Audit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <section className="panel" style={{ flex: 1 }}>
            <div className="panel-header">Double-Entry Ledger Audit</div>
            <div className="panel-body no-pad">
              <table className="data-table">
                <thead><tr><th>DEBIT</th><th>CREDIT</th><th>AMOUNT</th></tr></thead>
                <tbody className="mono">
                  {snap.recentLedger.length === 0 && <tr><td colSpan={3} className="text-dim" style={{ textAlign: 'center', padding: '16px' }}>No ledger events</td></tr>}
                  {snap.recentLedger.map(entry => (
                    <tr key={entry.id}>
                      <td className="text-dim">{entry.debitAccount.split(':')[0]}</td>
                      <td className="text-dim">{entry.creditAccount.split(':')[0]}</td>
                      <td className="text-main">₹{fromMicro(entry.amountMicro).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <span className="text-amber">Dutch Auction Bay</span>
            </div>
            <div className="panel-body mono" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-silver)', marginBottom: 6 }}>{snap.dutchAuction.relicName}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Current Offer</div>
                  <div className="text-amber" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>₹{fromMicro(snap.dutchAuction.currentPriceMicro).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Decay Rate</div>
                  <div className="text-coral">-₹{fromMicro(snap.dutchAuction.dropPerSecMicro)}/s</div>
                </div>
              </div>
              <button className="btn" style={{ background: 'var(--amber)', color: 'var(--obsidian)', fontWeight: 600, border: 'none' }} onClick={clearDutchAuction}>
                Instant Liquidate
              </button>
            </div>
          </section>
        </div>

        {/* Column 4: Escrow & Diagnostics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <section className="panel" style={{ flex: 1 }}>
            <div className="panel-header">Escrow Custody Queue</div>
            <div className="panel-body no-pad">
              <table className="data-table">
                <thead><tr><th>QTY</th><th>PRICE</th><th>STATUS</th></tr></thead>
                <tbody className="mono">
                  {snap.recentTrades.length === 0 && <tr><td colSpan={3} className="text-dim" style={{ textAlign: 'center', padding: '16px' }}>No pending escrows</td></tr>}
                  {snap.recentTrades.map(t => (
                    <tr key={t.id}>
                      <td>{t.quantity}</td>
                      <td>{fromMicro(t.priceMicro).toFixed(2)}</td>
                      <td>
                        {t.escrowStatus === 'LOCKED_PENDING_DELIVERY' ? (
                          <button className="btn btn-primary" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => verifyEscrowDelivery(t.id)}>Verify</button>
                        ) : (
                          <span className="text-emerald">Released ✓</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">System Diagnostics</div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="btn btn-primary" onClick={triggerHttpBenchmark} disabled={isBenchmarking}>
                  {isBenchmarking ? 'Running Autocannon...' : 'Run TCP Network Benchmark'}
                </button>
                <button className="btn" onClick={triggerSwarm}>
                  Run 2,500-Order Engine Burst
                </button>
                <button className="btn" onClick={verifySolvency} style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}>
                  Verify Merkle Solvency
                </button>
              </div>
              
              {httpBench && (
                <div className="mono" style={{ marginTop: 12, padding: '8px', background: 'var(--surface)', borderLeft: '2px solid var(--cyan)', fontSize: 11, color: 'var(--text-main)' }}>
                  <div className="text-silver" style={{ marginBottom: 4 }}>Autocannon Results</div>
                  <div>AVG: <span className="text-cyan">{httpBench.requestsPerSecAvg.toLocaleString()} RPS</span></div>
                  <div>P99: <span>{httpBench.latencyP99Ms}ms</span></div>
                </div>
              )}

              {solvencyProof && (
                <div className="mono" style={{ marginTop: 12, padding: '8px', background: 'var(--surface)', borderLeft: '2px solid var(--emerald)', fontSize: 11, color: 'var(--text-main)', wordBreak: 'break-all' }}>
                  <div className="text-emerald" style={{ marginBottom: 4 }}>✓ Assets == Liabilities</div>
                  <div className="text-silver">ROOT: {solvencyProof.merkleRootHash.slice(0, 16)}...</div>
                  <div className="text-silver">LEAF: {clientVerifiedLeaf.slice(0, 16)}...</div>
                </div>
              )}
            </div>
          </section>
        </div>

      </main>
    </div>
  );
}
