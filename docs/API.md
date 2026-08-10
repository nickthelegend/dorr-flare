# 🔌 API & on-chain reference

The operator is a Hono server on `http://localhost:8790`. All JSON. CORS-open for the web app.

## Conventions

- Prices/PnL are numbers in **dUSD** (6-decimals on-chain, plain numbers over the API).
- Slow work (ZK proofs ~40s, preprod confirmations) runs as **async jobs** — mutating calls return a `jobId` you poll.
- **Value-moving** calls (`commit`, `execute`, `close`, `withdraw`) accept an `auth` envelope and require it when `DORR_AUTH=1`. See [SECURITY](./SECURITY.md).

## Market & price

| Method | Path | Returns |
|--------|------|---------|
| GET | `/health` | `{ ok, service, markets, cardanoReady }` |
| GET | `/config` | addresses, explorer base, market metadata (for the evidence panel) |
| GET | `/markets` | `{ markets: [{ id, symbol, base, maxLeverage, maxOiUsd, disabled, indexPrice, markPrice, publishTime, vamm }] }` |

## Collateral (dUSD + vault)

| Method | Path | Body / returns |
|--------|------|----------------|
| GET | `/vault/info?address=addr_test1…` | `{ vaultAddress, dusdPolicyId, dusdUnit, dusdDecimals, operatorAddress, anchorAddress, depositDatumCbor }` |
| POST | `/faucet` | `{ address, amount? }` → mints dUSD (real preprod tx) → `{ success, txHash, amount }` |
| GET | `/account/:address` | `{ balance, locked, free, openPositions }` |
| POST | `/deposits/sync` | `{ address }` → credits confirmed vault deposits → `{ credited, balance, free }` |
| POST | `/withdraw` 🔐 | `{ address, amount, auth? }` → operator-signed vault spend → `{ success, txHash }` |

**Deposit** is built client-side (Mesh) — pay dUSD + min-ADA to `vaultAddress` with the inline `depositDatumCbor` (attributes the deposit to you), then call `/deposits/sync`.

## Trading

| Method | Path | Body / returns |
|--------|------|----------------|
| POST | `/orders/commit` 🔐 | `{ address, marketId, side, marginUsd, leverage, privacyMode, auth? }` → `{ orderId, jobId, commitmentHash, sizeBase, commitPrice }` |
| POST | `/orders/:id/execute` 🔐 | `{ auth? }` → fills the vAMM (refused if the mark diverges >200 bps from Pyth) → `{ position, jobId }` |
| POST | `/positions/:id/close` 🔐 | `{ fraction?, auth? }` → `{ position, jobId }` (partial close when `0<fraction<1`) |
| POST | `/positions/:id/margin` 🔐 | `{ delta, auth? }` → add (+) / remove (−) margin → `{ position }` |
| POST | `/positions/:id/stops` 🔐 | `{ stopLoss?, takeProfit?, auth? }` → set/clear hidden SL/TP → `{ position }` |
| POST | `/orders/:id/cancel` 🔐 | `{ auth? }` → cancel a resting order, release margin → `{ order }` |
| POST | `/orders/:id/anchor-commit` 🔐 | `{ auth? }` → timestamp the commitment on Cardano L1 (contents hidden) → `{ txHash, explorerUrl, order }` |
| GET | `/orders/resting/:address` | the caller's private resting limit orders (owner-only view) |
| GET | `/orders/:id` | the order incl. `.midnight` tx hashes + `.commitAnchor` |
| GET | `/positions/:address` | `{ positions: [{ id, marketId, side, sizeBase, entryPrice, markPrice, unrealizedPnl, liquidationPrice, leverage, marginUsd, fundingPaid, status, positionNft, settlement }] }` |
| GET | `/jobs/:id` | `{ id, kind, status: running\|complete\|error, steps: [{ label, status, txHash?, detail?, ms? }], error? }` |

`privacyMode` is `"private"` (commitment only) or `"public"` (the A/B foil — leaks everything). `commit` also enforces a **per-market open-interest cap** (`maxOiUsd`) and supports `orderType: "limit"` with a hidden `limitPrice`, plus an optional `maxSlippageBps` guard.

## Transparency & demo

| Method | Path | Returns |
|--------|------|---------|
| GET | `/feed` | what the public sees — private rows are `{ market, commitmentHash }` only; public rows carry `leaked` |
| GET | `/anchors` | on-chain settlement anchors `[{ settlementId, txHash, commitmentHex, explorerUrl }]` |
| POST | `/demo/ab` | `{ marketId, side, marginUsd, leverage, mode?: "sim"\|"live" }` → the A/B sandwich result + `headline` |
| POST | `/demo/attack` | `{ marketId, side, marginUsd, leverage }` → the MEV attack lab: two step-by-step timelines (SANDWICHED vs ATTACK FAILED) + real brute-force `0 / 25,000` |
| POST | `/demo/batch` | `{ marketId, side?, marginUsd?, leverage? }` → uniform-price batch auction: `attack.botProfitUsd ≈ 0` vs `sequential.botProfitUsd` + `headline` |
| POST | `/demo/sealed` | `{ marketId, side?, marginUsd?, leverage? }` → **operator-blind proof** (drand timelock): sealed ciphertext, `operatorCanReadNow:false`, `blindReason`, epoch clearing at one price |
| POST | `/orders/seal` 🔐 | `{ address, marketId, commitment, ciphertext, targetRound, maxMarginUsd, auth? }` → submit a timelock-sealed order (operator can't read it) → `{ id, epochId, targetRound }` |
| POST | `/batch/settle` | `{ marketId }` → settle the sealed epoch once its round lands → `{ cleared, dropped, clearingPrice, membershipRoot, positions }` |
| GET | `/orders/sealed/:address` | the caller's sealed orders + status (`sealed`/`cleared`/`dropped`) |
| GET | `/batch/epoch` | live drand: `{ currentRound, epochCloseRound, secondsToClose }` — orders seal to `epochCloseRound` |
| GET | `/batch/preview?marketId=` | how the resting committed market orders would clear at one uniform price + `digest` |
| GET | `/stats` | per-market OI/skew/funding/OI-cap-utilization + global TVL/volume/insurance-fund/anchors |
| GET | `/events?address=` | the trader's activity timeline (commit/fill/close/anchor/…) |
| POST | `/disclose` 🔐 | `{ orderId, audience }` → selective disclosure of a hidden order to a chosen auditor |
| POST | `/disclose/verify` | `{ disclosure }` → recompute SHA-256, check it equals the on-chain commitment |
| POST | `/demo/seed` | `{ address, dusd? }` → instant off-chain margin (demo) |
| POST | `/demo/reset` | clears state for a fresh run |
| GET | `/ops/balances` | operator tADA + dUSD (diagnostics) |
| GET | `/ops/solvency` | proof-of-solvency: live on-chain vault reserves vs credited liabilities + verifiable `attestation` |

## The order lifecycle in calls

```
faucet → (client deposit tx) → /deposits/sync
      → /orders/commit  →  poll /jobs/:jobId   (ZK: deploy order + authority proof)
      → /orders/:id/execute → poll /jobs/:jobId (ZK: match attest + CIP-68 mint)
      → /positions/:id/close → poll /jobs/:jobId (ZK settle + L1 anchor + ZK bind)
      → /withdraw
```

## On-chain artifacts

### Midnight — Compact contracts (`vendor/zkperps/contract/src/*.compact`)
| Contract | Proves | Ledger state |
|----------|--------|--------------|
| `zkperps-order` | knowledge of the trader secret behind `traderPk` | `orderCommitment`, `traderPk`, `l1SettlementAnchor` |
| `zkperps-matching` | two preimages hash to two commitments (execution attest) | `bid/askOrderCommitment`, `matchRecord` |
| `zkperps-settlement` | `next = H(state ‖ payload)` transition | `stateDigest` |

Driven per-trade by `vendor/zkperps/midnight-local-cli/src/dorr-{commit,match,settle,bind-anchor}.ts` against the local proof server.

### Cardano — Aiken (Plutus V3, `packages/contracts-aiken/`)
| Validator / policy | Rule |
|--------------------|------|
| **dUSD** minting policy | native `sig` policy — operator-minted faucet token, 6 decimals |
| **margin_vault** | spend requires the operator signature (v1 custody); deposits carry an inline `VaultDatum{owner}` |
| **settlement_anchor** | data-carrier: locks min-ADA with inline `AnchorDatum{settlement_id, order_commitment, midnight_tx}` |
| **CIP-68 position NFT** | (222) to trader + (100) reference with metadata datum |
