import { test, expect, beforeEach } from "bun:test";
import { verifyAuth, authMessage, _resetAuthSeen, type AuthEnvelope, type SigVerifier } from "../src/auth.js";

const SIGNER = "addr_test1qqowner";
const NOW = 1_000_000_000_000;

// Stub verifier: "valid" iff the message equals what SIGNER supposedly signed.
// This lets us pin the ENVELOPE logic (freshness/replay/binding) deterministically;
// the real Ed25519/COSE crypto is the CF lib (exercised in the browser E2E).
const accept: SigVerifier = () => true;
const reject: SigVerifier = () => false;

function envelope(action: string, params: Record<string, unknown>, over: Partial<AuthEnvelope> = {}): AuthEnvelope {
  return { signer: SIGNER, ts: NOW, sig: { signature: "sig-" + action, key: "key" }, ...over };
}

beforeEach(() => _resetAuthSeen());

test("valid signed request passes", () => {
  const p = { address: SIGNER, marketId: "FLR-USD" };
  const r = verifyAuth("commit", p, envelope("commit", p), SIGNER, NOW, accept);
  expect(r.ok).toBe(true);
});

test("missing envelope is rejected", () => {
  const r = verifyAuth("commit", {}, undefined, SIGNER, NOW, accept);
  expect(r.ok).toBe(false);
});

test("malformed envelope (no sig) is rejected", () => {
  const r = verifyAuth("commit", {}, { signer: SIGNER, ts: NOW, sig: { signature: "", key: "" } }, SIGNER, NOW, accept);
  expect(r.ok).toBe(false);
});

test("stale signature outside replay window is rejected", () => {
  const p = { address: SIGNER };
  const r = verifyAuth("commit", p, envelope("commit", p, { ts: NOW - 200_000 }), SIGNER, NOW, accept);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("replay window");
});

test("signer mismatch (acting on someone else's address) is rejected", () => {
  const p = { address: "addr_test1qqVICTIM" };
  const r = verifyAuth("commit", p, envelope("commit", p), "addr_test1qqVICTIM", NOW, accept);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("signer does not match");
});

test("cryptographically invalid signature is rejected", () => {
  const p = { address: SIGNER };
  const r = verifyAuth("commit", p, envelope("commit", p), SIGNER, NOW, reject);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("invalid signature");
});

test("replay of the same signature is rejected the second time", () => {
  const p = { address: SIGNER };
  const env1 = envelope("commit", p);
  expect(verifyAuth("commit", p, env1, SIGNER, NOW, accept).ok).toBe(true);
  const r2 = verifyAuth("commit", p, env1, SIGNER, NOW, accept);
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.error).toContain("replay");
});

test("verifier throwing does not crash — treated as rejection", () => {
  const p = { address: SIGNER };
  const boom: SigVerifier = () => { throw new Error("bad cbor"); };
  const r = verifyAuth("commit", p, envelope("commit", p), SIGNER, NOW, boom);
  expect(r.ok).toBe(false);
});

test("authMessage is deterministic regardless of key order", () => {
  const a = authMessage("commit", { b: 2, a: 1 }, NOW);
  const b = authMessage("commit", { a: 1, b: 2 }, NOW);
  expect(a).toBe(b);
  expect(a).toContain("dorr:commit");
  expect(a).toContain(`ts:${NOW}`);
});
