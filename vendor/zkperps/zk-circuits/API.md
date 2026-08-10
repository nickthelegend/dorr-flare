# ZK Circuits Module — API Reference

This module documents Zero-Knowledge proof circuits for the Anti-Front-Running ZK Perpetuals system and ships TypeScript helpers in [`circuit_utils.ts`](circuit_utils.ts) for compilation metadata, witness placeholders, and proof serialization.

**Implemented Midnight contracts (Compact)** — all compiled to `contract/src/managed/<name>/`:

| Contract | Source | Spec § mapping |
|----------|--------|-------------|
| zkperps-order | [`contract/src/zkperps-order.compact`](../contract/src/zkperps-order.compact) | §3.2–3.3 order authority + L1 anchor |
| zkperps-matching | [`contract/src/zkperps-matching.compact`](../contract/src/zkperps-matching.compact) | §3.4 / §7 matching correctness |
| zkperps-settlement | [`contract/src/zkperps-settlement.compact`](../contract/src/zkperps-settlement.compact) | §3.5 settlement transition |
| zkperps-liquidation | [`contract/src/zkperps-liquidation.compact`](../contract/src/zkperps-liquidation.compact) | §3.6 liquidation attestation |
| zkperps-aggregate | [`contract/src/zkperps-aggregate.compact`](../contract/src/zkperps-aggregate.compact) | §7.2 aggregation (minimal bundle root) |

**CLI:** `npm run midnight:run-all` (order-only quick path) · `npm run midnight:run-pipeline` (all five contracts + ZK txs).

Per [Software requirements](../docs/SRS.md), Section 6.2 (Compact) and Section 7 (ZK guarantees).

---

## Reference catalogue (TypeScript `CircuitId`)

Additional `CircuitId` values in `circuit_utils.ts` label off-chain / catalogue concepts (price range, margin proof, anti–front-running timelock) used by tests and tooling; on-chain proving for the rows above is driven by the Compact artifacts and `midnight-local-cli`.

---

## circuit_utils.ts (TypeScript)

| Function | Description |
|----------|-------------|
| `compileCircuit` | Reads Compact source when available and returns a deterministic compiled-circuit placeholder (constraint counts from the catalogue) |
| `generateWitness` | Builds a witness object for local testing |
| `serializeProof` / `deserializeProof` | JSON-in-hex proof envelope for storage or transport |
| `loadCachedCircuit` | Returns `null` (no on-disk cache in this repo) |
| `listAvailableCircuits` | Metadata for catalogue entries, including all `ZKPERPS_*_COMPACT` ids |
