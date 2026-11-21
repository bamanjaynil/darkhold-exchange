/**
 * @file types.ts
 * Core domain types for the pure in-memory Limit Order Book matching engine.
 */

export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type OrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export type InstrumentConfig = {
  id: string;
  symbol: string;
  name: string;
  faceValue: number;       // Minor units (e.g. 150000 = 1,500.00 DKC)
  collarBps: number;       // e.g. 1000 = 10%
  tickSize: number;        // e.g. 100 = 1.00 DKC
  minQty: number;          // e.g. 1
  maxQtyPerOrder: number;  // e.g. 10
  escrowRequired: boolean;
  isBenchmark: boolean;
  imageUrl?: string;
};

export type OrderNode = {
  id: string;
  clientOrderId: string;
  seq: number;
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  tif: TimeInForce;
  price: number;           // Limit price, or 0 / effective ceiling for MARKET
  qty: number;             // Original quantity
  remainingQty: number;    // Unfilled quantity
  filledQty: number;
  status: OrderStatus;
  createdAtSeq: number;
  next: OrderNode | null;
  prev: OrderNode | null;
};

export type PriceLevel = {
  price: number;
  totalQty: number;
  orderCount: number;
  head: OrderNode | null;
  tail: OrderNode | null;
};

export type MatchedTrade = {
  id: string;
  seq: number;
  symbol: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  price: number;           // Executed price (resting order's price)
  qty: number;
  buyerRefund: number;     // Cash released if buyer reserved at higher limit price
  takerSide: Side;
};

export type EngineOrderCommand = {
  id: string;
  clientOrderId: string;
  seq: number;
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  tif: TimeInForce;
  price?: number;
  qty: number;
};

export type EngineResult = {
  success: boolean;
  orderId?: string;
  seq: number;
  status?: OrderStatus;
  trades: MatchedTrade[];
  restingOrder?: OrderNode;
  cancelledOrders: OrderNode[];
  filledOrders?: OrderNode[];
  rejectedReason?: string;
  isDuplicate?: boolean;
};