import { createHash } from "node:crypto";

export type OrderCommitmentInput = {
  pairId: string;
  side: "LONG" | "SHORT";
  price: string;
  size: string;
  leverage: number;
  margin: string;
  nonce: string;
};

/**
 * Deterministic 32-byte commitment (hex) over private order fields.
 * Used off-chain and referenced on Midnight / Cardano metadata.
 */
export function orderCommitmentHex(input: OrderCommitmentInput): string {
  const canonical = JSON.stringify({
    pairId: input.pairId,
    side: input.side,
    price: input.price,
    size: input.size,
    leverage: input.leverage,
    margin: input.margin,
    nonce: input.nonce,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Any change to private fields changes the commitment (anti front-run narrative). */
export function verifyCommitmentMatches(
  input: OrderCommitmentInput,
  expectedCommitmentHex: string,
): boolean {
  return orderCommitmentHex(input) === expectedCommitmentHex.replace(/^0x/i, "");
}
