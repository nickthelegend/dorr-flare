/**
 * Wallet-signature auth (CIP-30 data signatures).
 *
 * Every value-moving action (commit / execute / close / withdraw) must carry a
 * signature produced by the acting wallet over a canonical, timestamped message.
 * The operator verifies (a) the signature is valid for the claimed address,
 * (b) the message is fresh (anti-replay window), (c) the signature hasn't been
 * seen before (replay dedupe). This binds each request to the real key owner —
 * you cannot place or close someone else's trade.
 */
import verifyDataSignature from "@cardano-foundation/cardano-verify-datasignature";

export interface DataSignature {
  signature: string;
  key: string;
}

/** Crypto verifier: is `sig` a valid CIP-30 data-signature over `message` by `address`? */
export type SigVerifier = (message: string, sig: DataSignature, address: string) => boolean;

/** Production verifier — Cardano Foundation's CIP-30 data-signature checker. */
export const cip30Verifier: SigVerifier = (message, sig, address) =>
  verifyDataSignature(sig.signature, sig.key, message, address);

export interface AuthEnvelope {
  signer: string; // bech32 address that signed
  ts: number; // client timestamp (ms)
  sig: DataSignature;
}

const FRESH_MS = 120_000;
const seen = new Map<string, number>(); // signature → firstSeen (replay dedupe)

/** Canonical message a client must sign for a given action + params. */
export function authMessage(action: string, params: Record<string, unknown>, ts: number): string {
  // Deterministic key order so client and server agree byte-for-byte.
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  return `dorr:${action}\n${canonical}\nts:${ts}`;
}

function pruneSeen(now: number): void {
  for (const [k, t] of seen) if (now - t > FRESH_MS * 2) seen.delete(k);
}

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Verify an auth envelope for an action. `expectedSigner`, when provided, must
 * equal the envelope signer (binds the action to a specific address/owner).
 */
export function verifyAuth(
  action: string,
  params: Record<string, unknown>,
  envelope: AuthEnvelope | undefined,
  expectedSigner: string | undefined,
  now: number = Date.now(),
  verify: SigVerifier = cip30Verifier,
): AuthResult {
  if (!envelope) return { ok: false, error: "missing auth (sign the request with your wallet)" };
  const { signer, ts, sig } = envelope;
  if (!signer || !sig?.signature || !sig?.key) return { ok: false, error: "malformed auth envelope" };
  if (!Number.isFinite(ts) || Math.abs(now - ts) > FRESH_MS) {
    return { ok: false, error: "stale or future-dated signature (replay window exceeded)" };
  }
  if (expectedSigner && expectedSigner !== signer) {
    return { ok: false, error: "signer does not match the acting address" };
  }
  if (seen.has(sig.signature)) return { ok: false, error: "signature already used (replay)" };

  const message = authMessage(action, params, ts);
  let valid = false;
  try {
    valid = verify(message, sig, signer);
  } catch (e) {
    return { ok: false, error: `signature check failed: ${String(e).slice(0, 120)}` };
  }
  if (!valid) return { ok: false, error: "invalid signature for this message/address" };

  pruneSeen(now);
  seen.set(sig.signature, now);
  return { ok: true };
}

/** Test/reset helper — clears the replay-dedupe set. */
export function _resetAuthSeen(): void {
  seen.clear();
}
