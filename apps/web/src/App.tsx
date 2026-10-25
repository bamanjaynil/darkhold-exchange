/**
 * @file App.tsx
 * The Darkhold Exchange Institutional Terminal UI.
 * Single-page reactive application connecting to Fastify REST & WebSocket gateway.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  formatDKC,
  toMinorUnits,
  calculateCollarCeiling,
  verifyMerkleSumProof,
  SolvencyInclusionProof,
} from '@darkhold/shared';

type Instrument = {
  id: string;
  symbol: string;
  name: string;
  faceValue: number;
  collarBps: number;
  tickSize: number;
  minQty: number;
  maxQtyPerOrder: number;
  escrowRequired: boolean;
};

type BookLevel = { price: number; qty: number; orders: number; total: number };
type TradeItem = { id: string; price: number; qty: number; created_at: string; is_simulated: boolean };
type OpenOrder = { id: string; client_order_id: string; side: 'BUY' | 'SELL'; type: string; price: number; qty: number; remaining_qty: number; symbol: string };

export default function App() {
  const [user, setUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [balance, setBalance] = useState({ available: 0, reserved: 0, escrow: 0, total: 0 });
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('FEST-GA');
  const [bids, setBids] = useState<BookLevel[]>([]);
  const [asks, setAsks] = useState<BookLevel[]>([]);
  const [spread, setSpread] = useState<number | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [myOrders, setMyOrders] = useState<OpenOrder[]>([]);
  const [holdings, setHoldings] = useState<Array<{ symbol: string; available: number; reserved: number; escrow: number }>>([]);
  const [activeTab, setActiveTab] = useState<'trade' | 'auctions' | 'escrows' | 'solvency' | 'diagnostics'>('trade');
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Order Form State
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [tif, setTif] = useState<'GTC' | 'IOC' | 'FOK'>('GTC');
  const [priceInput, setPriceInput] = useState<string>('1500');
  const [qtyInput, setQtyInput] = useState<string>('1');
  const [orderSubmitting, setOrderSubmitting] = useState<boolean>(false);
  const [orderMessage, setOrderMessage] = useState<{ text: string; error: boolean } | null>(null);

  // Dutch Auctions State
  const [auctions, setAuctions] = useState<any[]>([]);
  // Escrow State
  const [escrows, setEscrows] = useState<any[]>([]);
  // Solvency State
  const [solvencyProof, setSolvencyProof] = useState<SolvencyInclusionProof | null>(null);
  const [solvencyChecks, setSolvencyChecks] = useState<{ check1: boolean | null; check2: boolean | null; check3: boolean | null }>({
    check1: null,
    check2: null,
    check3: null,
  });
  // Diagnostics
  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagRunning, setDiagRunning] = useState<boolean>(false);

  // Logout state
  const [logoutLoading, setLogoutLoading] = useState<boolean>(false);

  // Auction Creation Modal State
  const [showCreateAuctionModal, setShowCreateAuctionModal] = useState<boolean>(false);
  const [auctionSymbol, setAuctionSymbol] = useState<string>('FEST-GA');
  const [auctionQty, setAuctionQty] = useState<number>(1);
  const [auctionStartPrice, setAuctionStartPrice] = useState<number>(2000);
  const [auctionFloorPrice, setAuctionFloorPrice] = useState<number>(1000);
  const [auctionDurationSec, setAuctionDurationSec] = useState<number>(300);
  const [auctionSubmitting, setAuctionSubmitting] = useState<boolean>(false);

  // Auth Dialog State
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState<string>('alice');
  const [authPassword, setAuthPassword] = useState<string>('demo_darkhold_2026');
  const [authError, setAuthError] = useState<string>('');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const authAbortRef = useRef<AbortController | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const selectedInstrument = instruments.find((i) => i.symbol === selectedSymbol) || instruments[0];
  const collarCeiling = selectedInstrument
    ? calculateCollarCeiling(selectedInstrument.faceValue, selectedInstrument.collarBps)
    : 0;

  // 1. Initial Load & Session Fetch
  useEffect(() => {
    fetchSession();
    fetchInstruments();
  }, []);

  const fetchSession = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/auth/me', { credentials: 'include', signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setBalance(data.balance);
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
        void fetchHoldings();
      } else if (res.status === 401) {
        setUser(null);
        setHoldings([]);
      }
    } catch {
      // Don't wipe user state on transient connection error
    }
  };

  const fetchHoldings = async () => {
    try {
      const res = await fetch('/api/wallet/holdings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHoldings(data);
      }
    } catch {
      // Silent error handling
    }
  };

  const fetchInstruments = async () => {
    try {
      const res = await fetch('/api/instruments');
      if (res.ok) {
        const list = await res.json();
        setInstruments(list);
        if (list.length > 0 && !selectedSymbol) setSelectedSymbol(list[0].symbol);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 2. WebSocket Connection with auto-reconnect
  useEffect(() => {
    let unmounted = false;
    let retryTimer: any = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (unmounted) {
          socket?.close();
          return;
        }
        setWsConnected(true);
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ v: 1, type: 'subscribe', channel: `book:${selectedSymbol}` }));
          socket.send(JSON.stringify({ v: 1, type: 'subscribe', channel: `trades:${selectedSymbol}` }));
          if (user) {
            socket.send(JSON.stringify({ v: 1, type: 'subscribe', channel: 'me' }));
          }
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!unmounted) {
          retryTimer = setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        setWsConnected(false);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'snapshot' || msg.type === 'delta') {
            if (msg.channel === `book:${selectedSymbol}`) {
              setBids(msg.data.bids || []);
              setAsks(msg.data.asks || []);
              setSpread(msg.data.spread);
            } else if (msg.channel === `trades:${selectedSymbol}`) {
              setTrades((prev) => [msg.data, ...prev.slice(0, 49)]);
            } else if (msg.channel === 'me') {
              if (msg.data.balance) setBalance(msg.data.balance);
            }
          }
        } catch (err) {
          console.error(err);
        }
      };

      wsRef.current = socket;
    };

    connect();

    return () => {
      unmounted = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            try { socket?.close(); } catch {}
          };
        }
      }
    };
  }, [selectedSymbol, user?.id]);

  // Refresh book and trades on symbol change
  useEffect(() => {
    if (!selectedSymbol) return;
    fetch(`/api/book/${selectedSymbol}`).then((r) => {
      if (r.ok) r.json().then((d) => {
        setBids(d.bids || []);
        setAsks(d.asks || []);
        setSpread(d.spread);
      });
    });
    fetch(`/api/trades/${selectedSymbol}`).then((r) => {
      if (r.ok) r.json().then(setTrades);
    });
    if (user) {
      fetch('/api/orders/my', { credentials: 'include' }).then((r) => {
        if (r.ok) r.json().then(setMyOrders);
      });
    }
  }, [selectedSymbol, user?.id]);

  // 3. Order Placement with Web Worker PoW
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    setOrderSubmitting(true);
    setOrderMessage(null);

    try {
      const priceMinor = orderType === 'LIMIT' ? toMinorUnits(parseFloat(priceInput)) : undefined;
      const qty = parseInt(qtyInput, 10);

      // Client pre-validation
      if (orderType === 'LIMIT' && priceMinor && priceMinor > collarCeiling) {
        setOrderMessage({ text: `Price exceeds anti-scalping collar ceiling of ${formatDKC(collarCeiling)}`, error: true });
        setOrderSubmitting(false);
        return;
      }

      // Fetch PoW challenge
      const chalRes = await fetch('/api/pow/challenge');
      if (!chalRes.ok) {
        throw new Error('Failed to obtain PoW challenge from server');
      }
      const challenge = await chalRes.json();

      // Solve in Web Worker
      const worker = new Worker(new URL('./pow-worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = (we) => {
        worker.terminate();
        setOrderSubmitting(false);
        setOrderMessage({ text: 'PoW Worker error: ' + (we.message || 'Worker failure'), error: true });
      };

      worker.postMessage({ seed: challenge.seed, difficultyBits: challenge.difficultyBits });

      worker.onmessage = async (we) => {
        const { nonce } = we.data;
        worker.terminate();

        try {
          const orderPayload = {
            clientOrderId: `web_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            symbol: selectedSymbol,
            side,
            type: orderType,
            tif,
            price: priceMinor,
            qty,
            pow: { challengeId: challenge.challengeId, nonce },
          };

          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            credentials: 'include',
            body: JSON.stringify(orderPayload),
          });

          const result = await res.json().catch(() => ({}));

          if (!res.ok) {
            setOrderMessage({ text: `Rejected: ${result.error || 'Submission failed'}`, error: true });
          } else {
            setOrderMessage({
              text: `Order ${result.status}: ${result.trades?.length || 0} fill(s)`,
              error: false,
            });
            fetchSession();
            fetch('/api/orders/my', { credentials: 'include' }).then((r) => {
              if (r.ok) r.json().then(setMyOrders);
            });
          }
        } catch (postErr: any) {
          setOrderMessage({ text: postErr.message || 'Error communicating with exchange', error: true });
        } finally {
          setOrderSubmitting(false);
        }
      };
    } catch (err: any) {
      setOrderSubmitting(false);
      setOrderMessage({ text: err.message || 'Error submitting order', error: true });
    }
  };

  const handleCancelOrder = async (orderId: string, symbol?: string) => {
    try {
      const targetSymbol = symbol || selectedSymbol;
      const res = await fetch(`/api/orders/${orderId}?symbol=${targetSymbol}`, {
        method: 'DELETE',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        credentials: 'include',
      });
      if (res.ok) {
        setMyOrders((prev) => prev.filter((o) => o.id !== orderId));
        fetchSession();
        fetchHoldings();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Order cancellation failed: ${err.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Cancellation network error: ${err.message || 'Failed'}`);
    }
  };

  const cancelAuthRequest = () => {
    if (authAbortRef.current) {
      authAbortRef.current.abort();
      authAbortRef.current = null;
    }
    setAuthLoading(false);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authLoading) return; // Prevent duplicate submissions while in-flight
    setAuthError('');
    setAuthLoading(true);

    if (authAbortRef.current) {
      authAbortRef.current.abort();
    }
    const controller = new AbortController();
    authAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      clearTimeout(timeoutId);

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => '');
        data = { error: text || `HTTP ${res.status}: ${res.statusText}` };
      }

      if (!res.ok) {
        if (res.status >= 500) {
          setAuthError(`Exchange API error (${res.status}): Backend service is unavailable or timed out. Please ensure the backend server is running.`);
        } else {
          setAuthError(data.error || `Authentication failed (${res.status})`);
        }
      } else {
        setUser(data.user);
        if (data.balance) {
          setBalance(data.balance);
        }
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
        setShowAuthModal(false);
        await fetchSession();
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAuthError('Connection timed out: The exchange backend is not responding at http://127.0.0.1:3000. Please check if the server is running.');
      } else {
        setAuthError(err.message || 'Network error connecting to exchange backend');
      }
    } finally {
      clearTimeout(timeoutId);
      setAuthLoading(false);
      authAbortRef.current = null;
    }
  };

  const handleLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        credentials: 'include',
        signal: controller.signal,
      }).catch(() => {});
      clearTimeout(timeoutId);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      document.cookie = 'dk_csrf=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      setUser(null);
      setCsrfToken('');
      setBalance({ available: 0, reserved: 0, escrow: 0, total: 0 });
      setHoldings([]);
      setMyOrders([]);
      setSolvencyProof(null);
      setSolvencyChecks({ check1: null, check2: null, check3: null });
      setEscrows([]);
      setDiagResult(null);
      setOrderMessage(null);
      setActiveTab('trade');
      setLogoutLoading(false);
    }
  };

  const handleCreateAuction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setAuctionSubmitting(true);
    try {
      const startPriceMinor = toMinorUnits(auctionStartPrice);
      const floorPriceMinor = toMinorUnits(auctionFloorPrice);
      const stepAmountMinor = Math.max(100, Math.floor((startPriceMinor - floorPriceMinor) / 20));
      const res = await fetch('/api/auctions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          symbol: auctionSymbol,
          qty: Number(auctionQty),
          startPrice: startPriceMinor,
          floorPrice: floorPriceMinor,
          stepAmount: stepAmountMinor,
          stepIntervalMs: 2000,
          durationSec: Number(auctionDurationSec),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert('Dutch Auction created successfully!');
        setShowCreateAuctionModal(false);
        fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); });
        fetchSession();
      } else {
        alert(`Auction creation failed: ${data.error || 'Server rejected request'}`);
      }
    } catch (err: any) {
      alert(`Network error creating auction: ${err.message || 'Error'}`);
    } finally {
      setAuctionSubmitting(false);
    }
  };

  // Proof of Solvency Verification
  const runSolvencyVerification = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    try {
      const proofRes = await fetch('/api/solvency/proof', { credentials: 'include' });
      if (!proofRes.ok) {
        const err = await proofRes.json().catch(() => ({}));
        alert(`Solvency Proof: ${err.error || 'No liabilities recorded for current account'}`);
        return;
      }
      const proof: SolvencyInclusionProof = await proofRes.json();
      setSolvencyProof(proof);

      // Check 1: In-browser Merkle Proof Verification against root
      const verification = verifyMerkleSumProof(proof);
      const c1 = verification.valid;

      // Check 2: Verify Root sum equals liabilities
      const c2 = verification.calculatedTotal === proof.expectedTotal;

      // Check 3: Check ledger reconciliation (via public /api/solvency/status)
      const recRes = await fetch('/api/solvency/status');
      let c3 = false;
      if (recRes.ok) {
        const recData = await recRes.json();
        c3 = recData.balanced;
      }

      setSolvencyChecks({ check1: c1, check2: c2, check3: c3 });
    } catch (e: any) {
      console.error(e);
      alert('Error verifying proof of solvency: ' + (e.message || 'Network error'));
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <header className="navbar">
        <div className="brand">
          <span style={{ color: 'var(--amber-accent)' }}>⚡ DARKHOLD</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>EXCHANGE TERMINAL</span>
          <span className="badge badge-mode">OFFLINE DEMO</span>
          <span className={`badge ${wsConnected ? 'badge-ws-connected' : 'badge-ws-disconnected'}`}>
            {wsConnected ? 'LIVE FEED (20 FPS)' : 'FEED OFFLINE'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="mono" style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>USER:</span> <strong>{user.username}</strong> ({user.role})
              </span>
              <button
                onClick={handleLogout}
                disabled={logoutLoading}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: logoutLoading ? 'var(--text-muted)' : 'var(--amber-accent)',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: logoutLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {logoutLoading ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => setShowAuthModal(true)} style={{ cursor: 'pointer' }}>
              Login / Demo Accounts
            </button>
          )}
        </div>
      </header>

      {/* Instrument Bar & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0e131d', borderBottom: '1px solid var(--border-color)', padding: '6px 20px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>INSTRUMENT:</span>
          {instruments.map((inst) => (
            <button
              key={inst.symbol}
              onClick={() => {
                setSelectedSymbol(inst.symbol);
                setPriceInput((inst.faceValue / 100).toString());
                setOrderMessage(null);
              }}
              style={{
                background: selectedSymbol === inst.symbol ? '#1e293b' : 'transparent',
                border: '1px solid',
                borderColor: selectedSymbol === inst.symbol ? 'var(--amber-accent)' : 'transparent',
                color: selectedSymbol === inst.symbol ? '#fff' : 'var(--text-muted)',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {inst.symbol} {inst.escrowRequired && '🔒'}
            </button>
          ))}
        </div>

        <div className="nav-tabs" style={{ border: 'none', background: 'transparent' }}>
          <button className={`nav-tab ${activeTab === 'trade' ? 'active' : ''}`} onClick={() => setActiveTab('trade')}>Trading Ladder</button>
          <button className={`nav-tab ${activeTab === 'auctions' ? 'active' : ''}`} onClick={() => { setActiveTab('auctions'); fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); }); }}>Dutch Auctions</button>
          <button className={`nav-tab ${activeTab === 'escrows' ? 'active' : ''}`} onClick={() => { setActiveTab('escrows'); fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); }); }}>Escrow Custody</button>
          <button className={`nav-tab ${activeTab === 'solvency' ? 'active' : ''}`} onClick={() => { setActiveTab('solvency'); runSolvencyVerification(); }}>Proof of Solvency</button>
          <button className={`nav-tab ${activeTab === 'diagnostics' ? 'active' : ''}`} onClick={() => setActiveTab('diagnostics')}>Diagnostics & Benchmarks</button>
        </div>
      </div>

      {/* Main Grid View */}
      {activeTab === 'trade' && (
        <div className="grid-main">
          {/* Col 1: Order Placement & Balances */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Wallet Balance Card */}
            <div className="card">
              <div className="card-header">
                <span>WALLET (DKC)</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Darkhold Credits</span>
              </div>
              <div className="card-body mono" style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Available:</span>
                  <strong style={{ color: 'var(--green-bid)' }}>{formatDKC(balance.available)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Reserved:</span>
                  <span style={{ color: 'var(--amber-accent)' }}>{formatDKC(balance.reserved)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>In Escrow:</span>
                  <span style={{ color: 'var(--cyan-accent)' }}>{formatDKC(balance.escrow)}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Total:</span>
                  <span>{formatDKC(balance.total)}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>TICKETS & RELICS INVENTORY:</div>
                  {holdings.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No inventory holdings</div>
                  ) : (
                    holdings.map((h) => (
                      <div key={h.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span>{h.symbol}:</span>
                        <span><strong>{h.available}</strong> avail{h.reserved > 0 ? ` (${h.reserved} rsv)` : ''}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Order Placement Card */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <span>ORDER PLACEMENT</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--amber-accent)' }}>
                  CAP: {formatDKC(collarCeiling)}
                </span>
              </div>
              <div className="card-body">
                <form onSubmit={handleSubmitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setSide('BUY')}
                      style={{
                        padding: 8,
                        borderRadius: 4,
                        fontWeight: 700,
                        border: 'none',
                        background: side === 'BUY' ? 'var(--green-bid)' : '#1e293b',
                        color: side === 'BUY' ? '#000' : 'var(--text-muted)',
                      }}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => setSide('SELL')}
                      style={{
                        padding: 8,
                        borderRadius: 4,
                        fontWeight: 700,
                        border: 'none',
                        background: side === 'SELL' ? 'var(--red-ask)' : '#1e293b',
                        color: side === 'SELL' ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      SELL
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>TYPE</label>
                      <select
                        value={orderType}
                        onChange={(e) => {
                          const nextType = e.target.value as any;
                          setOrderType(nextType);
                          if (nextType === 'MARKET' && tif === 'GTC') {
                            setTif('IOC');
                          }
                        }}
                        style={{ width: '100%', marginTop: 2 }}
                      >
                        <option value="LIMIT">LIMIT</option>
                        <option value="MARKET">MARKET</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>TIF</label>
                      <select value={tif} onChange={(e) => setTif(e.target.value as any)} style={{ width: '100%', marginTop: 2 }}>
                        {orderType === 'LIMIT' && <option value="GTC">GTC</option>}
                        <option value="IOC">IOC</option>
                        <option value="FOK">FOK</option>
                      </select>
                    </div>
                  </div>

                  {orderType === 'LIMIT' && (
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>PRICE (DKC)</label>
                      <input
                        type="number"
                        step="1"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        style={{ width: '100%', marginTop: 2 }}
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>QUANTITY (UNITS)</label>
                    <input
                      type="number"
                      min="1"
                      max={selectedInstrument?.maxQtyPerOrder || 10}
                      value={qtyInput}
                      onChange={(e) => setQtyInput(e.target.value)}
                      style={{ width: '100%', marginTop: 2 }}
                      required
                    />
                  </div>

                  {orderMessage && (
                    <div style={{ padding: 8, borderRadius: 4, fontSize: 12, background: orderMessage.error ? 'var(--red-bg)' : 'var(--green-bg)', color: orderMessage.error ? 'var(--red-ask)' : 'var(--green-bid)' }}>
                      {orderMessage.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    className={side === 'BUY' ? 'btn-buy' : 'btn-sell'}
                    disabled={orderSubmitting}
                  >
                    {orderSubmitting ? 'Computing PoW...' : `${side} ${selectedSymbol}`}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Col 2: Level 2 Order Book & SVG Depth Chart */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* SVG Cumulative Depth Chart */}
            <div className="card" style={{ height: 180 }}>
              <div className="card-header">
                <span>CUMULATIVE MARKET DEPTH</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>L2 LIQUIDITY</span>
              </div>
              <div className="card-body" style={{ padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="100%" height="100%" viewBox="0 0 500 130" preserveAspectRatio="none">
                  {/* Bids Green Area */}
                  {bids.length > 0 && (
                    <polygon
                      points={`0,130 ${bids.map((b, i) => `${(i / bids.length) * 240},${130 - (b.total / (bids[bids.length - 1]?.total || 1)) * 100}`).join(' ')} 240,130`}
                      fill="rgba(16, 185, 129, 0.2)"
                      stroke="var(--green-bid)"
                      strokeWidth="2"
                    />
                  )}
                  {/* Asks Red Area */}
                  {asks.length > 0 && (
                    <polygon
                      points={`260,130 ${asks.map((a, i) => `${260 + (i / asks.length) * 240},${130 - (a.total / (asks[asks.length - 1]?.total || 1)) * 100}`).join(' ')} 500,130`}
                      fill="rgba(239, 68, 68, 0.2)"
                      stroke="var(--red-ask)"
                      strokeWidth="2"
                    />
                  )}
                  <line x1="250" y1="0" x2="250" y2="130" stroke="var(--border-color)" strokeDasharray="4" />
                </svg>
              </div>
            </div>

            {/* Level 2 Book Ladder */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <span>LEVEL 2 ORDER BOOK LADDER</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--amber-accent)' }}>
                  SPREAD: {spread !== null ? formatDKC(spread) : 'NONE'}
                </span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <table className="ladder-table mono">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                      <th>PRICE (DKC)</th>
                      <th>SIZE</th>
                      <th>ORDERS</th>
                      <th>CUMULATIVE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Asks (descending) */}
                    {asks.slice(0, 8).reverse().map((a) => (
                      <tr key={`ask-${a.price}`} className="ask-row">
                        <td>{formatDKC(a.price)}</td>
                        <td>{a.qty}</td>
                        <td>{a.orders}</td>
                        <td>{a.total}</td>
                      </tr>
                    ))}
                    {/* Spread indicator */}
                    <tr>
                      <td colSpan={4} className="spread-row mono">
                        --- SPREAD: {spread !== null ? formatDKC(spread) : 'NO CROSS'} ---
                      </td>
                    </tr>
                    {/* Bids (descending) */}
                    {bids.slice(0, 8).map((b) => (
                      <tr key={`bid-${b.price}`} className="bid-row">
                        <td>{formatDKC(b.price)}</td>
                        <td>{b.qty}</td>
                        <td>{b.orders}</td>
                        <td>{b.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Col 3: My Open Orders & Recent Trades */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Open Orders */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <span>MY OPEN ORDERS</span>
                <span className="badge">{myOrders.length} OPEN</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {myOrders.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No resting orders in book
                  </div>
                ) : (
                  <table className="ladder-table mono">
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                        <th>SYMBOL</th>
                        <th>SIDE</th>
                        <th>PRICE</th>
                        <th>QTY</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myOrders.map((o) => (
                        <tr key={o.id}>
                          <td><strong>{o.symbol}</strong></td>
                          <td style={{ color: o.side === 'BUY' ? 'var(--green-bid)' : 'var(--red-ask)' }}>{o.side}</td>
                          <td>{formatDKC(Number(o.price))}</td>
                          <td>{o.remaining_qty}</td>
                          <td>
                            <button
                              onClick={() => handleCancelOrder(o.id, o.symbol)}
                              style={{ background: '#334155', color: '#fff', border: 'none', padding: '2px 6px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Recent Trades Feed */}
            <div className="card" style={{ height: 260 }}>
              <div className="card-header">
                <span>RECENT MARKET TRADES</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>EXECUTION STREAM</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <table className="ladder-table mono">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                      <th>PRICE</th>
                      <th>QTY</th>
                      <th>TIME</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 10).map((t) => (
                      <tr key={t.id}>
                        <td>{formatDKC(Number(t.price))}</td>
                        <td>{t.qty}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dutch Auctions Tab */}
      {activeTab === 'auctions' && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Automated Dutch Price-Decay Auctions</h2>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Liquidating distressed tickets and relics over linear price-decay intervals.
              </div>
            </div>
            <button
              className="btn-primary"
              style={{ cursor: 'pointer', padding: '8px 16px' }}
              onClick={() => {
                if (!user) {
                  setShowAuthModal(true);
                  return;
                }
                setShowCreateAuctionModal(true);
              }}
            >
              + Create Dutch Auction
            </button>
          </div>

          {auctions.length === 0 ? (
            <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
              No active Dutch auctions. Click "+ Create Dutch Auction" to launch a new liquidation auction.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {auctions.map((auc) => (
                <div key={auc.id} className="card">
                  <div className="card-header">
                    <strong>{auc.symbol} AUCTION</strong>
                    <span className="badge badge-mode">{auc.status}</span>
                  </div>
                  <div className="card-body mono" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>Current Price: <strong style={{ color: 'var(--amber-accent)', fontSize: 16 }}>{formatDKC(Number(auc.currentPrice))}</strong></div>
                    <div>Quantity Available: {auc.qtyRemaining} / {auc.qtyTotal}</div>
                    <div>Floor Price: {formatDKC(Number(auc.floorPrice))}</div>
                    <button
                      className="btn-buy"
                      style={{ cursor: 'pointer', marginTop: 4 }}
                      onClick={async () => {
                        if (!user) {
                          setShowAuthModal(true);
                          return;
                        }
                        try {
                          const res = await fetch(`/api/auctions/${auc.id}/buy`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                            credentials: 'include',
                            body: JSON.stringify({ qty: 1, maxPrice: Number(auc.currentPrice) }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (res.ok) {
                            alert('Auction purchase executed successfully!');
                            fetchSession();
                            fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); });
                          } else {
                            alert(`Auction purchase rejected: ${data.error || 'Failed'}`);
                          }
                        } catch (err: any) {
                          alert(`Auction error: ${err.message || 'Network error'}`);
                        }
                      }}
                    >
                      Buy 1 Unit at {formatDKC(Number(auc.currentPrice))}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Escrow Custody Tab */}
      {activeTab === 'escrows' && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>Cryptographic Escrow Custody (Demonstration Model)</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Funds and relics are securely locked until delivery receipts are verified by the issuer receipt authority.
            </div>
          </div>
          <div className="card" style={{ maxWidth: 900 }}>
            <div className="card-body">
              {escrows.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  No active escrows for current user.<br />
                  Trades on instruments marked with 🔒 (such as <strong>RELIC-AGAMOTTO</strong>) automatically lock funds and tickets into cryptographic custody until delivery verification.
                </div>
              ) : (
                <table className="ladder-table mono">
                  <thead>
                    <tr>
                      <th>ESCROW ID</th>
                      <th>SYMBOL</th>
                      <th>AMOUNT</th>
                      <th>BUYER</th>
                      <th>SELLER</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escrows.map((e) => (
                      <tr key={e.id}>
                        <td>{e.id}</td>
                        <td>{e.symbol}</td>
                        <td>{formatDKC(Number(e.amount))}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.buyerUserId}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.sellerUserId}</td>
                        <td><span className="badge badge-mode">{e.status}</span></td>
                        <td>
                          {e.status === 'LOCKED' && e.sellerUserId === user?.id && (
                            <button
                              className="btn-primary"
                              style={{ fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
                              onClick={async () => {
                                try {
                                  const rRes = await fetch('/api/mock-issuer/receipt', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                                    credentials: 'include',
                                    body: JSON.stringify({ escrowId: e.id }),
                                  });
                                  if (!rRes.ok) {
                                    const errData = await rRes.json().catch(() => ({}));
                                    alert(`Mock issuer error: ${errData.error || 'Failed to generate receipt'}`);
                                    return;
                                  }
                                  const { receipt } = await rRes.json();
                                  const delRes = await fetch(`/api/escrows/${e.id}/deliver`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                                    credentials: 'include',
                                    body: JSON.stringify({ receipt }),
                                  });
                                  const delData = await delRes.json().catch(() => ({}));
                                  if (delRes.ok) {
                                    alert('Escrow delivered and settled successfully!');
                                    fetchSession();
                                    fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); });
                                  } else {
                                    alert(`Delivery settlement rejected: ${delData.error || 'Failed'}`);
                                  }
                                } catch (delErr: any) {
                                  alert(`Escrow delivery error: ${delErr.message || 'Network error'}`);
                                }
                              }}
                            >
                              Generate Receipt & Deliver
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Proof of Solvency Tab */}
      {activeTab === 'solvency' && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
          <h2>Cryptographic Proof of Solvency (Merkle Sum Tree)</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Proves that your account balance is correctly included in the exchange liability ledger and that the total sum of reported liabilities matches internal ledger postings.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div className="card">
              <div className="card-header">CHECK 1: INCLUSION PROOF</div>
              <div className="card-body">
                Status: {solvencyChecks.check1 === true ? <strong style={{ color: 'var(--green-bid)' }}>✓ VALID</strong> : solvencyChecks.check1 === false ? <strong style={{ color: 'var(--red-ask)' }}>✗ FAILED</strong> : 'PENDING'}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Leaf to root cryptographic path</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">CHECK 2: SUM CONSERVATION</div>
              <div className="card-body">
                Status: {solvencyChecks.check2 === true ? <strong style={{ color: 'var(--green-bid)' }}>✓ VERIFIED</strong> : solvencyChecks.check2 === false ? <strong style={{ color: 'var(--red-ask)' }}>✗ IMBALANCED</strong> : 'PENDING'}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Root sum equals total liabilities</div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">CHECK 3: LEDGER RECONCILIATION</div>
              <div className="card-body">
                Status: {solvencyChecks.check3 === true ? <strong style={{ color: 'var(--green-bid)' }}>✓ BALANCED</strong> : solvencyChecks.check3 === false ? <strong style={{ color: 'var(--red-ask)' }}>✗ ANOMALIES</strong> : 'PENDING'}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Zero-sum double entry audit</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn-primary" style={{ cursor: 'pointer' }} onClick={runSolvencyVerification}>Re-run Verification</button>
            <button
              style={{ background: '#475569', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}
              onClick={() => {
                if (solvencyProof) {
                  const tampered = { ...solvencyProof, balance: solvencyProof.balance + 100000 };
                  const res = verifyMerkleSumProof(tampered);
                  alert(`Tamper Test Result: Valid = ${res.valid}. Reason = ${res.reason || 'Calculated root hash does not match published root'}`);
                } else {
                  alert('Please click "Re-run Verification" first to fetch and verify the cryptographic proof.');
                }
              }}
            >
              Simulate Tampered Balance Test
            </button>
          </div>
        </div>
      )}

      {/* Diagnostics Tab */}
      {activeTab === 'diagnostics' && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
          <div>
            <h2 style={{ margin: 0 }}>System Diagnostics & Benchmarks</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Execute live double-entry ledger audits and simulate anti-bot scalper burst attacks.
            </div>
          </div>

          {(!user || user.role !== 'admin') && (
            <div style={{ color: 'var(--amber-accent)', fontSize: 13, background: '#1e293b', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 4 }}>
              <strong>Admin Role Required:</strong> Live reconciliation and attack simulations are restricted to administrator sessions. Please switch to demo account <strong>admin</strong> via the top-right menu to run diagnostics.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn-primary"
              disabled={diagRunning || user?.role !== 'admin'}
              style={{ cursor: diagRunning || user?.role !== 'admin' ? 'not-allowed' : 'pointer' }}
              onClick={async () => {
                setDiagRunning(true);
                try {
                  const res = await fetch('/api/admin/reconcile', { credentials: 'include' });
                  setDiagResult(await res.json());
                } catch (e: any) {
                  setDiagResult({ error: e.message || 'Failed to run reconciliation' });
                } finally {
                  setDiagRunning(false);
                }
              }}
            >
              {diagRunning ? 'Auditing Ledger...' : 'Run Double-Entry Ledger Reconciliation'}
            </button>
            <button
              className="btn-primary"
              disabled={diagRunning || user?.role !== 'admin'}
              style={{ cursor: diagRunning || user?.role !== 'admin' ? 'not-allowed' : 'pointer' }}
              onClick={async () => {
                setDiagRunning(true);
                try {
                  const res = await fetch('/api/admin/scalper-demo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                    credentials: 'include',
                    body: JSON.stringify({ burstCount: 30 }),
                  });
                  setDiagResult(await res.json());
                } catch (e: any) {
                  setDiagResult({ error: e.message || 'Failed to run scalper demo' });
                } finally {
                  setDiagRunning(false);
                }
              }}
            >
              {diagRunning ? 'Simulating Attack...' : 'Run Scalper Anti-Bot Attack Demo'}
            </button>
          </div>

          {diagResult && (
            <div className="card">
              <div className="card-header">DIAGNOSTIC OUTPUT</div>
              <div className="card-body mono" style={{ fontSize: 12 }}>
                <pre style={{ margin: 0 }}>{JSON.stringify(diagResult, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="footer-banner">
        <span>Simulated trading economy. DKC is a fictional demonstration currency.</span>
      </footer>

      {/* Login / Demo Accounts Modal */}
      {showAuthModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 400, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>{authMode === 'login' ? 'Exchange Login' : 'Register Account'}</h3>

            <div style={{ marginBottom: 16, background: '#1e293b', padding: 10, borderRadius: 4, fontSize: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--amber-accent)', marginBottom: 4 }}>Fast 1-Click Demo Accounts:</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['alice', 'bob', 'carol', 'admin'].map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={authLoading}
                    onClick={() => {
                      setAuthError('');
                      setAuthUsername(name);
                      setAuthPassword(name === 'admin' ? 'admin_darkhold_2026' : 'demo_darkhold_2026');
                    }}
                    style={{
                      background: '#334155',
                      color: authLoading ? 'var(--text-muted)' : '#fff',
                      border: 'none',
                      padding: '3px 8px',
                      borderRadius: 3,
                      fontSize: 11,
                      cursor: authLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>USERNAME</label>
                <input
                  type="text"
                  value={authUsername}
                  disabled={authLoading}
                  onChange={(e) => {
                    setAuthError('');
                    setAuthUsername(e.target.value);
                  }}
                  style={{ width: '100%', marginTop: 2 }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>PASSWORD</label>
                <input
                  type="password"
                  value={authPassword}
                  disabled={authLoading}
                  onChange={(e) => {
                    setAuthError('');
                    setAuthPassword(e.target.value);
                  }}
                  style={{ width: '100%', marginTop: 2 }}
                  required
                />
              </div>

              {authError && <div style={{ color: 'var(--red-ask)', fontSize: 12, lineHeight: 1.4 }}>{authError}</div>}

              <button
                type="submit"
                className="btn-primary"
                style={{ marginTop: 8 }}
                disabled={authLoading}
              >
                {authLoading
                  ? authMode === 'login'
                    ? 'Signing In...'
                    : 'Registering...'
                  : authMode === 'login'
                  ? 'Sign In'
                  : 'Register'}
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12 }}>
              <button
                type="button"
                onClick={() => {
                  cancelAuthRequest();
                  setAuthError('');
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                }}
                style={{ background: 'transparent', border: 'none', color: 'var(--amber-accent)', cursor: 'pointer' }}
              >
                {authMode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelAuthRequest();
                  setAuthError('');
                  setShowAuthModal(false);
                }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Dutch Auction Modal */}
      {showCreateAuctionModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 440, padding: 20 }}>
            <h3 style={{ marginBottom: 12 }}>Create Dutch Price-Decay Auction</h3>
            <form onSubmit={handleCreateAuction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>INSTRUMENT</label>
                <select
                  value={auctionSymbol}
                  onChange={(e) => setAuctionSymbol(e.target.value)}
                  style={{ width: '100%', marginTop: 2 }}
                >
                  {instruments.map((i) => (
                    <option key={i.symbol} value={i.symbol}>{i.symbol} - {i.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>QUANTITY (UNITS)</label>
                  <input
                    type="number"
                    min="1"
                    value={auctionQty}
                    onChange={(e) => setAuctionQty(parseInt(e.target.value, 10) || 1)}
                    style={{ width: '100%', marginTop: 2 }}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>DURATION (SECONDS)</label>
                  <input
                    type="number"
                    min="30"
                    max="86400"
                    value={auctionDurationSec}
                    onChange={(e) => setAuctionDurationSec(parseInt(e.target.value, 10) || 300)}
                    style={{ width: '100%', marginTop: 2 }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>START PRICE (DKC)</label>
                  <input
                    type="number"
                    min="1"
                    value={auctionStartPrice}
                    onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value) || 1)}
                    style={{ width: '100%', marginTop: 2 }}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>FLOOR PRICE (DKC)</label>
                  <input
                    type="number"
                    min="1"
                    max={auctionStartPrice}
                    value={auctionFloorPrice}
                    onChange={(e) => setAuctionFloorPrice(parseFloat(e.target.value) || 1)}
                    style={{ width: '100%', marginTop: 2 }}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={auctionSubmitting}
                style={{ marginTop: 10, cursor: auctionSubmitting ? 'not-allowed' : 'pointer' }}
              >
                {auctionSubmitting ? 'Creating Auction...' : 'Launch Dutch Auction'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateAuctionModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'center', marginTop: 4 }}
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
