/**
 * Sealed-bid execution path, END TO END (against LIVE drand, no mocks):
 * a client timelock-seals orders → the operator stores ciphertext it can't read
 * → settlement decrypts (round permitting), clears at ONE uniform price, and
 * opens a position each. Margin accounting + commitment binding are asserted.
 */

import { test, expect, beforeAll } from "bun:test";
import { randomBytes } from "node:crypto";
import { sealOrder, commitmentFor, roundForTime, type OrderPreimage } from "../src/sealbid.js";

const A = "addr_test1sealedA";
const B = "addr_test1sealedB";
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
let pyth: typeof import("../src/ftso.js");
let vamm: typeof import("../src/vamm.js");
let trading: typeof import("../src/trading.js");
let markets: typeof import("../src/markets.js");
const FLR = "FLR-USD";

const j = async (r: Response) => (await r.json()) as any;
const post = (p: string, b?: unknown) =>
  app.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
const get = (p: string) => app.request(p);

beforeAll(async () => {
  markets = await import("../src/markets.js");
  pyth = await import("../src/ftso.js");
  vamm = await import("../src/vamm.js");
  trading = await import("../src/trading.js");
  await (await import("../src/state.js")).loadState();
  pyth._setPriceForTest(markets.marketById(FLR)!.feedId, 0.15);
  vamm.seedPool(markets.marketById(FLR)!, 0.15);
  app = (await import("../src/routes.js")).app;
});

function mk(side: "LONG" | "SHORT", sizeBase: number, marginUsd: number): OrderPreimage {
  return { marketId: FLR, side, sizeBase, leverage: 5, marginUsd, price: 0.15, nonce: randomBytes(16).toString("hex") };
}

/** A client seals an order and submits only ciphertext + commitment + a margin bound. */
async function sealAndSubmit(address: string, p: OrderPreimage, round: number, maxMarginUsd: number) {
  const ciphertext = await sealOrder(p, round);
  return j(await post("/orders/seal", { address, marketId: FLR, commitment: commitmentFor(p), ciphertext, targetRound: round, maxMarginUsd }));
}

test("SEALED E2E — sealed orders clear at ONE price into real positions; margin settles", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: A, dusd: 100_000 });
  await post("/demo/seed", { address: B, dusd: 100_000 });
  pyth._setPriceForTest(markets.marketById(FLR)!.feedId, 0.15);
  vamm.seedPool(markets.marketById(FLR)!, 0.15);

  const pastRound = await roundForTime(Date.now() - 60_000); // already unsealed
  const oLong = mk("LONG", 30_000, 4500);
  const oShort = mk("SHORT", 12_000, 1800);

  // client A seals a LONG (bound 5000 > actual 4500 → 500 should be released on clear)
  const sa = await sealAndSubmit(A, oLong, pastRound, 5000);
  expect(sa.success).toBe(true);
  // client B seals a SHORT
  const sb = await sealAndSubmit(B, oShort, pastRound, 1800);
  expect(sb.success).toBe(true);

  // margin locked to the bounds; the public feed shows only commitments
  expect((await j(await get(`/account/${A}`))).locked).toBeCloseTo(5000, 2);
  const feed = await j(await get("/feed"));
  expect(feed.feed[0].leaked).toBeUndefined();
  expect(feed.feed.some((f: any) => f.commitmentHash === sa.commitment)).toBe(true);

  // operator settles the epoch (decrypts via real drand, clears, opens positions)
  const res = await j(await post("/batch/settle", { marketId: FLR }));
  expect(res.cleared).toBe(2);
  expect(res.dropped).toBe(0);
  expect(res.clearingPrice).toBeGreaterThan(0);
  expect(res.membershipRoot).toMatch(/^[0-9a-f]{64}$/);

  // both traders now hold an open position at the SAME clearing price
  const pa = (await j(await get(`/positions/${A}`))).positions;
  const pb = (await j(await get(`/positions/${B}`))).positions;
  expect(pa.length).toBe(1);
  expect(pb.length).toBe(1);
  expect(pa[0].entryPrice).toBeCloseTo(pb[0].entryPrice, 8); // ONE uniform price
  expect(pa[0].side).toBe("LONG");
  expect(pb[0].side).toBe("SHORT");
  expect(pa[0].marginUsd).toBeCloseTo(4500, 2);

  // A's unused bound (5000 − 4500) was released; 4500 stays locked behind the position
  expect((await j(await get(`/account/${A}`))).locked).toBeCloseTo(4500, 2);

  // the sealed orders are now marked cleared
  const sealedA = (await j(await get(`/orders/sealed/${A}`))).orders;
  expect(sealedA[0].status).toBe("cleared");
  expect(sealedA[0].positionId).toBe(pa[0].id);
}, 40_000);

test("SEALED E2E — a preimage that doesn't match its commitment is dropped, margin released", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: A, dusd: 50_000 });
  pyth._setPriceForTest(markets.marketById(FLR)!.feedId, 0.15);
  vamm.seedPool(markets.marketById(FLR)!, 0.15);

  const pastRound = await roundForTime(Date.now() - 60_000);
  const real = mk("LONG", 1000, 200);
  const ciphertext = await sealOrder(real, pastRound);
  // submit with a WRONG commitment (as if the operator tried to swap the order)
  const wrong = commitmentFor(mk("SHORT", 9999, 999));
  const s = await j(await post("/orders/seal", { address: A, marketId: FLR, commitment: wrong, ciphertext, targetRound: pastRound, maxMarginUsd: 1000 }));
  expect(s.success).toBe(true);
  expect((await j(await get(`/account/${A}`))).locked).toBeCloseTo(1000, 2);

  const res = await j(await post("/batch/settle", { marketId: FLR }));
  expect(res.cleared).toBe(0);
  expect(res.dropped).toBe(1);
  // no position, and the full bound was released
  expect((await j(await get(`/positions/${A}`))).positions.length).toBe(0);
  expect((await j(await get(`/account/${A}`))).locked).toBeCloseTo(0, 2);
  expect((await j(await get(`/orders/sealed/${A}`))).orders[0].status).toBe("dropped");
}, 40_000);

test("SEALED E2E — an order sealed to a FUTURE round stays sealed (operator can't settle it early)", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: A, dusd: 50_000 });
  pyth._setPriceForTest(markets.marketById(FLR)!.feedId, 0.15);
  vamm.seedPool(markets.marketById(FLR)!, 0.15);

  const futureRound = await roundForTime(Date.now() + 3_600_000); // ~1h out
  await sealAndSubmit(A, mk("LONG", 5000, 750), futureRound, 750);

  const res = await j(await post("/batch/settle", { marketId: FLR }));
  expect(res.cleared).toBe(0); // round not reached — cannot be opened
  expect((await j(await get(`/positions/${A}`))).positions.length).toBe(0);
  expect((await j(await get(`/orders/sealed/${A}`))).orders[0].status).toBe("sealed"); // still sealed
  expect((await j(await get(`/account/${A}`))).locked).toBeCloseTo(750, 2); // margin still held
}, 30_000);

test("SEALED E2E — a cleared sealed order is selectively disclosable and verifies", async () => {
  await post("/demo/reset");
  await post("/demo/seed", { address: A, dusd: 50_000 });
  pyth._setPriceForTest(markets.marketById(FLR)!.feedId, 0.15);
  vamm.seedPool(markets.marketById(FLR)!, 0.15);

  const pastRound = await roundForTime(Date.now() - 60_000);
  const order = mk("LONG", 20_000, 3000);
  const sealed = await sealAndSubmit(A, order, pastRound, 3500);
  expect(sealed.success).toBe(true);

  const settled = await j(await post("/batch/settle", { marketId: FLR }));
  expect(settled.cleared).toBe(1);

  // The operator kept only ciphertext — the disclosure re-opens it, so a
  // position from the SEALED path is disclosable just like a plaintext order.
  const d = await j(await post("/disclose", { orderId: sealed.id, audience: "regulator" }));
  expect(d.success).toBe(true);
  expect(d.disclosure.revealed.side).toBe("LONG");
  expect(d.disclosure.revealed.pairId).toBe(FLR);
  expect(d.disclosure.commitment).toBe(sealed.commitment);

  // and anyone handed it can check it against the commitment
  const v = await j(await post("/disclose/verify", { disclosure: d.disclosure }));
  expect(v.valid).toBe(true);
  expect(v.matches).toBe(true);

  // a tampered disclosure must NOT verify against the same commitment
  const forged = { ...d.disclosure, revealed: { ...d.disclosure.revealed, size: "999999.00000000" } };
  const bad = await j(await post("/disclose/verify", { disclosure: forged }));
  expect(bad.valid).toBe(false);
}, 40_000);
