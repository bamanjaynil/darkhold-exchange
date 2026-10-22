import { z } from 'zod';

export const MICRO_UNIT = 1_000_000n;

export const toMicro = (amount: number): bigint =>
  BigInt(Math.round(amount * 1_000_000));

export const fromMicro = (micro: bigint | string | number): number =>
  Number(BigInt(micro)) / 1_000_000;

export function calculatePriceCollar(
  faceValueMicro: bigint,
  minCollarBps: number,
  maxCollarBps: number,
  eventTimestampMs: number,
  nowMs: number = Date.now()
): { floor: bigint; ceiling: bigint; isLast24hClamp: boolean } {
  const floor = (faceValueMicro * BigInt(minCollarBps)) / 10000n;
  const hoursRemaining = (eventTimestampMs - nowMs) / (1000 * 60 * 60);
  const isLast24hClamp = hoursRemaining <= 24;
  const effectiveMaxBps = isLast24hClamp ? 10000 : maxCollarBps;
  const ceiling = (faceValueMicro * BigInt(effectiveMaxBps)) / 10000n;
  return { floor, ceiling, isLast24hClamp };
}

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
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).default('GTC'),
  priceMicro: z.string().regex(/^\d+$/, 'Must be integer micro-units'),
  quantity: z.number().int().positive(),
  powNonce: z.string().optional(),
  simulateScalperBot: z.boolean().optional()
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export interface L2Level {
  priceMicro: string;
  quantity: number;
  cumulativeQuantity: number;
  orderCount: number;
}

export interface LiveTrade {
  id: string;
  priceMicro: string;
  quantity: number;
  side: 'BUY' | 'SELL';
  buyerId: string;
  sellerId: string;
  escrowStatus: 'LOCKED_PENDING_DELIVERY' | 'VERIFIED_RELEASED';
  ed25519Signature?: string;
  executedAt: string;
}

export interface LedgerJournalItem {
  id: string;
  transactionGroup: string;
  debitAccount: string;
  creditAccount: string;
  amountMicro: string;
  referenceType: string;
  createdAt: string;
}

export interface OpenOrderItem {
  id: string;
  userId: string;
  side: 'BUY' | 'SELL';
  priceMicro: string;
  remainingQty: number;
  initialQty: number;
}

export interface DutchAuctionState {
  auctionId: string;
  relicName: string;
  roundNumber: number;
  startPriceMicro: string;
  reservePriceMicro: string;
  currentPriceMicro: string;
  dropPerSecMicro: string;
  lastWinner?: { userId: string; priceMicro: string; clearedAt: string };
}

export interface OrderBookSnapshot {
  marketId: string;
  seqId: number;
  bids: L2Level[];
  asks: L2Level[];
  collarFloorMicro: string;
  collarCeilingMicro: string;
  faceValueMicro: string;
  dutchAuction: DutchAuctionState;
  recentTrades: LiveTrade[];
  recentLedger: LedgerJournalItem[];
  openOrders: OpenOrderItem[];
  wallet: {
    availableMicro: string;
    lockedMicro: string;
    escrowMicro: string;
    settledRevenueMicro: string;
  };
  ledgerInvariantBalanced: boolean;
  totalDebitsMicro: string;
  totalCreditsMicro: string;
  blockedBotAttempts: number;
}
