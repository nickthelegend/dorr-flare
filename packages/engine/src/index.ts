/**
 * @dorr/engine — the order-commitment scheme.
 *
 * An order is published as `SHA-256(canonical(fields) ‖ nonce)`. The public sees
 * only that hash; the holder can later open it to a chosen auditor, who
 * recomputes the digest and checks it against the value already committed
 * on-chain. This is the primitive the whole privacy story rests on, so it lives
 * in one package with one dependency (`node:crypto`) and its own tests.
 *
 * Execution, margin, funding and liquidation are NOT here — they run in the
 * operator (`services/operator`) against the live vAMM and Flare, and
 * settlement finality is the on-chain sealed batch.
 */
export * from "./common/types.js";
export * from "./common/constants.js";
export * from "./common/errors.js";

export * from "./order/commitment.js";
