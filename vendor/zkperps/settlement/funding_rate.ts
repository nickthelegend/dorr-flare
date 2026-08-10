import { randomUUID } from "node:crypto";
import type { PerpetualContract, Position, PriceData } from "../common/types.js";
import { OrderSide } from "../common/types.js";
import { calculateFundingRate as calcMarkIndexRate } from "../common/utils.js";
import { FUNDING_DAMPENING_FACTOR } from "../common/constants.js";

export interface FundingRateRecord {
  epochId: string;
  pairId: string;
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  totalFundingPaid: number;
  totalFundingReceived: number;
  positionsAffected: number;
  timestamp: number;
}

export interface FundingPayment {
  positionId: string;
  traderId: string;
  amount: number;
  fundingRate: number;
  positionSize: number;
  markPrice: number;
}

export interface FundingRatePrediction {
  predictedRate: number;
  currentSpread: number;
  timeUntilNextFundingMs: number;
  estimatedPaymentPerUnitLong: number;
  estimatedPaymentPerUnitShort: number;
}

const history: FundingRateRecord[] = [];

export function calculateFundingRate(
  priceData: PriceData,
  dampeningFactor: number = FUNDING_DAMPENING_FACTOR,
): number {
  return calcMarkIndexRate(priceData.markPrice, priceData.indexPrice, dampeningFactor);
}

export function applyFunding(
  pairId: string,
  fundingRate: number,
  positions: Position[],
  markPrice: number,
): FundingPayment[] {
  const out: FundingPayment[] = [];
  for (const p of positions) {
    if (p.pairId !== pairId) continue;
    const base = fundingRate * p.size * markPrice;
    const amount = p.side === OrderSide.LONG ? base : -base;
    out.push({
      positionId: p.positionId,
      traderId: p.traderId,
      amount,
      fundingRate,
      positionSize: p.size,
      markPrice,
    });
  }
  return out;
}

export async function getFundingHistory(
  pairId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<FundingRateRecord[]> {
  return history
    .filter((h) => h.pairId === pairId)
    .slice(offset, offset + limit);
}

export function getNextFundingTime(pairId: string, fundingIntervalMs: number): number {
  void pairId;
  const t = Date.now() % fundingIntervalMs;
  return fundingIntervalMs - t;
}

export function predictNextFundingRate(
  priceData: PriceData,
  fundingIntervalMs: number,
): FundingRatePrediction {
  const predictedRate = calculateFundingRate(priceData);
  const spread = priceData.markPrice - priceData.indexPrice;
  return {
    predictedRate,
    currentSpread: spread,
    timeUntilNextFundingMs: getNextFundingTime(priceData.pairId, fundingIntervalMs),
    estimatedPaymentPerUnitLong: predictedRate * priceData.markPrice,
    estimatedPaymentPerUnitShort: -predictedRate * priceData.markPrice,
  };
}

export async function processFundingEpoch(
  contract: PerpetualContract,
  priceData: PriceData,
  positions: Position[],
): Promise<FundingRateRecord> {
  const pairId = contract.pair.pairId;
  const rate = calculateFundingRate(priceData);
  const payments = applyFunding(pairId, rate, positions, priceData.markPrice);
  let paid = 0;
  let received = 0;
  for (const x of payments) {
    if (x.amount > 0) paid += x.amount;
    else received += -x.amount;
  }
  const rec: FundingRateRecord = {
    epochId: randomUUID(),
    pairId,
    fundingRate: rate,
    markPrice: priceData.markPrice,
    indexPrice: priceData.indexPrice,
    totalFundingPaid: paid,
    totalFundingReceived: received,
    positionsAffected: payments.length,
    timestamp: Date.now(),
  };
  history.unshift(rec);
  return rec;
}
