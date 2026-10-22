import { L2Level } from '@darkhold/shared';

export interface OrderNode {
  id: string;
  userId: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  timeInForce: 'GTC' | 'IOC';
  price: bigint;
  initialQty: number;
  remainingQty: number;
  lockedCash: bigint;
  timestamp: number;
  prev: OrderNode | null;
  next: OrderNode | null;
}

export interface MatchedTrade {
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  marketId: string;
  price: bigint;
  quantity: number;
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

  public processOrder(incoming: OrderNode): {
    trades: MatchedTrade[];
    cancelledQty: number;
    refundedCash: bigint;
  } {
    this.seqId++;
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
          // Self-Trade Prevention (Cancel resting order if same user)
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
            buyOrderId: incoming.id,
            sellOrderId: resting.id,
            buyerId: incoming.userId,
            sellerId: resting.userId,
            marketId: incoming.marketId,
            price: execPrice,
            quantity: matchQty,
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
      // SELL side matching against highest Bids first
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
            buyOrderId: resting.id,
            sellOrderId: incoming.id,
            buyerId: resting.userId,
            sellerId: incoming.userId,
            marketId: incoming.marketId,
            price: execPrice,
            quantity: matchQty,
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

  public getL2Depth(limit = 15): { bids: L2Level[]; asks: L2Level[] } {
    const bidPrices = [...this.bids.keys()].sort((a, b) => (a > b ? -1 : 1)).slice(0, limit);
    const askPrices = [...this.asks.keys()].sort((a, b) => (a < b ? -1 : 1)).slice(0, limit);

    return {
      bids: bidPrices.map((p) => {
        const lvl = this.bids.get(p)!;
        return { priceMicro: p.toString(), quantity: lvl.totalVolume, orderCount: lvl.orderCount };
      }),
      asks: askPrices.map((p) => {
        const lvl = this.asks.get(p)!;
        return { priceMicro: p.toString(), quantity: lvl.totalVolume, orderCount: lvl.orderCount };
      })
    };
  }
}
