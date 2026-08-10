/**
 * Sealed-bid batch auction — REAL timelock privacy from the operator.
 * These hit the LIVE drand League of Entropy (no mocks — that's the point):
 *   • an order sealed to a future round CANNOT be opened by the operator,
 *   • an order sealed to a past round opens to the exact preimage,
 *   • a whole epoch clears at ONE uniform price (no front-running advantage),
 *   • a preimage that doesn't match its public commitment is dropped.
 */
import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  sealOrder,
  openSealed,
  settleSealedEpoch,
  commitmentFor,
  roundForTime,
  membershipRoot,
  type OrderPreimage,
  type SealedInput,
} from "../src/sealbid.js";

const NET = 20_000; // drand network calls — generous per-test timeout

function mkPreimage(side: "LONG" | "SHORT", sizeBase: number, marginUsd: number): OrderPreimage {
  return { marketId: "FLR-USD", side, sizeBase, leverage: 10, marginUsd, price: 0.15, nonce: randomBytes(16).toString("hex") };
}

test("OPERATOR IS BLIND — an order sealed to a future drand round cannot be opened", async () => {
  const p = mkPreimage("LONG", 6667, 1000);
  const futureRound = await roundForTime(Date.now() + 3_600_000); // ~1h out
  const ct = await sealOrder(p, futureRound);
  await expect(openSealed(ct)).rejects.toThrow(); // "too early" — physically undecryptable
}, NET);

test("ROUND-TRIP — an order sealed to a past round opens to the exact preimage", async () => {
  const p = mkPreimage("SHORT", 4242, 700);
  const pastRound = await roundForTime(Date.now() - 60_000);
  const ct = await sealOrder(p, pastRound);
  const opened = await openSealed(ct);
  expect(opened).toEqual(p); // exact recovery via the real drand beacon
}, NET);

test("EPOCH CLEARS AT ONE UNIFORM PRICE — no arrival-order advantage", async () => {
  const pastRound = await roundForTime(Date.now() - 60_000);
  const preimages = [
    mkPreimage("LONG", 30_000, 4500),
    mkPreimage("LONG", 5_000, 750),
    mkPreimage("SHORT", 12_000, 1800),
  ];
  const seals: SealedInput[] = [];
  for (let i = 0; i < preimages.length; i++) {
    seals.push({
      id: `s${i}`,
      address: `0x${String(i).repeat(40).slice(0, 40)}`,
      marketId: "FLR-USD",
      commitment: commitmentFor(preimages[i]),
      ciphertext: await sealOrder(preimages[i], pastRound),
      targetRound: pastRound,
    });
  }
  const pool = { base: 1_000_000, quote: 150_000, k: 1_000_000 * 150_000 };
  const s = await settleSealedEpoch("FLR-USD", seals, pool);
  expect(s.valid.length).toBe(3); // all opened + commitments verified
  expect(s.clearing).toBeDefined();
  const prices = new Set(s.clearing!.fills.map((f) => f.price));
  expect(prices.size).toBe(1); // ONE clearing price for the whole epoch
  expect(s.clearing!.netImbalanceBase).toBeCloseTo(23_000, 0); // 35k long − 12k short
  expect(s.membershipRoot).toMatch(/^[0-9a-f]{64}$/);
}, 40_000);

test("COMMITMENT BINDING — a preimage that doesn't match its commitment is dropped", async () => {
  const pastRound = await roundForTime(Date.now() - 60_000);
  const real = mkPreimage("LONG", 1000, 100);
  const fakeCommitment = commitmentFor(mkPreimage("SHORT", 9999, 999)); // wrong
  const seals: SealedInput[] = [
    {
      id: "bad",
      address: "0x4444444444444444444444444444444444444444",
      marketId: "FLR-USD",
      commitment: fakeCommitment,
      ciphertext: await sealOrder(real, pastRound),
      targetRound: pastRound,
    },
  ];
  const pool = { base: 1_000_000, quote: 150_000, k: 1_000_000 * 150_000 };
  const s = await settleSealedEpoch("FLR-USD", seals, pool);
  expect(s.valid.length).toBe(0);
  expect(s.opened[0].reason).toContain("commitment mismatch");
}, NET);

test("MEMBERSHIP ROOT — deterministic over the sealed set, order-independent", () => {
  const a = { commitment: "aa", ciphertext: "x1" };
  const b = { commitment: "bb", ciphertext: "x2" };
  expect(membershipRoot([a, b])).toBe(membershipRoot([b, a])); // set, not sequence
  expect(membershipRoot([a, b])).not.toBe(membershipRoot([a]));
});
