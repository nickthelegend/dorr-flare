import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MarketPair, Order, ZKProof } from "./types.js";
import { OrderSide, OrderType } from "./types.js";
import {
  FUNDING_DAMPENING_FACTOR,
  MAX_FUNDING_RATE,
  MAX_LEVERAGE,
  MAX_ORDER_TTL_MS,
  MAX_MARGIN,
  MIN_LEVERAGE,
  MIN_MARGIN,
  LOVELACE_PER_ADA,
} from "./constants.js";
import { ErrorCode, OrderValidationError } from "./errors.js";

const MAX_ORDER_SIZE = 1e12;

/** Deterministic placeholder ZK proof for local / harness use. */
export function minimalVerifiedProof(
  circuitId: string,
  publicInputs: string[] = [],
): ZKProof {
  return {
    circuitId,
    proofData: "00",
    publicInputs,
    verificationKeyId: "local-v1",
    generatedAt: Date.now(),
    isVerified: true,
  };
}

export function validateOrder(order: Order, pair: MarketPair): boolean {
  const errors: OrderValidationError[] = [];
  const push = (
    msg: string,
    code: ErrorCode,
    field: string,
    value: unknown,
    expected: string,
  ) => errors.push(new OrderValidationError(msg, code, { field, value, expected }));

  if (!pair.isActive) {
    push("Trading pair is not active", ErrorCode.INVALID_PAIR, "pairId", pair.pairId, "active pair");
  }
  if (order.pairId !== pair.pairId) {
    push("Order pair does not match market pair", ErrorCode.INVALID_PAIR, "pairId", order.pairId, pair.pairId);
  }
  if (order.size < pair.minOrderSize) {
    push("Order size below minimum", ErrorCode.ORDER_SIZE_TOO_SMALL, "size", order.size, `>= ${pair.minOrderSize}`);
  }
  if (order.size > MAX_ORDER_SIZE) {
    push("Order size too large", ErrorCode.ORDER_SIZE_TOO_LARGE, "size", order.size, `<= ${MAX_ORDER_SIZE}`);
  }
  if (order.leverage < MIN_LEVERAGE || order.leverage > pair.maxLeverage || order.leverage > MAX_LEVERAGE) {
    push("Leverage out of range", ErrorCode.LEVERAGE_EXCEEDED, "leverage", order.leverage, `[${MIN_LEVERAGE}, ${pair.maxLeverage}]`);
  }
  if (order.margin < MIN_MARGIN || order.margin > MAX_MARGIN) {
    push("Margin out of allowed bounds", ErrorCode.INSUFFICIENT_MARGIN, "margin", order.margin, `[${MIN_MARGIN}, ${MAX_MARGIN}]`);
  }
  if (
    order.type === OrderType.LIMIT ||
    order.type === OrderType.STOP_LIMIT
  ) {
    if (order.price === undefined || order.price <= 0) {
      push("Limit order requires positive price", ErrorCode.MISSING_LIMIT_PRICE, "price", order.price, "> 0");
    }
  }
  if (order.type === OrderType.STOP_MARKET || order.type === OrderType.STOP_LIMIT) {
    if (order.stopPrice === undefined || order.stopPrice <= 0) {
      push("Stop order requires positive stop price", ErrorCode.MISSING_STOP_PRICE, "stopPrice", order.stopPrice, "> 0");
    }
  }
  if (order.ttlMs <= 0 || order.ttlMs > MAX_ORDER_TTL_MS) {
    push("TTL out of range", ErrorCode.ORDER_EXPIRED, "ttlMs", order.ttlMs, `(0, ${MAX_ORDER_TTL_MS}]`);
  }

  if (errors.length > 0) throw errors[0];
  return true;
}

export function hashOrder(order: Order, nonce: string): string {
  const payload = serializeOrder(order);
  return (
    "0x" +
    createHash("sha256")
      .update(payload, "utf8")
      .update(String(nonce), "utf8")
      .digest("hex")
  );
}

export function generateOrderId(): string {
  return randomUUID();
}

export function formatAmount(amount: number, decimals: number = 6): string {
  const s = amount.toFixed(decimals);
  return s.replace(/\.?0+$/, "") || "0";
}

export function toLovelace(priceInQuote: number, adaPrice: number): bigint {
  if (adaPrice <= 0) throw new Error("adaPrice must be positive");
  const ada = priceInQuote / adaPrice;
  return BigInt(Math.round(ada * Number(LOVELACE_PER_ADA)));
}

export function fromLovelace(lovelace: bigint, adaPrice: number): number {
  return (Number(lovelace) / Number(LOVELACE_PER_ADA)) * adaPrice;
}

export function calculateFundingRate(
  markPrice: number,
  indexPrice: number,
  dampeningFactor: number = FUNDING_DAMPENING_FACTOR,
): number {
  if (indexPrice <= 0) return 0;
  const raw = ((markPrice - indexPrice) / indexPrice) * dampeningFactor;
  return Math.max(-MAX_FUNDING_RATE, Math.min(MAX_FUNDING_RATE, raw));
}

export function generateNonce(byteLength: number = 32): string {
  return randomBytes(byteLength).toString("hex");
}

/** Placeholder: XOR-fold field elements — not a real Poseidon hash. */
export function poseidonHash(inputs: string[]): string {
  const h = createHash("sha256");
  for (const x of inputs) h.update(String(x), "utf8");
  return "0x" + h.digest("hex");
}

/** Placeholder Pedersen-style commitment from bigint inputs. */
export function pedersenCommit(value: bigint, blinding: bigint): string {
  const h = createHash("sha256");
  h.update(value.toString(16), "utf8");
  h.update(blinding.toString(16), "utf8");
  return "0x" + h.digest("hex");
}

export function nowMs(): number {
  return Date.now();
}

export function isExpired(createdAt: number, ttlMs: number): boolean {
  return Date.now() > createdAt + ttlMs;
}

export function serializeOrder(order: Order): string {
  const keys = Object.keys(order).sort() as (keyof Order)[];
  const o: Record<string, unknown> = {};
  for (const k of keys) o[k as string] = order[k];
  return JSON.stringify(o);
}

export function deserializeOrder(data: string): Order {
  return JSON.parse(data) as Order;
}

/** Derive bid/ask side from proof public inputs: first element `SHORT`/`ASK` → SHORT, else LONG. */
export function orderSideFromProofs(proofs: {
  marginProof: { publicInputs: string[] };
  timelockProof: { publicInputs: string[] };
}): OrderSide {
  const tag =
    proofs.marginProof.publicInputs[0] ??
    proofs.timelockProof.publicInputs[0] ??
    "";
  const u = String(tag).toUpperCase();
  if (u === "SHORT" || u === "ASK" || u === "SELL") return OrderSide.SHORT;
  return OrderSide.LONG;
}

export function priceLevelFromProofs(proofs: {
  priceRangeProof: { publicInputs: string[] };
}): number {
  const raw = proofs.priceRangeProof.publicInputs[1] ?? proofs.priceRangeProof.publicInputs[0];
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function sizeFromProofs(proofs: {
  marginProof: { publicInputs: string[] };
}): number {
  const raw = proofs.marginProof.publicInputs[1] ?? proofs.marginProof.publicInputs[0];
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
