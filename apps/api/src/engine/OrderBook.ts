import { L2Level, OpenOrderItem } from '@darkhold/shared';

export interface OrderNode {
  id: string;
  userId: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  price: bigint;
  initialQty: number;
  remainingQty: number;
  lockedCash: bigint;
  timestamp: number;
  prev: OrderNode | null;
  next: OrderNode | null;
}

export interface MatchedTrade {
  id: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  marketId: string;
  price: bigint;
  quantity: number;
  aggressorSide: 'BUY' | 'SELL';
  buyerRefund: bigint;
}

class PriceLevel {
  head: OrderNode | null = null;
  tail: OrderNode | null = null;
  totalVolume = 0;
  orderCount = 0;

  constructor(public readonly price: bigint) {}

  append(node: OrderNode) {
    node.prev = this.tail;
    node.next = null;
    if (this.tail) this.tail.next = node;
    else this.head = node;
    this.tail = node;
    this.totalVolume += node.remainingQty;
    this.orderCount++;
  }

  remove(node: OrderNode) {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
    this.totalVolume -= node.remainingQty;
    this.orderCount--;
  }
}

export class LimitOrderBook {
  private bids = new Map<bigint, PriceLevel>();
  private asks = new Map<bigint, PriceLevel>();
  private orderMap = new Map<string, OrderNode>();
  public seqId = 1;

  // Pre-check available liquidity for Fill-Or-Kill (FOK) orders
  private canFillCompletely(incoming: OrderNode): boolean {
    let needed = incoming.remainingQty;
    if (incoming.side === 'BUY') {
      const sortedAskPrices = [...this.asks.keys()].sort((a, b) => (a < b ? -1 : 1));
      for (const askPrice of sortedAskPrices) {
        if (incoming.type === 'LIMIT' && incoming.price < askPrice) break;
        const level = this.asks.get(askPrice)!;
        let cur = level.head;
        while (cur) {
          if (cur.userId !== incoming.userId) needed -= cur.remainingQty;
          if (needed <= 0) return true;
          cur = cur.next;
        }
      }
    } else {
      const sortedBidPrices = [...this.bids.keys()].sort((a, b) => (a > b ? -1 : 1));
      for (const bidPrice of sortedBidPrices) {
        if (incoming.type === 'LIMIT' && incoming.price > bidPrice) break;
        const level = this.bids.get(bidPrice)!;
        let cur = level.head;
        while (cur) {
          if (cur.userId !== incoming.userId) needed -= cur.remainingQty;
          if (needed <= 0) return true;
          cur = cur.next;
        }
      }
    }
    return needed <= 0;
  }

  public cancelOrder(orderId: string): OrderNode | null {
    const node = this.orderMap.get(orderId);
    if (!node) return null;
    const bookSide = node.side === 'BUY' ? this.bids : this.asks;
    const level = bookSide.get(node.price);
    if (level) {
      level.remove(node);
      if (level.orderCount === 0) bookSide.delete(node.price);
    }
    this.orderMap.delete(orderId);
    this.seqId++;
    return node;
  }

  public processOrder(incoming: OrderNode): {
    trades: MatchedTrade[];
    cancelledQty: number;
    refundedCash: bigint;
  } {
    this.seqId++;
    if (incoming.timeInForce === 'FOK' && !this.canFillCompletely(incoming)) {
      const cancelledQty = incoming.remainingQty;
      const refundedCash = incoming.lockedCash;
      incoming.remainingQty = 0;
      incoming.lockedCash = 0n;
      return { trades: [], cancelledQty, refundedCash };
    }

    const trades: MatchedTrade[] = [];

    if (incoming.side === 'BUY') {
      const sortedAskPrices = [...this.asks.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const askPrice of sortedAskPrices) {
        if (incoming.remainingQty <= 0) break;
        if (incoming.type === 'LIMIT' && incoming.price < askPrice) break;

        const level = this.asks.get(askPrice)!;
        let resting = level.head;

        while (resting && incoming.remainingQty > 0) {
          const nextResting = resting.next;
          if (resting.userId === incoming.userId) {
            level.remove(resting);
            this.orderMap.delete(resting.id);
            resting = nextResting;
            continue;
          }

          const matchQty = Math.min(incoming.remainingQty, resting.remainingQty);
          const execPrice = resting.price;
          const buyerRefund = (incoming.price - execPrice) * BigInt(matchQty);

          incoming.remainingQty -= matchQty;
          incoming.lockedCash -= incoming.price * BigInt(matchQty);
          resting.remainingQty -= matchQty;
          level.totalVolume -= matchQty;

          trades.push({
            id: `trd_${this.seqId}_${trades.length}`,
            buyOrderId: incoming.id,
            sellOrderId: resting.id,
            buyerId: incoming.userId,
            sellerId: resting.userId,
            marketId: incoming.marketId,
            price: execPrice,
            quantity: matchQty,
            aggressorSide: 'BUY',
            buyerRefund: buyerRefund > 0n ? buyerRefund : 0n
          });

          if (resting.remainingQty === 0) {
            level.remove(resting);
            this.orderMap.delete(resting.id);
          }
          resting = nextResting;
        }
        if (level.orderCount === 0) this.asks.delete(askPrice);
      }

      if (incoming.remainingQty > 0 && incoming.type === 'LIMIT' && incoming.timeInForce === 'GTC') {
        let level = this.bids.get(incoming.price);
        if (!level) {
          level = new PriceLevel(incoming.price);
          this.bids.set(incoming.price, level);
        }
        level.append(incoming);
        this.orderMap.set(incoming.id, incoming);
        return { trades, cancelledQty: 0, refundedCash: 0n };
      } else {
        const cancelledQty = incoming.remainingQty;
        const refundedCash = incoming.lockedCash;
        incoming.remainingQty = 0;
        incoming.lockedCash = 0n;
        return { trades, cancelledQty, refundedCash };
      }
    } else {
      const sortedBidPrices = [...this.bids.keys()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
      for (const bidPrice of sortedBidPrices) {
        if (incoming.remainingQty <= 0) break;
        if (incoming.type === 'LIMIT' && incoming.price > bidPrice) break;

        const level = this.bids.get(bidPrice)!;
        let resting = level.head;

        while (resting && incoming.remainingQty > 0) {
          const nextResting = resting.next;
          if (resting.userId === incoming.userId) {
            level.remove(resting);
            this.orderMap.delete(resting.id);
            resting = nextResting;
            continue;
          }

          const matchQty = Math.min(incoming.remainingQty, resting.remainingQty);
          const execPrice = resting.price;

          incoming.remainingQty -= matchQty;
          resting.remainingQty -= matchQty;
          resting.lockedCash -= execPrice * BigInt(matchQty);
          level.totalVolume -= matchQty;

          trades.push({
            id: `trd_${this.seqId}_${trades.length}`,
            buyOrderId: resting.id,
            sellOrderId: incoming.id,
            buyerId: resting.userId,
            sellerId: incoming.userId,
            marketId: incoming.marketId,
            price: execPrice,
            quantity: matchQty,
            aggressorSide: 'SELL',
            buyerRefund: 0n
          });

          if (resting.remainingQty === 0) {
            level.remove(resting);
            this.orderMap.delete(resting.id);
          }
          resting = nextResting;
        }
        if (level.orderCount === 0) this.bids.delete(bidPrice);
      }

      if (incoming.remainingQty > 0 && incoming.type === 'LIMIT' && incoming.timeInForce === 'GTC') {
        let level = this.asks.get(incoming.price);
        if (!level) {
          level = new PriceLevel(incoming.price);
          this.asks.set(incoming.price, level);
        }
        level.append(incoming);
        this.orderMap.set(incoming.id, incoming);
        return { trades, cancelledQty: 0, refundedCash: 0n };
      } else {
        const cancelledQty = incoming.remainingQty;
        incoming.remainingQty = 0;
        return { trades, cancelledQty, refundedCash: 0n };
      }
    }
  }

  public getL2Depth(limit = 12): { bids: L2Level[]; asks: L2Level[] } {
    const bidPrices = [...this.bids.keys()].sort((a, b) => (a > b ? -1 : 1)).slice(0, limit);
    const askPrices = [...this.asks.keys()].sort((a, b) => (a < b ? -1 : 1)).slice(0, limit);

    let cumBid = 0;
    const bids = bidPrices.map((p) => {
      const lvl = this.bids.get(p)!;
      cumBid += lvl.totalVolume;
      return {
        priceMicro: p.toString(),
        quantity: lvl.totalVolume,
        cumulativeQuantity: cumBid,
        orderCount: lvl.orderCount
      };
    });

    let cumAsk = 0;
    const asks = askPrices.map((p) => {
      const lvl = this.asks.get(p)!;
      cumAsk += lvl.totalVolume;
      return {
        priceMicro: p.toString(),
        quantity: lvl.totalVolume,
        cumulativeQuantity: cumAsk,
        orderCount: lvl.orderCount
      };
    });

    return { bids, asks };
  }

  public getOpenOrders(limit = 8): OpenOrderItem[] {
    const items: OpenOrderItem[] = [];
    for (const node of this.orderMap.values()) {
      items.push({
        id: node.id,
        userId: node.userId,
        side: node.side,
        priceMicro: node.price.toString(),
        remainingQty: node.remainingQty,
        initialQty: node.initialQty
      });
      if (items.length >= limit) break;
    }
    return items;
  }
}
