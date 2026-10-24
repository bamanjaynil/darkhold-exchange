/**
 * @file ledger.ts
 * Double-Entry Accounting Ledger and In-Memory Reservation Manager.
 * Units: 'CASH' (minor units) or Instrument Symbol (e.g. 'FEST-GA').
 * Every journal sums to exactly 0 per unit.
 */

import { assertInteger, assertNonNegative } from '@darkhold/shared';

export type AccountKind = 'USER_AVAILABLE' | 'USER_RESERVED' | 'ESCROW' | 'ISSUER';

export type JournalKind =
  | 'GRANT'
  | 'RESERVE'
  | 'RELEASE'
  | 'TRADE_SETTLEMENT'
  | 'ESCROW_LOCK'
  | 'ESCROW_RELEASE'
  | 'ESCROW_REFUND'
  | 'AUCTION_PURCHASE';

export type JournalDelta = {
  id: string;
  kind: JournalKind;
  refType: string;
  refId: string;
  postings: PostingDelta[];
};

export type PostingDelta = {
  accountId: string;
  unit: string;
  amount: number; // Signed integer: positive = credit, negative = debit
  seq: number;
};

export type BalanceDelta = {
  userId: string;
  availableDelta: number;
  reservedDelta: number;
  escrowDelta: number;
};

export type HoldingDelta = {
  userId: string;
  symbol: string;
  availableDelta: number;
  reservedDelta: number;
  escrowDelta: number;
};

export class LedgerManager {
  private journalCounter: number = 1;
  private accountCache: Map<string, string> = new Map();

  public getAccount(kind: AccountKind, userId?: string, symbol?: string): string {
    const key = `${kind}:${userId}:${symbol}`;
    let acc = this.accountCache.get(key);
    if (!acc) {
      if (kind === 'ISSUER') {
        acc = symbol ? `acc_issuer_${symbol}` : 'acc_issuer_cash';
      } else {
        const target = symbol ? symbol : 'cash';
        const suffix = kind === 'USER_AVAILABLE' ? 'avail' : kind === 'USER_RESERVED' ? 'res' : 'esc';
        acc = `acc_${userId}_${target}_${suffix}`;
      }
      this.accountCache.set(key, acc);
    }
    return acc;
  }

  public assertJournalBalanced(journal: JournalDelta): void {
    const p = journal.postings;
    if (p.length === 2 && p[0]!.unit === p[1]!.unit) {
      if (p[0]!.amount + p[1]!.amount === 0) return;
    }
    const sumsByUnit = new Map<string, number>();
    for (const item of p) {
      assertInteger(item.amount, `posting.amount (${item.unit})`);
      const current = sumsByUnit.get(item.unit) ?? 0;
      sumsByUnit.set(item.unit, current + item.amount);
    }

    for (const [unit, total] of sumsByUnit.entries()) {
      if (total !== 0) {
        throw new Error(
          `[LEDGER_IMBALANCE] Journal ${journal.id} does not balance for unit ${unit}. Sum = ${total}`
        );
      }
    }
  }

  /**
   * Cash Reservation for BUY order: available -> reserved
   */
  public reserveCash(
    userId: string,
    amount: number,
    orderId: string,
    seq: number
  ): { journal: JournalDelta; balanceDelta: BalanceDelta } {
    assertInteger(amount, 'reserveCash.amount');
    const jId = `j_res_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'RESERVE',
      refType: 'ORDER',
      refId: orderId,
      postings: [
        { accountId: this.getAccount('USER_AVAILABLE', userId), unit: 'CASH', amount: -amount, seq },
        { accountId: this.getAccount('USER_RESERVED', userId), unit: 'CASH', amount, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      balanceDelta: {
        userId,
        availableDelta: -amount,
        reservedDelta: amount,
        escrowDelta: 0,
      },
    };
  }

  /**
   * Cash Release on Cancel, Expiry, or Price Improvement: reserved -> available
   */
  public releaseCash(
    userId: string,
    amount: number,
    refType: string,
    refId: string,
    seq: number
  ): { journal: JournalDelta; balanceDelta: BalanceDelta } {
    assertInteger(amount, 'releaseCash.amount');
    const jId = `j_rel_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'RELEASE',
      refType,
      refId,
      postings: [
        { accountId: this.getAccount('USER_RESERVED', userId), unit: 'CASH', amount: -amount, seq },
        { accountId: this.getAccount('USER_AVAILABLE', userId), unit: 'CASH', amount, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      balanceDelta: {
        userId,
        availableDelta: amount,
        reservedDelta: -amount,
        escrowDelta: 0,
      },
    };
  }

  /**
   * Asset Reservation for SELL order: available -> reserved
   */
  public reserveAsset(
    userId: string,
    symbol: string,
    qty: number,
    orderId: string,
    seq: number
  ): { journal: JournalDelta; holdingDelta: HoldingDelta } {
    assertInteger(qty, 'reserveAsset.qty');
    const jId = `j_res_ast_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'RESERVE',
      refType: 'ORDER',
      refId: orderId,
      postings: [
        { accountId: this.getAccount('USER_AVAILABLE', userId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_RESERVED', userId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      holdingDelta: {
        userId,
        symbol,
        availableDelta: -qty,
        reservedDelta: qty,
        escrowDelta: 0,
      },
    };
  }

  /**
   * Asset Release on Cancel or Expiry: reserved -> available
   */
  public releaseAsset(
    userId: string,
    symbol: string,
    qty: number,
    refType: string,
    refId: string,
    seq: number
  ): { journal: JournalDelta; holdingDelta: HoldingDelta } {
    assertInteger(qty, 'releaseAsset.qty');
    const jId = `j_rel_ast_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'RELEASE',
      refType,
      refId,
      postings: [
        { accountId: this.getAccount('USER_RESERVED', userId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_AVAILABLE', userId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      holdingDelta: {
        userId,
        symbol,
        availableDelta: qty,
        reservedDelta: -qty,
        escrowDelta: 0,
      },
    };
  }

  /**
   * Direct Instant Trade Settlement (non-escrow instruments).
   * Buyer reserved cash -> Seller available cash.
   * Seller reserved units -> Buyer available units.
   */
  public settleDirectTrade(
    buyerId: string,
    sellerId: string,
    symbol: string,
    execPrice: number,
    qty: number,
    tradeId: string,
    seq: number
  ): {
    journal: JournalDelta;
    buyerBalanceDelta: BalanceDelta;
    sellerBalanceDelta: BalanceDelta;
    buyerHoldingDelta: HoldingDelta;
    sellerHoldingDelta: HoldingDelta;
  } {
    const cashTotal = execPrice * qty;
    const jId = `j_trade_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'TRADE_SETTLEMENT',
      refType: 'TRADE',
      refId: tradeId,
      postings: [
        // Cash leg: Buyer reserved -> Seller available (sums to 0)
        { accountId: this.getAccount('USER_RESERVED', buyerId), unit: 'CASH', amount: -cashTotal, seq },
        { accountId: this.getAccount('USER_AVAILABLE', sellerId), unit: 'CASH', amount: cashTotal, seq },
        // Asset leg: Seller reserved -> Buyer available (sums to 0)
        { accountId: this.getAccount('USER_RESERVED', sellerId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_AVAILABLE', buyerId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      buyerBalanceDelta: { userId: buyerId, availableDelta: 0, reservedDelta: -cashTotal, escrowDelta: 0 },
      sellerBalanceDelta: { userId: sellerId, availableDelta: cashTotal, reservedDelta: 0, escrowDelta: 0 },
      buyerHoldingDelta: { userId: buyerId, symbol, availableDelta: qty, reservedDelta: 0, escrowDelta: 0 },
      sellerHoldingDelta: { userId: sellerId, symbol, availableDelta: 0, reservedDelta: -qty, escrowDelta: 0 },
    };
  }

  /**
   * Escrow Trade Settlement (escrow-required instruments).
   * Buyer reserved cash -> Buyer escrow cash.
   * Seller reserved units -> Seller escrow units.
   */
  public settleEscrowLock(
    buyerId: string,
    sellerId: string,
    symbol: string,
    amount: number,
    qty: number,
    escrowId: string,
    seq: number
  ): {
    journal: JournalDelta;
    buyerBalanceDelta: BalanceDelta;
    sellerHoldingDelta: HoldingDelta;
  } {
    const jId = `j_esc_lock_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'ESCROW_LOCK',
      refType: 'ESCROW',
      refId: escrowId,
      postings: [
        { accountId: this.getAccount('USER_RESERVED', buyerId), unit: 'CASH', amount: -amount, seq },
        { accountId: this.getAccount('ESCROW', buyerId), unit: 'CASH', amount, seq },
        { accountId: this.getAccount('USER_RESERVED', sellerId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('ESCROW', sellerId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      buyerBalanceDelta: { userId: buyerId, availableDelta: 0, reservedDelta: -amount, escrowDelta: amount },
      sellerHoldingDelta: { userId: sellerId, symbol, availableDelta: 0, reservedDelta: -qty, escrowDelta: qty },
    };
  }

  /**
   * Escrow Delivery Release: Buyer escrow cash -> Seller available cash.
   * Seller escrow units -> Buyer available units.
   */
  public releaseEscrow(
    buyerId: string,
    sellerId: string,
    symbol: string,
    amount: number,
    qty: number,
    escrowId: string,
    seq: number
  ): {
    journal: JournalDelta;
    buyerBalanceDelta: BalanceDelta;
    sellerBalanceDelta: BalanceDelta;
    buyerHoldingDelta: HoldingDelta;
    sellerHoldingDelta: HoldingDelta;
  } {
    const jId = `j_esc_rel_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'ESCROW_RELEASE',
      refType: 'ESCROW',
      refId: escrowId,
      postings: [
        { accountId: this.getAccount('ESCROW', buyerId), unit: 'CASH', amount: -amount, seq },
        { accountId: this.getAccount('USER_AVAILABLE', sellerId), unit: 'CASH', amount, seq },
        { accountId: this.getAccount('ESCROW', sellerId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_AVAILABLE', buyerId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      buyerBalanceDelta: { userId: buyerId, availableDelta: 0, reservedDelta: 0, escrowDelta: -amount },
      sellerBalanceDelta: { userId: sellerId, availableDelta: amount, reservedDelta: 0, escrowDelta: 0 },
      buyerHoldingDelta: { userId: buyerId, symbol, availableDelta: qty, reservedDelta: 0, escrowDelta: 0 },
      sellerHoldingDelta: { userId: sellerId, symbol, availableDelta: 0, reservedDelta: 0, escrowDelta: -qty },
    };
  }

  /**
   * Escrow Timeout Refund: Buyer escrow cash -> Buyer available cash.
   * Seller escrow units -> Seller available units.
   */
  public refundEscrow(
    buyerId: string,
    sellerId: string,
    symbol: string,
    amount: number,
    qty: number,
    escrowId: string,
    seq: number
  ): {
    journal: JournalDelta;
    buyerBalanceDelta: BalanceDelta;
    sellerHoldingDelta: HoldingDelta;
  } {
    const jId = `j_esc_ref_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'ESCROW_REFUND',
      refType: 'ESCROW',
      refId: escrowId,
      postings: [
        { accountId: this.getAccount('ESCROW', buyerId), unit: 'CASH', amount: -amount, seq },
        { accountId: this.getAccount('USER_AVAILABLE', buyerId), unit: 'CASH', amount, seq },
        { accountId: this.getAccount('ESCROW', sellerId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_AVAILABLE', sellerId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      buyerBalanceDelta: { userId: buyerId, availableDelta: amount, reservedDelta: 0, escrowDelta: -amount },
      sellerHoldingDelta: { userId: sellerId, symbol, availableDelta: qty, reservedDelta: 0, escrowDelta: -qty },
    };
  }

  /**
   * Dutch Auction Purchase: Buyer available cash -> Seller available cash.
   * Seller reserved units -> Buyer available units.
   */
  public settleAuctionPurchase(
    buyerId: string,
    sellerId: string,
    symbol: string,
    execPrice: number,
    qty: number,
    auctionId: string,
    seq: number
  ): {
    journal: JournalDelta;
    buyerBalanceDelta: BalanceDelta;
    sellerBalanceDelta: BalanceDelta;
    buyerHoldingDelta: HoldingDelta;
    sellerHoldingDelta: HoldingDelta;
  } {
    const cashTotal = execPrice * qty;
    const jId = `j_auc_buy_${seq}_${this.journalCounter++}`;

    const journal: JournalDelta = {
      id: jId,
      kind: 'AUCTION_PURCHASE',
      refType: 'AUCTION',
      refId: auctionId,
      postings: [
        { accountId: this.getAccount('USER_AVAILABLE', buyerId), unit: 'CASH', amount: -cashTotal, seq },
        { accountId: this.getAccount('USER_AVAILABLE', sellerId), unit: 'CASH', amount: cashTotal, seq },
        { accountId: this.getAccount('USER_RESERVED', sellerId, symbol), unit: symbol, amount: -qty, seq },
        { accountId: this.getAccount('USER_AVAILABLE', buyerId, symbol), unit: symbol, amount: qty, seq },
      ],
    };

    this.assertJournalBalanced(journal);

    return {
      journal,
      buyerBalanceDelta: { userId: buyerId, availableDelta: -cashTotal, reservedDelta: 0, escrowDelta: 0 },
      sellerBalanceDelta: { userId: sellerId, availableDelta: cashTotal, reservedDelta: 0, escrowDelta: 0 },
      buyerHoldingDelta: { userId: buyerId, symbol, availableDelta: qty, reservedDelta: 0, escrowDelta: 0 },
      sellerHoldingDelta: { userId: sellerId, symbol, availableDelta: 0, reservedDelta: -qty, escrowDelta: 0 },
    };
  }
}