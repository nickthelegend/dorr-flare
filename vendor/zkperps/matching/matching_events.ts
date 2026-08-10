import type { OrderCommitment, ZKProof } from "../common/types.js";

export enum MatchingEventType {
  ORDER_SUBMITTED = "ORDER_SUBMITTED",
  ORDER_MATCHED = "ORDER_MATCHED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  ORDER_EXPIRED = "ORDER_EXPIRED",
  ORDER_REJECTED = "ORDER_REJECTED",
  ORDER_PARTIALLY_FILLED = "ORDER_PARTIALLY_FILLED",
  MATCHING_ROUND_STARTED = "MATCHING_ROUND_STARTED",
  MATCHING_ROUND_COMPLETED = "MATCHING_ROUND_COMPLETED",
  MATCHING_ERROR = "MATCHING_ERROR",
}

export interface BaseMatchingEvent {
  type: MatchingEventType;
  timestamp: number;
  eventId: string;
  pairId: string;
}

export interface OrderSubmittedEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_SUBMITTED;
  orderId: string;
  commitment: OrderCommitment;
}

export interface OrderMatchedEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_MATCHED;
  matchId: string;
  buyOrderId: string;
  sellOrderId: string;
  executionPrice: number;
  executionSize: number;
  matchingProof: ZKProof;
}

export interface OrderCancelledEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_CANCELLED;
  orderId: string;
  reason: "trader_requested" | "insufficient_margin" | "system";
}

export interface OrderExpiredEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_EXPIRED;
  orderId: string;
  ttlMs: number;
}

export interface OrderRejectedEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_REJECTED;
  commitmentHash: string;
  reason: string;
  errorCode: number;
}

export interface OrderPartiallyFilledEvent extends BaseMatchingEvent {
  type: MatchingEventType.ORDER_PARTIALLY_FILLED;
  orderId: string;
  filledSize: number;
  remainingSize: number;
}

export interface MatchingRoundStartedEvent extends BaseMatchingEvent {
  type: MatchingEventType.MATCHING_ROUND_STARTED;
  roundId: string;
  openOrderCount: number;
}

export interface MatchingRoundCompletedEvent extends BaseMatchingEvent {
  type: MatchingEventType.MATCHING_ROUND_COMPLETED;
  roundId: string;
  matchCount: number;
  durationMs: number;
}

export interface MatchingErrorEvent extends BaseMatchingEvent {
  type: MatchingEventType.MATCHING_ERROR;
  errorMessage: string;
  errorCode: number;
  isRecoverable: boolean;
}

export type MatchingEvent =
  | OrderSubmittedEvent
  | OrderMatchedEvent
  | OrderCancelledEvent
  | OrderExpiredEvent
  | OrderRejectedEvent
  | OrderPartiallyFilledEvent
  | MatchingRoundStartedEvent
  | MatchingRoundCompletedEvent
  | MatchingErrorEvent;

export type MatchingEventHandler<T extends MatchingEvent = MatchingEvent> = (
  event: T,
) => void | Promise<void>;

export class MatchingEventEmitter {
  private handlers: Map<MatchingEventType, MatchingEventHandler[]> = new Map();
  private globalHandlers: MatchingEventHandler[] = [];

  public on(
    eventType: MatchingEventType,
    handler: MatchingEventHandler,
  ): () => void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
    return () => {
      const cur = this.handlers.get(eventType);
      if (!cur) return;
      const idx = cur.indexOf(handler);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  public onAny(handler: MatchingEventHandler): () => void {
    this.globalHandlers.push(handler);
    return () => {
      const idx = this.globalHandlers.indexOf(handler);
      if (idx >= 0) this.globalHandlers.splice(idx, 1);
    };
  }

  public async emit(event: MatchingEvent): Promise<void> {
    const specific = this.handlers.get(event.type) ?? [];
    for (const h of specific) await h(event);
    for (const h of this.globalHandlers) await h(event);
  }

  public removeAllListeners(eventType?: MatchingEventType): void {
    if (eventType === undefined) {
      this.handlers.clear();
      this.globalHandlers = [];
    } else {
      this.handlers.delete(eventType);
    }
  }
}
