/**
 * REAL crypto round-trip: sign with a genuine CIP-8 signer, verify with the
 * PRODUCTION verifier (cardano-verify-datasignature) through verifyAuth. Proves
 * the wallet-signature auth actually works end-to-end and rejects forgery —
 * the same path a real Lace/Eternl signature takes.
 */
import { test, expect, beforeEach } from "bun:test";
import { verifyAuth, authMessage, cip30Verifier, _resetAuthSeen, type AuthEnvelope } from "../src/auth.js";
import { makeTestSigner } from "./_cip8-signer.js";

beforeEach(() => _resetAuthSeen());

test("a genuine wallet signature is accepted by the production verifier", async () => {
  const signer = await makeTestSigner("00112233445566778899aabbccddeeff");
  const params = { address: signer.address, marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private" };
  const ts = 1_700_000_000_000;
  const env: AuthEnvelope = { signer: signer.address, ts, sig: signer.sign(authMessage("commit", params, ts)) };

  const r = verifyAuth("commit", params, env, signer.address, ts, cip30Verifier);
  expect(r.ok).toBe(true);
});

test("tampering the signed params (e.g. bumping size) is rejected", async () => {
  const signer = await makeTestSigner("00112233445566778899aabbccddeeff");
  const params = { address: signer.address, marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private" };
  const ts = 1_700_000_000_000;
  const env: AuthEnvelope = { signer: signer.address, ts, sig: signer.sign(authMessage("commit", params, ts)) };

  // Attacker inflates margin after signing — server recomputes the message → mismatch.
  const tampered = { ...params, marginUsd: 100_000 };
  const r = verifyAuth("commit", tampered, env, signer.address, ts, cip30Verifier);
  expect(r.ok).toBe(false);
});

test("a signature from wallet A cannot authorize an action for address B", async () => {
  const attacker = await makeTestSigner("0000000000000000000000000000ffff");
  const victim = await makeTestSigner("ffff0000000000000000000000000000");
  const params = { address: victim.address, amount: 5000 };
  const ts = 1_700_000_000_000;
  // Attacker signs, but claims to be the victim (signer field spoofed to victim).
  const env: AuthEnvelope = { signer: victim.address, ts, sig: attacker.sign(authMessage("withdraw", params, ts)) };
  const r = verifyAuth("withdraw", params, env, victim.address, ts, cip30Verifier);
  expect(r.ok).toBe(false); // signature doesn't verify against the victim address
});
