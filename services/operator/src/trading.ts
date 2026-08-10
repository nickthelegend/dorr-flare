/**
 * dorr trading core — ties vAMM execution, operator accounting and Flare
 * settlement together. Order contents stay private behind a commitment (and,
 * on the sealed path, behind drand timelock encryption); the epoch's uniform
 * clearing price is recorded on Flare, where DorrBatchSettlement re-reads FTSO
 * and verifies the enclave quote before it will accept the batch.
 */
import { createHash, randomBytes } from "node:crypto";
import { orderCommitmentHex } from "@dorr/engine/order/commitment";
import { marketById } from "./markets.js";
import { getPrice, isFeedDisabled } from "./ftso.js";
import * as vamm from "./vamm.js";
import {
  account,
  getState,
  persist,
  logEvent,
  type DorrOrder,
  type DorrPosition,
  type SealedOrder,
  type PrivacyMode,
  type Side,
} from "./state.js";
import { settleSealedEpoch, currentRound, type SealedInput } from "./sealbid.js";
import { clearBatchUniform } from "./batch.js";
import { createJob, jobStep, completeJob, failJob } from "./jobs.js";
import { flareConfigured, settleBatchOnChain, usdToUnits } from "./flare.js";
import { enclaveConfigured, signBatchQuote } from "./attestation.js";
import type { Hex } from "viem";
import { publicFeedView } from "./privacy.js";
import {
  computeSizeBase,
  pnl as pnlOf,
  takerFee,
  fundingRate,
  fundingPayment,
  equityRatio,
  isLiquidatable,
  liquidationPrice,
  slippageBps,
  limitTriggered,
  stopTriggered,
  settledDelta as settledDeltaOf,
  oracleDiverged,
  divergenceBps,
  MAINTENANCE_MARGIN,
  MAX_ORACLE_DIVERGENCE_BPS,
} from "./trading-math.js";

const PRICE_STALE_MS = 30_000;

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Trader secret for the Midnight authority circuit — derived per order (operator-held in v1). */
function traderSkFor(order: { id: string; address: string; nonce: string }): string {
  return sha256(`dorr:trader-sk:v1:${order.address}:${order.id}:${order.nonce}`);
}

function freshIndexPrice(marketId: string): number {
  const m = marketById(marketId);
  if (!m) throw new Error(`unknown market ${marketId}`);
  if (isFeedDisabled(m.feedId)) throw new Error(`market ${marketId} disabled (feed failed)`);
  const p = getPrice(m.feedId);
  if (!p) throw new Error(`no price yet for ${marketId}`);
  if (Date.now() - p.fetchedAt > PRICE_STALE_MS) throw new Error(`stale price for ${marketId}`);
  return p.price;
}

/**
 * Reserved open interest for a market (notional, FXRP): booked notional of every
 * open position plus every committed-but-unexecuted order. Used to enforce the
 * per-market OI risk cap so no single market can over-lever the vAMM.
 */
export function marketReservedOiUsd(marketId: string): number {
  const st = getState();
  let oi = 0;
  for (const p of st.positions) {
    if (p.status === "open" && p.marketId === marketId) oi += p.sizeBase * p.entryPrice;
  }
  for (const o of st.orders) {
    if (o.status === "committed" && o.marketId === marketId) oi += o.marginUsd * o.leverage;
  }
  return oi;
}

export interface CommitParams {
  address: string;
  marketId: string;
  side: Side;
  marginUsd: number;
  leverage: number;
  privacyMode: PrivacyMode;
  orderType?: "market" | "limit";
  /** required for limit orders — the (hidden) trigger price. */
  limitPrice?: number;
  maxSlippageBps?: number;
}

/**
 * Step 1 — COMMIT. Locks margin, builds the SHA-256 order commitment, and (in
 * private mode) publishes ONLY the hash. Midnight deploy + authority proof run
 * as an async job. In public mode (the A/B foil) full params leak to /feed.
 */
export function commitOrder(p: CommitParams): { order: DorrOrder; jobId: string } {
  const m = marketById(p.marketId);
  if (!m) throw new Error(`unknown market ${p.marketId}`);
  if (!(p.marginUsd > 0)) throw new Error("marginUsd must be > 0");
  if (!(p.leverage >= 1 && p.leverage <= m.maxLeverage)) {
    throw new Error(`leverage must be 1..${m.maxLeverage}`);
  }
  const acct = account(p.address);
  const free = acct.balance - acct.locked;
  if (p.marginUsd > free) throw new Error(`insufficient free margin: ${free.toFixed(2)} FXRP`);

  // Per-market open-interest risk cap — keep any one market from over-levering the vAMM.
  const thisNotional = p.marginUsd * p.leverage;
  const reservedOi = marketReservedOiUsd(p.marketId);
  if (reservedOi + thisNotional > m.maxOiUsd) {
    throw new Error(
      `market ${p.marketId} open-interest cap reached (${reservedOi.toFixed(0)} + ${thisNotional.toFixed(0)} > ${m.maxOiUsd} FXRP) — reduce size or wait`,
    );
  }

  const indexPrice = freshIndexPrice(p.marketId);
  const orderType = p.orderType === "limit" ? "limit" : "market";
  if (orderType === "limit" && !(Number(p.limitPrice) > 0)) {
    throw new Error("limit order requires a positive limitPrice");
  }
  // The price bound into the commitment (and used for sizing) is the limit price
  // for limit orders, else the current index. It stays hidden — only the hash is public.
  const committedPrice = orderType === "limit" ? Number(p.limitPrice) : indexPrice;
  const sizeBase = computeSizeBase(p.marginUsd, p.leverage, committedPrice);

  const nonce = randomBytes(16).toString("hex");
  const commitment = orderCommitmentHex({
    pairId: p.marketId,
    side: p.side,
    price: committedPrice.toFixed(8),
    size: sizeBase.toFixed(8),
    leverage: p.leverage,
    margin: p.marginUsd.toFixed(2),
    nonce,
  });

  const order: DorrOrder = {
    id: randomBytes(8).toString("hex"),
    address: p.address,
    marketId: p.marketId,
    side: p.side,
    sizeBase,
    leverage: p.leverage,
    marginUsd: p.marginUsd,
    orderType,
    limitPrice: orderType === "limit" ? Number(p.limitPrice) : undefined,
    maxSlippageBps: p.maxSlippageBps != null ? Number(p.maxSlippageBps) : undefined,
    commitPrice: committedPrice,
    privacyMode: p.privacyMode,
    nonce,
    commitmentHash: commitment,
    status: "committed",
    createdAt: new Date().toISOString(),
    midnight: {},
  };

  acct.locked += p.marginUsd;
  getState().orders.push(order);
  getState().feed.push(
    publicFeedView({
      marketId: p.marketId,
      privacyMode: p.privacyMode,
      commitmentHash: commitment,
      createdAt: order.createdAt,
      side: p.side,
      sizeBase,
      leverage: p.leverage,
      address: p.address,
    }),
  );
  persist();
  logEvent({
    type: orderType === "limit" ? "limit-rest" : "commit",
    address: p.address,
    marketId: p.marketId,
    detail:
      orderType === "limit"
        ? `Private limit order rests — ${p.side} @ ${Number(p.limitPrice).toFixed(6)} (hidden; public sees only hash ${commitment.slice(0, 10)}…)`
        : `Committed ${p.privacyMode} ${p.side} order — public sees only hash ${commitment.slice(0, 10)}…`,
  });

  // The commitment IS the privacy primitive: the public sees SHA-256(fields‖nonce)
  // and nothing else, and the trader can later open it to a chosen auditor
  // (see disclosure.ts). Recording it is synchronous work that already happened
  // above, so the job reports it rather than inventing an async pipeline.
  const job = createJob("commit", order.id);
  const step = jobStep(job, "seal order commitment (public sees only the hash)");
  step.done({ detail: `commitment ${order.commitmentHash.slice(0, 16)}…` });
  completeJob(job);

  return { order, jobId: job.id };
}

/**
 * Step 2 — EXECUTE. Reveal already happened server-side (operator is the
 * trusted executor in v1): verify commitment, fill on the vAMM, open the
 * position. Matching attestation (ZK) runs async.
 */
export function executeOrder(orderId: string): { position: DorrPosition; jobId: string } {
  const st = getState();
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  if (order.status !== "committed") throw new Error(`order is ${order.status}`);

  // Reveal → verify gate: recompute the commitment from the stored preimage.
  // A mismatch means the order record was tampered with after commit — refuse.
  const check = orderCommitmentHex({
    pairId: order.marketId,
    side: order.side,
    price: order.commitPrice.toFixed(8),
    size: order.sizeBase.toFixed(8),
    leverage: order.leverage,
    margin: order.marginUsd.toFixed(2),
    nonce: order.nonce,
  });
  if (check !== order.commitmentHash) {
    order.status = "failed";
    persist();
    throw new Error("commitment verification failed — order preimage tampered");
  }

  // Oracle-divergence guard: refuse to fill when the vAMM mark has drifted too
  // far from the Pyth index (venue manipulation / stalled recenter). The pool
  // normally tracks the oracle within a few bps, so a large gap is anomalous.
  const mark = vamm.markPrice(order.marketId);
  const idx = getPrice(marketById(order.marketId)!.feedId)?.price;
  if (mark != null && idx != null && oracleDiverged(mark, idx)) {
    throw new Error(
      `oracle divergence ${divergenceBps(mark, idx).toFixed(1)}bps exceeds ${MAX_ORACLE_DIVERGENCE_BPS}bps — fill refused (venue mark ≠ oracle)`,
    );
  }

  // Slippage guard: preview the fill (no mutation); reject if it exceeds the
  // trader's tolerance vs the reference (limit price, or current index for market).
  if (order.maxSlippageBps != null) {
    const ref = order.orderType === "limit" && order.limitPrice ? order.limitPrice : freshIndexPrice(order.marketId);
    const previewPrice = vamm.previewFill(order.marketId, order.side, order.sizeBase);
    const slip = slippageBps(previewPrice, ref);
    if (slip > order.maxSlippageBps) {
      throw new Error(`slippage ${slip.toFixed(1)}bps exceeds max ${order.maxSlippageBps}bps — order left resting`);
    }
  }

  const fill = vamm.fill(order.marketId, order.side, order.sizeBase);
  order.status = "executed";
  order.executedFill = {
    avgPrice: fill.avgPrice,
    priceImpactBps: fill.priceImpactBps,
    notional: fill.notional,
  };

  const position: DorrPosition = {
    id: randomBytes(8).toString("hex"),
    orderId: order.id,
    address: order.address,
    marketId: order.marketId,
    side: order.side,
    sizeBase: order.sizeBase,
    entryPrice: fill.avgPrice,
    marginUsd: order.marginUsd,
    leverage: order.leverage,
    openedAt: new Date().toISOString(),
    fundingPaid: 0,
    status: "open",
  };
  st.positions.push(position);
  persist();
  logEvent({
    type: order.orderType === "limit" ? "limit-fill" : "execute",
    address: order.address,
    marketId: order.marketId,
    detail: `${order.orderType === "limit" ? "Limit order filled" : "Opened"} ${order.side} ${order.sizeBase.toFixed(2)} @ ${fill.avgPrice.toFixed(6)} · ${order.leverage}x`,
  });

  // The reveal→verify gate above already recomputed the commitment from the
  // stored preimage and refused any mismatch, so the fill is provably the order
  // that was committed. Report that, plus the price actually paid.
  const job = createJob("execute", position.id);
  const fillRecordHex = sha256(
    JSON.stringify({
      t: "dorr-fill",
      orderId: order.id,
      positionId: position.id,
      avgPrice: fill.avgPrice,
      sizeBase: order.sizeBase,
    }),
  );
  const step = jobStep(job, "verify commitment → fill on vAMM");
  step.done({
    detail: `filled @ ${fill.avgPrice.toFixed(6)} · impact ${fill.priceImpactBps.toFixed(1)} bps · fill ${fillRecordHex.slice(0, 16)}…`,
  });
  completeJob(job);

  return { position, jobId: job.id };
}

export function unrealizedPnl(pos: DorrPosition, mark: number): number {
  return pnlOf(pos.side, pos.entryPrice, mark, pos.sizeBase);
}

/**
 * Step 3 — CLOSE (or liquidate). Fills the opposite side on the vAMM, settles
 * PnL to the account, then runs the ZK settlement transition, anchors the
 * digest on Cardano preprod, and binds the anchor back on the order contract.
 */
export function closePosition(
  positionId: string,
  reason: "close" | "liquidated" | "stop-loss" | "take-profit" = "close",
  fraction = 1,
): { position: DorrPosition; jobId: string } {
  const st = getState();
  const pos = st.positions.find((x) => x.id === positionId);
  if (!pos) throw new Error("position not found");
  if (pos.status !== "open") throw new Error(`position is ${pos.status}`);
  const order = st.orders.find((o) => o.id === pos.orderId);

  const f = Math.max(0, Math.min(1, fraction));
  if (!(f > 0)) throw new Error("fraction must be in (0,1]");
  const closeSize = pos.sizeBase * f;
  const closeSide: Side = pos.side === "LONG" ? "SHORT" : "LONG";
  const fill = vamm.fill(pos.marketId, closeSide, closeSize);
  const exitPrice = fill.avgPrice;
  const pnl = pnlOf(pos.side, pos.entryPrice, exitPrice, closeSize);
  const fee = takerFee(fill.notional);
  const marginRelease = pos.marginUsd * f;
  const fundingPortion = pos.fundingPaid * f;

  const acct = account(pos.address);
  const settled = settledDeltaOf(pnl, fee, fundingPortion);
  acct.locked = Math.max(0, acct.locked - marginRelease);
  acct.balance = Math.max(0, acct.balance + settled);
  // Track realized PnL separately from collateral: the vault is the source of
  // truth for deposits/withdrawals, so the tradable balance is re-derived as
  // (on-chain vault balance + pnlCum) on every reconciliation.
  acct.pnlCum = (acct.pnlCum ?? 0) + settled;
  st.insuranceFundUsd += fee;
  pos.realizedPnlCum = (pos.realizedPnlCum ?? 0) + (pnl - fee);

  // ── PARTIAL close: shrink the position, settle PnL off-chain, keep it open ──
  if (f < 1 - 1e-9) {
    pos.sizeBase -= closeSize;
    pos.marginUsd -= marginRelease;
    pos.fundingPaid -= fundingPortion;
    persist();
    logEvent({
      type: "partial-close",
      address: pos.address,
      marketId: pos.marketId,
      detail: `Partial close ${(f * 100).toFixed(0)}% @ ${exitPrice.toFixed(6)} — realized ${(pnl - fee).toFixed(2)} FXRP`,
    });
    const pjob = createJob("close", pos.id);
    jobStep(pjob, `partial close ${(f * 100).toFixed(0)}% @ ${exitPrice.toFixed(6)}`).done({
      detail: `realized ${(pnl - fee).toFixed(2)} FXRP; ${pos.sizeBase.toFixed(4)} left open`,
    });
    completeJob(pjob);
    return { position: pos, jobId: pjob.id };
  }

  // ── FULL close: finalize, then run the ZK settlement + L1 anchor pipeline ──
  pos.status = reason === "liquidated" ? "liquidated" : "closed";
  pos.closeReason = reason;
  pos.closedAt = new Date().toISOString();
  pos.exitPrice = exitPrice;
  pos.realizedPnl = pos.realizedPnlCum;
  pos.settlement = {};
  persist();
  logEvent({
    type: reason === "close" ? "close" : reason,
    address: pos.address,
    marketId: pos.marketId,
    detail:
      (reason === "stop-loss" ? "🛡️ Stop-loss fired" :
        reason === "take-profit" ? "🎯 Take-profit hit" :
        reason === "liquidated" ? "⚔️ Liquidated" : "Closed") +
      ` @ ${exitPrice.toFixed(6)} — PnL ${(pos.realizedPnl ?? 0).toFixed(2)} FXRP`,
  });

  // Settlement digest: binds the order's commitment to the close record, so the
  // trader can prove *what* settled without revealing it. On-chain finality for
  // the confidential path is the sealed batch (DorrBatchSettlement.settleBatch),
  // which re-reads FTSO and rejects an out-of-band clearing price.
  const settlementId = `dorr-${pos.id}`;
  const closeRecordHex = sha256(
    JSON.stringify({
      t: "dorr-close",
      positionId: pos.id,
      exitPrice,
      realizedPnl: pos.realizedPnl,
      reason,
    }),
  );
  const initialHex = order?.commitmentHash ?? sha256(pos.id);
  const settlementDigest = sha256(Buffer.from(initialHex + closeRecordHex, "hex"));
  pos.settlement = { settlementId, settlementDigest };
  persist();

  const job = createJob("close", pos.id);
  const step = jobStep(job, "settle position → settlement digest");
  step.done({ detail: `digest ${settlementDigest.slice(0, 16)}… · PnL ${(pos.realizedPnl ?? 0).toFixed(2)} FXRP` });
  completeJob(job);

  return { position: pos, jobId: job.id };
}

/** Keeper: hourly funding — longs pay when vAMM mark > Pyth index (and vice versa). */
export function applyFundingTick(): void {
  const st = getState();
  for (const marketId of new Set(st.positions.filter((x) => x.status === "open").map((x) => x.marketId))) {
    const m = marketById(marketId);
    if (!m) continue;
    const idx = getPrice(m.feedId);
    const mark = vamm.markPrice(marketId);
    if (!idx || !mark) continue;
    const rate = fundingRate(mark, idx.price);
    for (const pos of st.positions.filter((x) => x.status === "open" && x.marketId === marketId)) {
      pos.fundingPaid += fundingPayment(pos.side, rate, pos.sizeBase, mark);
    }
    st.fundingHistory.push({
      marketId,
      rate,
      markPrice: mark,
      indexPrice: idx.price,
      at: new Date().toISOString(),
    });
  }
  persist();
}

/** Keeper: liquidate positions whose equity ratio drops under maintenance. */
export function scanLiquidations(): string[] {
  const st = getState();
  const liquidated: string[] = [];
  for (const pos of st.positions.filter((x) => x.status === "open")) {
    const m = marketById(pos.marketId);
    if (!m) continue;
    const p = getPrice(m.feedId);
    if (!p) continue;
    const ratio = equityRatio(pos.marginUsd, unrealizedPnl(pos, p.price), pos.fundingPaid, pos.sizeBase, p.price);
    if (isLiquidatable(ratio)) {
      try {
        closePosition(pos.id, "liquidated");
        liquidated.push(pos.id);
      } catch (e) {
        console.error(`[liq] failed for ${pos.id}: ${String(e)}`);
      }
    }
  }
  return liquidated;
}

/** Current liquidation price for a position (for the UI + risk display). */
export function liqPriceOf(pos: DorrPosition): number {
  return liquidationPrice(pos.side, pos.entryPrice, pos.sizeBase, pos.marginUsd, pos.fundingPaid);
}

/** Add (deltaUsd>0) or remove (deltaUsd<0) margin — adjusts leverage + liq price. */
export function adjustMargin(positionId: string, deltaUsd: number): DorrPosition {
  const st = getState();
  const pos = st.positions.find((x) => x.id === positionId);
  if (!pos) throw new Error("position not found");
  if (pos.status !== "open") throw new Error(`position is ${pos.status}`);
  const acct = account(pos.address);
  if (deltaUsd > 0) {
    const free = acct.balance - acct.locked;
    if (deltaUsd > free) throw new Error(`insufficient free margin: ${free.toFixed(2)} FXRP`);
    acct.locked += deltaUsd;
    pos.marginUsd += deltaUsd;
  } else if (deltaUsd < 0) {
    const remove = -deltaUsd;
    if (remove >= pos.marginUsd) throw new Error("cannot remove all margin");
    const m = marketById(pos.marketId);
    const mark = (m && getPrice(m.feedId)?.price) || pos.entryPrice;
    const newMargin = pos.marginUsd - remove;
    const ratio = equityRatio(newMargin, unrealizedPnl(pos, mark), pos.fundingPaid, pos.sizeBase, mark);
    if (ratio < MAINTENANCE_MARGIN * 1.5) throw new Error("removing that much margin would risk liquidation");
    pos.marginUsd = newMargin;
    acct.locked = Math.max(0, acct.locked - remove);
  } else {
    throw new Error("delta must be non-zero");
  }
  pos.leverage = (pos.sizeBase * pos.entryPrice) / pos.marginUsd;
  persist();
  logEvent({
    type: "margin",
    address: pos.address,
    marketId: pos.marketId,
    detail: `${deltaUsd > 0 ? "Added" : "Removed"} ${Math.abs(deltaUsd).toFixed(2)} FXRP margin — now ${pos.leverage.toFixed(1)}x`,
  });
  return pos;
}

/** Set hidden stop-loss / take-profit (null clears). Never public → no stop-hunting. */
export function setStops(
  positionId: string,
  stops: { stopLoss?: number | null; takeProfit?: number | null },
): DorrPosition {
  const st = getState();
  const pos = st.positions.find((x) => x.id === positionId);
  if (!pos) throw new Error("position not found");
  if (pos.status !== "open") throw new Error(`position is ${pos.status}`);
  if (stops.stopLoss !== undefined) pos.stopLossPrice = stops.stopLoss ?? undefined;
  if (stops.takeProfit !== undefined) pos.takeProfitPrice = stops.takeProfit ?? undefined;
  persist();
  // Keep the log generic — the exact levels stay hidden (that's the point).
  logEvent({
    type: "stops-set",
    address: pos.address,
    marketId: pos.marketId,
    detail: `Set hidden stop-loss / take-profit (private — not visible to anyone hunting stops)`,
  });
  return pos;
}

/**
 * Cancel a resting (committed, not-yet-executed) order — releases its locked
 * margin. Only the owner's committed orders can be cancelled; executed/failed/
 * already-cancelled orders are rejected.
 */
export function cancelOrder(orderId: string): DorrOrder {
  const st = getState();
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  if (order.status !== "committed") throw new Error(`cannot cancel a ${order.status} order`);
  const acct = account(order.address);
  acct.locked = Math.max(0, acct.locked - order.marginUsd);
  order.status = "cancelled";
  persist();
  logEvent({
    type: "cancel",
    address: order.address,
    marketId: order.marketId,
    detail:
      order.orderType === "limit"
        ? `Cancelled resting limit order — ${order.marginUsd.toFixed(2)} FXRP margin released`
        : `Cancelled committed order — ${order.marginUsd.toFixed(2)} FXRP margin released`,
  });
  return order;
}

/**
 * Per-order on-chain anchoring is not part of the Flare design.
 *
 * On Cardano each commitment got its own L1 datum. On Flare the public,
 * immutable record is the *batch*: DorrBatchSettlement stores the epoch's
 * membership root and uniform clearing price, which proves an order was in the
 * set without paying a transaction per order. Rather than leave a button that
 * can only ever fail, this refuses with the path that actually exists.
 */
export async function anchorOrderCommitment(
  orderId: string,
): Promise<{ txHash: string; order: DorrOrder }> {
  const st = getState();
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  throw new Error(
    "per-order anchoring isn't used on Flare — seal the order into an epoch and the batch " +
      "settlement records its membership root on-chain",
  );
}

// ─── sealed-bid batch auction: the operator-blind execution path ──────────────

/**
 * Record a cleared epoch on Flare via DorrBatchSettlement.
 *
 * The contract is the referee, not us: it re-reads FTSO v2 itself and reverts
 * `PriceOutOfBand` if our uniform price deviates beyond `maxDriftBps`, and it
 * verifies the enclave's quote is bound to this exact payload. We forward no
 * per-trader deltas here — the epoch's membership root and single clearing
 * price are what make the batch auditable.
 *
 * Skipped (with a logged reason) when the Flare contracts or the enclave key
 * aren't configured, so a misconfigured environment is visible rather than
 * silently degrading to "no on-chain record".
 */
async function settleEpochOnFlare(p: {
  batchId: string;
  marketId: string;
  membershipRoot: string;
  clearingPrice: number;
  orderCount: number;
}): Promise<void> {
  const hex32 = (s: string): Hex => (s.startsWith("0x") ? s : `0x${s}`) as Hex;
  const market = marketById(p.marketId);
  // The activity log is read by humans, so translate the contract's custom-error
  // selectors instead of surfacing a raw decoder failure.
  const REVERTS: Record<string, string> = {
    "0xd9de081b": "the clearing price was out of band with the FTSO feed, so the contract rejected the batch",
    "0x46ad167c": "this epoch was already settled on-chain",
    "0x99efb890": "the enclave attestation did not verify for this batch",
    "0xee3f86a1": "the FTSO feed was too stale to settle against",
    "0xc2e5347d": "the batch was empty",
    "0xff633a38": "trader and delta lists did not line up",
  };
  const explain = (e: unknown): string => {
    const msg = String(e instanceof Error ? e.message : e);
    for (const [sel, text] of Object.entries(REVERTS)) if (msg.includes(sel)) return text;
    return msg.slice(0, 160);
  };
  try {
    if (!flareConfigured()) throw new Error("Flare contracts not configured");
    if (!enclaveConfigured()) throw new Error("enclave signing key not configured");
    if (!market) throw new Error(`unknown market ${p.marketId}`);

    // epochId must be unique per settled batch; derive it from the batch identity.
    const epochId = hex32(sha256(p.batchId));
    const membershipRoot = hex32(p.membershipRoot);
    const clearingPrice1e6 = usdToUnits(p.clearingPrice);

    const quote = await signBatchQuote({
      epochId,
      membershipRoot,
      clearingPrice: clearingPrice1e6,
      orderCount: p.orderCount,
    });

    const res = await settleBatchOnChain({
      epochId,
      membershipRoot,
      clearingPrice: clearingPrice1e6,
      feedId: market.feedId as Hex,
      orderCount: p.orderCount,
      traders: [],
      deltas: [],
      attestation: quote.attestation,
    });

    const s = getState();
    s.anchors.push({
      settlementId: p.batchId,
      txHash: res.txHash,
      commitmentHex: p.membershipRoot,
      at: new Date().toISOString(),
    });
    persist();
    logEvent({
      type: "anchor",
      marketId: p.marketId,
      detail:
        `Sealed batch settled on Flare at one uniform price — the contract re-read FTSO ` +
        `and verified the enclave quote before accepting it`,
      txHash: res.txHash,
      chain: "flare-coston2",
    });
  } catch (e) {
    // Traders' fills already succeeded; surface why the on-chain record is missing.
    logEvent({
      type: "anchor",
      marketId: p.marketId,
      detail: `Batch cleared, but not recorded on Flare — ${explain(e)}`,
    });
  }
}

/**
 * Accept a timelock-SEALED order. The operator stores only ciphertext + a
 * commitment and CANNOT read the contents until the epoch's drand round lands.
 * A public upper bound on margin (`maxMarginUsd`) is locked; the sealed order's
 * true margin must be ≤ it (only the bound leaks — exact side/size/price stay
 * sealed). The order joins the market's next epoch and clears at a uniform price.
 */
export function addSealedOrder(p: {
  address: string;
  marketId: string;
  commitment: string;
  ciphertext: string;
  targetRound: number;
  maxMarginUsd: number;
}): SealedOrder {
  const m = marketById(p.marketId);
  if (!m) throw new Error(`unknown market ${p.marketId}`);
  if (!/^[0-9a-f]{64}$/i.test(p.commitment)) throw new Error("commitment must be 32-byte hex");
  if (!p.ciphertext || p.ciphertext.length < 32) throw new Error("ciphertext required (timelock-sealed)");
  if (!(p.maxMarginUsd > 0)) throw new Error("maxMarginUsd must be > 0");
  if (!(p.targetRound > 0)) throw new Error("targetRound must be a positive drand round");
  const acct = account(p.address);
  const free = acct.balance - acct.locked;
  if (p.maxMarginUsd > free) throw new Error(`insufficient free margin: ${free.toFixed(2)} FXRP`);

  const so: SealedOrder = {
    id: randomBytes(8).toString("hex"),
    address: p.address,
    marketId: p.marketId,
    commitment: p.commitment.toLowerCase(),
    ciphertext: p.ciphertext,
    targetRound: p.targetRound,
    epochId: `${p.marketId}@${p.targetRound}`,
    maxMarginUsd: p.maxMarginUsd,
    status: "sealed",
    createdAt: new Date().toISOString(),
  };
  acct.locked += p.maxMarginUsd;
  const st = getState();
  st.sealedOrders.push(so);
  // The public sees ONLY the commitment — never side/size/price (and neither can the operator, yet).
  st.feed.push({ at: so.createdAt, marketId: p.marketId, privacyMode: "private", commitmentHash: so.commitment });
  persist();
  logEvent({
    type: "seal",
    address: p.address,
    marketId: p.marketId,
    detail: `Sealed order to drand round ${p.targetRound} — operator can't read it until then (hash ${so.commitment.slice(0, 10)}…)`,
  });
  return so;
}

export interface SealedBatchResult {
  marketId: string;
  currentRound: number;
  opened: number;
  cleared: number;
  dropped: number;
  clearingPrice?: number;
  membershipRoot?: string;
  positions: string[];
}

/**
 * Settle every SEALED order for a market whose drand round has landed: decrypt
 * (now possible), verify each commitment, drop tamper/over-bound orders, then
 * clear the survivors at ONE uniform price against the live vAMM and open a
 * position each at that single price. Orders whose round hasn't landed stay
 * sealed. Async — talks to the real drand network.
 */
export async function settleSealedBatch(marketId: string): Promise<SealedBatchResult> {
  const st = getState();
  const snap = vamm.snapshot(marketId);
  if (!snap) return { marketId, currentRound: 0, opened: 0, cleared: 0, dropped: 0, positions: [] };
  const now = await currentRound();
  const ripe = st.sealedOrders.filter(
    (o) => o.marketId === marketId && o.status === "sealed" && o.targetRound <= now,
  );
  if (ripe.length === 0) return { marketId, currentRound: now, opened: 0, cleared: 0, dropped: 0, positions: [] };

  const inputs: SealedInput[] = ripe.map((o) => ({
    id: o.id, address: o.address, marketId: o.marketId, commitment: o.commitment, ciphertext: o.ciphertext, targetRound: o.targetRound,
  }));
  const settlement = await settleSealedEpoch(marketId, inputs, {
    base: snap.virtualBase, quote: snap.virtualQuote, k: snap.k,
  });

  const releaseBound = (so: SealedOrder) => {
    const acct = account(so.address);
    acct.locked = Math.max(0, acct.locked - so.maxMarginUsd);
  };

  // Split opened results into valid (open a position) and dropped (release margin).
  const valid: Array<{ so: SealedOrder; side: Side; sizeBase: number; marginUsd: number; leverage: number }> = [];
  let dropped = 0;
  for (const o of settlement.opened) {
    const so = ripe.find((r) => r.id === o.id)!;
    if (o.ok && o.preimage) {
      if (o.preimage.marginUsd > so.maxMarginUsd + 1e-6) {
        so.status = "dropped"; so.droppedReason = "margin exceeds sealed bound"; releaseBound(so); dropped++;
      } else {
        valid.push({ so, side: o.preimage.side, sizeBase: o.preimage.sizeBase, marginUsd: o.preimage.marginUsd, leverage: o.preimage.leverage });
      }
    } else {
      so.status = "dropped"; so.droppedReason = o.reason ?? "invalid"; releaseBound(so); dropped++;
    }
  }

  const positions: string[] = [];
  let clearingPrice: number | undefined;
  if (valid.length > 0) {
    // Re-clear on a fresh snapshot at apply-time (the keeper may have recentered).
    const fresh = vamm.snapshot(marketId)!;
    const cleared = clearBatchUniform(
      { base: fresh.virtualBase, quote: fresh.virtualQuote, k: fresh.k },
      valid.map((v) => ({ id: v.so.id, side: v.side, sizeBase: v.sizeBase })),
    );
    clearingPrice = cleared.clearingPrice;
    // Apply the net imbalance to the real pool as ONE fill — matched volume crosses
    // internally at zero impact, so only the residual walks the curve.
    if (Math.abs(cleared.netImbalanceBase) > 1e-9) {
      vamm.fill(marketId, cleared.netImbalanceBase > 0 ? "LONG" : "SHORT", Math.abs(cleared.netImbalanceBase));
    }
    for (const v of valid) {
      const position: DorrPosition = {
        id: randomBytes(8).toString("hex"),
        orderId: v.so.id,
        address: v.so.address,
        marketId,
        side: v.side,
        sizeBase: v.sizeBase,
        entryPrice: clearingPrice,
        marginUsd: v.marginUsd,
        leverage: v.leverage,
        openedAt: new Date().toISOString(),
        fundingPaid: 0,
        status: "open",
      };
      st.positions.push(position);
      // release the unused portion of the locked bound; the rest backs the position
      const acct = account(v.so.address);
      acct.locked = Math.max(0, acct.locked - (v.so.maxMarginUsd - v.marginUsd));
      v.so.status = "cleared"; v.so.positionId = position.id; v.so.clearingPrice = clearingPrice; v.so.settledAt = new Date().toISOString();
      positions.push(position.id);
    }

    // Settle the epoch on Flare: DorrBatchSettlement independently re-reads the
    // FTSO v2 feed and reverts if our clearing price is out of band, and it
    // verifies the enclave quote is bound to THIS payload. That makes the
    // epoch's order set and its single price publicly auditable, and it is the
    // chain — not the operator — that enforces both. Fire-and-forget so a slow
    // block never blocks the traders' fills, but failures are logged, never
    // silently swallowed.
    const batchId = `sealbatch:${marketId}@${now}`;
    void settleEpochOnFlare({
      batchId,
      marketId,
      membershipRoot: settlement.membershipRoot,
      clearingPrice,
      orderCount: valid.length,
    });
  }

  persist();
  if (valid.length || dropped) {
    logEvent({
      type: "batch-settle",
      marketId,
      detail: `Sealed epoch settled — ${valid.length} order(s) cleared at one price ${clearingPrice?.toFixed(6) ?? "n/a"}${dropped ? `, ${dropped} dropped` : ""} · batch root ${settlement.membershipRoot.slice(0, 10)}…`,
    });
  }
  return {
    marketId,
    currentRound: now,
    opened: settlement.opened.length,
    cleared: valid.length,
    dropped,
    clearingPrice,
    membershipRoot: settlement.membershipRoot,
    positions,
  };
}

/** Keeper: trigger resting limit orders when Pyth crosses their (hidden) price. */
export function scanLimitOrders(): string[] {
  const st = getState();
  const triggered: string[] = [];
  for (const o of st.orders.filter((x) => x.status === "committed" && x.orderType === "limit" && x.limitPrice)) {
    const m = marketById(o.marketId);
    if (!m) continue;
    const p = getPrice(m.feedId);
    if (!p) continue;
    if (limitTriggered(o.side, o.limitPrice!, p.price)) {
      try {
        executeOrder(o.id);
        triggered.push(o.id);
      } catch {
        // slippage or transient — order stays resting, retried next tick
      }
    }
  }
  return triggered;
}

/** Keeper: close positions whose hidden SL/TP is crossed by the index. */
export function scanStops(): Array<{ id: string; reason: string }> {
  const st = getState();
  const out: Array<{ id: string; reason: string }> = [];
  for (const pos of st.positions.filter(
    (x) => x.status === "open" && (x.stopLossPrice != null || x.takeProfitPrice != null),
  )) {
    const m = marketById(pos.marketId);
    if (!m) continue;
    const p = getPrice(m.feedId);
    if (!p) continue;
    const hit = stopTriggered(pos.side, p.price, pos.stopLossPrice, pos.takeProfitPrice);
    if (hit) {
      try {
        closePosition(pos.id, hit);
        out.push({ id: pos.id, reason: hit });
      } catch (e) {
        console.error(`[stops] failed for ${pos.id}: ${String(e)}`);
      }
    }
  }
  return out;
}
