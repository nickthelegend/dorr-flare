/**
 * The v2 hackathon features, unit + in-process integration:
 *   • batch auction — uniform clearing price makes a sandwich net $0 (structural)
 *   • oracle-divergence guard — a fill is refused when the venue mark ≠ oracle
 *   • cancel — a resting order is cancellable and releases its margin
 *   • stats — open interest / skew / funding surface correctly
 *   • batch preview — resting committed orders clear at one uniform price
 *   • liquidation + funding keepers — driven through the real scan functions
 */

import { test, expect, beforeAll } from "bun:test";
import { clearBatchUniform, runBatchAuctionDemo, batchDigest, type BatchOrder } from "../src/batch.js";
import { divergenceBps, oracleDiverged, MAX_ORACLE_DIVERGENCE_BPS } from "../src/trading-math.js";

const USER = "addr_test1qqv2user";
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
let pyth: typeof import("../src/ftso.js");
let vamm: typeof import("../src/vamm.js");
let trading: typeof import("../src/trading.js");
let markets: typeof import("../src/markets.js");
const FLR = "FLR-USD";
let flrFeed: string;

const j = async (r: Response) => (await r.json()) as any;
const post = (p: string, b?: unknown) =>
  app.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
const get = (p: string) => app.request(p);
async function pollJob(id: string) {
  for (let i = 0; i < 60; i++) {
    const job = await j(await get(`/jobs/${id}`));
    if (job.status === "complete" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("job stuck");
}
function setPrice(p: number) {
  pyth._setPriceForTest(flrFeed, p);
  vamm.seedPool(markets.marketById(FLR)!, p);
}

beforeAll(async () => {
  markets = await import("../src/markets.js");
  pyth = await import("../src/ftso.js");
  vamm = await import("../src/vamm.js");
  trading = await import("../src/trading.js");
  await (await import("../src/state.js")).loadState();
  flrFeed = markets.marketById(FLR)!.feedId;
  setPrice(0.15);
  app = (await import("../src/routes.js")).app;
});

// ─── batch auction (pure) ────────────────────────────────────────────────────
test("BATCH: a balanced epoch clears at spot with zero pool impact", () => {
  const pool = { base: 1_000_000, quote: 150_000, k: 1_000_000 * 150_000 };
  const spot = pool.quote / pool.base;
  const orders: BatchOrder[] = [
    { id: "a", side: "LONG", sizeBase: 10_000 },
    { id: "b", side: "SHORT", sizeBase: 10_000 },
  ];
  const c = clearBatchUniform(pool, orders);
  expect(c.netImbalanceBase).toBeCloseTo(0, 6);
  expect(c.matchedBase).toBeCloseTo(10_000, 6);
  expect(c.clearingPrice).toBeCloseTo(spot, 8);
  expect(c.impactBps).toBeCloseTo(0, 6);
  // pool untouched
  expect(c.reservesAfter.base).toBeCloseTo(pool.base, 6);
});

test("BATCH: every order in the epoch settles at ONE uniform price", () => {
  const pool = { base: 1_000_000, quote: 150_000, k: 1_000_000 * 150_000 };
  const orders: BatchOrder[] = [
    { id: "a", side: "LONG", sizeBase: 30_000 },
    { id: "b", side: "LONG", sizeBase: 5_000 },
    { id: "c", side: "SHORT", sizeBase: 12_000 },
  ];
  const c = clearBatchUniform(pool, orders);
  const prices = new Set(c.fills.map((f) => f.price));
  expect(prices.size).toBe(1); // exactly one clearing price for the whole epoch
  expect(c.netImbalanceBase).toBeCloseTo(23_000, 6); // 35k long − 12k short
  expect(c.clearingPrice).toBeGreaterThan(c.spotPrice); // net buying lifts price
  expect(batchDigest(c)).toMatch(/^[0-9a-f]{64}$/);
});

test("BATCH: net-short epoch clears BELOW spot", () => {
  const pool = { base: 1_000_000, quote: 150_000, k: 1_000_000 * 150_000 };
  const c = clearBatchUniform(pool, [
    { id: "a", side: "SHORT", sizeBase: 40_000 },
    { id: "b", side: "LONG", sizeBase: 5_000 },
  ]);
  expect(c.netImbalanceBase).toBeCloseTo(-35_000, 6);
  expect(c.clearingPrice).toBeLessThan(c.spotPrice);
});

test("BATCH DEMO: a sandwich nets ~$0 under uniform clearing, but profits sequentially", () => {
  setPrice(0.15);
  const r = runBatchAuctionDemo({ marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 10, botMultiple: 2 });
  // In the batch, the bot's front-run and back-run clear at the SAME price → $0.
  expect(Math.abs(r.attack.botProfitUsd)).toBeLessThan(1e-6);
  expect(r.attack.botBuyPrice).toBeCloseTo(r.attack.botSellPrice, 10);
  // The victim pays essentially the same with or without the bot present.
  expect(Math.abs(r.attack.victimExtraCostUsd)).toBeLessThan(1e-6);
  // The identical sandwich on a sequential venue profits the bot and taxes the victim.
  expect(r.sequential.botProfitUsd).toBeGreaterThan(0);
  expect(Math.abs(r.sequential.victimExtraCostUsd)).toBeGreaterThan(0);
});

test("BATCH endpoint /demo/batch returns the contrast", async () => {
  setPrice(0.15);
  const r = await j(await post("/demo/batch", { marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 10 }));
  expect(r.epoch.orders.length).toBeGreaterThan(1);
  expect(Math.abs(r.attack.botProfitUsd)).toBeLessThan(1e-6);
  expect(r.sequential.botProfitUsd).toBeGreaterThan(0);
  // the public commitments in the epoch leak nothing but a hash prefix
  for (const o of r.epoch.orders) expect(o.commitment).toMatch(/^[0-9a-f]{18}…$/);
});

// ─── oracle-divergence guard ─────────────────────────────────────────────────
test("ORACLE GUARD (pure): flags a mark that drifts past the threshold", () => {
  expect(divergenceBps(0.15, 0.15)).toBeCloseTo(0, 6);
  expect(divergenceBps(0.153, 0.15)).toBeCloseTo(200, 3); // 3% of... 0.003/0.15 = 2% = 200bps
  expect(oracleDiverged(0.15, 0.15)).toBe(false);
  expect(oracleDiverged(0.16, 0.15)).toBe(true); // ~667bps
  expect(oracleDiverged(0.15 * (1 + (MAX_ORACLE_DIVERGENCE_BPS + 1) / 10_000), 0.15)).toBe(true);
});

test("ORACLE GUARD (wired): execute is refused when the venue mark ≠ oracle", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 500_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  // Skew the live pool far from the oracle (simulate manipulation / stalled recenter).
  vamm.fill(FLR, "LONG", vamm.getPool(FLR)!.virtualBase * 0.2);
  const exe = await post(`/orders/${commit.orderId}/execute`);
  expect(exe.status).toBe(400);
  expect((await j(exe)).error).toContain("divergence");
  // order left resting, margin still locked
  expect((await j(await get(`/orders/${commit.orderId}`))).status).toBe("committed");
});

// ─── cancel a resting order ──────────────────────────────────────────────────
test("CANCEL: a resting order is cancellable and releases its margin", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5,
    privacyMode: "private", orderType: "limit", limitPrice: 0.14,
  }));
  await pollJob(commit.jobId);
  // margin locked
  expect((await j(await get(`/account/${USER}`))).locked).toBeCloseTo(1000, 2);

  const cancel = await j(await post(`/orders/${commit.orderId}/cancel`));
  expect(cancel.success).toBe(true);
  expect(cancel.order.status).toBe("cancelled");
  // margin released, order no longer resting
  expect((await j(await get(`/account/${USER}`))).locked).toBeCloseTo(0, 2);
  expect((await j(await get(`/orders/resting/${USER}`))).orders.length).toBe(0);

  // cancelling again is refused
  const again = await post(`/orders/${commit.orderId}/cancel`);
  expect(again.status).toBe(400);
});

test("CANCEL: an executed order cannot be cancelled", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  await pollJob(exe.jobId);
  const cancel = await post(`/orders/${commit.orderId}/cancel`);
  expect(cancel.status).toBe(400);
  expect((await j(cancel)).error).toContain("cannot cancel");
});

// ─── stats ───────────────────────────────────────────────────────────────────
test("STATS: open interest, skew and funding surface after a trade", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 100_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 2000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  await pollJob(exe.jobId);

  const stats = await j(await get("/stats"));
  const ada = stats.markets.find((m: any) => m.id === FLR);
  expect(ada.openPositions).toBe(1);
  expect(ada.longOiUsd).toBeGreaterThan(0);
  expect(ada.shortOiUsd).toBe(0);
  expect(ada.skewUsd).toBeGreaterThan(0); // net long
  expect(stats.global.openPositions).toBe(1);
  expect(stats.global.volumeUsd).toBeGreaterThan(0);
  expect(stats.global.tvlUsd).toBeGreaterThan(0);
});

// ─── per-market open-interest risk cap ───────────────────────────────────────
test("RISK CAP: per-market open-interest cap rejects over-commitment", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 2_000_000 });
  setPrice(0.15);
  // FLR cap is 500k notional. 90k margin × 5 = 450k notional → OK.
  const a = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 90_000, leverage: 5, privacyMode: "private",
  }));
  expect(a.success).toBe(true);
  // +20k × 5 = 100k → 550k total > 500k cap → rejected.
  const b = await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 20_000, leverage: 5, privacyMode: "private",
  });
  expect(b.status).toBe(400);
  expect((await j(b)).error).toContain("open-interest cap");
  // stats expose the cap + utilization
  const ada = (await j(await get("/stats"))).markets.find((m: any) => m.id === FLR);
  expect(ada.maxOiUsd).toBe(500_000);
});

// ─── batch preview over real resting orders ──────────────────────────────────
test("BATCH PREVIEW: resting committed orders clear at one uniform price", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 200_000 });
  await post("/demo/seed", { address: USER + "2", dusd: 200_000 });
  setPrice(0.15);
  // two committed market orders, opposite sides, left un-executed (resting epoch)
  const a = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 3000, leverage: 4, privacyMode: "private",
  }));
  const b = await j(await post("/orders/commit", {
    address: USER + "2", marketId: FLR, side: "SHORT", marginUsd: 1000, leverage: 4, privacyMode: "private",
  }));
  await pollJob(a.jobId);
  await pollJob(b.jobId);

  const prev = await j(await get(`/batch/preview?marketId=${FLR}`));
  expect(prev.epochOrders).toBe(2);
  const prices = new Set(prev.clearing.fills.map((f: any) => f.price));
  expect(prices.size).toBe(1); // one uniform clearing price
  expect(prev.clearing.matchedBase).toBeGreaterThan(0); // long/short cross internally
  expect(prev.digest).toMatch(/^[0-9a-f]{64}$/);
});

// ─── liquidation keeper (wired) ──────────────────────────────────────────────
test("LIQUIDATION: the keeper closes a position that falls below maintenance margin", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);

  // 10x LONG — a ~10% adverse move wipes the margin well past the 5% floor.
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 10, privacyMode: "private",
  }));
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  const posId = exe.position.id;
  expect(exe.position.status).toBe("open");

  // Nothing to do while the position is healthy.
  expect(trading.scanLiquidations()).toEqual([]);

  // Crash the index; the keeper re-reads it exactly as it does in production.
  setPrice(0.12);
  const liquidated = trading.scanLiquidations();
  expect(liquidated).toContain(posId);

  const after = await j(await get(`/positions/${USER}`));
  const pos = after.positions.find((p: any) => p.id === posId);
  expect(pos.status).toBe("liquidated");
  expect(pos.closeReason).toBe("liquidated");

  // Margin is released back to free (no longer locked against a dead position).
  const acct = await j(await get(`/account/${USER}`));
  expect(acct.locked).toBe(0);

  // Liquidating twice is a no-op — a closed position is never re-liquidated.
  expect(trading.scanLiquidations()).toEqual([]);
});

test("LIQUIDATION: a healthy position is left alone", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);

  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 2, privacyMode: "private",
  }));
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));

  // 2x leverage: a 1% dip is nowhere near the maintenance floor.
  setPrice(0.1485);
  expect(trading.scanLiquidations()).toEqual([]);

  const after = await j(await get(`/positions/${USER}`));
  expect(after.positions.find((p: any) => p.id === exe.position.id).status).toBe("open");
});

// ─── funding keeper (wired) ──────────────────────────────────────────────────
test("FUNDING: the tick accrues on open positions and records history", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);

  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 5, privacyMode: "private",
  }));
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  expect(exe.position.fundingPaid).toBe(0);

  // Push the vAMM mark above the index so the premium — and therefore the
  // funding rate — is unambiguously positive: longs pay.
  vamm.fill(FLR, "LONG", 200_000);
  const markBefore = vamm.markPrice(FLR)!;
  expect(markBefore).toBeGreaterThan(0.15);

  trading.applyFundingTick();

  const after = await j(await get(`/positions/${USER}`));
  const pos = after.positions.find((p: any) => p.id === exe.position.id);
  expect(pos.fundingPaid).toBeGreaterThan(0); // long pays into a positive premium

  const stats = await j(await get("/stats"));
  const flr = stats.markets.find((m: any) => m.id === FLR);
  expect(flr.fundingRateHourly).toBeGreaterThan(0);
});

// ─── attack lab runs for real ────────────────────────────────────────────────
test("ATTACK LAB: the sandwich is a REAL fill sequence that restores the pool exactly", async () => {
  setPrice(0.15);
  const before = (await j(await get("/markets"))).markets.find((m: any) => m.id === FLR).markPrice;

  const lab = await j(await post("/demo/attack", {
    marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 10,
  }));

  // The bot really profited off the victim on the live curve.
  expect(lab.publicRun.botProfitUsd).toBeGreaterThan(0);
  expect(lab.publicRun.victimExtraCostUsd).toBeGreaterThan(0);
  expect(lab.publicRun.victimEntry).toBeGreaterThan(lab.privateRun.victimEntry);

  // …and the live pool is byte-for-byte where it started: no real trader moved.
  const after = (await j(await get("/markets"))).markets.find((m: any) => m.id === FLR).markPrice;
  expect(after).toBeCloseTo(before, 10);
});

test("ATTACK LAB: the brute-force is real work, not a constant", async () => {
  setPrice(0.15);
  const lab = await j(await post("/demo/attack", {
    marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 10,
  }));

  expect(lab.privateRun.bruteForceAttempts).toBe(25_000);
  expect(lab.privateRun.bruteForceMatches).toBe(0);
  // Measured, not authored: 25k SHA-256 commitments cannot take zero time.
  expect(lab.privateRun.bruteForceMs).toBeGreaterThan(0);
  expect(lab.privateRun.bruteForceRatePerSec).toBeGreaterThan(0);

  // Two runs commit to different nonces, so the hash differs every time.
  const again = await j(await post("/demo/attack", {
    marketId: FLR, side: "LONG", marginUsd: 1_000, leverage: 10,
  }));
  expect(again.privateRun.commitmentHash).not.toBe(lab.privateRun.commitmentHash);
});
