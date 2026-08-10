# ZK circuits (`zkperps-order`)

Production Compact sources for the milestone slice live in **[`../contract/src/zkperps-order.compact`](../contract/src/zkperps-order.compact)** (compiled output under `../contract/src/managed/zkperps-order/`).

Additional specification-aligned circuits (matching, settlement, liquidation proofs) are described in [API.md](./API.md) as reference designs; only `zkperps-order` Compact is vendored under `contract/src/` for this milestone.

## Commands (from repository root)

```bash
npm run compact     # compile Compact → managed artifacts
npm run midnight:run-all
```
