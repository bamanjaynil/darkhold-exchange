import React, { useState, useEffect, useCallback } from 'react';

interface CommunityListing {
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
  pickup_location: string;
  contact_info: string;
  status: string;
  created_at: string;
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

export const CommunityMarketplaceView: React.FC<CommunityMarketplaceViewProps> = ({
  user,
  csrfToken,
}) => {
  const [listings, setListings] = useState<CommunityListing[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'TRADE'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

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
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

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

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setMessage(null);

    try {
      const priceNum = Math.round(parseFloat(newPrice) * 100);
      const res = await fetch('/api/community/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc.trim(),
          category: newCategory,
          listingType: newType,
          priceDkc: priceNum / 100,
          condition: newCondition,
          pickupLocation: newLocation.trim(),
          contactInfo: newContact.trim() || `@${user.username} on campus telegram`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: 'Listing published successfully to the Community Marketplace!', error: false });
        setShowCreateModal(false);
        setNewTitle('');
        setNewDesc('');
        fetchListings();
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

                <div style={{ borderTop: '1px solid #1E293B', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748B' }}>ASKING PRICE</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#10B981', fontFamily: '"JetBrains Mono", monospace' }}>
                      {priceWhole > 0 ? `${priceWhole.toLocaleString()} DKC` : 'Free / Barter'}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      alert(`Contact seller: ${item.contact_info || `@${item.seller_username} on Campus Messenger`}`);
                    }}
                    style={{
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid #10B981',
                      color: '#10B981',
                      padding: '6px 14px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                    }}
                  >
                    💬 Contact Student
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
                  disabled={submitting}
                  style={{
                    background: '#10B981',
                    color: '#06080F',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: submitting ? 'not-allowed' : 'pointer',
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
    </div>
  );
};
