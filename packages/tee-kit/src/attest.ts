/**
 * The attestation envelope a contract can check.
 *
 * 161 bytes, tight-packed:
 *
 *     teeId(32) | nonce(32) | payloadHash(32) | signature(65)
 *
 * signed (EIP-191) over:
 *
 *     keccak256(teeId, nonce, measurement, payloadHash)
 *
 * `payloadHash` is opaque to this module on purpose. It is whatever *your*
 * contract recomputes from the thing it is about to accept — a cleared batch, a
 * confidential transfer, an opened bid book. That is what makes the quote worth
 * anything: a verifier that only checks "some enclave signed something" is
 * checking that the enclave is switched on. A verifier that recomputes the
 * payload hash from the state transition in front of it, and rejects a quote
 * over anything else, is checking that *this* transition came from the enclave.
 *
 * A warning learned the hard way: the reference implementation this format came
 * from signed with SHA-256 while its Solidity verifier hashed with keccak256, so
 * no quote it ever produced could verify on-chain. Both sides here are
 * keccak256. Pin it with a test against your verifier's own digest view.
 */
import { keccak256, encodePacked, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export interface Quote {
  teeId: Hex;
  nonce: bigint;
  payloadHash: Hex;
  signature: Hex;
  /** The 161-byte blob to hand your contract. */
  attestation: Hex;
  /** Address the signature recovers to — register this on-chain. */
  signer: Hex;
}

/** The digest the enclave signs. Mirror this exactly in Solidity. */
export const attestationDigest = (p: {
  teeId: Hex;
  nonce: bigint;
  measurement: Hex;
  payloadHash: Hex;
}): Hex =>
  keccak256(
    encodePacked(
      ["bytes32", "uint256", "bytes32", "bytes32"],
      [p.teeId, p.nonce, p.measurement, p.payloadHash],
    ),
  );

/** Sign a quote binding this enclave to one payload. */
export async function signQuote(p: {
  signer: PrivateKeyAccount;
  teeId: Hex;
  measurement: Hex;
  payloadHash: Hex;
  nonce?: bigint;
}): Promise<Quote> {
  const nonce = p.nonce ?? BigInt(Date.now());
  const digest = attestationDigest({
    teeId: p.teeId,
    nonce,
    measurement: p.measurement,
    payloadHash: p.payloadHash,
  });
  // personal_sign over the raw 32 bytes — matches
  // MessageHashUtils.toEthSignedMessageHash on the verifier side.
  const signature = await p.signer.signMessage({ message: { raw: digest } });

  const attestation = ("0x" +
    p.teeId.slice(2) +
    nonce.toString(16).padStart(64, "0") +
    p.payloadHash.slice(2) +
    signature.slice(2)) as Hex;

  return { teeId: p.teeId, nonce, payloadHash: p.payloadHash, signature, attestation, signer: p.signer.address };
}

/** Split a 161-byte attestation back into its parts (mirrors the Solidity parser). */
export function parseQuote(attestation: Hex): {
  ok: boolean;
  teeId: Hex;
  nonce: bigint;
  payloadHash: Hex;
  signature: Hex;
} {
  const raw = attestation.replace(/^0x/, "");
  const ok = raw.length === 322 && /^[0-9a-fA-F]+$/.test(raw);
  return {
    ok,
    teeId: `0x${raw.slice(0, 64)}` as Hex,
    nonce: ok ? BigInt(`0x${raw.slice(64, 128)}`) : 0n,
    payloadHash: `0x${raw.slice(128, 192)}` as Hex,
    signature: `0x${raw.slice(192)}` as Hex,
  };
}
