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
import { openSealed } from "./sealbid.js";

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

export async function buildDisclosure(orderId: string, audience: string): Promise<Disclosure> {
  const st = getState();
  const order = st.orders.find((o) => o.id === orderId);

  let revealed: OrderCommitmentInput;
  let commitment: string;

  if (order) {
    revealed = {
      pairId: order.marketId,
      side: order.side,
      price: order.commitPrice.toFixed(8),
      size: order.sizeBase.toFixed(8),
      leverage: order.leverage,
      margin: order.marginUsd.toFixed(2),
      nonce: order.nonce,
    };
    commitment = order.commitmentHash;
  } else {
    // A position opened through the sealed path is backed by a SealedOrder, not
    // a plaintext order. The operator never stored its contents — it only holds
    // the timelock ciphertext — so re-open that to recover the preimage. This
    // only works once the epoch's drand round has landed, which is exactly the
    // point at which the order became disclosable at all.
    const sealed = st.sealedOrders.find((o) => o.id === orderId);
    if (!sealed) throw new Error("order not found");
    let preimage;
    try {
      preimage = await openSealed(sealed.ciphertext);
    } catch (e) {
      throw new Error(
        `this order is still sealed — it becomes disclosable once drand round ${sealed.targetRound} lands`,
      );
    }
    revealed = {
      pairId: preimage.marketId,
      side: preimage.side,
      price: preimage.price.toFixed(8),
      size: preimage.sizeBase.toFixed(8),
      leverage: preimage.leverage,
      margin: preimage.marginUsd.toFixed(2),
      nonce: preimage.nonce,
    };
    commitment = sealed.commitment;
  }

  // sanity: the opened preimage must reproduce the committed hash
  if (orderCommitmentHex(revealed) !== commitment) {
    throw new Error("internal: order preimage does not match its commitment");
  }
  return {
    kind: "dorr-selective-disclosure/v1",
    subject: "order",
    orderId,
    audience: audience || "auditor",
    commitment,
    revealed,
    issuedAt: new Date().toISOString(),
    statement:
      "SHA-256(canonical(revealed)) == commitment, the value the public saw when this order was placed. " +
      "Everyone else still sees only `commitment`; this disclosure opens the position solely to its chosen audience.",
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
/** Fields a disclosure must open for the commitment to be recomputable. */
const REVEALED_FIELDS = ["pairId", "side", "price", "size", "leverage", "margin", "nonce"] as const;

export function verifyDisclosure(d: Disclosure): DisclosureVerdict {
  // Validate the shape first so a caller gets a sentence they can act on rather
  // than a JS TypeError leaked out of the hashing code.
  const reject = (reason: string): DisclosureVerdict => ({
    valid: false,
    recomputed: "",
    commitment: typeof d?.commitment === "string" ? d.commitment : "",
    matches: false,
    reason,
  });

  if (!d || typeof d !== "object") return reject("no disclosure supplied — send the object returned by /disclose");
  if (typeof d.commitment !== "string" || !/^[0-9a-f]{64}$/i.test(d.commitment.replace(/^0x/, ""))) {
    return reject("missing or malformed 'commitment' — expected a 32-byte hex hash");
  }
  if (!d.revealed || typeof d.revealed !== "object") {
    return reject("missing 'revealed' — the opened order fields are required to verify a disclosure");
  }
  const missing = REVEALED_FIELDS.filter(
    (k) => (d.revealed as Record<string, unknown>)[k] === undefined || (d.revealed as Record<string, unknown>)[k] === null,
  );
  if (missing.length) {
    return reject(`disclosure is incomplete — missing ${missing.join(", ")}`);
  }

  let recomputed = "";
  try {
    recomputed = orderCommitmentHex(d.revealed);
  } catch {
    return reject("could not recompute the commitment from the revealed fields — they are not in the expected format");
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
