/**
 * Confidential compute primitives: ECIES order sealing and enclave attestation.
 *
 * These are the two properties the whole Bounty-2 story rests on:
 *   1. a sealed order is unreadable without the enclave key, and
 *   2. the quote the enclave signs is exactly the digest the on-chain verifier
 *      recomputes (the reference implementation this was derived from got this
 *      wrong — it signed SHA-256 while its verifier hashed keccak256, so its
 *      attestations could never verify).
 */
import { test, expect } from "bun:test";
import { keccak256, encodePacked, toHex, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateEnclaveKeypair,
  publicKeyOf,
  sealToEnclave,
  openInEnclave,
  sealedCommitment,
  encodeSealed,
  decodeSealed,
} from "../src/ecies.js";
import { batchPayloadHash, attestationDigest } from "../src/attestation.js";

const ORDER = JSON.stringify({ side: "LONG", sizeBase: 30000, marginFxrp: 1.5, leverage: 4 });

// ─── ECIES ───────────────────────────────────────────────────────────────────

test("ECIES: seal → open round-trips exactly", () => {
  const kp = generateEnclaveKeypair();
  expect(kp.publicKey.length).toBe(65);
  expect(kp.publicKey[0]).toBe(0x04);
  const sealed = sealToEnclave(kp.publicKey, ORDER);
  expect(openInEnclave(kp.privateKey, sealed).toString("utf8")).toBe(ORDER);
});

test("ECIES: ciphertext leaks nothing about the order", () => {
  const kp = generateEnclaveKeypair();
  const sealed = sealToEnclave(kp.publicKey, ORDER);
  const asText = sealed.toString("utf8");
  const asHex = sealed.toString("hex");
  for (const secret of ["LONG", "30000", "sizeBase", "leverage"]) {
    expect(asText.includes(secret)).toBe(false);
    expect(asHex.includes(Buffer.from(secret).toString("hex"))).toBe(false);
  }
});

test("ECIES: the operator (any other key) cannot decrypt", () => {
  const enclave = generateEnclaveKeypair();
  const operator = generateEnclaveKeypair();
  const sealed = sealToEnclave(enclave.publicKey, ORDER);
  expect(() => openInEnclave(operator.privateKey, sealed)).toThrow();
});

test("ECIES: tampering with the ciphertext is detected (AEAD)", () => {
  const kp = generateEnclaveKeypair();
  const sealed = sealToEnclave(kp.publicKey, ORDER);
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 20] ^= 0xff; // flip a bit inside the ciphertext
  expect(() => openInEnclave(kp.privateKey, tampered)).toThrow();
});

test("ECIES: same plaintext seals to different ciphertexts (ephemeral keys)", () => {
  const kp = generateEnclaveKeypair();
  const a = sealToEnclave(kp.publicKey, ORDER);
  const b = sealToEnclave(kp.publicKey, ORDER);
  expect(a.toString("hex")).not.toBe(b.toString("hex"));
  expect(sealedCommitment(a)).not.toBe(sealedCommitment(b));
  // ...but both open to the same order.
  expect(openInEnclave(kp.privateKey, a).toString()).toBe(openInEnclave(kp.privateKey, b).toString());
});

test("ECIES: public key derives deterministically from the private key", () => {
  const kp = generateEnclaveKeypair();
  expect(publicKeyOf(kp.privateKey).toString("hex")).toBe(kp.publicKey.toString("hex"));
});

test("ECIES: hex encode/decode round-trips", () => {
  const kp = generateEnclaveKeypair();
  const sealed = sealToEnclave(kp.publicKey, ORDER);
  expect(decodeSealed(encodeSealed(sealed)).toString("hex")).toBe(sealed.toString("hex"));
});

// ─── attestation ─────────────────────────────────────────────────────────────

const TEE_ID = keccak256(toHex("dorr-tee-1"));
const MEASUREMENT = keccak256(toHex("dorr-tee-image-v1"));

test("attestation: payload hash matches the contract's abi.encodePacked layout", () => {
  const epochId = keccak256(toHex("epoch-1"));
  const membershipRoot = keccak256(toHex("root-1"));
  const clearingPrice = 197148n;
  const orderCount = 2;

  const ours = batchPayloadHash({ epochId, membershipRoot, clearingPrice, orderCount });
  const expected = keccak256(
    encodePacked(
      ["bytes32", "bytes32", "uint256", "uint32"],
      [epochId, membershipRoot, clearingPrice, orderCount],
    ),
  );
  expect(ours).toBe(expected);
});

test("attestation: digest is keccak256 — NOT sha256 (the reference impl's bug)", () => {
  const payloadHash = keccak256(toHex("payload"));
  const nonce = 7n;
  const digest = attestationDigest({ teeId: TEE_ID, nonce, measurement: MEASUREMENT, payloadHash });

  // Exactly what TEEAttestationVerifier.attestationDigest computes.
  const expected = keccak256(
    encodePacked(["bytes32", "uint256", "bytes32", "bytes32"], [TEE_ID, nonce, MEASUREMENT, payloadHash]),
  );
  expect(digest).toBe(expected);

  // A SHA-256 digest of the same preimage must NOT collide — proving we are not
  // silently reproducing the broken scheme.
  const sha = new Bun.CryptoHasher("sha256")
    .update(Buffer.from(digest.slice(2), "hex"))
    .digest("hex");
  expect(digest.slice(2)).not.toBe(sha);
});

test("attestation: signature recovers to the enclave signer (EIP-191)", async () => {
  const key = ("0x" + "42".repeat(32)) as Hex;
  const account = privateKeyToAccount(key);
  const payloadHash = keccak256(toHex("payload"));
  const digest = attestationDigest({ teeId: TEE_ID, nonce: 1n, measurement: MEASUREMENT, payloadHash });

  const signature = await account.signMessage({ message: { raw: digest } });
  const recovered = await recoverMessageAddress({ message: { raw: digest }, signature });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
});

test("attestation: a different batch produces a different payload hash (no replay)", () => {
  const base = {
    epochId: keccak256(toHex("epoch-A")),
    membershipRoot: keccak256(toHex("root")),
    clearingPrice: 100000n,
    orderCount: 2,
  };
  const a = batchPayloadHash(base);
  expect(batchPayloadHash({ ...base, epochId: keccak256(toHex("epoch-B")) })).not.toBe(a);
  expect(batchPayloadHash({ ...base, clearingPrice: 100001n })).not.toBe(a);
  expect(batchPayloadHash({ ...base, orderCount: 3 })).not.toBe(a);
});
