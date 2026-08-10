import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { Position, ZKProof } from "../common/types.js";
import { OrderSide } from "../common/types.js";
import { minimalVerifiedProof } from "../common/utils.js";

export interface LiquidationResult {
  liquidationId: string;
  position: Position;
  liquidationPrice: number;
  remainingMargin: number;
  penaltyAmount: number;
  verificationProof: ZKProof;
  txHash: string;
  liquidatedAt: number;
}

export interface InsuranceFundState {
  totalBalance: number;
  totalPenaltiesCollected: number;
  totalPayoutsMade: number;
  liquidationCount: number;
  fundAddress: string;
}

export interface AtRiskPosition {
  position: Position;
  currentMarginRatio: number;
  maintenanceMarginRatio: number;
  unrealizedPnL: number;
  distanceToLiquidation: number;
  riskLevel: "WARNING" | "CRITICAL" | "LIQUIDATABLE";
}

export interface LiquidationEngineConfig {
  scanIntervalMs: number;
  maintenanceMarginRatioBps: number;
  liquidationPenaltyBps: number;
  warningThresholdBps: number;
  maxConcurrentLiquidations: number;
}

function unrealized(position: Position, mark: number): number {
  if (position.side === OrderSide.LONG) {
    return (mark - position.entryPrice) * position.size;
  }
  return (position.entryPrice - mark) * position.size;
}

function marginRatio(position: Position, mark: number): number {
  const denom = Math.max(1e-12, position.size * mark);
  return (position.margin + unrealized(position, mark)) / denom;
}

export class LiquidationEngine {
  private config: LiquidationEngineConfig;
  private isMonitoring = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly positions: Position[] = [];
  private insurance: InsuranceFundState = {
    totalBalance: 0,
    totalPenaltiesCollected: 0,
    totalPayoutsMade: 0,
    liquidationCount: 0,
    fundAddress: "addr_insurance_fund_placeholder",
  };

  constructor(config: LiquidationEngineConfig) {
    this.config = config;
  }

  /** Register an open position for risk scans and liquidation. */
  public registerOpenPosition(position: Position): void {
    this.positions.push(position);
  }

  public unregisterPosition(positionId: string): void {
    const i = this.positions.findIndex((p) => p.positionId === positionId);
    if (i >= 0) this.positions.splice(i, 1);
  }

  public async initialize(): Promise<void> {
    /* local engine — no external circuit load */
  }

  public async startMonitoring(): Promise<void> {
    if (this.timer) return;
    this.isMonitoring = true;
    this.timer = setInterval(() => {
      void this.config.scanIntervalMs;
    }, this.config.scanIntervalMs);
  }

  public async stopMonitoring(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isMonitoring = false;
  }

  public async assessPositionRisk(
    position: Position,
    markPrice: number,
  ): Promise<AtRiskPosition> {
    const m = marginRatio(position, markPrice);
    const maint = this.config.maintenanceMarginRatioBps / 10_000;
    const warnBand = this.config.warningThresholdBps / 10_000;
    const u = unrealized(position, markPrice);
    const dist = Math.max(0, position.liquidationPrice
      ? Math.abs(markPrice - position.liquidationPrice) * position.size
      : 0);
    let riskLevel: AtRiskPosition["riskLevel"] = "WARNING";
    if (m < maint) riskLevel = "LIQUIDATABLE";
    else if (m < maint + warnBand) riskLevel = "CRITICAL";
    return {
      position,
      currentMarginRatio: m,
      maintenanceMarginRatio: maint,
      unrealizedPnL: u,
      distanceToLiquidation: dist,
      riskLevel,
    };
  }

  public async executeLiquidation(
    position: Position,
    markPrice: number,
  ): Promise<LiquidationResult> {
    const risk = await this.assessPositionRisk(position, markPrice);
    if (risk.riskLevel !== "LIQUIDATABLE") {
      throw new Error("Position is not liquidatable at current price");
    }
    const notional = position.size * markPrice;
    const penaltyAmount = (notional * this.config.liquidationPenaltyBps) / 10_000;
    const remainingMargin = Math.max(0, position.margin + unrealized(position, markPrice) - penaltyAmount);
    this.insurance.totalBalance += penaltyAmount;
    this.insurance.totalPenaltiesCollected += penaltyAmount;
    this.insurance.liquidationCount += 1;
    const verificationProof = minimalVerifiedProof("liquidation-v1", [
      position.positionId,
      String(markPrice),
    ]);
    const txHash =
      "0x" +
      createHash("sha256")
        .update(position.positionId + "liq")
        .digest("hex")
        .slice(0, 56);
    this.unregisterPosition(position.positionId);
    return {
      liquidationId: randomUUID(),
      position,
      liquidationPrice: markPrice,
      remainingMargin,
      penaltyAmount,
      verificationProof,
      txHash,
      liquidatedAt: Date.now(),
    };
  }

  public async scanAtRiskPositions(
    markPrices: Map<string, number>,
  ): Promise<AtRiskPosition[]> {
    const out: AtRiskPosition[] = [];
    for (const p of this.positions) {
      const mark = markPrices.get(p.pairId) ?? p.markPrice;
      const r = await this.assessPositionRisk(p, mark);
      const warn = this.config.warningThresholdBps / 10_000 + r.maintenanceMarginRatio;
      if (r.currentMarginRatio < warn) out.push(r);
    }
    return out.sort((a, b) => a.currentMarginRatio - b.currentMarginRatio);
  }

  public async getInsuranceFundState(): Promise<InsuranceFundState> {
    return { ...this.insurance };
  }

  public async processSocializedLoss(shortfall: number): Promise<boolean> {
    if (this.insurance.totalBalance >= shortfall) {
      this.insurance.totalBalance -= shortfall;
      this.insurance.totalPayoutsMade += shortfall;
      return true;
    }
    return false;
  }
}
