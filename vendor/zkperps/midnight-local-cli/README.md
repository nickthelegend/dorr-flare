# ZK Perps Midnight CLI

Deploys and exercises **Compact contracts** on:

| Target | `MIDNIGHT_DEPLOY_NETWORK` | Stack |
|--------|---------------------------|--------|
| **Local (Brick Towers)** | `undeployed` (default) | [midnight-local-network](https://github.com/bricktowers/midnight-local-network) — indexer **v4** on `8088`, node `9944`, proof server `6300` |
| **Midnight Preview** | `preview` | Public Preview RPC / indexer / hosted proof server |
| **Midnight Preprod** | `preprod` | Public Preprod RPC / indexer / hosted proof server |

Aligned with NuAuth reference env layout and [Midnight deploy guide](https://docs.midnight.network/guides/deploy-mn-app).

## Prerequisites

1. **Contract artifacts** (from repo root):  
   `cd contract && npm install && npm run compact && npm run build`
2. **Install CLI workspace** (from repo root):  
   `npm install`
3. **Wallet**: fund `BIP39_MNEMONIC` on the selected Midnight network (tNIGHT + DUST on Preprod per official docs).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run deploy -w @zkperps/midnight-local-cli` | Deploy `zkperps-order` only |
| `npm run run-all -w @zkperps/midnight-local-cli` | Deploy + `proveTraderOrderAuthority` + `bindL1SettlementAnchor` |
| `npm run run-pipeline -w @zkperps/midnight-local-cli` | **Five-contract path:** `zkperps-order` + `zkperps-matching` + `zkperps-settlement` + `zkperps-liquidation` + `zkperps-aggregate` (5 deploys + ZK txs) |
| `npm run fund-local-undeployed -w @zkperps/midnight-local-cli` | Fund + DUST registration on **undeployed** (local genesis) |

## Environment

| Variable | Description |
|----------|-------------|
| **`MIDNIGHT_DEPLOY_NETWORK`** | `undeployed` (default), `preview`, or `preprod`. |
| **`BIP39_MNEMONIC`** | Funded Midnight wallet phrase. |
| **`ZKPERPS_TRADER_SK_HEX`** | 64 hex chars; 32-byte trader secret for ZK witness. |
| **`ZKPERPS_ORDER_COMMITMENT_HEX`** | 64 hex; constructor `orderCommitment`. |
| **`ZKPERPS_L1_ANCHOR_HEX`** | 64 hex; `bindL1SettlementAnchor` digest (Cardano anchor). |
| `ZKPERPS_BID_PREIMAGE_HEX` / `ZKPERPS_ASK_PREIMAGE_HEX` | Optional; defaults for `run-pipeline` matching witness preimages. |
| `ZKPERPS_MATCH_DIGEST_HEX` | Optional; `proveAndFinalizeMatch` digest. |
| `ZKPERPS_SETTLEMENT_INITIAL_HEX` / `ZKPERPS_SETTLEMENT_PAYLOAD_HEX` | Optional; settlement state transition. |
| `ZKPERPS_MARGIN_WITNESS_HEX` / `ZKPERPS_LIQUIDATION_THRESHOLD_HEX` | Optional; liquidation circuit. |
| `ZKPERPS_AGGREGATE_*_HEX` | Optional; aggregate bundle (`LEFT`/`RIGHT`/`INITIAL`). |
| **`MIDNIGHT_PROOF_SERVER`** | Override proof server URL. |
| `MIDNIGHT_INDEXER_HTTP` / `MIDNIGHT_INDEXER_WS` / `MIDNIGHT_NODE_RPC` | Optional endpoint overrides. |

## Troubleshooting

- **Preprod WebSocket 1006** — try `MIDNIGHT_DEPLOY_NETWORK=preview`.
- **Duplicate `@midnight-ntwrk` packages** — run `npm install` from **repo root**; `postinstall` prunes nested `contract/node_modules/@midnight-ntwrk`.
