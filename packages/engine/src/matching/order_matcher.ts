import { randomUUID } from "node:crypto";
import type { OrderCommitment, ZKProof } from "../common/types.js";
import { OrderSide } from "../common/types.js";
import type { OrderBookEntry } from "./order_book.js";
import { PrivateOrderBook } from "./order_book.js";
import { validateOrderSubmission } from "./order_validator.js";
import {
  minimalVerifiedProof,
  orderSideFromProofs,
  priceLevelFromProofs,
  sizeFromProofs,
} from "../common/utils.js";

export interface OrderMatch {
  matchId: string;
  buyOrderCommitment: OrderCommitment;
  sellOrderCommitment: OrderCommitment;
  executionPrice: number;
  executionSize: number;
  matchingProof: ZKProof;
  matchedAt: number;
}

export interface MatchingEngineConfig {
  matchingIntervalMs: number;
  maxOrdersPerRound: number;
  requireTimelockProofs: boolean;
  minOrderSize: number;
  maxSpread: number;
}

export interface MatchingStats {
  totalOrdersProcessed: number;
  totalMatchesMade: number;
  totalOrdersCancelled: number;
  totalOrdersExpired: number;
  averageMatchTimeMs: number;
  openOrderCount: number;
  uptimeMs: number;
}

export class OrderMatcher {
  private config: MatchingEngineConfig;
  private isRunning = false;
  private readonly books = new Map<string, PrivateOrderBook>();
  private readonly activeCommitments = new Set<string>();
  private startMs = 0;
  private totalOrders = 0;
  private totalMatches = 0;
  private totalCancelled = 0;
  private totalExpired = 0;
  private sumMatchLatencyMs = 0;

  constructor(config: MatchingEngineConfig) {
    this.config = config;
  }

  private book(pairId: string): PrivateOrderBook {
    let b = this.books.get(pairId);
    if (!b) {
      b = new PrivateOrderBook(pairId);
      this.books.set(pairId, b);
    }
    return b;
  }

  public async initialize(): Promise<void> {
    this.startMs = Date.now();
    this.isRunning = true;
  }

  public async submitOrder(
    commitment: OrderCommitment,
    proofs: {
      priceRangeProof: ZKProof;
      marginProof: ZKProof;
      timelockProof: ZKProof;
    },
    pairId: string,
  ): Promise<string> {
    if (!this.isRunning) throw new Error("OrderMatcher is not running");
    if (
      this.config.requireTimelockProofs &&
      proofs.timelockProof.publicInputs.length === 0
    ) {
      throw new Error("Timelock proof public inputs required");
    }

    const v = await validateOrderSubmission(
      commitment,
      proofs,
      pairId,
      this.activeCommitments,
    );
    if (!v.isValid) {
      throw new Error(v.errors.map((e) => e.message).join("; "));
    }

    const side = orderSideFromProofs(proofs);
    const priceLevel = priceLevelFromProofs(proofs);
    const size = Math.max(this.config.minOrderSize, sizeFromProofs(proofs));
    const orderId = randomUUID();
    const entry: OrderBookEntry = {
      orderId,
      commitment,
      side,
      priceLevel,
      size,
      remainingSize: size,
      priorityTimestamp: commitment.committedAt,
      proofs,
    };

    this.book(pairId).addOrder(entry);
    this.activeCommitments.add(commitment.commitmentHash);
    this.totalOrders++;
    return orderId;
  }

  public async matchOrders(pairId: string): Promise<OrderMatch[]> {
    if (!this.isRunning) throw new Error("OrderMatcher is not running");
    const book = this.book(pairId);
    this.totalExpired += book.removeExpiredOrders(Date.now()).length;
    const matches: OrderMatch[] = [];
    let rounds = 0;
    while (rounds < this.config.maxOrdersPerRound) {
      rounds++;
      const bid = book.getBestBid();
      const ask = book.getBestAsk();
      if (!bid || !ask) break;
      if (bid.priceLevel < ask.priceLevel) break;
      const executionPrice = (bid.priceLevel + ask.priceLevel) / 2;
      const executionSize = Math.min(bid.remainingSize, ask.remainingSize);
      const matchId = randomUUID();
      const buyEntry = bid.side === OrderSide.LONG ? bid : ask;
      const sellEntry = buyEntry === bid ? ask : bid;
      const matchedAt = Date.now();
      const matchingProof = minimalVerifiedProof("matching-v1", [
        matchId,
        String(executionPrice),
        String(executionSize),
      ]);
      matches.push({
        matchId,
        buyOrderCommitment: buyEntry.commitment,
        sellOrderCommitment: sellEntry.commitment,
        executionPrice,
        executionSize,
        matchingProof,
        matchedAt,
      });
      book.updateOrderFill(bid.orderId, executionSize);
      book.updateOrderFill(ask.orderId, executionSize);
      this.sumMatchLatencyMs += matchedAt - Math.min(
        bid.priorityTimestamp,
        ask.priorityTimestamp,
      );
      this.totalMatches++;
    }
    return matches;
  }

  public async cancelOrder(orderId: string, cancellationProof: ZKProof): Promise<boolean> {
    if (!cancellationProof.isVerified) return false;
    for (const [pairId, ob] of this.books) {
      const removed = ob.removeOrder(orderId);
      if (removed) {
        this.activeCommitments.delete(removed.commitment.commitmentHash);
        this.totalCancelled++;
        void pairId;
        return true;
      }
    }
    return false;
  }

  public async getOrderBook(
    pairId: string,
    depth: number = 10,
  ): Promise<{
    bids: Array<{ priceLevel: number; totalSize: number; orderCount: number }>;
    asks: Array<{ priceLevel: number; totalSize: number; orderCount: number }>;
  }> {
    const d = this.book(pairId).getDepth(depth);
    return {
      bids: d.bids.map((x) => ({
        priceLevel: x.price,
        totalSize: x.totalSize,
        orderCount: x.orderCount,
      })),
      asks: d.asks.map((x) => ({
        priceLevel: x.price,
        totalSize: x.totalSize,
        orderCount: x.orderCount,
      })),
    };
  }

  public getStats(): MatchingStats {
    let open = 0;
    for (const b of this.books.values()) open += b.getTotalOrderCount();
    return {
      totalOrdersProcessed: this.totalOrders,
      totalMatchesMade: this.totalMatches,
      totalOrdersCancelled: this.totalCancelled,
      totalOrdersExpired: this.totalExpired,
      averageMatchTimeMs:
        this.totalMatches > 0 ? this.sumMatchLatencyMs / this.totalMatches : 0,
      openOrderCount: open,
      uptimeMs: this.startMs ? Date.now() - this.startMs : 0,
    };
  }

  public async shutdown(): Promise<void> {
    for (const b of this.books.values()) b.clear();
    this.books.clear();
    this.activeCommitments.clear();
    this.isRunning = false;
  }
}
