# Common Module — API Reference

This module provides shared data structures, error handling, utility functions, and system constants used across all other modules in the Anti-Front-Running ZK Perpetuals system.

Per [Software requirements](../docs/SRS.md), Section 5.2: "Contains shared components including cryptographic utilities, protocol configuration, data structures."

---

## types.ts — Core Data Structures

### Enums

| Enum | Values | Purpose |
|------|--------|---------|
| `OrderSide` | `LONG`, `SHORT` | Trade direction |
| `OrderType` | `MARKET`, `LIMIT`, `STOP` | Execution type |
| `OrderStatus` | `PENDING`, `OPEN`, `FILLED`, `PARTIALLY_FILLED`, `CANCELLED`, `EXPIRED` | Lifecycle state |
| `SettlementStatus` | `PENDING`, `CONFIRMED`, `FAILED` | On-chain settlement state |

### Interfaces

| Interface | Key Fields | Description |
|-----------|-----------|-------------|
| `Order` | `id`, `pairId`, `side`, `type`, `price`, `size`, `leverage`, `margin` | Full order representation |
| `OrderCommitment` | `commitmentHash`, `traderPubKeyHash`, `timestamp` | ZK-committed order (specification Section 3.2) |
| `Position` | `positionId`, `pairId`, `side`, `entryPrice`, `size`, `marginLocked` | Open derivatives position |
| `MarketPair` | `pairId`, `baseAsset`, `quoteAsset`, `maxLeverage` | Trading pair configuration |
| `ZKProof` | `proof`, `publicInputs`, `verificationKey` | Generic zero-knowledge proof container |
| `SettlementResult` | `settlementId`, `txHash`, `status` | On-chain settlement outcome |
| `MarginAccount` | `traderId`, `totalBalance`, `lockedMargin`, `availableBalance` | Trader margin state |
| `PrivacyConfig` | `midnightNodeUrl`, `networkId`, `encryptionScheme` | Midnight integration settings |
| `EncryptedState` | `stateId`, `encryptedPayload`, `version` | Encrypted on-chain state entry |
| `DisclosureProof` | `disclosureId`, `disclosedFields`, `proof` | Selective disclosure for compliance |
| `CardanoUTxO` | `txHash`, `outputIndex`, `address`, `lovelace`, `tokens` | Cardano UTxO reference |
| `CardanoTransaction` | `txBody`, `txHash`, `fee` | Cardano transaction container |

---

## errors.ts — Error Handling

### Base Class

`ZKPerpsError` extends `Error` with structured `code`, `module`, and `metadata` fields.

### Module-Specific Errors

| Class | Module | Use Case |
|-------|--------|----------|
| `OrderValidationError` | matching | Invalid order parameters or proof failures |
| `SettlementError` | settlement | Transaction construction, submission, or confirmation failures |
| `ProofGenerationError` | zk-circuits | Circuit compilation or proof generation failures |
| `PrivacyError` | privacy | Encryption, shielding, or Midnight connection failures |
| `CircuitCompilationError` | zk-circuits | Compact circuit compilation failures |
| `MatchingEngineError` | matching | Order book or matching logic failures |

---

## utils.ts — Utility Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `validateOrder` | `(order, pair) -> boolean` | Validates order parameters against pair rules |
| `hashOrder` | `(order) -> string` | Generates deterministic hash of order fields |
| `formatAmount` | `(amount, decimals) -> string` | Formats numeric amounts for display |
| `calculateFundingRate` | `(markPrice, indexPrice) -> number` | Computes funding rate from price divergence |
| `generateNonce` | `(length) -> string` | Generates a cryptographic random nonce |
| `poseidonHash` | `(inputs) -> string` | ZK-friendly Poseidon hash function |
| `pedersenCommit` | `(value, blindingFactor) -> string` | Pedersen commitment scheme |
| `nowMs` | `() -> number` | Current Unix timestamp in milliseconds |
| `isExpired` | `(timestamp, ttlMs) -> boolean` | Checks if a timestamp has expired |
| `serializeOrder` | `(order) -> string` | Serializes order to JSON string |
| `deserializeOrder` | `(json) -> Order` | Deserializes order from JSON string |

---

## constants.ts — System Constants

| Category | Constants | Description |
|----------|----------|-------------|
| Trading | `MAX_LEVERAGE`, `MIN_ORDER_SIZE`, `MAX_ORDER_SIZE`, `TRADING_FEE_RATE` | Order parameter bounds |
| Margin | `MIN_MARGIN`, `MAINTENANCE_MARGIN_RATIO`, `LIQUIDATION_PENALTY_RATE` | Margin thresholds |
| Funding | `FUNDING_INTERVAL_MS`, `MAX_FUNDING_RATE`, `DAMPENING_FACTOR` | Funding rate configuration |
| Settlement | `SETTLEMENT_DELAY_MS`, `MAX_TX_FEE_LOVELACE`, `REQUIRED_CONFIRMATIONS` | On-chain settlement parameters |
| ZK Proofs | `PROOF_GENERATION_TIMEOUT_MS`, `MAX_CIRCUIT_SIZE` | Proof system limits |
| Cardano | `LOVELACE_PER_ADA`, `MIN_UTXO_LOVELACE` | Network-specific values |
| Pairs | `SUPPORTED_PAIRS` | List of supported trading pairs |
