/**
 * dorr batch auction — uniform-clearing-price execution (structural anti-MEV).
 *
 * The commit/reveal + ZK commitment already HIDES an order until execution. The
 * batch auction goes one step further and removes the *economic* value of
 * ordering entirely: every order collected in an epoch clears at ONE uniform
 * price. Because arrival order no longer changes anyone's fill, front-running is
 * impossible *by construction* — a bot that inserts itself into the batch pays
 * the exact same price as its victim, so a sandwich nets $0.
 *
 * Mechanics (constant-product vAMM):
 *   • Longs buy base, shorts sell base. matched = min(Σlongs, Σshorts) crosses
 *     internally at the clearing price with ZERO pool impact (buyers meet sellers).
 *   • Only the net imbalance N = Σlongs − Σshorts touches the pool and moves price.
 *   • The clearing price is the average price of walking the pool by |N| — the one
 *     price at which the whole epoch settles.
 *
 * Pure + deterministic → unit-testable and reproducible on stage.
 */
import { createHash, randomBytes } from "node:crypto";
import { orderCommitmentHex } from "@dorr/engine/order/commitment";
import { marketById } from "./markets.js";
import { getPrice } from "./ftso.js";
import { getPool, type VammState } from "./vamm.js";
import { runAbDemo } from "./demo.js";

type Side = "LONG" | "SHORT";

export interface BatchOrder {
  id: string;
  side: Side;
  sizeBase: number;
}

export interface BatchReserves {
  base: number;
  quote: number;
  k: number;
}

export interface BatchFill {
  id: string;
  side: Side;
  sizeBase: number;
  /** every order in the epoch settles at this single price */
  price: number;
}

export interface BatchClearing {
  /** the single uniform price the whole epoch settles at */
  clearingPrice: number;
  spotPrice: number;
  /** base crossed internally (longs meet shorts) at zero pool impact */
  matchedBase: number;
  /** signed net imbalance in base (+ = net buying); only this touches the pool */
  netImbalanceBase: number;
  /** price impact of the net imbalance vs spot, in bps */
  impactBps: number;
  fills: BatchFill[];
  reservesAfter: BatchReserves;
}

/**
 * Clear a set of orders at a single uniform price on a constant-product pool.
 * Matched long/short volume crosses internally (no impact); only the net
 * imbalance walks the curve. Every fill is stamped with the same clearing price.
 */
export function clearBatchUniform(pool: BatchReserves, orders: BatchOrder[]): BatchClearing {
  if (!(pool.base > 0 && pool.quote > 0)) throw new Error("batch: pool not seeded");
  const spot = pool.quote / pool.base;

  const longs = orders.filter((o) => o.side === "LONG").reduce((s, o) => s + o.sizeBase, 0);
  const shorts = orders.filter((o) => o.side === "SHORT").reduce((s, o) => s + o.sizeBase, 0);
  const matched = Math.min(longs, shorts);
  const net = longs - shorts; // +net → net buying pressure

  let clearingPrice: number;
  let reservesAfter: BatchReserves;

  if (Math.abs(net) < 1e-12) {
    // perfectly balanced epoch: everyone crosses at spot, pool untouched.
    clearingPrice = spot;
    reservesAfter = { ...pool };
  } else if (net > 0) {
    if (net >= pool.base * 0.5) throw new Error("batch: net imbalance exceeds pool depth");
    const newBase = pool.base - net;
    const newQuote = pool.k / newBase;
    clearingPrice = (newQuote - pool.quote) / net; // avg price to buy `net`
    reservesAfter = { base: newBase, quote: newQuote, k: pool.k };
  } else {
    const n = -net;
    const newBase = pool.base + n;
    const newQuote = pool.k / newBase;
    clearingPrice = (pool.quote - newQuote) / n; // avg price to sell `n`
    reservesAfter = { base: newBase, quote: newQuote, k: pool.k };
  }

  const fills: BatchFill[] = orders.map((o) => ({
    id: o.id,
    side: o.side,
    sizeBase: o.sizeBase,
    price: clearingPrice,
  }));

  return {
    clearingPrice,
    spotPrice: spot,
    matchedBase: matched,
    netImbalanceBase: net,
    impactBps: Math.abs((clearingPrice - spot) / spot) * 10_000,
    fills,
    reservesAfter,
  };
}

function reservesOf(p: VammState): BatchReserves {
  return { base: p.virtualBase, quote: p.virtualQuote, k: p.k };
}

// ─── batch-auction demo: prove a sandwich nets $0 under uniform clearing ──────
export interface BatchDemoResult {
  marketId: string;
  symbol: string;
  indexPrice: number;
  victim: { side: Side; marginUsd: number; leverage: number; sizeBase: number };
  /** the honest epoch: a handful of real orders, all clearing at one price */
  epoch: {
    orders: Array<{ label: string; side: Side; sizeBase: number; commitment: string }>;
    clearingPrice: number;
    matchedBase: number;
    netImbalanceBase: number;
    impactBps: number;
  };
  /** a bot inserts a front-run + back-run into the SAME batch */
  attack: {
    frontRunSizeBase: number;
    botBuyPrice: number;
    botSellPrice: number;
    botProfitUsd: number;
    victimPriceWithBot: number;
    victimPriceWithoutBot: number;
    victimExtraCostUsd: number;
  };
  /** the same sandwich on a sequential (transparent) DEX, for contrast */
  sequential: { botProfitUsd: number; victimExtraCostUsd: number; victimSlippageBps: number };
  headline: string;
}

/**
 * Demonstrate that under uniform-price batch clearing a sandwich is worthless.
 * A bot inserts a front-run buy AND a back-run sell into the same epoch; because
 * the whole epoch settles at ONE price, the bot buys and sells at the same price
 * → profit $0. Contrast with sequential execution where the same bot profits.
 */
export function runBatchAuctionDemo(p: {
  marketId: string;
  side?: Side;
  marginUsd?: number;
  leverage?: number;
  botMultiple?: number;
}): BatchDemoResult {
  const m = marketById(p.marketId);
  if (!m) throw new Error(`unknown market ${p.marketId}`);
  const idx = getPrice(m.feedId);
  const live = getPool(p.marketId);
  if (!idx || !live) throw new Error(`market ${p.marketId} not ready`);

  const side: Side = p.side === "SHORT" ? "SHORT" : "LONG";
  const marginUsd = p.marginUsd ?? 1_000;
  const leverage = p.leverage ?? 10;
  const botMultiple = p.botMultiple ?? 1.5;

  const victimSize = (marginUsd * leverage) / idx.price;
  const opp: Side = side === "LONG" ? "SHORT" : "LONG";

  // An honest epoch: the victim plus a few real counterparties (some crossing).
  const honest: BatchOrder[] = [
    { id: "victim", side, sizeBase: victimSize },
    { id: "lp-a", side: opp, sizeBase: victimSize * 0.6 },
    { id: "trader-b", side, sizeBase: victimSize * 0.35 },
    { id: "trader-c", side: opp, sizeBase: victimSize * 0.4 },
  ];
  const commitFor = (o: BatchOrder) =>
    orderCommitmentHex({
      pairId: p.marketId, side: o.side, price: idx.price.toFixed(8),
      size: o.sizeBase.toFixed(8), leverage, margin: marginUsd.toFixed(2),
      nonce: randomBytes(16).toString("hex"),
    });

  const base = reservesOf(live);
  const cleared = clearBatchUniform(base, honest);
  const victimPriceWithoutBot = cleared.clearingPrice;

  // The attack: bot adds a front-run (same side as victim) AND a back-run
  // (opposite) into the SAME batch. Both clear at the one uniform price.
  const frontRun = victimSize * botMultiple;
  const withBot: BatchOrder[] = [
    ...honest,
    { id: "bot-frontrun", side, sizeBase: frontRun },
    { id: "bot-backrun", side: opp, sizeBase: frontRun },
  ];
  const clearedWithBot = clearBatchUniform(base, withBot);
  const botBuyPrice = clearedWithBot.clearingPrice;
  const botSellPrice = clearedWithBot.clearingPrice;
  // bot buys `frontRun` and sells `frontRun` at the identical clearing price.
  const botProfitUsd = (botSellPrice - botBuyPrice) * frontRun; // == 0 by construction
  const victimPriceWithBot = clearedWithBot.clearingPrice;
  const dir = side === "LONG" ? 1 : -1;
  const victimExtraCostUsd = (victimPriceWithBot - victimPriceWithoutBot) * victimSize * dir;

  // Contrast: the same sandwich on a sequential/transparent venue.
  const seq = runAbDemo({ marketId: p.marketId, side, marginUsd, leverage, botMultiple, mode: "sim" });

  return {
    marketId: p.marketId,
    symbol: m.symbol,
    indexPrice: idx.price,
    victim: { side, marginUsd, leverage, sizeBase: victimSize },
    epoch: {
      orders: honest.map((o) => ({
        label: o.id, side: o.side, sizeBase: o.sizeBase, commitment: commitFor(o).slice(0, 18) + "…",
      })),
      clearingPrice: cleared.clearingPrice,
      matchedBase: cleared.matchedBase,
      netImbalanceBase: cleared.netImbalanceBase,
      impactBps: cleared.impactBps,
    },
    attack: {
      frontRunSizeBase: frontRun,
      botBuyPrice,
      botSellPrice,
      botProfitUsd,
      victimPriceWithBot,
      victimPriceWithoutBot,
      victimExtraCostUsd,
    },
    sequential: {
      botProfitUsd: seq.public.botProfitUsd,
      victimExtraCostUsd: seq.public.victimExtraCostUsd,
      victimSlippageBps: seq.public.victimSlippageBps,
    },
    headline:
      `Uniform-price batch: every order in the epoch clears at ${cleared.clearingPrice.toFixed(6)}. ` +
      `A bot that inserts a front-run + back-run pays and receives the SAME price — profit $${botProfitUsd.toFixed(2)}. ` +
      `On a sequential DEX the identical sandwich nets the bot $${seq.public.botProfitUsd.toFixed(2)} and costs the victim ` +
      `$${Math.abs(seq.public.victimExtraCostUsd).toFixed(2)}. Front-running isn't hidden here — it's economically impossible.`,
  };
}

/** Digest of a batch clearing — a compact attestation the epoch cleared uniformly. */
export function batchDigest(c: BatchClearing): string {
  return createHash("sha256")
    .update(JSON.stringify({
      clearingPrice: c.clearingPrice.toFixed(8),
      net: c.netImbalanceBase.toFixed(8),
      matched: c.matchedBase.toFixed(8),
      fills: c.fills.map((f) => `${f.id}:${f.side}:${f.sizeBase.toFixed(8)}@${f.price.toFixed(8)}`),
    }))
    .digest("hex");
}
