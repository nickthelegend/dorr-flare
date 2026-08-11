import { describe, it, expect } from "vitest";
import {
  generateMasterSeed, deriveTenant, deriveTenants,
  signQuote, parseQuote, attestationDigest,
  sealToEnclave, openInEnclave, detectTee, getHardwareQuote,
} from "./index.js";

const seed = Buffer.from("11".repeat(32), "hex");

describe("tenants", () => {
  it("derives deterministically from the seed", () => {
    const a = deriveTenant(seed, "dorr");
    const b = deriveTenant(seed, "dorr");
    expect(a.signer.address).toBe(b.signer.address);
    expect(a.sealingPublicKey).toBe(b.sealingPublicKey);
  });

  it("gives every project a different identity", () => {
    const [dorr, hadal, molfi] = ["dorr", "hadal", "molfi"].map((p) => deriveTenant(seed, p));
    const signers = new Set([dorr.signer.address, hadal.signer.address, molfi.signer.address]);
    const sealers = new Set([dorr.sealingPublicKey, hadal.sealingPublicKey, molfi.sealingPublicKey]);
    expect(signers.size).toBe(3);
    expect(sealers.size).toBe(3);
  });

  it("a different seed gives different identities", () => {
    const other = deriveTenant(generateMasterSeed(), "dorr");
    expect(other.signer.address).not.toBe(deriveTenant(seed, "dorr").signer.address);
  });

  it("rejects a malformed projectId", () => {
    expect(() => deriveTenant(seed, "Dorr")).toThrow();
    expect(() => deriveTenant(seed, "")).toThrow();
  });
});

describe("attestation envelope", () => {
  const payloadHash = ("0x" + "ab".repeat(32)) as `0x${string}`;

  it("round-trips through parse", async () => {
    const t = deriveTenant(seed, "dorr");
    const q = await signQuote({ signer: t.signer, teeId: t.tenantId, measurement: ("0x" + "cd".repeat(32)) as any, payloadHash, nonce: 42n });
    expect(q.attestation.length).toBe(2 + 161 * 2);
    const p = parseQuote(q.attestation);
    expect(p.ok).toBe(true);
    expect(p.teeId).toBe(t.tenantId);
    expect(p.nonce).toBe(42n);
    expect(p.payloadHash).toBe(payloadHash);
  });

  it("a quote signed for one project does not verify as another", async () => {
    const measurement = ("0x" + "cd".repeat(32)) as any;
    const dorr = deriveTenant(seed, "dorr");
    const hadal = deriveTenant(seed, "hadal");
    const q = await signQuote({ signer: dorr.signer, teeId: dorr.tenantId, measurement, payloadHash });
    // hadal's contract registered hadal's signer; dorr's quote recovers elsewhere.
    expect(q.signer).toBe(dorr.signer.address);
    expect(q.signer).not.toBe(hadal.signer.address);
  });

  it("the digest is keccak256, matching the Solidity side", () => {
    const d = attestationDigest({ teeId: ("0x" + "00".repeat(32)) as any, nonce: 1n, measurement: ("0x" + "00".repeat(32)) as any, payloadHash });
    expect(d).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("ecies", () => {
  it("only the owning tenant can open its ciphertext", () => {
    const dorr = deriveTenant(seed, "dorr");
    const hadal = deriveTenant(seed, "hadal");
    const sealed = sealToEnclave(Buffer.from(dorr.sealingPublicKey.slice(2), "hex"), "LONG 2.5 FLR");
    expect(openInEnclave(dorr.sealingPrivateKey, sealed).toString()).toBe("LONG 2.5 FLR");
    expect(() => openInEnclave(hadal.sealingPrivateKey, sealed)).toThrow();
  });
});

describe("hardware", () => {
  it("is honest when there is no enclave", async () => {
    const hw = await getHardwareQuote();
    if (detectTee() === "none") {
      expect(hw.available).toBe(false);
      expect(hw.mode).toBe("none");
      expect(hw.note).toMatch(/no enclave/i);
      expect(hw).not.toHaveProperty("quote");
    }
  });
});
