# ZKPerps Testnet Evidence

Generated: 2026-05-12 (latest run)

**Close-out report:** [docs/close-out-report.md](docs/close-out-report.md)  
**Benchmarks / methodology:** [docs/benchmarks.md](docs/benchmarks.md)  
**Full evidence (Midnight + Cardano + security + privacy):** [docs/testnet-evidence.md](docs/testnet-evidence.md)  
**Pipeline capture:** [docs/srs-pipeline-run.md](docs/srs-pipeline-run.md)

---

## Midnight Local (`undeployed` — Brick Towers Docker)

Proof server 8.0.3, node 0.22.1, indexer 4.0.0. Latest five-contract pipeline (blocks **46574 → 46611**).

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

## Cardano Preprod (Blockfrost)

See **[docs/testnet-evidence.md](docs/testnet-evidence.md)** for the canonical ≥2 Preprod anchor txs (latest: `preprod-run-01` / `preprod-run-02`).

---

## SDK Patches Applied

The Midnight wallet SDKs (v2.1.0 / v3.0.0) ship with a Node.js >=22 `Map` iterator
bug: `.entries().filter(...)` / `.values().map(...)` fail because `MapIterator` is not
an `Array`. The following files were patched with `[...iter]` wrappers:

- `wallet-sdk-shielded/dist/v1/CoreWallet.js` (`.values().map`)
- `wallet-sdk-shielded/dist/v1/TransactionOps.js` (`.entries().filter/.map`)
- `wallet-sdk-shielded/dist/v1/TransactionImbalances.js` (`.entries().every`)
- `wallet-sdk-facade/dist/transaction.js` (`.values().toArray`)
- `wallet-sdk-unshielded-wallet/dist/v1/TransactionOps.js` (`.entries().filter/.map`, `.keys().toArray`)
- `wallet-sdk-dust-wallet/dist/v1/Transacting.js` (`.entries().find`)
