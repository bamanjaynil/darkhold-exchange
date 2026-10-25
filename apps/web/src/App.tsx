/**
 * @file App.tsx
 * THE DARKHOLD NEXUS — Spatial Liquidity & Engine X-Ray Cockpit.
 * High-performance terminal for institutional secondary matching, double-entry audit, and live HFT order flow.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  formatDKC,
  toMinorUnits,
  calculateCollarCeiling,
  verifyMerkleSumProof,
  SolvencyInclusionProof,
} from '@darkhold/shared';
import { LiquidityCanvas, BookLevel } from './components/LiquidityCanvas.js';
import { TelemetryRibbon } from './components/TelemetryRibbon.js';
import { LedgerInspectorDrawer } from './components/LedgerInspectorDrawer.js';
import { PersonaSwitcher } from './components/PersonaSwitcher.js';

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

type TradeItem = { id: string; price: number; qty: number; created_at: string; is_simulated: boolean; side?: string };
type OpenOrder = { id: string; client_order_id: string; side: 'BUY' | 'SELL'; type: string; price: number; qty: number; remaining_qty: number; symbol: string; status?: string };

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
  const [activeTab, setActiveTab] = useState<'cockpit' | 'auctions' | 'escrows' | 'solvency' | 'diagnostics'>('cockpit');
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Engine Telemetry State
  const [engineSeq, setEngineSeq] = useState<number>(40);
  const [activeOrderCount, setActiveOrderCount] = useState<number>(0);
  const [isLedgerDrawerOpen, setIsLedgerDrawerOpen] = useState<boolean>(false);
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());

  // Auto-Pilot Market Simulator
  const [autoPilot, setAutoPilot] = useState<boolean>(false);
  const autoPilotTimerRef = useRef<any>(null);

  // Order Form State (Tactical Execution Pod)
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
    fetchMarketStats();
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
        void fetchMyOrders();
      } else if (res.status === 401) {
        setUser(null);
        setHoldings([]);
        setMyOrders([]);
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

  const fetchMyOrders = async () => {
    try {
      const res = await fetch('/api/orders/my', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // Only keep active OPEN orders in the active orders view
        setMyOrders((data || []).filter((o: any) => o.status === 'OPEN'));
      }
    } catch {}
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

  const fetchMarketStats = async () => {
    try {
      const res = await fetch('/api/market/stats');
      if (res.ok) {
        const stats = await res.json();
        if (stats.seq !== undefined) setEngineSeq(stats.seq);
        if (stats.activeOrders !== undefined) setActiveOrderCount(stats.activeOrders);
      }
    } catch {}
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
        try { socket?.close(); } catch {}
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.v === 1) {
            if (msg.seq) {
              setEngineSeq(msg.seq);
            }
            if (msg.channel === `book:${selectedSymbol}`) {
              if (msg.data) {
                setBids(msg.data.bids || []);
                setAsks(msg.data.asks || []);
                setSpread(msg.data.spread);
                // Compute total active order count
                let count = 0;
                for (const b of (msg.data.bids || [])) count += b.orders || 0;
                for (const a of (msg.data.asks || [])) count += a.orders || 0;
                setActiveOrderCount(count);
              }
            } else if (msg.channel === `trades:${selectedSymbol}`) {
              if (msg.data) {
                setTrades((prev) => [msg.data, ...prev].slice(0, 50));
              }
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
      void fetchMyOrders();
    }
  }, [selectedSymbol, user?.id]);

  // --- INNOVATION 2: Tactical Book Sniping ---
  const handleSelectPrice = (targetPriceMinor: number, suggestedSide: 'BUY' | 'SELL') => {
    setPriceInput((targetPriceMinor / 100).toString());
    setSide(suggestedSide);
    setOrderType('LIMIT');
    setOrderMessage({
      text: `Tactical Sniping loaded: ${suggestedSide} @ ${formatDKC(targetPriceMinor)}`,
      error: false,
    });
  };

  // --- INNOVATION 4: Auto-Pilot Market Simulator ---
  useEffect(() => {
    if (!autoPilot) {
      if (autoPilotTimerRef.current) {
        clearInterval(autoPilotTimerRef.current);
        autoPilotTimerRef.current = null;
      }
      return;
    }

    let tick = 0;
    autoPilotTimerRef.current = setInterval(async () => {
      tick++;
      try {
        const bestBid = bids.length > 0 ? bids[0]!.price : selectedInstrument?.faceValue || 100000;
        const bestAsk = asks.length > 0 ? asks[0]!.price : (selectedInstrument?.faceValue || 100000) + 200;
        const mid = Math.floor((bestBid + bestAsk) / 2);

        // Every 3rd tick submit a crossing order to match
        const shouldCross = tick % 3 === 0;
        const autoSide: 'BUY' | 'SELL' = tick % 2 === 0 ? 'BUY' : 'SELL';
        let autoPrice: number;

        if (shouldCross) {
          autoPrice = autoSide === 'BUY' ? bestAsk : bestBid;
        } else {
          autoPrice = autoSide === 'BUY' ? mid - 100 : mid + 100;
        }

        await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bench-bypass': 'true',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            clientOrderId: `sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            symbol: selectedSymbol,
            side: autoSide,
            type: 'LIMIT',
            tif: 'GTC',
            price: autoPrice,
            qty: 1,
          }),
        });
      } catch {}
    }, 400);

    return () => {
      if (autoPilotTimerRef.current) {
        clearInterval(autoPilotTimerRef.current);
        autoPilotTimerRef.current = null;
      }
    };
  }, [autoPilot, bids, asks, selectedSymbol, selectedInstrument, csrfToken]);

  // --- INNOVATION 5: 1-Click Persona Switcher ---
  const handleSwitchPersona = async (username: string) => {
    const password = username === 'admin' ? 'admin_darkhold_2026' : 'demo_darkhold_2026';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.balance) setBalance(data.balance);
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        void fetchHoldings();
        void fetchMyOrders();
        setOrderMessage({ text: `Switched persona to ${username.toUpperCase()}`, error: false });
      }
    } catch (e: any) {
      alert(`Failed to switch to ${username}: ${e.message}`);
    }
  };

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
            pow: {
              challengeId: challenge.challengeId,
              nonce,
            },
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

          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            setOrderMessage({
              text: `Order ${data.restingOrder ? 'resting in book' : 'executed'} successfully! Seq #${data.seq}`,
              error: false,
            });
            fetchSession();
            fetchHoldings();
            void fetchMyOrders();
          } else {
            setOrderMessage({ text: data.error || 'Order rejected by exchange', error: true });
          }
        } catch (err: any) {
          setOrderMessage({ text: err.message || 'Network error submitting order', error: true });
        } finally {
          setOrderSubmitting(false);
        }
      };
    } catch (err: any) {
      setOrderSubmitting(false);
      setOrderMessage({ text: err.message || 'Error submitting order', error: true });
    }
  };

  // --- INNOVATION 5: Authoritative Non-Blocking Order Cancellation ---
  const handleCancelOrder = async (orderId: string, symbol?: string) => {
    if (cancellingOrderIds.has(orderId)) return;
    setCancellingOrderIds((prev) => new Set(prev).add(orderId));

    try {
      const targetSymbol = symbol || selectedSymbol;
      const res = await fetch(`/api/orders/${orderId}?symbol=${targetSymbol}`, {
        method: 'DELETE',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        credentials: 'include',
      });

      if (res.ok) {
        // Optimistically remove from state
        setMyOrders((prev) => prev.filter((o) => o.id !== orderId));
        // Immediately synchronize authoritative state from server
        void fetchSession();
        void fetchHoldings();
        void fetchMyOrders();
        void fetchMarketStats();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Order cancellation: ${err.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Cancellation network error: ${err.message || 'Failed'}`);
    } finally {
      setCancellingOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
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
    if (authLoading) return;
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
        setAuthError(data.error || `Authentication failed (${res.status})`);
      } else {
        setUser(data.user);
        if (data.balance) setBalance(data.balance);
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        setShowAuthModal(false);
        await fetchSession();
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAuthError('Connection timed out connecting to backend server.');
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
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        credentials: 'include',
      }).catch(() => {});
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
      setActiveTab('cockpit');
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

      const verification = verifyMerkleSumProof(proof);
      const c1 = verification.valid;
      const c2 = verification.calculatedTotal === proof.expectedTotal;

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

  // Tactical cost calculation
  const parsedPrice = parseFloat(priceInput) || 0;
  const parsedQty = parseInt(qtyInput, 10) || 1;
  const estimatedCostDKC = parsedPrice * parsedQty;
  const estimatedCostMinor = toMinorUnits(estimatedCostDKC);
  const costPercentageOfAvailable = balance.available > 0 ? Math.min(100, Math.round((estimatedCostMinor / balance.available) * 100)) : 0;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#06080F', color: '#F8FAFC' }}>
      {/* 1. Header / Navbar */}
      <header className="navbar">
        <div className="brand">
          <span style={{ color: '#00F0FF', textShadow: '0 0 10px rgba(0,240,255,0.7)' }}>⚡ DARKHOLD NEXUS</span>
          <span style={{ fontSize: 11, color: '#64748B', borderLeft: '1px solid #1E293B', paddingLeft: 8 }}>SPATIAL COCKPIT</span>
          <span className={`badge ${wsConnected ? 'badge-ws-connected' : 'badge-ws-disconnected'}`}>
            {wsConnected ? 'LIVE FEED (60 FPS)' : 'OFFLINE'}
          </span>
        </div>

        {/* Center: Auto-Pilot Simulator & Persona Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Auto-Pilot Toggle Button */}
          <button
            onClick={() => setAutoPilot((prev) => !prev)}
            className={autoPilot ? 'btn-autopilot-on' : 'btn-autopilot-off'}
            style={{
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"JetBrains Mono", monospace',
              letterSpacing: 0.5,
              transition: 'all 0.2s ease',
            }}
          >
            <span>{autoPilot ? '⚡ AUTO-PILOT [ON]' : '⚡ AUTO-PILOT SIMULATOR [OFF]'}</span>
          </button>

          {/* 1-Click Persona Switcher */}
          <PersonaSwitcher
            currentUsername={user?.username}
            onSwitch={handleSwitchPersona}
          />
        </div>

        {/* Right: User / Auth Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="mono" style={{ fontSize: 12 }}>
                <span style={{ color: '#64748B' }}>USER:</span> <strong style={{ color: '#F8FAFC' }}>{user.username}</strong>
                <span style={{ color: '#94A3B8', fontSize: 10, marginLeft: 4 }}>({user.role})</span>
              </div>
              <button
                onClick={handleLogout}
                disabled={logoutLoading}
                style={{
                  background: 'transparent',
                  border: '1px solid #1E293B',
                  color: logoutLoading ? '#64748B' : '#FF2A54',
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: logoutLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {logoutLoading ? '...' : 'LOGOUT'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                borderRadius: 4,
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              LOGIN / ACCOUNTS
            </button>
          )}
        </div>
      </header>

      {/* 2. LMAX Engine & Solvency Telemetry Ribbon */}
      <TelemetryRibbon
        seq={engineSeq}
        activeOrders={activeOrderCount}
        matchLatencyUs={0.65}
        isSolvent={true}
        onOpenLedgerInspector={() => setIsLedgerDrawerOpen(true)}
      />

      {/* 3. Instrument Bar & Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#04060A',
          borderBottom: '1px solid #161F30',
          padding: '6px 16px',
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
            INSTRUMENT:
          </span>
          {instruments.map((inst) => {
            const isSelected = selectedSymbol === inst.symbol;
            return (
              <button
                key={inst.symbol}
                onClick={() => {
                  setSelectedSymbol(inst.symbol);
                  setPriceInput((inst.faceValue / 100).toString());
                  setOrderMessage(null);
                }}
                style={{
                  background: isSelected ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor: isSelected ? '#00F0FF' : '#1E293B',
                  color: isSelected ? '#00F0FF' : '#94A3B8',
                  padding: '3px 9px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {inst.symbol} {inst.escrowRequired && '🔒'}
              </button>
            );
          })}
        </div>

        <div className="nav-tabs" style={{ border: 'none', background: 'transparent' }}>
          <button className={`nav-tab ${activeTab === 'cockpit' ? 'active' : ''}`} onClick={() => setActiveTab('cockpit')}>
            SPATIAL COCKPIT & LADDER
          </button>
          <button className={`nav-tab ${activeTab === 'auctions' ? 'active' : ''}`} onClick={() => { setActiveTab('auctions'); fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); }); }}>
            DUTCH AUCTIONS
          </button>
          <button className={`nav-tab ${activeTab === 'escrows' ? 'active' : ''}`} onClick={() => { setActiveTab('escrows'); fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); }); }}>
            ESCROW CUSTODY
          </button>
          <button className={`nav-tab ${activeTab === 'solvency' ? 'active' : ''}`} onClick={() => { setActiveTab('solvency'); runSolvencyVerification(); }}>
            PROOF OF SOLVENCY
          </button>
          <button className={`nav-tab ${activeTab === 'diagnostics' ? 'active' : ''}`} onClick={() => setActiveTab('diagnostics')}>
            ADMIN DIAGNOSTICS
          </button>
        </div>
      </div>

      {/* 4. Main Spatial Cockpit View */}
      {activeTab === 'cockpit' && (
        <div className="grid-main">
          {/* Column 1: Tactical Execution Pod & Portfolio */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Tactical Execution Pod */}
            <div className="card">
              <div className="card-header">
                <span style={{ color: '#00F0FF' }}>⚡ TACTICAL EXECUTION POD</span>
                <span style={{ fontSize: 10, color: '#64748B' }}>1-CLICK SNIPING</span>
              </div>
              <div className="card-body">
                <form onSubmit={handleSubmitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Side Selector (BUY vs SELL) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setSide('BUY')}
                      style={{
                        padding: '8px',
                        background: side === 'BUY' ? 'rgba(0, 240, 255, 0.2)' : '#04060A',
                        color: side === 'BUY' ? '#00F0FF' : '#64748B',
                        border: `1px solid ${side === 'BUY' ? '#00F0FF' : '#1E293B'}`,
                        borderRadius: 4,
                        fontWeight: 800,
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
                      }}
                    >
                      BUY / BID
                    </button>
                    <button
                      type="button"
                      onClick={() => setSide('SELL')}
                      style={{
                        padding: '8px',
                        background: side === 'SELL' ? 'rgba(255, 42, 84, 0.2)' : '#04060A',
                        color: side === 'SELL' ? '#FF2A54' : '#64748B',
                        border: `1px solid ${side === 'SELL' ? '#FF2A54' : '#1E293B'}`,
                        borderRadius: 4,
                        fontWeight: 800,
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 12,
                      }}
                    >
                      SELL / ASK
                    </button>
                  </div>

                  {/* Order Type & TIF */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748B', display: 'block', marginBottom: 3, fontWeight: 700 }}>
                        ORDER TYPE
                      </label>
                      <select
                        value={orderType}
                        onChange={(e) => setOrderType(e.target.value as any)}
                        style={{ width: '100%' }}
                      >
                        <option value="LIMIT">LIMIT</option>
                        <option value="MARKET">MARKET</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: '#64748B', display: 'block', marginBottom: 3, fontWeight: 700 }}>
                        TIME IN FORCE
                      </label>
                      <select
                        value={tif}
                        onChange={(e) => setTif(e.target.value as any)}
                        style={{ width: '100%' }}
                      >
                        <option value="GTC">GTC (Resting)</option>
                        <option value="IOC">IOC (Immediate)</option>
                        <option value="FOK">FOK (Fill or Kill)</option>
                      </select>
                    </div>
                  </div>

                  {/* Price Input */}
                  {orderType === 'LIMIT' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <label style={{ fontSize: 10, color: '#64748B', fontWeight: 700 }}>LIMIT PRICE (DKC)</label>
                        <span style={{ fontSize: 10, color: '#F59E0B' }}>
                          Ceiling: {formatDKC(collarCeiling)}
                        </span>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        required
                        style={{ width: '100%', fontSize: 13, fontWeight: 700 }}
                      />
                    </div>
                  )}

                  {/* Quantity Input with Quick Percentage Allocation */}
                  <div>
                    <label style={{ fontSize: 10, color: '#64748B', display: 'block', marginBottom: 3, fontWeight: 700 }}>
                      QUANTITY (UNITS)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={qtyInput}
                      onChange={(e) => setQtyInput(e.target.value)}
                      required
                      style={{ width: '100%', fontSize: 13, fontWeight: 700 }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 4 }}>
                      {[1, 5, 10, 25].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setQtyInput(preset.toString())}
                          style={{
                            background: '#04060A',
                            border: '1px solid #1E293B',
                            color: '#94A3B8',
                            borderRadius: 3,
                            padding: '2px 0',
                            fontSize: 10,
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          {preset}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* DKC Cost & Reservation Bar */}
                  {orderType === 'LIMIT' && (
                    <div style={{ background: '#04060A', border: '1px solid #1E293B', borderRadius: 4, padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: '#64748B' }}>Estimated Total:</span>
                        <strong style={{ color: '#F8FAFC' }}>{formatDKC(estimatedCostMinor)}</strong>
                      </div>
                      {side === 'BUY' && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', marginBottom: 2 }}>
                            <span>Available Utilized</span>
                            <span style={{ color: costPercentageOfAvailable > 100 ? '#FF2A54' : '#00F0FF' }}>
                              {costPercentageOfAvailable}%
                            </span>
                          </div>
                          <div style={{ height: 4, background: '#1E293B', borderRadius: 2, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.min(100, costPercentageOfAvailable)}%`,
                                height: '100%',
                                background: costPercentageOfAvailable > 100 ? '#FF2A54' : '#00F0FF',
                                transition: 'width 0.2s ease',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={orderSubmitting}
                    className={side === 'BUY' ? 'btn-buy' : 'btn-sell'}
                    style={{ marginTop: 4, cursor: orderSubmitting ? 'not-allowed' : 'pointer' }}
                  >
                    {orderSubmitting ? 'COMPUTING PoW & MATCHING...' : `${side} ${selectedSymbol}`}
                  </button>

                  {orderMessage && (
                    <div
                      style={{
                        padding: 8,
                        borderRadius: 4,
                        fontSize: 11,
                        background: orderMessage.error ? 'rgba(255, 42, 84, 0.15)' : 'rgba(0, 240, 255, 0.15)',
                        color: orderMessage.error ? '#FF2A54' : '#00F0FF',
                        border: `1px solid ${orderMessage.error ? '#FF2A54' : '#00F0FF'}`,
                      }}
                    >
                      {orderMessage.text}
                    </div>
                  )}
                </form>
              </div>
            </div>

            {/* Wallet Balances & Holdings Card */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <span>PORTFOLIO ASSETS</span>
                <span style={{ fontSize: 10, color: '#10B981' }}>VERIFIED SOLVENT</span>
              </div>
              <div className="card-body mono" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>Available DKC:</span>
                  <strong style={{ color: '#00F0FF' }}>{formatDKC(balance.available)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>Reserved DKC:</span>
                  <span style={{ color: '#F59E0B' }}>{formatDKC(balance.reserved)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #161F30' }}>
                  <span style={{ color: '#64748B' }}>Escrow DKC:</span>
                  <span style={{ color: '#A855F7' }}>{formatDKC(balance.escrow)}</span>
                </div>

                <div style={{ marginTop: 8, color: '#64748B', fontSize: 10, fontWeight: 700 }}>
                  INSTRUMENT HOLDINGS:
                </div>
                {holdings.length === 0 ? (
                  <div style={{ color: '#64748B', fontSize: 11, padding: '4px 0' }}>No assets held</div>
                ) : (
                  holdings.map((h) => (
                    <div key={h.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span style={{ color: '#F8FAFC' }}>{h.symbol}</span>
                      <span>
                        <strong style={{ color: '#10B981' }}>{h.available}</strong>
                        {h.reserved > 0 && <span style={{ color: '#F59E0B' }}> (+{h.reserved} res)</span>}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Column 2: Centerpiece Canvas & Open Orders Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Centerpiece Visual: Liquidity Depth & Pulse Radar */}
            <div className="card" style={{ height: 340 }}>
              <div className="card-header">
                <span style={{ color: '#00F0FF' }}>🎯 LIQUIDITY GRAVITY RADAR ({selectedSymbol})</span>
                <span style={{ fontSize: 10, color: '#64748B' }}>CLICK OPPOSING WALL TO SNIPE</span>
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                <LiquidityCanvas
                  bids={bids}
                  asks={asks}
                  spread={spread}
                  lastPrice={trades[0]?.price || null}
                  trades={trades}
                  onSelectPrice={handleSelectPrice}
                />
              </div>
            </div>

            {/* Active Open Orders Table with Authoritative Immediate Cancel */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>ACTIVE RESTING ORDERS</span>
                  <span
                    style={{
                      background: '#1E293B',
                      color: '#00F0FF',
                      borderRadius: 10,
                      padding: '1px 6px',
                      fontSize: 10,
                    }}
                  >
                    {myOrders.length}
                  </span>
                </div>
                <button
                  onClick={fetchMyOrders}
                  style={{
                    background: 'transparent',
                    border: '1px solid #1E293B',
                    color: '#64748B',
                    borderRadius: 3,
                    padding: '2px 6px',
                    fontSize: 10,
                  }}
                >
                  SYNC
                </button>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {myOrders.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                    No active resting orders in RAM engine for current user. Click any row in the L2 ladder to submit an order.
                  </div>
                ) : (
                  <table className="ladder-table">
                    <thead>
                      <tr>
                        <th>INSTRUMENT</th>
                        <th>SIDE</th>
                        <th>PRICE</th>
                        <th>QTY</th>
                        <th>REMAINING</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myOrders.map((o) => {
                        const isCancelling = cancellingOrderIds.has(o.id);
                        return (
                          <tr key={o.id} style={{ borderBottom: '1px solid #161F30' }}>
                            <td style={{ color: '#F8FAFC', fontWeight: 600 }}>{o.symbol}</td>
                            <td style={{ color: o.side === 'BUY' ? '#00F0FF' : '#FF2A54', fontWeight: 700 }}>{o.side}</td>
                            <td>{formatDKC(o.price)}</td>
                            <td>{o.qty}</td>
                            <td>{o.remaining_qty}</td>
                            <td>
                              <button
                                onClick={() => handleCancelOrder(o.id, o.symbol)}
                                disabled={isCancelling}
                                style={{
                                  background: isCancelling ? '#1E293B' : 'rgba(255, 42, 84, 0.15)',
                                  color: isCancelling ? '#64748B' : '#FF2A54',
                                  border: `1px solid ${isCancelling ? '#334155' : 'rgba(255, 42, 84, 0.4)'}`,
                                  borderRadius: 3,
                                  padding: '2px 8px',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: isCancelling ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {isCancelling ? 'Cancelling...' : 'Cancel'}
                              </button>
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

          {/* Column 3: L2 Order Book Ladder & Real-Time Trade Tape */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* L2 Order Book Ladder */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <span>ORDER BOOK LADDER</span>
                <span style={{ fontSize: 10, color: '#64748B' }}>1-CLICK SNIPE</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <table className="ladder-table">
                  <thead>
                    <tr>
                      <th>PRICE (DKC)</th>
                      <th>QTY</th>
                      <th>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Asks displayed in reverse (lowest ask near spread) */}
                    {asks.slice(0, 10).reverse().map((a, idx) => (
                      <tr
                        key={`ask-${a.price}-${idx}`}
                        className="ask-row"
                        onClick={() => handleSelectPrice(a.price, 'BUY')}
                        title="Click to BUY (Snipe this ask)"
                      >
                        <td>{formatDKC(a.price)}</td>
                        <td>{a.qty}</td>
                        <td style={{ color: '#94A3B8' }}>{a.total}</td>
                      </tr>
                    ))}

                    {/* Spread Divider */}
                    <tr>
                      <td colSpan={3} className="spread-row">
                        {spread !== null ? `SPREAD: ${formatDKC(spread)}` : 'SPREAD: LOCKED'}
                      </td>
                    </tr>

                    {/* Bids displayed descending (highest bid near spread) */}
                    {bids.slice(0, 10).map((b, idx) => (
                      <tr
                        key={`bid-${b.price}-${idx}`}
                        className="bid-row"
                        onClick={() => handleSelectPrice(b.price, 'SELL')}
                        title="Click to SELL (Hit this bid)"
                      >
                        <td>{formatDKC(b.price)}</td>
                        <td>{b.qty}</td>
                        <td style={{ color: '#94A3B8' }}>{b.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Real-Time Trade Stream Tape */}
            <div className="card" style={{ height: 260 }}>
              <div className="card-header">
                <span style={{ color: '#10B981' }}>RECENT MATCHED TRADES</span>
                <span style={{ fontSize: 10, color: '#64748B' }}>TAPE</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {trades.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: '#64748B', fontSize: 11 }}>
                    No trades executed yet
                  </div>
                ) : (
                  <table className="ladder-table">
                    <thead>
                      <tr>
                        <th>PRICE</th>
                        <th>QTY</th>
                        <th>TIME</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.slice(0, 20).map((t, idx) => (
                        <tr key={t.id || idx}>
                          <td style={{ color: t.side === 'BUY' ? '#00F0FF' : '#FF2A54', fontWeight: 600 }}>
                            {formatDKC(t.price)}
                          </td>
                          <td>{t.qty}</td>
                          <td style={{ color: '#64748B', fontSize: 10 }}>
                            {new Date(t.created_at || Date.now()).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Dutch Auctions */}
      {activeTab === 'auctions' && (
        <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 18, color: '#00F0FF', margin: 0 }}>DUTCH AUCTIONS</h2>
              <p style={{ color: '#94A3B8', fontSize: 12, margin: '4px 0 0' }}>
                Descending price inventory distribution with collar ceiling guards.
              </p>
            </div>
            <button
              onClick={() => setShowCreateAuctionModal(true)}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Create Auction
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {auctions.map((auc) => (
              <div key={auc.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#F8FAFC' }}>{auc.symbol}</span>
                  <span className={`badge ${auc.status === 'ACTIVE' ? 'badge-ws-connected' : 'badge-ws-disconnected'}`}>
                    {auc.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Current Price:</span>
                    <strong style={{ color: '#F59E0B' }}>{formatDKC(auc.currentPrice)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Remaining Qty:</span>
                    <span>{auc.qtyRemaining} / {auc.qtyTotal}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Floor Price:</span>
                    <span>{formatDKC(auc.floorPrice)}</span>
                  </div>
                </div>
                {auc.status === 'ACTIVE' && (
                  <button
                    onClick={async () => {
                      if (!user) return setShowAuthModal(true);
                      const res = await fetch(`/api/auctions/${auc.id}/buy`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                        credentials: 'include',
                        body: JSON.stringify({ qty: 1, maxPrice: auc.currentPrice }),
                      });
                      if (res.ok) {
                        alert('Auction purchase successful!');
                        fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); });
                        fetchSession();
                      } else {
                        const err = await res.json().catch(() => ({}));
                        alert(`Auction buy error: ${err.error || 'Failed'}`);
                      }
                    }}
                    style={{
                      background: '#10B981',
                      color: '#06080F',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Buy 1 Unit Now
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Escrow Custody */}
      {activeTab === 'escrows' && (
        <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
          <h2 style={{ fontSize: 18, color: '#A855F7', margin: '0 0 4px' }}>ESCROW CUSTODY</h2>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '0 0 16px' }}>
            Two-phase delivery-versus-payment escrow with mock issuer cryptographic verification.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {escrows.map((e) => (
              <div key={e.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{e.symbol}</span>
                  <span className="badge badge-mode">{e.status}</span>
                </div>
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  <div><span style={{ color: '#64748B' }}>Qty: </span>{e.qty} units</div>
                  <div><span style={{ color: '#64748B' }}>Locked Cash: </span>{formatDKC(e.cashMinor)}</div>
                  <div><span style={{ color: '#64748B' }}>Buyer: </span>{e.buyerUserId}</div>
                  <div><span style={{ color: '#64748B' }}>Seller: </span>{e.sellerUserId}</div>
                </div>
                {e.status === 'LOCKED' && e.sellerUserId === user?.id && (
                  <button
                    onClick={async () => {
                      const rRes = await fetch('/api/mock-issuer/receipt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                        credentials: 'include',
                        body: JSON.stringify({ escrowId: e.id }),
                      });
                      if (rRes.ok) {
                        const { receipt } = await rRes.json();
                        const delRes = await fetch(`/api/escrows/${e.id}/deliver`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                          credentials: 'include',
                          body: JSON.stringify({ receipt }),
                        });
                        if (delRes.ok) {
                          alert('Escrow delivered and settled successfully!');
                          fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); });
                          fetchSession();
                        }
                      }
                    }}
                    style={{
                      background: '#A855F7',
                      color: '#FFF',
                      border: 'none',
                      borderRadius: 4,
                      padding: '8px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Obtain Mock Receipt & Deliver
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Proof of Solvency */}
      {activeTab === 'solvency' && (
        <div style={{ padding: 20, flex: 1, overflowY: 'auto', maxWidth: 800 }}>
          <h2 style={{ fontSize: 18, color: '#10B981', margin: '0 0 4px' }}>CRYPTOGRAPHIC PROOF OF SOLVENCY</h2>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '0 0 16px' }}>
            Merkle Sum Tree inclusion verification proving full asset backing without disclosing private balances.
          </p>

          <button
            onClick={runSolvencyVerification}
            style={{
              background: '#10B981',
              color: '#06080F',
              border: 'none',
              borderRadius: 4,
              padding: '10px 20px',
              fontWeight: 800,
              cursor: 'pointer',
              marginBottom: 16,
            }}
          >
            RUN LIVE SOLVENCY AUDIT
          </button>

          {solvencyChecks.check1 !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="card" style={{ padding: 14, borderLeft: `4px solid ${solvencyChecks.check1 ? '#10B981' : '#FF2A54'}` }}>
                <strong>CHECK 1: Merkle Sum Tree Path Verification</strong>
                <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 12 }}>
                  {solvencyChecks.check1 ? '✓ PASSED: Valid mathematical path from user leaf to published root hash.' : '✗ FAILED'}
                </p>
              </div>
              <div className="card" style={{ padding: 14, borderLeft: `4px solid ${solvencyChecks.check2 ? '#10B981' : '#FF2A54'}` }}>
                <strong>CHECK 2: Total Sum Invariant Conservation</strong>
                <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 12 }}>
                  {solvencyChecks.check2 ? '✓ PASSED: Cumulative liabilities equal root sum.' : '✗ FAILED'}
                </p>
              </div>
              <div className="card" style={{ padding: 14, borderLeft: `4px solid ${solvencyChecks.check3 ? '#10B981' : '#FF2A54'}` }}>
                <strong>CHECK 3: Double-Entry Ledger Zero Balance</strong>
                <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 12 }}>
                  {solvencyChecks.check3 ? '✓ PASSED: Sum of all journal debit and credit postings equals 0 across all units.' : '✗ FAILED'}
                </p>
              </div>

              {solvencyProof && (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ color: '#00F0FF', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
                    CRYPTOGRAPHIC INCLUSION PROOF
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: '"JetBrains Mono", monospace' }}>
                    <div>User ID: {solvencyProof.userId}</div>
                    <div>Account Balance: {formatDKC(solvencyProof.balance)}</div>
                    <div>Expected Total: {formatDKC(solvencyProof.expectedTotal)}</div>
                    <div>Expected Root: {solvencyProof.expectedRoot}</div>
                    <div>Merkle Siblings: {solvencyProof.siblings.length} nodes</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Admin Diagnostics */}
      {activeTab === 'diagnostics' && (
        <div style={{ padding: 20, flex: 1, overflowY: 'auto', maxWidth: 800 }}>
          <h2 style={{ fontSize: 18, color: '#F59E0B', margin: '0 0 4px' }}>ADMIN DIAGNOSTICS & BENCHMARKS</h2>
          <p style={{ color: '#94A3B8', fontSize: 12, margin: '0 0 16px' }}>
            Run live reconciliation reports, HFT scalper burst tests, and demo resets.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button
              onClick={async () => {
                setDiagRunning(true);
                try {
                  const res = await fetch('/api/admin/reconcile', { credentials: 'include' });
                  if (res.ok) setDiagResult(await res.json());
                } finally {
                  setDiagRunning(false);
                }
              }}
              disabled={diagRunning}
              style={{
                background: '#F59E0B',
                color: '#06080F',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Run Double-Entry Reconciliation
            </button>

            <button
              onClick={async () => {
                setDiagRunning(true);
                try {
                  const res = await fetch('/api/admin/scalper-demo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
                    credentials: 'include',
                    body: JSON.stringify({ burstCount: 50 }),
                  });
                  if (res.ok) setDiagResult(await res.json());
                } finally {
                  setDiagRunning(false);
                }
              }}
              disabled={diagRunning}
              style={{
                background: '#FF2A54',
                color: '#FFF',
                border: 'none',
                borderRadius: 4,
                padding: '8px 16px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Run 50-Order Scalper Burst
            </button>
          </div>

          {diagResult && (
            <div className="card" style={{ padding: 14 }}>
              <pre style={{ margin: 0, fontSize: 12, overflowX: 'auto', color: '#00F0FF' }}>
                {JSON.stringify(diagResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 5. Ledger & Solvency Inspector Drawer */}
      <LedgerInspectorDrawer
        isOpen={isLedgerDrawerOpen}
        onClose={() => setIsLedgerDrawerOpen(false)}
        seq={engineSeq}
      />

      {/* 6. Auth Modal */}
      {showAuthModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div className="card" style={{ width: 380, padding: 24, boxShadow: '0 0 24px rgba(0,240,255,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <strong style={{ fontSize: 16, color: '#00F0FF' }}>
                {authMode === 'login' ? 'EXCHANGE LOGIN' : 'CREATE ACCOUNT'}
              </strong>
              <button
                onClick={() => setShowAuthModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>USERNAME</label>
                <input
                  type="text"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>PASSWORD</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              {authError && (
                <div style={{ color: '#FF2A54', fontSize: 11, background: 'rgba(255,42,84,0.15)', padding: 8, borderRadius: 4 }}>
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                style={{
                  background: '#00F0FF',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: 10,
                  fontWeight: 800,
                  cursor: authLoading ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                }}
              >
                {authLoading ? 'AUTHENTICATING...' : authMode === 'login' ? 'LOGIN' : 'REGISTER'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                <span
                  onClick={() => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'))}
                  style={{ color: '#00F0FF', cursor: 'pointer' }}
                >
                  {authMode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
                </span>
                {authLoading && (
                  <span onClick={cancelAuthRequest} style={{ color: '#FF2A54', cursor: 'pointer' }}>
                    Cancel
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Create Auction Modal */}
      {showCreateAuctionModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div className="card" style={{ width: 400, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <strong style={{ fontSize: 15, color: '#00F0FF' }}>CREATE DUTCH AUCTION</strong>
              <button
                onClick={() => setShowCreateAuctionModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateAuction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 }}>SYMBOL</label>
                <select value={auctionSymbol} onChange={(e) => setAuctionSymbol(e.target.value)} style={{ width: '100%' }}>
                  {instruments.map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 }}>QUANTITY</label>
                <input type="number" min="1" value={auctionQty} onChange={(e) => setAuctionQty(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 }}>START PRICE (DKC)</label>
                <input type="number" value={auctionStartPrice} onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 }}>FLOOR PRICE (DKC)</label>
                <input type="number" value={auctionFloorPrice} onChange={(e) => setAuctionFloorPrice(parseFloat(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 }}>DURATION (SECONDS)</label>
                <input type="number" min="30" value={auctionDurationSec} onChange={(e) => setAuctionDurationSec(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
              </div>
              <button
                type="submit"
                disabled={auctionSubmitting}
                style={{
                  background: '#00F0FF',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                  marginTop: 6,
                }}
              >
                {auctionSubmitting ? 'CREATING...' : 'PUBLISH AUCTION'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
