/**
 * @file protocol.ts
 * Type definitions for Darkhold Exchange WebSocket real-time protocol.
 * Versioned protocol: { v: 1, ... }
 */

export const PROTOCOL_VERSION = 1;

export type WsClientMessage =
  | { v: 1; type: 'subscribe'; channel: string }
  | { v: 1; type: 'unsubscribe'; channel: string }
  | { v: 1; type: 'ping' };

export type BookLevel = {
  price: number;
  qty: number;
  orders: number;
  total: number;
};

export type L2BookSnapshot = {
  symbol: string;
  seq: number;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  timestamp: number;
};

export type L2BookDelta = {
  symbol: string;
  seq: number;
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  timestamp: number;
};

export type TradeEvent = {
  id: string;
  symbol: string;
  price: number;
  qty: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  isSimulated: boolean;
};

export type MarketStats = {
  symbol: string;
  lastPrice: number | null;
  tradesCount: number;
  volume24h: number;
  highPrice: number | null;
  lowPrice: number | null;
  spread: number | null;
};

export type AuctionTickEvent = {
  auctionId: string;
  symbol: string;
  currentPrice: number;
  qtyRemaining: number;
  status: 'SCHEDULED' | 'ACTIVE' | 'SOLD_OUT' | 'EXPIRED' | 'CANCELLED';
  elapsedMs: number;
};

export type UserPrivateEvent =
  | {
      type: 'order_update';
      order: {
        id: string;
        clientOrderId: string;
        symbol: string;
        side: 'BUY' | 'SELL';
        type: 'LIMIT' | 'MARKET';
        price?: number;
        qty: number;
        remainingQty: number;
        status: string;
      };
    }
  | {
      type: 'trade_fill';
      trade: {
        id: string;
        orderId: string;
        symbol: string;
        price: number;
        qty: number;
        side: 'BUY' | 'SELL';
        buyerRefund?: number;
      };
    }
  | {
      type: 'balance_update';
      balance: {
        available: number;
        reserved: number;
        escrow: number;
        total: number;
      };
    }
  | {
      type: 'holding_update';
      holding: {
        symbol: string;
        available: number;
        reserved: number;
        escrow: number;
        total: number;
      };
    }
  | {
      type: 'escrow_update';
      escrow: {
        id: string;
        symbol: string;
        role: 'BUYER' | 'SELLER';
        qty: number;
        amount: number;
        status: string;
      };
    };

export type WsServerMessage =
  | { v: 1; type: 'snapshot'; channel: string; seq: number; data: unknown }
  | { v: 1; type: 'delta'; channel: string; seq: number; data: unknown }
  | { v: 1; type: 'pong' }
  | { v: 1; type: 'error'; code: string; message: string; channel?: string };