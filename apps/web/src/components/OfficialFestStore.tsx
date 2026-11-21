import React, { useState, useEffect, useCallback } from 'react';
import { PurchaseConfirmationModal, PurchaseConfirmationData } from './PurchaseConfirmationModal.js';

interface OfficialFestStoreProps {
  user: { id: string; username: string; role: string } | null;
  balance: { available: number; reserved: number; escrow: number; pendingWithdrawals?: number; total: number };
  holdings: Array<{ symbol: string; available: number; reserved: number; escrow: number }>;
  csrfToken: string | null;
  onNavigateToResale: (symbol: string) => void;
  onOpenDeposit: () => void;
  onPurchaseSuccess: () => void;
}

export interface StoreItem {
  id: string;
  symbol: string;
  title: string;
  badgeTag: string;
  sellerLabel: string;
  sellerUsername: string;
  priceDKC: number;
  specs: string;
  description: string;
  resaleCapDKC: number;
  isSoulbound?: boolean;
  themeColor: string;
  glowColor: string;
  hasSizes?: boolean;
  detailedSpecs: {
    materialOrZone: string;
    edition: string;
    perks: string[];
    resaleRule: string;
  };
}

export const STORE_ITEMS: StoreItem[] = [
  {
    id: 'store-hoodie',
    symbol: 'MERCH-CLOAK',
    title: 'Darkhold Official Fest Stealth Cloak / Hoodie',
    badgeTag: 'OFFICIAL FEST MERCH',
    sellerLabel: '🏛️ Official Fest Merch Club (Primary Store)',
    sellerUsername: 'admin',
    priceDKC: 800,
    specs: '240 GSM Heavyweight Cotton • Oversized Cyber Fit • Water-Repellent Neon Trim',
    description:
      'The canonical campus festival garment. Embedded with an NFC physical redemption barcode for on-ground festival merchandise booth collection.',
    resaleCapDKC: 880,
    themeColor: '#FF2A54',
    glowColor: 'rgba(255, 42, 84, 0.4)',
    hasSizes: true,
    detailedSpecs: {
      materialOrZone: '240 GSM 100% Terry Cotton • Acid-Wash Jet Black',
      edition: 'Batch 01 • Limited Run of 2,000 Units',
      perks: [
        'Integrated RFID wristband pocket on right sleeve',
        'Physical NFC authentication chip for festival check-in',
        'Reflective holographic festival crest print',
        'Pre-shrunk, windproof double-lined hood',
      ],
      resaleRule: 'Eligible for verified student resale on Order Book (Cap: +10% max ₹880 DKC)',
    },
  },
  {
    id: 'store-ga-pass',
    symbol: 'FEST-GA',
    title: 'Pronite General Admission Pass',
    badgeTag: 'OFFICIAL CONCERT PASS',
    sellerLabel: '🏛️ Official Festival Committee (Box Office)',
    sellerUsername: 'admin',
    priceDKC: 1500,
    specs: '3-Day All-Stage Standing Access • Main Arena Pit Entry • Non-Scalpable Collared Asset',
    description:
      'Standard admission ticket covering all 3 pronites (Rock Night, EDM Fest, Bollywood Finale). Cryptographically secured against scalping.',
    resaleCapDKC: 1650,
    themeColor: '#00F0FF',
    glowColor: 'rgba(0, 240, 255, 0.4)',
    detailedSpecs: {
      materialOrZone: 'Main Arena Stage Zone • Standing Access',
      edition: 'Official Primary Issuance • 10,000 Max Capacity',
      perks: [
        'Valid for all 3 festival days (Nov 12 - Nov 14)',
        'Access to EDM Arena, Rock Stage & Main Amphitheatre',
        'QR Dynamic Refresh at entry turnstiles',
        'Instant 1-click resale if you cannot attend (+10% cap protected)',
      ],
      resaleRule: 'Strictly capped at ₹1,650 DKC (+10%) on Student Resale Market',
    },
  },
  {
    id: 'store-vip-pass',
    symbol: 'FEST-VIP',
    title: 'VIP All-Access Backstage Pass',
    badgeTag: 'PREMIUM VIP SANCTUM',
    sellerLabel: '🏛️ Official Festival Committee (VIP Box Office)',
    sellerUsername: 'admin',
    priceDKC: 5000,
    specs: 'Front-Row VIP Pit • Artist Backstage Meet & Greet • Air-Conditioned VIP Hospitality Lounge',
    description:
      'Exclusive backstage credentials for headliner concerts. Includes dedicated VIP fast-track entry, complimentary buffet, and green room access.',
    resaleCapDKC: 5500,
    themeColor: '#F59E0B',
    glowColor: 'rgba(245, 158, 11, 0.4)',
    detailedSpecs: {
      materialOrZone: 'Front-Row Soundboard Pit + Artist Green Room Access',
      edition: 'Ultra-Exclusive • 500 Passes Total',
      perks: [
        'Dedicated VIP gate entry (zero queues)',
        'Exclusive Artist Meet & Greet session with headliners',
        'Unlimited food & beverage access in VIP Hospitality Lounge',
        'Complimentary Darkhold Official Merchandise Pack included',
      ],
      resaleRule: 'Protected by exchange collar: max secondary resale ₹5,500 DKC (+10%)',
    },
  },
  {
    id: 'store-relic',
    symbol: 'RELIC-AGAMOTTO',
    title: 'Festival Core Committee & Winner Badge',
    badgeTag: 'SOULBOUND CREDENTIAL',
    sellerLabel: '🏛️ Festival Core Council (Honorary Grant)',
    sellerUsername: 'admin',
    priceDKC: 5000,
    specs: 'Non-Transferable Soulbound Asset • Bound Permanently to User Account • Escrow Custody',
    description:
      'Honorary proof of festival contribution awarded to core committee heads, competitive hackathon champions, and cultural grand prize winners.',
    resaleCapDKC: 0,
    isSoulbound: true,
    themeColor: '#A855F7',
    glowColor: 'rgba(168, 85, 247, 0.4)',
    detailedSpecs: {
      materialOrZone: 'Cryptographic Soulbound Identity Token',
      edition: 'Exclusive Winner & Core Head Accreditation',
      perks: [
        'Permanent verifiable proof of festival achievement on double-entry ledger',
        'Lifetime free entry to all future campus festival editions',
        'Voting power in campus fest governance decisions',
        'Non-transferable (tamper-proof soulbound smart contract lock)',
      ],
      resaleRule: '🔒 SOULBOUND: Trading & secondary transfer permanently locked by protocol',
    },
  },
];

export const OfficialFestStore: React.FC<OfficialFestStoreProps> = ({
  user,
  balance,
  holdings,
  csrfToken,
  onNavigateToResale,
  onOpenDeposit,
  onPurchaseSuccess,
}) => {
  const [storeSubTab, setStoreSubTab] = useState<'merch' | 'passes' | 'my_orders' | 'my_tickets'>('merch');
  const [selectedSize, setSelectedSize] = useState<Record<string, string>>({
    'MERCH-CLOAK': 'L',
  });
  const [dbProducts, setDbProducts] = useState<any[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [myStoreOrders, setMyStoreOrders] = useState<any[]>([]);
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [attendeeName, setAttendeeName] = useState<string>('');
  const [buyingTierId, setBuyingTierId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [confirmPurchaseData, setConfirmPurchaseData] = useState<PurchaseConfirmationData | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        setDbProducts(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const fetchMyOrders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/store/orders/my', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMyStoreOrders(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [user]);

  const fetchMyTickets = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/store/tickets/my', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMyTickets(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    fetchProducts();
    if (storeSubTab === 'passes') fetchEvents();
    if (storeSubTab === 'my_orders') fetchMyOrders();
    if (storeSubTab === 'my_tickets') fetchMyTickets();
  }, [storeSubTab, fetchProducts, fetchEvents, fetchMyOrders, fetchMyTickets]);

  const handleBuyDbProduct = async (product: any) => {
    if (!user) {
      alert('Please log in with a student account to purchase merchandise.');
      return;
    }

    const chosenVarId = selectedVariantId[product.id] || product.variants?.[0]?.id;
    if (!chosenVarId) {
      alert('Please select an available variant.');
      return;
    }

    const chosenVariant = product.variants?.find((v: any) => v.id === chosenVarId) || product.variants?.[0];
    if (!chosenVariant || chosenVariant.stock <= 0) {
      alert('Selected variant is out of stock.');
      return;
    }

    const priceMinor = Number(product.base_price_dkc) + Number(chosenVariant.price_adjustment_dkc);
    const priceWhole = priceMinor / 100;
    const imageUrl = product.imageUrl || product.images?.[0] || null;

    if (availableDKC < priceWhole) {
      setPurchaseNotice({
        success: false,
        title: 'INSUFFICIENT AVAILABLE DKC',
        message: `You need ${priceWhole.toLocaleString()} DKC to buy "${product.name}". Available balance: ${availableDKC.toLocaleString()} DKC.`,
      });
      return;
    }

    setConfirmPurchaseData({
      title: product.name,
      imageUrl: imageUrl || undefined,
      variantTitle: `${chosenVariant.title} (${chosenVariant.sku})`,
      quantity: 1,
      unitPriceDkc: priceWhole,
      sellerName: product.organization_name ? `🏛️ ${product.organization_name}` : '🏛️ Official Fest Club',
      isEscrow: true,
      onConfirm: async () => {
        const res = await fetch('/api/store/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            orderType: 'MERCHANDISE',
            organizationId: product.organization_id,
            items: [{ variantId: chosenVariant.id, quantity: 1 }],
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          onPurchaseSuccess();
          fetchProducts();
          fetchMyOrders();
          return {
            success: true,
            pickupToken: data.pickupToken,
            orderNumber: data.orderNumber,
            journalId: data.journalId,
          };
        } else {
          return {
            success: false,
            error: data.error || 'Checkout could not be completed.',
          };
        }
      },
    });
  };

  const handleBuyTicketTier = async (event: any, tier: any) => {
    if (!user) {
      alert('Please log in to purchase event passes.');
      return;
    }
    const priceWhole = tier.price_dkc / 100;
    if (availableDKC < priceWhole) {
      setPurchaseNotice({
        success: false,
        title: 'INSUFFICIENT AVAILABLE DKC',
        message: `You need ${priceWhole.toLocaleString()} DKC to buy this pass. Current available balance: ${availableDKC.toLocaleString()} DKC.`,
      });
      return;
    }

    setBuyingTierId(tier.id);
    setConfirmPurchaseData({
      title: `${event.title} — ${tier.name}`,
      imageUrl: event.banner_url || undefined,
      variantTitle: tier.perks || 'Standard Admission',
      quantity: 1,
      unitPriceDkc: priceWhole,
      sellerName: event.organization_name ? `🏛️ ${event.organization_name}` : '🏛️ Official Fest Club',
      isEscrow: false,
      onConfirm: async () => {
        const res = await fetch('/api/store/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            orderType: 'TICKET',
            organizationId: event.organization_id,
            items: [{ ticketTierId: tier.id, quantity: 1 }],
            attendeeName: attendeeName.trim() || user.username,
            attendeeEmail: `${user.username}@mnnit.ac.in`,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          onPurchaseSuccess();
          fetchMyTickets();
          fetchMyOrders();
          fetchEvents();
          return {
            success: true,
            ticketCode: data.tickets?.[0]?.ticketCode,
            orderNumber: data.orderNumber,
            journalId: data.journalId,
            pickupToken: data.tickets?.[0]?.ticketCode?.slice(-6),
          };
        } else {
          return {
            success: false,
            error: data.error || 'Failed to complete ticket order.',
          };
        }
      },
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(id);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleDispute = async (orderId: string) => {
    const reason = prompt('Please describe the issue (e.g. Item never received, Damaged goods, Wrong size):');
    if (!reason || !reason.trim()) return;

    try {
      const res = await fetch(`/api/store/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Dispute recorded. The club fulfillment team and platform admin have been notified.');
        fetchMyOrders();
      } else {
        alert(data.error || 'Failed to submit dispute.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error.');
    }
  };
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<StoreItem | null>(null);
  const [purchaseNotice, setPurchaseNotice] = useState<{
    success: boolean;
    title: string;
    message: string;
    journalId?: string;
  } | null>(null);

  const availableDKC = balance.available / 100;

  const handleBuyItem = async (item: StoreItem) => {
    if (!user) {
      alert('Please log in with a demo account (e.g. Alice or Bob) to purchase official festival items.');
      return;
    }

    if (item.isSoulbound && user.role !== 'admin') {
      alert('Soulbound credentials can only be granted by the Festival Core Council, not directly purchased.');
      return;
    }

    if (availableDKC < item.priceDKC) {
      setPurchaseNotice({
        success: false,
        title: 'INSUFFICIENT AVAILABLE DKC',
        message: `You need ${item.priceDKC.toLocaleString()} DKC (₹${item.priceDKC.toLocaleString()}) to buy this item, but your available balance is ${availableDKC.toLocaleString()} DKC. Click Deposit INR to fund your wallet via UPI instantly.`,
      });
      return;
    }

    setBuyingId(item.id);
    const itemTitle = item.hasSizes
      ? `${item.title} (Size: ${selectedSize[item.symbol] || 'L'})`
      : item.title;

    setConfirmPurchaseData({
      title: item.title,
      variantTitle: item.hasSizes ? `Size: ${selectedSize[item.symbol] || 'L'}` : item.badgeTag,
      quantity: 1,
      unitPriceDkc: item.priceDKC,
      sellerName: '🏛️ Festival Core Council',
      isEscrow: false,
      onConfirm: async () => {
        setBuyingId(null);
        const res = await fetch('/api/merch/purchase', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            sellerUsername: 'admin',
            amount: item.priceDKC,
            itemTitle,
            symbol: item.symbol,
            itemSymbol: item.symbol,
            qty: 1,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          onPurchaseSuccess();
          return {
            success: true,
            pickupToken: `PK-${Math.floor(100000 + Math.random() * 900000)}`,
            orderNumber: data.transferId || data.journalId,
            journalId: data.journalId || data.transferId,
          };
        } else {
          return {
            success: false,
            error: data.message || data.error || 'Transaction could not be completed.',
          };
        }
      },
    });
  };

  return (
    <div style={{ padding: '24px', flex: 1, overflowY: 'auto', fontFamily: '"JetBrains Mono", monospace' }}>
      {/* 1. Header Banner & Real-World Concept Bridge */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(9, 13, 26, 0.98) 100%)',
          border: '1px solid #1E293B',
          borderRadius: 8,
          padding: '24px 28px',
          marginBottom: 24,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 26 }}>🏪</span>
            <h1 style={{ fontSize: 22, color: '#00F0FF', margin: 0, letterSpacing: '0.04em', fontWeight: 800 }}>
              OFFICIAL CAMPUS FESTIVAL STORE
            </h1>
            <span
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid #10B981',
                color: '#10B981',
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 4,
              }}
            >
              PRIMARY ISSUANCE • 1 DKC = ₹1 INR
            </span>
          </div>
          <p style={{ color: '#94A3B8', fontSize: 13, margin: 0, maxWidth: 860, lineHeight: 1.5 }}>
            Official merchandise and pronite passes sold directly by the{' '}
            <strong style={{ color: '#F8FAFC' }}>Festival Organizing Club & Box Office</strong>. All primary revenue settles directly into the campus organizing committee treasury.
          </p>

          {/* 2-Step Real World Student Bridge */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
              marginTop: 20,
              paddingTop: 18,
              borderTop: '1px solid #1E293B',
            }}
          >
            <div
              style={{
                background: 'rgba(0, 240, 255, 0.05)',
                border: '1px solid rgba(0, 240, 255, 0.25)',
                borderRadius: 6,
                padding: '12px 16px',
              }}
            >
              <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                STEP 1: PRIMARY BOX OFFICE (THIS STORE)
              </div>
              <div style={{ color: '#CBD5E1', fontSize: 11, lineHeight: 1.45 }}>
                Buy original concert tickets and official apparel directly from the club at fixed box-office prices with guaranteed authenticity.
              </div>
            </div>

            <div
              style={{
                background: 'rgba(245, 158, 11, 0.05)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: 6,
                padding: '12px 16px',
              }}
            >
              <div style={{ color: '#F59E0B', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                STEP 2: VERIFIED STUDENT RESALE MARKET
              </div>
              <div style={{ color: '#CBD5E1', fontSize: 11, lineHeight: 1.45 }}>
                Plans changed or missed out on a sold-out drop? Students resell owned tickets on our{' '}
                <strong style={{ color: '#F59E0B' }}>Resale Order Book</strong> with a strict{' '}
                <strong style={{ color: '#10B981' }}>+10% Anti-Scalping Price Cap</strong> and instant UPI cashout!
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      {purchaseNotice && (
        <div
          style={{
            background: purchaseNotice.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 42, 84, 0.15)',
            border: `1px solid ${purchaseNotice.success ? '#10B981' : '#FF2A54'}`,
            borderRadius: 6,
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                color: purchaseNotice.success ? '#10B981' : '#FF2A54',
                fontWeight: 800,
                fontSize: 13,
                marginBottom: 4,
              }}
            >
              {purchaseNotice.title}
            </div>
            <div style={{ color: '#F8FAFC', fontSize: 12, lineHeight: 1.4 }}>{purchaseNotice.message}</div>
            {purchaseNotice.journalId && (
              <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
                Postings Journal: <code>{purchaseNotice.journalId}</code>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!purchaseNotice.success && (
              <button
                onClick={onOpenDeposit}
                style={{
                  background: '#00F0FF',
                  color: '#06080F',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                💳 TOP UP DKC VIA UPI
              </button>
            )}
            <button
              onClick={() => setPurchaseNotice(null)}
              style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 16 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Sub-Navigation Navigation Strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #1E293B', paddingBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setStoreSubTab('merch')}
          style={{
            background: storeSubTab === 'merch' ? '#00F0FF' : 'rgba(255, 255, 255, 0.04)',
            color: storeSubTab === 'merch' ? '#06080F' : '#94A3B8',
            border: '1px solid',
            borderColor: storeSubTab === 'merch' ? '#00F0FF' : '#1E293B',
            padding: '7px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          🛍️ OFFICIAL FEST MERCHANDISE
        </button>
        <button
          onClick={() => setStoreSubTab('passes')}
          style={{
            background: storeSubTab === 'passes' ? '#00F0FF' : 'rgba(255, 255, 255, 0.04)',
            color: storeSubTab === 'passes' ? '#06080F' : '#94A3B8',
            border: '1px solid',
            borderColor: storeSubTab === 'passes' ? '#00F0FF' : '#1E293B',
            padding: '7px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          🎟️ PRONITE CONCERTS &amp; PASSES ({events.length})
        </button>
        <button
          onClick={() => setStoreSubTab('my_orders')}
          style={{
            background: storeSubTab === 'my_orders' ? '#10B981' : 'rgba(255, 255, 255, 0.04)',
            color: storeSubTab === 'my_orders' ? '#06080F' : '#94A3B8',
            border: '1px solid',
            borderColor: storeSubTab === 'my_orders' ? '#10B981' : '#1E293B',
            padding: '7px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          📋 MY STORE ORDERS &amp; PICKUP TOKENS ({myStoreOrders.length})
        </button>
        <button
          onClick={() => setStoreSubTab('my_tickets')}
          style={{
            background: storeSubTab === 'my_tickets' ? '#F59E0B' : 'rgba(255, 255, 255, 0.04)',
            color: storeSubTab === 'my_tickets' ? '#06080F' : '#94A3B8',
            border: '1px solid',
            borderColor: storeSubTab === 'my_tickets' ? '#F59E0B' : '#1E293B',
            padding: '7px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          🎫 MY FESTIVAL PASSES &amp; CODES ({myTickets.length})
        </button>
      </div>

      {/* 2. Visual Product Catalog Grid */}
      {storeSubTab === 'merch' && (
      <div>
        {dbProducts.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 24,
              marginBottom: 36,
            }}
          >
            {dbProducts.map((prod: any) => {
              const activeVarId = selectedVariantId[prod.id] || prod.variants?.[0]?.id;
              const activeVar = prod.variants?.find((v: any) => v.id === activeVarId) || prod.variants?.[0];
              const priceMinor = Number(prod.base_price_dkc) + Number(activeVar?.price_adjustment_dkc || 0);
              const priceWhole = priceMinor / 100;
              const canAfford = availableDKC >= priceWhole;
              const isBuying = buyingId === prod.id;
              const hasStock = activeVar && activeVar.stock > 0;
              let imageUrl: string | null = null;
              if (Array.isArray(prod.images) && prod.images.length > 0) {
                imageUrl = typeof prod.images[0] === 'string' ? prod.images[0] : null;
              } else if (typeof prod.images === 'string' && prod.images.trim().startsWith('[')) {
                try {
                  const parsed = JSON.parse(prod.images);
                  if (Array.isArray(parsed) && parsed.length > 0) imageUrl = parsed[0];
                } catch {}
              } else if (typeof prod.images === 'string' && prod.images.trim().length > 0) {
                imageUrl = prod.images.trim();
              } else if ((prod as any).imageUrl) {
                imageUrl = (prod as any).imageUrl;
              } else if ((prod as any).image_url) {
                imageUrl = (prod as any).image_url;
              }

              return (
                <div
                  key={prod.id}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #1E293B',
                    background: '#070A14',
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.6)',
                  }}
                >
                  {/* Product Header / Visual */}
                  <div
                    style={{
                      height: 200,
                      position: 'relative',
                      background: 'linear-gradient(180deg, rgba(0, 240, 255, 0.08) 0%, #05070D 100%)',
                      borderBottom: '1px solid #1E293B',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={prod.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                          const p = e.currentTarget.parentElement;
                          if (p && !p.querySelector('.fallback-placeholder')) {
                            const fb = document.createElement('div');
                            fb.className = 'fallback-placeholder';
                            fb.style.fontSize = '64px';
                            fb.innerText = '👕';
                            p.appendChild(fb);
                          }
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 64 }}>👕</div>
                    )}

                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        background: 'rgba(6, 8, 15, 0.85)',
                        border: '1px solid #00F0FF',
                        color: '#00F0FF',
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 800,
                      }}
                    >
                      {prod.category}
                    </div>

                    <div
                      style={{
                        position: 'absolute',
                        bottom: 10,
                        right: 10,
                        background: '#06080F',
                        border: '1px solid #10B981',
                        padding: '4px 10px',
                        borderRadius: 6,
                        textAlign: 'right',
                      }}
                    >
                      <div style={{ color: '#10B981', fontWeight: 900, fontSize: 16 }}>
                        {priceWhole.toLocaleString()} DKC
                      </div>
                      <div style={{ fontSize: 9, color: '#94A3B8' }}>₹{priceWhole.toLocaleString()} INR</div>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700, marginBottom: 4 }}>
                      🏛️ {prod.organization_name || 'Official Organizing Club'}
                    </div>
                    <h3 style={{ fontSize: 15, color: '#F8FAFC', margin: '0 0 6px 0', lineHeight: 1.3 }}>
                      {prod.name}
                    </h3>
                    <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 10px 0', lineHeight: 1.4, flex: 1 }}>
                      {prod.description}
                    </p>

                    <div style={{ fontSize: 10, color: '#64748B', marginBottom: 10 }}>
                      📍 Pickup: <strong style={{ color: '#CBD5E1' }}>{prod.pickup_location}</strong>
                    </div>

                    {/* Variant Selector */}
                    {prod.variants && prod.variants.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, marginBottom: 4 }}>
                          SELECT CONFIGURATION / VARIANT:
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {prod.variants.map((v: any) => {
                            const isSelected = (activeVarId || prod.variants[0].id) === v.id;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setSelectedVariantId({ ...selectedVariantId, [prod.id]: v.id })}
                                style={{
                                  background: isSelected ? 'rgba(0, 240, 255, 0.2)' : '#04060A',
                                  border: `1px solid ${isSelected ? '#00F0FF' : '#1E293B'}`,
                                  color: isSelected ? '#00F0FF' : '#94A3B8',
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: isSelected ? 800 : 500,
                                  cursor: 'pointer',
                                }}
                              >
                                {v.title} ({v.stock} in stock)
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Buy Button */}
                    <button
                      type="button"
                      onClick={() => handleBuyDbProduct(prod)}
                      disabled={isBuying || !hasStock}
                      style={{
                        background: !hasStock ? '#1E293B' : canAfford ? '#00F0FF' : '#1E293B',
                        color: !hasStock || !canAfford ? '#64748B' : '#06080F',
                        border: 'none',
                        borderRadius: 4,
                        padding: '10px 14px',
                        fontSize: 11,
                        fontWeight: 900,
                        cursor: isBuying || !hasStock ? 'not-allowed' : 'pointer',
                        letterSpacing: 0.5,
                      }}
                    >
                      {!hasStock
                        ? 'OUT OF STOCK'
                        : isBuying
                        ? 'CREATING ORDER...'
                        : canAfford
                        ? `🛒 BUY FOR ${priceWhole} DKC`
                        : `LOW BALANCE (${priceWhole} DKC NEEDED)`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
              gap: 24,
              marginBottom: 36,
            }}
          >
            {STORE_ITEMS.map((item) => {
              const userOwnsQty = holdings.find((h) => h.symbol === item.symbol)?.available || 0;
              const canAfford = availableDKC >= item.priceDKC;

          return (
            <div
              key={item.id}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                border: `1px solid ${item.themeColor}55`,
                background: '#070A14',
                borderRadius: 8,
                overflow: 'hidden',
                boxShadow: `0 4px 24px rgba(0, 0, 0, 0.6)`,
                transition: 'transform 0.2s ease, border-color 0.2s ease',
              }}
            >
              {/* Product Visual Header (Minimum 220px tall) */}
              <div
                style={{
                  height: 230,
                  position: 'relative',
                  background: `linear-gradient(180deg, ${item.themeColor}12 0%, #05070D 100%)`,
                  borderBottom: `1px solid ${item.themeColor}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {/* SVG Visual Illustration per product */}
                {renderProductVisual(item.symbol, item.themeColor)}

                {/* Badge Tag */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    background: 'rgba(6, 8, 15, 0.85)',
                    border: `1px solid ${item.themeColor}`,
                    color: item.themeColor,
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: 0.5,
                  }}
                >
                  {item.badgeTag}
                </div>

                {/* Lightbox / Preview Button */}
                <button
                  type="button"
                  onClick={() => setPreviewItem(item)}
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'rgba(6, 8, 15, 0.85)',
                    border: '1px solid #334155',
                    color: '#94A3B8',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="View high-resolution specs, materials and festival rules"
                >
                  <span>🔍 View Specs</span>
                </button>

                {/* Price Pill Floating */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    background: '#06080F',
                    border: `1px solid ${item.themeColor}`,
                    padding: '4px 10px',
                    borderRadius: 6,
                    textAlign: 'right',
                  }}
                >
                  <div style={{ color: item.themeColor, fontWeight: 900, fontSize: 16 }}>
                    {item.priceDKC.toLocaleString()} DKC
                  </div>
                  <div style={{ fontSize: 9, color: '#94A3B8' }}>₹{item.priceDKC.toLocaleString()} INR Fixed</div>
                </div>
              </div>

              {/* Card Body */}
              <div style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700, marginBottom: 4 }}>
                  {item.sellerLabel}
                </div>
                <h3 style={{ fontSize: 16, color: '#F8FAFC', margin: '0 0 8px 0', lineHeight: 1.3 }}>
                  {item.title}
                </h3>
                <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 12px 0', lineHeight: 1.45, flex: 1 }}>
                  {item.description}
                </p>

                {/* Specs Pill */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid #1E293B',
                    borderRadius: 4,
                    padding: '8px 10px',
                    fontSize: 10,
                    color: '#CBD5E1',
                    marginBottom: 14,
                    lineHeight: 1.4,
                  }}
                >
                  {item.specs}
                </div>

                {/* Interactive Size Selector for Cloak / Apparel */}
                {item.hasSizes && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, marginBottom: 6 }}>
                      SELECT APPAREL SIZE:
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['S', 'M', 'L', 'XL', 'XXL'].map((sz) => {
                        const isCurSize = (selectedSize[item.symbol] || 'L') === sz;
                        return (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => setSelectedSize((prev) => ({ ...prev, [item.symbol]: sz }))}
                            style={{
                              flex: 1,
                              background: isCurSize ? 'rgba(255, 42, 84, 0.25)' : '#04060A',
                              border: `1px solid ${isCurSize ? '#FF2A54' : '#1E293B'}`,
                              color: isCurSize ? '#FF2A54' : '#94A3B8',
                              borderRadius: 4,
                              padding: '5px 0',
                              fontSize: 11,
                              fontWeight: isCurSize ? 800 : 500,
                              cursor: 'pointer',
                            }}
                          >
                            {sz}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Student Ownership & Resale Bridge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: userOwnsQty > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${userOwnsQty > 0 ? '#10B98144' : '#1E293B'}`,
                    borderRadius: 4,
                    marginBottom: 14,
                    fontSize: 10,
                  }}
                >
                  <div>
                    <span style={{ color: '#64748B' }}>In Your Inventory: </span>
                    <strong style={{ color: userOwnsQty > 0 ? '#10B981' : '#F8FAFC' }}>
                      {userOwnsQty} {userOwnsQty === 1 ? 'unit' : 'units'}
                    </strong>
                  </div>
                  {userOwnsQty > 0 && !item.isSoulbound && (
                    <button
                      type="button"
                      onClick={() => onNavigateToResale(item.symbol)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#00F0FF',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      Resell Yours on Market →
                    </button>
                  )}
                </div>

                {/* Buy Action Button */}
                {item.isSoulbound ? (
                  <button
                    disabled
                    style={{
                      background: 'rgba(168, 85, 247, 0.12)',
                      border: '1px solid #A855F7',
                      color: '#A855F7',
                      borderRadius: 4,
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'not-allowed',
                      letterSpacing: 0.5,
                    }}
                  >
                    🔒 NON-SALEABLE SOULBOUND HONOR
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuyItem(item)}
                    disabled={buyingId === item.id}
                    style={{
                      background: canAfford ? item.themeColor : '#1E293B',
                      color: canAfford ? '#06080F' : '#64748B',
                      border: 'none',
                      borderRadius: 4,
                      padding: '11px 16px',
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: buyingId === item.id ? 'not-allowed' : 'pointer',
                      letterSpacing: 0.5,
                      boxShadow: canAfford ? `0 0 16px ${item.glowColor}` : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {buyingId === item.id
                      ? 'PROCESSING LEDGER MINT...'
                      : canAfford
                      ? `🛒 BUY OFFICIAL ITEM (${item.priceDKC} DKC)`
                      : `LOW BALANCE (${item.priceDKC} DKC NEEDED)`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
          </div>
        )}
      </div>
      )}

      {/* SUBTAB: PRONITE CONCERTS & PASSES */}
      {storeSubTab === 'passes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 900, color: '#00F0FF', margin: 0 }}>
                OFFICIAL FESTIVAL PRONITE CONCERTS &amp; PASSES
              </h3>
              <p style={{ fontSize: 12, color: '#94A3B8', margin: '4px 0 0 0' }}>
                Primary ticket allocation direct from the MNNIT Festival Committee. Real-time capacity enforcement.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Attendee Name (e.g. Alice Sharma)"
                value={attendeeName}
                onChange={(e) => setAttendeeName(e.target.value)}
                style={{
                  background: '#0B1120',
                  border: '1px solid #1E293B',
                  borderRadius: 6,
                  color: '#F8FAFC',
                  padding: '6px 12px',
                  fontSize: 11,
                  width: 200,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎟️</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No upcoming events currently scheduled</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 36 }}>
              {events.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    background: 'linear-gradient(180deg, #0D1424 0%, #080D1A 100%)',
                    border: '1px solid #1E293B',
                    borderRadius: 10,
                    padding: 20,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 900, color: '#F8FAFC', margin: 0 }}>{evt.title}</h2>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', border: '1px solid #10B981' }}>
                          {evt.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{evt.description}</div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                        📍 Venue: <strong style={{ color: '#E2E8F0' }}>{evt.venue}</strong> • ⏱️ Starts: {new Date(evt.starts_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 14 }}>
                    {evt.ticketTiers?.map((tier: any) => {
                      const priceWhole = Number(tier.price_dkc) / 100;
                      const isSoldOut = tier.sold_count >= tier.capacity;
                      const isBuying = buyingTierId === tier.id;
                      const canAfford = availableDKC >= priceWhole;

                      return (
                        <div
                          key={tier.id}
                          style={{
                            background: tier.is_vip ? 'rgba(245, 158, 11, 0.05)' : 'rgba(0, 240, 255, 0.05)',
                            border: `1px solid ${tier.is_vip ? '#F59E0B' : '#00F0FF'}44`,
                            borderRadius: 8,
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 900, color: tier.is_vip ? '#F59E0B' : '#00F0FF' }}>
                                {tier.name} {tier.is_vip && '★ VIP ALL-ACCESS'}
                              </span>
                              <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                                {tier.capacity - tier.sold_count} left
                              </span>
                            </div>

                            <div style={{ fontSize: 18, fontWeight: 900, color: '#F8FAFC', marginBottom: 10, fontFamily: '"JetBrains Mono", monospace' }}>
                              {priceWhole.toLocaleString()} DKC <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500 }}>(₹{priceWhole.toLocaleString()})</span>
                            </div>

                            {tier.perks && tier.perks.length > 0 && (
                              <div style={{ fontSize: 11, color: '#CBD5E1', marginBottom: 14, lineHeight: 1.5 }}>
                                {tier.perks.map((p: string, idx: number) => (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: tier.is_vip ? '#F59E0B' : '#00F0FF' }}>✓</span>
                                    <span>{p}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => handleBuyTicketTier(evt, tier)}
                            disabled={isSoldOut || isBuying}
                            style={{
                              background: isSoldOut ? '#1E293B' : tier.is_vip ? '#F59E0B' : '#00F0FF',
                              color: isSoldOut ? '#64748B' : '#06080F',
                              border: 'none',
                              padding: '10px 14px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: isSoldOut || isBuying ? 'not-allowed' : 'pointer',
                              fontFamily: '"JetBrains Mono", monospace',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {isSoldOut
                              ? 'SOLD OUT'
                              : isBuying
                              ? 'ISSUING PASS...'
                              : canAfford
                              ? `BUY PASS (${priceWhole} DKC)`
                              : `LOW BALANCE (${priceWhole} DKC)`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB: MY STORE ORDERS & PICKUP TOKENS */}
      {storeSubTab === 'my_orders' && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 900, color: '#10B981', margin: 0 }}>
                MY STORE ORDERS &amp; CAMPUS PICKUP TOKENS
              </h3>
              <p style={{ fontSize: 12, color: '#94A3B8', margin: '4px 0 0 0' }}>
                Present your unguessable 6-character pickup OTP at the campus distribution desk to collect your gear.
              </p>
            </div>
            <button
              onClick={fetchMyOrders}
              style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10B981', color: '#10B981', padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace' }}
            >
              🔄 Refresh Orders
            </button>
          </div>

          {myStoreOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No orders placed yet</div>
              <p style={{ fontSize: 12, color: '#64748B', margin: '6px 0 14px 0' }}>
                Purchase festival merchandise or tickets to view your pickup tokens here.
              </p>
              <button onClick={() => setStoreSubTab('merch')} style={{ background: '#10B981', color: '#06080F', border: 'none', padding: '6px 14px', borderRadius: 4, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
                Browse Merchandise
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {myStoreOrders.map((ord: any) => {
                const isCollected = ord.status === 'COLLECTED';
                return (
                  <div
                    key={ord.id}
                    style={{
                      background: '#0D1424',
                      border: '1px solid #1E293B',
                      borderRadius: 8,
                      padding: 16,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 16,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#00F0FF', fontFamily: '"JetBrains Mono", monospace' }}>
                          {ord.order_number}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: isCollected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                            color: isCollected ? '#10B981' : '#F59E0B',
                          }}
                        >
                          {ord.status}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748B' }}>
                          {new Date(ord.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        {ord.items?.map((item: any, idx: number) => (
                          <div key={idx} style={{ fontSize: 12, color: '#CBD5E1' }}>
                            • <strong>{item.item_title}</strong> {item.variant_title ? `(${item.variant_title})` : ''} × {item.quantity} — {(item.total_price_dkc / 100).toLocaleString()} DKC
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: '#64748B' }}>CAMPUS PICKUP TOKEN (OTP)</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#10B981', letterSpacing: '0.1em', fontFamily: '"JetBrains Mono", monospace' }}>
                          {ord.pickup_token}
                        </div>
                      </div>

                      <button
                        onClick={() => copyToClipboard(ord.pickup_token, ord.id)}
                        style={{
                          background: copiedToken === ord.id ? '#10B981' : 'rgba(16, 185, 129, 0.15)',
                          color: copiedToken === ord.id ? '#06080F' : '#10B981',
                          border: '1px solid #10B981',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        {copiedToken === ord.id ? '✓ COPIED' : '📋 COPY TOKEN'}
                      </button>

                      {ord.status !== 'DISPUTED' ? (
                        <button
                          onClick={() => handleDispute(ord.id)}
                          style={{
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#F87171',
                            border: '1px solid #EF444455',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ⚠️ Report Issue
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: '#F87171', fontWeight: 800, padding: '4px 8px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: 4 }}>
                          ⚠️ DISPUTE OPEN
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB: MY FESTIVAL PASSES & CODES */}
      {storeSubTab === 'my_tickets' && (
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 900, color: '#F59E0B', margin: 0 }}>
                MY FESTIVAL PASSES &amp; GATE CREDENTIALS
              </h3>
              <p style={{ fontSize: 12, color: '#94A3B8', margin: '4px 0 0 0' }}>
                Cryptographic ticket codes and turnstile QR credentials. Checked in live at event gates.
              </p>
            </div>
            <button
              onClick={fetchMyTickets}
              style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #F59E0B', color: '#F59E0B', padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace' }}
            >
              🔄 Refresh Passes
            </button>
          </div>

          {myTickets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎫</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No festival passes in your wallet</div>
              <p style={{ fontSize: 12, color: '#64748B', margin: '6px 0 14px 0' }}>
                Purchase Pronite GA or VIP passes from the Box Office to see your gate passes here.
              </p>
              <button onClick={() => setStoreSubTab('passes')} style={{ background: '#F59E0B', color: '#06080F', border: 'none', padding: '6px 14px', borderRadius: 4, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
                Browse Festival Passes
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
              {myTickets.map((tkt: any) => {
                const isValid = tkt.status === 'VALID';
                return (
                  <div
                    key={tkt.id}
                    style={{
                      background: tkt.is_vip ? 'linear-gradient(135deg, #1C1304 0%, #0D0A05 100%)' : 'linear-gradient(135deg, #07131F 0%, #060A14 100%)',
                      border: `1px solid ${tkt.is_vip ? '#F59E0B' : '#00F0FF'}`,
                      borderRadius: 10,
                      padding: 18,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      boxShadow: `0 4px 20px ${tkt.is_vip ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0, 240, 255, 0.15)'}`,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: tkt.is_vip ? '#F59E0B' : '#00F0FF', color: '#06080F' }}>
                            {tkt.is_vip ? '★ VIP ALL-ACCESS' : 'GENERAL ADMISSION'}
                          </span>
                          <h4 style={{ fontSize: 15, fontWeight: 900, color: '#F8FAFC', margin: '6px 0 2px 0' }}>
                            {tkt.event_title || 'Pronite Festival 2026'}
                          </h4>
                          <div style={{ fontSize: 11, color: '#94A3B8' }}>{tkt.tier_name || 'Pass Tier'}</div>
                        </div>

                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 12,
                            background: isValid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: isValid ? '#10B981' : '#EF4444',
                            border: `1px solid ${isValid ? '#10B981' : '#EF4444'}`,
                          }}
                        >
                          {isValid ? '🟢 VALID' : '🔴 CHECKED IN'}
                        </span>
                      </div>

                      <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, fontSize: 11, color: '#CBD5E1' }}>
                        <div>📍 Venue: <strong>{tkt.event_venue || 'MP Hall Amphitheatre'}</strong></div>
                        <div>👤 Attendee: <strong>{tkt.attendee_name || 'Attendee'}</strong></div>
                      </div>

                      {/* Ticket Code Box */}
                      <div style={{ background: '#04060A', border: '1px dashed #334155', borderRadius: 6, padding: '10px 12px', textAlign: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 9, color: '#64748B', letterSpacing: '0.05em' }}>CRYPTOGRAPHIC TURNSTILE CODE</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: tkt.is_vip ? '#F59E0B' : '#00F0FF', letterSpacing: '0.08em', marginTop: 3, fontFamily: '"JetBrains Mono", monospace' }}>
                          {tkt.ticket_code}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => copyToClipboard(tkt.ticket_code, tkt.id)}
                      style={{
                        background: copiedToken === tkt.id ? '#10B981' : 'transparent',
                        border: `1px solid ${tkt.is_vip ? '#F59E0B' : '#00F0FF'}`,
                        color: copiedToken === tkt.id ? '#06080F' : tkt.is_vip ? '#F59E0B' : '#00F0FF',
                        padding: '7px 12px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      {copiedToken === tkt.id ? '✓ CODE COPIED' : '📋 COPY TICKET CODE'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Specs & Lightbox Modal Preview */}
      {previewItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
            padding: 20,
          }}
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="card"
            style={{
              width: 680,
              maxWidth: '95vw',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#070A14',
              border: `1px solid ${previewItem.themeColor}`,
              borderRadius: 8,
              boxShadow: `0 0 50px ${previewItem.glowColor}`,
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <span style={{ color: previewItem.themeColor, fontSize: 11, fontWeight: 800 }}>
                  {previewItem.badgeTag} • BOX OFFICE SPECS
                </span>
                <h2 style={{ fontSize: 18, color: '#F8FAFC', margin: '4px 0 0 0' }}>{previewItem.title}</h2>
              </div>
              <button
                onClick={() => setPreviewItem(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Large Visual Container */}
            <div
              style={{
                height: 260,
                background: `linear-gradient(180deg, ${previewItem.themeColor}15 0%, #030509 100%)`,
                border: `1px solid ${previewItem.themeColor}33`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
                position: 'relative',
              }}
            >
              {renderProductVisual(previewItem.symbol, previewItem.themeColor, true)}
            </div>

            {/* Detailed Spec List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11, marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: '#04060A', border: '1px solid #161F30', borderRadius: 4, padding: 10 }}>
                  <div style={{ color: '#64748B', fontSize: 10 }}>OFFICIAL SELLER & TREASURY</div>
                  <div style={{ color: '#F8FAFC', fontWeight: 700, marginTop: 2 }}>
                    {previewItem.sellerLabel}
                  </div>
                </div>
                <div style={{ background: '#04060A', border: '1px solid #161F30', borderRadius: 4, padding: 10 }}>
                  <div style={{ color: '#64748B', fontSize: 10 }}>PRIMARY BOX OFFICE PRICE</div>
                  <div style={{ color: previewItem.themeColor, fontWeight: 800, fontSize: 14, marginTop: 2 }}>
                    {previewItem.priceDKC} DKC (₹{previewItem.priceDKC} INR)
                  </div>
                </div>
              </div>

              <div style={{ background: '#04060A', border: '1px solid #161F30', borderRadius: 4, padding: 12 }}>
                <div style={{ color: '#00F0FF', fontWeight: 800, fontSize: 11, marginBottom: 8 }}>
                  KEY FESTIVAL FEATURES & PRIVILEGES:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: '#CBD5E1', lineHeight: 1.6 }}>
                  {previewItem.detailedSpecs.perks.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ul>
              </div>

              <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 4, padding: 12 }}>
                <div style={{ color: '#F59E0B', fontWeight: 800, fontSize: 11, marginBottom: 4 }}>
                  ANTI-SCALPING SECONDARY RESALE GUARANTEE:
                </div>
                <div style={{ color: '#CBD5E1', lineHeight: 1.5 }}>
                  {previewItem.detailedSpecs.resaleRule}
                </div>
              </div>
            </div>

            {/* Modal Bottom Buy Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid #334155',
                  color: '#94A3B8',
                  padding: '10px 18px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Close Preview
              </button>

              {!previewItem.isSoulbound && (
                <button
                  type="button"
                  onClick={() => {
                    const itm = previewItem;
                    setPreviewItem(null);
                    handleBuyItem(itm);
                  }}
                  style={{
                    background: previewItem.themeColor,
                    color: '#06080F',
                    border: 'none',
                    borderRadius: 4,
                    padding: '10px 22px',
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: 'pointer',
                    letterSpacing: 0.5,
                  }}
                >
                  Buy Official Item ({previewItem.priceDKC} DKC)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Universal Pre-Purchase Confirmation & Receipt Modal */}
      <PurchaseConfirmationModal
        data={confirmPurchaseData}
        availableBalanceDkc={availableDKC}
        onClose={() => setConfirmPurchaseData(null)}
        onSuccessDone={() => {
          setConfirmPurchaseData(null);
          onPurchaseSuccess();
        }}
      />
    </div>
  );
};

// Rich SVG Product Illustrations
function renderProductVisual(symbol: string, color: string, isLarge: boolean = false) {
  const w = isLarge ? 260 : 180;
  const h = isLarge ? 220 : 160;

  if (symbol === 'MERCH-CLOAK') {
    return (
      <svg width={w} height={h} viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Glow backdrop */}
        <circle cx="120" cy="100" r="70" fill={color} opacity="0.08" />

        {/* Heavyweight Hoodie / Stealth Cloak Silhouette */}
        {/* Sleeves */}
        <path d="M40 70L80 50L95 85L60 130L40 70Z" fill="#13080B" stroke={color} strokeWidth="2" />
        <path d="M200 70L160 50L145 85L180 130L200 70Z" fill="#13080B" stroke={color} strokeWidth="2" />

        {/* Torso / Body */}
        <path
          d="M80 50L120 40L160 50L170 160C170 165 165 170 160 170H80C75 170 70 165 70 160L80 50Z"
          fill="#0A0507"
          stroke={color}
          strokeWidth="2.5"
        />

        {/* Ribbed Bottom Band */}
        <rect x="70" y="160" width="100" height="12" fill="#180B0F" stroke={color} strokeWidth="1.5" />
        <line x1="75" y1="166" x2="165" y2="166" stroke={color} strokeWidth="1" strokeDasharray="2 2" />

        {/* Hood */}
        <path
          d="M95 48C95 25 105 15 120 15C135 15 145 25 145 48C135 55 105 55 95 48Z"
          fill="#1C0A10"
          stroke={color}
          strokeWidth="2"
        />

        {/* Cyber Drawstrings */}
        <path d="M110 52V85" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M130 52V85" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="110" cy="86" r="2.5" fill={color} />
        <circle cx="130" cy="86" r="2.5" fill={color} />

        {/* Festival Crest Graphic on Chest */}
        <polygon points="120,70 135,95 105,95" fill="none" stroke={color} strokeWidth="2" />
        <circle cx="120" cy="85" r="4" fill={color} />
        <text x="120" y="120" fill={color} fontSize="9" fontWeight="800" textAnchor="middle" letterSpacing="2">
          DARKHOLD 2026
        </text>
        <text x="120" y="132" fill="#64748B" fontSize="7" fontWeight="600" textAnchor="middle">
          240 GSM HEAVYWEIGHT
        </text>

        {/* Kangaroo Pocket */}
        <path d="M85 130H155L150 155H90L85 130Z" fill="#120508" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }

  if (symbol === 'FEST-GA') {
    return (
      <svg width={w} height={h} viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="120" cy="100" r="75" fill={color} opacity="0.08" />

        {/* Concert Ticket Card Body */}
        <rect x="25" y="45" width="190" height="110" rx="8" fill="#040913" stroke={color} strokeWidth="2" />

        {/* Ticket Perforations / Cutouts */}
        <circle cx="25" cy="100" r="10" fill="#05070D" stroke={color} strokeWidth="2" />
        <circle cx="215" cy="100" r="10" fill="#05070D" stroke={color} strokeWidth="2" />
        <line x1="75" y1="46" x2="75" y2="154" stroke={color} strokeWidth="1.5" strokeDasharray="4 4" />

        {/* Left Stub: Barcode & Date */}
        <g transform="translate(36, 60)">
          <rect x="0" y="0" width="3" height="40" fill={color} />
          <rect x="5" y="0" width="2" height="40" fill={color} />
          <rect x="9" y="0" width="5" height="40" fill={color} />
          <rect x="16" y="0" width="2" height="40" fill={color} />
          <rect x="20" y="0" width="4" height="40" fill={color} />
          <rect x="26" y="0" width="2" height="40" fill={color} />
          <text x="14" y="60" fill="#64748B" fontSize="7" textAnchor="middle">#GA-2026</text>
        </g>

        {/* Right Main Ticket Pass Body */}
        <text x="88" y="70" fill={color} fontSize="12" fontWeight="900" letterSpacing="1">
          PRONITE 2026
        </text>
        <text x="88" y="85" fill="#F8FAFC" fontSize="10" fontWeight="700">
          GENERAL ADMISSION
        </text>

        {/* Stage Zone Pill */}
        <rect x="88" y="94" width="112" height="18" rx="3" fill="rgba(0, 240, 255, 0.15)" stroke={color} strokeWidth="1" />
        <text x="144" y="106" fill={color} fontSize="8" fontWeight="800" textAnchor="middle">
          ZONE A: ARENA STANDING
        </text>

        {/* Holographic Security Wave */}
        <path d="M88 128C110 120 130 135 155 125C175 118 190 125 200 122" stroke="#67E8F9" strokeWidth="1.5" strokeDasharray="3 2" />

        <text x="88" y="145" fill="#10B981" fontSize="8" fontWeight="700">
          ✓ RESALE PROTECTED (+10% CAP)
        </text>
      </svg>
    );
  }

  if (symbol === 'FEST-VIP') {
    return (
      <svg width={w} height={h} viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="120" cy="100" r="75" fill={color} opacity="0.08" />

        {/* Lanyard Strap */}
        <path d="M75 15L120 65L165 15" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray="6 3" />
        {/* Metal Carabiner Clip */}
        <rect x="115" y="60" width="10" height="14" rx="2" fill="#D97706" stroke="#FDE68A" strokeWidth="1" />
        <circle cx="120" cy="70" r="2.5" fill="#06080F" />

        {/* VIP Hologram Badge Body */}
        <rect x="65" y="72" width="110" height="120" rx="8" fill="#0B0904" stroke={color} strokeWidth="2.5" />

        {/* Emerald Glow Header */}
        <rect x="67" y="74" width="106" height="32" rx="6" fill="rgba(245, 158, 11, 0.2)" />
        <text x="120" y="94" fill="#FCD34D" fontSize="13" fontWeight="900" textAnchor="middle" letterSpacing="2">
          ALL-ACCESS VIP
        </text>

        {/* Crown & Star Icon */}
        <path d="M105 125L112 115L120 125L128 115L135 125H105Z" fill={color} />
        <circle cx="120" cy="132" r="3" fill="#FCD34D" />

        <text x="120" y="152" fill="#F8FAFC" fontSize="10" fontWeight="800" textAnchor="middle">
          BACKSTAGE SANCTUM
        </text>
        <text x="120" y="164" fill="#64748B" fontSize="8" textAnchor="middle">
          PIT + ARTIST GREEN ROOM
        </text>
        <rect x="80" y="174" width="80" height="10" rx="2" fill="rgba(16, 185, 129, 0.2)" stroke="#10B981" strokeWidth="1" />
        <text x="120" y="182" fill="#10B981" fontSize="7" fontWeight="800" textAnchor="middle">
          VIP CREDENTIAL 2026
        </text>
      </svg>
    );
  }

  // RELIC-AGAMOTTO (Soulbound)
  return (
    <svg width={w} height={h} viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="120" cy="100" r="75" fill={color} opacity="0.08" />

      {/* Runic Talisman Outer Eye */}
      <path
        d="M40 100C65 60 175 60 200 100C175 140 65 140 40 100Z"
        fill="#080410"
        stroke={color}
        strokeWidth="3"
      />
      {/* Middle Sacred Ring */}
      <circle cx="120" cy="100" r="36" stroke="#C084FC" strokeWidth="2" fill="rgba(168, 85, 247, 0.15)" />
      <circle cx="120" cy="100" r="22" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" />

      {/* Inner Pupil / Relic Core */}
      <circle cx="120" cy="100" r="10" fill="#E9D5FF" />
      <circle cx="120" cy="100" r="4" fill="#7E22CE" />

      {/* Soulbound Padlock Seal Overlay */}
      <rect x="145" y="115" width="34" height="28" rx="4" fill="#0A0614" stroke="#EF4444" strokeWidth="2" />
      <path d="M152 115V107C152 101.5 156.5 97 162 97C167.5 97 172 101.5 172 107V115" stroke="#EF4444" strokeWidth="2.5" />
      <circle cx="162" cy="128" r="3" fill="#EF4444" />

      <text x="120" y="165" fill="#C084FC" fontSize="10" fontWeight="900" textAnchor="middle" letterSpacing="1">
        SOULBOUND VERIFIED
      </text>
      <text x="120" y="178" fill="#EF4444" fontSize="8" fontWeight="800" textAnchor="middle">
        NON-TRANSFERABLE IDENTITY
      </text>
    </svg>
  );
}
