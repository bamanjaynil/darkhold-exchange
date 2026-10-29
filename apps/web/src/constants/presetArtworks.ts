/**
 * Official Preset Artworks for Darkhold Campus Festival
 * Encoded as optimized SVG Data URIs for instant 1-click selection in Drop and Product creators.
 */

// 1. Official Festival Hoodie Artwork
const HOODIE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A0E1A"/>
      <stop offset="100%" stop-color="#04060B"/>
    </linearGradient>
    <linearGradient id="neonCyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F0FF"/>
      <stop offset="100%" stop-color="#0284C7"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#bgGrad)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#00F0FF" stroke-width="1.5" stroke-dasharray="8 6" opacity="0.4"/>
  
  <!-- Hoodie Silhouette -->
  <path d="M120 120 L160 80 Q200 70 240 80 L280 120 L340 180 L300 220 L270 190 L270 330 Q200 340 130 330 L130 190 L100 220 L60 180 Z" fill="#121829" stroke="#1E293B" stroke-width="3"/>
  <!-- Hood Inner -->
  <path d="M160 80 Q200 130 240 80 Q220 160 180 160 Q180 160 160 80 Z" fill="#080C16" stroke="#00F0FF" stroke-width="2"/>
  <!-- Cyberpunk Graphics on Chest -->
  <circle cx="200" cy="220" r="38" fill="none" stroke="url(#neonCyan)" stroke-width="3" filter="url(#glow)"/>
  <polygon points="200,195 220,235 180,235" fill="none" stroke="#00F0FF" stroke-width="2.5"/>
  <circle cx="200" cy="222" r="6" fill="#00F0FF"/>
  <!-- Text -->
  <text x="200" y="280" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="900" fill="#00F0FF" text-anchor="middle" letter-spacing="3">DARKHOLD</text>
  <text x="200" y="300" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="#94A3B8" text-anchor="middle" letter-spacing="1.5">OFFICIAL FEST HOODIE • MNNIT</text>
</svg>`;

// 2. Official Concert Pass Artwork
const CONCERT_PASS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="passBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#150B24"/>
      <stop offset="100%" stop-color="#07030C"/>
    </linearGradient>
    <linearGradient id="purpleGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#passBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#A855F7" stroke-width="1.5" opacity="0.4"/>
  
  <!-- Ticket Body -->
  <rect x="70" y="60" width="260" height="280" rx="14" fill="#0F091A" stroke="url(#purpleGlow)" stroke-width="2.5"/>
  <!-- Notch cutouts -->
  <circle cx="70" cy="200" r="16" fill="#150B24"/>
  <circle cx="330" cy="200" r="16" fill="#150B24"/>
  <line x1="90" y1="200" x2="310" y2="200" stroke="#A855F7" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.6"/>
  
  <!-- Graphic Elements -->
  <text x="200" y="110" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="900" fill="#EC4899" text-anchor="middle" letter-spacing="4">PRONITE 2026</text>
  <text x="200" y="132" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#A855F7" text-anchor="middle" letter-spacing="2">CULRAV FESTIVAL ARENA</text>
  
  <!-- Hologram Badge -->
  <rect x="130" y="148" width="140" height="36" rx="6" fill="rgba(168, 85, 247, 0.15)" stroke="#A855F7" stroke-width="1"/>
  <text x="200" y="171" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="800" fill="#F8FAFC" text-anchor="middle">★ ALL-ACCESS PASS ★</text>
  
  <text x="200" y="240" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="800" fill="#CBD5E1" text-anchor="middle">GATE ADMISSION: CONFIRMED</text>
  <text x="200" y="265" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="600" fill="#64748B" text-anchor="middle">CRYPTOGRAPHIC TURNSTILE VERIFIED</text>
  
  <!-- Simulated Barcode -->
  <rect x="110" y="285" width="6" height="30" fill="#A855F7"/>
  <rect x="122" y="285" width="12" height="30" fill="#A855F7"/>
  <rect x="140" y="285" width="4" height="30" fill="#A855F7"/>
  <rect x="150" y="285" width="16" height="30" fill="#A855F7"/>
  <rect x="172" y="285" width="8" height="30" fill="#A855F7"/>
  <rect x="186" y="285" width="4" height="30" fill="#A855F7"/>
  <rect x="196" y="285" width="18" height="30" fill="#A855F7"/>
  <rect x="220" y="285" width="10" height="30" fill="#A855F7"/>
  <rect x="236" y="285" width="6" height="30" fill="#A855F7"/>
  <rect x="248" y="285" width="14" height="30" fill="#A855F7"/>
  <rect x="268" y="285" width="8" height="30" fill="#A855F7"/>
  <rect x="282" y="285" width="4" height="30" fill="#A855F7"/>
</svg>`;

// 3. Official VIP Lanyard Artwork
const VIP_LANYARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="goldBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A1405"/>
      <stop offset="100%" stop-color="#080602"/>
    </linearGradient>
    <linearGradient id="goldSheen" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F59E0B"/>
      <stop offset="50%" stop-color="#FDE68A"/>
      <stop offset="100%" stop-color="#B45309"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#goldBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#F59E0B" stroke-width="1.5" opacity="0.4"/>
  
  <!-- Lanyard Strap -->
  <path d="M170 0 L185 100 L215 100 L230 0" fill="#B45309" opacity="0.8"/>
  <circle cx="200" cy="115" r="14" fill="#06080F" stroke="#F59E0B" stroke-width="3"/>
  <rect x="194" y="125" width="12" height="20" rx="2" fill="#F59E0B"/>
  
  <!-- Badge Card -->
  <rect x="90" y="140" width="220" height="220" rx="12" fill="#0D0F17" stroke="url(#goldSheen)" stroke-width="3"/>
  
  <!-- Badge Content -->
  <circle cx="200" cy="200" r="32" fill="rgba(245, 158, 11, 0.15)" stroke="#F59E0B" stroke-width="2"/>
  <text x="200" y="209" font-family="'JetBrains Mono', monospace" font-size="24" font-weight="900" fill="#FDE68A" text-anchor="middle">👑</text>
  
  <text x="200" y="260" font-family="'JetBrains Mono', monospace" font-size="18" font-weight="900" fill="url(#goldSheen)" text-anchor="middle" letter-spacing="3">VIP BACKSTAGE</text>
  <text x="200" y="280" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#F59E0B" text-anchor="middle" letter-spacing="1.5">ARTIST &amp; GUEST OF HONOR</text>
  <text x="200" y="315" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="800" fill="#F8FAFC" text-anchor="middle">TIER 1 • ZERO RESTRICTIONS</text>
  <text x="200" y="332" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="#64748B" text-anchor="middle">MNNIT ALLAHABAD FESTIVAL</text>
</svg>`;

// 4. Mystic Relic Artwork
const MYSTIC_RELIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="relicBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#021C18"/>
      <stop offset="100%" stop-color="#010A09"/>
    </linearGradient>
    <linearGradient id="emerald" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#relicBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.4"/>
  
  <!-- Outer Mystic Circles -->
  <circle cx="200" cy="190" r="95" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.6"/>
  <circle cx="200" cy="190" r="80" fill="none" stroke="#059669" stroke-width="2"/>
  
  <!-- Eye of Agamotto Amulet Shape -->
  <path d="M120 190 Q200 120 280 190 Q200 260 120 190 Z" fill="#062822" stroke="url(#emerald)" stroke-width="4"/>
  <circle cx="200" cy="190" r="30" fill="#011814" stroke="#34D399" stroke-width="3"/>
  <circle cx="200" cy="190" r="14" fill="#10B981"/>
  
  <!-- Runes / Ornaments -->
  <line x1="200" y1="80" x2="200" y2="110" stroke="#10B981" stroke-width="2"/>
  <line x1="200" y1="270" x2="200" y2="300" stroke="#10B981" stroke-width="2"/>
  <line x1="90" y1="190" x2="120" y2="190" stroke="#10B981" stroke-width="2"/>
  <line x1="280" y1="190" x2="310" y2="190" stroke="#10B981" stroke-width="2"/>
  
  <text x="200" y="330" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="900" fill="#34D399" text-anchor="middle" letter-spacing="3">EYE OF AGAMOTTO</text>
  <text x="200" y="352" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#6EE7B7" text-anchor="middle" letter-spacing="1.5">LIMITED EDITION SACRED ARTIFACT</text>
</svg>`;

export function svgToDataUri(svgString: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
}

export const PRESET_OFFICIAL_ARTWORKS = [
  {
    id: 'hoodie',
    label: '👕 Hoodie Artwork',
    name: 'Darkhold Fest Official Cyberpunk Hoodie',
    dataUrl: svgToDataUri(HOODIE_SVG),
  },
  {
    id: 'concert_pass',
    label: '🎫 Concert Pass Artwork',
    name: 'Pronite 2026 Holographic Pass',
    dataUrl: svgToDataUri(CONCERT_PASS_SVG),
  },
  {
    id: 'vip_lanyard',
    label: '🎖️ VIP Lanyard Artwork',
    name: 'VIP Backstage All-Access Pass',
    dataUrl: svgToDataUri(VIP_LANYARD_SVG),
  },
  {
    id: 'mystic_relic',
    label: '🔮 Mystic Relic Artwork',
    name: 'Eye of Agamotto Ancient Relic',
    dataUrl: svgToDataUri(MYSTIC_RELIC_SVG),
  },
];
