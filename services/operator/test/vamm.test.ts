import { test, expect } from "bun:test";
import type { MarketDef } from "../src/markets.js";
import { seedPool, fill, markPrice, recenter, getPool } from "../src/vamm.js";

const M: MarketDef = {
  id: "TST-USD",
  symbol: "TST/USD",
  base: "TST",
  pythFeedId: "00".repeat(32),
  vammDepthUsd: 1_000_000,
  recenterBps: 5,
  maxLeverage: 20,
};

test("seedPool sets mark to the index price", () => {
  seedPool(M, 2.0);
  expect(markPrice(M.id)!).toBeCloseTo(2.0, 8);
  const p = getPool(M.id)!;
  expect(p.virtualQuote).toBe(1_000_000);
  expect(p.virtualBase).toBeCloseTo(500_000, 3);
});

test("fill preserves the constant product k", () => {
  seedPool(M, 2.0);
  const before = getPool(M.id)!;
  const k0 = before.k;
  fill(M.id, "LONG", 1000);
  const after = getPool(M.id)!;
  expect(after.virtualBase * after.virtualQuote).toBeCloseTo(k0, 0);
});

test("LONG pushes price up, SHORT pushes price down", () => {
  seedPool(M, 2.0);
  const longFill = fill(M.id, "LONG", 5000);
  expect(longFill.priceAfter).toBeGreaterThan(longFill.priceBefore);
  expect(longFill.avgPrice).toBeGreaterThan(longFill.priceBefore);

  seedPool(M, 2.0);
  const shortFill = fill(M.id, "SHORT", 5000);
  expect(shortFill.priceAfter).toBeLessThan(shortFill.priceBefore);
  expect(shortFill.avgPrice).toBeLessThan(shortFill.priceBefore);
});

test("bigger fills incur more price impact", () => {
  seedPool(M, 2.0);
  const small = fill(M.id, "LONG", 1000);
  seedPool(M, 2.0);
  const big = fill(M.id, "LONG", 20000);
  expect(big.priceImpactBps).toBeGreaterThan(small.priceImpactBps);
});

test("fill rejects sizes beyond half the base reserve", () => {
  seedPool(M, 2.0);
  const base = getPool(M.id)!.virtualBase;
  expect(() => fill(M.id, "LONG", base * 0.6)).toThrow();
});

test("recenter re-pegs the pool to the index after drift", () => {
  seedPool(M, 2.0);
  fill(M.id, "LONG", 20000); // drift the mark up
  const drifted = markPrice(M.id)!;
  expect(drifted).toBeGreaterThan(2.0);
  const did = recenter(M, 2.0);
  expect(did).toBe(true);
  expect(markPrice(M.id)!).toBeCloseTo(2.0, 8);
});

test("recenter is a no-op within the drift tolerance", () => {
  seedPool(M, 2.0);
  fill(M.id, "LONG", 1); // negligible drift < 5 bps
  const did = recenter(M, 2.0);
  expect(did).toBe(false);
});
