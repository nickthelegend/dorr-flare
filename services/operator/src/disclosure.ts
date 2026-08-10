/**
 * Selective disclosure — "private by default, provably disclosable."
 *
 * Your order is a public commitment `H = SHA-256(fields ‖ nonce)`; the fields
 * stay hidden. When you *choose* to prove your position to an auditor or
 * counterparty, you hand them a disclosure: the revealed fields + the nonce.
 * They recompute the hash and check it equals the on-chain commitment — proving
 * exactly what you traded, WITHOUT the public ever seeing it. This is Midnight's
 * thesis (rational privacy) applied to a perp: opening a commitment to a chosen
 * party, verifiable against the value already committed on-chain.
 */
import { orderCommitmentHex, type OrderCommitmentInput } from "@dorr/engine/order/commitment";
import { getState } from "./state.js";

export interface Disclosure {
  kind: "dorr-selective-disclosure/v1";
  subject: "order";
  orderId: string;
  audience: string;
  /** the value published on Midnight (and mirrored in the Cardano anchor). */
  commitment: string;
  /** the opened preimage — share ONLY with the intended auditor. */
  revealed: OrderCommitmentInput;
  issuedAt: string;
  statement: string;
}

export function buildDisclosure(orderId: string, audience: string): Disclosure {
  const order = getState().orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  const revealed: OrderCommitmentInput = {
    pairId: order.marketId,
    side: order.side,
    price: order.commitPrice.toFixed(8),
    size: order.sizeBase.toFixed(8),
    leverage: order.leverage,
    margin: order.marginUsd.toFixed(2),
    nonce: order.nonce,
  };
  // sanity: the opened preimage must reproduce the committed hash
  if (orderCommitmentHex(revealed) !== order.commitmentHash) {
    throw new Error("internal: order preimage does not match its commitment");
  }
  return {
    kind: "dorr-selective-disclosure/v1",
    subject: "order",
    orderId,
    audience: audience || "auditor",
    commitment: order.commitmentHash,
    revealed,
    issuedAt: new Date().toISOString(),
    statement:
      "SHA-256(canonical(revealed)) == commitment, the value committed on Midnight and anchored on Cardano. " +
      "The public only ever saw `commitment`; this disclosure reveals the position solely to its holder.",
  };
}

export interface DisclosureVerdict {
  valid: boolean;
  recomputed: string;
  commitment: string;
  matches: boolean;
  reason: string;
}

/** Anyone handed a disclosure can verify it against the committed hash. */
export function verifyDisclosure(d: Disclosure): DisclosureVerdict {
  let recomputed = "";
  try {
    recomputed = orderCommitmentHex(d.revealed);
  } catch (e) {
    return { valid: false, recomputed: "", commitment: d?.commitment ?? "", matches: false, reason: `malformed disclosure: ${String(e).slice(0, 120)}` };
  }
  const matches = recomputed === d.commitment;
  return {
    valid: matches,
    recomputed,
    commitment: d.commitment,
    matches,
    reason: matches
      ? "verified — the revealed position hashes exactly to the on-chain commitment"
      : "REJECTED — the revealed fields do not match the committed hash (forged or tampered)",
  };
}
