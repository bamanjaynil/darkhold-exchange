import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface CommunityListing {
  id: string;
  user_id: string;
  seller_username?: string;
  title: string;
  description: string;
  category: string;
  listing_type: 'SALE' | 'TRADE';
  price_dkc: number;
  condition: string;
  images: string[];
  image?: string;
  imageUrl?: string;
  pickup_location: string;
  contact_info: string;
  status: string;
  created_at: string;
}

export interface DealItem {
  id: string;
  trade_id?: string;
  listing_id?: string;
  symbol: string;
  buyer_user_id: string;
  seller_user_id: string;
  buyer_username?: string;
  seller_username?: string;
  price: number | string;
  qty: number;
  amount: number | string;
  status: string;
  meetup_date?: string | null;
  meetup_time?: string | null;
  meetup_location?: string | null;
  meetup_instructions?: string | null;
  buyer_confirmed_meetup: boolean;
  seller_confirmed_meetup: boolean;
  meetup_confirmed_at?: string | null;
  handed_over_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancelled_by_user_id?: string | null;
  cancellation_reason?: string | null;
  cancellation_charge: number | string;
  buyer_refund_amount: number | string;
  seller_compensation_amount: number | string;
  dispute_reason?: string | null;
  disputed_at?: string | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
  pickup_otp?: string | null;
  created_at: string;
  updated_at: string;
}

interface CommunityMarketplaceViewProps {
  user: { id: string; username: string; role: string } | null;
  balance: { available: number; reserved: number; escrow: number; pendingWithdrawals?: number; total: number };
  csrfToken: string | null;
  onOpenDeposit: () => void;
  onBalanceUpdated: () => void;
}

const CATEGORIES = [
  { id: 'ALL', label: 'All Items' },
  { id: 'TEXTBOOKS', label: '📚 Textbooks & Notes' },
  { id: 'ELECTRONICS', label: '⚡ Tech & Calculators' },
  { id: 'DORM_SUPPLIES', label: '🛋️ Dorm Supplies' },
  { id: 'COLLECTIBLES', label: '🏆 Collectibles & Relics' },
  { id: 'OTHER', label: '📦 Campus Misc' },
];

/**
 * Compresses an image file via HTML5 Canvas to a maximum dimension of 640x640 at 0.82 JPEG quality.
 * Converts to a Base64 data URL for 100% zero-config reliability across Docker and local demo environments.
 */
async function compressImageToBase64(file: File, maxDim = 640, quality = 0.82): Promise<{ dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image data'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('HTML5 Canvas context unavailable'));
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const bytes = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
        resolve({ dataUrl, bytes });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const CommunityMarketplaceView: React.FC<CommunityMarketplaceViewProps> = ({
  user,
  balance,
  csrfToken,
  onOpenDeposit,
  onBalanceUpdated,
}) => {
  const [listings, setListings] = useState<CommunityListing[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'TRADE'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Buy Flow States
  const [purchasingItem, setPurchasingItem] = useState<CommunityListing | null>(null);
  const [purchaseSuccessReceipt, setPurchaseSuccessReceipt] = useState<{
    listing: CommunityListing;
    pickupOtp: string;
    journalId: string;
    amountDkc: number;
  } | null>(null);
  const [buyLoading, setBuyLoading] = useState<boolean>(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [copiedOtp, setCopiedOtp] = useState<boolean>(false);

  // Create Listing Modal State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('TEXTBOOKS');
  const [newType, setNewType] = useState<'SALE' | 'TRADE'>('SALE');
  const [newPrice, setNewPrice] = useState<string>('150');
  const [newCondition, setNewCondition] = useState<string>('GOOD');
  const [newLocation, setNewLocation] = useState<string>('Hostel 4 Common Room');
  const [newContact, setNewContact] = useState<string>('');
  const [newImage, setNewImage] = useState<string>('');
  const [imageFileName, setImageFileName] = useState<string>('');
  const [imageUploading, setImageUploading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Sub-navigation: ACTIVE_DEALS, HISTORY, LISTINGS
  const [activeSubTab, setActiveSubTab] = useState<'ACTIVE_DEALS' | 'HISTORY' | 'LISTINGS'>('ACTIVE_DEALS');
  const [activeDeals, setActiveDeals] = useState<DealItem[]>([]);
  const [dealsHistory, setDealsHistory] = useState<DealItem[]>([]);
  const [dealActionLoading, setDealActionLoading] = useState<string | null>(null);

  // Meetup Proposal Modal State
  const [proposeDealModal, setProposeDealModal] = useState<DealItem | null>(null);
  const [proposeDate, setProposeDate] = useState<string>('Day 1 - Nov 2');
  const [proposeTime, setProposeTime] = useState<string>('4:00 PM');
  const [proposeLocation, setProposeLocation] = useState<string>('SAC Ground Floor Main Entry');
  const [proposeInstructions, setProposeInstructions] = useState<string>('Meet near the SAC fountain.');

  // Cancel Deal Modal State
  const [cancelDealModal, setCancelDealModal] = useState<DealItem | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');

  // Dispute Modal State
  const [disputeDealModal, setDisputeDealModal] = useState<DealItem | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDeals = useCallback(async () => {
    if (!user) return;
    try {
      const [actRes, hisRes] = await Promise.all([
        fetch('/api/deals/active', { credentials: 'include' }).catch(() => null),
        fetch('/api/deals/history', { credentials: 'include' }).catch(() => null),
      ]);
      if (actRes && actRes.ok) {
        const data = await actRes.json();
        setActiveDeals(Array.isArray(data) ? data : []);
      }
      if (hisRes && hisRes.ok) {
        const data = await hisRes.json();
        setDealsHistory(Array.isArray(data) ? data : []);
      }
    } catch {
      // fallback
    }
  }, [user]);

  useEffect(() => {
    fetchDeals();
    const timer = setInterval(fetchDeals, 3000);
    return () => clearInterval(timer);
  }, [fetchDeals]);

  const handleProposeMeetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposeDealModal) return;
    setDealActionLoading(proposeDealModal.id);

    try {
      const res = await fetch(`/api/deals/${proposeDealModal.id}/propose-meetup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          date: proposeDate,
          time: proposeTime,
          location: proposeLocation,
          instructions: proposeInstructions,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '✓ Proposed meetup schedule submitted! Awaiting counterparty confirmation.', error: false });
        setProposeDealModal(null);
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to propose meetup schedule.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const handleConfirmMeetup = async (dealId: string) => {
    setDealActionLoading(dealId);
    try {
      const res = await fetch(`/api/deals/${dealId}/confirm-meetup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '✓ Meetup confirmed! Status updated to MEETUP SCHEDULED.', error: false });
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to confirm meetup.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const handleHandover = async (dealId: string) => {
    if (!confirm('Confirm that you have physically handed over the item to the buyer on campus?')) return;
    setDealActionLoading(dealId);
    try {
      const res = await fetch(`/api/deals/${dealId}/handover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '✓ Marked as Handed Over. Waiting for buyer to verify and confirm receipt.', error: false });
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to mark handover.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const handleConfirmReceipt = async (dealId: string) => {
    if (!confirm('Confirm that you have received and inspected the physical item? This will release the escrow funds directly to the seller.')) return;
    setDealActionLoading(dealId);
    try {
      const res = await fetch(`/api/deals/${dealId}/confirm-receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '✓ Deal successfully completed! Escrow funds released to seller and asset added to your portfolio.', error: false });
        onBalanceUpdated?.();
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to confirm receipt.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const handleExecuteCancel = async () => {
    if (!cancelDealModal) return;
    setDealActionLoading(cancelDealModal.id);
    try {
      const res = await fetch(`/api/deals/${cancelDealModal.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ reason: cancelReason || 'Cancelled by user' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '✓ Deal cancelled. Balances updated according to cancellation rules.', error: false });
        setCancelDealModal(null);
        setCancelReason('');
        onBalanceUpdated?.();
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to cancel deal.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const handleExecuteDispute = async () => {
    if (!disputeDealModal || !disputeReason.trim()) return;
    setDealActionLoading(disputeDealModal.id);
    try {
      const res = await fetch(`/api/deals/${disputeDealModal.id}/dispute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ reason: disputeReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ text: '⚠️ Dispute raised. Darkhold escrow locked pending administrative resolution.', error: false });
        setDisputeDealModal(null);
        setDisputeReason('');
        await fetchDeals();
      } else {
        setMessage({ text: data.error || 'Failed to raise dispute.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setDealActionLoading(null);
    }
  };

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/community/listings');
      if (res.ok) {
        const data = await res.json();
        setListings(Array.isArray(data) ? data : []);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleOpenBuyModal = (item: CommunityListing) => {
    if (!user) {
      alert('Please log in with your student account to buy community items.');
      return;
    }
    setBuyError(null);
    setPurchasingItem(item);
  };

  const handleConfirmBuy = async () => {
    if (!purchasingItem) return;
    setBuyLoading(true);
    setBuyError(null);

    try {
      const res = await fetch(`/api/community/listings/${purchasingItem.id}/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Mark as SOLD locally
        setListings((prev) =>
          prev.map((l) => (l.id === purchasingItem.id ? { ...l, status: 'SOLD' } : l))
        );
        setPurchaseSuccessReceipt({
          listing: purchasingItem,
          pickupOtp: data.pickupOtp,
          journalId: data.journalId,
          amountDkc: data.amountDkc,
        });
        setPurchasingItem(null);
        onBalanceUpdated?.();
      } else {
        const errMsg = data.error || data.message || 'Failed to complete community purchase.';
        setBuyError(
          errMsg.includes('INSUFFICIENT_FUNDS')
            ? `Insufficient DKC in your wallet. You have ${(balance.available / 100).toFixed(2)} DKC, but this item costs ${purchasingItem.price_dkc} DKC.`
            : errMsg.includes('CANNOT_BUY_OWN_LISTING')
            ? 'You cannot buy your own listing.'
            : errMsg.includes('LISTING_NOT_ACTIVE')
            ? 'This item has already been marked SOLD.'
            : errMsg
        );
      }
    } catch (err: any) {
      setBuyError(err.message || 'Network error executing purchase.');
    } finally {
      setBuyLoading(false);
    }
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    setImageFileName(file.name);
    try {
      const { dataUrl } = await compressImageToBase64(file, 640, 0.82);
      setNewImage(dataUrl);
    } catch (err: any) {
      console.error('Image compression failed:', err);
      setMessage({ text: 'Failed to process image: ' + (err.message || 'Error'), error: true });
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = () => {
    setNewImage('');
    setImageFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setMessage(null);

    try {
      const parsedPrice = parseFloat(newPrice) || 0;
      const contactVal = newContact.trim() || `@${user.username} on campus telegram`;
      const locationVal = newLocation.trim() || 'Campus Common Room';

      const payload = {
        title: newTitle.trim(),
        description: newDesc.trim(),
        category: newCategory,
        listingType: newType,
        priceDkc: parsedPrice,
        condition: newCondition,
        pickupLocation: locationVal,
        contactMethod: contactVal,
        contactInfo: contactVal,
        images: newImage ? [newImage] : [],
        image: newImage || undefined,
        imageUrl: newImage || undefined,
      };

      const res = await fetch('/api/community/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && (data.success || data.id || data.listing || data.post)) {
        const itemData = data.listing || data.post || {};
        const createdPost: CommunityListing = {
          id: data.id || itemData.id || `comm_${Date.now()}`,
          user_id: user.id,
          seller_username: user.username,
          title: newTitle.trim(),
          description: newDesc.trim(),
          category: newCategory,
          listing_type: newType,
          price_dkc: parsedPrice,
          condition: newCondition,
          images: newImage ? [newImage] : [],
          image: newImage || undefined,
          imageUrl: newImage || undefined,
          pickup_location: locationVal,
          contact_info: contactVal,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
        };

        // Append newly created post directly to the UI state array
        setListings((prev) => [createdPost, ...prev]);
        setMessage({ text: 'Listing published successfully to the Community Marketplace!', error: false });
        setShowCreateModal(false);

        // Reset the form fields completely
        setNewTitle('');
        setNewDesc('');
        setNewPrice('150');
        setNewCategory('TEXTBOOKS');
        setNewType('SALE');
        setNewCondition('GOOD');
        setNewLocation('Hostel 4 Common Room');
        setNewContact('');
        setNewImage('');
        setImageFileName('');
      } else {
        setMessage({ text: data.error || 'Failed to create listing.', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Network error.', error: true });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredListings = listings.filter((item) => {
    if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
    if (typeFilter !== 'ALL' && item.listing_type !== typeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.seller_username && item.seller_username.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getCategoryEmoji = (cat: string) => {
    switch (cat) {
      case 'TEXTBOOKS':
        return '📚';
      case 'ELECTRONICS':
        return '⚡';
      case 'DORM_SUPPLIES':
        return '🛋️';
      case 'COLLECTIBLES':
        return '🏆';
      default:
        return '📦';
    }
  };

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 78, 59, 0.15) 100%)',
          border: '1px solid #10B98133',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📦</span>
            <h2 style={{ fontSize: 18, fontWeight: 900, color: '#10B981', margin: 0, letterSpacing: '0.03em' }}>
              CAMPUS STUDENT COMMUNITY MARKETPLACE
            </h2>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10B981',
                border: '1px solid #10B981',
              }}
            >
              PEER-TO-PEER
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#94A3B8', margin: '6px 0 0 0' }}>
            Buy, sell, or trade used textbooks, scientific calculators, hostel dorm accessories, and festival gear directly with fellow students.
          </p>
        </div>

        <button
          onClick={() => {
            if (!user) {
              alert('Please login to create a listing.');
              return;
            }
            setShowCreateModal(true);
          }}
          style={{
            background: '#10B981',
            color: '#06080F',
            border: 'none',
            padding: '9px 18px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)',
          }}
        >
          <span>➕</span>
          <span>POST ITEM FOR SALE / TRADE</span>
        </button>
      </div>

      {message && (
        <div
          style={{
            background: message.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${message.error ? '#EF4444' : '#10B981'}`,
            color: message.error ? '#FCA5A5' : '#6EE7B7',
            padding: '10px 16px',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          {message.text}
        </div>
      )}

      {/* 3-Way Sub-Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 20,
          borderBottom: '1px solid #1E293B',
          paddingBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSubTab('ACTIVE_DEALS')}
          style={{
            background: activeSubTab === 'ACTIVE_DEALS' ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            color: activeSubTab === 'ACTIVE_DEALS' ? '#00F0FF' : '#94A3B8',
            border: `1px solid ${activeSubTab === 'ACTIVE_DEALS' ? '#00F0FF' : '#1E293B'}`,
            borderRadius: 6,
            padding: '9px 18px',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: activeSubTab === 'ACTIVE_DEALS' ? '0 0 15px rgba(0, 240, 255, 0.2)' : 'none',
          }}
        >
          <span>⚡ IN PROGRESS / ACTIVE DEALS</span>
          <span
            style={{
              background: activeDeals.length > 0 ? '#00F0FF' : '#334155',
              color: '#06080F',
              fontSize: 11,
              padding: '2px 7px',
              borderRadius: 10,
              fontWeight: 900,
            }}
          >
            {activeDeals.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('HISTORY')}
          style={{
            background: activeSubTab === 'HISTORY' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            color: activeSubTab === 'HISTORY' ? '#10B981' : '#94A3B8',
            border: `1px solid ${activeSubTab === 'HISTORY' ? '#10B981' : '#1E293B'}`,
            borderRadius: 6,
            padding: '9px 18px',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: activeSubTab === 'HISTORY' ? '0 0 15px rgba(16, 185, 129, 0.2)' : 'none',
          }}
        >
          <span>📜 TRANSACTION HISTORY</span>
          <span
            style={{
              background: dealsHistory.length > 0 ? '#10B981' : '#334155',
              color: '#06080F',
              fontSize: 11,
              padding: '2px 7px',
              borderRadius: 10,
              fontWeight: 900,
            }}
          >
            {dealsHistory.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('LISTINGS')}
          style={{
            background: activeSubTab === 'LISTINGS' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            color: activeSubTab === 'LISTINGS' ? '#F59E0B' : '#94A3B8',
            border: `1px solid ${activeSubTab === 'LISTINGS' ? '#F59E0B' : '#1E293B'}`,
            borderRadius: 6,
            padding: '9px 18px',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: activeSubTab === 'LISTINGS' ? '0 0 15px rgba(245, 158, 11, 0.2)' : 'none',
          }}
        >
          <span>🏷️ BROWSE COMMUNITY LISTINGS</span>
          <span
            style={{
              background: listings.length > 0 ? '#F59E0B' : '#334155',
              color: '#06080F',
              fontSize: 11,
              padding: '2px 7px',
              borderRadius: 10,
              fontWeight: 900,
            }}
          >
            {listings.length}
          </span>
        </button>
      </div>

      {/* View 1: Active Deals */}
      {activeSubTab === 'ACTIVE_DEALS' && (
        <div style={{ marginBottom: 24 }}>
          {activeDeals.length === 0 ? (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px dashed #334155',
                borderRadius: 8,
                padding: '40px 20px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
              <h3 style={{ color: '#F8FAFC', fontSize: 16, margin: '0 0 8px 0' }}>
                No Active P2P Deals in Progress
              </h3>
              <p style={{ color: '#64748B', fontSize: 12, maxWidth: 480, margin: '0 auto 16px auto', lineHeight: 1.5 }}>
                Trades matched in the Student Resale Market (Order Book) or item purchases automatically enter the P2P Deal Lifecycle with double-entry escrow custody until mutual in-person handover.
              </p>
              <button
                type="button"
                onClick={() => setActiveSubTab('LISTINGS')}
                style={{
                  background: 'rgba(0, 240, 255, 0.15)',
                  border: '1px solid #00F0FF',
                  color: '#00F0FF',
                  borderRadius: 6,
                  padding: '8px 16px',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                Browse Marketplace Listings →
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeDeals.map((deal) => {
                const isBuyer = user?.id === deal.buyer_user_id;
                const isSeller = user?.id === deal.seller_user_id;
                const counterpartyName = isBuyer ? (deal.seller_username || deal.seller_user_id) : (deal.buyer_username || deal.buyer_user_id);
                const amountMinor = Number(deal.amount);
                const amountDKC = amountMinor / 100;

                const getStatusBadge = (st: string) => {
                  switch (st) {
                    case 'MATCHED_PENDING_HANDOVER':
                      return { label: '⚡ MATCHED • P2P HANDOVER PENDING', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B' };
                    case 'AWAITING_MEETUP_CONFIRMATION':
                      return { label: '🤝 AWAITING MEETUP CONFIRMATION', color: '#00F0FF', bg: 'rgba(0, 240, 255, 0.15)', border: '#00F0FF' };
                    case 'MEETUP_SCHEDULED':
                      return { label: '📅 MEETUP SCHEDULED & LOCKED', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981' };
                    case 'AWAITING_BUYER_CONFIRMATION':
                      return { label: '📦 ITEM HANDED OVER • AWAITING RECEIPT VERIFICATION', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.15)', border: '#A855F7' };
                    case 'DISPUTED':
                      return { label: '⚠️ UNDER DISPUTE • ESCROW LOCKED', color: '#FF2A54', bg: 'rgba(255, 42, 84, 0.15)', border: '#FF2A54' };
                    default:
                      return { label: st, color: '#94A3B8', bg: 'rgba(255, 255, 255, 0.05)', border: '#334155' };
                  }
                };

                const badge = getStatusBadge(deal.status);
                const userConfirmed = isBuyer ? deal.buyer_confirmed_meetup : deal.seller_confirmed_meetup;

                return (
                  <div
                    key={deal.id}
                    style={{
                      background: '#0B1120',
                      border: `1px solid ${badge.border}`,
                      borderRadius: 8,
                      padding: 18,
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    {/* Deal Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            background: badge.bg,
                            border: `1px solid ${badge.border}`,
                            color: badge.color,
                            fontSize: 10,
                            fontWeight: 900,
                            padding: '3px 8px',
                            borderRadius: 4,
                            letterSpacing: '0.03em',
                          }}
                        >
                          {badge.label}
                        </span>
                        <span
                          style={{
                            background: isBuyer ? 'rgba(0, 240, 255, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                            border: `1px solid ${isBuyer ? '#00F0FF' : '#F59E0B'}`,
                            color: isBuyer ? '#00F0FF' : '#F59E0B',
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 4,
                          }}
                        >
                          {isBuyer ? '🛍️ YOU ARE BUYING' : '🏷️ YOU ARE SELLING'}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748B' }}>
                          Deal #{deal.id.slice(-8)} • Matched {new Date(deal.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      <div style={{ fontSize: 14, fontWeight: 900, color: '#F8FAFC' }}>
                        <span style={{ color: '#00F0FF' }}>{amountDKC.toFixed(2)} DKC</span>
                        <span style={{ fontSize: 11, color: '#64748B', marginLeft: 6 }}>
                          (₹{(amountDKC * 1).toFixed(0)})
                        </span>
                      </div>
                    </div>

                    {/* Deal Details Split Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 14 }}>
                      {/* Left: Item & Counterparty Info */}
                      <div style={{ background: '#070C18', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#F8FAFC', marginBottom: 6 }}>
                          🎫 {deal.symbol} — {deal.qty} Unit(s) @ {(Number(deal.price) / 100).toFixed(2)} DKC
                        </div>

                        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
                          Counterparty: <strong style={{ color: isBuyer ? '#F59E0B' : '#00F0FF' }}>@{counterpartyName}</strong>
                          {isBuyer ? ' (Seller)' : ' (Buyer)'}
                        </div>

                        {/* Escrow Guarantee */}
                        <div style={{ background: 'rgba(0, 240, 255, 0.05)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: 4, padding: 8, fontSize: 10, color: '#94A3B8', lineHeight: 1.4 }}>
                          <span style={{ color: '#00F0FF', fontWeight: 700 }}>🛡️ Double-Entry Escrow Vault:</span>
                          {' '}Funds are safely locked in exchange escrow. Neither party can lose money: payment is only released to seller upon buyer physical verification.
                        </div>

                        {deal.pickup_otp && (
                          <div style={{ marginTop: 8, background: '#030712', border: '1px dashed #334155', borderRadius: 4, padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: '#64748B' }}>Handover Verification OTP:</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: '#10B981', letterSpacing: '0.1em' }}>
                              {deal.pickup_otp}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right: Mutual Meeting Coordination Box */}
                      <div style={{ background: '#070C18', border: '1px solid #1E293B', borderRadius: 6, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#F59E0B' }}>
                            📍 CAMPUS MEETUP COORDINATION
                          </span>
                          <span style={{ fontSize: 9, color: '#64748B' }}>
                            {deal.meetup_confirmed_at ? '✓ MUTUALLY LOCKED' : 'PENDING AGREEMENT'}
                          </span>
                        </div>

                        <div style={{ fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: '#64748B' }}>Date & Time: </span>
                          <strong style={{ color: '#F8FAFC' }}>
                            {deal.meetup_date ? `${deal.meetup_date} @ ${deal.meetup_time}` : 'Not proposed yet'}
                          </strong>
                        </div>

                        <div style={{ fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: '#64748B' }}>Location: </span>
                          <strong style={{ color: '#38BDF8' }}>
                            {deal.meetup_location || 'Campus Common Room / SAC'}
                          </strong>
                        </div>

                        {deal.meetup_instructions && (
                          <div style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic', marginBottom: 6 }}>
                            "{deal.meetup_instructions}"
                          </div>
                        )}

                        {/* Confirmation Indicators */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8, padding: '6px 8px', background: '#030712', borderRadius: 4, fontSize: 10 }}>
                          <div>
                            <span style={{ color: '#64748B' }}>Buyer Status: </span>
                            <strong style={{ color: deal.buyer_confirmed_meetup ? '#10B981' : '#F59E0B' }}>
                              {deal.buyer_confirmed_meetup ? '✓ Agreed' : '⏳ Awaiting'}
                            </strong>
                          </div>
                          <div>
                            <span style={{ color: '#64748B' }}>Seller Status: </span>
                            <strong style={{ color: deal.seller_confirmed_meetup ? '#10B981' : '#F59E0B' }}>
                              {deal.seller_confirmed_meetup ? '✓ Agreed' : '⏳ Awaiting'}
                            </strong>
                          </div>
                        </div>

                        {/* Meetup Coordination Buttons */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setProposeDealModal(deal);
                              if (deal.meetup_date) setProposeDate(deal.meetup_date);
                              if (deal.meetup_time) setProposeTime(deal.meetup_time);
                              if (deal.meetup_location) setProposeLocation(deal.meetup_location);
                              if (deal.meetup_instructions) setProposeInstructions(deal.meetup_instructions);
                            }}
                            style={{
                              background: 'rgba(245, 158, 11, 0.15)',
                              border: '1px solid #F59E0B',
                              color: '#F59E0B',
                              padding: '5px 10px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: 'pointer',
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          >
                            📅 Propose / Change Details
                          </button>

                          {!userConfirmed && (
                            <button
                              type="button"
                              onClick={() => handleConfirmMeetup(deal.id)}
                              disabled={dealActionLoading === deal.id}
                              style={{
                                background: '#10B981',
                                border: 'none',
                                color: '#040711',
                                padding: '5px 12px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 900,
                                cursor: dealActionLoading === deal.id ? 'not-allowed' : 'pointer',
                                fontFamily: '"JetBrains Mono", monospace',
                              }}
                            >
                              {dealActionLoading === deal.id ? 'Confirming...' : '✓ Confirm Meetup Schedule'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderTop: '1px solid #1E293B', paddingTop: 12 }}>
                      {/* Left: Handover & Release Workflow */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {isSeller && (
                          <button
                            type="button"
                            onClick={() => handleHandover(deal.id)}
                            disabled={dealActionLoading === deal.id || deal.status === 'AWAITING_BUYER_CONFIRMATION'}
                            style={{
                              background: deal.status === 'AWAITING_BUYER_CONFIRMATION' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(0, 240, 255, 0.15)',
                              border: `1px solid ${deal.status === 'AWAITING_BUYER_CONFIRMATION' ? '#A855F7' : '#00F0FF'}`,
                              color: deal.status === 'AWAITING_BUYER_CONFIRMATION' ? '#A855F7' : '#00F0FF',
                              padding: '7px 14px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: dealActionLoading === deal.id || deal.status === 'AWAITING_BUYER_CONFIRMATION' ? 'default' : 'pointer',
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          >
                            {deal.status === 'AWAITING_BUYER_CONFIRMATION'
                              ? '✓ Marked Handed Over (Awaiting Buyer)'
                              : '📦 Mark Item as Handed Over'}
                          </button>
                        )}

                        {isBuyer && (
                          <button
                            type="button"
                            onClick={() => handleConfirmReceipt(deal.id)}
                            disabled={dealActionLoading === deal.id}
                            style={{
                              background: '#10B981',
                              border: 'none',
                              color: '#060A14',
                              padding: '7px 16px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: dealActionLoading === deal.id ? 'not-allowed' : 'pointer',
                              fontFamily: '"JetBrains Mono", monospace',
                              boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)',
                            }}
                          >
                            {dealActionLoading === deal.id ? 'Releasing Escrow...' : '✓ Confirm Receipt & Release Escrow Funds'}
                          </button>
                        )}
                      </div>

                      {/* Right: Cancel & Dispute */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setCancelDealModal(deal);
                            setCancelReason('');
                          }}
                          disabled={dealActionLoading === deal.id}
                          style={{
                            background: 'transparent',
                            border: '1px solid #475569',
                            color: '#94A3B8',
                            padding: '6px 12px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          ✕ Cancel Deal
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDisputeDealModal(deal);
                            setDisputeReason('');
                          }}
                          disabled={dealActionLoading === deal.id}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#EF4444',
                            padding: '6px 10px',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          ⚠️ Dispute
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View 2: Transaction History */}
      {activeSubTab === 'HISTORY' && (
        <div style={{ background: '#0D1424', border: '1px solid #1E293B', borderRadius: 8, padding: 18, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 900, color: '#10B981', margin: 0 }}>
              📜 COMPLETED & CANCELLED P2P DEALS HISTORY
            </h3>
            <span style={{ fontSize: 10, color: '#64748B' }}>
              [{dealsHistory.length} Total Historical Entries]
            </span>
          </div>

          {dealsHistory.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 11 }}>
              No historical deals recorded yet. Once physical pass or merchandise deals are completed or cancelled, they will be archived here with exact financial breakdowns.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="ladder-table">
                <thead>
                  <tr>
                    <th>DATE / TIME</th>
                    <th>DEAL ID</th>
                    <th>ITEM & QTY</th>
                    <th>COUNTERPARTY</th>
                    <th>TOTAL AMOUNT</th>
                    <th>STATUS</th>
                    <th>FINANCIAL BREAKDOWN / LEDGER DISPOSITION</th>
                  </tr>
                </thead>
                <tbody>
                  {dealsHistory.map((d) => {
                    const isBuyer = user?.id === d.buyer_user_id;
                    const cparty = isBuyer ? (d.seller_username || d.seller_user_id) : (d.buyer_username || d.buyer_user_id);
                    const amtDkc = Number(d.amount) / 100;
                    const penaltyDkc = Number(d.cancellation_charge) / 100;
                    const refundDkc = Number(d.buyer_refund_amount) / 100;

                    const isCompleted = d.status === 'COMPLETED';
                    const isBuyerCxl = d.status === 'CANCELLED_BY_BUYER';
                    const isSellerCxl = d.status === 'CANCELLED_BY_SELLER';

                    return (
                      <tr key={d.id}>
                        <td style={{ fontSize: 10, color: '#64748B' }}>
                          {new Date(d.completed_at || d.cancelled_at || d.updated_at).toLocaleDateString()} {new Date(d.completed_at || d.cancelled_at || d.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: 10, color: '#94A3B8', fontFamily: '"JetBrains Mono", monospace' }}>
                          #{d.id.slice(-8)}
                        </td>
                        <td style={{ fontWeight: 700, color: '#F8FAFC' }}>
                          {d.qty}x {d.symbol}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          <span style={{ color: isBuyer ? '#F59E0B' : '#00F0FF' }}>
                            @{cparty}
                          </span>
                          <span style={{ color: '#64748B', fontSize: 9, marginLeft: 4 }}>
                            {isBuyer ? '(Seller)' : '(Buyer)'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 800, color: '#F8FAFC' }}>
                          {amtDkc.toFixed(2)} DKC
                        </td>
                        <td>
                          {isCompleted && (
                            <span style={{ color: '#10B981', fontWeight: 800, fontSize: 10, background: 'rgba(16, 185, 129, 0.15)', padding: '2px 6px', borderRadius: 3, border: '1px solid #10B981' }}>
                              ✓ COMPLETED
                            </span>
                          )}
                          {isBuyerCxl && (
                            <span style={{ color: '#FF2A54', fontWeight: 800, fontSize: 10, background: 'rgba(255, 42, 84, 0.15)', padding: '2px 6px', borderRadius: 3, border: '1px solid #FF2A54' }}>
                              ✕ CANCELLED BY BUYER
                            </span>
                          )}
                          {isSellerCxl && (
                            <span style={{ color: '#F59E0B', fontWeight: 800, fontSize: 10, background: 'rgba(245, 158, 11, 0.15)', padding: '2px 6px', borderRadius: 3, border: '1px solid #F59E0B' }}>
                              ✕ CANCELLED BY SELLER
                            </span>
                          )}
                          {!isCompleted && !isBuyerCxl && !isSellerCxl && (
                            <span style={{ color: '#94A3B8', fontWeight: 700, fontSize: 10 }}>
                              {d.status}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 10, color: '#94A3B8' }}>
                          {isCompleted && (
                            <span style={{ color: '#10B981' }}>
                              Full {amtDkc.toFixed(2)} DKC released to seller available balance • Physical handover confirmed
                            </span>
                          )}
                          {isBuyerCxl && penaltyDkc > 0 && (
                            <span style={{ color: '#FCA5A5' }}>
                              1% Late Fee ({penaltyDkc.toFixed(2)} DKC) paid to seller compensation • 99% ({refundDkc.toFixed(2)} DKC) refunded to buyer
                            </span>
                          )}
                          {isBuyerCxl && penaltyDkc === 0 && (
                            <span style={{ color: '#93C5FD' }}>
                              100% ({refundDkc.toFixed(2)} DKC) refunded to buyer • Cancelled before meetup confirmation (0 fee)
                            </span>
                          )}
                          {isSellerCxl && (
                            <span style={{ color: '#FDE047' }}>
                              100% ({refundDkc.toFixed(2)} DKC) refunded to buyer • Item unreserved to seller inventory
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* View 3: Browse Community Listings */}
      {activeSubTab === 'LISTINGS' && (
        <>
          {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                style={{
                  background: active ? '#10B981' : 'rgba(255, 255, 255, 0.04)',
                  color: active ? '#06080F' : '#94A3B8',
                  border: '1px solid',
                  borderColor: active ? '#10B981' : '#1E293B',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.04)', borderRadius: 6, border: '1px solid #1E293B', padding: 2 }}>
            <button
              onClick={() => setTypeFilter('ALL')}
              style={{
                background: typeFilter === 'ALL' ? '#10B98122' : 'transparent',
                color: typeFilter === 'ALL' ? '#10B981' : '#64748B',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ALL
            </button>
            <button
              onClick={() => setTypeFilter('SALE')}
              style={{
                background: typeFilter === 'SALE' ? '#10B98122' : 'transparent',
                color: typeFilter === 'SALE' ? '#10B981' : '#64748B',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              FOR SALE
            </button>
            <button
              onClick={() => setTypeFilter('TRADE')}
              style={{
                background: typeFilter === 'TRADE' ? '#10B98122' : 'transparent',
                color: typeFilter === 'TRADE' ? '#10B981' : '#64748B',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              BARTER / TRADE
            </button>
          </div>

          <input
            type="text"
            placeholder="🔍 Search items, sellers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: '#0B1120',
              border: '1px solid #1E293B',
              borderRadius: 6,
              color: '#F8FAFC',
              padding: '6px 12px',
              fontSize: 11,
              width: 220,
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Grid of Listings */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
          Loading community listings...
        </div>
      ) : filteredListings.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px dashed #1E293B',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#CBD5E1', marginBottom: 4 }}>No community listings found</div>
          <p style={{ fontSize: 12, color: '#64748B', maxWidth: 400, margin: '0 auto 16px auto' }}>
            Be the first student to post a textbook, hostel accessory, or personal collectible for sale or trade!
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              background: '#10B981',
              color: '#06080F',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            ➕ Post First Listing
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {filteredListings.map((item) => {
            const isTrade = item.listing_type === 'TRADE';
            const priceWhole = Number(item.price_dkc);

            // Extract image URL from item.images array or single image / imageUrl property
            let imgUrl: string | null = null;
            if (Array.isArray(item.images) && item.images.length > 0 && typeof item.images[0] === 'string' && item.images[0].length > 0) {
              imgUrl = item.images[0];
            } else if (typeof item.images === 'string' && (item.images as string).trim().startsWith('[')) {
              try {
                const parsed = JSON.parse(item.images);
                if (Array.isArray(parsed) && parsed.length > 0) imgUrl = parsed[0];
              } catch {}
            } else if (item.image && typeof item.image === 'string' && item.image.length > 0) {
              imgUrl = item.image;
            } else if (item.imageUrl && typeof item.imageUrl === 'string' && item.imageUrl.length > 0) {
              imgUrl = item.imageUrl;
            }

            return (
              <div
                key={item.id}
                style={{
                  background: 'linear-gradient(180deg, #0D1424 0%, #080D1A 100%)',
                  border: '1px solid #1E293B',
                  borderRadius: 8,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
              >
                <div>
                  {/* Item Image with Fallback */}
                  <div
                    style={{
                      height: 160,
                      width: '100%',
                      borderRadius: 6,
                      overflow: 'hidden',
                      marginBottom: 12,
                      background: '#040711',
                      border: '1px solid #1E293B',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={item.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                          const p = e.currentTarget.parentElement;
                          if (p && !p.querySelector('.fallback-placeholder')) {
                            const fb = document.createElement('div');
                            fb.className = 'fallback-placeholder';
                            fb.style.fontSize = '48px';
                            fb.innerText = getCategoryEmoji(item.category);
                            p.appendChild(fb);
                          }
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 48 }}>{getCategoryEmoji(item.category)}</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 12,
                        background: isTrade ? 'rgba(168, 85, 247, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                        color: isTrade ? '#C084FC' : '#34D399',
                        border: `1px solid ${isTrade ? '#A855F7' : '#10B981'}`,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {isTrade ? '🔄 OPEN TO TRADE' : '🏷️ FOR SALE'}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"JetBrains Mono", monospace' }}>
                      {item.condition || 'GOOD'}
                    </span>
                  </div>

                  <h3 style={{ fontSize: 15, fontWeight: 800, color: '#F8FAFC', margin: '0 0 6px 0', lineHeight: 1.3 }}>
                    {item.title}
                  </h3>

                  <p style={{ fontSize: 12, color: '#94A3B8', margin: '0 0 12px 0', lineHeight: 1.4, minHeight: 34 }}>
                    {item.description || 'No description provided.'}
                  </p>

                  <div style={{ background: 'rgba(0, 0, 0, 0.25)', borderRadius: 6, padding: '8px 10px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: '#64748B' }}>📍 Handover Location:</span>
                      <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{item.pickup_location || 'Campus Common Room'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: '#64748B' }}>👤 Seller / Student:</span>
                      <span style={{ color: '#00F0FF', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
                        @{item.seller_username || 'student'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #1E293B', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>ASKING PRICE</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#10B981', fontFamily: '"JetBrains Mono", monospace' }}>
                      {priceWhole > 0 ? `${priceWhole.toLocaleString()} DKC` : 'Free / Barter'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {item.status === 'SOLD' ? (
                      <span
                        style={{
                          background: 'rgba(255, 42, 84, 0.12)',
                          border: '1px solid #FF2A54',
                          color: '#FF2A54',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 800,
                          fontFamily: '"JetBrains Mono", monospace',
                        }}
                      >
                        ✓ SOLD OUT
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => handleOpenBuyModal(item)}
                          style={{
                            background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                            border: '1px solid #34D399',
                            color: '#040711',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: 'pointer',
                            fontFamily: '"JetBrains Mono", monospace',
                            boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          {user && item.user_id === user.id ? '⚡ BUY NOW (Test Demo)' : '⚡ BUY NOW'}
                        </button>
                        {user && item.user_id === user.id && (
                          <span
                            style={{
                              background: 'rgba(56, 189, 248, 0.12)',
                              border: '1px solid #38BDF8',
                              color: '#38BDF8',
                              padding: '4px 6px',
                              borderRadius: 4,
                              fontSize: 9,
                              fontWeight: 800,
                              fontFamily: '"JetBrains Mono", monospace',
                            }}
                          >
                            YOUR LISTING
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            alert(`Contact student @${item.seller_username || 'student'}:\n\n${item.contact_info || 'Reach out on Campus Telegram / Hostel room'}\nHandover: ${item.pickup_location}`);
                          }}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid #334155',
                            color: '#94A3B8',
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          💬 Contact
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Modal: Create Listing */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0D1424',
              border: '1px solid #10B98155',
              borderRadius: 10,
              maxWidth: 540,
              width: '100%',
              padding: 24,
              boxShadow: '0 0 40px rgba(16, 185, 129, 0.15)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📦</span>
                <h3 style={{ fontSize: 16, fontWeight: 900, color: '#10B981', margin: 0 }}>
                  POST COMMUNITY ITEM
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateListing} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Item Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Casio fx-991EX Scientific Calculator / Signals & Systems Book"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#060A14',
                    border: '1px solid #1E293B',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: '#F8FAFC',
                    fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Image Upload Box with Base64 Conversion */}
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Item Photograph / Visual (Base64 Zero-Config)
                </label>
                {newImage ? (
                  <div
                    style={{
                      position: 'relative',
                      background: '#060A14',
                      border: '1px solid #10B981',
                      borderRadius: 6,
                      padding: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <img
                      src={newImage}
                      alt="Upload Preview"
                      style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#10B981' }}>✓ Image Attached (Base64)</div>
                      <div style={{ fontSize: 10, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {imageFileName || 'item-photo.jpg'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid #EF4444',
                        color: '#EF4444',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: '1.5px dashed #334155',
                      borderRadius: 6,
                      padding: '16px 12px',
                      textAlign: 'center',
                      background: 'rgba(15, 23, 42, 0.4)',
                      cursor: imageUploading ? 'wait' : 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageFileSelect}
                      style={{ display: 'none' }}
                      disabled={imageUploading}
                    />
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📷</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0' }}>
                      {imageUploading ? '⚡ Compressing image via Canvas...' : 'Click to Upload Item Photograph'}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>
                      JPG, PNG, WebP • Auto-compressed to Base64 data URL
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="TEXTBOOKS">📚 Textbooks & Notes</option>
                    <option value="ELECTRONICS">⚡ Tech & Calculators</option>
                    <option value="DORM_SUPPLIES">🛋️ Dorm Supplies</option>
                    <option value="COLLECTIBLES">🏆 Collectibles & Relics</option>
                    <option value="OTHER">📦 Campus Misc</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Listing Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as any)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="SALE">🏷️ Direct Sale (DKC)</option>
                    <option value="TRADE">🔄 Trade / Barter</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Asking Price (DKC) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      fontFamily: '"JetBrains Mono", monospace',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Item Condition
                  </label>
                  <select
                    value={newCondition}
                    onChange={(e) => setNewCondition(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="BRAND_NEW">Brand New / Unopened</option>
                    <option value="LIKE_NEW">Like New (Mint)</option>
                    <option value="GOOD">Good / Normal Wear</option>
                    <option value="FAIR">Fair / Functional</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Description & Details
                </label>
                <textarea
                  rows={2}
                  placeholder="Notes condition, edition, highlight markings, or trade preferences..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#060A14',
                    border: '1px solid #1E293B',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: '#F8FAFC',
                    fontSize: 12,
                    boxSizing: 'border-box',
                    resize: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Campus Handover Spot
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. SAC Canteen / Hostel 3"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Contact Info
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Telegram @username or Phone"
                    value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#060A14',
                      border: '1px solid #1E293B',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#F8FAFC',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #334155',
                    color: '#94A3B8',
                    padding: '8px 14px',
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || imageUploading}
                  style={{
                    background: '#10B981',
                    color: '#06080F',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: submitting || imageUploading ? 'not-allowed' : 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  {submitting ? 'Publishing...' : 'Publish Listing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Buy Item Confirmation */}
      {purchasingItem && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0D1424',
              border: '1px solid rgba(0, 240, 255, 0.4)',
              borderRadius: 10,
              maxWidth: 480,
              width: '100%',
              padding: 24,
              boxShadow: '0 0 40px rgba(0, 240, 255, 0.15)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚡</span>
                <h3 style={{ fontSize: 16, fontWeight: 900, color: '#00F0FF', margin: 0, fontFamily: '"JetBrains Mono", monospace' }}>
                  CONFIRM CAMPUS PURCHASE
                </h3>
              </div>
              <button
                onClick={() => setPurchasingItem(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#060A14', border: '1px solid #1E293B', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <h4 style={{ fontSize: 15, fontWeight: 800, color: '#F8FAFC', margin: '0 0 6px 0' }}>
                {purchasingItem.title}
              </h4>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>👤 Seller:</span>
                <span style={{ color: '#00F0FF', fontWeight: 700 }}>@{purchasingItem.seller_username || 'student'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>📍 Handover Location:</span>
                <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{purchasingItem.pickup_location}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderTop: '1px solid #1E293B', paddingTop: 8, marginTop: 8 }}>
                <span style={{ color: '#94A3B8', fontWeight: 700 }}>PRICE:</span>
                <span style={{ color: '#10B981', fontWeight: 900, fontSize: 14, fontFamily: '"JetBrains Mono", monospace' }}>
                  {purchasingItem.price_dkc.toLocaleString()} DKC (₹{purchasingItem.price_dkc.toLocaleString()} INR)
                </span>
              </div>
            </div>

            {/* Wallet Balance Check */}
            <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>Your Available Balance:</span>
                <span style={{ color: '#F8FAFC', fontWeight: 700 }}>{(balance.available / 100).toFixed(2)} DKC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748B' }}>Balance After Purchase:</span>
                <span style={{ color: balance.available >= purchasingItem.price_dkc * 100 ? '#10B981' : '#FF2A54', fontWeight: 700 }}>
                  {((balance.available - purchasingItem.price_dkc * 100) / 100).toFixed(2)} DKC
                </span>
              </div>
            </div>

            {buyError && (
              <div style={{ background: 'rgba(255, 42, 84, 0.15)', border: '1px solid #FF2A54', borderRadius: 6, padding: 10, color: '#FF2A54', fontSize: 11, marginBottom: 16 }}>
                ⚠️ {buyError}
              </div>
            )}

            {balance.available < purchasingItem.price_dkc * 100 ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setPurchasingItem(null)}
                  style={{ flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94A3B8', padding: '10px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPurchasingItem(null);
                    onOpenDeposit?.();
                  }}
                  style={{ flex: 2, background: 'linear-gradient(135deg, #00F0FF 0%, #0284C7 100%)', border: 'none', color: '#040711', padding: '10px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 900, fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}
                >
                  💳 Top Up Wallet via UPI
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  disabled={buyLoading}
                  onClick={() => setPurchasingItem(null)}
                  style={{ flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94A3B8', padding: '10px 16px', borderRadius: 6, cursor: buyLoading ? 'not-allowed' : 'pointer', fontSize: 11 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={buyLoading}
                  onClick={handleConfirmBuy}
                  style={{ flex: 2, background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', border: '1px solid #34D399', color: '#040711', padding: '10px 16px', borderRadius: 6, cursor: buyLoading ? 'not-allowed' : 'pointer', fontWeight: 900, fontSize: 12, fontFamily: '"JetBrains Mono", monospace', boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)' }}
                >
                  {buyLoading ? 'Processing Settlement...' : `✓ Pay ${purchasingItem.price_dkc} DKC & Get OTP`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Purchase Success Receipt with Pickup OTP */}
      {purchaseSuccessReceipt && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.88)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0D1424',
              border: '1px solid #10B981',
              borderRadius: 12,
              maxWidth: 480,
              width: '100%',
              padding: 24,
              textAlign: 'center',
              boxShadow: '0 0 50px rgba(16, 185, 129, 0.25)',
            }}
          >
            <div style={{ fontSize: 42, marginBottom: 8 }}>🎉</div>
            <h3 style={{ fontSize: 18, fontWeight: 900, color: '#10B981', margin: '0 0 6px 0', fontFamily: '"JetBrains Mono", monospace' }}>
              PURCHASE SUCCESSFUL!
            </h3>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '0 0 16px 0' }}>
              {purchaseSuccessReceipt.amountDkc} DKC deducted from your wallet and credited to seller @{purchaseSuccessReceipt.listing.seller_username}.
            </p>

            {/* OTP Handover Box */}
            <div style={{ background: '#060A14', border: '1px dashed #10B981', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>
                CAMPUS HANDOVER &amp; PICKUP OTP
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#00F0FF', letterSpacing: '0.15em', fontFamily: '"JetBrains Mono", monospace', marginBottom: 8 }}>
                {purchaseSuccessReceipt.pickupOtp}
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(purchaseSuccessReceipt.pickupOtp);
                  setCopiedOtp(true);
                  setTimeout(() => setCopiedOtp(false), 2000);
                }}
                style={{
                  background: copiedOtp ? '#10B981' : 'rgba(0, 240, 255, 0.15)',
                  border: `1px solid ${copiedOtp ? '#10B981' : '#00F0FF'}`,
                  color: copiedOtp ? '#06080F' : '#00F0FF',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {copiedOtp ? '✓ Copied to Clipboard!' : '📋 Copy 6-Digit OTP'}
              </button>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, padding: 12, marginBottom: 16, textAlign: 'left', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>📍 Handover Spot:</span>
                <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{purchaseSuccessReceipt.listing.pickup_location}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748B' }}>💬 Seller Contact:</span>
                <span style={{ color: '#00F0FF' }}>{purchaseSuccessReceipt.listing.contact_info}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748B' }}>📜 Ledger Journal:</span>
                <span style={{ color: '#94A3B8', fontFamily: '"JetBrains Mono", monospace' }}>#{purchaseSuccessReceipt.journalId.slice(-10)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPurchaseSuccessReceipt(null)}
              style={{
                width: '100%',
                background: '#10B981',
                border: 'none',
                color: '#040711',
                padding: '10px 16px',
                borderRadius: 6,
                fontWeight: 900,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ✓ Done / View in Marketplace
            </button>
          </div>
        </div>
      )}

      {/* Modal: Propose / Change Meetup */}
      {proposeDealModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0D1424',
              border: '1px solid #F59E0B66',
              borderRadius: 10,
              maxWidth: 500,
              width: '100%',
              padding: 24,
              boxShadow: '0 0 40px rgba(245, 158, 11, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📅</span>
                <h3 style={{ fontSize: 16, fontWeight: 900, color: '#F59E0B', margin: 0 }}>
                  COORDINATE CAMPUS MEETUP
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProposeDealModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 14, lineHeight: 1.5 }}>
              Propose a physical handover location and time on campus. Proposing material changes resets counterparty confirmation to ensure mutual consent.
            </p>

            <form onSubmit={handleProposeMeetup} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Date *
                </label>
                <input
                  type="text"
                  required
                  value={proposeDate}
                  onChange={(e) => setProposeDate(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12 }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {['Day 1 - Nov 2', 'Day 2 - Nov 3', 'Today', 'Tomorrow'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setProposeDate(preset)}
                      style={{ background: '#04060A', border: '1px solid #1E293B', color: '#94A3B8', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Time *
                </label>
                <input
                  type="text"
                  required
                  value={proposeTime}
                  onChange={(e) => setProposeTime(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12 }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {['4:00 PM', '6:00 PM', '8:30 PM', '1:30 PM'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setProposeTime(preset)}
                      style={{ background: '#04060A', border: '1px solid #1E293B', color: '#94A3B8', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Campus Handover Location *
                </label>
                <input
                  type="text"
                  required
                  value={proposeLocation}
                  onChange={(e) => setProposeLocation(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12 }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {['SAC Ground Floor Main Entry', 'MP Hall Gate 2', 'Hostel 4 Canteen', 'SAC Open Air Theatre'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setProposeLocation(preset)}
                      style={{ background: '#04060A', border: '1px solid #1E293B', color: '#94A3B8', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Handover Instructions / Notes
                </label>
                <input
                  type="text"
                  value={proposeInstructions}
                  onChange={(e) => setProposeInstructions(e.target.value)}
                  placeholder="e.g. Look for black hoodie near the registration desk"
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setProposeDealModal(null)}
                  style={{ flex: 1, background: '#1E293B', border: 'none', color: '#F8FAFC', padding: '10px 16px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dealActionLoading === proposeDealModal.id}
                  style={{ flex: 2, background: '#F59E0B', border: 'none', color: '#06080F', padding: '10px 16px', borderRadius: 6, fontWeight: 900, fontSize: 12, cursor: 'pointer' }}
                >
                  {dealActionLoading === proposeDealModal.id ? 'Submitting...' : 'Propose Meetup Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Cancel Deal with 1% Fee Transparency */}
      {cancelDealModal && (() => {
        const isBuyer = user?.id === cancelDealModal.buyer_user_id;
        const meetupConfirmed = !!cancelDealModal.meetup_confirmed_at ||
          cancelDealModal.status === 'MEETUP_SCHEDULED' ||
          cancelDealModal.status === 'AWAITING_ITEM_HANDOVER' ||
          cancelDealModal.status === 'AWAITING_BUYER_CONFIRMATION';

        const totalMinor = Number(cancelDealModal.amount);
        const penaltyMinor = (isBuyer && meetupConfirmed) ? Math.floor(totalMinor * 0.01) : 0;
        const refundMinor = totalMinor - penaltyMinor;

        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 20,
            }}
          >
            <div
              style={{
                background: '#0D1424',
                border: '1px solid #EF444466',
                borderRadius: 10,
                maxWidth: 480,
                width: '100%',
                padding: 24,
                boxShadow: '0 0 40px rgba(239, 68, 68, 0.2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <h3 style={{ fontSize: 16, fontWeight: 900, color: '#EF4444', margin: 0 }}>
                    CANCEL P2P DEAL
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCancelDealModal(null)}
                  style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              {/* Financial Invariant Explanation */}
              {isBuyer && meetupConfirmed && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
                  <div style={{ color: '#FCA5A5', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                    ⚠️ 1% Late Cancellation Fee Applies
                  </div>
                  <div style={{ fontSize: 11, color: '#CBD5E1', lineHeight: 1.5 }}>
                    Because a campus meetup was mutually scheduled and confirmed, festival secondary market policy applies a <strong>1% disruption compensation ({ (penaltyMinor / 100).toFixed(2) } DKC)</strong> paid directly to the seller.
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: '#F8FAFC' }}>
                    • Escrow Released Refund: <strong>{ (refundMinor / 100).toFixed(2) } DKC (99%)</strong><br />
                    • Seller Compensation: <strong>{ (penaltyMinor / 100).toFixed(2) } DKC (1%)</strong>
                  </div>
                </div>
              )}

              {isBuyer && !meetupConfirmed && (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
                  <div style={{ color: '#6EE7B7', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                    ✓ 100% Full Refund Guarantee
                  </div>
                  <div style={{ fontSize: 11, color: '#CBD5E1', lineHeight: 1.5 }}>
                    The meetup has not yet been mutually confirmed by both parties. You will receive an immediate <strong>100% refund of { (totalMinor / 100).toFixed(2) } DKC</strong> to your available wallet balance with zero penalty.
                  </div>
                </div>
              )}

              {!isBuyer && (
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
                  <div style={{ color: '#FDE047', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
                    Seller Cancellation
                  </div>
                  <div style={{ fontSize: 11, color: '#CBD5E1', lineHeight: 1.5 }}>
                    Cancelling this deal as the seller will release 100% ({ (totalMinor / 100).toFixed(2) } DKC) back to the buyer and restore {cancelDealModal.qty}x {cancelDealModal.symbol} to your available inventory.
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Cancellation Reason (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Schedule conflict / unable to meet at scheduled time"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setCancelDealModal(null)}
                  style={{ flex: 1, background: '#1E293B', border: 'none', color: '#F8FAFC', padding: '10px 16px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  Keep Deal
                </button>
                <button
                  type="button"
                  onClick={handleExecuteCancel}
                  disabled={dealActionLoading === cancelDealModal.id}
                  style={{ flex: 1, background: '#EF4444', border: 'none', color: '#FFFFFF', padding: '10px 16px', borderRadius: 6, fontWeight: 900, fontSize: 12, cursor: 'pointer' }}
                >
                  {dealActionLoading === cancelDealModal.id ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Dispute Deal */}
      {disputeDealModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0D1424',
              border: '1px solid #FF2A5466',
              borderRadius: 10,
              maxWidth: 480,
              width: '100%',
              padding: 24,
              boxShadow: '0 0 40px rgba(255, 42, 84, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🛡️</span>
                <h3 style={{ fontSize: 16, fontWeight: 900, color: '#FF2A54', margin: 0 }}>
                  REPORT ISSUE / RAISE DISPUTE
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDisputeDealModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 14, lineHeight: 1.5 }}>
              Raising a dispute immediately freezes all escrow funds in Darkhold vault custody. An appointed festival organizer will review chat, transaction logs, and physical proof.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExecuteDispute();
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                  Dispute Reason *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe what occurred (e.g. Counterparty did not show up to scheduled meetup / physical item damaged or invalid pass barcode)..."
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  style={{ width: '100%', background: '#060A14', border: '1px solid #1E293B', borderRadius: 6, padding: '8px 10px', color: '#F8FAFC', fontSize: 12, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setDisputeDealModal(null)}
                  style={{ flex: 1, background: '#1E293B', border: 'none', color: '#F8FAFC', padding: '10px 16px', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={dealActionLoading === disputeDealModal.id || !disputeReason.trim()}
                  style={{ flex: 2, background: '#FF2A54', border: 'none', color: '#FFFFFF', padding: '10px 16px', borderRadius: 6, fontWeight: 900, fontSize: 12, cursor: 'pointer' }}
                >
                  {dealActionLoading === disputeDealModal.id ? 'Submitting...' : 'Submit Official Dispute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
