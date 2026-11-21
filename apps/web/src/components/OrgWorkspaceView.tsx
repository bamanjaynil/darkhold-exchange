import React, { useState, useEffect, useCallback } from 'react';
import { ImageUploaderAndPreview } from './ImageUploaderAndPreview.js';

interface Organization {
  id: string;
  name: string;
  slug: string;
  org_type: string;
  description: string;
  affiliation?: string;
  contact_email: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  is_verified: boolean;
  role?: string;
}

interface ProductVariant {
  id: string;
  title: string;
  sku: string;
  attributes: Record<string, any>;
  price_adjustment_dkc: number;
  stock: number;
  reserved_stock: number;
  is_available: boolean;
}

interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  base_price_dkc: number;
  base_price_inr: number;
  status: string;
  fulfillment_type: string;
  pickup_location: string;
  pickup_instructions: string;
  variants: ProductVariant[];
}

interface TimedDrop {
  id: string;
  title: string;
  description: string;
  status: string;
  starts_at: string;
  ends_at: string;
  pickup_location: string;
  pickup_window: string;
  items?: any[];
}

interface TicketTier {
  id: string;
  name: string;
  price_dkc: number;
  capacity: number;
  sold_count: number;
  is_vip: boolean;
  perks: string[];
  status: string;
}

interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  status: string;
  ticketTiers?: TicketTier[];
}

interface StoreOrder {
  id: string;
  order_number: string;
  order_type: 'MERCHANDISE' | 'TICKET';
  buyer_username: string;
  subtotal_dkc: number;
  total_dkc: number;
  pickup_token: string;
  status: 'PAID' | 'PROCESSING' | 'COLLECTED' | 'DISPUTED';
  created_at: string;
  collected_at?: string;
  items: Array<{
    item_title: string;
    variant_title: string;
    quantity: number;
    unit_price_dkc: number;
    total_price_dkc: number;
  }>;
}

interface Member {
  id: string;
  user_id: string;
  username: string;
  role: string;
  status: string;
}

interface OrgWorkspaceViewProps {
  user: { id: string; username: string; role: string } | null;
  csrfToken: string | null;
  onBalanceUpdated?: () => void;
}

export const OrgWorkspaceView: React.FC<OrgWorkspaceViewProps> = ({
  user,
  csrfToken,
  onBalanceUpdated,
}) => {
  const [myOrgs, setMyOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<
    'products' | 'drops' | 'events' | 'pickup_scanner' | 'turnstile' | 'team' | 'admin_approvals'
  >('products');

  const [loading, setLoading] = useState<boolean>(true);
  const [workspaceData, setWorkspaceData] = useState<{
    org: Organization | null;
    products: Product[];
    drops: TimedDrop[];
    events: EventItem[];
    orders: StoreOrder[];
    members: Member[];
  }>({
    org: null,
    products: [],
    drops: [],
    events: [],
    orders: [],
    members: [],
  });

  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  // Admin Pending Organizations
  const [pendingOrgs, setPendingOrgs] = useState<Organization[]>([]);

  // Create Product Modal
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [prodName, setProdName] = useState<string>('');
  const [prodDesc, setProdDesc] = useState<string>('');
  const [prodCat, setProdCat] = useState<string>('APPAREL');
  const [prodBasePrice, setProdBasePrice] = useState<string>('800');
  const [prodPickupLoc, setProdPickupLoc] = useState<string>('SAC Counter 2');
  const [prodPickupNotes, setProdPickupNotes] = useState<string>('Show pickup OTP on phone.');
  const [prodVariants, setProdVariants] = useState<
    Array<{ title: string; sku: string; attrName: string; attrVal: string; priceAdj: string; stock: string }>
  >([
    { title: 'Standard Edition', sku: 'ITEM-STD', attrName: 'Edition', attrVal: 'Standard', priceAdj: '0', stock: '50' },
  ]);
  const [prodImages, setProdImages] = useState<string[]>([]);
  const [prodCoverUrl, setProdCoverUrl] = useState<string>('');
  const [creatingProduct, setCreatingProduct] = useState<boolean>(false);

  // Create Drop Modal
  const [showDropModal, setShowDropModal] = useState<boolean>(false);
  const [dropTitle, setDropTitle] = useState<string>('');
  const [dropDesc, setDropDesc] = useState<string>('');
  const [dropCoverUrl, setDropCoverUrl] = useState<string>('');
  const [dropStartsAt, setDropStartsAt] = useState<string>(new Date().toISOString().slice(0, 16));
  const [dropEndsAt, setDropEndsAt] = useState<string>(
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)
  );
  const [dropLocation, setDropLocation] = useState<string>('SAC Ground Floor');
  const [dropWindow, setDropWindow] = useState<string>('10:00 AM - 6:00 PM');
  const [creatingDrop, setCreatingDrop] = useState<boolean>(false);

  // Create Event Modal
  const [showEventModal, setShowEventModal] = useState<boolean>(false);
  const [evtTitle, setEvtTitle] = useState<string>('');
  const [evtDesc, setEvtDesc] = useState<string>('');
  const [evtVenue, setEvtVenue] = useState<string>('MP Hall Main Amphitheatre');
  const [evtStartsAt, setEvtStartsAt] = useState<string>(
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 16)
  );
  const [evtCapacity, setEvtCapacity] = useState<string>('3000');
  const [evtTiers, setEvtTiers] = useState<
    Array<{ name: string; price: string; capacity: string; isVip: boolean; perks: string }>
  >([
    { name: 'General Admission', price: '1500', capacity: '2500', isVip: false, perks: 'Main Arena Entry' },
    { name: 'VIP All-Access', price: '5000', capacity: '500', isVip: true, perks: 'Front Row Pit, Meet & Greet, Fast Track' },
  ]);
  const [creatingEvent, setCreatingEvent] = useState<boolean>(false);

  // Campus Pickup Scanner
  const [pickupTokenInput, setPickupTokenInput] = useState<string>('');
  const [verifyingPickup, setVerifyingPickup] = useState<boolean>(false);
  const [pickupResult, setPickupResult] = useState<any>(null);

  // Turnstile Ticket Scanner
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [ticketCodeInput, setTicketCodeInput] = useState<string>('');
  const [turnstileGate, setTurnstileGate] = useState<string>('GATE_NORTH');
  const [verifyingTurnstile, setVerifyingTurnstile] = useState<boolean>(false);
  const [turnstileResult, setTurnstileResult] = useState<any>(null);

  // Team Invite
  const [inviteUsername, setInviteUsername] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<string>('scanner');
  const [inviting, setInviting] = useState<boolean>(false);

  // 1. Fetch User's Organizations
  const fetchMyOrgs = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/organizations/my', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMyOrgs(data);
        if (data.length > 0 && !selectedOrgId) {
          setSelectedOrgId(data[0].id);
        }
      }
    } catch {
      // fallback
    }
  }, [user, selectedOrgId]);

  // 2. Fetch Admin Pending Orgs (if admin)
  const fetchPendingOrgs = useCallback(async () => {
    if (user?.role !== 'admin') return;
    try {
      const res = await fetch('/api/admin/organizations', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPendingOrgs(data);
      }
    } catch {
      // ignore
    }
  }, [user]);

  // 3. Fetch Workspace Details for Selected Org
  const fetchWorkspace = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/workspace`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceData(data);
        if (data.events && data.events.length > 0 && !selectedEventId) {
          setSelectedEventId(data.events[0].id);
        }
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    fetchMyOrgs();
    fetchPendingOrgs();
  }, [fetchMyOrgs, fetchPendingOrgs]);

  useEffect(() => {
    if (selectedOrgId) {
      fetchWorkspace(selectedOrgId);
    }
  }, [selectedOrgId, fetchWorkspace]);

  // Handle Admin Verification
  const handleAdminVerify = async (orgId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ text: `Organization ${action === 'APPROVE' ? 'approved & verified' : 'rejected'}.`, error: false });
        fetchPendingOrgs();
        fetchMyOrgs();
        if (selectedOrgId === orgId) fetchWorkspace(orgId);
      } else {
        setFeedback({ text: data.error || 'Verification action failed.', error: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Network error.', error: true });
    }
  };

  // Handle Create Product
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;
    setCreatingProduct(true);
    setFeedback(null);

    try {
      const formattedVariants = prodVariants.map((v) => ({
        title: v.title.trim(),
        sku: v.sku.trim().toUpperCase(),
        attributes: v.attrName && v.attrVal ? { [v.attrName.trim()]: v.attrVal.trim() } : {},
        priceAdjustmentDkc: parseFloat(v.priceAdj) || 0,
        stock: parseInt(v.stock, 10) || 0,
      }));

      const res = await fetch(`/api/organizations/${selectedOrgId}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: prodName.trim(),
          description: prodDesc.trim(),
          category: prodCat,
          basePriceDkc: parseFloat(prodBasePrice) || 0,
          pickupLocation: prodPickupLoc.trim(),
          pickupInstructions: prodPickupNotes.trim(),
          images: prodCoverUrl ? [prodCoverUrl, ...prodImages] : prodImages,
          variants: formattedVariants,
        }),
      });

      const data = await res.json();
      if (res.ok && data.id) {
        setFeedback({ text: `Product "${prodName}" created with ${formattedVariants.length} custom variants!`, error: false });
        setShowProductModal(false);
        setProdImages([]);
        fetchWorkspace(selectedOrgId);
      } else {
        setFeedback({ text: data.error || 'Failed to create product.', error: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Network error.', error: true });
    } finally {
      setCreatingProduct(false);
    }
  };

  // Handle Create Drop
  const handleCreateDrop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;
    setCreatingDrop(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/organizations/${selectedOrgId}/drops`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          title: dropTitle.trim(),
          description: dropDesc.trim(),
          coverUrl: dropCoverUrl || undefined,
          startsAt: new Date(dropStartsAt).toISOString(),
          endsAt: new Date(dropEndsAt).toISOString(),
          pickupLocation: dropLocation.trim(),
          pickupWindow: dropWindow.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.id) {
        setFeedback({ text: `Timed drop "${dropTitle}" created!`, error: false });
        setShowDropModal(false);
        fetchWorkspace(selectedOrgId);
      } else {
        setFeedback({ text: data.error || 'Failed to create timed drop.', error: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Network error.', error: true });
    } finally {
      setCreatingDrop(false);
    }
  };

  // Handle Create Event
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;
    setCreatingEvent(true);
    setFeedback(null);

    try {
      const tiers = evtTiers.map((t) => ({
        name: t.name.trim(),
        priceDkc: parseFloat(t.price) || 0,
        capacity: parseInt(t.capacity, 10) || 100,
        isVip: t.isVip,
        perks: t.perks.split(',').map((p) => p.trim()).filter(Boolean),
      }));

      const res = await fetch(`/api/organizations/${selectedOrgId}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          title: evtTitle.trim(),
          description: evtDesc.trim(),
          venue: evtVenue.trim(),
          startsAt: new Date(evtStartsAt).toISOString(),
          endsAt: new Date(new Date(evtStartsAt).getTime() + 5 * 3600000).toISOString(),
          capacity: parseInt(evtCapacity, 10) || 3000,
          ticketTiers: tiers,
        }),
      });

      const data = await res.json();
      if (res.ok && data.id) {
        setFeedback({ text: `Event "${evtTitle}" created with ${tiers.length} ticket tiers!`, error: false });
        setShowEventModal(false);
        fetchWorkspace(selectedOrgId);
      } else {
        setFeedback({ text: data.error || 'Failed to create event.', error: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Network error.', error: true });
    } finally {
      setCreatingEvent(false);
    }
  };

  // Handle Campus Pickup Handover Verification
  const handleVerifyPickup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !pickupTokenInput.trim()) return;
    await handleVerifyPickupTokenDirect(pickupTokenInput.trim());
  };

  const handleVerifyPickupTokenDirect = async (token: string) => {
    if (!selectedOrgId) return;
    setPickupTokenInput(token);
    setVerifyingPickup(true);
    setPickupResult(null);

    try {
      const cleanToken = token.trim().toUpperCase();
      const matchedOrder = workspaceData.orders.find(
        (o) =>
          o.pickup_token === cleanToken ||
          o.pickup_token.replace(/^PK-/, '') === cleanToken ||
          `PK-${o.pickup_token}` === cleanToken
      );

      const url = matchedOrder
        ? `/api/organizations/${selectedOrgId}/orders/${matchedOrder.id}/verify-pickup`
        : `/api/organizations/${selectedOrgId}/orders/by-token/verify-pickup`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          pickupToken: cleanToken,
          notes: 'Handed over at campus desk',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPickupResult({
          success: true,
          orderNumber: matchedOrder?.order_number || data.orderNumber,
          buyerUsername: matchedOrder?.buyer_username || data.buyerUsername,
          items: matchedOrder?.items,
          collectedAt: data.collectedAt || new Date().toISOString(),
        });
        onBalanceUpdated?.();
        fetchWorkspace(selectedOrgId);
      } else {
        setPickupResult({
          success: false,
          error: data.error || 'Pickup verification failed.',
        });
      }
    } catch (err: any) {
      setPickupResult({
        success: false,
        error: err.message || 'Network error during pickup verification.',
      });
    } finally {
      setVerifyingPickup(false);
    }
  };

  // Handle Turnstile Check-In
  const handleTurnstileCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !ticketCodeInput.trim()) return;
    setVerifyingTurnstile(true);
    setTurnstileResult(null);

    try {
      const res = await fetch(`/api/events/${selectedEventId}/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          ticketCode: ticketCodeInput.trim().toUpperCase(),
          gate: turnstileGate,
        }),
      });

      const data = await res.json();
      setTurnstileResult(data);
    } catch (err: any) {
      setTurnstileResult({
        success: false,
        result: 'ERROR',
        message: err.message || 'Turnstile check-in request failed.',
      });
    } finally {
      setVerifyingTurnstile(false);
    }
  };

  // Handle Invite Member
  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !inviteUsername.trim()) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/organizations/${selectedOrgId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          username: inviteUsername.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ text: `Added @${inviteUsername} as ${inviteRole}!`, error: false });
        setInviteUsername('');
        fetchWorkspace(selectedOrgId);
      } else {
        setFeedback({ text: data.error || 'Failed to add member.', error: true });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Network error.', error: true });
    } finally {
      setInviting(false);
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'club') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏛️</div>
        <h3 style={{ fontSize: 18, color: '#F8FAFC', fontWeight: 900 }}>
          ACCESS RESTRICTED: OFFICIAL ORGANIZER WORKSPACE
        </h3>
        <p style={{ maxWidth: 520, margin: '8px auto', fontSize: 13, lineHeight: 1.5 }}>
          The Club Workspace is strictly restricted to verified official festival organizing clubs (<code style={{ color: '#00F0FF' }}>culrav.club@mnnit.ac.in</code>) and administrators. Regular student accounts cannot access or launch official festival drops.
        </p>
      </div>
    );
  }

  const selectedOrg = workspaceData.org || myOrgs.find((o) => o.id === selectedOrgId);

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Top Organization Navigation Bar */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid #1E293B',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>🏛️</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900, color: '#F8FAFC', margin: 0 }}>
                CAMPUS ORGANIZATIONS &amp; CLUBS WORKSPACE
              </h2>
              {selectedOrg && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background:
                      selectedOrg.status === 'APPROVED'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(245, 158, 11, 0.15)',
                    color: selectedOrg.status === 'APPROVED' ? '#10B981' : '#F59E0B',
                    border: `1px solid ${selectedOrg.status === 'APPROVED' ? '#10B981' : '#F59E0B'}`,
                  }}
                >
                  {selectedOrg.status === 'APPROVED' ? '✓ VERIFIED CAMPUS BODY' : '⏳ PENDING REVIEW'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
              Official merchandise drops, custom variants, capacity ticketing, campus pickup verification, and gate turnstiles.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Org Selector */}
          {myOrgs.length > 0 && (
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              style={{
                background: '#0B1120',
                border: '1px solid #00F0FF44',
                color: '#00F0FF',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                outline: 'none',
              }}
            >
              {myOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.status})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {feedback && (
        <div
          style={{
            background: feedback.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${feedback.error ? '#EF4444' : '#10B981'}`,
            color: feedback.error ? '#FCA5A5' : '#6EE7B7',
            padding: '10px 16px',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #1E293B', paddingBottom: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveSubTab('products')}
          style={{
            background: activeSubTab === 'products' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'products' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          👕 Merchandise &amp; Custom Variants
        </button>
        <button
          onClick={() => setActiveSubTab('drops')}
          style={{
            background: activeSubTab === 'drops' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'drops' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ⏳ Timed Drops
        </button>
        <button
          onClick={() => setActiveSubTab('events')}
          style={{
            background: activeSubTab === 'events' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'events' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          🎟️ Events &amp; Passes
        </button>
        <button
          onClick={() => setActiveSubTab('pickup_scanner')}
          style={{
            background: activeSubTab === 'pickup_scanner' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'pickup_scanner' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          📦 Campus Pickup Handover Scanner
        </button>
        <button
          onClick={() => setActiveSubTab('turnstile')}
          style={{
            background: activeSubTab === 'turnstile' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'turnstile' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          🎫 Turnstile Gate Check-In
        </button>
        <button
          onClick={() => setActiveSubTab('team')}
          style={{
            background: activeSubTab === 'team' ? '#00F0FF' : 'transparent',
            color: activeSubTab === 'team' ? '#06080F' : '#94A3B8',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          👥 Team &amp; Permissions
        </button>
        {user?.role === 'admin' && (
          <button
            onClick={() => setActiveSubTab('admin_approvals')}
            style={{
              background: activeSubTab === 'admin_approvals' ? '#F59E0B' : 'transparent',
              color: activeSubTab === 'admin_approvals' ? '#06080F' : '#F59E0B',
              border: '1px solid #F59E0B',
              padding: '6px 14px',
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            🛡️ Admin Approvals ({pendingOrgs.filter((o) => o.status === 'PENDING').length})
          </button>
        )}
      </div>

      {/* SUBTAB 1: MERCHANDISE PRODUCTS */}
      {activeSubTab === 'products' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: 0 }}>
                ORGANIZATION MERCHANDISE CATALOG
              </h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Every item features explicit, organizer-defined custom variants with independent inventory tracking.
              </p>
            </div>
            <button
              onClick={() => setShowProductModal(true)}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ➕ Create Merchandise Product
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Loading products...</div>
          ) : workspaceData.products.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👕</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No products created yet</div>
              <p style={{ fontSize: 12, color: '#64748B', maxWidth: 400, margin: '6px auto 14px auto' }}>
                Define physical merchandise with explicit custom variants (e.g. Mug Colors, Poster Editions, Hoodie Sizes).
              </p>
              <button
                onClick={() => setShowProductModal(true)}
                style={{ background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 12px', borderRadius: 4, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
              >
                Create Product
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {workspaceData.products.map((p) => (
                <div key={p.id} style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.1)', color: '#00F0FF', border: '1px solid #00F0FF44' }}>
                      {p.category}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#10B981', fontFamily: '"JetBrains Mono", monospace' }}>
                      {p.base_price_dkc / 100} DKC (₹{p.base_price_inr})
                    </span>
                  </div>

                  <h4 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: '4px 0 6px 0' }}>{p.name}</h4>
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 10px 0', lineHeight: 1.4 }}>{p.description || 'No description'}</p>

                  <div style={{ fontSize: 10, color: '#64748B', marginBottom: 8 }}>
                    📍 Pickup: {p.pickup_location}
                  </div>

                  {/* Explicit Variants Table */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: 6, padding: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', marginBottom: 4 }}>
                      CONFIGURED VARIANTS ({p.variants?.length || 0})
                    </div>
                    {p.variants?.map((v) => (
                      <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #1E293B33' }}>
                        <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{v.title} <span style={{ color: '#64748B', fontSize: 10 }}>[{v.sku}]</span></span>
                        <span style={{ color: v.stock > 0 ? '#10B981' : '#EF4444', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
                          {v.stock} in stock
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: TIMED DROPS */}
      {activeSubTab === 'drops' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: 0 }}>TIMED MERCHANDISE DROPS</h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Hype drops with real countdown windows, allocation pools, and pickup coordinates.
              </p>
            </div>
            <button
              onClick={() => setShowDropModal(true)}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ➕ Create Timed Drop
            </button>
          </div>

          {workspaceData.drops.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No drops created yet</div>
              <p style={{ fontSize: 12, color: '#64748B', margin: '4px 0 12px 0' }}>Launch scheduled or flash drops for your organization.</p>
              <button onClick={() => setShowDropModal(true)} style={{ background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 12px', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                Create Drop
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
              {workspaceData.drops.map((drop) => (
                <div key={drop.id} style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', border: '1px solid #10B981' }}>
                      {drop.status}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                      {drop.pickup_window}
                    </span>
                  </div>
                  <h4 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: '4px 0' }}>{drop.title}</h4>
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 8px 0' }}>{drop.description}</p>
                  <div style={{ fontSize: 11, color: '#CBD5E1', background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 4 }}>
                    <div>📍 Location: {drop.pickup_location}</div>
                    <div style={{ marginTop: 2 }}>⏱️ Window: {new Date(drop.starts_at).toLocaleDateString()} – {new Date(drop.ends_at).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: EVENTS & PASSES */}
      {activeSubTab === 'events' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: 0 }}>EVENTS &amp; TICKET TIERS</h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Festival pronites, cultural competitions, and tech symposiums with GA and VIP ticket tiers.
              </p>
            </div>
            <button
              onClick={() => setShowEventModal(true)}
              style={{
                background: '#00F0FF',
                color: '#06080F',
                border: 'none',
                padding: '7px 14px',
                borderRadius: 6,
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ➕ Create Event &amp; Tiers
            </button>
          </div>

          {workspaceData.events.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, border: '1px dashed #1E293B' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎟️</div>
              <div style={{ fontSize: 14, color: '#CBD5E1', fontWeight: 700 }}>No events scheduled</div>
              <button onClick={() => setShowEventModal(true)} style={{ marginTop: 10, background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 12px', borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                Create Event
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
              {workspaceData.events.map((evt) => (
                <div key={evt.id} style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.1)', color: '#00F0FF', border: '1px solid #00F0FF44' }}>
                      {evt.status}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748B' }}>📍 {evt.venue}</span>
                  </div>
                  <h4 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: '4px 0' }}>{evt.title}</h4>
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 10px 0' }}>{evt.description}</p>

                  <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: 6, padding: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', marginBottom: 4 }}>TICKET TIERS &amp; CAPACITY</div>
                    {evt.ticketTiers?.map((tier) => (
                      <div key={tier.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '4px 0', borderBottom: '1px solid #1E293B33' }}>
                        <div>
                          <span style={{ color: tier.is_vip ? '#F59E0B' : '#00F0FF', fontWeight: 800 }}>
                            {tier.name} {tier.is_vip && '★ VIP'}
                          </span>
                          <div style={{ fontSize: 9, color: '#64748B' }}>
                            {Array.isArray(tier.perks) ? tier.perks.join(' • ') : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
                          <span style={{ color: '#10B981', fontWeight: 700 }}>{tier.price_dkc / 100} DKC</span>
                          <div style={{ fontSize: 9, color: '#94A3B8' }}>{tier.sold_count} / {tier.capacity} sold</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 4: CAMPUS PICKUP HANDOVER SCANNER */}
      {activeSubTab === 'pickup_scanner' && (
        <div style={{ maxWidth: 650, margin: '0 auto', background: '#0D1424', border: '1px solid #10B98144', borderRadius: 8, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 24 }}>📦</span>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 900, color: '#10B981', margin: 0 }}>
                CAMPUS PICKUP HANDOVER VERIFICATION COUNTER
              </h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Fulfillment staff inputs the student's 6-character unguessable OTP (`PK-XXXXXX`) to mark orders collected.
              </p>
            </div>
          </div>

          <form onSubmit={handleVerifyPickup} style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <input
              type="text"
              required
              placeholder="Enter Pickup Token (e.g. PK-A8F92D)"
              value={pickupTokenInput}
              onChange={(e) => setPickupTokenInput(e.target.value.toUpperCase())}
              style={{
                flex: 1,
                background: '#060A14',
                border: '1px solid #10B981',
                borderRadius: 6,
                padding: '10px 14px',
                color: '#10B981',
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: '0.1em',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            />
            <button
              type="submit"
              disabled={verifyingPickup}
              style={{
                background: '#10B981',
                color: '#06080F',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 6,
                fontWeight: 900,
                fontSize: 12,
                cursor: verifyingPickup ? 'not-allowed' : 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {verifyingPickup ? 'VERIFYING...' : '✓ VERIFY & HANDOVER'}
            </button>
          </form>

          {pickupResult && (
            <div
              style={{
                background: pickupResult.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${pickupResult.success ? '#10B981' : '#EF4444'}`,
                borderRadius: 6,
                padding: 14,
              }}
            >
              {pickupResult.success ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10B981', fontWeight: 900, fontSize: 14 }}>
                    <span>✓</span> HANDOVER COMPLETE &amp; VERIFIED!
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: '#CBD5E1' }}>
                    <div><strong>Order:</strong> {pickupResult.orderNumber}</div>
                    <div><strong>Customer:</strong> @{pickupResult.buyerUsername}</div>
                    <div><strong>Collected At:</strong> {new Date(pickupResult.collectedAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#FCA5A5', fontSize: 12, fontWeight: 700 }}>
                  ✕ {pickupResult.error}
                </div>
              )}
            </div>
          )}

          {/* Recent Orders List */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ fontSize: 12, fontWeight: 800, color: '#94A3B8', marginBottom: 8 }}>
              RECENT ORDERS FOR THIS CLUB ({workspaceData.orders?.length || 0})
            </h4>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {workspaceData.orders?.map((ord) => (
                <div key={ord.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, marginBottom: 6, fontSize: 11 }}>
                  <div>
                    <span style={{ color: '#00F0FF', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace' }}>{ord.order_number}</span>
                    <span style={{ color: '#64748B', marginLeft: 8 }}>@{ord.buyer_username}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', color: '#F8FAFC', fontSize: 11, background: '#060B18', padding: '2px 8px', borderRadius: 4, border: '1px solid #1E293B' }}>
                      OTP: <strong style={{ color: '#10B981' }}>{ord.pickup_token}</strong>
                    </span>
                    {ord.status !== 'COLLECTED' && (
                      <button
                        type="button"
                        onClick={() => void handleVerifyPickupTokenDirect(ord.pickup_token)}
                        style={{
                          background: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid #10B981',
                          color: '#10B981',
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        ⚡ Auto-Fill &amp; Verify Delivery
                      </button>
                    )}
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: ord.status === 'COLLECTED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: ord.status === 'COLLECTED' ? '#10B981' : '#F59E0B' }}>
                      {ord.status === 'COLLECTED' ? '✓ DELIVERED & SETTLED' : ord.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 5: TURNSTILE TICKET GATE CHECK-IN */}
      {activeSubTab === 'turnstile' && (
        <div style={{ maxWidth: 650, margin: '0 auto', background: '#0D1424', border: '1px solid #00F0FF44', borderRadius: 8, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 24 }}>🎫</span>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 900, color: '#00F0FF', margin: 0 }}>
                EVENT TURNSTILE GATE CHECK-IN STATION
              </h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Scan or paste attendee cryptographic ticket codes (`TKT-XXXXXXXXXXXXXXXX`). Duplicate entries are strictly rejected.
              </p>
            </div>
          </div>

          <form onSubmit={handleTurnstileCheckin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Select Event</label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  {workspaceData.events.map((evt) => (
                    <option key={evt.id} value={evt.id}>{evt.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Entry Turnstile / Gate</label>
                <select
                  value={turnstileGate}
                  onChange={(e) => setTurnstileGate(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12 }}
                >
                  <option value="GATE_NORTH">Gate North (Main GA Turnstile)</option>
                  <option value="GATE_SOUTH">Gate South (VIP Fast-Track)</option>
                  <option value="GATE_EAST">Gate East (Staff &amp; Artists)</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Cryptographic Ticket Code</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  required
                  placeholder="Paste Ticket Code (e.g. TKT-E47C8B9F01234567)"
                  value={ticketCodeInput}
                  onChange={(e) => setTicketCodeInput(e.target.value.toUpperCase())}
                  style={{
                    flex: 1,
                    background: '#060A14',
                    border: '1px solid #00F0FF',
                    borderRadius: 6,
                    padding: '10px 14px',
                    color: '#00F0FF',
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                />
                <button
                  type="submit"
                  disabled={verifyingTurnstile}
                  style={{
                    background: '#00F0FF',
                    color: '#06080F',
                    border: 'none',
                    padding: '10px 22px',
                    borderRadius: 6,
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: verifyingTurnstile ? 'not-allowed' : 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  {verifyingTurnstile ? 'CHECKING...' : '⚡ SCAN / ADMIT'}
                </button>
              </div>
            </div>
          </form>

          {turnstileResult && (
            <div
              style={{
                marginTop: 16,
                background:
                  turnstileResult.result === 'VALID'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : turnstileResult.result === 'ALREADY_CHECKED_IN'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(245, 158, 11, 0.15)',
                border: `1px solid ${
                  turnstileResult.result === 'VALID'
                    ? '#10B981'
                    : turnstileResult.result === 'ALREADY_CHECKED_IN'
                    ? '#EF4444'
                    : '#F59E0B'
                }`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: turnstileResult.result === 'VALID' ? '#10B981' : '#EF4444' }}>
                  {turnstileResult.result === 'VALID' ? '🟢 ENTRY GRANTED' : '🔴 ENTRY REJECTED'}
                </div>
                {turnstileResult.ticket?.is_vip && (
                  <span style={{ background: '#F59E0B', color: '#06080F', fontWeight: 900, fontSize: 10, padding: '2px 8px', borderRadius: 10 }}>
                    ★ VIP TIER
                  </span>
                )}
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: '#CBD5E1', lineHeight: 1.5 }}>
                <div><strong>Message:</strong> {turnstileResult.message}</div>
                {turnstileResult.ticket && (
                  <>
                    <div><strong>Attendee:</strong> {turnstileResult.ticket.attendee_name || 'Pass Holder'}</div>
                    <div><strong>Tier:</strong> {turnstileResult.ticket.tier_name || 'General Admission'}</div>
                    <div><strong>Checked In At:</strong> {new Date(turnstileResult.checkedInAt || turnstileResult.ticket.checked_in_at).toLocaleTimeString()}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 6: TEAM & PERMISSIONS */}
      {activeSubTab === 'team' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#F8FAFC', margin: 0 }}>TEAM MEMBERS &amp; ROLES</h3>
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0 0' }}>
                Role-based access: `merch_manager`, `event_manager`, `fulfillment`, `scanner`, `finance`.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
            {/* Members List */}
            <div style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#CBD5E1', marginBottom: 10 }}>ACTIVE MEMBERS ({workspaceData.members?.length || 0})</div>
              {workspaceData.members?.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 6, marginBottom: 6 }}>
                  <div>
                    <span style={{ color: '#F8FAFC', fontWeight: 700 }}>@{m.username}</span>
                    <span style={{ fontSize: 10, color: '#64748B', marginLeft: 8 }}>[{m.user_id}]</span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(0, 240, 255, 0.12)', color: '#00F0FF', border: '1px solid #00F0FF44' }}>
                    {m.role}
                  </span>
                </div>
              ))}
            </div>

            {/* Invite Form */}
            <div style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#00F0FF', marginBottom: 10 }}>INVITE TEAM MEMBER</div>
              <form onSubmit={handleInviteMember} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Username</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. bob or carol"
                    value={inviteUsername}
                    onChange={(e) => setInviteUsername(e.target.value)}
                    style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }}
                  >
                    <option value="merch_manager">Merchandise Manager</option>
                    <option value="event_manager">Event Manager</option>
                    <option value="fulfillment">Fulfillment Staff</option>
                    <option value="scanner">Gate Scanner</option>
                    <option value="finance">Finance Auditor</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={inviting}
                  style={{ marginTop: 6, background: '#00F0FF', color: '#06080F', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 800, fontSize: 11, cursor: inviting ? 'not-allowed' : 'pointer' }}
                >
                  {inviting ? 'Adding...' : 'Add Member'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 7: ADMIN APPROVALS */}
      {activeSubTab === 'admin_approvals' && user?.role === 'admin' && (
        <div style={{ background: '#0D1424', border: '1px solid #F59E0B44', borderRadius: 8, padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 900, color: '#F59E0B', margin: '0 0 4px 0' }}>
            PLATFORM ADMIN: PENDING CLUB VERIFICATIONS
          </h3>
          <p style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 14px 0' }}>
            Review and grant verified status to university festival committees and student societies.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingOrgs.map((org) => (
              <div key={org.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, color: '#F8FAFC', fontSize: 13 }}>{org.name}</span>
                    <span style={{ fontSize: 10, color: '#00F0FF', fontFamily: '"JetBrains Mono", monospace' }}>[{org.slug}]</span>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.2)', color: '#F59E0B' }}>{org.status}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{org.description}</div>
                  <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Contact: {org.contact_email}</div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAdminVerify(org.id, 'APPROVE')}
                    style={{ background: '#10B981', color: '#06080F', border: 'none', padding: '6px 12px', borderRadius: 4, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleAdminVerify(org.id, 'REJECT')}
                    style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #EF4444', color: '#EF4444', padding: '6px 12px', borderRadius: 4, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: CREATE MERCHANDISE PRODUCT (EXPLICIT CUSTOM VARIANTS ONLY) */}
      {showProductModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#0D1424', border: '1px solid #00F0FF55', borderRadius: 10, maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 900, color: '#00F0FF', margin: 0 }}>CREATE MERCHANDISE PRODUCT</h3>
                <span style={{ fontSize: 10, color: '#94A3B8' }}>Explicit custom variants only — no automatically forced sizes</span>
              </div>
              <button onClick={() => setShowProductModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleCreateProduct} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Product Name *</label>
                  <input type="text" required placeholder="e.g. Ceramic Thermal Fest Mug / Commemorative Poster" value={prodName} onChange={(e) => setProdName(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Category</label>
                  <select value={prodCat} onChange={(e) => setProdCat(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }}>
                    <option value="APPAREL">Apparel</option>
                    <option value="ACCESSORY">Accessory</option>
                    <option value="PRINT">Print / Poster</option>
                    <option value="BADGE">Badge / Credential</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea rows={2} placeholder="Item material, build quality, and collection notes..." value={prodDesc} onChange={(e) => setProdDesc(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', resize: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Base Price (DKC) *</label>
                  <input type="number" required min="1" value={prodBasePrice} onChange={(e) => setProdBasePrice(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Campus Pickup Desk</label>
                  <input type="text" placeholder="e.g. SAC Counter 2" value={prodPickupLoc} onChange={(e) => setProdPickupLoc(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Pickup Instructions</label>
                  <input type="text" placeholder="e.g. Show OTP" value={prodPickupNotes} onChange={(e) => setProdPickupNotes(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Product Photograph Upload via Canvas Compressor & Live Preview */}
              <ImageUploaderAndPreview
                value={prodCoverUrl}
                onChange={(url) => {
                  setProdCoverUrl(url);
                  if (url) setProdImages([url]);
                  else setProdImages([]);
                }}
                csrfToken={csrfToken || ''}
                label="PRODUCT PHOTOGRAPH &amp; ACTUAL VISUAL"
              />

              {/* Custom Variants Section */}
              <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: 6, padding: 10, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#00F0FF' }}>
                    EXPLICIT VARIANTS (Define only what you sell!)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setProdVariants([
                        ...prodVariants,
                        { title: `Edition ${prodVariants.length + 1}`, sku: `VAR-${prodVariants.length + 1}`, attrName: 'Option', attrVal: 'Option Value', priceAdj: '0', stock: '25' },
                      ])
                    }
                    style={{ background: '#00F0FF22', border: '1px solid #00F0FF', color: '#00F0FF', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                  >
                    + Add Variant
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {prodVariants.map((v, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 80px 70px 30px', gap: 6, alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="Variant Title (e.g. Neon Cyan)"
                        value={v.title}
                        onChange={(e) => {
                          const copy = [...prodVariants];
                          copy[idx].title = e.target.value;
                          setProdVariants(copy);
                        }}
                        style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                      />
                      <input
                        type="text"
                        placeholder="SKU"
                        value={v.sku}
                        onChange={(e) => {
                          const copy = [...prodVariants];
                          copy[idx].sku = e.target.value;
                          setProdVariants(copy);
                        }}
                        style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                      />
                      <input
                        type="text"
                        placeholder="Attr (e.g. Color)"
                        value={v.attrVal}
                        onChange={(e) => {
                          const copy = [...prodVariants];
                          copy[idx].attrVal = e.target.value;
                          setProdVariants(copy);
                        }}
                        style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                      />
                      <input
                        type="number"
                        placeholder="+DKC"
                        value={v.priceAdj}
                        onChange={(e) => {
                          const copy = [...prodVariants];
                          copy[idx].priceAdj = e.target.value;
                          setProdVariants(copy);
                        }}
                        style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                      />
                      <input
                        type="number"
                        placeholder="Stock"
                        value={v.stock}
                        onChange={(e) => {
                          const copy = [...prodVariants];
                          copy[idx].stock = e.target.value;
                          setProdVariants(copy);
                        }}
                        style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                      />
                      {prodVariants.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setProdVariants(prodVariants.filter((_, i) => i !== idx))}
                          style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}
                        >
                          ✕
                        </button>
                      ) : <span />}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowProductModal(false)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94A3B8', padding: '6px 12px', borderRadius: 4, fontSize: 11 }}>Cancel</button>
                <button type="submit" disabled={creatingProduct} style={{ background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 16px', borderRadius: 4, fontWeight: 800, fontSize: 11 }}>
                  {creatingProduct ? 'Publishing...' : 'Publish Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE TIMED DROP */}
      {showDropModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#0D1424', border: '1px solid #00F0FF55', borderRadius: 10, maxWidth: 500, width: '100%', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 900, color: '#00F0FF', margin: 0 }}>CREATE TIMED DROP</h3>
              <button onClick={() => setShowDropModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleCreateDrop} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Drop Title *</label>
                <input type="text" required placeholder="e.g. Spring 2026 Stealth Batch" value={dropTitle} onChange={(e) => setDropTitle(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Starts At *</label>
                  <input type="datetime-local" required value={dropStartsAt} onChange={(e) => setDropStartsAt(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Ends At *</label>
                  <input type="datetime-local" required value={dropEndsAt} onChange={(e) => setDropEndsAt(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Drop Description</label>
                <textarea rows={2} placeholder="Hype campaign description..." value={dropDesc} onChange={(e) => setDropDesc(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', resize: 'none' }} />
              </div>
              <ImageUploaderAndPreview
                value={dropCoverUrl}
                onChange={setDropCoverUrl}
                csrfToken={csrfToken || ''}
                label="DROP CAMPAIGN BANNER / ARTWORK"
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Pickup Spot</label>
                  <input type="text" placeholder="e.g. SAC Counter 2" value={dropLocation} onChange={(e) => setDropLocation(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Pickup Window</label>
                  <input type="text" placeholder="e.g. 10:00 AM - 6:00 PM" value={dropWindow} onChange={(e) => setDropWindow(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowDropModal(false)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94A3B8', padding: '6px 12px', borderRadius: 4, fontSize: 11 }}>Cancel</button>
                <button type="submit" disabled={creatingDrop} style={{ background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 16px', borderRadius: 4, fontWeight: 800, fontSize: 11 }}>
                  {creatingDrop ? 'Scheduling...' : 'Launch Drop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE EVENT */}
      {showEventModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: '#0D1424', border: '1px solid #00F0FF55', borderRadius: 10, maxWidth: 600, width: '100%', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 900, color: '#00F0FF', margin: 0 }}>CREATE FESTIVAL EVENT &amp; PASSES</h3>
              <button onClick={() => setShowEventModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Event Title *</label>
                  <input type="text" required placeholder="e.g. Annual Pronite Concert 2026" value={evtTitle} onChange={(e) => setEvtTitle(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Venue</label>
                  <input type="text" placeholder="MP Hall" value={evtVenue} onChange={(e) => setEvtVenue(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Event Description</label>
                <textarea rows={2} placeholder="Event and artist description..." value={evtDesc} onChange={(e) => setEvtDesc(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', resize: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Event Date &amp; Time *</label>
                  <input type="datetime-local" value={evtStartsAt} onChange={(e) => setEvtStartsAt(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>Overall Venue Capacity</label>
                  <input type="number" value={evtCapacity} onChange={(e) => setEvtCapacity(e.target.value)} style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '8px 10px', borderRadius: 6, fontSize: 11, boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Ticket Tiers */}
              <div style={{ background: 'rgba(0, 0, 0, 0.3)', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#00F0FF', marginBottom: 6 }}>TICKET TIERS &amp; VIP PERKS</div>
                {evtTiers.map((t, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 80px 80px 60px 1fr', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <input
                      type="text"
                      placeholder="Tier Name"
                      value={t.name}
                      onChange={(e) => {
                        const copy = [...evtTiers];
                        copy[idx].name = e.target.value;
                        setEvtTiers(copy);
                      }}
                      style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={t.price}
                      onChange={(e) => {
                        const copy = [...evtTiers];
                        copy[idx].price = e.target.value;
                        setEvtTiers(copy);
                      }}
                      style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                    />
                    <input
                      type="number"
                      placeholder="Cap"
                      value={t.capacity}
                      onChange={(e) => {
                        const copy = [...evtTiers];
                        copy[idx].capacity = e.target.value;
                        setEvtTiers(copy);
                      }}
                      style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                    />
                    <label style={{ fontSize: 10, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <input
                        type="checkbox"
                        checked={t.isVip}
                        onChange={(e) => {
                          const copy = [...evtTiers];
                          copy[idx].isVip = e.target.checked;
                          setEvtTiers(copy);
                        }}
                      />
                      VIP
                    </label>
                    <input
                      type="text"
                      placeholder="Perks (comma separated)"
                      value={t.perks}
                      onChange={(e) => {
                        const copy = [...evtTiers];
                        copy[idx].perks = e.target.value;
                        setEvtTiers(copy);
                      }}
                      style={{ background: '#060A14', border: '1px solid #1E293B', color: '#F8FAFC', padding: '6px', borderRadius: 4, fontSize: 11 }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowEventModal(false)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94A3B8', padding: '6px 12px', borderRadius: 4, fontSize: 11 }}>Cancel</button>
                <button type="submit" disabled={creatingEvent} style={{ background: '#00F0FF', color: '#06080F', border: 'none', padding: '6px 16px', borderRadius: 4, fontWeight: 800, fontSize: 11 }}>
                  {creatingEvent ? 'Creating...' : 'Publish Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
