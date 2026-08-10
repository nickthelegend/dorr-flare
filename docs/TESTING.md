# 🧪 Testing

**122 automated tests, all green** — 88 operator, 31 Solidity, 3 engine — plus two
assertive **on-chain E2E** scripts that run real Coston2 transactions and confirm
each one on-chain.

```bash
bun test --cwd services/operator     # 88 tests, 12 files
bun test --cwd packages/engine       #  3 tests
forge test --root contracts          # 31 tests, 4 suites

# on-chain (needs a funded relayer — see RUNBOOK):
bun run --cwd services/operator src/scripts/flare-e2e.ts
bun run --cwd services/operator src/scripts/confidential-e2e.ts
```

## Operator suite

| File | Tests | What it pins |
|------|-------|--------------|
| `features-v2.test.ts` | 15 | batch auction clears at one price; **oracle-divergence guard refuses a fill when the venue mark ≠ oracle**; cancel releases margin; stats/OI/skew; **liquidation keeper** closes a position past the maintenance floor and leaves a healthy one alone; **funding keeper** accrues on the premium |
| `trading-math.test.ts` | 13 | sizing, PnL sign (long/short), taker fee, funding rate/payment sign + cap, equity ratio, liquidation threshold, settled delta |
| `confidential.test.ts` | 11 | ECIES seal/open to the enclave key, attestation digest layout matching the verifier, quote binding to a specific batch payload |
| `auth.test.ts` | 9 | envelope logic: accept valid, reject missing/malformed/stale/wrong-signer/invalid-sig, **replay dedupe**, deterministic message |
| `privacy.test.ts` | 7 | commitment hiding + binding + brute-force-infeasible; private view leaks nothing; public foil leaks (as intended) |
| `vamm.test.ts` | 7 | constant-product invariant, impact direction, size cap, recenter re-peg + no-op-in-tolerance |
| `features.test.ts` | 5 | partial close, add/remove margin, hidden stop-loss/take-profit, slippage guard |
| `integration.test.ts` | 5 | **full lifecycle** via `app.request` (commit→execute→close) + privacy + accounting asserts; insufficient-margin reject; A/B quantified; **live-A/B pool-restore invariant** |
| `sealbid.test.ts` | 5 | timelock sealing to a drand round, membership root, tamper/over-bound orders dropped |
| `sealed-e2e.test.ts` | 4 | sealed epoch against **live drand**: sealed → ripe → cleared at one uniform price |
| `auth-crypto.test.ts` | 4 | **real EIP-191 round-trip**: a genuine `personal_sign` is accepted by the production verifier; tampered params, cross-wallet forgery and a malformed signature are all rejected |
| `attack-disclosure.test.ts` | 3 | selective disclosure verifies against the commitment; a tampered reveal is rejected |

## Solidity suite

| File | Tests | What it pins |
|------|-------|--------------|
| `DorrVault.t.sol` | 9 | deposit credits backing; **only the depositor can withdraw**; settlement can't drain the vault; PnL must be zero-sum; **fuzz: a withdrawal never exceeds free balance** |
| `MarginCustody.t.sol` | 9 | margin lock/release authority, locked margin is not withdrawable, custody invariants under partial settlement |
| `TEEAttestation.t.sol` | 8 | quote verification, revoked enclave rejected, wrong measurement can't register, **a quote is bound to one batch payload** |
| `BatchSettlement.fork.t.sol` | 5 | forked Coston2: the contract's own **FTSO re-read**, `PriceOutOfBand` revert past `maxDriftBps`, duplicate-epoch rejection |

## What the E2E scripts prove on-chain

`confidential-e2e.ts` — the operator relays ciphertext it cannot read, the enclave
decrypts and clears the epoch at one uniform price, signs a quote, and the batch
settles on Coston2 **only** because the contract's FTSO re-read and the quote both
check out. It then submits a **forged attestation and asserts the chain rejects it**.

`flare-e2e.ts` — vault deposit, margin lock, batch settle, and a depositor-signed
withdrawal, each confirmed by receipt.

No test doubles stand in for the settlement path: the on-chain legs run against
real Coston2 contracts with a real relayer key.
