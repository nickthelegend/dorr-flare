/**
 * ECIES sealing — client → enclave order confidentiality.
 *
 * A trader encrypts their order to the enclave's public key. Only the process
 * holding the enclave private key can decrypt it. The operator/API tier relays
 * ciphertext it cannot read, so order contents are confidential from the
 * operator itself, not merely from the public.
 *
 * Scheme (SECP256K1 ECIES, same curve as Flare/Ethereum):
 *   ephemeral keypair → ECDH with the enclave pubkey → HKDF-SHA256 → AES-256-GCM
 *   wire: ephemeralPubKey(65) | iv(12) | ciphertext+tag
 *
 * Uses @noble/curves for SECP256K1 (the same audited library viem depends on, so
 * there is no version skew) and Node's built-in crypto for HKDF and AES-GCM.
 *
 * This is complementary to the drand timelock already in `sealbid.ts`:
 *   • drand timelock  → nobody (operator included) can read the order UNTIL a
 *                       future round, i.e. until the batch is frozen.
 *   • ECIES-to-enclave → only attested enclave code can EVER read it.
 * Used together, an order is unreadable by the operator before the batch closes
 * and readable afterwards only inside the enclave that the chain attests.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

const KDF_INFO = Buffer.from("dorr-ecies-v1-aes256gcm");

export interface EnclaveKeypair {
  /** 32-byte private key — never leaves the enclave process. */
  privateKey: Buffer;
  /** 65-byte uncompressed public key (0x04 || X || Y). */
  publicKey: Buffer;
}

export function generateEnclaveKeypair(): EnclaveKeypair {
  const sk = secp256k1.utils.randomPrivateKey();
  return { privateKey: Buffer.from(sk), publicKey: Buffer.from(secp256k1.getPublicKey(sk, false)) };
}

export function publicKeyOf(privateKey: Buffer): Buffer {
  return Buffer.from(secp256k1.getPublicKey(privateKey, false));
}

/** ECDH shared secret (x-coordinate of the shared point). */
function sharedSecret(privateKey: Buffer, peerPublicKey: Buffer): Buffer {
  // getSharedSecret returns 33 bytes (compressed point); drop the parity prefix.
  const pt = secp256k1.getSharedSecret(privateKey, peerPublicKey, true);
  return Buffer.from(pt.slice(1));
}

function deriveKey(shared: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), KDF_INFO, 32));
}

/** Encrypt a payload so only the holder of the matching enclave key can read it. */
export function sealToEnclave(enclavePublicKey: Buffer, plaintext: Buffer | string): Buffer {
  if (enclavePublicKey.length !== 65 || enclavePublicKey[0] !== 0x04) {
    throw new Error("enclave public key must be 65-byte uncompressed SECP256K1");
  }
  const ephSk = secp256k1.utils.randomPrivateKey();
  const ephPub = Buffer.from(secp256k1.getPublicKey(ephSk, false));
  const key = deriveKey(sharedSecret(Buffer.from(ephSk), enclavePublicKey));

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);

  return Buffer.concat([ephPub, iv, ct]);
}

/** Decrypt a sealed payload. Only callable where the enclave private key lives. */
export function openInEnclave(enclavePrivateKey: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < 65 + 12 + 16) throw new Error("sealed payload too short");
  const ephPub = sealed.subarray(0, 65);
  const iv = sealed.subarray(65, 77);
  const body = sealed.subarray(77);
  const ct = body.subarray(0, body.length - 16);
  const tag = body.subarray(body.length - 16);

  const key = deriveKey(sharedSecret(enclavePrivateKey, ephPub));

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Public commitment to a sealed payload — what the chain/feed can safely show. */
export function sealedCommitment(sealed: Buffer): string {
  return "0x" + createHash("sha256").update(sealed).digest("hex");
}

export const encodeSealed = (sealed: Buffer): string => "0x" + sealed.toString("hex");
export const decodeSealed = (hex: string): Buffer => Buffer.from(hex.replace(/^0x/, ""), "hex");
