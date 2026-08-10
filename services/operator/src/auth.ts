/**
 * Wallet-signature auth (EIP-191 personal_sign).
 *
 * Every value-moving action (commit / execute / close / withdraw) must carry a
 * signature produced by the acting wallet over a canonical, timestamped message.
 * The operator verifies (a) the signature is valid for the claimed address,
 * (b) the message is fresh (anti-replay window), (c) the signature hasn't been
 * seen before (replay dedupe). This binds each request to the real key owner —
 * you cannot place or close someone else's trade.
 *
 * dorr settles on Flare and margins in FXRP, so the identity that authorises a
 * call is an EVM account: the signer is recovered from the signature itself
 * (EIP-191 `personal_sign`), which is why the envelope carries no public key.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { hashMessage, hexToBytes, keccak256 } from "viem";

export interface DataSignature {
  signature: string;
  /**
   * Unused for EVM wallets — the public key is recovered from the signature.
   * Retained so the envelope shape stays stable across wallet backends.
   */
  key?: string;
}

/** Crypto verifier: is `sig` a valid signature over `message` by `address`? */
export type SigVerifier = (message: string, sig: DataSignature, address: string) => boolean;

/**
 * Production verifier — EIP-191 signature recovery.
 *
 * Recovers the signing address from (message, signature) and compares it to the
 * claimed signer. A signature that recovers to any other address fails, so a
 * caller cannot act for an account whose key they do not hold.
 */
export const eip191Verifier: SigVerifier = (message, sig, address) => {
  const raw = (sig.signature || "").replace(/^0x/, "");
  // 65 bytes: r(32) ‖ s(32) ‖ v(1)
  if (raw.length !== 130 || !/^[0-9a-fA-F]+$/.test(raw)) return false;
  let v = parseInt(raw.slice(128, 130), 16);
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) return false;

  const recovered = secp256k1.Signature.fromCompact(raw.slice(0, 128))
    .addRecoveryBit(v)
    .recoverPublicKey(hexToBytes(hashMessage(message)))
    .toRawBytes(false); // uncompressed, 0x04-prefixed
  // address = last 20 bytes of keccak256(pubkey without the 0x04 prefix)
  const signer = "0x" + keccak256(recovered.slice(1)).slice(-40);
  return signer.toLowerCase() === address.toLowerCase();
};

export interface AuthEnvelope {
  signer: string; // 0x address that signed
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
  verify: SigVerifier = eip191Verifier,
): AuthResult {
  if (!envelope) return { ok: false, error: "missing auth (sign the request with your wallet)" };
  const { signer, ts, sig } = envelope;
  if (!signer || !sig?.signature) return { ok: false, error: "malformed auth envelope" };
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
