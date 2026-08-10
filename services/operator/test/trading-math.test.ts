import { test, expect } from "bun:test";
import {
  notional,
  computeSizeBase,
  pnl,
  takerFee,
  fundingRate,
  fundingPayment,
  equity,
  equityRatio,
  isLiquidatable,
  settledDelta,
  liquidationPrice,
  slippageBps,
  limitTriggered,
  stopTriggered,
  MAINTENANCE_MARGIN,
  FUNDING_CAP,
} from "../src/trading-math.js";

test("notional = margin × leverage", () => {
  expect(notional(1000, 5)).toBe(5000);
});

test("computeSizeBase = notional / index price", () => {
  expect(computeSizeBase(1000, 5, 2)).toBeCloseTo(2500, 6);
  expect(() => computeSizeBase(1000, 5, 0)).toThrow();
});

test("PnL sign: LONG profits up, SHORT profits down", () => {
  expect(pnl("LONG", 100, 110, 2)).toBeCloseTo(20, 6); // +10 × 2
  expect(pnl("LONG", 100, 90, 2)).toBeCloseTo(-20, 6);
  expect(pnl("SHORT", 100, 90, 2)).toBeCloseTo(20, 6); // short gains when price falls
  expect(pnl("SHORT", 100, 110, 2)).toBeCloseTo(-20, 6);
});

test("taker fee is bps of |notional|", () => {
  expect(takerFee(10_000, 10)).toBeCloseTo(10, 6); // 10 bps of 10k = 10
  expect(takerFee(-10_000, 10)).toBeCloseTo(10, 6); // absolute
});

test("funding rate: sign follows mark-index premium, capped", () => {
  expect(fundingRate(101, 100)).toBeGreaterThan(0); // mark>index → longs pay
  expect(fundingRate(99, 100)).toBeLessThan(0);
  expect(fundingRate(100, 100)).toBe(0);
  expect(fundingRate(1000, 100)).toBeCloseTo(FUNDING_CAP, 8); // capped
  expect(fundingRate(1, 100)).toBeCloseTo(-FUNDING_CAP, 8);
  expect(fundingRate(100, 0)).toBe(0); // guard
});

test("funding payment: longs pay (+) when rate>0, shorts receive (−)", () => {
  const r = 0.001;
  expect(fundingPayment("LONG", r, 10, 100)).toBeCloseTo(1, 6); // 0.001×10×100
  expect(fundingPayment("SHORT", r, 10, 100)).toBeCloseTo(-1, 6);
});

test("equity + equityRatio + liquidation threshold", () => {
  // margin 100, pnl -60, funding 0, size 10, mark 100 → equity 40, value 1000 → ratio 0.04
  expect(equity(100, -60, 0)).toBe(40);
  const ratio = equityRatio(100, -60, 0, 10, 100);
  expect(ratio).toBeCloseTo(0.04, 6);
  expect(isLiquidatable(ratio)).toBe(true); // 0.04 < 0.05 maintenance
  const healthy = equityRatio(1000, 0, 0, 10, 100);
  expect(isLiquidatable(healthy)).toBe(false);
  expect(equityRatio(100, 0, 0, 0, 100)).toBe(Infinity); // no position value
});

test("MAINTENANCE_MARGIN is 5%", () => {
  expect(MAINTENANCE_MARGIN).toBe(0.05);
});

test("settledDelta = pnl − fee − funding", () => {
  expect(settledDelta(50, 5, 2)).toBe(43);
  expect(settledDelta(-30, 5, -1)).toBe(-34);
});

test("liquidation price: below entry for LONG, above for SHORT, and consistent with equityRatio", () => {
  const longLiq = liquidationPrice("LONG", 100, 10, 100, 0); // 10x, margin 100
  expect(longLiq).toBeLessThan(100);
  // at the liq price, the equity ratio equals maintenance
  expect(equityRatio(100, pnl("LONG", 100, longLiq, 10), 0, 10, longLiq)).toBeCloseTo(MAINTENANCE_MARGIN, 4);

  const shortLiq = liquidationPrice("SHORT", 100, 10, 100, 0);
  expect(shortLiq).toBeGreaterThan(100);
  expect(equityRatio(100, pnl("SHORT", 100, shortLiq, 10), 0, 10, shortLiq)).toBeCloseTo(MAINTENANCE_MARGIN, 4);
});

test("slippageBps measures deviation from a reference", () => {
  expect(slippageBps(101, 100)).toBeCloseTo(100, 6); // 1% = 100 bps
  expect(slippageBps(100, 100)).toBe(0);
});

test("limit triggers: LONG at/below its price, SHORT at/above", () => {
  expect(limitTriggered("LONG", 0.14, 0.139)).toBe(true);
  expect(limitTriggered("LONG", 0.14, 0.141)).toBe(false);
  expect(limitTriggered("SHORT", 0.16, 0.161)).toBe(true);
  expect(limitTriggered("SHORT", 0.16, 0.159)).toBe(false);
});

test("stop/take triggers: LONG SL below + TP above, SHORT inverted", () => {
  expect(stopTriggered("LONG", 90, 92, 120)).toBe("stop-loss"); // 90 <= 92
  expect(stopTriggered("LONG", 125, 92, 120)).toBe("take-profit"); // 125 >= 120
  expect(stopTriggered("LONG", 100, 92, 120)).toBe(null);
  expect(stopTriggered("SHORT", 110, 108, 80)).toBe("stop-loss"); // 110 >= 108
  expect(stopTriggered("SHORT", 78, 108, 80)).toBe("take-profit"); // 78 <= 80
  expect(stopTriggered("SHORT", 100, 108, 80)).toBe(null);
});
