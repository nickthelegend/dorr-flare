/**
 * Pure perps math — no state, no I/O, fully unit-testable.
 * trading.ts composes these; tests pin them.
 */
export type Side = "LONG" | "SHORT";

export const TAKER_FEE_BPS = 10;
export const MAINTENANCE_MARGIN = 0.05;
export const FUNDING_DAMPENING = 0.125;
export const FUNDING_CAP = 0.0075;
/**
 * Max tolerated gap between the vAMM mark and the FTSO index before an execution
 * is refused. The pool auto-recenters to within a few bps of the oracle, so a
 * large gap means the venue price is being manipulated (or recenter is stalled)
 * — filling there would hand a taker a mispriced entry. Guards executeOrder.
 */
export const MAX_ORACLE_DIVERGENCE_BPS = 200;

/** Position notional = margin × leverage (quote units, dUSD). */
export function notional(marginUsd: number, leverage: number): number {
  return marginUsd * leverage;
}

/** Base-asset size a margin+leverage buys at a given index price. */
export function computeSizeBase(marginUsd: number, leverage: number, indexPrice: number): number {
  if (!(indexPrice > 0)) throw new Error("indexPrice must be > 0");
  return notional(marginUsd, leverage) / indexPrice;
}

/** Signed PnL in quote units. LONG profits when mark > entry; SHORT the reverse. */
export function pnl(side: Side, entryPrice: number, markPrice: number, sizeBase: number): number {
  const dir = side === "LONG" ? 1 : -1;
  return (markPrice - entryPrice) * sizeBase * dir;
}

/** Taker fee on a fill's notional. */
export function takerFee(fillNotional: number, bps: number = TAKER_FEE_BPS): number {
  return (Math.abs(fillNotional) * bps) / 10_000;
}

/** Funding rate from vAMM-mark vs oracle-index premium, dampened and capped. */
export function fundingRate(
  markPrice: number,
  indexPrice: number,
  damp: number = FUNDING_DAMPENING,
  cap: number = FUNDING_CAP,
): number {
  if (!(indexPrice > 0)) return 0;
  const raw = ((markPrice - indexPrice) / indexPrice) * damp;
  return Math.max(-cap, Math.min(cap, raw));
}

/** Funding a position pays (+) or receives (−) this tick. Longs pay when mark>index. */
export function fundingPayment(side: Side, rate: number, sizeBase: number, markPrice: number): number {
  const base = rate * sizeBase * markPrice;
  return side === "LONG" ? base : -base;
}

/** Account equity for a position: margin + unrealized PnL − funding accrued. */
export function equity(marginUsd: number, unrealizedPnl: number, fundingPaid: number): number {
  return marginUsd + unrealizedPnl - fundingPaid;
}

/** Equity as a fraction of position value (margin ratio). */
export function equityRatio(
  marginUsd: number,
  unrealizedPnl: number,
  fundingPaid: number,
  sizeBase: number,
  markPrice: number,
): number {
  const positionValue = sizeBase * markPrice;
  if (!(positionValue > 0)) return Infinity;
  return equity(marginUsd, unrealizedPnl, fundingPaid) / positionValue;
}

export function isLiquidatable(ratio: number, maintenance: number = MAINTENANCE_MARGIN): boolean {
  return ratio < maintenance;
}

/** Net change applied to free balance when a position closes. */
export function settledDelta(realizedPnl: number, fee: number, fundingPaid: number): number {
  return realizedPnl - fee - fundingPaid;
}

/**
 * Mark price at which a position's equity ratio hits the maintenance margin
 * (its liquidation price). Derived from equityRatio(...) = mm.
 */
export function liquidationPrice(
  side: Side,
  entryPrice: number,
  sizeBase: number,
  marginUsd: number,
  fundingPaid: number,
  mm: number = MAINTENANCE_MARGIN,
): number {
  if (!(sizeBase > 0)) return 0;
  const num = entryPrice * sizeBase + (side === "LONG" ? fundingPaid - marginUsd : marginUsd - fundingPaid);
  const denom = side === "LONG" ? sizeBase * (1 - mm) : sizeBase * (1 + mm);
  const p = num / denom;
  return Math.max(0, p);
}

/** Realized slippage of an execution vs a reference price, in bps. */
export function slippageBps(execPrice: number, refPrice: number): number {
  if (!(refPrice > 0)) return 0;
  return (Math.abs(execPrice - refPrice) / refPrice) * 10_000;
}

/** Absolute gap between the venue mark and the oracle index, in bps. */
export function divergenceBps(markPrice: number, indexPrice: number): number {
  if (!(indexPrice > 0)) return Infinity;
  return (Math.abs(markPrice - indexPrice) / indexPrice) * 10_000;
}

/** True when the venue price has drifted too far from the oracle to fill safely. */
export function oracleDiverged(
  markPrice: number,
  indexPrice: number,
  maxBps: number = MAX_ORACLE_DIVERGENCE_BPS,
): boolean {
  return divergenceBps(markPrice, indexPrice) > maxBps;
}

/**
 * Should a LIMIT order trigger at the current index price?
 * LONG limit fills at/below its price; SHORT limit fills at/above.
 */
export function limitTriggered(side: Side, limitPrice: number, indexPrice: number): boolean {
  return side === "LONG" ? indexPrice <= limitPrice : indexPrice >= limitPrice;
}

/**
 * Should a stop-loss / take-profit trigger for an open position?
 * LONG: SL below, TP above. SHORT: SL above, TP below.
 */
export function stopTriggered(
  side: Side,
  indexPrice: number,
  stopLossPrice?: number,
  takeProfitPrice?: number,
): "stop-loss" | "take-profit" | null {
  if (side === "LONG") {
    if (stopLossPrice != null && indexPrice <= stopLossPrice) return "stop-loss";
    if (takeProfitPrice != null && indexPrice >= takeProfitPrice) return "take-profit";
  } else {
    if (stopLossPrice != null && indexPrice >= stopLossPrice) return "stop-loss";
    if (takeProfitPrice != null && indexPrice <= takeProfitPrice) return "take-profit";
  }
  return null;
}
