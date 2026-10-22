import { z } from 'zod';

// 1 Rupee/Unit = 1,000,000 micro-units (prevents floating-point ledger errors)
export const MICRO_UNIT = 1_000_000n;

export const toMicro = (amount: number): bigint =>
  BigInt(Math.round(amount * 1_000_000));

export const fromMicro = (micro: bigint | string | number): number =>
  Number(BigInt(micro)) / 1_000_000;

// Anti-Scalping Price Collar Calculator
export function calculatePriceCollar(
  faceValueMicro: bigint,
  minCollarBps: number,
  maxCollarBps: number,
  eventTimestampMs: number,
  nowMs: number = Date.now()
): { floor: bigint; ceiling: bigint } {
  const floor = (faceValueMicro * BigInt(minCollarBps)) / 10000n;
  const hoursRemaining = (eventTimestampMs - nowMs) / (1000 * 60 * 60);
  // Last-24h anti-scalper clamp: ceiling drops to 100% Face Value (10000 bps)
  const effectiveMaxBps = hoursRemaining <= 24 ? 10000 : maxCollarBps;
  const ceiling = (faceValueMicro * BigInt(effectiveMaxBps)) / 10000n;
  return { floor, ceiling };
}

// Deterministic Dutch Auction Price-Decay Formula
export function calculateDutchPrice(
  startPrice: bigint,
  reservePrice: bigint,
  priceDropStep: bigint,
  stepIntervalMs: number,
  startTimeMs: number,
  nowMs: number = Date.now()
): bigint {
  if (nowMs <= startTimeMs) return startPrice;
  const elapsedSteps = BigInt(Math.floor((nowMs - startTimeMs) / stepIntervalMs));
  const totalDrop = elapsedSteps * priceDropStep;
  if (totalDrop >= startPrice - reservePrice) return reservePrice;
  return startPrice - totalDrop;
}

export const CreateOrderSchema = z.object({
  userId: z.string().min(1),
  marketId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET']),
  timeInForce: z.enum(['GTC', 'IOC']).default('GTC'),
  priceMicro: z.string().regex(/^\d+$/, 'Must be integer micro-units'),
  quantity: z.number().int().positive()
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export interface L2Level {
  priceMicro: string;
  quantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  marketId: string;
  seqId: number;
  bids: L2Level[];
  asks: L2Level[];
  collarFloorMicro: string;
  collarCeilingMicro: string;
  faceValueMicro: string;
  dutchPriceMicro: string;
}
