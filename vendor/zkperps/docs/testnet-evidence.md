# Testnet Evidence — Anti-Front-Running ZK Perpetuals

This file records all testnet transactions that evidence the MVP deployment, covering both **Midnight ZK proof transactions** and **Cardano L1 settlement anchors**.

**Last updated:** 2026-05-12  
**Close-out report:** [close-out-report.md](./close-out-report.md)

---

## 1. Cardano Preprod — Settlement Anchor Transactions (Output A, Evidence A2)

Script address (Preprod): `addr_test1wrf8enqnl26m0q5cfg73lxf4xxtu5x5phcrfjs0lcqp7uagh2hm3k`  
Validator: PlutusV3 `settlement_anchor` (Aiken) — inline `AnchorDatum`

| # | Settlement ID | txHash | Explorer URL |
|---|---------------|--------|--------------|
| 1 | `preprod-run-01` | `a0d8109593fe136a4dafc923b7857a187d6d7de72ef019133646bd5925b6621a` | [preprod.cardanoscan.io](https://preprod.cardanoscan.io/transaction/a0d8109593fe136a4dafc923b7857a187d6d7de72ef019133646bd5925b6621a) |
| 2 | `preprod-run-02` | `1c26333ec3ca79b4f9b0c2d4e6746c94adc4e7e6da9c8c013ada59f325fea4f5` | [preprod.cardanoscan.io](https://preprod.cardanoscan.io/transaction/1c26333ec3ca79b4f9b0c2d4e6746c94adc4e7e6da9c8c013ada59f325fea4f5) |

Both transactions lock **min-ADA** at the **`settlement_anchor`** Plutus V3 script with inline **`AnchorDatum`** (settlement id, 32-byte order commitment, optional midnight reference string in `midnight_tx`).

### How to reproduce

```bash
cp .env.example .env
# Set CARDANO_BACKEND=blockfrost, BLOCKFROST_PROJECT_ID, WALLET_MNEMONIC, CARDANO_NETWORK=Preprod
# Fund wallet with test ADA from the official faucet

npx tsx scripts/cardano-anchor-settlement.ts settle-demo-1 <64-hex-order-commitment> <optional-midnight-prove-tx-hash>
npx tsx scripts/cardano-anchor-settlement.ts settle-demo-2 <64-hex-order-commitment> <optional-midnight-prove-tx-hash>
```

---

## 2. Midnight Undeployed — Five-Contract ZK Pipeline (Output A, Evidence A2)

Full `npm run midnight:run-pipeline` — 5 contract deploys + 6 ZK prove/bind steps.  
Block span: 46574 → 46611 (37 blocks)

### zkperps-order

| Step | txHash | Block |
|------|--------|-------|
| deploy | `820e75e2c051c532526520ac9b2e71ae43e812ffa79e0f655a6ba36c0e5df2a6` | 46574 |
| proveTraderOrderAuthority | `bca34f958368fb9ae0e1987f9ea364ad5d1549e6482e3a825fea0c4a5718a485` | 46578 |
| bindL1SettlementAnchor | `e268ecd875c810c83adfa5758726bfde56224001a68a81b72a4f5c284a749296` | 46582 |

Contract address: `508f0df2e8d20cbd5c4f8f31776f4ea6203b09f37ac964687397f574febbe792`

### zkperps-matching

| Step | txHash | Block |
|------|--------|-------|
| deploy | `8f37ae87df4244887cb6e8bc08d8b73535a00d0bff423cbd8fd40715c08f9c5b` | 46585 |
| proveAndFinalizeMatch | `1f941c6ef465838e499ac9bd47f8d94cdc8e7fc4c6f79d28e1f7d7733b74d33d` | 46589 |

### zkperps-settlement

| Step | txHash | Block |
|------|--------|-------|
| deploy | `0e1c894177cdbab70870425e62966f87f9d6eafbf5ceee6efc612e0efa073eac` | 46593 |
| proveSettlementTransition | `a685c70930ee7d5cf336d6968ae938929ba9d9d726a8f2792342d2a0277e9217` | 46597 |

### zkperps-liquidation

| Step | txHash | Block |
|------|--------|-------|
| deploy | `e47a5fcb60b2d5f5ae79f3dc5b38c0eeec0a8f93862295ffd00f876c59d2a6fd` | 46600 |
| proveLiquidationBreach | `d9fd4d5e9f56c9b572b74df312195c2e3df5c2d1ea49ca2f0a10460f8466cf3e` | 46604 |

### zkperps-aggregate

| Step | txHash | Block |
|------|--------|-------|
| deploy | `3a6d0b3be68faac38d924a623c022555cbab308ac1c0d7430cadf557e14b2a4e` | 46607 |
| proveAggregatedProofBundle | `034033ea9955fb813103e9ecc12ee4b0da9fb5160db3a0449b3e54a4b7b20da2` | 46611 |

---

## 3. Front-Running Prevention Evidence (Output B, Evidence B2)

Test script: [`src/security/front-running-prevention.test.ts`](../src/security/front-running-prevention.test.ts)

Run: `npm test -- --reporter=verbose src/security/front-running-prevention.test.ts`

| # | Attack | Technique | Outcome | Reason |
|---|--------|-----------|---------|--------|
| 1 | Order sniping — price discovery | Guess prices to match commitment | **BLOCKED** | Nonce unknown; 2^128 search space |
| 2 | Order sniping — front-run better price | Submit higher bid | **BLOCKED** | Time-priority + binding commitment |
| 3 | MEV reordering | Reorder commitments in mempool | **BLOCKED** | Commitments are opaque hashes |
| 4 | Sandwich attack | Inspect shielded order | **BLOCKED** | AES-256-GCM encryption; no plaintext metadata |

---

## 4. Privacy Enforcement Evidence (Output C, Evidence C2)

Test script: [`src/privacy/privacy-enforcement.test.ts`](../src/privacy/privacy-enforcement.test.ts)

Run: `npm test -- --reporter=verbose src/privacy/privacy-enforcement.test.ts`

| # | Check | Result |
|---|-------|--------|
| 1 | Price not in commitment hash | **Pass** |
| 2 | Size not in commitment hash | **Pass** |
| 3 | Trader identity not in commitment | **Pass** |
| 4 | Shielded order public metadata hides all private fields | **Pass** |
| 5 | Encrypted payload requires correct decryption key | **Pass** |
| 6 | Brute-force preimage infeasible (100k attempts, 128-bit nonce) | **Pass** |
| 7 | Midnight private state not externally readable | **Pass** |
| 8 | On-chain AnchorDatum contains only hashes, no private data | **Pass** |

---

## 5. Close-Out Report (Output D, Evidence D2)

Link: [`docs/close-out-report.md`](./close-out-report.md)

Includes: benchmark results, security evaluation, performance targets achieved, architecture summary, reproducibility instructions.

---

## 6. Demo Video (Output E, Evidence E2)

- **MP4:** [`docs/media/zkperps-pipeline-demo.mp4`](./media/zkperps-pipeline-demo.mp4)
- **Browser replay:** [`docs/demo-terminal.html`](./demo-terminal.html)
- **Replay instructions:** [`docs/demo.md`](./demo.md)

Shows: live proof generation → verification → settlement across the five-contract pipeline.
