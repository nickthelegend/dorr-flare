/**
 * A/B anti-front-running demo — the money shot, made deterministic.
 *
 * Runs the SAME order two ways on a scratch clone of the live vAMM (no funds,
 * no real trades touched), and shows the only thing that differs: whether a
 * sandwich bot could SEE the order.
 *
 *   public  → order details are in the public feed BEFORE execution, so the bot
 *             front-runs (buys ahead), the victim fills at a worse price, and the
 *             bot back-runs for profit — a classic sandwich.
 *   private → the public sees only the commitment hash, so the bot is
 *             blind and does nothing; the victim fills at the fair price.
 *
 * The delta between the two victim fills is the value the ZK order commitment
 * protects. Pure vAMM math → reproducible on stage, every time.
 */
import { createHash, randomBytes } from "node:crypto";
import { orderCommitmentHex } from "@dorr/engine/order/commitment";
import { marketById } from "./markets.js";
import { getPrice, isFeedDisabled } from "./ftso.js";
import {
  getPool,
  fill as liveFill,
  pauseRecenter,
  resumeRecenter,
  snapshotReserves,
  restoreReserves,
  type VammState,
} from "./vamm.js";

type Side = "LONG" | "SHORT";

interface ScratchPool {
  base: number;
  quote: number;
  k: number;
}

function cloneScratch(p: VammState): ScratchPool {
  return { base: p.virtualBase, quote: p.virtualQuote, k: p.k };
}

/** Fill on a scratch pool; returns avg execution price and mutates the scratch. */
function scratchFill(pool: ScratchPool, side: Side, sizeBase: number): number {
  const newBase = side === "LONG" ? pool.base - sizeBase : pool.base + sizeBase;
  if (newBase <= 0) throw new Error("size exceeds scratch pool depth");
  const newQuote = pool.k / newBase;
  const avg = Math.abs(newQuote - pool.quote) / sizeBase;
  pool.base = newBase;
  pool.quote = newQuote;
  return avg;
}

export interface AbResult {
  marketId: string;
  symbol: string;
  indexPrice: number;
  victim: { side: Side; marginUsd: number; leverage: number; sizeBase: number };
  bot: { sizeBase: number; marginUsd: number };
  public: {
    botFrontRunPrice: number;
    victimEntry: number;
    botExitPrice: number;
    botProfitUsd: number;
    victimSlippageBps: number;
    victimExtraCostUsd: number;
    orderVisibleToBot: true;
  };
  private: {
    victimEntry: number;
    victimSlippageBps: number;
    orderVisibleToBot: false;
    publicSees: string;
  };
  headline: string;
}

export interface AbParams {
  marketId: string;
  side: Side;
  marginUsd: number;
  leverage: number;
  /** Bot aggression as a fraction of the victim's size (default 1.5x). */
  botMultiple?: number;
  /**
   * "sim" (default): deterministic scratch-clone of the live pool — reproducible,
   * leaves the live pool untouched. "live": run a REAL sandwich on the live vAMM
   * (pause recenter, real fills, restore) — proves the MEV property on the real
   * engine. Private baseline is the counterfactual (you can't fill the same
   * victim order twice on one pool).
   */
  mode?: "sim" | "live";
}

export function runAbDemo(p: AbParams): AbResult {
  const m = marketById(p.marketId);
  if (!m) throw new Error(`unknown market ${p.marketId}`);
  if (isFeedDisabled(m.feedId)) throw new Error(`market ${p.marketId} disabled`);
  const idx = getPrice(m.feedId);
  const live = getPool(p.marketId);
  if (!idx || !live) throw new Error(`market ${p.marketId} not ready`);

  const notional = p.marginUsd * p.leverage;
  const victimSize = notional / idx.price;
  const botMultiple = p.botMultiple ?? 1.5;
  const botSize = victimSize * botMultiple;
  const botMargin = (botSize * idx.price) / p.leverage;
  const botExitSide: Side = p.side === "LONG" ? "SHORT" : "LONG";

  let botFrontRunPrice: number;
  let victimEntryPublic: number;
  let botExitPrice: number;
  let victimEntryPrivate: number;

  if (p.mode === "live") {
    // REAL sandwich on the live vAMM. Pause recenter so the bot's front-run
    // isn't erased mid-sequence; snapshot + restore so real traders are unaffected.
    const snap = snapshotReserves(p.marketId)!;
    pauseRecenter(p.marketId);
    try {
      // Fair-price counterfactual (private) from the untouched pool, first.
      const privClone = cloneScratch(live);
      victimEntryPrivate = scratchFill(privClone, p.side, victimSize);
      // Real public sandwich on the live pool.
      botFrontRunPrice = liveFill(p.marketId, p.side, botSize).avgPrice;
      victimEntryPublic = liveFill(p.marketId, p.side, victimSize).avgPrice;
      botExitPrice = liveFill(p.marketId, botExitSide, botSize).avgPrice;
    } finally {
      restoreReserves(p.marketId, snap);
      resumeRecenter(p.marketId);
    }
    const botProfitUsdLive =
      (p.side === "LONG" ? botExitPrice - botFrontRunPrice : botFrontRunPrice - botExitPrice) * botSize;
    return assembleResult(m, p, idx.price, victimSize, botSize, botMargin, {
      botFrontRunPrice, victimEntryPublic, botExitPrice, botProfitUsd: botProfitUsdLive, victimEntryPrivate,
    });
  }

  // ── SIM (default): deterministic scratch clones, live pool untouched ──
  const pub = cloneScratch(live);
  botFrontRunPrice = scratchFill(pub, p.side, botSize);
  victimEntryPublic = scratchFill(pub, p.side, victimSize);
  botExitPrice = scratchFill(pub, botExitSide, botSize);
  const priv = cloneScratch(live);
  victimEntryPrivate = scratchFill(priv, p.side, victimSize);
  const botProfitUsd =
    (p.side === "LONG" ? botExitPrice - botFrontRunPrice : botFrontRunPrice - botExitPrice) * botSize;

  return assembleResult(m, p, idx.price, victimSize, botSize, botMargin, {
    botFrontRunPrice, victimEntryPublic, botExitPrice, botProfitUsd, victimEntryPrivate,
  });
}

interface Legs {
  botFrontRunPrice: number;
  victimEntryPublic: number;
  botExitPrice: number;
  botProfitUsd: number;
  victimEntryPrivate: number;
}

function assembleResult(
  m: { symbol: string },
  p: AbParams,
  indexPrice: number,
  victimSize: number,
  botSize: number,
  botMargin: number,
  legs: Legs,
): AbResult {
  const dir = p.side === "LONG" ? 1 : -1;
  const pubSlipBps = ((legs.victimEntryPublic - legs.victimEntryPrivate) / legs.victimEntryPrivate) * 10_000 * dir;
  const privSlipBps = ((legs.victimEntryPrivate - indexPrice) / indexPrice) * 10_000 * dir;
  const victimExtraCostUsd = (legs.victimEntryPublic - legs.victimEntryPrivate) * victimSize * dir;

  return {
    marketId: p.marketId,
    symbol: m.symbol,
    indexPrice,
    victim: { side: p.side, marginUsd: p.marginUsd, leverage: p.leverage, sizeBase: victimSize },
    bot: { sizeBase: botSize, marginUsd: botMargin },
    public: {
      botFrontRunPrice: legs.botFrontRunPrice,
      victimEntry: legs.victimEntryPublic,
      botExitPrice: legs.botExitPrice,
      botProfitUsd: legs.botProfitUsd,
      victimSlippageBps: pubSlipBps,
      victimExtraCostUsd,
      orderVisibleToBot: true,
    },
    private: {
      victimEntry: legs.victimEntryPrivate,
      victimSlippageBps: privSlipBps,
      orderVisibleToBot: false,
      publicSees: "only a 32-byte commitment hash",
    },
    headline:
      `On a public perp the bot front-runs and the victim pays ` +
      `$${Math.abs(victimExtraCostUsd).toFixed(2)} more (${Math.abs(pubSlipBps).toFixed(1)} bps). ` +
      `On dorr the order is a hash until execution — the bot is blind, and the victim pays fair price.`,
  };
}

// ─── MEV attack lab: run a sandwich, watch it FAIL on dorr ───────────────────
export interface AttackStep {
  ms: number;
  actor: "bot" | "victim" | "chain" | "dorr";
  ok: boolean; // true = step advances the attack; false = attack blocked/aborted
  text: string;
}

export interface AttackLabResult {
  marketId: string;
  symbol: string;
  indexPrice: number;
  /** transparent DEX: the bot sees the order and sandwiches it */
  publicRun: {
    steps: AttackStep[];
    victimEntry: number;
    victimExtraCostUsd: number;
    victimSlippageBps: number;
    botProfitUsd: number;
    outcome: "SANDWICHED";
  };
  /** dorr: the bot sees only a hash, tries to crack it, and aborts */
  privateRun: {
    steps: AttackStep[];
    commitmentHash: string;
    bruteForceAttempts: number;
    bruteForceMatches: number;
    victimEntry: number;
    outcome: "ATTACK FAILED";
  };
  headline: string;
}

/**
 * Produces two step-by-step attack timelines for the same order: on a
 * transparent DEX the bot front-runs and profits; on dorr the bot sees only the
 * 32-byte commitment, tries (and fails) to brute-force the preimage, and aborts.
 * The brute-force is REAL — it runs actual SHA-256 guesses and reports 0 matches.
 */
export function runAttackLab(p: AbParams): AttackLabResult {
  const m = marketById(p.marketId);
  if (!m) throw new Error(`unknown market ${p.marketId}`);
  const ab = runAbDemo({ ...p, mode: "sim" }); // reuse the vAMM sandwich math
  const idx = ab.indexPrice;
  const sizeStr = ab.victim.sizeBase.toFixed(2);

  // A realistic private order commitment for the same trade.
  const nonce = randomBytes(16).toString("hex");
  const commitment = orderCommitmentHex({
    pairId: p.marketId, side: p.side, price: idx.toFixed(8),
    size: ab.victim.sizeBase.toFixed(8), leverage: p.leverage, margin: p.marginUsd.toFixed(2), nonce,
  });

  const publicRun = {
    steps: [
      { ms: 0, actor: "bot", ok: true, text: "🤖 Sandwich bot scanning the public mempool / order flow…" },
      { ms: 320, actor: "bot", ok: true, text: `👁️ Order spotted IN THE CLEAR: ${p.side} ${sizeStr} ${m.base} · ${p.leverage}x — full details visible` },
      { ms: 640, actor: "bot", ok: true, text: `⚡ FRONT-RUN: bot buys ahead, pushing the mark to ${ab.public.botFrontRunPrice.toFixed(6)}` },
      { ms: 980, actor: "victim", ok: true, text: `🎯 Victim's order executes at ${ab.public.victimEntry.toFixed(6)} — worse than fair (${idx.toFixed(6)})` },
      { ms: 1300, actor: "bot", ok: true, text: `💰 BACK-RUN: bot unwinds at ${ab.public.botExitPrice.toFixed(6)}, pocketing $${ab.public.botProfitUsd.toFixed(2)}` },
      { ms: 1600, actor: "victim", ok: false, text: `✗ SANDWICHED — victim overpaid $${ab.public.victimExtraCostUsd.toFixed(2)} (${ab.public.victimSlippageBps.toFixed(1)} bps)` },
    ] as AttackStep[],
    victimEntry: ab.public.victimEntry,
    victimExtraCostUsd: ab.public.victimExtraCostUsd,
    victimSlippageBps: ab.public.victimSlippageBps,
    botProfitUsd: ab.public.botProfitUsd,
    outcome: "SANDWICHED" as const,
  };

  // The bot tries to crack the commitment: REAL SHA-256 guesses, guaranteed to fail.
  const bruteForceAttempts = 25_000;
  let bruteForceMatches = 0;
  const sides: Array<"LONG" | "SHORT"> = ["LONG", "SHORT"];
  for (let i = 0; i < bruteForceAttempts; i++) {
    const guess = orderCommitmentHex({
      pairId: p.marketId,
      side: sides[i % 2],
      price: (idx * (0.5 + (i % 1000) / 1000)).toFixed(8),
      size: String(1000 + i),
      leverage: (i % 20) + 1,
      margin: String(100 + i),
      nonce: createHash("sha256").update(`atk:${i}`).digest("hex").slice(0, 32),
    });
    if (guess === commitment) bruteForceMatches++;
  }

  const privateRun = {
    steps: [
      { ms: 0, actor: "bot", ok: true, text: "🤖 Sandwich bot scanning the public mempool / order flow…" },
      { ms: 320, actor: "dorr", ok: false, text: `🔒 Only the commitment is public: ${commitment.slice(0, 18)}… — no side, size, price, or leverage` },
      { ms: 700, actor: "bot", ok: false, text: `🔓 Bot attempts to crack the commitment — ${bruteForceAttempts.toLocaleString()} SHA-256 preimage guesses…` },
      { ms: 1500, actor: "dorr", ok: false, text: `❌ ${bruteForceMatches} / ${bruteForceAttempts.toLocaleString()} matches — the 128-bit nonce makes the search space 2¹²⁸ (infeasible)` },
      { ms: 1800, actor: "bot", ok: false, text: "❓ Bot has no direction, no size — a sandwich cannot even be constructed" },
      { ms: 2100, actor: "bot", ok: false, text: "🛑 ATTACK ABORTED — there is nothing to front-run" },
      { ms: 2400, actor: "victim", ok: true, text: `✓ Victim fills at the fair price ${ab.private.victimEntry.toFixed(6)} — bot profit $0.00` },
    ] as AttackStep[],
    commitmentHash: commitment,
    bruteForceAttempts,
    bruteForceMatches,
    victimEntry: ab.private.victimEntry,
    outcome: "ATTACK FAILED" as const,
  };

  return {
    marketId: p.marketId,
    symbol: m.symbol,
    indexPrice: idx,
    publicRun,
    privateRun,
    headline: `Same order, two venues. Transparent DEX: bot sandwiches the victim for $${ab.public.victimExtraCostUsd.toFixed(2)}. dorr: the bot sees a hash, ${bruteForceMatches}/${bruteForceAttempts.toLocaleString()} cracks — attack impossible.`,
  };
}
