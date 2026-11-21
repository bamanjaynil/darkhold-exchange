/**
 * @file artworks.ts
 * Official SVG Data URI artworks for products, tickets, instruments, drops, and community listings.
 * Ensures that reset, seeds, and API responses always present vibrant, championship-grade visuals.
 */

export function svgToDataUri(svgString: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
}

// 1. Official Festival Hoodie / Cloak Artwork
export const HOODIE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bgGradHoodie" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A0E1A"/>
      <stop offset="100%" stop-color="#04060B"/>
    </linearGradient>
    <linearGradient id="neonCyanHoodie" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F0FF"/>
      <stop offset="100%" stop-color="#0284C7"/>
    </linearGradient>
    <filter id="glowHoodie" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#bgGradHoodie)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#00F0FF" stroke-width="1.5" stroke-dasharray="8 6" opacity="0.4"/>
  <path d="M120 120 L160 80 Q200 70 240 80 L280 120 L340 180 L300 220 L270 190 L270 330 Q200 340 130 330 L130 190 L100 220 L60 180 Z" fill="#121829" stroke="#1E293B" stroke-width="3"/>
  <path d="M160 80 Q200 130 240 80 Q220 160 180 160 Q180 160 160 80 Z" fill="#080C16" stroke="#00F0FF" stroke-width="2"/>
  <circle cx="200" cy="220" r="38" fill="none" stroke="url(#neonCyanHoodie)" stroke-width="3" filter="url(#glowHoodie)"/>
  <polygon points="200,195 220,235 180,235" fill="none" stroke="#00F0FF" stroke-width="2.5"/>
  <circle cx="200" cy="222" r="6" fill="#00F0FF"/>
  <text x="200" y="280" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="900" fill="#00F0FF" text-anchor="middle" letter-spacing="3">DARKHOLD</text>
  <text x="200" y="300" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="#94A3B8" text-anchor="middle" letter-spacing="1.5">OFFICIAL FEST HOODIE • MNNIT</text>
</svg>`;

// 2. Official Concert Pass Artwork (FEST-GA & Pronite Pass)
export const CONCERT_PASS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="passBgConcert" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#150B24"/>
      <stop offset="100%" stop-color="#07030C"/>
    </linearGradient>
    <linearGradient id="purpleGlowConcert" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#A855F7"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#passBgConcert)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#A855F7" stroke-width="1.5" opacity="0.4"/>
  <rect x="70" y="60" width="260" height="280" rx="14" fill="#0F091A" stroke="url(#purpleGlowConcert)" stroke-width="2.5"/>
  <circle cx="70" cy="200" r="16" fill="#150B24"/>
  <circle cx="330" cy="200" r="16" fill="#150B24"/>
  <line x1="90" y1="200" x2="310" y2="200" stroke="#A855F7" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.6"/>
  <text x="200" y="110" font-family="'JetBrains Mono', monospace" font-size="20" font-weight="900" fill="#EC4899" text-anchor="middle" letter-spacing="4">PRONITE 2026</text>
  <text x="200" y="132" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#A855F7" text-anchor="middle" letter-spacing="2">CULRAV FESTIVAL ARENA</text>
  <rect x="130" y="148" width="140" height="36" rx="6" fill="rgba(168, 85, 247, 0.15)" stroke="#A855F7" stroke-width="1"/>
  <text x="200" y="171" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="800" fill="#F8FAFC" text-anchor="middle">★ GENERAL ADMISSION ★</text>
  <text x="200" y="240" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="800" fill="#CBD5E1" text-anchor="middle">GATE ADMISSION: CONFIRMED</text>
  <text x="200" y="265" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="600" fill="#64748B" text-anchor="middle">CRYPTOGRAPHIC TURNSTILE VERIFIED</text>
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

// 3. Official VIP Lanyard Artwork (FEST-VIP)
export const VIP_LANYARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="goldBgLanyard" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A1405"/>
      <stop offset="100%" stop-color="#080602"/>
    </linearGradient>
    <linearGradient id="goldSheenLanyard" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F59E0B"/>
      <stop offset="50%" stop-color="#FDE68A"/>
      <stop offset="100%" stop-color="#B45309"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#goldBgLanyard)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#F59E0B" stroke-width="1.5" opacity="0.4"/>
  <path d="M170 0 L185 100 L215 100 L230 0" fill="#B45309" opacity="0.8"/>
  <circle cx="200" cy="115" r="14" fill="#06080F" stroke="#F59E0B" stroke-width="3"/>
  <rect x="194" y="125" width="12" height="20" rx="2" fill="#F59E0B"/>
  <rect x="90" y="140" width="220" height="220" rx="12" fill="#0D0F17" stroke="url(#goldSheenLanyard)" stroke-width="3"/>
  <circle cx="200" cy="200" r="32" fill="rgba(245, 158, 11, 0.15)" stroke="#F59E0B" stroke-width="2"/>
  <text x="200" y="209" font-family="'JetBrains Mono', monospace" font-size="24" font-weight="900" fill="#FDE68A" text-anchor="middle">👑</text>
  <text x="200" y="260" font-family="'JetBrains Mono', monospace" font-size="18" font-weight="900" fill="url(#goldSheenLanyard)" text-anchor="middle" letter-spacing="3">VIP BACKSTAGE</text>
  <text x="200" y="280" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#F59E0B" text-anchor="middle" letter-spacing="1.5">ALL-ACCESS BACKSTAGE PASS</text>
  <text x="200" y="315" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="800" fill="#F8FAFC" text-anchor="middle">FRONT ROW PIT • GREEN ROOM</text>
  <text x="200" y="332" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="#64748B" text-anchor="middle">MNNIT ALLAHABAD FESTIVAL</text>
</svg>`;

// 4. Mystic Relic Artwork (RELIC-AGAMOTTO)
export const MYSTIC_RELIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="relicBgRelic" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#021C18"/>
      <stop offset="100%" stop-color="#010A09"/>
    </linearGradient>
    <linearGradient id="emeraldRelic" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#relicBgRelic)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.4"/>
  <circle cx="200" cy="190" r="95" fill="none" stroke="#10B981" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.6"/>
  <circle cx="200" cy="190" r="80" fill="none" stroke="#059669" stroke-width="2"/>
  <path d="M120 190 Q200 120 280 190 Q200 260 120 190 Z" fill="#062822" stroke="url(#emeraldRelic)" stroke-width="4"/>
  <circle cx="200" cy="190" r="30" fill="#011814" stroke="#34D399" stroke-width="3"/>
  <circle cx="200" cy="190" r="14" fill="#10B981"/>
  <line x1="200" y1="80" x2="200" y2="110" stroke="#10B981" stroke-width="2"/>
  <line x1="200" y1="270" x2="200" y2="300" stroke="#10B981" stroke-width="2"/>
  <line x1="90" y1="190" x2="120" y2="190" stroke="#10B981" stroke-width="2"/>
  <line x1="280" y1="190" x2="310" y2="190" stroke="#10B981" stroke-width="2"/>
  <text x="200" y="330" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="900" fill="#34D399" text-anchor="middle" letter-spacing="3">EYE OF AGAMOTTO</text>
  <text x="200" y="352" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#6EE7B7" text-anchor="middle" letter-spacing="1.5">LIMITED EDITION SACRED ARTIFACT</text>
</svg>`;

// 5. Ceramic Cyber Mug Artwork (prod_mug)
export const CYBER_MUG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="mugBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0E1726"/>
      <stop offset="100%" stop-color="#050811"/>
    </linearGradient>
    <linearGradient id="mugCyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F0FF"/>
      <stop offset="100%" stop-color="#0284C7"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#mugBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#00F0FF" stroke-width="1.5" opacity="0.3"/>
  <!-- Steam lines -->
  <path d="M160 85 Q150 65 160 45" fill="none" stroke="#00F0FF" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
  <path d="M190 75 Q200 55 190 35" fill="none" stroke="#00F0FF" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
  <path d="M220 85 Q210 65 220 45" fill="none" stroke="#00F0FF" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
  <!-- Mug Handle -->
  <path d="M260 140 C320 140 320 250 260 250" fill="none" stroke="#1E293B" stroke-width="22" stroke-linecap="round"/>
  <path d="M260 140 C310 140 310 250 260 250" fill="none" stroke="#00F0FF" stroke-width="4" stroke-linecap="round"/>
  <!-- Mug Body -->
  <rect x="110" y="110" width="160" height="170" rx="16" fill="#111827" stroke="#1E293B" stroke-width="4"/>
  <rect x="110" y="110" width="160" height="170" rx="16" fill="none" stroke="url(#mugCyan)" stroke-width="2"/>
  <!-- Mug Emblem -->
  <circle cx="190" cy="195" r="32" fill="none" stroke="#00F0FF" stroke-width="2"/>
  <polygon points="190,175 205,205 175,205" fill="#00F0FF" opacity="0.8"/>
  <text x="190" y="240" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="800" fill="#00F0FF" text-anchor="middle" letter-spacing="2">DARKHOLD</text>
  <text x="200" y="325" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="900" fill="#F8FAFC" text-anchor="middle">CERAMIC CYBER MUG</text>
  <text x="200" y="348" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#94A3B8" text-anchor="middle">11oz MATTE OBSIDIAN // HEAT-REACTIVE</text>
</svg>`;

// 6. Commemorative Holographic Poster Artwork (prod_poster)
export const POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="posterBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E0B36"/>
      <stop offset="50%" stop-color="#0F051D"/>
      <stop offset="100%" stop-color="#05010A"/>
    </linearGradient>
    <linearGradient id="rainbowSheen" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00F0FF"/>
      <stop offset="25%" stop-color="#A855F7"/>
      <stop offset="50%" stop-color="#EC4899"/>
      <stop offset="75%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#10B981"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#posterBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="url(#rainbowSheen)" stroke-width="2"/>
  <!-- Poster Frame -->
  <rect x="75" y="45" width="250" height="310" rx="10" fill="#0D0717" stroke="#331A4D" stroke-width="3"/>
  <!-- Cyberpunk Visuals -->
  <polygon points="200,80 270,200 130,200" fill="none" stroke="url(#rainbowSheen)" stroke-width="3"/>
  <polygon points="200,105 250,195 150,195" fill="none" stroke="#00F0FF" stroke-width="1.5" opacity="0.7"/>
  <circle cx="200" cy="165" r="18" fill="#EC4899" opacity="0.8"/>
  <!-- Text Elements -->
  <text x="200" y="240" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="900" fill="url(#rainbowSheen)" text-anchor="middle" letter-spacing="4">CULRAV 2026</text>
  <text x="200" y="260" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="#CBD5E1" text-anchor="middle" letter-spacing="2">COMMEMORATIVE FOIL POSTER</text>
  <text x="200" y="285" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="600" fill="#94A3B8" text-anchor="middle">A1 METALLIC EDITION • PRINT 42/250</text>
  <text x="200" y="325" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="700" fill="#A855F7" text-anchor="middle">MNNIT MEDIA CELL ARTWORK</text>
</svg>`;

// 7. Graphing Calculator Artwork (comm_calc_alice)
export const CALCULATOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="calcBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="screenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#064E3B"/>
      <stop offset="100%" stop-color="#022C22"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#calcBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#38BDF8" stroke-width="1.5" opacity="0.3"/>
  <!-- Calculator Body -->
  <rect x="110" y="45" width="180" height="310" rx="18" fill="#1E293B" stroke="#334155" stroke-width="3"/>
  <!-- LCD Screen -->
  <rect x="125" y="65" width="150" height="85" rx="8" fill="url(#screenGrad)" stroke="#059669" stroke-width="2"/>
  <!-- Sine wave graph on screen -->
  <path d="M130 110 Q145 80 165 110 T200 110 T235 110 T270 110" fill="none" stroke="#34D399" stroke-width="2.5"/>
  <line x1="130" y1="110" x2="270" y2="110" stroke="#065F46" stroke-width="1"/>
  <line x1="200" y1="70" x2="200" y2="145" stroke="#065F46" stroke-width="1"/>
  <!-- Keypad Keys -->
  <g fill="#0F172A" stroke="#475569" stroke-width="1.5">
    <rect x="125" y="165" width="26" height="18" rx="4"/>
    <rect x="156" y="165" width="26" height="18" rx="4"/>
    <rect x="187" y="165" width="26" height="18" rx="4"/>
    <rect x="218" y="165" width="26" height="18" rx="4"/>
    <rect x="249" y="165" width="26" height="18" rx="4"/>
    
    <rect x="125" y="195" width="26" height="18" rx="4"/>
    <rect x="156" y="195" width="26" height="18" rx="4"/>
    <rect x="187" y="195" width="26" height="18" rx="4"/>
    <rect x="218" y="195" width="26" height="18" rx="4"/>
    <rect x="249" y="195" width="26" height="18" rx="4"/>

    <rect x="125" y="225" width="26" height="18" rx="4"/>
    <rect x="156" y="225" width="26" height="18" rx="4"/>
    <rect x="187" y="225" width="26" height="18" rx="4"/>
    <rect x="218" y="225" width="26" height="18" rx="4"/>
    <rect x="249" y="225" width="26" height="18" rx="4"/>

    <rect x="125" y="255" width="26" height="18" rx="4"/>
    <rect x="156" y="255" width="26" height="18" rx="4"/>
    <rect x="187" y="255" width="26" height="18" rx="4"/>
    <rect x="218" y="255" width="57" height="18" rx="4" fill="#0284C7"/>

    <rect x="125" y="285" width="26" height="22" rx="4"/>
    <rect x="156" y="285" width="26" height="22" rx="4"/>
    <rect x="187" y="285" width="26" height="22" rx="4"/>
    <rect x="218" y="285" width="57" height="22" rx="4" fill="#10B981"/>
  </g>
  <text x="200" y="340" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="800" fill="#38BDF8" text-anchor="middle">TI-84 PLUS CE COLOR</text>
</svg>`;

// 8. Algorithms Book Artwork (comm_clrs_bob)
export const CLRS_BOOK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="bookBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181B"/>
      <stop offset="100%" stop-color="#09090B"/>
    </linearGradient>
    <linearGradient id="silverSheen" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F1F5F9"/>
      <stop offset="50%" stop-color="#94A3B8"/>
      <stop offset="100%" stop-color="#475569"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#bookBg)"/>
  <rect x="10" y="10" width="380" height="380" rx="12" fill="none" stroke="#94A3B8" stroke-width="1.5" opacity="0.3"/>
  <!-- Book Cover -->
  <rect x="90" y="50" width="220" height="300" rx="8" fill="#0F172A" stroke="#334155" stroke-width="3"/>
  <!-- Spine stripe -->
  <rect x="90" y="50" width="22" height="300" rx="4" fill="#0284C7"/>
  <!-- Dynamic Programming Grid / Binary Tree Graphic -->
  <g stroke="#38BDF8" stroke-width="2" fill="none">
    <circle cx="200" cy="150" r="10" fill="#0284C7"/>
    <circle cx="160" cy="190" r="8" fill="#0369A1"/>
    <circle cx="240" cy="190" r="8" fill="#0369A1"/>
    <circle cx="140" cy="230" r="6" fill="#075985"/>
    <circle cx="180" cy="230" r="6" fill="#075985"/>
    <circle cx="220" cy="230" r="6" fill="#075985"/>
    <circle cx="260" cy="230" r="6" fill="#075985"/>
    <line x1="200" y1="160" x2="160" y2="182"/>
    <line x1="200" y1="160" x2="240" y2="182"/>
    <line x1="160" y1="198" x2="140" y2="224"/>
    <line x1="160" y1="198" x2="180" y2="224"/>
    <line x1="240" y1="198" x2="220" y2="224"/>
    <line x1="240" y1="198" x2="260" y2="224"/>
  </g>
  <text x="210" y="100" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="900" fill="url(#silverSheen)" text-anchor="middle" letter-spacing="2">INTRODUCTION TO</text>
  <text x="210" y="122" font-family="'JetBrains Mono', monospace" font-size="16" font-weight="900" fill="#38BDF8" text-anchor="middle" letter-spacing="3">ALGORITHMS</text>
  <text x="210" y="275" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="800" fill="#F8FAFC" text-anchor="middle">FOURTH EDITION (CLRS)</text>
  <text x="210" y="295" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="600" fill="#94A3B8" text-anchor="middle">Cormen • Leiserson • Rivest • Stein</text>
  <text x="210" y="325" font-family="'JetBrains Mono', monospace" font-size="8" font-weight="700" fill="#38BDF8" text-anchor="middle">THE MIT PRESS</text>
</svg>`;

// 9. Cyberpunk Dorm Lamp Artwork
export const DORM_LAMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <linearGradient id="lampBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#030712"/>
    </linearGradient>
    <radialGradient id="lampLight" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#FDE047" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#EAB308" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#111827" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" rx="16" fill="url(#lampBg)"/>
  <circle cx="200" cy="180" r="140" fill="url(#lampLight)"/>
  <!-- Lamp Base -->
  <ellipse cx="200" cy="330" rx="70" ry="14" fill="#1E293B" stroke="#475569" stroke-width="3"/>
  <!-- Lamp Stem -->
  <path d="M200 330 L200 180 L250 120" fill="none" stroke="#94A3B8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Lamp Head -->
  <polygon points="230,110 290,130 270,145 220,125" fill="#EAB308" stroke="#FACC15" stroke-width="2"/>
  <text x="200" y="370" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="800" fill="#FDE047" text-anchor="middle">ERGONOMIC STUDY LED LAMP</text>
</svg>`;

// 10. Festival Banner / Pronite Arena Event Cover
export const FESTIVAL_BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300">
  <defs>
    <linearGradient id="bannerBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1C0A35"/>
      <stop offset="50%" stop-color="#0C0418"/>
      <stop offset="100%" stop-color="#020005"/>
    </linearGradient>
    <linearGradient id="neonLaser" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00F0FF"/>
      <stop offset="50%" stop-color="#EC4899"/>
      <stop offset="100%" stop-color="#A855F7"/>
    </linearGradient>
  </defs>
  <rect width="600" height="300" rx="12" fill="url(#bannerBg)"/>
  <!-- Laser beams -->
  <line x1="0" y1="0" x2="300" y2="220" stroke="#00F0FF" stroke-width="2" opacity="0.6"/>
  <line x1="600" y1="0" x2="300" y2="220" stroke="#EC4899" stroke-width="2" opacity="0.6"/>
  <line x1="150" y1="0" x2="300" y2="220" stroke="#A855F7" stroke-width="1.5" opacity="0.4"/>
  <line x1="450" y1="0" x2="300" y2="220" stroke="#38BDF8" stroke-width="1.5" opacity="0.4"/>
  <polygon points="300,120 420,240 180,240" fill="none" stroke="url(#neonLaser)" stroke-width="4"/>
  <circle cx="300" cy="200" r="28" fill="#EC4899" opacity="0.8"/>
  <text x="300" y="80" font-family="'JetBrains Mono', monospace" font-size="28" font-weight="900" fill="url(#neonLaser)" text-anchor="middle" letter-spacing="6">CULRAV-AVISHKAR 2026</text>
  <text x="300" y="110" font-family="'JetBrains Mono', monospace" font-size="14" font-weight="700" fill="#F8FAFC" text-anchor="middle" letter-spacing="3">ANNUAL PRONITE FESTIVAL &amp; EDM ARENA</text>
  <text x="300" y="275" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" fill="#94A3B8" text-anchor="middle">MNNIT ALLAHABAD • 3 HEADLINE NIGHTS</text>
</svg>`;

export const OFFICIAL_ARTWORKS: Record<string, string> = {
  hoodie: svgToDataUri(HOODIE_SVG),
  merchCloak: svgToDataUri(HOODIE_SVG),
  concertPass: svgToDataUri(CONCERT_PASS_SVG),
  festGa: svgToDataUri(CONCERT_PASS_SVG),
  vipLanyard: svgToDataUri(VIP_LANYARD_SVG),
  festVip: svgToDataUri(VIP_LANYARD_SVG),
  mysticRelic: svgToDataUri(MYSTIC_RELIC_SVG),
  relicAgamotto: svgToDataUri(MYSTIC_RELIC_SVG),
  cyberMug: svgToDataUri(CYBER_MUG_SVG),
  poster: svgToDataUri(POSTER_SVG),
  calculator: svgToDataUri(CALCULATOR_SVG),
  clrsBook: svgToDataUri(CLRS_BOOK_SVG),
  dormLamp: svgToDataUri(DORM_LAMP_SVG),
  festivalBanner: svgToDataUri(FESTIVAL_BANNER_SVG),
};
