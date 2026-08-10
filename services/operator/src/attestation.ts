/**
 * Enclave batch attestation.
 *
 * When dorr clears a sealed-bid epoch, the matching engine signs a quote binding
 * the enclave identity to THAT batch (epoch id + membership root + clearing price
 * + order count). `TEEAttestationVerifier` on Flare recovers the signature and
 * refuses any batch whose quote it cannot attribute to a registered enclave, so
 * settlement is gated on attested code rather than on trusting the operator.
 *
 * Wire format (tight-packed, 161 bytes):
 *     teeId(32) | nonce(32) | payloadHash(32) | signature(65)
 *
 * Signed digest (EIP-191 over):
 *     keccak256(teeId, nonce, measurement, payloadHash)
 *
 * NOTE ON CORRECTNESS: the reference implementation this was derived from signed
 * with SHA-256 while its Solidity verifier hashed with keccak256, so its quotes
 * could never verify on-chain. Both sides here are keccak256, and
 * `test/attestation.test.ts` pins the digest against the deployed contract's own
 * `attestationDigest()` view so the two can never drift apart again.
 */
import { keccak256, encodePacked, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

export interface BatchQuote {
  teeId: Hex;
  nonce: bigint;
  payloadHash: Hex;
  signature: Hex;
  /** ABI-ready 161-byte attestation blob for DorrBatchSettlement. */
  attestation: Hex;
  signer: Hex;
}

/** The canonical payload an enclave attests to — mirrors DorrBatchSettlement.batchPayloadHash. */
export function batchPayloadHash(p: {
  epochId: Hex;
  membershipRoot: Hex;
  clearingPrice: bigint;
  orderCount: number;
}): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "uint256", "uint32"],
      [p.epochId, p.membershipRoot, p.clearingPrice, p.orderCount],
    ),
  );
}

/** The digest the enclave signs — mirrors TEEAttestationVerifier.attestationDigest. */
export function attestationDigest(p: {
  teeId: Hex;
  nonce: bigint;
  measurement: Hex;
  payloadHash: Hex;
}): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "uint256", "bytes32", "bytes32"],
      [p.teeId, p.nonce, p.measurement, p.payloadHash],
    ),
  );
}

export function enclaveConfigured(): boolean {
  return Boolean(env.flare.teeKey && env.flare.teeId && env.flare.teeMeasurement);
}

/** The enclave's signing address — this is what must be registered on-chain. */
export function enclaveAddress(): Hex {
  if (!env.flare.teeKey) throw new Error("TEE_ENCLAVE_KEY not configured");
  return privateKeyToAccount(env.flare.teeKey as Hex).address;
}

/**
 * Produce a signed quote for a cleared batch. Called by the matching engine
 * immediately after it computes the uniform clearing price.
 */
export async function signBatchQuote(p: {
  epochId: Hex;
  membershipRoot: Hex;
  clearingPrice: bigint;
  orderCount: number;
  nonce?: bigint;
}): Promise<BatchQuote> {
  if (!enclaveConfigured()) {
    throw new Error("enclave not configured (TEE_ENCLAVE_KEY / TEE_ID / TEE_MEASUREMENT)");
  }
  const account = privateKeyToAccount(env.flare.teeKey as Hex);
  const teeId = env.flare.teeId as Hex;
  const measurement = env.flare.teeMeasurement as Hex;
  const nonce = p.nonce ?? BigInt(Date.now());

  const payloadHash = batchPayloadHash(p);
  const digest = attestationDigest({ teeId, nonce, measurement, payloadHash });

  // EIP-191 personal_sign over the raw 32-byte digest — matches
  // MessageHashUtils.toEthSignedMessageHash on the verifier side.
  const signature = await account.signMessage({ message: { raw: digest } });

  const attestation = ("0x" +
    teeId.slice(2) +
    nonce.toString(16).padStart(64, "0") +
    payloadHash.slice(2) +
    signature.slice(2)) as Hex;

  return { teeId, nonce, payloadHash, signature, attestation, signer: account.address };
}
