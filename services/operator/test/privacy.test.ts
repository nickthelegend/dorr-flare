import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { orderCommitmentHex } from "@dorr/engine/order/commitment";
import { publicFeedView, leaksSensitiveData } from "../src/privacy.js";

const base = {
  pairId: "FLR-USD",
  side: "LONG" as const,
  price: "0.157000",
  size: "31787.83000000",
  leverage: 5,
  margin: "1000.00",
  nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
};

// ── the commitment is a hiding + binding commitment ──────────────────────────
test("commitment is deterministic", () => {
  expect(orderCommitmentHex(base)).toBe(orderCommitmentHex(base));
});

test("commitment is 32 bytes (64 lowercase hex)", () => {
  expect(orderCommitmentHex(base)).toMatch(/^[0-9a-f]{64}$/);
});

test("commitment hides the plaintext — no field value appears in the hash", () => {
  const h = orderCommitmentHex(base);
  for (const v of ["LONG", "0.157000", "31787", "1000", base.nonce]) {
    expect(h.includes(v)).toBe(false);
  }
});

test("commitment is binding — changing ANY field changes the hash", () => {
  const h = orderCommitmentHex(base);
  expect(orderCommitmentHex({ ...base, side: "SHORT" })).not.toBe(h);
  expect(orderCommitmentHex({ ...base, price: "0.157001" })).not.toBe(h);
  expect(orderCommitmentHex({ ...base, size: "31787.83000001" })).not.toBe(h);
  expect(orderCommitmentHex({ ...base, leverage: 6 })).not.toBe(h);
  expect(orderCommitmentHex({ ...base, margin: "1000.01" })).not.toBe(h);
  expect(orderCommitmentHex({ ...base, nonce: "00000000000000000000000000000000" })).not.toBe(h);
});

test("brute-forcing the nonce is infeasible — a bot guessing everything but the 128-bit nonce fails", () => {
  const target = orderCommitmentHex(base); // attacker knows market/side/price/size/lev/margin but not nonce
  let hit = false;
  for (let i = 0; i < 20_000; i++) {
    const guess = createHash("sha256").update(`guess:${i}`).digest("hex").slice(0, 32);
    if (orderCommitmentHex({ ...base, nonce: guess }) === target) { hit = true; break; }
  }
  expect(hit).toBe(false);
});

// ── the public projection leaks nothing for a private order ──────────────────
const secret = { side: "LONG" as const, sizeBase: 31787.83, leverage: 5, price: 0.157, address: "addr_test1qqtrader", nonce: base.nonce };

test("PRIVATE order: public feed view exposes only market + commitment hash", () => {
  const view = publicFeedView({
    marketId: "FLR-USD", privacyMode: "private", commitmentHash: orderCommitmentHex(base),
    createdAt: "t", ...secret, sizeBase: secret.sizeBase,
  });
  expect(view.leaked).toBeUndefined();
  expect(Object.keys(view).sort()).toEqual(["at", "commitmentHash", "marketId", "privacyMode"]);
  expect(leaksSensitiveData(view, secret)).toBe(false); // ← MEV bot learns nothing
});

test("PUBLIC order (A/B foil): deliberately leaks side/size/leverage", () => {
  const view = publicFeedView({
    marketId: "FLR-USD", privacyMode: "public", commitmentHash: orderCommitmentHex(base),
    createdAt: "t", ...secret, sizeBase: secret.sizeBase,
  });
  expect(view.leaked).toBeDefined();
  expect(view.leaked!.side).toBe("LONG");
  expect(leaksSensitiveData(view, secret)).toBe(true);
});
