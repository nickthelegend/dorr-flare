# SRS pipeline — latest captured run (undeployed Midnight + Cardano emulator)

**Date:** 2026-04-15 (local environment)  
**Midnight stack:** node 0.22.1, indexer 4.0.0, proof-server 8.0.3  
**Cardano:** Lucid Evolution emulator + Aiken `settlement_anchor` PlutusV3

**Stylized replay (screen-record to MP4):** open [demo-terminal.html](./demo-terminal.html) in a browser and align its embedded `DEMO` data with the tables below when you refresh this log.

## Midnight (`MIDNIGHT_DEPLOY_NETWORK=undeployed`)

Full `npm run midnight:run-pipeline` deploys **five** Compact contracts and submits ZK transactions per contract.

### zkperps-order

| Step | txHash | blockHeight |
|------|--------|-------------|
| deploy | `5bcbeed68dac66a846f792694d392f0a77f04b18fe8783dfd5adc382a003cac7` | 46275 |
| proveTraderOrderAuthority | `2b69cf1bf2577608d669633623c0b9db31a04072fd50f1d8c14cb9d47f088720` | 46279 |
| bindL1SettlementAnchor | `3cb1ea5479f26d6f1f58d706261b7d6b7a25e01f71e0fab6d1145d208d5b2688` | 46283 |

**Contract address:** `324a79b3780c20505a843fe8bb6e626a26efd2e0d90569a26ef10cec10581aa0`

### zkperps-matching

| Step | txHash | blockHeight |
|------|--------|-------------|
| deploy | `0bb7de1972ed6b7eff22bcbf1c516d84b16ba0e2783be236b2fceb8fd2bb88f1` | 46287 |
| proveAndFinalizeMatch | `290743ddb0559d7c6bff2f218b65e687275e0aec1b7066a2865f2bd154e5b8ec` | 46291 |

### zkperps-settlement

| Step | txHash | blockHeight |
|------|--------|-------------|
| deploy | `3958728c72b3e599db49c0c3f7800cc3cd6e31db5851e867655b46edd39f9b21` | 46294 |
| proveSettlementTransition | `22c52cb0bebb535965ab3bcc0b1fc3e217fbadace546c445f6d5172df047a8f1` | 46298 |

### zkperps-liquidation

| Step | txHash | blockHeight |
|------|--------|-------------|
| deploy | `a03dab67c24bfdc6b0fb84a53b07957c3ba4f3def0be3f5ba3f474061e57658e` | 46301 |
| proveLiquidationBreach | `ea03e09c4b084a5c9576e34610f5fda0cc70fb2a0499b0e57dbf1089e2fb0185` | 46305 |

### zkperps-aggregate

| Step | txHash | blockHeight |
|------|--------|-------------|
| deploy | `441dfc99a779f0921efba1db4aa57341e4c064af4d3276c4d37ffd555392428d` | 46309 |
| proveAggregatedProofBundle | `f8b3eff56cf5c9893216a5f3d6dd79b1680b29b456ccd046e91aaea813014579` | 46313 |

## Commitment + ZK IR bench

```
{
  "run_id": "2026-04-15T14:03:50.352Z",
  "hardware_note": "linux:DO-Premium-AMD",
  "commitment_only_us": "17.964",
  "proof_kb": "15.68",
  "zkir_kb_per_package": {
    "zkperps-order": "4.56",
    "zkperps-matching": "3.90",
    "zkperps-settlement": "2.61",
    "zkperps-liquidation": "2.74",
    "zkperps-aggregate": "1.88"
  }
}
```

## Cardano anchor (emulator, Aiken script + inline datum)

```
{
  "run_id": "2026-04-15T14:14:24.325Z",
  "backend": "emulator",
  "txs": 5,
  "script_address": "addr_test1wrf8enqnl26m0q5cfg73lxf4xxtu5x5phcrfjs0lcqp7uagh2hm3k",
  "hardware_note": "emulator:DO-Premium-AMD",
  "submit_ms_avg": "18.63",
  "submit_ms_p50": "10.39",
  "submit_ms_min": "6.25",
  "submit_ms_max": "55.80",
  "tx_hashes": [
    "1bedd7c819f415a75be6ccb44728aac70bb01ef9beb171dec5a1a91c5ee8db43",
    "d9d38d0a73d1b0a229a568246c1665388d9c2081c275df8df501e80c07070833",
    "1f30cd88781bb71cc7148875aa748dc50305ec704f229bc744a1436bf3058906",
    "2a81c70189ac69a13562389930969c2b49b51a965acdd77a9abefd19a1c798fa",
    "6110372b469d82b6f5b038d015873a4ab2a50608a44a240e6646b8b5d3b0d742"
  ]
}
```

## Cardano Preprod (Blockfrost) — Aiken anchor

| # | Settlement ID | txHash | Explorer |
|---|---------------|--------|----------|
| 1 | `preprod-bench-01` | `e339ed83ebd33df3368e77fe5023a9cbd172e6d1396d1f612f88ceb53dda89e3` | [cardanoscan](https://preprod.cardanoscan.io/transaction/e339ed83ebd33df3368e77fe5023a9cbd172e6d1396d1f612f88ceb53dda89e3) |
| 2 | `preprod-bench-02` | `14f4f5ff5a0e2cf0eaa997f412f10c0970462eaaeeb0ba36afb462908cb32e3b` | [cardanoscan](https://preprod.cardanoscan.io/transaction/14f4f5ff5a0e2cf0eaa997f412f10c0970462eaaeeb0ba36afb462908cb32e3b) |

## Test suite

```
 Test Files  3 passed | 1 skipped (4)
      Tests  6 passed | 1 skipped (7)
```

| Suite | Tests | Status |
|-------|-------|--------|
| `src/order/commitment.test.ts` | 3 | Pass |
| `src/lib/cip20.test.ts` | 1 | Pass |
| `src/cardano/settlement_anchor.test.ts` | 2 | Pass |
| `src/integration/midnight.preprod.test.ts` | 1 | Skipped (opt-in) |
