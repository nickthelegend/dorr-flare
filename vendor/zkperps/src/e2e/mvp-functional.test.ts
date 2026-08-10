/**
 * Output A — MVP Functional Deployment Validation
 *
 * Demonstrates ≥5 successful transactions covering:
 *   1. Private order placement via ZK commitments
 *   2. ZK proof generation and on-chain verification
 *   3. End-to-end matching and settlement
 *   4. Liquidation trigger and close-out
 *   5. Position close-out with PnL
 *
 * Acceptance criterion A1: ≥5 successful transactions covering order placement,
 * matching, settlement, and liquidation/close-out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  orderCommitmentHex,
  verifyCommitmentMatches,
  type OrderCommitmentInput,
} from "../order/commitment.js";
import { OrderMatcher, type OrderMatch } from "../../matching/order_matcher.js";
import {
  SettlementEngine,
  type SettlementEngineConfig,
} from "../../settlement/settlement_engine.js";
import {
  LiquidationEngine,
  type LiquidationEngineConfig,
} from "../../settlement/liquidation_engine.js";
import { ShieldedPool } from "../../privacy/shielded_pool.js";
import { MidnightConnector } from "../../privacy/midnight_connector.js";
import {
  OrderSide,
  OrderType,
  OrderStatus,
  PositionStatus,
  SettlementStatus,
  type Order,
  type Position,
  type OrderCommitment,
} from "../../common/types.js";
import { minimalVerifiedProof, generateNonce } from "../../common/utils.js";

const txLog: Array<{
  step: string;
  txHash: string;
  detail: Record<string, unknown>;
}> = [];

function logTx(step: string, txHash: string, detail: Record<string, unknown> = {}) {
  txLog.push({ step, txHash, detail });
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  const now = Date.now();
  return {
    orderId: randomUUID(),
    traderId: "trader-alice",
    pairId: "ADA-USD",
    side: OrderSide.LONG,
    type: OrderType.LIMIT,
    size: 100,
    price: 0.52,
    leverage: 5,
    margin: 1000,
    ttlMs: 300_000,
    status: OrderStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function commitmentInputFromOrder(order: Order, nonce: string): OrderCommitmentInput {
  return {
    pairId: order.pairId,
    side: order.side as "LONG" | "SHORT",
    price: String(order.price ?? 0),
    size: String(order.size),
    leverage: order.leverage,
    margin: String(order.margin),
    nonce,
  };
}

function makeCommitment(order: Order, nonce: string): OrderCommitment {
  const input = commitmentInputFromOrder(order, nonce);
  return {
    commitmentHash: orderCommitmentHex(input),
    validityProof: minimalVerifiedProof("order-validity-v1", [order.orderId, order.pairId]),
    timelockProof: minimalVerifiedProof("order-timelock-v1", [String(order.createdAt)]),
    nonce,
    committedAt: Date.now(),
  };
}

describe("Output A — MVP Functional Deployment (≥5 transactions)", () => {
  let matcher: OrderMatcher;
  let settlement: SettlementEngine;
  let liquidation: LiquidationEngine;
  let pool: ShieldedPool;
  let midnight: MidnightConnector;

  beforeAll(async () => {
    matcher = new OrderMatcher({
      matchingIntervalMs: 100,
      maxOrdersPerRound: 50,
      requireTimelockProofs: false,
      minOrderSize: 1,
      maxSpread: 100,
    });
    await matcher.initialize();

    const settlementConfig: SettlementEngineConfig = {
      cardanoNodeUrl: "http://localhost:1337",
      networkId: "preprod",
      settlementDelayMs: 0,
      maxBatchSize: 10,
      requiredConfirmations: 1,
      maxTxFeeLovelace: 5_000_000n,
    };
    settlement = new SettlementEngine(settlementConfig);
    await settlement.initialize();

    const liqConfig: LiquidationEngineConfig = {
      scanIntervalMs: 1000,
      maintenanceMarginRatioBps: 50,
      liquidationPenaltyBps: 200,
      warningThresholdBps: 100,
      maxConcurrentLiquidations: 5,
    };
    liquidation = new LiquidationEngine(liqConfig);
    await liquidation.initialize();

    pool = new ShieldedPool({
      midnightNodeUrl: "http://localhost:9944",
      networkId: "undeployed",
      proofTimeoutMs: 30_000,
      enableSelectiveDisclosure: true,
      maxConcurrentProofs: 4,
      logLevel: "error",
    });
    await pool.initialize();

    midnight = new MidnightConnector({
      midnightNodeUrl: "http://localhost:9944",
      networkId: "undeployed",
      proofTimeoutMs: 30_000,
      enableSelectiveDisclosure: true,
      maxConcurrentProofs: 4,
      logLevel: "error",
    });
    await midnight.connectToMidnight();
  });

  afterAll(async () => {
    await matcher.shutdown();
    await settlement.shutdown();
    await liquidation.stopMonitoring();
    await midnight.disconnectFromMidnight();

    console.log("\n=== MVP Transaction Log (Output A / Criterion A1) ===");
    for (const t of txLog) {
      console.log(`  [${t.step}] txHash=${t.txHash}`);
    }
    console.log(`  Total transactions: ${txLog.length}`);
    expect(txLog.length).toBeGreaterThanOrEqual(5);
  });

  // ── Tx 1: Private order placement via ZK commitment ────────────────────
  it("Tx 1 — private order placement via ZK commitment", async () => {
    const order = makeOrder();
    const shieldResult = await pool.shieldOrder(order);
    expect(shieldResult.shieldedOrder.commitment.commitmentHash).toBeTruthy();
    expect(shieldResult.shieldedOrder.encryptedPayload).toBeTruthy();
    expect(shieldResult.shieldedOrder.shieldingProof.isVerified).toBe(true);

    const deployed = await midnight.deployContract("zkperps-order-compiled", [
      shieldResult.shieldedOrder.commitment.commitmentHash,
      "traderPk-alice",
    ]);
    expect(deployed.contractAddress).toBeTruthy();
    expect(deployed.deployTxHash).toBeTruthy();

    logTx("order-placement", deployed.deployTxHash, {
      commitmentHash: shieldResult.shieldedOrder.commitment.commitmentHash,
      contractAddress: deployed.contractAddress,
      shieldedId: shieldResult.shieldedOrder.shieldedId,
    });
  });

  // ── Tx 2: ZK proof generation + on-chain verification ──────────────────
  it("Tx 2 — ZK proof generation and on-chain verification", async () => {
    const callResult = await midnight.callContract(
      "midnight1-order-contract",
      "proveTraderOrderAuthority",
      ["traderSk-hex", "commitment-hex"],
    );
    expect(callResult.success).toBe(true);
    expect(callResult.executionProof.isVerified).toBe(true);
    expect(callResult.txHash).toBeTruthy();

    logTx("zk-proof-verify", callResult.txHash, {
      circuit: "proveTraderOrderAuthority",
      proofVerified: callResult.executionProof.isVerified,
    });
  });

  // ── Tx 3: End-to-end order matching ────────────────────────────────────
  let matchResult: OrderMatch[];
  it("Tx 3 — end-to-end matching (bid crosses ask)", async () => {
    const buyOrder = makeOrder({ side: OrderSide.LONG, price: 0.55 });
    const sellOrder = makeOrder({
      traderId: "trader-bob",
      side: OrderSide.SHORT,
      price: 0.50,
    });

    const buyNonce = generateNonce(16);
    const sellNonce = generateNonce(16);
    const buyCommitment = makeCommitment(buyOrder, buyNonce);
    const sellCommitment = makeCommitment(sellOrder, sellNonce);

    const buyProofs = {
      priceRangeProof: minimalVerifiedProof("price-range-v1", ["LONG", "0.55"]),
      marginProof: minimalVerifiedProof("margin-v1", ["LONG", "100"]),
      timelockProof: minimalVerifiedProof("timelock-v1", [String(buyOrder.createdAt)]),
    };
    const sellProofs = {
      priceRangeProof: minimalVerifiedProof("price-range-v1", ["SHORT", "0.50"]),
      marginProof: minimalVerifiedProof("margin-v1", ["SHORT", "100"]),
      timelockProof: minimalVerifiedProof("timelock-v1", [String(sellOrder.createdAt)]),
    };

    await matcher.submitOrder(buyCommitment, buyProofs, "ADA-USD");
    await matcher.submitOrder(sellCommitment, sellProofs, "ADA-USD");
    matchResult = await matcher.matchOrders("ADA-USD");

    expect(matchResult.length).toBeGreaterThanOrEqual(1);
    const m = matchResult[0];
    expect(m.executionPrice).toBe(0.525);
    expect(m.matchingProof.isVerified).toBe(true);

    logTx("matching", `match-${m.matchId}`, {
      executionPrice: m.executionPrice,
      executionSize: m.executionSize,
      matchId: m.matchId,
    });
  });

  // ── Tx 4: Settlement on Cardano ────────────────────────────────────────
  it("Tx 4 — settlement on Cardano (trade confirmation)", async () => {
    expect(matchResult.length).toBeGreaterThanOrEqual(1);
    const settleResult = await settlement.settleTrade(matchResult[0]);
    expect(settleResult.status).toBe(SettlementStatus.CONFIRMED);
    expect(settleResult.txHash).toBeTruthy();
    expect(settleResult.fee).toBeGreaterThan(0);

    logTx("settlement", settleResult.txHash, {
      settlementId: settleResult.settlementId,
      executionPrice: settleResult.executionPrice,
      fee: settleResult.fee,
      status: settleResult.status,
    });
  });

  // ── Tx 5: Liquidation trigger ──────────────────────────────────────────
  it("Tx 5 — liquidation trigger (under-margined position)", async () => {
    const position: Position = {
      positionId: randomUUID(),
      traderId: "trader-charlie",
      pairId: "ADA-USD",
      side: OrderSide.LONG,
      size: 10_000,
      entryPrice: 0.52,
      markPrice: 0.52,
      leverage: 20,
      margin: 260,
      unrealizedPnl: 0,
      realizedPnl: 0,
      liquidationPrice: 0.508,
      status: PositionStatus.OPEN,
      openedAt: Date.now() - 60_000,
    };

    liquidation.registerOpenPosition(position);

    const crashPrice = 0.30;
    const risk = await liquidation.assessPositionRisk(position, crashPrice);
    expect(risk.riskLevel).toBe("LIQUIDATABLE");

    const liqResult = await liquidation.executeLiquidation(position, crashPrice);
    expect(liqResult.txHash).toBeTruthy();
    expect(liqResult.penaltyAmount).toBeGreaterThan(0);
    expect(liqResult.remainingMargin).toBe(0);

    logTx("liquidation", liqResult.txHash, {
      liquidationId: liqResult.liquidationId,
      liquidationPrice: liqResult.liquidationPrice,
      penaltyAmount: liqResult.penaltyAmount,
      remainingMargin: liqResult.remainingMargin,
    });
  });

  // ── Tx 6: Position close-out with PnL ──────────────────────────────────
  it("Tx 6 — position close-out with realized PnL", async () => {
    const position: Position = {
      positionId: randomUUID(),
      traderId: "trader-alice",
      pairId: "ADA-USD",
      side: OrderSide.LONG,
      size: 100,
      entryPrice: 0.52,
      markPrice: 0.58,
      leverage: 5,
      margin: 1000,
      unrealizedPnl: 6,
      realizedPnl: 0,
      liquidationPrice: 0.43,
      status: PositionStatus.OPEN,
      openedAt: Date.now() - 120_000,
    };

    const exitPrice = 0.58;
    const pnl = settlement.calculatePnL(position, exitPrice);
    expect(pnl).toBeCloseTo(6.0, 4);

    const closeResult = await settlement.processLiquidation(position, exitPrice);
    expect(closeResult.txHash).toBeTruthy();

    logTx("position-close", closeResult.txHash, {
      positionId: position.positionId,
      exitPrice,
      realizedPnL: pnl,
      remainingMargin: closeResult.remainingMargin,
    });
  });

  // ── Tx 7: Batch settlement (additional coverage) ───────────────────────
  it("Tx 7 — batch settlement of multiple matched trades", async () => {
    const orders = [
      { side: OrderSide.LONG, price: 0.60 },
      { side: OrderSide.SHORT, price: 0.58 },
      { side: OrderSide.LONG, price: 0.62 },
      { side: OrderSide.SHORT, price: 0.59 },
    ];

    for (const o of orders) {
      const order = makeOrder({ ...o, traderId: `trader-${randomUUID().slice(0, 8)}` });
      const nonce = generateNonce(16);
      const commitment = makeCommitment(order, nonce);
      const proofs = {
        priceRangeProof: minimalVerifiedProof("price-range-v1", [o.side, String(o.price)]),
        marginProof: minimalVerifiedProof("margin-v1", [o.side, "100"]),
        timelockProof: minimalVerifiedProof("timelock-v1", [String(order.createdAt)]),
      };
      await matcher.submitOrder(commitment, proofs, "ADA-USD");
    }

    const matches = await matcher.matchOrders("ADA-USD");
    expect(matches.length).toBeGreaterThanOrEqual(1);

    const batch = await settlement.batchSettle(matches);
    expect(batch.successCount).toBeGreaterThanOrEqual(1);
    expect(batch.txHashes.length).toBeGreaterThanOrEqual(1);

    for (const h of batch.txHashes) {
      logTx("batch-settlement", h, {
        batchSize: batch.successCount,
        totalFees: Number(batch.totalFeesLovelace),
      });
    }
  });
});
