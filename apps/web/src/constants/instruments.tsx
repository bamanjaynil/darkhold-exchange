import React from 'react';

export interface InstrumentMetadata {
  symbol: string;
  name: string;
  shortName: string;
  category: string;
  categoryColor: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  badge: React.ReactNode;
}

export const INSTRUMENTS_METADATA: Record<string, InstrumentMetadata> = {
  'FEST-GA': {
    symbol: 'FEST-GA',
    name: 'Festival General Admission Pass',
    shortName: 'Festival GA Ticket',
    category: 'EVENT TICKET',
    categoryColor: '#00F0FF',
    description: 'Standard single-day festival entry pass with anti-scalp collar protection.',
    icon: '🎫',
    color: '#00F0FF',
    bgColor: 'rgba(0, 240, 255, 0.08)',
    borderColor: 'rgba(0, 240, 255, 0.35)',
    badge: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="10" width="38" height="28" rx="4" fill="#040A14" stroke="#00F0FF" strokeWidth="1.5" />
        <path d="M16 10V15M16 33V38" stroke="#00F0FF" strokeWidth="1.5" strokeDasharray="2 2" />
        <circle cx="16" cy="10" r="3" fill="#06080F" stroke="#00F0FF" strokeWidth="1.5" />
        <circle cx="16" cy="38" r="3" fill="#06080F" stroke="#00F0FF" strokeWidth="1.5" />
        <line x1="22" y1="18" x2="37" y2="18" stroke="#00F0FF" strokeWidth="2" strokeLinecap="round" />
        <line x1="22" y1="24" x2="33" y2="24" stroke="#67E8F9" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="22" y1="30" x2="29" y2="30" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="9" y="16" width="3" height="16" fill="#00F0FF" opacity="0.8" rx="1" />
      </svg>
    ),
  },
  'FEST-VIP': {
    symbol: 'FEST-VIP',
    name: 'VIP Backstage Access Pass',
    shortName: 'VIP Pass',
    category: 'VIP TICKET',
    categoryColor: '#F59E0B',
    description: 'All-access VIP pass with lounge and artist backstage entry.',
    icon: '👑',
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    badge: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Lanyard neck ribbon */}
        <path d="M16 4L24 14L32 4" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2" />
        <rect x="22" y="12" width="4" height="4" rx="1" fill="#D97706" />
        {/* Pass card body */}
        <rect x="10" y="15" width="28" height="30" rx="3" fill="#0B0904" stroke="#F59E0B" strokeWidth="1.5" />
        <circle cx="24" cy="23" r="4.5" stroke="#F59E0B" strokeWidth="1.5" fill="rgba(245, 158, 11, 0.2)" />
        {/* Crown glyph */}
        <path d="M21 24L22 22L24 24L26 22L27 24" stroke="#FCD34D" strokeWidth="1.2" strokeLinecap="round" />
        <rect x="15" y="31" width="18" height="4" rx="1" fill="#F59E0B" opacity="0.9" />
        <line x1="17" y1="38" x2="31" y2="38" stroke="#78350F" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  'MERCH-CLOAK': {
    symbol: 'MERCH-CLOAK',
    name: 'Darkhold Stealth Cloak',
    shortName: 'Stealth Cloak',
    category: 'PHYSICAL MERCH',
    categoryColor: '#FF2A54',
    description: 'Limited-edition wearable festival cloak with physical redemption barcode.',
    icon: '🧥',
    color: '#FF2A54',
    bgColor: 'rgba(255, 42, 84, 0.08)',
    borderColor: 'rgba(255, 42, 84, 0.35)',
    badge: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Hooded Cloak silhouette */}
        <path
          d="M24 7C19 7 16 11 16 15C16 19 19 22 24 23C29 22 32 19 32 15C32 11 29 7 24 7Z"
          fill="#140508"
          stroke="#FF2A54"
          strokeWidth="1.5"
        />
        <path
          d="M17 21L8 39C8 39 15 42 24 42C33 42 40 39 40 39L31 21C29 23 26 24 24 24C22 24 19 23 17 21Z"
          fill="#0C0407"
          stroke="#FF2A54"
          strokeWidth="1.5"
        />
        {/* Cloak center neon fold */}
        <line x1="24" y1="24" x2="24" y2="41" stroke="#FF2A54" strokeWidth="1.5" strokeDasharray="3 2" />
        {/* Barcode redemption tag */}
        <rect x="29" y="32" width="7" height="6" rx="1" fill="#1E070B" stroke="#FDA4AF" strokeWidth="1" />
        <line x1="31" y1="34" x2="31" y2="36" stroke="#FF2A54" strokeWidth="1" />
        <line x1="33" y1="34" x2="33" y2="36" stroke="#FF2A54" strokeWidth="1" />
      </svg>
    ),
  },
  'RELIC-AGAMOTTO': {
    symbol: 'RELIC-AGAMOTTO',
    name: 'Eye of Agamotto Relic',
    shortName: 'Eye of Agamotto',
    category: 'SOULBOUND ARTIFACT',
    categoryColor: '#A855F7',
    description: 'Soulbound non-transferable digital relic. Transfers are locked by protocol.',
    icon: '🔒',
    color: '#A855F7',
    bgColor: 'rgba(168, 85, 247, 0.08)',
    borderColor: 'rgba(168, 85, 247, 0.35)',
    badge: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Mystic Eye outer runic talisman */}
        <path
          d="M8 24C13 14 35 14 40 24C35 34 13 34 8 24Z"
          fill="#0A0612"
          stroke="#A855F7"
          strokeWidth="1.5"
        />
        <circle cx="24" cy="24" r="7" stroke="#C084FC" strokeWidth="1.5" fill="rgba(168, 85, 247, 0.2)" />
        <circle cx="24" cy="24" r="3" fill="#E9D5FF" />
        {/* Padlock Overlay representing Soulbound trading lock */}
        <rect x="29" y="27" width="13" height="11" rx="2" fill="#0F172A" stroke="#EF4444" strokeWidth="1.5" />
        <path d="M32 27V24C32 22 34 20 35.5 20C37 20 39 22 39 24V27" stroke="#EF4444" strokeWidth="1.5" />
        <circle cx="35.5" cy="32.5" r="1.5" fill="#EF4444" />
      </svg>
    ),
  },
};

export function getInstrumentMeta(symbol: string): InstrumentMetadata {
  return (
    INSTRUMENTS_METADATA[symbol] || {
      symbol,
      name: symbol,
      shortName: symbol,
      category: 'SECONDARY ASSET',
      categoryColor: '#94A3B8',
      description: `Secondary trading instrument ${symbol} on Darkhold LMAX Matching Engine.`,
      icon: '💎',
      color: '#94A3B8',
      bgColor: 'rgba(148, 163, 184, 0.08)',
      borderColor: 'rgba(148, 163, 184, 0.3)',
      badge: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="10" y="10" width="28" height="28" rx="4" stroke="#94A3B8" strokeWidth="1.5" />
        </svg>
      ),
    }
  );
}
