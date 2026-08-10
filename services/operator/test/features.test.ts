/**
 * The winning perps features, end-to-end in-process: private limit orders that
 * rest invisibly then trigger, hidden stop-loss/take-profit, partial close,
 * add/remove margin, and the slippage guard.
 */

import { test, expect, beforeAll } from "bun:test";

const USER = "addr_test1qqfeatureuser";
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
  vamm.seedPool(markets.marketById(FLR)!, p); // simulate keeper recenter to the new price
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

test("private LIMIT order rests invisibly, then triggers when price crosses", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);

  // LONG limit to buy at 0.14 — current price 0.15, so it should NOT fill yet.
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5,
    privacyMode: "private", orderType: "limit", limitPrice: 0.14,
  }));
  expect(commit.success).toBe(true);
  await pollJob(commit.jobId);

  // it's resting, and the public feed shows only a hash (limit price hidden)
  const resting = await j(await get(`/orders/resting/${USER}`));
  expect(resting.orders.length).toBe(1);
  const feed = await j(await get("/feed"));
  expect(feed.feed[0].leaked).toBeUndefined();
  // no position yet
  expect((await j(await get(`/positions/${USER}`))).positions.length).toBe(0);

  // keeper scan at 0.15 → still resting
  expect(trading.scanLimitOrders().length).toBe(0);

  // price drops to 0.139 (< 0.14) → keeper triggers it
  setPrice(0.139);
  const triggered = trading.scanLimitOrders();
  expect(triggered).toContain(commit.orderId);
  const positions = (await j(await get(`/positions/${USER}`))).positions;
  expect(positions.length).toBe(1);
  expect(positions[0].status).toBe("open");
});

test("hidden STOP-LOSS closes the position when price crosses (anti stop-hunting)", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  await pollJob(exe.jobId);

  // set a hidden stop-loss at 0.145 — never appears in the public feed
  await post(`/positions/${exe.position.id}/stops`, { stopLoss: 0.145 });
  const feedJson = JSON.stringify(await j(await get("/feed")));
  expect(feedJson.includes("0.145")).toBe(false); // the stop is invisible

  // keeper scan at 0.15 → not hit
  expect(trading.scanStops().length).toBe(0);
  // price drops to 0.144 → stop-loss fires
  setPrice(0.144);
  const fired = trading.scanStops();
  expect(fired[0]).toMatchObject({ id: exe.position.id, reason: "stop-loss" });
  const pos = (await j(await get(`/positions/${USER}`))).positions.find((p: any) => p.id === exe.position.id);
  expect(pos.status).toBe("closed");
  expect(pos.closeReason).toBe("stop-loss");
});

test("PARTIAL close halves the position and settles proportional PnL", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  await pollJob(exe.jobId);
  const sizeBefore = exe.position.sizeBase;

  const half = await j(await post(`/positions/${exe.position.id}/close`, { fraction: 0.5 }));
  expect(half.success).toBe(true);
  const pos = (await j(await get(`/positions/${USER}`))).positions.find((p: any) => p.id === exe.position.id);
  expect(pos.status).toBe("open");
  expect(pos.sizeBase).toBeCloseTo(sizeBefore / 2, 4);
  expect(pos.marginUsd).toBeCloseTo(500, 2);
});

test("ADD margin lowers leverage + moves liq price; over-removal is refused", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  setPrice(0.15);
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 1000, leverage: 10, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  await pollJob(exe.jobId);

  const before = (await j(await get(`/positions/${USER}`))).positions[0];
  const added = await j(await post(`/positions/${exe.position.id}/margin`, { delta: 1000 }));
  expect(added.position.marginUsd).toBeCloseTo(2000, 2);
  expect(added.position.leverage).toBeLessThan(before.leverage); // more margin → less leverage

  const bad = await post(`/positions/${exe.position.id}/margin`, { delta: -1999 });
  expect(bad.status).toBe(400); // would risk liquidation
});

test("SLIPPAGE guard rejects a fill worse than tolerance, order stays resting", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 500_000 });
  setPrice(0.15);
  // large (but within pool depth) size + 1bp tolerance → the fill's impact blows past it
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: FLR, side: "LONG", marginUsd: 50_000, leverage: 5, privacyMode: "private", maxSlippageBps: 1,
  }));
  await pollJob(commit.jobId);
  const exe = await post(`/orders/${commit.orderId}/execute`);
  expect(exe.status).toBe(400);
  expect((await j(exe)).error).toContain("slippage");
  // still committed (resting), no position opened
  const o = await j(await get(`/orders/${commit.orderId}`));
  expect(o.status).toBe("committed");
});
