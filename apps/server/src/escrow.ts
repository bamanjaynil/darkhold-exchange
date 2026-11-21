/**
 * @file escrow.ts
 * Cryptographic Escrow Custodian and Mock Issuer Receipt Verifier.
 * Receipt = HMAC-SHA256(ESCROW_SECRET, `${escrowId}:${buyerId}:${sellerId}:${symbol}`)
 */

import crypto from 'node:crypto';
import { config } from './config.js';

export function generateMockIssuerReceipt(
  escrowId: string,
  buyerUserId: string,
  sellerUserId: string,
  symbol: string,
  secret: string = config.ESCROW_SECRET
): string {
  const payload = `${escrowId}:${buyerUserId}:${sellerUserId}:${symbol}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyEscrowReceipt(
  receipt: string,
  escrowId: string,
  buyerUserId: string,
  sellerUserId: string,
  symbol: string,
  secret: string = config.ESCROW_SECRET
): boolean {
  const expected = generateMockIssuerReceipt(escrowId, buyerUserId, sellerUserId, symbol, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(receipt, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}