/**
 * dorr virtual AMM — the execution venue for every market.
 *
 * Ported from UniPerp's PerpsHook model: a constant-product pool with purely
 * virtual reserves. Fills walk the curve (price impact), and a keeper
 * recenters the pool toward the Pyth index price when it drifts, mirroring
 * UniPerp's `emergencyRebalanceVAMM` (reserves re-seeded so vamm price == index).
 */
import type { MarketDef } from "./markets.js";

export interface VammState {
  marketId: string;
  virtualBase: number;
  virtualQuote: number;
  k: number;
  lastRecenterAt: number;
}

export interface FillResult {
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  priceImpactBps: number;
  notional: number;
}

const pools = new Map<string, VammState>();
const recenterPaused = new Set<string>();

/** Snapshot a pool's reserves (for the live A/B demo to restore after). */
export function snapshotReserves(marketId: string): { base: number; quote: number } | undefined {
  const p = pools.get(marketId);
  return p ? { base: p.virtualBase, quote: p.virtualQuote } : undefined;
}

/** Restore reserves captured by snapshotReserves (live A/B cleanup). */
export function restoreReserves(marketId: string, r: { base: number; quote: number }): void {
  const p = pools.get(marketId);
  if (!p) return;
  p.virtualBase = r.base;
  p.virtualQuote = r.quote;
  p.k = r.base * r.quote;
}

export function pauseRecenter(marketId: string): void {
  recenterPaused.add(marketId);
}
export function resumeRecenter(marketId: string): void {
  recenterPaused.delete(marketId);
}

export function seedPool(m: MarketDef, indexPrice: number): VammState {
  const virtualQuote = m.vammDepthUsd;
  const virtualBase = m.vammDepthUsd / indexPrice;
  const st: VammState = {
    marketId: m.id,
    virtualBase,
    virtualQuote,
    k: virtualBase * virtualQuote,
    lastRecenterAt: Date.now(),
  };
  pools.set(m.id, st);
  return st;
}

export function getPool(marketId: string): VammState | undefined {
  return pools.get(marketId);
}

export function markPrice(marketId: string): number | undefined {
  const p = pools.get(marketId);
  if (!p) return undefined;
  return p.virtualQuote / p.virtualBase;
}

/**
 * Execute a fill of `sizeBase` units. LONG buys base from the pool
 * (base reserve shrinks, price rises); SHORT sells base into it.
 */
export function fill(
  marketId: string,
  side: "LONG" | "SHORT",
  sizeBase: number,
): FillResult {
  const p = pools.get(marketId);
  if (!p) throw new Error(`vamm: pool not seeded for ${marketId}`);
  if (!(sizeBase > 0)) throw new Error("vamm: sizeBase must be > 0");
  const priceBefore = p.virtualQuote / p.virtualBase;

  let newBase: number;
  if (side === "LONG") {
    if (sizeBase >= p.virtualBase * 0.5) {
      throw new Error("vamm: size exceeds pool depth (max 50% of virtual base)");
    }
    newBase = p.virtualBase - sizeBase;
  } else {
    newBase = p.virtualBase + sizeBase;
  }
  const newQuote = p.k / newBase;
  const quoteDelta = Math.abs(newQuote - p.virtualQuote);
  const avgPrice = quoteDelta / sizeBase;
  const priceAfter = newQuote / newBase;

  p.virtualBase = newBase;
  p.virtualQuote = newQuote;

  return {
    avgPrice,
    priceBefore,
    priceAfter,
    priceImpactBps: Math.abs((priceAfter - priceBefore) / priceBefore) * 10_000,
    notional: quoteDelta,
  };
}

/** Compute the avg fill price WITHOUT mutating the pool (slippage preview). */
export function previewFill(marketId: string, side: "LONG" | "SHORT", sizeBase: number): number {
  const p = pools.get(marketId);
  if (!p) throw new Error(`vamm: pool not seeded for ${marketId}`);
  if (!(sizeBase > 0)) throw new Error("vamm: sizeBase must be > 0");
  const newBase = side === "LONG" ? p.virtualBase - sizeBase : p.virtualBase + sizeBase;
  if (newBase <= 0 || (side === "LONG" && sizeBase >= p.virtualBase * 0.5)) {
    throw new Error("vamm: size exceeds pool depth");
  }
  const newQuote = p.k / newBase;
  return Math.abs(newQuote - p.virtualQuote) / sizeBase;
}

/** Recenter pool to the index price, preserving configured depth. */
export function recenter(m: MarketDef, indexPrice: number): boolean {
  const p = pools.get(m.id);
  if (!p) return false;
  if (recenterPaused.has(m.id)) return false;
  const vammPrice = p.virtualQuote / p.virtualBase;
  const driftBps = Math.abs((vammPrice - indexPrice) / indexPrice) * 10_000;
  if (driftBps <= m.recenterBps) return false;
  p.virtualQuote = m.vammDepthUsd;
  p.virtualBase = m.vammDepthUsd / indexPrice;
  p.k = p.virtualBase * p.virtualQuote;
  p.lastRecenterAt = Date.now();
  return true;
}

export function snapshot(marketId: string) {
  const p = pools.get(marketId);
  if (!p) return undefined;
  return { ...p, markPrice: p.virtualQuote / p.virtualBase };
}
