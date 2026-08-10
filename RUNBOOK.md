# dorr — runbook

Privacy-preserving perps on Cardano + Midnight. Everything runs locally except the Cardano preprod legs.

## What's built (and verified working)

| Layer | Status |
|-------|--------|
| Monorepo (`apps/web`, `packages/engine`, `packages/contracts-aiken`, `services/operator`, vendored Midnight CLI) | ✅ |
| Off-chain engine (matching, margin, funding, liquidation, commitment) from ZKPerps | ✅ imported, tests pass |
| Operator service — 5 markets, Pyth Hermes prices, vAMM executor, accounting, keepers | ✅ boots, live prices |
| Aiken contracts — dUSD sig-policy, margin vault (operator-param), settlement anchor | ✅ `aiken build` green (v1.1.21) |
| Midnight ZK pipeline — order→matching→settlement, real proofs on local net | ✅ **all 3 proofs verified (~40s each)** |
| A/B sandwich demo (deterministic) | ✅ victim pays ~150 bps more when public |
| Web app (ported UniPerp, Mesh/Lace, operator API) | ✅ **`bun run build` green; renders offline + wallet-less** |
| CIP-68 position NFTs | ✅ emulator-verified (222 to trader, 100+metadata to operator) |
| Cardano tx layer (mint / deposit / scan / withdraw / anchor) | ✅ **emulator-verified end-to-end (5 steps)** |
| Tests | ✅ engine 5, vAMM 7, cardano-emulator + cip68 → all green |
| **Cardano preprod (live)** — faucet dUSD, vault deposit/withdraw, anchor | ⛔ **blocked ONLY on funding the deployer** (logic already emulator-proven) |

## Security — wallet-signature auth

Every value-moving action (commit / execute / close / withdraw) is bound to a
CIP-30 wallet signature: the connected wallet signs a fresh, timestamped,
key-sorted message; the operator verifies it (cardano-verify-datasignature),
checks freshness (anti-replay window), rejects reused signatures, and confirms
the signer matches the acting address. **You cannot place or close someone
else's trade.** Enable enforcement with `DORR_AUTH=1` (the web signs
automatically when a wallet is connected). Proven by `test/auth-crypto.test.ts`
— a real CIP-8 signature is accepted, tampered params and cross-wallet forgery
are rejected.

## Tests (70, all green)

```bash
bun test services/operator/test/     # 65: math, auth, auth-crypto, privacy, vAMM, cardano-emulator, cip68, integration, features, features-v2 (batch/oracle-guard/cancel/stats)
bun run --cwd packages/engine test   # 5: commitment + settlement anchor
bun run --cwd services/operator src/scripts/live-e2e.ts   # assertive ON-CHAIN E2E (real preprod txs, confirms each on Koios)
```
- **Privacy/MEV** (`privacy.test.ts`): commitment is hiding + binding; brute-forcing the 128-bit nonce is infeasible; a private order's public view leaks nothing exploitable.
- **Batch/guard/cancel/stats** (`features-v2.test.ts`): uniform-price batch clearing makes a sandwich net $0 (structural); the oracle-divergence guard refuses a fill when mark ≠ oracle; cancel releases margin; stats surface OI/skew/funding.
- **Integration** (`integration.test.ts`): full commit→execute→close in-process with privacy + accounting assertions, and the live-A/B pool-restore invariant.
- **On-chain E2E** (`live-e2e.ts`): real user wallet → deposit → **proof-of-solvency** (reads the on-chain vault) → **cancel round-trip** → **batch auction** ($0 vs sequential) → private commit → match + CIP-68 NFT → settle + L1 anchor → operator-routed vault withdraw, asserting every preprod tx confirms on Koios. ZK proof legs run on the local Midnight net (or the env-gated `DORR_ZK_MODE=stub` when the local net is unavailable); the Cardano legs are always real preprod.

## Deployer wallet — FUND THIS (preprod tADA)

```
addr_test1qqlkgzx5fldu0c476qkr3svajr89jxaw6mk268cqdy5tna49zmp9qvht53kgd8vcmgyqhlzxjadcx9zj5vfx4lve8ygq9whvac
```
Faucet: https://docs.cardano.org/cardano-testnets/tools/faucet (select **Preprod**, request 2–3×).
Also add a free **Preprod** Blockfrost key to `dorr/.env` → `BLOCKFROST_PROJECT_ID=` (else it falls back to keyless Koios, which is slower/rate-limited for tx building).

## First run

```bash
cd dorr
bun install                              # workspaces
./tools/scripts/dev.sh up                # docker: Midnight localnet (proof 6301 / indexer 8088 / node 9945)
./tools/scripts/dev.sh fund-midnight     # once per fresh localnet — funds operator's Midnight wallet + DUST
./tools/scripts/dev.sh operator          # terminal A → :8790
./tools/scripts/dev.sh web               # terminal B → :3000
```

Once the deployer has tADA:

```bash
./tools/scripts/dev.sh preprod           # mints dUSD treasury, seeds vault, posts a genesis anchor
```

## The demo (A/B — the hero moment)

1. Connect **Lace** (preprod + Midnight). Faucet 10k dUSD. Deposit to vault (real preprod tx).
2. Open a trade with the **privacy toggle = public**: order details hit `/feed` → the sandwich bot front-runs → worse fill.
3. Same trade with **privacy = dorr private**: `/feed` shows only the commitment hash → bot blind → fair fill.
4. Point at the side-by-side: `POST /demo/ab` quantifies the difference (≈150 bps saved).
5. Close a position → watch the live proof steps: **settlement proof → Cardano anchor (explorer link) → Midnight bind**.

## Ports

| Service | Port |
|---------|------|
| web | 3000 |
| operator API | 8790 |
| Midnight proof server | 6301 |
| Midnight indexer (GraphQL v3) | 8088 |
| Midnight node RPC | 9945 |

(ghost's pre-existing localnet on 6300/8087/9944 is left untouched; dorr uses its own on 6301/8088/9945.)

## Verified evidence — full live E2E (real user wallet, preprod + local Midnight)

Reproduce: `bun run --cwd services/operator src/scripts/live-e2e.ts` (operator up). One clean run:

**Cardano preprod deploy (deployer funded 10k tADA):** dUSD policy `f0c16d56…` · mint `0debcefa…` · vault `addr_test1wqjah23…` · seed `b16a9585…` · genesis anchor `a3590a6c…`

**The run** (user `addr_test1qrlqtxp…`):
| step | what | tx |
|------|------|-----|
| 1 | operator → user gas | `490e9b9f…` (preprod) |
| 2 | faucet 5,000 dUSD (mint) | `a9535d0e…` (preprod) |
| 3 | **user-signed vault deposit** 3,000 dUSD | `856ef149…` (preprod) |
| 5 | commit + `proveTraderOrderAuthority` | `78baabe2…` (Midnight ZK) |
| 6 | `proveAndFinalizeMatch` | `0123d381…` (Midnight ZK) |
| 6 | **CIP-68 position NFT mint** | `58262448…` (preprod) |
| 7 | `proveSettlementTransition` | `048684da…` (Midnight ZK) |
| 7 | **L1 settlement anchor** (inline AnchorDatum) | `4b68a747…` (preprod) |
| 7 | `bindL1SettlementAnchor` | `69037ef7…` (Midnight ZK) |
| 8 | **operator-signed vault withdraw** (Aiken script spend) | `407fc6e4…` (preprod) |

That's 4 real ZK proofs + 6 real preprod txs — deposit, mint, NFT, anchor, withdraw all on-chain, order contents never exposed (public saw only commitment `8ed0bee0…`). Any hash → `https://preprod.cardanoscan.io/transaction/<hash>`.

Proof timing ~40s each on this machine; preprod confirmations ~20–90s via keyless Koios (add a Blockfrost preprod key to `.env` for snappier tx building).

## Key files

- `services/operator/src/vamm.ts` — the vAMM (Pyth mark + constant-product impact)
- `services/operator/src/trading.ts` — commit→execute→close lifecycle + keepers
- `services/operator/src/cardano.ts` — dUSD/vault/anchor tx building (Lucid)
- `services/operator/src/demo.ts` — the deterministic A/B sandwich
- `vendor/zkperps/midnight-local-cli/src/dorr-*.ts` — per-trade ZK proof drivers
- `packages/contracts-aiken/dorr-vault/validators/margin_vault.ak` — vault validator
