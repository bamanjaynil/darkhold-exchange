/**
 * @file payout.ts
 * Payout provider abstraction for DKC -> UPI off-ramp.
 */

import crypto from 'node:crypto';

export interface PayoutRequest {
  withdrawalId: string;
  userId: string;
  amountINR: number;
  amountDKC: number;
  upiId: string;
  reference: string;
  simulateFailure?: boolean;
}

export interface PayoutResult {
  success: boolean;
  providerRef?: string;
  error?: string;
}

export interface PayoutProvider {
  executePayout(req: PayoutRequest): Promise<PayoutResult>;
}

export class SimulatedPayoutProvider implements PayoutProvider {
  async executePayout(req: PayoutRequest): Promise<PayoutResult> {
    const upi = req.upiId.toLowerCase().trim();
    // Deterministic: ONLY simulate payout failure if simulateFailure is explicitly set,
    // or if the UPI VPA explicitly contains 'fail' or 'reject' (e.g. fail@upi or failed@okaxis).
    // ALL normal UPI IDs (e.g. alice@okaxis, bob@ybl, jaynil@sbi, user@paytm) succeed 100% of the time!
    if (
      req.simulateFailure ||
      upi.includes('fail') ||
      upi.includes('reject')
    ) {
      return {
        success: false,
        error: 'NPCI_BENEFICIARY_BANK_OFFLINE',
      };
    }

    return {
      success: true,
      providerRef: `PO_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    };
  }
}

export const defaultPayoutProvider: PayoutProvider = new SimulatedPayoutProvider();
