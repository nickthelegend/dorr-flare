import { describe, it, expect } from "vitest";
import {
  orderCommitmentHex,
  verifyCommitmentMatches,
  type OrderCommitmentInput,
} from "./commitment.js";

const baseOrder = (): OrderCommitmentInput => ({
  pairId: "ADA-USD",
  side: "LONG",
  price: "0.52",
  size: "100",
  leverage: 5,
  margin: "1000",
  nonce: "nonce-1",
});

describe("order commitment (anti tamper / private field hiding)", () => {
  it("computes stable commitment hex", () => {
    const h = orderCommitmentHex(baseOrder());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects when any private field changes", () => {
    const o = baseOrder();
    const h = orderCommitmentHex(o);
    expect(verifyCommitmentMatches(o, h)).toBe(true);
    expect(
      verifyCommitmentMatches({ ...o, price: "0.99" }, h),
    ).toBe(false);
    expect(
      verifyCommitmentMatches({ ...o, nonce: "nonce-2" }, h),
    ).toBe(false);
  });

  it("same narrative as the threat model: mempool observers only see commitment, not preimage", () => {
    const o = baseOrder();
    const publicCommitment = orderCommitmentHex(o);
    const attackerGuess: OrderCommitmentInput = {
      ...o,
      price: "0.01",
    };
    expect(orderCommitmentHex(attackerGuess)).not.toBe(publicCommitment);
  });
});
