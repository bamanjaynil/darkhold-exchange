/**
 * @file schemas.ts
 * Authoritative Zod schemas for Darkhold Exchange requests and domain entities.
 */

import { z } from 'zod';

export const SideSchema = z.enum(['BUY', 'SELL']);
export const OrderTypeSchema = z.enum(['LIMIT', 'MARKET']);
export const TimeInForceSchema = z.enum(['GTC', 'IOC', 'FOK']);

export const SubmitOrderSchema = z.object({
  clientOrderId: z.string().min(1).max(64),
  symbol: z.string().min(1).max(32),
  side: SideSchema,
  type: OrderTypeSchema,
  tif: TimeInForceSchema,
  price: z.number().int().positive().optional(),
  qty: z.number().int().positive(),
  pow: z
    .object({
      challengeId: z.string(),
      nonce: z.string(),
    })
    .optional(),
}).refine(
  (data) => {
    // MARKET + GTC is strictly unsupported
    if (data.type === 'MARKET' && data.tif === 'GTC') {
      return false;
    }
    // LIMIT orders require positive price
    if (data.type === 'LIMIT' && (!data.price || data.price <= 0)) {
      return false;
    }
    return true;
  },
  {
    message: 'Invalid order combination. LIMIT requires price; MARKET+GTC is unsupported.',
    path: ['type'],
  }
);

export type SubmitOrderInput = z.infer<typeof SubmitOrderSchema>;

export const CancelOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1).max(32),
});

export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

export const CreateAuctionSchema = z.object({
  symbol: z.string().min(1).max(32),
  qty: z.number().int().positive(),
  startPrice: z.number().int().positive(),
  floorPrice: z.number().int().positive(),
  stepAmount: z.number().int().positive().optional(),
  stepIntervalMs: z.number().int().min(100).optional(),
  durationSec: z.number().int().min(1).max(86400).optional(),
}).refine((data) => data.floorPrice <= data.startPrice, {
  message: 'Floor price cannot exceed start price',
  path: ['floorPrice'],
});

export type CreateAuctionInput = z.infer<typeof CreateAuctionSchema>;

export const BuyAuctionSchema = z.object({
  auctionId: z.string().min(1),
  qty: z.number().int().positive(),
  maxPrice: z.number().int().positive(),
});

export type BuyAuctionInput = z.infer<typeof BuyAuctionSchema>;

export const DeliverEscrowSchema = z.object({
  escrowId: z.string().min(1),
  receipt: z.string().min(1),
});

export type DeliverEscrowInput = z.infer<typeof DeliverEscrowSchema>;

export const MockIssuerReceiptRequestSchema = z.object({
  escrowId: z.string().min(1),
});

export type MockIssuerReceiptRequestInput = z.infer<typeof MockIssuerReceiptRequestSchema>;

export const RegisterUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username must contain only alphanumeric characters, underscores or hyphens'),
  password: z.string().min(10, 'Password must be at least 10 characters long'),
});

export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

export const LoginUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginUserInput = z.infer<typeof LoginUserSchema>;

export const ScalperDemoSchema = z.object({
  burstCount: z.number().int().min(5).max(500).default(50),
});

export type ScalperDemoInput = z.infer<typeof ScalperDemoSchema>;