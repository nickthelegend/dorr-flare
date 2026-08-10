# Settlement Module — API Reference

This module handles the on-chain settlement of matched trades on the Cardano blockchain. It includes the settlement engine, margin account management, Cardano blockchain integration, the funding rate mechanism, and the liquidation engine. Pass a `cardanoConnector` into `SettlementEngineConfig` to anchor settlements with Lucid; otherwise the engine returns deterministic synthetic transaction hashes for offline / CI use.

Per [Software requirements](../docs/SRS.md), Section 3.5: "Once a match occurs, the system must update trader balances, margin accounts, open positions. State transitions must be verified using zero-knowledge proofs before being accepted by the network."

Per the same document, Section 3.6: "The protocol must support liquidation when margin requirements are violated."

Per the same document, Section 5.2: "Handles margin updates, position management, liquidation execution."

---

## settlement_engine.ts — Core Settlement Engine

### SettlementEngine Class

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() -> Promise<void>` | Connects to Cardano node, loads validator scripts |
| `settleTrade` | `(match) -> Promise<SettlementResult>` | Settles a single matched trade on-chain |
| `batchSettle` | `(matches[]) -> Promise<BatchSettlementResult>` | Batch-settles multiple trades in one transaction |
| `calculatePnL` | `(position, markPrice) -> number` | Computes unrealized profit and loss |
| `processLiquidation` | `(position, price) -> Promise<LiquidationResult>` | Liquidates an under-margined position |
| `getSettlementStatus` | `(id) -> Promise<SettlementStatus>` | Queries settlement confirmation status |
| `shutdown` | `() -> Promise<void>` | Graceful shutdown |

### PnL Formulas
- Long: `PnL = (markPrice - entryPrice) * size`
- Short: `PnL = (entryPrice - markPrice) * size`

---

## margin_manager.ts — Margin Account Management

### MarginManager Class

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() -> Promise<void>` | Loads existing margin accounts from chain |
| `depositMargin` | `(traderId, amount) -> Promise<MarginTransactionResult>` | Deposits margin via Cardano transaction |
| `withdrawMargin` | `(traderId, amount) -> Promise<MarginTransactionResult>` | Withdraws margin with safety checks |
| `checkMarginLevel` | `(traderId) -> Promise<number>` | Calculates current margin ratio |
| `triggerMarginCall` | `(traderId) -> Promise<MarginCallNotification>` | Issues margin call notification |
| `getMarginBalance` | `(traderId) -> Promise<MarginAccount>` | Returns current account state |
| `lockMargin` | `(traderId, amount, positionId) -> Promise<boolean>` | Locks margin for new position |
| `releaseMargin` | `(traderId, positionId, pnl) -> Promise<MarginAccount>` | Releases margin on position close |

### Margin Level Formula
```
Margin Level = (Total Balance + Unrealized PnL) / Locked Margin
```

---

## cardano_connector.ts — Cardano Blockchain Connector

### CardanoConnector Class

Low-level interaction with the Cardano blockchain. Used by the SettlementEngine and MarginManager for transaction construction and submission.

| Method | Signature | Description |
|--------|-----------|-------------|
| `connect` | `() -> Promise<void>` | Connects to Cardano node |
| `submitTransaction` | `(signedTx) -> Promise<SubmitResult>` | Submits signed transaction to network |
| `queryUTxO` | `(address) -> Promise<CardanoUTxO[]>` | Queries UTxOs at an address |
| `buildSettlementTx` | `(params) -> Promise<CardanoTransaction>` | Builds a settlement transaction; with **`params.anchor`**, pays min-ADA to the **Aiken** settlement script + **inline AnchorDatum** (see `src/cardano/settlement_anchor.ts`) |
| `signTransaction` | `(tx, signingKey) -> Promise<string>` | Signs transaction with Ed25519 key |
| `waitForConfirmation` | `(txHash, confirmations?, timeout?) -> Promise<ConfirmationResult>` | Polls for transaction confirmation |
| `getProtocolParameters` | `() -> Promise<ProtocolParameters>` | Gets current protocol parameters |
| `getTip` | `() -> Promise<{blockNumber, slot, hash}>` | Gets current chain tip |
| `disconnect` | `() -> Promise<void>` | Closes connection |

---

## funding_rate.ts — Funding Rate Mechanism

Periodic funding payments between long and short position holders to anchor the perpetual price to the index price.

| Function | Signature | Description |
|----------|-----------|-------------|
| `calculateFundingRate` | `(priceData, dampening?) -> number` | Computes clamped, dampened funding rate |
| `applyFunding` | `(pairId, rate, positions, markPrice) -> FundingPayment[]` | Applies funding to all positions |
| `getFundingHistory` | `(pairId, limit?, offset?) -> Promise<FundingRateRecord[]>` | Retrieves historical funding rates |
| `getNextFundingTime` | `(pairId, intervalMs) -> number` | Time until next funding epoch |
| `predictNextFundingRate` | `(priceData, intervalMs) -> FundingRatePrediction` | Predicts next funding rate |
| `processFundingEpoch` | `(contract, priceData, positions) -> Promise<FundingRateRecord>` | Processes a full funding epoch |

### Funding Rate Formula
```
Raw Rate = (Mark Price - Index Price) / Index Price
Clamped Rate = clamp(Raw Rate, -0.75%, +0.75%)
Dampened Rate = Clamped Rate * 0.1
```
- Positive rate: longs pay shorts (bullish premium)
- Negative rate: shorts pay longs (bearish discount)

---

## liquidation_engine.ts — Liquidation Engine (specification Section 3.6)

### LiquidationEngine Class

Monitors registered open positions for margin breaches and executes liquidations with locally generated verification proofs (production deployments wire this to Midnight / proof-server).

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerOpenPosition` | `(position) -> void` | Registers a position for `scanAtRiskPositions` |
| `unregisterPosition` | `(positionId) -> void` | Removes a position after close or liquidation |
| `initialize` | `() -> Promise<void>` | Prepares local engine state |
| `startMonitoring` | `() -> Promise<void>` | Starts continuous position monitoring |
| `stopMonitoring` | `() -> Promise<void>` | Stops position monitoring |
| `assessPositionRisk` | `(position, markPrice) -> Promise<AtRiskPosition>` | Classifies position risk level |
| `executeLiquidation` | `(position, markPrice) -> Promise<LiquidationResult>` | Executes ZK-verified liquidation |
| `scanAtRiskPositions` | `(markPrices) -> Promise<AtRiskPosition[]>` | Finds all at-risk positions |
| `getInsuranceFundState` | `() -> Promise<InsuranceFundState>` | Returns insurance fund balance |
| `processSocializedLoss` | `(shortfall) -> Promise<boolean>` | Handles losses exceeding insurance fund |

### Risk Classification
- WARNING: Approaching maintenance margin threshold
- CRITICAL: Very close to maintenance level
- LIQUIDATABLE: Below maintenance threshold, liquidation triggered
