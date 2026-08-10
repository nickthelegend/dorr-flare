# 🧪 Testing

**47 automated tests, all green** — plus an assertive **on-chain E2E** that runs real ZK proofs and real preprod transactions and confirms each on-chain.

```bash
bun test --cwd services/operator     # 42 tests, 8 files
bun test --cwd packages/engine       #  5 tests
# on-chain (needs localnet up + funded deployer — see RUNBOOK):
bun run --cwd services/operator src/scripts/live-e2e.ts
```

## The suite

| File | Tests | What it pins |
|------|-------|--------------|
| `operator/test/trading-math.test.ts` | 10 | sizing, PnL sign (long/short), taker fee, funding rate/payment sign + cap, equity ratio, liquidation threshold, settled delta |
| `operator/test/auth.test.ts` | 9 | envelope logic: accept valid, reject missing/malformed/stale/wrong-signer/invalid-sig, **replay dedupe**, deterministic message |
| `operator/test/auth-crypto.test.ts` | 3 | **real CIP-8 round-trip**: genuine signature accepted by the production verifier; tamper + cross-wallet forgery rejected |
| `operator/test/privacy.test.ts` | 7 | commitment hiding + binding + brute-force-infeasible; private view leaks nothing; public foil leaks (as intended) |
| `operator/test/vamm.test.ts` | 7 | constant-product invariant, impact direction, size cap, recenter re-peg + no-op-in-tolerance |
| `operator/test/cardano-emulator.test.ts` | 1 | full Cardano tx layer on Lucid emulator: mint → deposit → scan → withdraw → anchor |
| `operator/test/cip68.test.ts` | 1 | CIP-68 mint: (222) to trader, (100) + metadata to operator, datum decodes |
| `operator/test/integration.test.ts` | 5 | **full lifecycle** via `app.request` (commit→execute→close) + privacy + accounting asserts; insufficient-margin reject; A/B quantified; **live-A/B pool-restore invariant** |
| `engine/*.test.ts` | 5 | order commitment stability + settlement-anchor CBOR |

Fast tests use env-gated test doubles for the two slow/external legs — `DORR_ZK_MODE=stub` (skip the 40s prover) and `DORR_TEST=1` (skip preprod for the anchor). These are **test-only, never on in production**, and the real paths are covered by the on-chain E2E below.

## On-chain E2E

`services/operator/src/scripts/live-e2e.ts` is a real, assertive end-to-end run with a fresh user wallet:

```
[1] operator → user gas (tADA)          [5] private commit  → ZK authority proof
[2] faucet 5,000 dUSD (mint)            [6] execute → vAMM fill + ZK match + CIP-68 NFT
[3] USER-signed vault deposit           [7] close → ZK settle + L1 anchor + ZK bind
[4] /deposits/sync                      [8] operator-signed vault withdraw
[verify] every preprod tx must confirm on Koios → PASS/FAIL, exit code
```

It asserts: the commitment is a 32-byte hash, **the public feed exposes only that hash**, each ZK job completes, the position opens, the NFT mints, the settlement anchors, and **every Cardano tx confirms on-chain**.

**Last run: `✓ ON-CHAIN E2E PASSED — 11 txs, all assertions green`** — confirmations gas 19 · faucet 17 · deposit 15 · NFT 7 · anchor 3 · withdraw 1. (Real tx hashes for a prior run are in the [RUNBOOK](../RUNBOOK.md#verified-evidence).)

## Contract build check

```bash
cd packages/contracts-aiken/dorr-vault && aiken build     # margin vault (Plutus V3)
cd packages/contracts-aiken/settlement-anchor && aiken build
```

## Web build

```bash
bun run --cwd apps/web build     # exits 0 (static prerender of / and /_not-found)
```
> ⚠️ Don't run the build while `dev` is live — it corrupts `.next`. Stop dev, `rm -rf apps/web/.next`, then build.

## What isn't automated
- The **browser** wallet round-trip (Mesh `signData` → operator) — no headless wallet exists; the crypto convention it relies on is proven by `auth-crypto.test.ts`, and the flow is manual-tested with Lace/Eternl on Preprod.
- Load/concurrency and adversarial fuzzing — out of scope for a hackathon build.
