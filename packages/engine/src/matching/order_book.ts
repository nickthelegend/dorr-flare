import type { OrderCommitment, ZKProof } from "../common/types.js";
import { OrderSide } from "../common/types.js";
import { DEFAULT_ORDER_TTL_MS } from "../common/constants.js";

export interface OrderBookEntry {
  orderId: string;
  commitment: OrderCommitment;
  side: OrderSide;
  priceLevel: number;
  size: number;
  remainingSize: number;
  priorityTimestamp: number;
  proofs: {
    priceRangeProof: ZKProof;
    marginProof: ZKProof;
    timelockProof: ZKProof;
  };
}

export interface PriceLevelSummary {
  price: number;
  totalSize: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  pairId: string;
  bids: PriceLevelSummary[];
  asks: PriceLevelSummary[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  totalOrders: number;
  timestamp: number;
}

function insertBid(bids: OrderBookEntry[], entry: OrderBookEntry): void {
  let i = 0;
  while (
    i < bids.length &&
    (bids[i].priceLevel > entry.priceLevel ||
      (bids[i].priceLevel === entry.priceLevel &&
        bids[i].priorityTimestamp < entry.priorityTimestamp))
  ) {
    i++;
  }
  bids.splice(i, 0, entry);
}

function insertAsk(asks: OrderBookEntry[], entry: OrderBookEntry): void {
  let i = 0;
  while (
    i < asks.length &&
    (asks[i].priceLevel < entry.priceLevel ||
      (asks[i].priceLevel === entry.priceLevel &&
        asks[i].priorityTimestamp < entry.priorityTimestamp))
  ) {
    i++;
  }
  asks.splice(i, 0, entry);
}

function aggregateLevels(entries: OrderBookEntry[], levels: number): PriceLevelSummary[] {
  const map = new Map<number, { totalSize: number; orderCount: number }>();
  for (const e of entries) {
    const p = e.priceLevel;
    const cur = map.get(p) ?? { totalSize: 0, orderCount: 0 };
    cur.totalSize += e.remainingSize;
    cur.orderCount += 1;
    map.set(p, cur);
  }
  const out: PriceLevelSummary[] = [];
  for (const [price, v] of map) {
    out.push({ price, totalSize: v.totalSize, orderCount: v.orderCount });
  }
  return out.sort((a, b) => b.price - a.price).slice(0, levels);
}

function aggregateAsks(entries: OrderBookEntry[], levels: number): PriceLevelSummary[] {
  const map = new Map<number, { totalSize: number; orderCount: number }>();
  for (const e of entries) {
    const p = e.priceLevel;
    const cur = map.get(p) ?? { totalSize: 0, orderCount: 0 };
    cur.totalSize += e.remainingSize;
    cur.orderCount += 1;
    map.set(p, cur);
  }
  const out: PriceLevelSummary[] = [];
  for (const [price, v] of map) {
    out.push({ price, totalSize: v.totalSize, orderCount: v.orderCount });
  }
  return out.sort((a, b) => a.price - b.price).slice(0, levels);
}

export class PrivateOrderBook {
  private pairId: string;
  private bids: OrderBookEntry[] = [];
  private asks: OrderBookEntry[] = [];

  constructor(pairId: string) {
    this.pairId = pairId;
  }

  public addOrder(entry: OrderBookEntry): string {
    if (entry.side === OrderSide.SHORT) insertAsk(this.asks, entry);
    else insertBid(this.bids, entry);
    return entry.orderId;
  }

  public removeOrder(orderId: string): OrderBookEntry | null {
    for (let i = 0; i < this.bids.length; i++) {
      if (this.bids[i].orderId === orderId) {
        return this.bids.splice(i, 1)[0] ?? null;
      }
    }
    for (let i = 0; i < this.asks.length; i++) {
      if (this.asks[i].orderId === orderId) {
        return this.asks.splice(i, 1)[0] ?? null;
      }
    }
    return null;
  }

  public getBestBid(): OrderBookEntry | null {
    return this.bids[0] ?? null;
  }

  public getBestAsk(): OrderBookEntry | null {
    return this.asks[0] ?? null;
  }

  public getDepth(levels: number = 10): {
    bids: PriceLevelSummary[];
    asks: PriceLevelSummary[];
  } {
    return {
      bids: aggregateLevels(this.bids, levels),
      asks: aggregateAsks(this.asks, levels),
    };
  }

  public getSnapshot(depth: number = 20): OrderBookSnapshot {
    const bids = aggregateLevels(this.bids, depth);
    const asks = aggregateAsks(this.asks, depth);
    const bestBid = this.bids[0]?.priceLevel ?? null;
    const bestAsk = this.asks[0]?.priceLevel ?? null;
    const spread =
      bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    return {
      pairId: this.pairId,
      bids,
      asks,
      bestBid,
      bestAsk,
      spread,
      totalOrders: this.bids.length + this.asks.length,
      timestamp: Date.now(),
    };
  }

  public updateOrderFill(orderId: string, filledSize: number): OrderBookEntry | null {
    const sides: OrderBookEntry[][] = [this.bids, this.asks];
    for (const side of sides) {
      const idx = side.findIndex((e) => e.orderId === orderId);
      if (idx < 0) continue;
      const e = side[idx];
      e.remainingSize -= filledSize;
      if (e.remainingSize <= 0) {
        side.splice(idx, 1);
        return null;
      }
      return e;
    }
    return null;
  }

  public removeExpiredOrders(currentTimestamp: number): string[] {
    const removed: string[] = [];
    const keep = (e: OrderBookEntry) => {
      const ttl = DEFAULT_ORDER_TTL_MS;
      if (e.priorityTimestamp + ttl < currentTimestamp) {
        removed.push(e.orderId);
        return false;
      }
      return true;
    };
    this.bids = this.bids.filter(keep);
    this.asks = this.asks.filter(keep);
    return removed;
  }

  public getTotalOrderCount(): number {
    return this.bids.length + this.asks.length;
  }

  public clear(): void {
    this.bids = [];
    this.asks = [];
  }
}
