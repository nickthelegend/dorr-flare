/**
 * Tenant identities inside one enclave.
 *
 * The problem this solves: you have one attested machine and several products
 * that want to use it. The naive version — one signing key, one sealing key,
 * shared by everybody — is worse than no isolation at all, because a quote
 * issued for product A verifies just as well against product B's contract, and
 * a ciphertext sealed to the enclave is readable by whichever product asks
 * first.
 *
 * So every tenant gets its **own** keys, derived deterministically from one
 * master seed:
 *
 *     signingKey(p) = HKDF-SHA256(seed, salt = "flare-tee-kit/v1/sign",  info = p)
 *     sealingKey(p) = HKDF-SHA256(seed, salt = "flare-tee-kit/v1/ecies", info = p)
 *
 * Two consequences worth stating plainly:
 *
 *   • **Cross-project replay is impossible by construction.** Each project
 *     registers its own tenant's signer address on-chain, so a quote signed by
 *     the `dorr` tenant simply does not recover to the address `hadal`
 *     registered. No domain-separation discipline to remember, no shared
 *     payload format to keep collision-free.
 *
 *   • **Losing the seed loses every tenant.** Derivation is the point — the
 *     enclave holds one secret and can reconstruct all identities after a
 *     restart — but it means the seed is the whole security boundary. It should
 *     be generated inside the enclave and never leave it.
 *
 * What this does **not** give you: isolation between tenants *within* the
 * process. Code running in the enclave can derive any tenant's key, so a
 * compromise of the enclave compromises all of them. If two products need to be
 * safe from each other's bugs, run two enclaves. This is separation of
 * identity, not of blast radius, and HELP.md says so where a reader will see it.
 */
import { hkdfSync, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

const SIGN_SALT = "flare-tee-kit/v1/sign";
const SEAL_SALT = "flare-tee-kit/v1/ecies";

/** A project namespace. Lowercase, stable, and never reused for a different app. */
export type ProjectId = string;

export interface Tenant {
  projectId: ProjectId;
  /** Registered on-chain; what a verifier recovers a quote to. */
  signer: PrivateKeyAccount;
  /** secp256k1 private key clients seal to (via `sealingPublicKey`). */
  sealingPrivateKey: Buffer;
  /** Uncompressed 65-byte public key, `0x04…` — hand this to clients. */
  sealingPublicKey: Hex;
  /** keccak-free stable id derived from the name; useful as a `teeId`. */
  tenantId: Hex;
}

const derive = (seed: Buffer, salt: string, info: string, bytes = 32): Buffer =>
  Buffer.from(hkdfSync("sha256", seed, Buffer.from(salt), Buffer.from(info), bytes));

/**
 * A secp256k1 scalar must be in [1, n). HKDF output is uniform over 2^256, so a
 * value outside the curve order is astronomically unlikely but not impossible —
 * rejection-sample rather than reduce, because reducing biases the key.
 */
const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
function deriveScalar(seed: Buffer, salt: string, info: string): Buffer {
  for (let i = 0; i < 256; i++) {
    const candidate = derive(seed, salt, i === 0 ? info : `${info}/${i}`);
    const v = BigInt("0x" + candidate.toString("hex"));
    if (v > 0n && v < N) return candidate;
  }
  throw new Error("HKDF failed to produce a valid secp256k1 scalar");
}

/** Generate a master seed. Call this **inside** the enclave; never import one. */
export const generateMasterSeed = (): Buffer => randomBytes(32);

/** Derive a tenant's identity from the enclave's master seed. */
export function deriveTenant(masterSeed: Buffer, projectId: ProjectId): Tenant {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(projectId)) {
    throw new Error(`projectId must be lowercase alphanumeric with dashes, got "${projectId}"`);
  }
  const signKey = deriveScalar(masterSeed, SIGN_SALT, projectId);
  const sealKey = deriveScalar(masterSeed, SEAL_SALT, projectId);
  const signer = privateKeyToAccount(`0x${signKey.toString("hex")}` as Hex);

  // Public key from the private scalar, uncompressed.
  const pub = secp256k1.getPublicKey(sealKey, false);

  return {
    projectId,
    signer,
    sealingPrivateKey: sealKey,
    sealingPublicKey: `0x${Buffer.from(pub).toString("hex")}` as Hex,
    tenantId: `0x${derive(masterSeed, "flare-tee-kit/v1/id", projectId).toString("hex")}` as Hex,
  };
}

/** Derive every configured tenant once at boot. */
export function deriveTenants(masterSeed: Buffer, projectIds: ProjectId[]): Map<ProjectId, Tenant> {
  const out = new Map<ProjectId, Tenant>();
  for (const id of projectIds) out.set(id, deriveTenant(masterSeed, id));
  return out;
}
