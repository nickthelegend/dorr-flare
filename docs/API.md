# 🔌 API & on-chain reference

The operator is a Hono server on `http://localhost:8791`. All JSON. CORS-open for the web app.

## Conventions

- Prices/PnL are numbers in **FXRP** (6 decimals on-chain, plain numbers over the API).
- Slow work (Coston2 confirmations, drand rounds) runs as **async jobs** — mutating calls return a `jobId` you poll.
- **Value-moving** calls (`commit`, `execute`, `close`, `withdraw`) accept an `auth` envelope and require it when `DORR_AUTH=1`. See [SECURITY](./SECURITY.md).

## Market & price

| Method | Path | Returns |
|--------|------|---------|
| GET | `/health` | `{ ok, service, markets, chain, flareReady }` |
| GET | `/config` | `{ network, chainId, explorerBase, markets, flare: { vaultAddress, settlementAddress, collateral, ftso, faucetUrl } }` |
| GET | `/markets` | `{ markets: [{ id, symbol, base, maxLeverage, maxOiUsd, disabled, indexPrice, markPrice, publishTime, vamm }] }` |

## Collateral (FXRP + vault)

| Method | Path | Body / returns |
|--------|------|----------------|
| GET | `/vault/info` | `{ chain, chainId, vaultAddress, settlementAddress, collateral: { symbol, address, decimals }, explorerUrl, faucetUrl }` |
| GET | `/flare/info` | deployed contracts, collateral, live solvency, enclave signer |
| GET | `/flare/account/:address` | the trader's **on-chain** vault account `{ balance, locked, free }` |
| GET | `/account/:address` | trading ledger `{ balance, locked, free, openPositions }` — reconciled from the vault on every read |
| POST | `/deposits/sync` | `{ address }` → re-reads the vault and credits new collateral → `{ credited, balance, free }` |
| POST | `/faucet` | **501** — dorr cannot mint FXRP; returns `faucetUrl` for Flare's own faucet |
| POST | `/withdraw` | **501** — withdrawal is non-custodial; your wallet calls `DorrVault.withdraw(uint256)` directly |

**Deposit** happens in the browser against the contracts: ERC-20 `approve(vault, amount)` then `DorrVault.deposit(amount)`, both signed by the trader. The operator only *reads* the result — it can neither deposit nor withdraw on your behalf.

## Trading

| Method | Path | Body / returns |
|--------|------|----------------|
| POST | `/orders/commit` 🔐 | `{ address, marketId, side, marginUsd, leverage, privacyMode, auth? }` → `{ orderId, jobId, commitmentHash, sizeBase, commitPrice }` |
| POST | `/orders/:id/execute` 🔐 | `{ auth? }` → fills the vAMM (refused if the mark diverges >200 bps from the FTSO index) → `{ position, jobId }` |
| POST | `/positions/:id/close` 🔐 | `{ fraction?, auth? }` → `{ position, jobId }` (partial close when `0<fraction<1`) |
| POST | `/positions/:id/margin` 🔐 | `{ delta, auth? }` → add (+) / remove (−) margin → `{ position }` |
| POST | `/positions/:id/stops` 🔐 | `{ stopLoss?, takeProfit?, auth? }` → set/clear hidden SL/TP → `{ position }` |
| POST | `/orders/:id/cancel` 🔐 | `{ auth? }` → cancel a resting order, release margin → `{ order }` |
| GET | `/orders/resting/:address` | the caller's private resting limit orders (owner-only view) |
| GET | `/orders/:id` | the order incl. its commitment and status |
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
| POST | `/demo/seed` | `{ address, fxrp? }` → instant off-chain margin (**demo/testing only** — unbacked, never enabled for a real trader) |
| POST | `/demo/reset` | clears state for a fresh run |
| GET | `/ops/balances` | relayer C2FLR + vault FXRP + collateral metadata (diagnostics) |
| GET | `/ops/solvency` | proof-of-solvency: live on-chain vault reserves vs credited liabilities + verifiable `attestation` |

## The order lifecycle in calls

Direct path (immediate fill against the vAMM):

```
Flare faucet → wallet: approve + DorrVault.deposit()   → /deposits/sync
   → /orders/commit          → poll /jobs/:jobId   (commitment sealed)
   → /orders/:id/execute     → poll /jobs/:jobId   (commitment verified → vAMM fill)
   → /positions/:id/close    → poll /jobs/:jobId   (settlement digest)
   → wallet: DorrVault.withdraw()
```

Sealed path (operator-blind — the one the privacy claim rests on):

```
browser timelock-encrypts to drand round R
   → /orders/seal            (operator stores ciphertext it cannot read)
   → round R lands → keeper opens the epoch, clears at ONE uniform price
   → enclave signs the batch → DorrBatchSettlement.settleBatch on Flare
     (contract re-reads FTSO; reverts PriceOutOfBand if the price is off-market)
```

## On-chain artifacts

### Flare — Solidity (`contracts/src/`)

| Contract | Rule |
|----------|------|
| **DorrVault** | Holds FXRP. `deposit()`/`withdraw()` act on `msg.sender` only — nobody else can move a trader's collateral. Settlement may `lockMargin`/`releaseMargin`/`applyPnl`; `applyPnl` reverts unless the deltas sum to zero, so settlement can never drain reserves. |
| **DorrBatchSettlement** | Records a cleared epoch. Independently re-reads **FTSO v2** and reverts `PriceOutOfBand` if the clearing price deviates beyond `maxDriftBps`; requires a TEE quote bound to `keccak256(epochId, membershipRoot, clearingPrice, orderCount)`. |
| **TEEAttestationVerifier** | Registers enclave measurements and verifies a quote is signed by a registered enclave *for this exact payload*. |

Deployed on Coston2 — addresses in [`/flare/info`](#) and the README.

### Off-chain privacy primitives

| Piece | What it does |
|-------|--------------|
| **drand timelock** (`sealbid.ts`) | The browser encrypts the order to a future drand round; the operator holds ciphertext it provably cannot open until the batch is frozen. |
| **ECIES to the enclave** (`ecies.ts`) | Orders can be sealed directly to the matching enclave's public key, so the API tier relays bytes it cannot read. |
| **Order commitment** (`packages/engine`) | `SHA-256(pairId, side, price, size, leverage, margin, nonce)` — what the public sees, and what a selective disclosure opens. |
