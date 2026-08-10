/**
 * In-process integration test of the full trade lifecycle + privacy, driven
 * through the real Hono routes via app.request — no network, no browser.
 * ZK proofs and the L1 anchor are replaced by env-gated test doubles
 * (DORR_ZK_MODE=stub, DORR_TEST=1) so this runs in milliseconds; the REAL
 * proofs + on-chain txs are covered by the live E2E (onchain-e2e).
 */
process.env.DORR_ZK_MODE = "stub";
process.env.DORR_TEST = "1";
// auth stays off here (DORR_AUTH unset) — auth is pinned in auth.test.ts.

import { test, expect, beforeAll } from "bun:test";

const USER = "addr_test1qqintegrationuser";
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

const j = async (r: Response) => (await r.json()) as any;
const post = (path: string, body?: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const get = (path: string) => app.request(path);

async function pollJob(id: string, tries = 40): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const job = await j(await get(`/jobs/${id}`));
    if (job.status === "complete" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not settle`);
}

beforeAll(async () => {
  const markets = await import("../src/markets.js");
  const pyth = await import("../src/ftso.js");
  const vamm = await import("../src/vamm.js");
  const { loadState } = await import("../src/state.js");
  loadState();
  // Deterministic prices + seeded pools for every market (offline).
  for (const m of markets.MARKETS) {
    const price = m.base === "BTC" ? 60000 : m.base === "ETH" ? 1600 : m.base === "SOL" ? 78 : m.base === "FLR" ? 0.15 : 0.07;
    pyth._setPriceForTest(m.feedId, price);
    vamm.seedPool(m, price);
  }
  app = (await import("../src/routes.js")).app;
  await post("/demo/reset");
});

test("private trade lifecycle: commit → execute → close, fully wired", async () => {
  await post("/demo/reset");
  const seeded = await j(await post("/demo/seed", { address: USER, dusd: 50_000 }));
  expect(seeded.balance).toBe(50_000);

  // COMMIT (private)
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: "FLR-USD", side: "LONG", marginUsd: 1_000, leverage: 5, privacyMode: "private",
  }));
  expect(commit.success).toBe(true);
  expect(commit.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(commit.sizeBase).toBeGreaterThan(0);

  // margin locked
  const acct1 = await j(await get(`/account/${USER}`));
  expect(acct1.locked).toBe(1_000);
  expect(acct1.free).toBe(49_000);

  // PRIVACY: feed shows only the hash, nothing exploitable
  const feed = await j(await get("/feed"));
  const entry = feed.feed[0];
  expect(entry.privacyMode).toBe("private");
  expect(entry.leaked).toBeUndefined();
  expect(entry.commitmentHash).toBe(commit.commitmentHash);
  expect(Object.keys(entry).sort()).toEqual(["at", "commitmentHash", "marketId", "privacyMode"]);

  // commit job completes: the commitment is sealed, nothing else leaks
  const cj = await pollJob(commit.jobId);
  expect(cj.status).toBe("complete");
  expect(cj.steps[0].label).toContain("commitment");
  expect(cj.steps[0].detail).toContain(commit.commitmentHash.slice(0, 16));

  // EXECUTE
  const exe = await j(await post(`/orders/${commit.orderId}/execute`));
  expect(exe.success).toBe(true);
  expect(exe.position.status).toBe("open");
  expect(exe.position.entryPrice).toBeGreaterThan(0);
  const ej = await pollJob(exe.jobId);
  expect(ej.status).toBe("complete");

  const positions = await j(await get(`/positions/${USER}`));
  expect(positions.positions.length).toBe(1);
  expect(positions.positions[0].id).toBe(exe.position.id);

  // CLOSE
  const close = await j(await post(`/positions/${exe.position.id}/close`));
  expect(close.success).toBe(true);
  expect(close.position.status).toBe("closed");
  expect(typeof close.position.realizedPnl).toBe("number");
  const clj = await pollJob(close.jobId);
  expect(clj.status).toBe("complete");
  // the close records a settlement digest binding commitment → close record
  expect(clj.steps.map((s: any) => s.label).join("|")).toContain("settlement digest");
  expect(close.position.settlement.settlementDigest).toMatch(/^[0-9a-f]{64}$/);

  // margin released back to the trader
  const acct2 = await j(await get(`/account/${USER}`));
  expect(acct2.locked).toBe(0);
});

test("public order leaks (the A/B foil), proving the toggle matters", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  await post("/orders/commit", {
    address: USER, marketId: "SOL-USD", side: "SHORT", marginUsd: 500, leverage: 3, privacyMode: "public",
  });
  const feed = await j(await get("/feed"));
  expect(feed.feed[0].privacyMode).toBe("public");
  expect(feed.feed[0].leaked).toBeDefined();
  expect(feed.feed[0].leaked.side).toBe("SHORT");
});

test("rejects insufficient margin", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 100 });
  const r = await post("/orders/commit", {
    address: USER, marketId: "FLR-USD", side: "LONG", marginUsd: 1_000, leverage: 5, privacyMode: "private",
  });
  expect(r.status).toBe(400);
  expect((await j(r)).error).toContain("insufficient");
});

test("A/B demo endpoint quantifies the sandwich", async () => {
  const ab = await j(await post("/demo/ab", { marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 10 }));
  expect(ab.public.victimEntry).toBeGreaterThan(ab.private.victimEntry); // public fills worse
  expect(ab.public.botProfitUsd).toBeGreaterThan(0);
  expect(ab.headline).toContain("front-run");
});

test("A/B live mode runs a REAL sandwich yet restores the pool exactly", async () => {
  const markBefore = (await j(await get("/markets"))).markets.find((m: any) => m.id === "FLR-USD").markPrice;
  const ab = await j(await post("/demo/ab", { marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 10, mode: "live" }));
  expect(ab.public.victimEntry).toBeGreaterThan(ab.private.victimEntry); // real bot really front-ran
  expect(ab.public.botProfitUsd).toBeGreaterThan(0);
  const markAfter = (await j(await get("/markets"))).markets.find((m: any) => m.id === "FLR-USD").markPrice;
  expect(markAfter).toBeCloseTo(markBefore, 8); // live pool restored — real traders unaffected
});
