/**
 * REAL crypto round-trip: sign with a genuine EVM key, verify with the
 * PRODUCTION verifier (EIP-191 recovery) through verifyAuth. Proves the
 * wallet-signature auth actually works end-to-end and rejects forgery — the
 * same path a real MetaMask/Rabby `personal_sign` takes.
 */
import { test, expect, beforeEach } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyAuth, authMessage, eip191Verifier, _resetAuthSeen, type AuthEnvelope } from "../src/auth.js";

beforeEach(() => _resetAuthSeen());

const account = (hexByte: string) =>
  privateKeyToAccount(("0x" + hexByte.repeat(32)) as `0x${string}`);

/** Sign exactly the way the browser's `evmSigner` does (no public key in the envelope). */
const sign = async (acct: ReturnType<typeof account>, message: string) => ({
  signature: await acct.signMessage({ message }),
});

test("a genuine wallet signature is accepted by the production verifier", async () => {
  const signer = account("11");
  const params = { address: signer.address, marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private" };
  const ts = 1_700_000_000_000;
  const env: AuthEnvelope = { signer: signer.address, ts, sig: await sign(signer, authMessage("commit", params, ts)) };

  const r = verifyAuth("commit", params, env, signer.address, ts, eip191Verifier);
  expect(r.ok).toBe(true);
});

test("tampering the signed params (e.g. bumping size) is rejected", async () => {
  const signer = account("11");
  const params = { address: signer.address, marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 5, privacyMode: "private" };
  const ts = 1_700_000_000_000;
  const env: AuthEnvelope = { signer: signer.address, ts, sig: await sign(signer, authMessage("commit", params, ts)) };

  // Attacker inflates margin after signing — server recomputes the message → mismatch.
  const tampered = { ...params, marginUsd: 100_000 };
  const r = verifyAuth("commit", tampered, env, signer.address, ts, eip191Verifier);
  expect(r.ok).toBe(false);
});

test("a signature from wallet A cannot authorize an action for address B", async () => {
  const attacker = account("ab");
  const victim = account("cd");
  const params = { address: victim.address, amount: 5000 };
  const ts = 1_700_000_000_000;
  // Attacker signs, but claims to be the victim (signer field spoofed to victim).
  const env: AuthEnvelope = { signer: victim.address, ts, sig: await sign(attacker, authMessage("withdraw", params, ts)) };
  const r = verifyAuth("withdraw", params, env, victim.address, ts, eip191Verifier);
  expect(r.ok).toBe(false); // recovers to the attacker, not the victim
});

test("a malformed signature is rejected rather than throwing", async () => {
  const signer = account("11");
  const params = { address: signer.address, amount: 1 };
  const ts = 1_700_000_000_000;
  const env: AuthEnvelope = { signer: signer.address, ts, sig: { signature: "0xdeadbeef" } };
  const r = verifyAuth("withdraw", params, env, signer.address, ts, eip191Verifier);
  expect(r.ok).toBe(false);
});
