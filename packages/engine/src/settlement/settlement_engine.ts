import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { SettlementResult, Position } from "../common/types.js";
import { SettlementStatus, OrderSide } from "../common/types.js";
import { TRADING_FEE_RATE } from "../common/constants.js";
import type { OrderMatch } from "../matching/order_matcher.js";
import type { CardanoConnector } from "./cardano_connector.js";

export interface SettlementEngineConfig {
  cardanoNodeUrl: string;
  networkId: string;
  settlementDelayMs: number;
  maxBatchSize: number;
  requiredConfirmations: number;
  maxTxFeeLovelace: bigint;
  /** When set, trades are anchored via Lucid; otherwise synthetic tx hashes are returned. */
  cardanoConnector?: CardanoConnector;
}

export interface LiquidationResult {
  position: Position;
  liquidationPrice: number;
  remainingMargin: number;
  penaltyAmount: number;
  txHash: string;
  liquidatedAt: number;
}

export interface BatchSettlementResult {
  settlements: SettlementResult[];
  successCount: number;
  failureCount: number;
  totalFeesLovelace: bigint;
  txHashes: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SettlementEngine {
  private config: SettlementEngineConfig;
  private isInitialized = false;
  private readonly statusById = new Map<string, SettlementStatus>();

  constructor(config: SettlementEngineConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    if (this.config.cardanoConnector) {
      await this.config.cardanoConnector.connect();
    }
    this.isInitialized = true;
  }

  public async settleTrade(match: OrderMatch): Promise<SettlementResult> {
    if (!this.isInitialized) throw new Error("SettlementEngine not initialized");
    await sleep(this.config.settlementDelayMs);
    const settlementId = randomUUID();
    const notional = match.executionPrice * match.executionSize;
    const fee = notional * TRADING_FEE_RATE;
    const matchedOrderIds: [string, string] = [
      match.buyOrderCommitment.commitmentHash,
      match.sellOrderCommitment.commitmentHash,
    ];

    const conn = this.config.cardanoConnector;
    if (conn) {
      const orderCommitmentHex = createHash("sha256")
        .update(
          `${match.buyOrderCommitment.commitmentHash}\0${match.sellOrderCommitment.commitmentHash}\0${match.matchId}`,
        )
        .digest("hex");
      const midnightTxUtf8 = JSON.stringify({
        t: "zkperps-settlement",
        v: 1,
        settlementId,
        matchId: match.matchId,
        executionPrice: match.executionPrice,
        executionSize: match.executionSize,
      });
      const tx = await conn.buildSettlementTx({
        inputs: [],
        outputs: [{ address: "", lovelace: 2_000_000n }],
        anchor: { settlementId, orderCommitmentHex, midnightTxUtf8 },
        changeAddress: "",
      });
      const signed = await conn.signTransaction(tx);
      const sub = await conn.submitTransaction(signed);
      if (!sub.accepted) {
        this.statusById.set(settlementId, SettlementStatus.FAILED);
        throw new Error(sub.errorMessage ?? "submit failed");
      }
      this.statusById.set(settlementId, SettlementStatus.CONFIRMED);
      return {
        settlementId,
        txHash: sub.txHash,
        matchedOrderIds,
        executionPrice: match.executionPrice,
        executionSize: match.executionSize,
        fee,
        status: SettlementStatus.CONFIRMED,
        settledAt: Date.now(),
      };
    }

    const txHash =
      "0x" +
      createHash("sha256").update(match.matchId + settlementId).digest("hex").slice(0, 56);
    this.statusById.set(settlementId, SettlementStatus.CONFIRMED);
    return {
      settlementId,
      txHash,
      matchedOrderIds,
      executionPrice: match.executionPrice,
      executionSize: match.executionSize,
      fee,
      status: SettlementStatus.CONFIRMED,
      settledAt: Date.now(),
    };
  }

  public async batchSettle(matches: OrderMatch[]): Promise<BatchSettlementResult> {
    const settlements: SettlementResult[] = [];
    const txHashes: string[] = [];
    let successCount = 0;
    let failureCount = 0;
    let totalFeesLovelace = 0n;
    for (let i = 0; i < matches.length; i += this.config.maxBatchSize) {
      const chunk = matches.slice(i, i + this.config.maxBatchSize);
      for (const m of chunk) {
        try {
          const r = await this.settleTrade(m);
          settlements.push(r);
          txHashes.push(r.txHash);
          successCount++;
          totalFeesLovelace += BigInt(Math.ceil(r.fee));
        } catch {
          failureCount++;
        }
      }
    }
    return { settlements, successCount, failureCount, totalFeesLovelace, txHashes };
  }

  public calculatePnL(position: Position, markPrice: number): number {
    if (position.side === OrderSide.LONG) {
      return (markPrice - position.entryPrice) * position.size;
    }
    return (position.entryPrice - markPrice) * position.size;
  }

  public async processLiquidation(
    position: Position,
    currentPrice: number,
  ): Promise<LiquidationResult> {
    const pnl = this.calculatePnL(position, currentPrice);
    const penaltyAmount = Math.max(0, position.margin * 0.02);
    const remainingMargin = Math.max(0, position.margin + pnl - penaltyAmount);
    const txHash =
      "0x" +
      createHash("sha256")
        .update(position.positionId + String(currentPrice))
        .digest("hex")
        .slice(0, 56);
    return {
      position,
      liquidationPrice: currentPrice,
      remainingMargin,
      penaltyAmount,
      txHash,
      liquidatedAt: Date.now(),
    };
  }

  public async getSettlementStatus(settlementId: string): Promise<SettlementStatus> {
    return this.statusById.get(settlementId) ?? SettlementStatus.BUILDING;
  }

  public async shutdown(): Promise<void> {
    await this.config.cardanoConnector?.disconnect();
    this.isInitialized = false;
  }
}
