import React, { useEffect, useRef, useState } from 'react';
import { formatDKC } from '@darkhold/shared';

export interface BookLevel {
  price: number;
  qty: number;
  orders: number;
  total: number;
}

interface LiquidityCanvasProps {
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  lastPrice: number | null;
  trades?: Array<{ id: string; price: number; qty: number; side?: string; timestamp?: number }>;
  onSelectPrice?: (price: number, suggestedSide: 'BUY' | 'SELL') => void;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
}

export const LiquidityCanvas: React.FC<LiquidityCanvasProps> = ({
  bids,
  asks,
  spread,
  lastPrice,
  trades = [],
  onSelectPrice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<'radar' | 'pulse'>('radar');
  const [hoveredPoint, setHoveredPoint] = useState<{ price: number; total: number; side: 'BUY' | 'SELL'; x: number; y: number } | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const lastTradeIdRef = useRef<string | null>(null);

  // Trigger visual shockwave on new trades
  useEffect(() => {
    if (trades.length > 0) {
      const newest = trades[0];
      if (newest && newest.id !== lastTradeIdRef.current) {
        lastTradeIdRef.current = newest.id;
        const canvas = canvasRef.current;
        if (canvas) {
          const w = canvas.width;
          const h = canvas.height;
          const isBuy = newest.side === 'BUY';
          ripplesRef.current.push({
            x: isBuy ? w * 0.45 : w * 0.55,
            y: h * 0.5,
            radius: 5,
            maxRadius: Math.min(w, h) * 0.6,
            color: isBuy ? '0, 240, 255' : '255, 42, 84',
            alpha: 0.9,
          });
        }
      }
    }
  }, [trades]);

  // 60 FPS Render Loop
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // 1. Draw Cyber Matrix Background Grid
      ctx.fillStyle = '#06080F';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.lineWidth = 1;
      const gridSpacingX = 40;
      const gridSpacingY = 30;
      for (let x = 0; x < w; x += gridSpacingX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSpacingY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 2. Draw Ripples / Shockwaves
      for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
        const r = ripplesRef.current[i]!;
        r.radius += 2.5;
        r.alpha *= 0.95;

        ctx.save();
        ctx.beginPath();
        ctx.arc(r.x / dpr, r.y / dpr, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r.color}, ${r.alpha})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = `rgba(${r.color}, 0.8)`;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();

        if (r.alpha < 0.02 || r.radius >= r.maxRadius) {
          ripplesRef.current.splice(i, 1);
        }
      }

      const midX = w / 2;
      const maxBidTotal = bids.length > 0 ? bids[bids.length - 1]!.total : 1;
      const maxAskTotal = asks.length > 0 ? asks[asks.length - 1]!.total : 1;
      const maxTotal = Math.max(maxBidTotal, maxAskTotal, 1);

      if (viewMode === 'radar') {
        // --- VIEW MODE: LIQUIDITY GRAVITY WALLS ---
        const paddingBottom = 26;
        const graphHeight = h - paddingBottom - 10;

        // Bids Gravity Wall (Left: Cyan Energy)
        if (bids.length > 0) {
          ctx.beginPath();
          ctx.moveTo(midX, h - paddingBottom);

          for (let i = 0; i < bids.length; i++) {
            const b = bids[i]!;
            const fracX = (i + 1) / bids.length;
            const x = midX - fracX * (midX - 16);
            const fracY = Math.min(1, b.total / maxTotal);
            const y = h - paddingBottom - fracY * graphHeight;
            ctx.lineTo(x, y);
          }

          const leftmostX = midX - (midX - 16);
          ctx.lineTo(leftmostX, h - paddingBottom);
          ctx.closePath();

          const bidGrad = ctx.createLinearGradient(0, 0, midX, h);
          bidGrad.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
          bidGrad.addColorStop(0.7, 'rgba(0, 180, 216, 0.15)');
          bidGrad.addColorStop(1, 'rgba(0, 119, 182, 0.02)');
          ctx.fillStyle = bidGrad;
          ctx.fill();

          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(0, 240, 255, 0.8)';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(midX, h - paddingBottom);
          for (let i = 0; i < bids.length; i++) {
            const b = bids[i]!;
            const fracX = (i + 1) / bids.length;
            const x = midX - fracX * (midX - 16);
            const fracY = Math.min(1, b.total / maxTotal);
            const y = h - paddingBottom - fracY * graphHeight;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Asks Gravity Wall (Right: Crimson Energy)
        if (asks.length > 0) {
          ctx.beginPath();
          ctx.moveTo(midX, h - paddingBottom);

          for (let i = 0; i < asks.length; i++) {
            const a = asks[i]!;
            const fracX = (i + 1) / asks.length;
            const x = midX + fracX * (midX - 16);
            const fracY = Math.min(1, a.total / maxTotal);
            const y = h - paddingBottom - fracY * graphHeight;
            ctx.lineTo(x, y);
          }

          const rightmostX = midX + (midX - 16);
          ctx.lineTo(rightmostX, h - paddingBottom);
          ctx.closePath();

          const askGrad = ctx.createLinearGradient(midX, 0, w, h);
          askGrad.addColorStop(0, 'rgba(255, 42, 84, 0.45)');
          askGrad.addColorStop(0.7, 'rgba(225, 29, 72, 0.15)');
          askGrad.addColorStop(1, 'rgba(159, 18, 57, 0.02)');
          ctx.fillStyle = askGrad;
          ctx.fill();

          ctx.strokeStyle = '#FF2A54';
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(255, 42, 84, 0.8)';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(midX, h - paddingBottom);
          for (let i = 0; i < asks.length; i++) {
            const a = asks[i]!;
            const fracX = (i + 1) / asks.length;
            const x = midX + fracX * (midX - 16);
            const fracY = Math.min(1, a.total / maxTotal);
            const y = h - paddingBottom - fracY * graphHeight;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Center Laser Line (Mid-Price & Spread)
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(midX, 6);
        ctx.lineTo(midX, h - paddingBottom);
        ctx.stroke();
        ctx.restore();

        // Center Mid-Price Laser Core Glow
        ctx.save();
        ctx.fillStyle = '#F59E0B';
        ctx.shadowColor = 'rgba(245, 158, 11, 1)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(midX, h - paddingBottom, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Draw HUD Text: Bids Total, Asks Total, Spread
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#00F0FF';
        ctx.fillText(`◄ BIDS CUMULATIVE: ${maxBidTotal.toLocaleString()} UNITS`, 16, 20);

        ctx.fillStyle = '#FF2A54';
        const askLabel = `ASKS CUMULATIVE: ${maxAskTotal.toLocaleString()} UNITS ►`;
        const askMetrics = ctx.measureText(askLabel);
        ctx.fillText(askLabel, w - askMetrics.width - 16, 20);

        // Center Spread Pill
        const spreadText = spread !== null ? `SPREAD: ${formatDKC(spread)}` : 'SPREAD: LOCKED';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        const spMetrics = ctx.measureText(spreadText);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(midX - spMetrics.width / 2 - 8, 8, spMetrics.width + 16, 20);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - spMetrics.width / 2 - 8, 8, spMetrics.width + 16, 20);
        ctx.fillStyle = '#F59E0B';
        ctx.fillText(spreadText, midX - spMetrics.width / 2, 22);

      } else {
        // --- VIEW MODE: EXECUTION PULSE TIMELINE ---
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#94A3B8';
        ctx.fillText('⚡ REAL-TIME EXECUTION TAPE & MATCH PULSE', 16, 20);

        const visibleTrades = trades.slice(0, 30);
        const colWidth = (w - 32) / Math.max(visibleTrades.length, 1);

        for (let i = 0; i < visibleTrades.length; i++) {
          const t = visibleTrades[i]!;
          const isBuy = t.side === 'BUY';
          const x = 20 + i * colWidth;
          const bubbleRadius = Math.max(4, Math.min(18, t.qty * 3));
          const y = h * 0.5 + (isBuy ? -1 : 1) * (bubbleRadius * 2);

          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, bubbleRadius, 0, Math.PI * 2);
          ctx.fillStyle = isBuy ? 'rgba(0, 240, 255, 0.6)' : 'rgba(255, 42, 84, 0.6)';
          ctx.shadowColor = isBuy ? '#00F0FF' : '#FF2A54';
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.strokeStyle = isBuy ? '#00F0FF' : '#FF2A54';
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = '#F8FAFC';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillText(`${t.qty}x`, x - 6, y + 3);
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [bids, asks, spread, lastPrice, viewMode, trades]);

  // Handle Mouse Interaction & Sniping Clicks
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSelectPrice) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const midX = w / 2;

    if (x < midX && bids.length > 0) {
      // Clicked on Bids wall -> tactical snipe: HIT BID (SELL)
      const frac = 1 - (x / midX);
      const idx = Math.min(bids.length - 1, Math.floor(frac * bids.length));
      const targetBid = bids[idx] || bids[0];
      if (targetBid) {
        onSelectPrice(targetBid.price, 'SELL');
      }
    } else if (x > midX && asks.length > 0) {
      // Clicked on Asks wall -> tactical snipe: SNIPE ASK (BUY)
      const frac = (x - midX) / (w - midX);
      const idx = Math.min(asks.length - 1, Math.floor(frac * asks.length));
      const targetAsk = asks[idx] || asks[0];
      if (targetAsk) {
        onSelectPrice(targetAsk.price, 'BUY');
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const midX = w / 2;

    if (x < midX && bids.length > 0) {
      const frac = 1 - (x / midX);
      const idx = Math.min(bids.length - 1, Math.max(0, Math.floor(frac * bids.length)));
      const b = bids[idx];
      if (b) setHoveredPoint({ price: b.price, total: b.total, side: 'BUY', x, y });
    } else if (x > midX && asks.length > 0) {
      const frac = (x - midX) / (w - midX);
      const idx = Math.min(asks.length - 1, Math.max(0, Math.floor(frac * asks.length)));
      const a = asks[idx];
      if (a) setHoveredPoint({ price: a.price, total: a.total, side: 'SELL', x, y });
    } else {
      setHoveredPoint(null);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, background: '#06080F', borderRadius: 8, overflow: 'hidden', border: '1px solid #1B2438' }}>
      {/* Top Controls Toolbar */}
      <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 10, display: 'flex', gap: 6 }}>
        <button
          onClick={() => setViewMode('radar')}
          style={{
            background: viewMode === 'radar' ? '#00F0FF' : 'rgba(15, 23, 42, 0.75)',
            color: viewMode === 'radar' ? '#06080F' : '#94A3B8',
            border: '1px solid rgba(0, 240, 255, 0.3)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: 0.5,
          }}
        >
          RADAR DEPTH
        </button>
        <button
          onClick={() => setViewMode('pulse')}
          style={{
            background: viewMode === 'pulse' ? '#FF2A54' : 'rgba(15, 23, 42, 0.75)',
            color: viewMode === 'pulse' ? '#FFFFFF' : '#94A3B8',
            border: '1px solid rgba(255, 42, 84, 0.3)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: 0.5,
          }}
        >
          EXECUTION PULSE
        </button>
      </div>

      {/* Hover Sniping Tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hoveredPoint.x + 12, (containerRef.current?.clientWidth || 300) - 150),
            top: Math.max(hoveredPoint.y - 45, 10),
            background: 'rgba(6, 8, 15, 0.95)',
            border: `1px solid ${hoveredPoint.side === 'BUY' ? '#00F0FF' : '#FF2A54'}`,
            borderRadius: 6,
            padding: '6px 10px',
            pointerEvents: 'none',
            zIndex: 20,
            boxShadow: `0 0 12px ${hoveredPoint.side === 'BUY' ? 'rgba(0,240,255,0.4)' : 'rgba(255,42,84,0.4)'}`,
          }}
        >
          <div style={{ color: hoveredPoint.side === 'BUY' ? '#00F0FF' : '#FF2A54', fontWeight: 700, fontSize: 11 }}>
            {hoveredPoint.side === 'BUY' ? '🎯 CLICK TO HIT BID' : '🎯 CLICK TO SNIPE ASK'}
          </div>
          <div style={{ color: '#F8FAFC', fontSize: 12, fontWeight: 600 }}>
            {formatDKC(hoveredPoint.price)}
          </div>
          <div style={{ color: '#94A3B8', fontSize: 10 }}>
            Depth: {hoveredPoint.total.toLocaleString()} units
          </div>
        </div>
      )}

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      />
    </div>
  );
};
