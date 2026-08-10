# Matching Module — API Reference

This module implements the privacy-preserving order matching engine. It receives ZK-committed orders, verifies associated proofs, and matches compatible buy/sell orders using price-time priority.

Per [Software requirements](../docs/SRS.md), Section 3.4: "Orders are matched according to protocol rules: price compatibility, liquidity availability, margin constraints. Correct matching must be verified through proof generation before settlement."

Per the same document, Section 5.2: "Handles order intake, matching logic, liquidity coordination."

---

## order_matcher.ts — Core Matching Engine

### OrderMatcher Class

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() -> Promise<void>` | Loads verification keys and initializes order books |
| `submitOrder` | `(commitment, proofs, pairId) -> Promise<string>` | Submits a committed order after proof verification |
| `matchOrders` | `(pairId) -> Promise<OrderMatch[]>` | Runs price-time priority matching for a pair |
| `cancelOrder` | `(orderId, proof) -> Promise<boolean>` | Cancels an order with ownership proof |
| `getOrderBook` | `(pairId, depth?) -> Promise<{bids, asks}>` | Returns aggregated order book depth |
| `getStats` | `() -> MatchingStats` | Returns engine statistics |
| `shutdown` | `() -> Promise<void>` | Graceful shutdown |

### Matching Algorithm

1. Verify all order proofs (commitment, price range, margin, timelock)
2. Sort orders by committed price (bids descending, asks ascending)
3. Match the best bid against the best ask when they cross
4. Execution price is the midpoint of the two limit prices
5. Generate a matching proof (see Midnight matching / verification circuits in specification §7 — production proof wiring is environment-specific)
6. Emit match events for downstream settlement

---

## order_book.ts — Private Order Book

### PrivateOrderBook Class

Maintains sorted bid and ask sides. Orders are stored as commitments, so the book reveals aggregate depth but not individual trader identities or exact parameters.

| Method | Signature | Description |
|--------|-----------|-------------|
| `addOrder` | `(entry) -> string` | Inserts order in sorted position |
| `removeOrder` | `(orderId) -> OrderBookEntry or null` | Removes order by identifier |
| `getBestBid` | `() -> OrderBookEntry or null` | Returns highest buy order |
| `getBestAsk` | `() -> OrderBookEntry or null` | Returns lowest sell order |
| `getDepth` | `(levels?) -> {bids, asks}` | Returns aggregated depth by price level |
| `getSnapshot` | `(depth?) -> OrderBookSnapshot` | Returns full book snapshot |
| `updateOrderFill` | `(orderId, filledSize) -> OrderBookEntry or null` | Updates remaining size after partial fill |
| `removeExpiredOrders` | `(timestamp) -> string[]` | Removes orders past their time-to-live |
| `getTotalOrderCount` | `() -> number` | Returns total open orders |
| `clear` | `() -> void` | Clears all orders |

---

## order_validator.ts — Order Validation

Pre-validation before ZK proof generation. Provides early-exit checks for invalid parameters.

| Function | Signature | Description |
|----------|-----------|-------------|
| `validateOrderParams` | `(order, pair) -> ValidationResult` | Validates order fields against pair rules |
| `checkMarginRequirements` | `(order, availableMargin) -> boolean` | Pre-checks margin sufficiency |
| `validateLeverage` | `(leverage, pair) -> boolean` | Checks leverage within allowed bounds |
| `checkDuplicateOrder` | `(hash, activeSet) -> boolean` | Detects duplicate commitment hashes |
| `validateOrderSubmission` | `(commitment, proofs, pairId, activeSet) -> Promise<ValidationResult>` | Comprehensive submission validation |

---

## matching_events.ts — Event System

Typed event system for the order lifecycle. Used by settlement, monitoring, and notification systems.

### Event Types

| Event | Key Fields | Trigger |
|-------|-----------|---------|
| `ORDER_SUBMITTED` | `orderId`, `commitment` | Order accepted into book |
| `ORDER_MATCHED` | `matchId`, `buyOrderId`, `sellOrderId`, `executionPrice` | Two orders matched |
| `ORDER_CANCELLED` | `orderId`, `reason` | Order cancelled by trader |
| `ORDER_EXPIRED` | `orderId`, `ttlMs` | Order time-to-live exceeded |
| `ORDER_REJECTED` | `commitmentHash`, `reason`, `errorCode` | Order failed validation |
| `ORDER_PARTIALLY_FILLED` | `orderId`, `filledSize`, `remainingSize` | Partial fill executed |
| `MATCHING_ROUND_STARTED` | `roundId`, `openOrderCount` | Round begins |
| `MATCHING_ROUND_COMPLETED` | `roundId`, `matchCount`, `durationMs` | Round ends |
| `MATCHING_ERROR` | `errorMessage`, `isRecoverable` | Error during matching |

### MatchingEventEmitter Class

| Method | Signature | Description |
|--------|-----------|-------------|
| `on` | `(eventType, handler) -> unsubscribe` | Subscribe to specific event type |
| `onAny` | `(handler) -> unsubscribe` | Subscribe to all events |
| `emit` | `(event) -> Promise<void>` | Emit event to registered handlers |
| `removeAllListeners` | `(eventType?) -> void` | Clear handlers |
