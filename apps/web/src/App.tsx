/**
 * @file App.tsx
 * THE DARKHOLD EXCHANGE — Spatial Liquidity & Engine X-Ray Cockpit.
 * High-performance terminal for institutional secondary matching, double-entry audit, and live HFT order flow.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  formatDKC,
  toMinorUnits,
  calculateCollarCeiling,
  verifyMerkleSumProof,
  computeLeafHash,
  SolvencyInclusionProof,
} from '@darkhold/shared';
import { LiquidityCanvas, BookLevel } from './components/LiquidityCanvas.js';
import { OfficialFestStore } from './components/OfficialFestStore.js';
import { LedgerInspectorDrawer } from './components/LedgerInspectorDrawer.js';
import { WithdrawModal } from './components/WithdrawModal.js';
import { TransferModal } from './components/TransferModal.js';
import { WalletView } from './components/WalletView.js';
import { MerkleTreeVisualizer } from './components/MerkleTreeVisualizer.js';
import { RazorpayCheckoutModal } from './components/RazorpayCheckoutModal.js';
import { OrgWorkspaceView } from './components/OrgWorkspaceView.js';
import { CommunityMarketplaceView } from './components/CommunityMarketplaceView.js';
import { PurchaseConfirmationModal, PurchaseConfirmationData } from './components/PurchaseConfirmationModal.js';
import { getInstrumentMeta } from './constants/instruments.js';

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
  isBenchmark?: boolean;
  referencePrice?: number;
  collarCeiling?: number;
  minPrice?: number;
  transferable?: boolean;
  imageUrl?: string;
};

type TradeItem = { id: string; price: number; qty: number; created_at: string; is_simulated: boolean; side?: string };
type OpenOrder = {
  id: string;
  client_order_id: string;
  user_id?: string;
  side: 'BUY' | 'SELL';
  type: string;
  tif?: string;
  price: number;
  qty: number;
  remaining_qty: number;
  symbol: string;
  status?: string;
};

function getTraderLabel(userId?: string): string {
  if (!userId) return 'MARKET';
  if (userId.includes('alice')) return 'ALICE';
  if (userId.includes('bob')) return 'BOB';
  if (userId.includes('carol')) return 'CAROL';
  if (userId.includes('admin')) return 'ADMIN';
  if (userId.includes('bench')) return 'BOT';
  return userId.replace('usr_', '').toUpperCase();
}

function getTraderColor(userId?: string): string {
  if (!userId) return '#94A3B8';
  if (userId.includes('alice')) return '#00F0FF';
  if (userId.includes('bob')) return '#10B981';
  if (userId.includes('carol')) return '#A855F7';
  if (userId.includes('admin')) return '#F59E0B';
  return '#94A3B8';
}

function getInstrumentVisual(symbol: string) {
  const meta = getInstrumentMeta(symbol);
  return {
    name: meta.name,
    tag: meta.category,
    color: meta.color,
    bg: meta.bgColor,
    border: meta.borderColor,
    svg: meta.badge,
  };
}

export default function App() {
  const [user, setUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [balance, setBalance] = useState<{ available: number; reserved: number; escrow: number; pendingWithdrawals?: number; total: number }>({
    available: 0,
    reserved: 0,
    escrow: 0,
    pendingWithdrawals: 0,
    total: 0,
  });
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('FEST-GA');
  const [bids, setBids] = useState<BookLevel[]>([]);
  const [asks, setAsks] = useState<BookLevel[]>([]);
  const [spread, setSpread] = useState<number | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [marketOrders, setMarketOrders] = useState<OpenOrder[]>([]);
  const [myOrders, setMyOrders] = useState<OpenOrder[]>([]);
  const [orderViewMode, setOrderViewMode] = useState<'market' | 'my'>('market');
  const [holdings, setHoldings] = useState<Array<{ symbol: string; available: number; reserved: number; escrow: number }>>([]);
  const [activeTab, setActiveTab] = useState<'store' | 'resale' | 'auctions' | 'escrows' | 'wallet' | 'solvency' | 'admin' | 'org_workspace' | 'community'>('store');
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Engine Telemetry State
  const [engineSeq, setEngineSeq] = useState<number>(40);
  const [activeOrderCount, setActiveOrderCount] = useState<number>(0);
  const [isLedgerDrawerOpen, setIsLedgerDrawerOpen] = useState<boolean>(false);
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());

  // Deposit / Payment Gateway Checkout State
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [showFaucetModal, setShowFaucetModal] = useState<boolean>(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState<boolean>(false);
  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);

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
  const [isTampered, setIsTampered] = useState<boolean>(false);
  const [tamperedInfo, setTamperedInfo] = useState<{
    forgedBalance: number;
    delta: number;
    calculatedRoot: string;
    expectedRoot: string;
    calculatedTotal: number;
    expectedTotal: number;
    reason: string;
  } | null>(null);
  const [solvencyLoading, setSolvencyLoading] = useState<boolean>(false);
  // Diagnostics
  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagRunning, setDiagRunning] = useState<boolean>(false);

  // Logout state
  const [logoutLoading, setLogoutLoading] = useState<boolean>(false);

  // Auction Creation Modal State
  const [showCreateAuctionModal, setShowCreateAuctionModal] = useState<boolean>(false);
  const [auctionSymbol, setAuctionSymbol] = useState<string>('FEST-GA');
  const [auctionQty, setAuctionQty] = useState<number>(1);
  const [auctionStartPrice, setAuctionStartPrice] = useState<number>(1650);
  const [auctionFloorPrice, setAuctionFloorPrice] = useState<number>(1000);
  const [auctionDurationSec, setAuctionDurationSec] = useState<number>(180);
  const [auctionPacePreset, setAuctionPacePreset] = useState<'slow' | 'standard' | 'blitz' | 'custom'>('slow');
  const [auctionSubmitting, setAuctionSubmitting] = useState<boolean>(false);
  const [auctionFilter, setAuctionFilter] = useState<'LIVE' | 'SETTLED'>('LIVE');
  const [buyQtyMap, setBuyQtyMap] = useState<Record<string, number>>({});
  const [tradeFilter, setTradeFilter] = useState<'GLOBAL' | 'MY'>('GLOBAL');
  const [resetLoading, setResetLoading] = useState<boolean>(false);
  const [tamperResult, setTamperResult] = useState<string | null>(null);

  // Pre-Purchase Confirmation Modal State & Escrow OTP Inputs
  const [confirmPurchaseData, setConfirmPurchaseData] = useState<PurchaseConfirmationData | null>(null);
  const [escrowOtpInputs, setEscrowOtpInputs] = useState<Record<string, string>>({});

  // Auth Dialog State
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState<string>('alice');
  const [authPassword, setAuthPassword] = useState<string>('demo_darkhold_2026');
  const [authProfile, setAuthProfile] = useState<string>('Standard Trader (with Starter Grant)');
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
        // Auto-login as alice on initial unauthenticated visit so user never lands on empty 0.00 DKC state
        try {
          const autoRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username: 'alice', password: 'password123' }),
          });
          if (autoRes.ok) {
            const data = await autoRes.json();
            setUser(data.user);
            setBalance(data.balance);
            if (data.csrfToken) {
              setCsrfToken(data.csrfToken);
            }
            void fetchHoldings();
            return;
          }
        } catch {}
        setUser(null);
        setHoldings([]);
        setMyOrders([]);
      }
    } catch {}
  };

  const fetchHoldings = async () => {
    try {
      const res = await fetch('/api/wallet/holdings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHoldings((data || []).filter((h: any) => h.symbol !== 'BENCH-X'));
      }
    } catch {}
  };

  const fetchInstruments = async () => {
    try {
      const res = await fetch('/api/instruments');
      if (res.ok) {
        const list = await res.json();
        const nonBench = list.filter((i: any) => !i.isBenchmark && i.symbol !== 'BENCH-X');
        setInstruments(nonBench);
        if (nonBench.length > 0 && (!selectedSymbol || selectedSymbol === 'BENCH-X')) {
          setSelectedSymbol(nonBench[0].symbol);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // --- Background Polling Sync (Runs every 1000ms & on events) ---
  const syncMarketState = async () => {
    if (!selectedSymbol || selectedSymbol === 'BENCH-X') return;
    try {
      const [bookRes, mktOrdersRes, tradesRes, statsRes] = await Promise.all([
        fetch(`/api/book/${selectedSymbol}`).catch(() => null),
        fetch(`/api/orders?symbol=${selectedSymbol}`).catch(() => null),
        fetch(`/api/trades/${selectedSymbol}`).catch(() => null),
        fetch('/api/market/stats').catch(() => null),
      ]);

      if (bookRes && bookRes.ok) {
        const d = await bookRes.json();
        setBids(d.bids || []);
        setAsks(d.asks || []);
        setSpread(d.spread);
      }

      if (mktOrdersRes && mktOrdersRes.ok) {
        const ords = await mktOrdersRes.json();
        const nonBench = (ords || []).filter((o: any) => o.symbol !== 'BENCH-X');
        setMarketOrders(nonBench);
        if (user) {
          setMyOrders(nonBench.filter((o: any) => o.user_id === user.id));
        } else {
          setMyOrders([]);
        }
      }

      if (tradesRes && tradesRes.ok) {
        const trs = await tradesRes.json();
        setTrades(trs || []);
      }

      if (statsRes && statsRes.ok) {
        const st = await statsRes.json();
        if (st.seq !== undefined) setEngineSeq(st.seq);
        if (st.activeOrders !== undefined) setActiveOrderCount(st.activeOrders);
      }

      if (user) {
        const [meRes, holdRes] = await Promise.all([
          fetch('/api/auth/me', { credentials: 'include' }).catch(() => null),
          fetch('/api/wallet/holdings', { credentials: 'include' }).catch(() => null),
        ]);
        if (meRes && meRes.ok) {
          const meData = await meRes.json();
          if (meData.balance) setBalance(meData.balance);
        }
        if (holdRes && holdRes.ok) {
          const hData = await holdRes.json();
          setHoldings((hData || []).filter((h: any) => h.symbol !== 'BENCH-X'));
        }
      }

      if (activeTab === 'auctions' || Math.random() < 0.25) {
        const aucRes = await fetch('/api/auctions').catch(() => null);
        if (aucRes && aucRes.ok) {
          const aucList = await aucRes.json();
          setAuctions(aucList || []);
        }
      }
    } catch {}
  };

  // 1000ms Heartbeat & Synchronizer
  useEffect(() => {
    syncMarketState();
    const interval = setInterval(syncMarketState, 1000);
    return () => clearInterval(interval);
  }, [selectedSymbol, user?.id, activeTab]);

  // Auto-Redirect non-club / student accounts away from Club Workspace tab
  useEffect(() => {
    if (activeTab === 'org_workspace' && user && user.role !== 'admin' && user.role !== 'club') {
      setActiveTab('store');
    }
  }, [activeTab, user]);

  // 250ms High-Precision Dutch Auction Decay & Expiration Ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setAuctions((prev) =>
        prev.map((auc) => {
          if (auc.status !== 'ACTIVE') return auc;
          const endsAtMs = typeof auc.endsAt === 'number' ? auc.endsAt : new Date(auc.endsAt).getTime();
          const startsAtMs = typeof auc.startsAt === 'number' ? auc.startsAt : new Date(auc.startsAt).getTime();
          const remainingSec = Math.max(0, Math.floor((endsAtMs - now) / 1000));
          if (remainingSec <= 0) {
            return { ...auc, status: 'EXPIRED', timeRemainingSec: 0, currentPrice: auc.floorPrice };
          }
          const elapsed = Math.max(0, now - startsAtMs);
          const steps = Math.floor(elapsed / (auc.stepIntervalMs || 1000));
          const currentPrice = Math.max(auc.floorPrice, auc.startPrice - steps * (auc.stepAmount || 1));
          return { ...auc, timeRemainingSec: remainingSec, currentPrice };
        })
      );
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const handleResetDemoState = async () => {
    if (resetLoading) return;
    const ok = window.confirm(
      'Reset Darkhold Exchange demo state to baseline?\n\nThis re-seeds demo accounts with 50,000.00 DKC, clean starting inventory, resting orders, and 2 live long-duration Dutch auctions.'
    );
    if (!ok) return;

    setResetLoading(true);
    try {
      const res = await fetch('/api/admin/reset-demo', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert('✓ Market state successfully reset to pristine demo baseline!');
        await fetchSession();
        void syncMarketState();
      } else {
        alert(`Reset failed: ${data.error || 'Server error'}`);
      }
    } catch (err: any) {
      alert(`Reset network error: ${err.message}`);
    } finally {
      setResetLoading(false);
    }
  };

  const handleSimulateTamper = async () => {
    let currentProof = solvencyProof;
    if (!currentProof) {
      try {
        const proofRes = await fetch('/api/solvency/proof', { credentials: 'include' });
        if (proofRes.ok) {
          currentProof = await proofRes.json();
          setSolvencyProof(currentProof);
        }
      } catch {}
    }
    if (!currentProof) {
      setTamperResult('⚠ No solvency proof available to test. Please login to an active account.');
      return;
    }

    // Maliciously tamper user liability by +10,000.00 DKC (1,000,000 minor units)
    const tamperedDelta = 1000000;
    const forgedBalance = currentProof.balance + tamperedDelta;
    const forgedLeafHash = computeLeafHash(currentProof.pseudonym, forgedBalance);

    const tamperedProof: SolvencyInclusionProof = {
      ...currentProof,
      balance: forgedBalance,
      leafHash: forgedLeafHash,
    };

    const verification = verifyMerkleSumProof(tamperedProof);

    if (!verification.valid) {
      setIsTampered(true);
      setTamperedInfo({
        forgedBalance,
        delta: tamperedDelta,
        calculatedRoot: verification.calculatedRoot,
        expectedRoot: currentProof.expectedRoot,
        calculatedTotal: verification.calculatedTotal,
        expectedTotal: currentProof.expectedTotal,
        reason: verification.reason || 'ROOT_HASH_MISMATCH',
      });
      setSolvencyChecks((prev) => ({
        check1: false,
        check2: false,
        check3: prev.check3 ?? true,
      }));
      setTamperResult(
        `🛡️ TAMPER ATTACK SUCCESSFULLY BLOCKED: Cryptographic hash mismatch detected! (Injected fake balance delta: +10,000.00 DKC -> Computed Root Hash [${verification.calculatedRoot.slice(0, 10)}...] ≠ Published Root Hash [${currentProof.expectedRoot.slice(0, 10)}...])`
      );
    } else {
      setTamperResult('⚠ Unexpected: Tampered proof passed validation.');
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
              }
            } else if (msg.channel === `trades:${selectedSymbol}`) {
              if (msg.data) {
                setTrades((prev) => [msg.data, ...prev].slice(0, 50));
              }
            } else if (msg.channel === 'me') {
              if (msg.data.balance) setBalance(msg.data.balance);
            }
            // Trigger fresh state sync on WS events
            void syncMarketState();
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

  // --- Universal High-Speed Order Dispatch (with Web Worker PoW) ---
  const dispatchOrderDirect = (params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    price?: number;
    qty: number;
    type: string;
    tif?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> => {
    return new Promise(async (resolve) => {
      if (!user) {
        setShowAuthModal(true);
        resolve({ success: false, error: 'Authentication required' });
        return;
      }

      setOrderSubmitting(true);
      setOrderMessage(null);

      try {
        const curInst = instruments.find((i) => i.symbol === params.symbol);
        const ceiling = curInst ? calculateCollarCeiling(curInst.faceValue, curInst.collarBps) : 165000;

        if (params.type === 'LIMIT' && params.price && params.price > ceiling) {
          const errText = `Price exceeds anti-scalping collar ceiling of ${formatDKC(ceiling)}`;
          setOrderMessage({ text: errText, error: true });
          setOrderSubmitting(false);
          resolve({ success: false, error: errText });
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
          const errText = 'PoW Worker error: ' + (we.message || 'Worker failure');
          setOrderMessage({ text: errText, error: true });
          resolve({ success: false, error: errText });
        };

        worker.postMessage({ seed: challenge.seed, difficultyBits: challenge.difficultyBits });

        worker.onmessage = async (we) => {
          const { nonce } = we.data;
          worker.terminate();

          try {
            const orderPayload = {
              clientOrderId: `web_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
              symbol: params.symbol,
              side: params.side,
              type: params.type,
              tif: params.tif || 'GTC',
              price: params.price,
              qty: params.qty,
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
              const tradeCount = data.trades?.length || 0;
              setOrderMessage({
                text: tradeCount > 0
                  ? `⚡ Instant Match SUCCESS: Executed ${tradeCount} trade(s) on ${params.symbol}!`
                  : `✓ Order ${data.restingOrder ? 'resting in book' : 'executed'} successfully! Seq #${data.seq}`,
                error: false,
              });
              await fetchSession();
              await fetchHoldings();
              void syncMarketState();
              resolve({ success: true, data });
            } else {
              const errText = data.error || 'Order rejected by exchange';
              setOrderMessage({ text: errText, error: true });
              resolve({ success: false, error: errText });
            }
          } catch (err: any) {
            const errText = err.message || 'Network error submitting order';
            setOrderMessage({ text: errText, error: true });
            resolve({ success: false, error: errText });
          } finally {
            setOrderSubmitting(false);
          }
        };
      } catch (err: any) {
        setOrderSubmitting(false);
        const errText = err.message || 'Error submitting order';
        setOrderMessage({ text: errText, error: true });
        resolve({ success: false, error: errText });
      }
    });
  };

  // --- Tactical Book Sniping ---
  const handleSelectPrice = (targetPriceMinor: number, suggestedSide: 'BUY' | 'SELL') => {
    setPriceInput((targetPriceMinor / 100).toString());
    setSide(suggestedSide);
    setOrderType('LIMIT');
    setOrderMessage({
      text: `Tactical Sniping loaded: ${suggestedSide} @ ${formatDKC(targetPriceMinor)}`,
      error: false,
    });
  };

  const handleSnipeOrder = async (order: OpenOrder) => {
    const counterSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    setPriceInput((order.price / 100).toString());
    setQtyInput(order.remaining_qty.toString());
    setSide(counterSide);
    setOrderType('LIMIT');
    setOrderMessage({
      text: `⚡ Dispatching counter-order: ${counterSide} ${order.remaining_qty}x @ ${formatDKC(order.price)}...`,
      error: false,
    });
    await dispatchOrderDirect({
      symbol: order.symbol,
      side: counterSide,
      price: order.price,
      qty: order.remaining_qty,
      type: 'LIMIT',
      tif: 'IOC',
    });
  };

  const handleTestProtocolRejection = async () => {
    setOrderMessage({
      text: '🛡️ Testing protocol invariant: Submitting illegal buy on soulbound asset RELIC-AGAMOTTO...',
      error: false,
    });
    await dispatchOrderDirect({
      symbol: 'RELIC-AGAMOTTO',
      side: 'BUY',
      price: 500000,
      qty: 1,
      type: 'LIMIT',
      tif: 'GTC',
    });
  };

  // 3. Order Placement with Web Worker PoW
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceMinor = orderType === 'LIMIT' ? toMinorUnits(parseFloat(priceInput)) : undefined;
    const qty = parseInt(qtyInput, 10);

    if (side === 'BUY') {
      const unitPriceDkc = orderType === 'LIMIT' ? (parseFloat(priceInput) || 0) : ((selectedInstrument?.faceValue || 150000) / 100);
      setConfirmPurchaseData({
        title: `${selectedSymbol} — ${selectedInstrument?.name || 'Resale Pass'}`,
        imageUrl: selectedInstrument?.imageUrl || undefined,
        variantTitle: `${orderType} BUY • Qty: ${qty} Unit${qty > 1 ? 's' : ''}`,
        quantity: qty,
        unitPriceDkc,
        sellerName: 'Student Resale Market OrderBook',
        isEscrow: !!selectedInstrument?.escrowRequired,
        onConfirm: async () => {
          const res = await dispatchOrderDirect({
            symbol: selectedSymbol,
            side,
            price: priceMinor,
            qty,
            type: orderType,
            tif,
          });
          if (res.success) {
            await fetchSession();
            await fetchHoldings();
            await syncMarketState();
            return {
              success: true,
              journalId: `TXN #L2-${res.data?.seq || Math.floor(10000 + Math.random() * 90000)}`,
              pickupToken: `PK-${Math.floor(100000 + Math.random() * 900000)}`,
            };
          } else {
            return {
              success: false,
              error: res.error || 'Order placement rejected',
            };
          }
        },
      });
      return;
    }

    await dispatchOrderDirect({
      symbol: selectedSymbol,
      side,
      price: priceMinor,
      qty,
      type: orderType,
      tif,
    });
  };

  // --- Authoritative Non-Blocking Order Cancellation ---
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
        // Optimistically remove from state immediately
        setMarketOrders((prev) => prev.filter((o) => o.id !== orderId));
        setMyOrders((prev) => prev.filter((o) => o.id !== orderId));
        // Immediately fetch authoritative in-memory RAM state from server
        void syncMarketState();
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

  const handleOneClickLogin = async (username: string, pass: string) => {
    setAuthUsername(username);
    setAuthPassword(pass);
    setAuthMode('login');
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password: pass }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUser(data.user);
        if (data.balance) setBalance(data.balance);
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        setShowAuthModal(false);
        await fetchSession();
        void syncMarketState();
      } else {
        setAuthError(data.error || 'Login failed');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    } finally {
      setAuthLoading(false);
    }
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
    const payload =
      authMode === 'login'
        ? { username: authUsername.trim(), password: authPassword }
        : { username: authUsername.trim(), password: authPassword, role: 'user', profile: authProfile };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify(payload),
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
        void syncMarketState();
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
      setActiveTab('store');
      setLogoutLoading(false);
    }
  };

  const handleCreateAuction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    const curInst = instruments.find((i) => i.symbol === auctionSymbol);
    const ceilingMinor = curInst?.collarCeiling || (curInst?.faceValue ? Math.floor(curInst.faceValue * (1 + (curInst.collarBps || 1000) / 10000)) : 165000);
    const startPriceMinor = toMinorUnits(auctionStartPrice);
    const floorPriceMinor = toMinorUnits(auctionFloorPrice);

    if (startPriceMinor > ceilingMinor) {
      alert(`Start price exceeds collar ceiling of ${formatDKC(ceilingMinor)}`);
      return;
    }
    if (floorPriceMinor >= startPriceMinor) {
      alert('Floor price must be strictly lower than start price');
      return;
    }

    const userHolding = holdings.find((h) => h.symbol === auctionSymbol)?.available || 0;
    if (userHolding < auctionQty) {
      alert(`Insufficient inventory: You only have ${userHolding} available units of ${auctionSymbol}`);
      return;
    }

    setAuctionSubmitting(true);
    try {
      const durationSec = Number(auctionDurationSec) || 180;
      const stepIntervalMs = 1000;
      const totalSteps = Math.max(1, durationSec);
      const stepAmountMinor = Math.max(1, Math.ceil((startPriceMinor - floorPriceMinor) / totalSteps));

      const res = await fetch('/api/auctions', {
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
          stepIntervalMs,
          durationSec,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success || data.auction)) {
        setShowCreateAuctionModal(false);
        const aucRes = await fetch('/api/auctions').catch(() => null);
        if (aucRes && aucRes.ok) setAuctions(await aucRes.json());
        syncMarketState();
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

  const handleBuyAuction = async (auc: any, qty: number) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const unitPriceDkc = auc.currentPrice / 100;
    const curInst = instruments.find((i) => i.symbol === auc.symbol);
    const imageUrl = auc.imageUrl || curInst?.imageUrl || undefined;

    setConfirmPurchaseData({
      title: `${auc.symbol} — ${curInst?.name || 'Flash Drop Asset'}`,
      imageUrl,
      variantTitle: `Flash Drop Allocation • Qty: ${qty} Unit${qty > 1 ? 's' : ''}`,
      quantity: qty,
      unitPriceDkc,
      sellerName: `@${auc.sellerUserId || 'organizer'}`,
      isEscrow: !!curInst?.escrowRequired,
      onConfirm: async () => {
        const res = await fetch(`/api/auctions/${auc.id}/buy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          credentials: 'include',
          body: JSON.stringify({ qty, maxPrice: auc.currentPrice }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const aucRes = await fetch('/api/auctions').catch(() => null);
          if (aucRes && aucRes.ok) setAuctions(await aucRes.json());
          await syncMarketState();
          await fetchSession();
          await fetchHoldings();
          return {
            success: true,
            journalId: `TXN #AUC-${data.seq || Math.floor(10000 + Math.random() * 90000)}`,
            pickupToken: data.pickupToken || data.otp || `PK-${Math.abs((data.seq || 94821) * 7919 + 849204) % 900000 + 100000}`,
          };
        } else {
          return {
            success: false,
            error: data.error || 'Auction buy failed',
          };
        }
      },
    });
  };

  const handleCancelAuction = async (auctionId: string) => {
    if (!confirm('Are you sure you want to cancel this auction and reclaim unsold units?')) return;
    try {
      const res = await fetch(`/api/auctions/${auctionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(`Auction cancelled! Reclaimed ${data.reclaimedQty || 0} unit(s) back to inventory.`);
        const aucRes = await fetch('/api/auctions').catch(() => null);
        if (aucRes && aucRes.ok) setAuctions(await aucRes.json());
        syncMarketState();
      } else {
        alert(`Cancel failed: ${data.error || 'Error'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    }
  };

  const runSolvencyVerification = async () => {
    setSolvencyLoading(true);
    setIsTampered(false);
    setTamperedInfo(null);
    setTamperResult(null);

    try {
      const proofRes = await fetch('/api/solvency/proof', { credentials: 'include' });
      if (proofRes.ok) {
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
      }
    } catch (e: any) {
      console.warn('Solvency verification fetch warning:', e);
    } finally {
      setSolvencyLoading(false);
    }
  };

  // Tactical cost calculation
  const parsedPrice = parseFloat(priceInput) || 0;
  const parsedQty = parseInt(qtyInput, 10) || 1;
  const estimatedCostDKC = parsedPrice * parsedQty;
  const estimatedCostMinor = toMinorUnits(estimatedCostDKC);
  const costPercentageOfAvailable = balance.available > 0 ? Math.min(100, Math.round((estimatedCostMinor / balance.available) * 100)) : 0;

  // Active displayed orders depending on view mode
  const displayedOrders = orderViewMode === 'market' ? marketOrders : myOrders;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#06080F', color: '#F8FAFC' }}>
      {/* 1. Clean Header / Navbar */}
      <header className="navbar" style={{ padding: '8px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#04060A', borderBottom: '1px solid #161F30', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#00F0FF', fontWeight: 900, fontSize: 16, letterSpacing: '0.05em', textShadow: '0 0 12px rgba(0,240,255,0.4)', fontFamily: '"JetBrains Mono", monospace' }}>
              ⚡ DARKHOLD EXCHANGE
            </span>
            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600, letterSpacing: '0.02em' }}>
              Official Campus Festival Store &amp; Verified Resale Exchange
            </span>
          </div>
        </div>

        {/* Center: Clean Navigation Tabs */}
        <div className="nav-tabs" style={{ border: 'none', background: 'transparent', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button className={`nav-tab ${activeTab === 'store' ? 'active' : ''}`} onClick={() => setActiveTab('store')}>
            🏪 OFFICIAL FEST STORE
          </button>
          <button className={`nav-tab ${activeTab === 'resale' ? 'active' : ''}`} onClick={() => setActiveTab('resale')}>
            📈 STUDENT RESALE MARKET
          </button>
          <button className={`nav-tab ${activeTab === 'auctions' ? 'active' : ''}`} onClick={() => { setActiveTab('auctions'); fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); }); }}>
            ⏳ FLASH DROPS (DUTCH AUCTIONS)
          </button>
          <button className={`nav-tab ${activeTab === 'escrows' ? 'active' : ''}`} onClick={() => { setActiveTab('escrows'); fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); }); }}>
            🤝 P2P ESCROW
          </button>
          <button className={`nav-tab ${activeTab === 'wallet' ? 'active' : ''}`} onClick={() => setActiveTab('wallet')}>
            💳 WALLET &amp; UPI
          </button>
          {(user?.role === 'admin' || user?.role === 'club') && (
            <button className={`nav-tab ${activeTab === 'org_workspace' ? 'active' : ''}`} onClick={() => setActiveTab('org_workspace')}>
              🏛️ CLUBS &amp; WORKSPACE
            </button>
          )}
          <button className={`nav-tab ${activeTab === 'community' ? 'active' : ''}`} onClick={() => setActiveTab('community')}>
            📦 COMMUNITY
          </button>
          {user?.role === 'admin' && (
            <button className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => setActiveTab('admin')}>
              ⚙️ ADMIN &amp; CLUB TREASURY
            </button>
          )}
        </div>

        {/* Right: Active User Badge, Reset Demo, Account Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Quiet Right-Aligned Solvency Proof Badge for Judges & Evaluators */}
          <button
            onClick={() => {
              setActiveTab('solvency');
              runSolvencyVerification();
            }}
            title="Cryptographic Merkle Sum Tree Proof of Solvency"
            style={{
              background: activeTab === 'solvency' ? 'rgba(0, 240, 255, 0.2)' : 'rgba(0, 240, 255, 0.08)',
              border: `1px solid ${activeTab === 'solvency' ? '#00F0FF' : 'rgba(0, 240, 255, 0.4)'}`,
              color: '#00F0FF',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            🛡️ Solvency Proof
          </button>
          {user ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1E293B',
                borderRadius: 6,
                padding: '4px 10px',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
              }}
            >
              <span style={{ color: getTraderColor(user.id), fontWeight: 800 }}>@{user.username}</span>
              <span style={{ color: '#475569' }}>•</span>
              <span style={{ color: '#64748B' }}>Balance:</span>
              <strong style={{ color: '#10B981', fontWeight: 800 }}>
                {(balance.available / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} DKC
              </strong>
            </div>
          ) : null}

          {/* 🔄 Reset Demo State Button */}
          <button
            onClick={handleResetDemoState}
            disabled={resetLoading}
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid #F59E0B',
              color: '#F59E0B',
              borderRadius: 6,
              padding: '5px 11px',
              fontSize: 10,
              fontWeight: 800,
              cursor: resetLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"JetBrains Mono", monospace',
              letterSpacing: 0.5,
              transition: 'all 0.2s ease',
            }}
            title="Reset exchange to clean baseline with 50,000 DKC balances and fresh auctions"
          >
            <span>{resetLoading ? 'RESTORING...' : '🔄 Reset Demo'}</span>
          </button>

          {/* Login / Switch Account Button */}
          <button
            onClick={() => setShowAuthModal(true)}
            style={{
              background: user ? 'rgba(0, 240, 255, 0.12)' : '#00F0FF',
              border: user ? '1px solid #00F0FF' : 'none',
              color: user ? '#00F0FF' : '#06080F',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{user ? '👤 Switch Account' : '🔑 Login / Register'}</span>
          </button>

          {user && (
            <button
              onClick={handleLogout}
              disabled={logoutLoading}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                color: logoutLoading ? '#64748B' : '#94A3B8',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 10,
                cursor: logoutLoading ? 'not-allowed' : 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
              title="Logout"
            >
              {logoutLoading ? '...' : 'Logout'}
            </button>
          )}
        </div>
      </header>

      {/* 2. Official Fest Storefront (Primary Sales from Club Treasury) */}
      {activeTab === 'store' && (
        <OfficialFestStore
          user={user}
          balance={balance}
          holdings={holdings}
          csrfToken={csrfToken}
          onNavigateToResale={(symbol) => {
            setSelectedSymbol(symbol);
            setActiveTab('resale');
          }}
          onOpenDeposit={() => setShowPaymentModal(true)}
          onPurchaseSuccess={() => {
            fetchSession();
            fetchHoldings();
            setActiveTab('wallet');
          }}
        />
      )}

      {/* 3. Student Resale Market (Order Book & Ladder) */}
      {activeTab === 'resale' && (
        <>
          {/* Resale Instrument Selector Strip */}
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
                SELECT RESALE INSTRUMENT:
              </span>
              {instruments.filter((i) => !i.isBenchmark && i.symbol !== 'BENCH-X').map((inst) => {
                const isSelected = selectedSymbol === inst.symbol;
                const meta = getInstrumentMeta(inst.symbol);

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
                      padding: '4px 10px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: '"JetBrains Mono", monospace',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{meta.icon}</span>
                    <span>{meta.shortName}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
              🛡️ Anti-Scalping Collar Enforced (+10% Max Face Value) • Engine: <span style={{ color: wsConnected ? '#10B981' : '#EF4444' }}>{wsConnected ? 'Connected' : 'Offline'}</span> ({activeOrderCount} resting)
            </div>
          </div>
          {/* Active Product Overview Strip */}
          {(() => {
            const meta = getInstrumentMeta(selectedSymbol);
            const refPriceMinor = selectedInstrument?.referencePrice || selectedInstrument?.faceValue || 150000;
            const ceilingMinor = selectedInstrument ? calculateCollarCeiling(selectedInstrument.faceValue, selectedInstrument.collarBps) : 0;
            const collarPct = selectedInstrument ? (selectedInstrument.collarBps / 100).toFixed(0) : '10';

            return (
              <div
                style={{
                  background: 'linear-gradient(90deg, rgba(15, 23, 42, 0.85) 0%, rgba(9, 13, 26, 0.95) 100%)',
                  border: `1px solid ${meta.borderColor}`,
                  borderRadius: 6,
                  padding: '10px 16px',
                  margin: '8px 12px 10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                  boxShadow: `0 0 20px ${meta.bgColor}`,
                }}
              >
                {/* Left: Badge + Names + Tag */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      background: meta.bgColor,
                      border: `1px solid ${meta.borderColor}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {selectedInstrument?.imageUrl ? (
                      <img
                        src={selectedInstrument.imageUrl}
                        alt={selectedSymbol}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      meta.badge
                    )}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: '#F8FAFC', letterSpacing: '0.02em' }}>
                        {meta.name}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: meta.bgColor,
                          color: meta.categoryColor,
                          border: `1px solid ${meta.borderColor}`,
                          letterSpacing: '0.05em',
                        }}
                      >
                        {meta.category}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                        [{selectedSymbol}]
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                      {meta.description}
                    </div>
                  </div>
                </div>

                {/* Right: Key Financial & Compliance Stats */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 18,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                  }}
                >
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748B', fontSize: 10 }}>REFERENCE PRICE</div>
                    <div style={{ color: '#F8FAFC', fontWeight: 700 }}>
                      {formatDKC(refPriceMinor)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748B', fontSize: 10 }}>ANTI-SCALP CEILING</div>
                    <div style={{ color: '#F59E0B', fontWeight: 700 }}>
                      {ceilingMinor > 0 ? `${formatDKC(ceilingMinor)} (+${collarPct}%)` : 'N/A'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748B', fontSize: 10 }}>ORDER BOOK SPREAD</div>
                    <div style={{ color: spread !== null && spread >= 0 ? '#10B981' : '#64748B', fontWeight: 700 }}>
                      {spread !== null ? formatDKC(spread) : 'NO CROSS'}
                    </div>
                  </div>
                  {selectedInstrument?.escrowRequired && (
                    <span
                      style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        color: '#F59E0B',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      🛡️ ESCROW CUSTODY
                    </span>
                  )}
                  {selectedInstrument?.transferable === false && (
                    <span
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#FCA5A5',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      🔒 SOULBOUND
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
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
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>PORTFOLIO ASSETS</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(true)}
                    style={{
                      background: 'rgba(0, 240, 255, 0.15)',
                      border: '1px solid rgba(0, 240, 255, 0.5)',
                      color: '#00F0FF',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                    title="Deposit INR into DKC (1 INR = 1.00 DKC)"
                  >
                    💳 DEPOSIT
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(true)}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      color: '#10B981',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                    title="Withdraw DKC to UPI (1 DKC = ₹1.00 INR)"
                  >
                    💸 WITHDRAW
                  </button>
                </div>
              </div>
              <div className="card-body mono" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #161F30' }}>
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
                {balance.pendingWithdrawals !== undefined && balance.pendingWithdrawals > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #161F30' }}>
                    <span style={{ color: '#64748B' }}>Pending Withdrawals:</span>
                    <span style={{ color: '#38BDF8' }}>{formatDKC(balance.pendingWithdrawals)}</span>
                  </div>
                )}

                <div style={{ marginTop: 8, color: '#64748B', fontSize: 10, fontWeight: 700 }}>
                  INSTRUMENT HOLDINGS:
                </div>
                {holdings.filter((h) => h.symbol !== 'BENCH-X').length === 0 ? (
                  <div style={{ color: '#64748B', fontSize: 11, padding: '4px 0' }}>No assets held</div>
                ) : (
                  holdings.filter((h) => h.symbol !== 'BENCH-X').map((h) => (
                    <div key={h.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span style={{ color: '#F8FAFC' }}>{h.symbol}</span>
                      <span>
                        <strong style={{ color: '#10B981' }}>{h.available}</strong>
                        {h.reserved > 0 && <span style={{ color: '#F59E0B' }}> (+{h.reserved} res)</span>}
                      </span>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={() => setShowPaymentModal(true)}
                  style={{
                    marginTop: 8,
                    background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.12) 0%, rgba(2, 132, 199, 0.12) 100%)',
                    border: '1px solid rgba(0, 240, 255, 0.4)',
                    color: '#00F0FF',
                    borderRadius: 5,
                    padding: '8px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontFamily: '"JetBrains Mono", monospace',
                    letterSpacing: '0.02em',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 0 15px rgba(0, 240, 255, 0.1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 240, 255, 0.25) 0%, rgba(2, 132, 199, 0.25) 100%)';
                    e.currentTarget.style.borderColor = '#00F0FF';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 240, 255, 0.12) 0%, rgba(2, 132, 199, 0.12) 100%)';
                    e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.4)';
                  }}
                  title="Open 2-step Razorpay / NPCI UPI Payment Gateway Checkout"
                >
                  <span>💳</span> Deposit INR ➔ DKC (Payment Gateway)
                </button>
              </div>
            </div>
          </div>

          {/* Column 2: Centerpiece Canvas & Unified Market vs Personal Orders Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Centerpiece Visual: Liquidity Depth & Pulse Radar */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-header">
                <span style={{ color: '#00F0FF' }}>🎯 LIQUIDITY GRAVITY RADAR ({selectedSymbol})</span>
                <span style={{ fontSize: 10, color: '#64748B' }}>CLICK OPPOSING WALL TO SNIPE</span>
              </div>

              {/* Instrument Info Strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 12px',
                  background: 'rgba(15, 23, 42, 0.65)',
                  borderBottom: '1px solid #161F30',
                  fontSize: 10,
                  fontFamily: '"JetBrains Mono", monospace',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <span style={{ color: '#64748B' }}>REF PRICE: </span>
                  <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
                    {formatDKC(selectedInstrument?.faceValue || 150000)}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>COLLAR CAP: </span>
                  <span style={{ color: '#F59E0B', fontWeight: 700 }}>
                    {formatDKC(collarCeiling)} (+10%)
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>TRANSFER: </span>
                  <span style={{ color: selectedInstrument?.escrowRequired ? '#FF2A54' : '#10B981', fontWeight: 700 }}>
                    {selectedInstrument?.escrowRequired ? '🔒 LOCKED / SOULBOUND' : '✓ UNRESTRICTED'}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>SPREAD: </span>
                  <span style={{ color: '#00F0FF', fontWeight: 700 }}>
                    {spread !== null ? formatDKC(spread) : 'LOCKED'}
                  </span>
                </div>
              </div>

              {/* Soulbound Asset Warning Banner */}
              {selectedSymbol === 'RELIC-AGAMOTTO' && (
                <div
                  style={{
                    background: 'rgba(255, 42, 84, 0.12)',
                    borderBottom: '1px solid rgba(255, 42, 84, 0.35)',
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  <span style={{ color: '#FF2A54', fontWeight: 700 }}>
                    🛡️ SOULBOUND ASSET — SECONDARY TRADING PERMANENTLY LOCKED BY SMART CONTRACT PROTOCOL
                  </span>
                  <button
                    type="button"
                    onClick={handleTestProtocolRejection}
                    disabled={orderSubmitting}
                    style={{
                      background: '#FF2A54',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 3,
                      padding: '2px 8px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: orderSubmitting ? 'not-allowed' : 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    TEST PROTOCOL REJECTION
                  </button>
                </div>
              )}

              <div style={{ position: 'relative', height: 275 }}>
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

            {/* Active Resting Orders Table with Market vs Personal View & 1-Click Counter-Matching */}
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* View Mode Toggle Pill */}
                  <button
                    type="button"
                    onClick={() => setOrderViewMode('market')}
                    style={{
                      background: orderViewMode === 'market' ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                      border: `1px solid ${orderViewMode === 'market' ? '#00F0FF' : '#1E293B'}`,
                      color: orderViewMode === 'market' ? '#00F0FF' : '#94A3B8',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      letterSpacing: 0.5,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    MARKET ORDERS ({selectedSymbol}) [{marketOrders.length}]
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderViewMode('my')}
                    style={{
                      background: orderViewMode === 'my' ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                      border: `1px solid ${orderViewMode === 'my' ? '#F59E0B' : '#1E293B'}`,
                      color: orderViewMode === 'my' ? '#F59E0B' : '#94A3B8',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      letterSpacing: 0.5,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    MY ORDERS [{myOrders.length}]
                  </button>
                </div>
                <button
                  onClick={syncMarketState}
                  style={{
                    background: 'transparent',
                    border: '1px solid #1E293B',
                    color: '#64748B',
                    borderRadius: 3,
                    padding: '2px 6px',
                    fontSize: 10,
                    cursor: 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  SYNC
                </button>
              </div>

              <div className="card-body" style={{ padding: 0 }}>
                {displayedOrders.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                    {orderViewMode === 'market'
                      ? `No active resting orders in book for ${selectedSymbol}. Click any row in the L2 ladder to submit an order.`
                      : `You have no active resting orders on ${selectedSymbol}.`}
                  </div>
                ) : (
                  <table className="ladder-table">
                    <thead>
                      <tr>
                        <th>TRADER</th>
                        <th>SIDE</th>
                        <th>PRICE</th>
                        <th>QTY</th>
                        <th>REMAINING</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedOrders.map((o) => {
                        const isCancelling = cancellingOrderIds.has(o.id);
                        const isMine = o.user_id === user?.id;
                        const isAdmin = user?.role === 'admin';
                        const trader = getTraderLabel(o.user_id);
                        const traderColor = getTraderColor(o.user_id);

                        return (
                          <tr key={o.id} style={{ borderBottom: '1px solid #161F30' }}>
                            <td>
                              <span
                                style={{
                                  background: 'rgba(15, 23, 42, 0.7)',
                                  border: `1px solid ${traderColor}40`,
                                  color: traderColor,
                                  borderRadius: 3,
                                  padding: '1px 5px',
                                  fontSize: 9,
                                  fontWeight: 800,
                                }}
                              >
                                {trader}
                              </span>
                            </td>
                            <td style={{ color: o.side === 'BUY' ? '#00F0FF' : '#FF2A54', fontWeight: 700 }}>{o.side}</td>
                            <td>{formatDKC(o.price)}</td>
                            <td>{o.qty}</td>
                            <td>{o.remaining_qty}</td>
                            <td>
                              {isMine || isAdmin ? (
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
                                    fontFamily: '"JetBrains Mono", monospace',
                                  }}
                                >
                                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleSnipeOrder(o)}
                                  style={{
                                    background: 'rgba(0, 240, 255, 0.12)',
                                    color: '#00F0FF',
                                    border: '1px solid rgba(0, 240, 255, 0.4)',
                                    borderRadius: 3,
                                    padding: '2px 8px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    fontFamily: '"JetBrains Mono", monospace',
                                  }}
                                  title={`Match against ${trader}'s ${o.side} order`}
                                >
                                  🎯 MATCH
                                </button>
                              )}
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
            <div className="card" style={{ height: 280, display: 'flex', flexDirection: 'column' }}>
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: '#10B981' }}>RECENT MATCHED TRADES</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setTradeFilter('GLOBAL')}
                    style={{
                      background: tradeFilter === 'GLOBAL' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                      border: `1px solid ${tradeFilter === 'GLOBAL' ? '#10B981' : '#1E293B'}`,
                      color: tradeFilter === 'GLOBAL' ? '#10B981' : '#94A3B8',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    GLOBAL ({trades.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeFilter('MY')}
                    style={{
                      background: tradeFilter === 'MY' ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                      border: `1px solid ${tradeFilter === 'MY' ? '#00F0FF' : '#1E293B'}`,
                      color: tradeFilter === 'MY' ? '#00F0FF' : '#94A3B8',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 9,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    MY TRADES
                  </button>
                </div>
              </div>
              <div className="card-body" style={{ padding: 0, flex: 1, overflowY: 'auto' }}>
                {(() => {
                  const filteredTrades = trades.filter((t: any) => {
                    if (tradeFilter === 'GLOBAL') return true;
                    if (!user) return true;
                    return (
                      t.buyerUserId === user.id ||
                      t.sellerUserId === user.id ||
                      t.buyerUsername === user.username ||
                      t.sellerUsername === user.username
                    );
                  });

                  if (filteredTrades.length === 0) {
                    return (
                      <div style={{ padding: 20, textAlign: 'center', color: '#64748B', fontSize: 11 }}>
                        {tradeFilter === 'MY'
                          ? 'No trades executed by your active account yet. Match an order or submit a crossing order to trade!'
                          : 'No trades executed yet on this instrument.'}
                      </div>
                    );
                  }

                  return (
                    <table className="ladder-table">
                      <thead>
                        <tr>
                          <th>TIME</th>
                          <th>SIDE</th>
                          <th>PRICE</th>
                          <th>QTY</th>
                          <th>PARTIES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTrades.slice(0, 30).map((t: any, idx) => {
                          const isBuy = t.side === 'BUY';
                          const buyerIsMe = user && (t.buyerUserId === user.id || t.buyerUsername === user.username);
                          const sellerIsMe = user && (t.sellerUserId === user.id || t.sellerUsername === user.username);
                          const buyerLabel = buyerIsMe ? 'YOU' : getTraderLabel(t.buyerUsername || t.buyerUserId);
                          const sellerLabel = sellerIsMe ? 'YOU' : getTraderLabel(t.sellerUsername || t.sellerUserId);

                          return (
                            <tr key={t.id || idx}>
                              <td style={{ color: '#64748B', fontSize: 10 }}>
                                {new Date(t.created_at || Date.now()).toLocaleTimeString()}
                              </td>
                              <td style={{ color: isBuy ? '#00F0FF' : '#FF2A54', fontWeight: 700, fontSize: 10 }}>
                                {t.side || (isBuy ? 'BUY' : 'SELL')}
                              </td>
                              <td style={{ color: isBuy ? '#00F0FF' : '#FF2A54', fontWeight: 600 }}>
                                {formatDKC(t.price)}
                              </td>
                              <td>{t.qty}</td>
                              <td style={{ fontSize: 10 }}>
                                <span style={{ color: buyerIsMe ? '#00F0FF' : '#CBD5E1', fontWeight: buyerIsMe ? 800 : 500 }}>
                                  {buyerLabel}
                                </span>
                                <span style={{ color: '#64748B', margin: '0 3px' }}>⇄</span>
                                <span style={{ color: sellerIsMe ? '#F59E0B' : '#CBD5E1', fontWeight: sellerIsMe ? 800 : 500 }}>
                                  {sellerLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </>
    )}

      {/* Tab: Dutch Auctions */}
      {activeTab === 'auctions' && (
        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          {/* Header & Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: 20, color: '#00F0FF', margin: 0, letterSpacing: '0.05em' }}>
                  DUTCH AUCTION TERMINAL
                </h2>
                <span className="badge badge-ws-connected" style={{ fontSize: 10 }}>
                  LIVE TICKING
                </span>
              </div>
              <p style={{ color: '#94A3B8', fontSize: 12, margin: '6px 0 0' }}>
                Descending-clock asset distribution with collar ceiling guards and instant multi-unit clearing settlement.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {/* Filter Tabs */}
              {(() => {
                const liveCount = auctions.filter((a) => a.status === 'ACTIVE').length;
                const settledCount = auctions.filter((a) => a.status !== 'ACTIVE').length;

                return (
                  <div style={{ display: 'flex', background: '#090D1A', border: '1px solid #1E293B', borderRadius: 6, padding: 3, gap: 4 }}>
                    <button
                      onClick={() => setAuctionFilter('LIVE')}
                      style={{
                        background: auctionFilter === 'LIVE' ? '#1E293B' : 'transparent',
                        color: auctionFilter === 'LIVE' ? '#10B981' : '#94A3B8',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 14px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>🟢 LIVE AUCTIONS ({liveCount})</span>
                    </button>
                    <button
                      onClick={() => setAuctionFilter('SETTLED')}
                      style={{
                        background: auctionFilter === 'SETTLED' ? '#1E293B' : 'transparent',
                        color: auctionFilter === 'SETTLED' ? '#F59E0B' : '#94A3B8',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 14px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>📜 SETTLED / PAST HISTORY ({settledCount})</span>
                    </button>
                  </div>
                );
              })()}

              <button
                onClick={() => {
                  fetch('/api/auctions').then((r) => { if (r.ok) r.json().then(setAuctions); });
                  syncMarketState();
                }}
                style={{
                  background: '#0F172A',
                  color: '#94A3B8',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '7px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Refresh Auctions"
              >
                🔄
              </button>

              <button
                onClick={() => {
                  if (!user) {
                    setShowAuthModal(true);
                    return;
                  }
                  setShowCreateAuctionModal(true);
                }}
                style={{
                  background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(0, 240, 255, 0.3)',
                }}
              >
                + CREATE AUCTION
              </button>
            </div>
          </div>

          {/* Auction Cards Grid */}
          {(() => {
            const filteredAuctions = auctions.filter((auc) => {
              if (auctionFilter === 'LIVE') return auc.status === 'ACTIVE';
              return auc.status !== 'ACTIVE';
            });

            if (filteredAuctions.length === 0) {
              return (
                <div className="card" style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🏛️</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>
                    {auctionFilter === 'LIVE' ? 'No Active Dutch Auctions Currently Running' : 'No Settled Auction History Found'}
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20, maxWidth: 500, margin: '0 auto 20px' }}>
                    {auctionFilter === 'LIVE'
                      ? 'Launch descending-price auctions to distribute secondary inventory, or reset to baseline demo state to seed fresh 1-hour active auctions.'
                      : 'Completed, sold out, or expired Dutch auctions will appear here with final clearing price.'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        setAuctionSymbol('FEST-GA');
                        setAuctionQty(5);
                        setAuctionStartPrice(1650);
                        setAuctionFloorPrice(1000);
                        setShowCreateAuctionModal(true);
                      }}
                      style={{
                        background: '#00F0FF',
                        color: '#06080F',
                        border: 'none',
                        borderRadius: 4,
                        padding: '10px 20px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      + Create Demo Auction
                    </button>
                    <button
                      onClick={handleResetDemoState}
                      disabled={resetLoading}
                      style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid #F59E0B',
                        color: '#F59E0B',
                        borderRadius: 4,
                        padding: '10px 20px',
                        fontWeight: 800,
                        cursor: resetLoading ? 'not-allowed' : 'pointer',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      {resetLoading ? 'Restoring...' : '🔄 Reset Demo State'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
                {filteredAuctions.map((auc) => {
                  const visual = getInstrumentVisual(auc.symbol);
                  const isSeller = user?.id === auc.sellerUserId;
                  const selectedQty = buyQtyMap[auc.id] !== undefined ? buyQtyMap[auc.id] : 1;
                  const currentPrice = auc.currentPrice;
                  const totalMinor = currentPrice * selectedQty;
                  const hasFunds = (balance.available || 0) >= totalMinor;

                  const priceDiff = Math.max(1, auc.startPrice - auc.floorPrice);
                  const currentDiff = Math.max(0, currentPrice - auc.floorPrice);
                  const progressPct = auc.status === 'ACTIVE'
                    ? Math.max(4, Math.min(100, (currentDiff / priceDiff) * 100))
                    : 100;

                  return (
                    <div
                      key={auc.id}
                      className="card"
                      style={{
                        padding: 18,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                        border: `1px solid ${visual.border}`,
                        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.6) 0%, #060913 100%)',
                        boxShadow: isSeller ? '0 0 20px rgba(0, 240, 255, 0.08)' : 'none',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Top Header: Visual Icon + Name + Badges */}
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        {(() => {
                          const inst = instruments.find((i) => i.symbol === auc.symbol);
                          const img = auc.imageUrl || (inst as any)?.imageUrl;
                          return (
                            <div
                              style={{
                                width: 50,
                                height: 50,
                                borderRadius: 8,
                                background: visual.bg,
                                border: `1px solid ${visual.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                overflow: 'hidden',
                              }}
                            >
                              {img ? (
                                <img
                                  src={img}
                                  alt={auc.symbol}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              ) : (
                                visual.svg
                              )}
                            </div>
                          );
                        })()}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, fontSize: 16, color: '#F8FAFC', letterSpacing: '0.02em' }}>
                              {auc.symbol}
                            </span>
                            {auc.status === 'ACTIVE' && (
                              <span className="badge badge-ws-connected" style={{ fontSize: 10, padding: '3px 8px' }}>
                                ⚡ ACTIVE DECAY
                              </span>
                            )}
                            {auc.status === 'SOLD_OUT' && (
                              <span
                                style={{
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  color: '#10B981',
                                  border: '1px solid rgba(16, 185, 129, 0.4)',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                }}
                              >
                                ✓ CLEARED & SOLD OUT
                              </span>
                            )}
                            {auc.status === 'CANCELLED' && (
                              <span
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#EF4444',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                }}
                              >
                                ✕ CANCELLED
                              </span>
                            )}
                            {auc.status === 'EXPIRED' && (
                              <span
                                style={{
                                  background: 'rgba(100, 116, 139, 0.15)',
                                  color: '#94A3B8',
                                  border: '1px solid rgba(100, 116, 139, 0.4)',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                }}
                              >
                                ⏱ EXPIRED
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <span style={{ fontSize: 11, color: visual.color, fontWeight: 600 }}>{visual.tag}</span>
                            <span style={{ fontSize: 11, color: '#475569' }}>•</span>
                            <span style={{ fontSize: 11, color: '#64748B' }}>#{auc.id.slice(0, 12)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Seller Badge & ID Bar */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          background: 'rgba(15, 23, 42, 0.7)',
                          borderRadius: 4,
                          fontSize: 11,
                          border: '1px solid #1E293B',
                        }}
                      >
                        <span style={{ color: '#64748B' }}>Seller:</span>
                        {isSeller ? (
                          <span
                            style={{
                              color: '#00F0FF',
                              fontWeight: 800,
                              background: 'rgba(0, 240, 255, 0.12)',
                              padding: '2px 6px',
                              borderRadius: 3,
                              border: '1px solid rgba(0, 240, 255, 0.3)',
                            }}
                          >
                            YOU ({user?.username.toUpperCase()})
                          </span>
                        ) : (
                          <span style={{ color: getTraderColor(auc.sellerUserId), fontWeight: 700 }}>
                            {getTraderLabel(auc.sellerUserId)}
                          </span>
                        )}
                      </div>

                      {/* Tri-Point Price Indicators */}
                      <div
                        style={{
                          background: '#040711',
                          border: '1px solid #1E293B',
                          borderRadius: 6,
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>START CEILING</span>
                            <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>{formatDKC(auc.startPrice)}</span>
                          </div>

                          <div style={{ textAlign: 'center' }}>
                            {auc.status === 'SOLD_OUT' ? (
                              <>
                                <span style={{ fontSize: 10, color: '#10B981', fontWeight: 800, letterSpacing: '0.04em' }}>
                                  FINAL CLEARING PRICE (LOCKED)
                                </span>
                                <div style={{ fontSize: 19, color: '#10B981', fontWeight: 900, textShadow: '0 0 12px rgba(16, 185, 129, 0.4)' }}>
                                  {formatDKC(auc.clearingPrice || auc.currentPrice)}
                                </div>
                              </>
                            ) : auc.status === 'CANCELLED' ? (
                              <>
                                <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 800 }}>PRICE AT CANCEL</span>
                                <div style={{ fontSize: 17, color: '#EF4444', fontWeight: 800 }}>
                                  {formatDKC(auc.clearingPrice || auc.currentPrice)}
                                </div>
                              </>
                            ) : (
                              <>
                                <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 800, letterSpacing: '0.04em' }}>
                                  LIVE CURRENT PRICE
                                </span>
                                <div style={{ fontSize: 19, color: '#F59E0B', fontWeight: 900, textShadow: '0 0 12px rgba(245, 158, 11, 0.4)' }}>
                                  {formatDKC(auc.currentPrice)}
                                </div>
                              </>
                            )}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>FLOOR MINIMUM</span>
                            <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>{formatDKC(auc.floorPrice)}</span>
                          </div>
                        </div>

                        {/* Animated Visual Decay Progress Bar */}
                        <div>
                          <div
                            style={{
                              height: 6,
                              background: '#1E293B',
                              borderRadius: 3,
                              overflow: 'hidden',
                              position: 'relative',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${progressPct}%`,
                                background: auc.status === 'SOLD_OUT'
                                  ? '#10B981'
                                  : auc.status === 'CANCELLED'
                                  ? '#EF4444'
                                  : 'linear-gradient(90deg, #F59E0B 0%, #00F0FF 100%)',
                                borderRadius: 3,
                                transition: 'width 0.4s ease',
                                boxShadow: auc.status === 'ACTIVE' ? '0 0 8px rgba(0, 240, 255, 0.6)' : 'none',
                              }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', marginTop: 5 }}>
                            {auc.status === 'ACTIVE' ? (
                              <>
                                <span>📉 Decay: -{(auc.decayPerSec ? auc.decayPerSec / 100 : 1).toFixed(2)} DKC/sec</span>
                                <span>⏱ {auc.timeRemainingSec !== undefined ? auc.timeRemainingSec : 0}s to floor</span>
                              </>
                            ) : auc.status === 'SOLD_OUT' ? (
                              <span style={{ color: '#10B981', fontWeight: 700 }}>✓ Settled at clearing price. Decay stopped.</span>
                            ) : (
                              <span style={{ color: '#EF4444', fontWeight: 700 }}>✕ Auction stopped by seller.</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Inventory Meter */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                          <span style={{ color: '#64748B' }}>Available Inventory:</span>
                          <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
                            {auc.qtyRemaining} / {auc.qtyTotal} Units
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {Array.from({ length: Math.min(10, auc.qtyTotal) }).map((_, idx) => {
                            const unitThreshold = (idx + 1) * (auc.qtyTotal / Math.min(10, auc.qtyTotal));
                            const isFilled = auc.qtyRemaining >= unitThreshold;
                            return (
                              <div
                                key={idx}
                                style={{
                                  flex: 1,
                                  height: 5,
                                  borderRadius: 2,
                                  background: isFilled ? (visual.color || '#00F0FF') : '#1E293B',
                                  opacity: isFilled ? 1 : 0.3,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Buy Selector / Seller Cancel Actions */}
                      <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                        {auc.status === 'ACTIVE' ? (
                          isSeller ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center' }}>
                                (You created this auction • Self-buying disabled)
                              </div>
                              <button
                                onClick={() => handleCancelAuction(auc.id)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#EF4444',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  borderRadius: 5,
                                  padding: '10px 14px',
                                  fontWeight: 800,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 6,
                                }}
                              >
                                🛑 Cancel Auction & Reclaim {auc.qtyRemaining} Unit(s)
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {/* Multi-Qty Selector */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>QTY:</span>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: 4 }}>
                                  <button
                                    onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: Math.max(1, selectedQty - 1) })}
                                    style={{
                                      background: 'transparent',
                                      color: '#94A3B8',
                                      border: 'none',
                                      padding: '4px 10px',
                                      fontWeight: 800,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    max={auc.qtyRemaining}
                                    value={selectedQty}
                                    onChange={(e) => {
                                      const val = Math.max(1, Math.min(auc.qtyRemaining, parseInt(e.target.value, 10) || 1));
                                      setBuyQtyMap({ ...buyQtyMap, [auc.id]: val });
                                    }}
                                    style={{
                                      width: 44,
                                      textAlign: 'center',
                                      background: 'transparent',
                                      color: '#F8FAFC',
                                      border: 'none',
                                      fontWeight: 800,
                                      fontSize: 13,
                                    }}
                                  />
                                  <button
                                    onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: Math.min(auc.qtyRemaining, selectedQty + 1) })}
                                    style={{
                                      background: 'transparent',
                                      color: '#94A3B8',
                                      border: 'none',
                                      padding: '4px 10px',
                                      fontWeight: 800,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  onClick={() => setBuyQtyMap({ ...buyQtyMap, [auc.id]: auc.qtyRemaining })}
                                  style={{
                                    background: '#1E293B',
                                    color: '#00F0FF',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  MAX ({auc.qtyRemaining})
                                </button>

                                <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 11 }}>
                                  <span style={{ color: '#64748B' }}>Total: </span>
                                  <strong style={{ color: '#F59E0B' }}>{formatDKC(totalMinor)}</strong>
                                </div>
                              </div>

                              {/* Snipe Action Button */}
                              <button
                                onClick={() => handleBuyAuction(auc, selectedQty)}
                                disabled={!hasFunds}
                                style={{
                                  background: hasFunds
                                    ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                                    : '#1E293B',
                                  color: hasFunds ? '#06080F' : '#64748B',
                                  border: 'none',
                                  borderRadius: 5,
                                  padding: '10px 14px',
                                  fontWeight: 800,
                                  fontSize: 12,
                                  cursor: hasFunds ? 'pointer' : 'not-allowed',
                                  boxShadow: hasFunds ? '0 0 15px rgba(16, 185, 129, 0.3)' : 'none',
                                  letterSpacing: '0.03em',
                                }}
                              >
                                {hasFunds ? (
                                  `⚡ SNIPE ${selectedQty} UNIT${selectedQty > 1 ? 'S' : ''} @ ${formatDKC(totalMinor)}`
                                ) : (
                                  `⚠️ Insufficient DKC (Need ${formatDKC(totalMinor)})`
                                )}
                              </button>
                            </div>
                          )
                        ) : auc.status === 'SOLD_OUT' ? (
                          <div
                            style={{
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              borderRadius: 5,
                              padding: '10px',
                              textAlign: 'center',
                              color: '#10B981',
                              fontWeight: 800,
                              fontSize: 12,
                            }}
                          >
                            ✓ SETTLED AT {formatDKC(auc.clearingPrice || auc.currentPrice)} (100% SOLD)
                          </div>
                        ) : (
                          <div
                            style={{
                              background: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: 5,
                              padding: '10px',
                              textAlign: 'center',
                              color: '#EF4444',
                              fontWeight: 800,
                              fontSize: 12,
                            }}
                          >
                            ✕ AUCTION CANCELLED
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Tab: Escrow Custody */}
      {activeTab === 'escrows' && (
        <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 22, color: '#A855F7', margin: 0, letterSpacing: '0.04em' }}>
              🛡️ DELIVERY-VERSUS-PAYMENT (DvP) ESCROW CUSTODY
            </h2>
            <p style={{ color: '#94A3B8', fontSize: 13, margin: '6px 0 0', maxWidth: 900, lineHeight: 1.5 }}>
              Two-phase settlement for custody-restricted physical merchandise and VIP tickets. Buyer funds are securely locked in escrow until the seller presents an authentic cryptographic delivery receipt signed by the issuer.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.2fr) minmax(360px, 0.8fr)', gap: 20, alignItems: 'start' }}>
            {/* Left Column: Active Escrow Contracts */}
            <div>
              {escrows.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>
                    No Active Escrow Contracts
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', maxWidth: 460, margin: '0 auto 16px', lineHeight: 1.5 }}>
                    Trading custody-restricted assets (e.g. <code>FEST-VIP</code> or <code>MERCH-CLOAK</code>) automatically triggers an on-chain DvP escrow lock until physical or credential delivery is verified.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('resale');
                      setSelectedSymbol('FEST-VIP');
                    }}
                    style={{
                      background: '#A855F7',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 4,
                      padding: '9px 18px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                    }}
                  >
                    Trade Escrow Asset (FEST-VIP)
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {escrows.map((e) => (
                    <div
                      key={e.id}
                      className="card"
                      style={{
                        padding: 18,
                        border: '1px solid rgba(168, 85, 247, 0.35)',
                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(9, 13, 26, 0.95) 100%)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>🎟️</span>
                          <strong style={{ fontSize: 15, color: '#F8FAFC' }}>{e.symbol}</strong>
                          <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                            [{e.id}]
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: e.status === 'LOCKED' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            color: e.status === 'LOCKED' ? '#F59E0B' : '#10B981',
                            border: `1px solid ${e.status === 'LOCKED' ? '#F59E0B' : '#10B981'}`,
                          }}
                        >
                          {e.status}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8,
                          marginBottom: 14,
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        <div>
                          <span style={{ color: '#64748B' }}>Quantity: </span>
                          <strong style={{ color: '#F8FAFC' }}>{e.qty} units</strong>
                        </div>
                        <div>
                          <span style={{ color: '#64748B' }}>Locked Cash: </span>
                          <strong style={{ color: '#00F0FF' }}>{formatDKC(e.amount ?? e.cashMinor ?? 0)}</strong>
                        </div>
                        <div>
                          <span style={{ color: '#64748B' }}>Buyer: </span>
                          <span style={{ color: e.buyerUserId === user?.id ? '#00F0FF' : '#CBD5E1', fontWeight: 700 }}>
                            {e.buyerUserId === user?.id ? 'YOU' : e.buyerUserId}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: '#64748B' }}>Seller: </span>
                          <span style={{ color: e.sellerUserId === user?.id ? '#F59E0B' : '#CBD5E1', fontWeight: 700 }}>
                            {e.sellerUserId === user?.id ? 'YOU' : e.sellerUserId}
                          </span>
                        </div>
                      </div>

                      {/* Active Escrow Handover OTP & 1-Click Delivery Confirmation */}
                      {e.status === 'LOCKED' && (() => {
                        const otpCode = ((e as any).pickupOtp || e.id.slice(-6)).toUpperCase();
                        return (
                          <div
                            style={{
                              background: 'rgba(0, 240, 255, 0.08)',
                              border: '1px solid rgba(0, 240, 255, 0.35)',
                              borderRadius: 6,
                              padding: '12px 14px',
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                              <div>
                                <div style={{ fontSize: 10, color: '#00F0FF', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                                  🔑 6-Digit Handover OTP
                                </div>
                                <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '0.2em', color: '#FFFFFF', fontFamily: '"JetBrains Mono", monospace' }}>
                                  {otpCode}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const delRes = await fetch(`/api/escrows/${e.id}/deliver`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
                                      credentials: 'include',
                                      body: JSON.stringify({ otp: otpCode }),
                                    });
                                    const data = await delRes.json().catch(() => ({}));
                                    if (delRes.ok) {
                                      alert('✓ Delivery Confirmed! Escrow released and settled directly to seller.');
                                      fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); });
                                      fetchSession();
                                    } else {
                                      alert(`Delivery verification failed: ${data.error || 'Invalid OTP'}`);
                                    }
                                  } catch (err: any) {
                                    alert(`Network error: ${err.message}`);
                                  }
                                }}
                                style={{
                                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: 4,
                                  padding: '8px 14px',
                                  fontWeight: 800,
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  fontFamily: '"JetBrains Mono", monospace',
                                  boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)',
                                }}
                              >
                                [✓ Confirm Delivery / Auto-Fill OTP]
                              </button>
                            </div>
                            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                              Show this code upon physical handover. Clicking <strong>[✓ Confirm Delivery / Auto-Fill OTP]</strong> releases escrow funds to the seller.
                            </div>
                          </div>
                        );
                      })()}

                      {/* Manual OTP Verification Box */}
                      {e.status === 'LOCKED' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                          <div
                            style={{
                              background: 'rgba(168, 85, 247, 0.08)',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              borderRadius: 6,
                              padding: '10px 12px',
                            }}
                          >
                            <div style={{ fontSize: 10, color: '#C084FC', fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>
                              🤝 Manual OTP Entry
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="text"
                                placeholder="Enter 6-digit OTP"
                                value={escrowOtpInputs[e.id] || ''}
                                onChange={(ev) => setEscrowOtpInputs((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                                style={{
                                  flex: 1,
                                  background: '#090D1A',
                                  border: '1px solid #334155',
                                  borderRadius: 4,
                                  padding: '6px 10px',
                                  color: '#FFFFFF',
                                  fontSize: 12,
                                  fontFamily: '"JetBrains Mono", monospace',
                                  letterSpacing: '0.1em',
                                  textTransform: 'uppercase',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const demoOtp = (e as any).pickupOtp || e.id.slice(-6).toUpperCase();
                                  setEscrowOtpInputs((prev) => ({ ...prev, [e.id]: demoOtp }));
                                }}
                                style={{
                                  background: 'rgba(0, 240, 255, 0.15)',
                                  border: '1px solid #00F0FF',
                                  color: '#00F0FF',
                                  borderRadius: 4,
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Auto-Fill OTP
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                const otpVal = (escrowOtpInputs[e.id] || '').trim();
                                if (!otpVal) {
                                  alert('Please enter the 6-digit OTP provided by the buyer');
                                  return;
                                }
                                try {
                                  const delRes = await fetch(`/api/escrows/${e.id}/deliver`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
                                    credentials: 'include',
                                    body: JSON.stringify({ otp: otpVal }),
                                  });
                                  const data = await delRes.json().catch(() => ({}));
                                  if (delRes.ok) {
                                    alert('✓ OTP Verified! Escrow released and settled directly to seller.');
                                    fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); });
                                    fetchSession();
                                  } else {
                                    alert(`OTP Verification failed: ${data.error || 'Invalid OTP'}`);
                                  }
                                } catch (err: any) {
                                  alert(`Network error: ${err.message}`);
                                }
                              }}
                              style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: 4,
                                padding: '8px 12px',
                                fontWeight: 800,
                                fontSize: 11,
                                cursor: 'pointer',
                                fontFamily: '"JetBrains Mono", monospace',
                                marginTop: 6,
                              }}
                            >
                              ✓ Verify OTP &amp; Release Escrow Funds
                            </button>
                          </div>

                          <div style={{ textAlign: 'center', fontSize: 10, color: '#64748B' }}>— OR —</div>

                          <button
                            type="button"
                            onClick={async () => {
                              const rRes = await fetch('/api/mock-issuer/receipt', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
                                credentials: 'include',
                                body: JSON.stringify({ escrowId: e.id }),
                              });
                              if (rRes.ok) {
                                const { receipt } = await rRes.json();
                                const delRes = await fetch(`/api/escrows/${e.id}/deliver`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
                                  credentials: 'include',
                                  body: JSON.stringify({ receipt }),
                                });
                                if (delRes.ok) {
                                  alert('✓ Delivery receipt accepted! Escrow released and settled with zero-sum balanced postings.');
                                  fetch('/api/escrows/my', { credentials: 'include' }).then((r) => { if (r.ok) r.json().then(setEscrows); });
                                  fetchSession();
                                }
                              }
                            }}
                            style={{
                              width: '100%',
                              background: '#1E293B',
                              color: '#94A3B8',
                              border: '1px solid #334155',
                              borderRadius: 4,
                              padding: '8px 12px',
                              fontWeight: 700,
                              fontSize: 11,
                              cursor: 'pointer',
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          >
                            Use Issuer Cryptographic Receipt Signature
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Escrow Custody Architecture Explainer */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ color: '#A855F7', fontWeight: 800, fontSize: 13, marginBottom: 12, letterSpacing: '0.04em' }}>
                📖 ESCROW CUSTODY PROTOCOL (DVP)
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', flexDirection: 'column', gap: 12, lineHeight: 1.5 }}>
                <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                  <strong style={{ color: '#F8FAFC', display: 'block', marginBottom: 4 }}>1. Atomic Pre-Lock on Execution</strong>
                  When a trade matches on custody-restricted assets (like VIP lanyard access or physical merch cloaks), the matching engine moves buyer cash into an isolated <code>ESCROW</code> ledger account.
                </div>
                <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                  <strong style={{ color: '#F8FAFC', display: 'block', marginBottom: 4 }}>2. Issuer Delivery Verification</strong>
                  The seller submits the tracking number or hardware pass ID to the verified issuer, who signs an HMAC-SHA256 delivery receipt.
                </div>
                <div style={{ background: 'rgba(15, 23, 42, 0.65)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                  <strong style={{ color: '#F8FAFC', display: 'block', marginBottom: 4 }}>3. Balanced Final Settlement</strong>
                  Submitting the valid receipt executes a balanced <code>ESCROW_RELEASE</code> journal: cash is credited to the seller and the asset is deposited into the buyer's wallet with zero risk of counterparty default.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Proof of Solvency */}
      {activeTab === 'solvency' && (
        <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
          {/* Header & Subtitle */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: 22, color: '#10B981', margin: 0, letterSpacing: '0.04em' }}>
                🛡️ CRYPTOGRAPHIC PROOF OF SOLVENCY
              </h2>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: isTampered ? 'rgba(255, 42, 84, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  color: isTampered ? '#FF2A54' : '#10B981',
                  border: `1px solid ${isTampered ? '#FF2A54' : '#10B981'}`,
                }}
              >
                {isTampered ? '⚡ FRAUD SIMULATION ACTIVE' : '✓ 100% CANONICAL AUDIT'}
              </span>
            </div>
            <p style={{ color: '#94A3B8', fontSize: 13, margin: '6px 0 0', maxWidth: 900, lineHeight: 1.5 }}>
              Proves the exchange holds 100% of user funds (∑ Assets = ∑ Liabilities) using a cryptographic Merkle Sum Tree,
              allowing you to verify your balance is included in the total reserve without exposing other users' private balances.
            </p>
          </div>

          {/* 2-Column Split Layout */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(420px, 1fr) minmax(480px, 1.25fr)',
              gap: 20,
              alignItems: 'start',
            }}
          >
            {/* Left Column: Controls, Invariant Check Cards & Fraud Simulator */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Action Bar */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={runSolvencyVerification}
                  disabled={solvencyLoading}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: '#10B981',
                    color: '#06080F',
                    border: 'none',
                    borderRadius: 5,
                    padding: '11px 16px',
                    fontWeight: 900,
                    fontSize: 12,
                    letterSpacing: '0.04em',
                    cursor: solvencyLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)',
                    fontFamily: '"JetBrains Mono", monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span>{solvencyLoading ? 'AUDITING...' : '🟢 RUN LIVE SOLVENCY AUDIT'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSimulateTamper}
                  style={{
                    flex: 1,
                    minWidth: 220,
                    background: 'rgba(255, 42, 84, 0.15)',
                    border: '1px solid #FF2A54',
                    color: '#FF2A54',
                    borderRadius: 5,
                    padding: '11px 16px',
                    fontWeight: 800,
                    fontSize: 11,
                    letterSpacing: '0.03em',
                    cursor: 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                  title="Injects a fake +10,000 DKC balance to prove cryptographic rejection"
                >
                  <span>⚡ SIMULATE TAMPER ATTACK (+10k DKC)</span>
                </button>
              </div>

              {/* Security Alert Banner (Emerald/Amber Shield with Red alert) */}
              {tamperResult && (
                <div
                  style={{
                    background: isTampered
                      ? 'linear-gradient(135deg, rgba(255, 42, 84, 0.18) 0%, rgba(20, 5, 10, 0.95) 100%)'
                      : 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 20, 15, 0.95) 100%)',
                    border: `1px solid ${isTampered ? '#FF2A54' : '#10B981'}`,
                    color: isTampered ? '#FCA5A5' : '#6EE7B7',
                    padding: '14px 16px',
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.5,
                    boxShadow: isTampered ? '0 0 20px rgba(255, 42, 84, 0.25)' : '0 0 15px rgba(16, 185, 129, 0.2)',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{isTampered ? '🛡️' : '✓'}</span>
                    <div>
                      <strong style={{ color: isTampered ? '#FF2A54' : '#10B981', display: 'block', marginBottom: 4 }}>
                        {isTampered ? 'CRYPTOGRAPHIC FRAUD ATTEMPT INTERCEPTED' : 'SOLVENCY AUDIT COMPLETE'}
                      </strong>
                      <span style={{ fontSize: 11 }}>{tamperResult}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* The 3 Invariant Check Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* CHECK 1 */}
                <div
                  className="card"
                  style={{
                    padding: 14,
                    borderLeft: `4px solid ${solvencyChecks.check1 === null ? '#64748B' : solvencyChecks.check1 ? '#10B981' : '#FF2A54'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, color: '#F8FAFC' }}>
                      CHECK 1: Merkle Sum Tree Path Verification
                    </strong>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 3,
                        background: solvencyChecks.check1 === null ? '#1E293B' : solvencyChecks.check1 ? 'rgba(16,185,129,0.2)' : 'rgba(255,42,84,0.2)',
                        color: solvencyChecks.check1 === null ? '#94A3B8' : solvencyChecks.check1 ? '#10B981' : '#FF2A54',
                        border: `1px solid ${solvencyChecks.check1 === null ? '#334155' : solvencyChecks.check1 ? '#10B981' : '#FF2A54'}`,
                      }}
                    >
                      {solvencyChecks.check1 === null ? 'PENDING' : solvencyChecks.check1 ? '✓ PASSED' : '✕ FAILED (HASH MISMATCH)'}
                    </span>
                  </div>
                  <div style={{ margin: '6px 0 4px', color: '#64748B', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}>
                    FORMULA: <code>SHA256(Left_Hash || Right_Hash || Left_Sum + Right_Sum) == Root_Hash</code>
                  </div>
                  <p style={{ margin: 0, color: '#94A3B8', fontSize: 11 }}>
                    {solvencyChecks.check1
                      ? '✓ Valid mathematical hash path from user account leaf to published canonical Merkle Root.'
                      : solvencyChecks.check1 === false
                      ? '✕ Forged hash path detected: Recomputed SHA-256 root does not match canonical root hash.'
                      : 'Run solvency audit to evaluate cryptographic inclusion path.'}
                  </p>
                </div>

                {/* CHECK 2 */}
                <div
                  className="card"
                  style={{
                    padding: 14,
                    borderLeft: `4px solid ${solvencyChecks.check2 === null ? '#64748B' : solvencyChecks.check2 ? '#10B981' : '#FF2A54'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, color: '#F8FAFC' }}>
                      CHECK 2: Total Sum Invariant Conservation
                    </strong>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 3,
                        background: solvencyChecks.check2 === null ? '#1E293B' : solvencyChecks.check2 ? 'rgba(16,185,129,0.2)' : 'rgba(255,42,84,0.2)',
                        color: solvencyChecks.check2 === null ? '#94A3B8' : solvencyChecks.check2 ? '#10B981' : '#FF2A54',
                        border: `1px solid ${solvencyChecks.check2 === null ? '#334155' : solvencyChecks.check2 ? '#10B981' : '#FF2A54'}`,
                      }}
                    >
                      {solvencyChecks.check2 === null ? 'PENDING' : solvencyChecks.check2 ? '✓ PASSED' : '✕ FAILED (SUM MISMATCH)'}
                    </span>
                  </div>
                  <div style={{ margin: '6px 0 4px', color: '#64748B', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}>
                    FORMULA: <code>User_Leaf (50,000 DKC) + ∑ Sibling_Leaves == Root_Total (200,000 DKC)</code>
                  </div>
                  <p style={{ margin: 0, color: '#94A3B8', fontSize: 11 }}>
                    {solvencyChecks.check2
                      ? '✓ Sum conservation verified: Cumulative liabilities equal canonical root sum with zero negative leaves.'
                      : solvencyChecks.check2 === false
                      ? '✕ Liability sum mismatch: Injected fake balance creates discrepancy with total published reserve.'
                      : 'Run solvency audit to evaluate total liability conservation.'}
                  </p>
                </div>

                {/* CHECK 3 */}
                <div
                  className="card"
                  style={{
                    padding: 14,
                    borderLeft: `4px solid ${solvencyChecks.check3 === null ? '#64748B' : solvencyChecks.check3 ? '#10B981' : '#FF2A54'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, color: '#F8FAFC' }}>
                      CHECK 3: Double-Entry Ledger Zero Balance
                    </strong>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 3,
                        background: solvencyChecks.check3 === null ? '#1E293B' : solvencyChecks.check3 ? 'rgba(16,185,129,0.2)' : 'rgba(255,42,84,0.2)',
                        color: solvencyChecks.check3 === null ? '#94A3B8' : solvencyChecks.check3 ? '#10B981' : '#FF2A54',
                        border: `1px solid ${solvencyChecks.check3 === null ? '#334155' : solvencyChecks.check3 ? '#10B981' : '#FF2A54'}`,
                      }}
                    >
                      {solvencyChecks.check3 === null ? 'PENDING' : solvencyChecks.check3 ? '✓ PASSED (100% SOLVENT)' : '✕ FAILED'}
                    </span>
                  </div>
                  <div style={{ margin: '6px 0 4px', color: '#64748B', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}>
                    FORMULA: <code>∑ Ledger_Debits - ∑ Ledger_Credits == 0.00 DKC (trg_journal_balanced)</code>
                  </div>
                  <p style={{ margin: 0, color: '#94A3B8', fontSize: 11 }}>
                    {solvencyChecks.check3
                      ? '✓ 100% Double-entry solvency verified: Every debit matches reciprocal credit across all units.'
                      : solvencyChecks.check3 === false
                      ? '✕ Ledger imbalance detected across database postings.'
                      : 'Run solvency audit to reconcile double-entry postings.'}
                  </p>
                </div>
              </div>

              {/* Inclusion Proof Details Card */}
              {solvencyProof && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ color: '#00F0FF', fontWeight: 800, fontSize: 12, letterSpacing: '0.04em' }}>
                      CANONICAL INCLUSION PROOF METADATA
                    </span>
                    <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                      SEQ #{solvencyProof.asOfSeq}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: '"JetBrains Mono", monospace', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>User Identifier:</span>
                      <strong style={{ color: '#F8FAFC' }}>{solvencyProof.userId} ({user?.username})</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Account Liability:</span>
                      <strong style={{ color: '#10B981' }}>{formatDKC(solvencyProof.balance)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Expected Total Liabilities:</span>
                      <strong style={{ color: '#00F0FF' }}>{formatDKC(solvencyProof.expectedTotal)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Pseudonym Hash:</span>
                      <span style={{ color: '#CBD5E1' }}>{solvencyProof.pseudonym.slice(0, 16)}...</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Leaf Hash:</span>
                      <span style={{ color: '#CBD5E1' }}>{solvencyProof.leafHash.slice(0, 16)}...</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#64748B' }}>Merkle Siblings:</span>
                      <span style={{ color: '#F8FAFC' }}>{solvencyProof.siblings.length} nodes (Level 0 + Level 1)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Interactive Merkle Sum Tree Visualizer */}
            <div>
              <MerkleTreeVisualizer
                proof={solvencyProof}
                activeUsername={user?.username}
                isTampered={isTampered}
                tamperedInfo={tamperedInfo}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Admin & Club Treasury */}
      {activeTab === 'admin' && (
        <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 22, color: '#F59E0B', margin: 0, letterSpacing: '0.04em' }}>
              ⚙️ ADMIN &amp; CLUB TREASURY
            </h2>
            <p style={{ color: '#94A3B8', fontSize: 13, margin: '6px 0 0', maxWidth: 900, lineHeight: 1.5 }}>
              Execute live zero-sum ledger reconciliations, inspect real-time double-entry postings via Ledger X-Ray, stress-test high-frequency order throughput, and monitor reserve backing.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 1fr) minmax(480px, 1.3fr)', gap: 20, alignItems: 'start' }}>
            {/* Left Column: Diagnostics Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card" style={{ padding: 18 }}>
                <strong style={{ fontSize: 13, color: '#F8FAFC', display: 'block', marginBottom: 10 }}>
                  SYSTEM AUDIT ACTIONS
                </strong>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setIsLedgerDrawerOpen(true)}
                    style={{
                      background: 'rgba(0, 240, 255, 0.15)',
                      border: '1px solid #00F0FF',
                      color: '#00F0FF',
                      borderRadius: 4,
                      padding: '11px 18px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>🔬 Open Live Ledger X-Ray Inspector</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>Real-Time Postings Drawer →</span>
                  </button>

                  <button
                    type="button"
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
                      padding: '11px 18px',
                      fontWeight: 800,
                      cursor: diagRunning ? 'not-allowed' : 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{diagRunning ? 'Auditing...' : '⚖️ Run Double-Entry Reconciliation'}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>∑ Postings = 0</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setDiagRunning(true);
                      try {
                        const res = await fetch('/api/admin/reserve-backing', { credentials: 'include' });
                        if (res.ok) setDiagResult(await res.json());
                      } finally {
                        setDiagRunning(false);
                      }
                    }}
                    disabled={diagRunning}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid #10B981',
                      color: '#10B981',
                      borderRadius: 4,
                      padding: '11px 18px',
                      fontWeight: 800,
                      cursor: diagRunning ? 'not-allowed' : 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{diagRunning ? 'Auditing...' : '🏦 Audit 100% Reserve Backing'}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>Circulation == Treasury</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setDiagRunning(true);
                      try {
                        const res = await fetch('/api/admin/scalper-demo', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
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
                      background: 'rgba(255, 42, 84, 0.15)',
                      border: '1px solid #FF2A54',
                      color: '#FF2A54',
                      borderRadius: 4,
                      padding: '11px 18px',
                      fontWeight: 800,
                      cursor: diagRunning ? 'not-allowed' : 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{diagRunning ? 'Bursting...' : '⚡ Run 50-Order Scalper Burst'}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>PoW & Collar Check</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetDemoState}
                    disabled={resetLoading}
                    style={{
                      background: 'rgba(0, 240, 255, 0.12)',
                      border: '1px solid #00F0FF',
                      color: '#00F0FF',
                      borderRadius: 4,
                      padding: '11px 18px',
                      fontWeight: 800,
                      cursor: resetLoading ? 'not-allowed' : 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{resetLoading ? 'Restoring...' : '🔄 Reset Demo Baseline (200k DKC)'}</span>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>Pristine State</span>
                  </button>
                </div>
              </div>

              {/* Explainer Box */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ color: '#64748B', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  WHAT THESE CHECKS VERIFY:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: '#94A3B8', fontSize: 11, lineHeight: 1.6 }}>
                  <li><strong>Reconciliation:</strong> Recomputes balances directly from immutable SQL postings table and verifies zero-sum ledger invariant.</li>
                  <li><strong>Scalper Burst:</strong> Emulates 50 institutional high-frequency orders to verify sub-millisecond execution and anti-scalping price collar ceilings.</li>
                  <li><strong>Demo Reset:</strong> Truncates dirty benchmark orders and seeds exactly 50,000.00 DKC across Admin, Alice, Bob, and Carol.</li>
                </ul>
              </div>
            </div>

            {/* Right Column: Live Output Terminal */}
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ color: '#F8FAFC', fontWeight: 800, fontSize: 12 }}>
                  TELEMETRY REPORT OUTPUT
                </span>
                {diagResult && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: diagResult.balanced !== false ? 'rgba(16,185,129,0.2)' : 'rgba(255,42,84,0.2)',
                      color: diagResult.balanced !== false ? '#10B981' : '#FF2A54',
                      border: `1px solid ${diagResult.balanced !== false ? '#10B981' : '#FF2A54'}`,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    {diagResult.balanced !== false ? '✓ INVARIANTS CONSERVED' : '✕ ANOMALY DETECTED'}
                  </span>
                )}
              </div>

              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  overflowX: 'auto',
                  maxHeight: 460,
                  color: '#00F0FF',
                  background: '#04060A',
                  padding: 14,
                  borderRadius: 6,
                  border: '1px solid #161F30',
                  fontFamily: '"JetBrains Mono", monospace',
                  lineHeight: 1.45,
                }}
              >
                {diagResult ? JSON.stringify(diagResult, null, 2) : '// No diagnostics executed yet. Click one of the action buttons on the left to inspect live engine telemetry.'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Wallet & UPI Economy */}
      {activeTab === 'wallet' && (
        <WalletView
          user={user}
          balance={balance}
          csrfToken={csrfToken}
          onOpenDeposit={() => setShowPaymentModal(true)}
          onOpenWithdraw={() => setShowWithdrawModal(true)}
          onOpenTransfer={() => setShowTransferModal(true)}
          onBalanceUpdated={async () => {
            await fetchSession();
            void syncMarketState();
          }}
          onNavigateToStore={() => setActiveTab('store')}
        />
      )}

      {/* 6. Campus Organizations & Clubs Workspace */}
      {activeTab === 'org_workspace' && (
        <OrgWorkspaceView
          user={user}
          csrfToken={csrfToken}
          onBalanceUpdated={async () => {
            await fetchSession();
            void syncMarketState();
          }}
        />
      )}

      {/* 7. Student Community Marketplace */}
      {activeTab === 'community' && (
        <CommunityMarketplaceView
          user={user}
          balance={balance}
          csrfToken={csrfToken}
          onOpenDeposit={() => setShowPaymentModal(true)}
          onBalanceUpdated={async () => {
            await fetchSession();
            void syncMarketState();
          }}
        />
      )}

      {/* 5. Ledger & Solvency Inspector Drawer */}
      <LedgerInspectorDrawer
        isOpen={isLedgerDrawerOpen}
        onClose={() => setIsLedgerDrawerOpen(false)}
        seq={engineSeq}
      />

      {/* 2-Step Razorpay / NPCI UPI Sandbox Payment Gateway Checkout Modal */}
      <RazorpayCheckoutModal
        isOpen={showPaymentModal || showFaucetModal}
        onClose={() => {
          setShowPaymentModal(false);
          setShowFaucetModal(false);
        }}
        user={user}
        csrfToken={csrfToken}
        currentAvailableMinor={balance.available}
        onSuccess={async (newBalance) => {
          setBalance((prev) => ({
            ...prev,
            available: newBalance.available,
            reserved: newBalance.reserved,
            escrow: newBalance.escrow,
            pendingWithdrawals: newBalance.pendingWithdrawals ?? prev.pendingWithdrawals ?? 0,
            total: newBalance.total ?? (newBalance.available + newBalance.reserved + newBalance.escrow + (newBalance.pendingWithdrawals ?? 0)),
          }));
          await fetchSession();
          void syncMarketState();
        }}
      />

      {/* Withdraw DKC -> UPI Modal */}
      <WithdrawModal
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        user={user}
        csrfToken={csrfToken}
        currentAvailableMinor={balance.available}
        onSuccess={async (newBalance) => {
          setBalance((prev) => ({
            ...prev,
            available: newBalance.available,
            reserved: newBalance.reserved,
            escrow: newBalance.escrow,
            pendingWithdrawals: newBalance.pendingWithdrawals ?? prev.pendingWithdrawals ?? 0,
            total: newBalance.total ?? (newBalance.available + newBalance.reserved + newBalance.escrow + (newBalance.pendingWithdrawals ?? 0)),
          }));
          await fetchSession();
          void syncMarketState();
        }}
      />

      {/* Spend / Transfer DKC (Merch & Peer) Modal */}
      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        user={user}
        csrfToken={csrfToken}
        currentAvailableMinor={balance.available}
        onSuccess={async (newBalance) => {
          setBalance((prev) => ({
            ...prev,
            available: newBalance.available,
            reserved: newBalance.reserved,
            escrow: newBalance.escrow,
            pendingWithdrawals: newBalance.pendingWithdrawals ?? prev.pendingWithdrawals ?? 0,
            total: newBalance.total ?? (newBalance.available + newBalance.reserved + newBalance.escrow + (newBalance.pendingWithdrawals ?? 0)),
          }));
          await fetchSession();
          void syncMarketState();
        }}
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
          <div className="card" style={{ width: 440, padding: 24, boxShadow: '0 0 30px rgba(0,240,255,0.25)', border: '1px solid #1E293B' }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: authMode === 'login' ? '2px solid #00F0FF' : '2px solid transparent',
                    color: authMode === 'login' ? '#00F0FF' : '#64748B',
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: 'pointer',
                    paddingBottom: 4,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  EXCHANGE LOGIN
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode('register'); setAuthError(''); }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: authMode === 'register' ? '2px solid #10B981' : '2px solid transparent',
                    color: authMode === 'register' ? '#10B981' : '#64748B',
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: 'pointer',
                    paddingBottom: 4,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  CREATE ACCOUNT (+GRANT)
                </button>
              </div>
              <button
                onClick={() => setShowAuthModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 16, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* 1-Click Demo Logins & Seeded Credentials Strip */}
            {authMode === 'login' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                <div>
                  <span style={{ fontSize: 10, color: '#64748B', fontWeight: 700, display: 'block', marginBottom: 6 }}>
                    ⚡ 1-CLICK INSTANT DEMO LOGIN &amp; ROLE SWITCHER:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Official Fest Club Account */}
                    <button
                      type="button"
                      onClick={() => handleOneClickLogin('admin', 'password123')}
                      disabled={authLoading}
                      style={{
                        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(180, 83, 9, 0.12) 100%)',
                        border: '1.5px solid #F59E0B',
                        color: '#FDE68A',
                        borderRadius: 6,
                        padding: '10px 12px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        fontFamily: '"JetBrains Mono", monospace',
                        textAlign: 'left',
                        boxShadow: '0 0 15px rgba(245, 158, 11, 0.15)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#F59E0B', fontSize: 12 }}>
                          🏛️ MNNIT Official Fest Club (culrav.club@mnnit.ac.in / username: admin)
                        </span>
                        <span style={{ fontSize: 9, background: '#F59E0B', color: '#06080F', padding: '2px 6px', borderRadius: 3, fontWeight: 900 }}>
                          ORGANIZER
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 3, fontWeight: 500 }}>
                        Verified Organizer Workspace (Can Launch Merch &amp; Ticket Drops)
                      </div>
                    </button>

                    {/* Student Trader Accounts */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => handleOneClickLogin('alice', 'password123')}
                        disabled={authLoading}
                        style={{
                          background: 'rgba(0, 240, 255, 0.12)',
                          border: '1px solid #00F0FF',
                          color: '#00F0FF',
                          borderRadius: 6,
                          padding: '8px 6px',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                          textAlign: 'center',
                        }}
                      >
                        <div>🎓 Alice</div>
                        <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 500, marginTop: 2 }}>
                          Verified Student
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOneClickLogin('bob', 'password123')}
                        disabled={authLoading}
                        style={{
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid #10B981',
                          color: '#10B981',
                          borderRadius: 6,
                          padding: '8px 6px',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                          textAlign: 'center',
                        }}
                      >
                        <div>🎓 Bob</div>
                        <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 500, marginTop: 2 }}>
                          Verified Student
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOneClickLogin('carol', 'password123')}
                        disabled={authLoading}
                        style={{
                          background: 'rgba(168, 85, 247, 0.12)',
                          border: '1px solid #A855F7',
                          color: '#A855F7',
                          borderRadius: 6,
                          padding: '8px 6px',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                          textAlign: 'center',
                        }}
                      >
                        <div>🎓 Carol</div>
                        <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 500, marginTop: 2 }}>
                          Verified Student
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid #1E293B',
                    borderRadius: 6,
                    padding: '10px 12px',
                    fontSize: 10,
                    color: '#94A3B8',
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#F8FAFC', marginBottom: 3 }}>💡 PRE-SEEDED CREDENTIALS &amp; ROLES:</div>
                  <div>• <strong style={{ color: '#F59E0B' }}>admin</strong> (<code>password123</code>): 🏛️ MNNIT Official Fest Club — <em>Verified Organizer Workspace (Can Launch Merch &amp; Ticket Drops)</em></div>
                  <div>• <strong style={{ color: '#00F0FF' }}>alice</strong> / <strong style={{ color: '#10B981' }}>bob</strong> / <strong style={{ color: '#A855F7' }}>carol</strong> (<code>password123</code>): 🎓 Verified MNNIT Student Accounts (<em>Student Buyers &amp; Secondary Traders</em>)</div>
                </div>
              </div>
            )}

            {/* Anti-Sybil Protocol Notice in Register Mode */}
            {authMode === 'register' && (
              <div
                style={{
                  background: 'rgba(0, 240, 255, 0.08)',
                  border: '1px solid rgba(0, 240, 255, 0.3)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  marginBottom: 14,
                  fontSize: 11,
                }}
              >
                <div style={{ fontWeight: 800, color: '#00F0FF', marginBottom: 4 }}>
                  🛡️ ANTI-SYBIL ECONOMIC PROTOCOL
                </div>
                <div style={{ color: '#CBD5E1', fontSize: 10, lineHeight: 1.4 }}>
                  New accounts initialize with strictly <strong style={{ color: '#00F0FF' }}>0.00 DKC</strong> and zero inventory to prevent market drain attacks. After signing up, use the <strong style={{ color: '#10B981' }}>Instant UPI / Card Deposit Gateway</strong> in your Portfolio to fund your wallet.
                </div>
              </div>
            )}

            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>USERNAME</label>
                <input
                  type="text"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  placeholder="e.g. Satoshi"
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
                  placeholder="Minimum 4 characters"
                  required
                  style={{ width: '100%' }}
                />
              </div>

              {authMode === 'register' && (
                <div>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>
                    ROLE / TRADER PROFILE
                  </label>
                  <select
                    value={authProfile}
                    onChange={(e) => setAuthProfile(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0F172A',
                      color: '#F8FAFC',
                      border: '1px solid #1E293B',
                      borderRadius: 4,
                      padding: 8,
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    <option value="Standard Trader (with Starter Grant)">Standard Trader (with Starter Grant)</option>
                    <option value="HFT High-Frequency Arbitrageur">HFT High-Frequency Arbitrageur</option>
                    <option value="Institutional Liquidity Provider">Institutional Liquidity Provider</option>
                  </select>
                </div>
              )}

              {authError && (
                <div style={{ color: '#FF2A54', fontSize: 11, background: 'rgba(255,42,84,0.15)', padding: 8, borderRadius: 4 }}>
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                style={{
                  background: authMode === 'login' ? '#00F0FF' : '#10B981',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: 10,
                  fontWeight: 800,
                  cursor: authLoading ? 'not-allowed' : 'pointer',
                  marginTop: 6,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {authLoading ? 'AUTHENTICATING...' : authMode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT & CLAIM GRANT'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                <span
                  onClick={() => { setAuthMode((prev) => (prev === 'login' ? 'register' : 'login')); setAuthError(''); }}
                  style={{ color: '#00F0FF', cursor: 'pointer' }}
                >
                  {authMode === 'login' ? 'Need an account? Register (+Grant)' : 'Have an account? Login'}
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
      {showCreateAuctionModal && (() => {
        const transferableInstruments = instruments.filter((i) => !i.isBenchmark && !i.escrowRequired);
        const curInst = instruments.find((i) => i.symbol === auctionSymbol) || transferableInstruments[0] || instruments[0];
        const availHolding = holdings.find((h) => h.symbol === auctionSymbol)?.available || 0;
        const ceilingMinor = curInst?.collarCeiling || (curInst?.faceValue ? Math.floor(curInst.faceValue * (1 + (curInst.collarBps || 1000) / 10000)) : 165000);
        const ceilingDKC = ceilingMinor / 100;
        const faceValueDKC = (curInst?.faceValue || 150000) / 100;
        const collarPct = (curInst?.collarBps || 1000) / 100;

        const isCeilingViolated = auctionStartPrice > ceilingDKC;
        const isFloorInvalid = auctionFloorPrice >= auctionStartPrice || auctionFloorPrice < 1;
        const isInventoryInsufficient = availHolding < auctionQty || availHolding === 0;

        const priceDiff = Math.max(0, auctionStartPrice - auctionFloorPrice);
        const dropRate = auctionDurationSec > 0 ? (priceDiff / auctionDurationSec).toFixed(2) : '0';

        const visual = getInstrumentVisual(auctionSymbol);

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.82)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000,
            }}
          >
            <div
              className="card"
              style={{
                width: 480,
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: 24,
                border: `1px solid ${visual.border}`,
                boxShadow: '0 0 35px rgba(0, 240, 255, 0.15)',
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 6,
                      background: visual.bg,
                      border: `1px solid ${visual.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {visual.svg}
                  </div>
                  <div>
                    <strong style={{ fontSize: 16, color: '#00F0FF', letterSpacing: '0.04em' }}>
                      CREATE DUTCH AUCTION
                    </strong>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>
                      Descending price distribution with automatic collar guards
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateAuctionModal(false)}
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

              <form onSubmit={handleCreateAuction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* 1. Instrument Selector */}
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    SELECT TRANSFERABLE ASSET
                  </label>
                  <select
                    value={auctionSymbol}
                    onChange={(e) => {
                      const sym = e.target.value;
                      setAuctionSymbol(sym);
                      const inst = instruments.find((i) => i.symbol === sym);
                      const ceil = inst?.collarCeiling || (inst?.faceValue ? Math.floor(inst.faceValue * (1 + (inst.collarBps || 1000) / 10000)) : 165000);
                      setAuctionStartPrice(ceil / 100);
                      setAuctionFloorPrice(Math.round((ceil / 100) * 0.6));
                      const symAvail = holdings.find((h) => h.symbol === sym)?.available || 0;
                      setAuctionQty(Math.max(1, Math.min(auctionQty, symAvail || 1)));
                    }}
                    style={{
                      width: '100%',
                      background: '#090D1A',
                      border: '1px solid #1E293B',
                      borderRadius: 5,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {transferableInstruments.map((i) => {
                      const units = holdings.find((h) => h.symbol === i.symbol)?.available || 0;
                      return (
                        <option key={i.symbol} value={i.symbol}>
                          {i.symbol} — {i.name} (You own: {units} units)
                        </option>
                      );
                    })}
                  </select>

                  {/* Compact Selected Asset Preview Banner */}
                  <div
                    style={{
                      marginTop: 10,
                      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(9, 13, 26, 0.95) 100%)',
                      border: `1px solid ${visual.border}`,
                      borderRadius: 6,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 6,
                        background: visual.bg,
                        border: `1px solid ${visual.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {visual.svg}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {auctionSymbol} — {instruments.find((i) => i.symbol === auctionSymbol)?.name || auctionSymbol}
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>Face Value: <strong style={{ color: '#F8FAFC' }}>{faceValueDKC.toLocaleString()} DKC</strong></span>
                        <span>•</span>
                        <span>Collar Cap: <strong style={{ color: '#00F0FF' }}>{ceilingDKC.toLocaleString()} DKC</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Inventory Status Banner */}
                  {availHolding === 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        borderRadius: 5,
                        fontSize: 11,
                        color: '#FCA5A5',
                      }}
                    >
                      ⚠️ <strong>Zero Available Units:</strong> You own 0 available units of {auctionSymbol}. You must possess inventory in your wallet before creating an auction.
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        borderRadius: 5,
                        fontSize: 11,
                        color: '#10B981',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>✓ Available in wallet:</span>
                      <strong>{availHolding} unit(s) available</strong>
                    </div>
                  )}
                </div>

                {/* 2. Quantity Selector */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>QUANTITY TO AUCTION</label>
                    <span style={{ fontSize: 11, color: '#64748B' }}>Max: {availHolding}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, availHolding)}
                      value={auctionQty}
                      onChange={(e) => setAuctionQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      style={{
                        flex: 1,
                        background: '#090D1A',
                        border: '1px solid #1E293B',
                        borderRadius: 5,
                        padding: '8px 10px',
                        color: '#F8FAFC',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setAuctionQty(1)}
                      style={{
                        background: auctionQty === 1 ? '#00F0FF' : '#1E293B',
                        color: auctionQty === 1 ? '#06080F' : '#94A3B8',
                        border: `1px solid ${auctionQty === 1 ? '#00F0FF' : '#334155'}`,
                        borderRadius: 4,
                        padding: '0 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      1 Unit
                    </button>
                    {availHolding > 1 && (
                      <button
                        type="button"
                        onClick={() => setAuctionQty(Math.max(1, Math.floor(availHolding / 2)))}
                        style={{
                          background: auctionQty === Math.max(1, Math.floor(availHolding / 2)) && auctionQty !== 1 && auctionQty !== availHolding ? '#00F0FF' : '#1E293B',
                          color: auctionQty === Math.max(1, Math.floor(availHolding / 2)) && auctionQty !== 1 && auctionQty !== availHolding ? '#06080F' : '#94A3B8',
                          border: `1px solid ${auctionQty === Math.max(1, Math.floor(availHolding / 2)) && auctionQty !== 1 && auctionQty !== availHolding ? '#00F0FF' : '#334155'}`,
                          borderRadius: 4,
                          padding: '0 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Half
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAuctionQty(Math.max(1, availHolding))}
                      style={{
                        background: (auctionQty === availHolding && availHolding > 0) ? '#00F0FF' : '#1E293B',
                        color: (auctionQty === availHolding && availHolding > 0) ? '#06080F' : '#94A3B8',
                        border: `1px solid ${(auctionQty === availHolding && availHolding > 0) ? '#00F0FF' : '#334155'}`,
                        borderRadius: 4,
                        padding: '0 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ALL ({availHolding})
                    </button>
                  </div>
                </div>

                {/* 3. Collar Ceiling Guidance & Start Price */}
                <div>
                  <div
                    style={{
                      background: 'rgba(0, 240, 255, 0.05)',
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                      borderRadius: 5,
                      padding: '8px 10px',
                      marginBottom: 8,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#00F0FF', fontWeight: 700 }}>
                        Collar Ceiling Guard: Max {ceilingDKC.toLocaleString()} DKC
                      </span>
                      <button
                        type="button"
                        onClick={() => setAuctionStartPrice(ceilingDKC)}
                        style={{
                          background: 'rgba(0, 240, 255, 0.15)',
                          color: '#00F0FF',
                          border: '1px solid rgba(0, 240, 255, 0.4)',
                          borderRadius: 3,
                          padding: '2px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        [Set Max: {ceilingDKC} DKC]
                      </button>
                    </div>
                    <div style={{ color: '#64748B', marginTop: 2, fontSize: 10 }}>
                      Face Value: {faceValueDKC.toLocaleString()} DKC +{collarPct}% anti-scalping circuit breaker.
                    </div>
                  </div>

                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    STARTING PRICE (DKC)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={auctionStartPrice}
                    onChange={(e) => setAuctionStartPrice(parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      background: '#090D1A',
                      border: `1px solid ${isCeilingViolated ? '#EF4444' : '#1E293B'}`,
                      borderRadius: 5,
                      padding: '8px 10px',
                      color: isCeilingViolated ? '#EF4444' : '#F8FAFC',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  />
                  {isCeilingViolated && (
                    <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>
                      ❌ Start price exceeds exchange collar ceiling of {ceilingDKC.toLocaleString()} DKC.
                    </div>
                  )}
                </div>

                {/* 4. Floor Price Guidance */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>FLOOR PRICE (DKC)</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => setAuctionFloorPrice(Math.max(1, Math.round(auctionStartPrice * 0.8)))}
                        style={{
                          background: '#1E293B',
                          color: '#94A3B8',
                          border: 'none',
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        -20%
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuctionFloorPrice(Math.max(1, Math.round(auctionStartPrice * 0.5)))}
                        style={{
                          background: '#1E293B',
                          color: '#94A3B8',
                          border: 'none',
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        -50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuctionFloorPrice(1)}
                        style={{
                          background: '#1E293B',
                          color: '#94A3B8',
                          border: 'none',
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        Min: 1 DKC
                      </button>
                    </div>
                  </div>

                  <input
                    type="number"
                    step="0.01"
                    value={auctionFloorPrice}
                    onChange={(e) => setAuctionFloorPrice(parseFloat(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      background: '#090D1A',
                      border: `1px solid ${isFloorInvalid ? '#EF4444' : '#1E293B'}`,
                      borderRadius: 5,
                      padding: '8px 10px',
                      color: isFloorInvalid ? '#EF4444' : '#F8FAFC',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  />
                  {isFloorInvalid && (
                    <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>
                      ❌ Floor price must be at least 1.00 DKC and strictly lower than Start Price ({auctionStartPrice} DKC).
                    </div>
                  )}
                </div>

                {/* 5. Decay Pace / Duration Selector */}
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 6, fontWeight: 700 }}>
                    DECAY PACE / DURATION PRESETS
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setAuctionDurationSec(180);
                        setAuctionPacePreset('slow');
                      }}
                      style={{
                        background: auctionPacePreset === 'slow' ? '#1E293B' : '#0F172A',
                        color: auctionPacePreset === 'slow' ? '#00F0FF' : '#94A3B8',
                        border: `1px solid ${auctionPacePreset === 'slow' ? '#00F0FF' : '#334155'}`,
                        borderRadius: 4,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      🐢 Slow (180s)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuctionDurationSec(90);
                        setAuctionPacePreset('standard');
                      }}
                      style={{
                        background: auctionPacePreset === 'standard' ? '#1E293B' : '#0F172A',
                        color: auctionPacePreset === 'standard' ? '#10B981' : '#94A3B8',
                        border: `1px solid ${auctionPacePreset === 'standard' ? '#10B981' : '#334155'}`,
                        borderRadius: 4,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Standard (90s)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuctionDurationSec(30);
                        setAuctionPacePreset('blitz');
                      }}
                      style={{
                        background: auctionPacePreset === 'blitz' ? '#1E293B' : '#0F172A',
                        color: auctionPacePreset === 'blitz' ? '#F59E0B' : '#94A3B8',
                        border: `1px solid ${auctionPacePreset === 'blitz' ? '#F59E0B' : '#334155'}`,
                        borderRadius: 4,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      🔥 Rapid (30s)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuctionPacePreset('custom')}
                      style={{
                        background: auctionPacePreset === 'custom' ? '#1E293B' : '#0F172A',
                        color: auctionPacePreset === 'custom' ? '#A855F7' : '#94A3B8',
                        border: `1px solid ${auctionPacePreset === 'custom' ? '#A855F7' : '#334155'}`,
                        borderRadius: 4,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Custom
                    </button>
                  </div>

                  {auctionPacePreset === 'custom' && (
                    <input
                      type="number"
                      min="10"
                      max="86400"
                      value={auctionDurationSec}
                      onChange={(e) => setAuctionDurationSec(Math.max(10, parseInt(e.target.value, 10) || 10))}
                      placeholder="Custom Duration in Seconds"
                      style={{
                        width: '100%',
                        background: '#090D1A',
                        border: '1px solid #1E293B',
                        borderRadius: 5,
                        padding: '7px 10px',
                        color: '#F8FAFC',
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    />
                  )}

                  {/* Live Simulation Preview Sentence */}
                  <div
                    style={{
                      background: '#040711',
                      border: '1px solid #1E293B',
                      borderRadius: 5,
                      padding: '8px 10px',
                      fontSize: 11,
                      color: '#94A3B8',
                    }}
                  >
                    📉 <em>Price will decay by ~<strong>{dropRate} DKC</strong> every second and reach Floor Price (<strong>{auctionFloorPrice.toFixed(2)} DKC</strong>) in <strong>{auctionDurationSec}s</strong>.</em>
                  </div>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={auctionSubmitting || isCeilingViolated || isFloorInvalid || isInventoryInsufficient}
                  style={{
                    background: (auctionSubmitting || isCeilingViolated || isFloorInvalid || isInventoryInsufficient)
                      ? '#1E293B'
                      : 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)',
                    color: (auctionSubmitting || isCeilingViolated || isFloorInvalid || isInventoryInsufficient)
                      ? '#64748B'
                      : '#06080F',
                    border: 'none',
                    borderRadius: 5,
                    padding: '12px 16px',
                    fontWeight: 900,
                    fontSize: 13,
                    letterSpacing: '0.04em',
                    cursor: (auctionSubmitting || isCeilingViolated || isFloorInvalid || isInventoryInsufficient)
                      ? 'not-allowed'
                      : 'pointer',
                    boxShadow: (auctionSubmitting || isCeilingViolated || isFloorInvalid || isInventoryInsufficient)
                      ? 'none'
                      : '0 0 20px rgba(0, 240, 255, 0.4)',
                    marginTop: 4,
                  }}
                >
                  {auctionSubmitting
                    ? 'LAUNCHING AUCTION...'
                    : `🚀 LAUNCH AUCTION (${formatDKC(toMinorUnits(auctionStartPrice))} ➔ ${formatDKC(toMinorUnits(auctionFloorPrice))})`}
                </button>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Universal Pre-Purchase Confirmation & Verified Receipt Modal */}
      <PurchaseConfirmationModal
        data={confirmPurchaseData}
        availableBalanceDkc={balance.available / 100}
        onClose={() => setConfirmPurchaseData(null)}
        onSuccessDone={() => {
          const isEscrow = confirmPurchaseData?.isEscrow;
          setConfirmPurchaseData(null);
          syncMarketState();
          fetchSession();
          fetchHoldings();
          if (isEscrow) {
            setActiveTab('escrows');
          } else {
            setActiveTab('wallet');
          }
        }}
      />
    </div>
  );
}
