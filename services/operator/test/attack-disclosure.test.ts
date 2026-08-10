/**
 * The demo-winning tools: the MEV attack lab (sandwich succeeds on a public DEX,
 * FAILS on dorr), selective disclosure (open a hidden position to an auditor,
 * verifiable against the on-chain commitment), and the activity log.
 */
process.env.DORR_ZK_MODE = "stub";
process.env.DORR_TEST = "1";

import { test, expect, beforeAll } from "bun:test";

const USER = "addr_test1qqattackuser";
let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
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
}

beforeAll(async () => {
  const markets = await import("../src/markets.js");
  const pyth = await import("../src/ftso.js");
  const vamm = await import("../src/vamm.js");
  await (await import("../src/state.js")).loadState();
  for (const m of markets.MARKETS) {
    const price = m.base === "BTC" ? 60000 : m.base === "ETH" ? 1600 : m.base === "SOL" ? 78 : m.base === "ADA" ? 0.15 : 0.07;
    pyth._setPriceForTest(m.feedId, price);
    vamm.seedPool(m, price);
  }
  app = (await import("../src/routes.js")).app;
});

test("MEV attack lab: sandwich SUCCEEDS on a public DEX but FAILS on dorr", async () => {
  const r = await j(await post("/demo/attack", { marketId: "ADA-dUSD", side: "LONG", marginUsd: 1000, leverage: 10 }));
  // public: bot front-runs and profits
  expect(r.publicRun.outcome).toBe("SANDWICHED");
  expect(r.publicRun.botProfitUsd).toBeGreaterThan(0);
  expect(r.publicRun.victimExtraCostUsd).toBeGreaterThan(0);
  expect(r.publicRun.steps.length).toBeGreaterThan(3);
  // private: bot sees only a hash and its brute-force finds NOTHING
  expect(r.privateRun.outcome).toBe("ATTACK FAILED");
  expect(r.privateRun.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(r.privateRun.bruteForceAttempts).toBeGreaterThan(0);
  expect(r.privateRun.bruteForceMatches).toBe(0); // ← the proof: cannot crack the commitment
  expect(r.headline).toContain("attack impossible");
});

test("selective disclosure: open a hidden position to an auditor, verifiable vs the commitment", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: "ADA-dUSD", side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private",
  }));
  await pollJob(commit.jobId);

  // the public only ever saw the hash
  const feed = await j(await get("/feed"));
  expect(feed.feed[0].leaked).toBeUndefined();

  // owner discloses to an auditor
  const disc = await j(await post("/disclose", { orderId: commit.orderId, audience: "regulator" }));
  expect(disc.success).toBe(true);
  expect(disc.disclosure.commitment).toBe(commit.commitmentHash);
  expect(disc.disclosure.revealed.side).toBe("LONG");

  // the auditor verifies it against the on-chain commitment → valid
  const ok = await j(await post("/disclose/verify", { disclosure: disc.disclosure }));
  expect(ok.valid).toBe(true);
  expect(ok.recomputed).toBe(commit.commitmentHash);

  // a tampered disclosure (inflated leverage) is REJECTED
  const forged = { ...disc.disclosure, revealed: { ...disc.disclosure.revealed, leverage: 50 } };
  const bad = await j(await post("/disclose/verify", { disclosure: forged }));
  expect(bad.valid).toBe(false);
});

test("activity log records the trader's actions", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: USER, dusd: 50_000 });
  const commit = await j(await post("/orders/commit", {
    address: USER, marketId: "ETH-dUSD", side: "SHORT", marginUsd: 800, leverage: 3, privacyMode: "private",
  }));
  await pollJob(commit.jobId);
  const events = (await j(await get(`/events?address=${USER}`))).events;
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].type).toBe("commit");
  expect(events[0].detail).toContain("hash");
});
