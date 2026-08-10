import type { MarginAccount } from "../common/types.js";
import { SettlementError } from "../common/errors.js";
import { ErrorCode } from "../common/errors.js";

export interface MarginTransactionResult {
  success: boolean;
  account: MarginAccount;
  txHash: string;
  amount: number;
  type: "deposit" | "withdrawal";
  timestamp: number;
}

export interface MarginCallNotification {
  traderId: string;
  currentMarginRatio: number;
  maintenanceMarginRatio: number;
  additionalMarginRequired: number;
  deadline: number;
  positionsAtRisk: string[];
}

export interface MarginManagerConfig {
  minDepositAmount: number;
  maxWithdrawalAmount: number;
  marginCallThreshold: number;
  liquidationThreshold: number;
  marginCallGracePeriodMs: number;
}

function ratio(account: MarginAccount): number {
  if (account.lockedMargin <= 0) return 1;
  return (account.totalBalance + account.unrealizedPnl) / account.lockedMargin;
}

function snapshot(a: MarginAccount): MarginAccount {
  return {
    ...a,
    marginRatio: ratio(a),
  };
}

function empty(traderId: string): MarginAccount {
  return {
    traderId,
    totalBalance: 0,
    lockedMargin: 0,
    availableBalance: 0,
    unrealizedPnl: 0,
    marginRatio: 1,
  };
}

export class MarginManager {
  private config: MarginManagerConfig;
  private readonly accounts = new Map<string, MarginAccount>();
  private readonly locks = new Map<string, number>();

  constructor(config: MarginManagerConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    this.accounts.clear();
    this.locks.clear();
  }

  private acc(id: string): MarginAccount {
    return this.accounts.get(id) ?? empty(id);
  }

  private save(a: MarginAccount): void {
    this.accounts.set(a.traderId, snapshot(a));
  }

  public async depositMargin(
    traderId: string,
    amount: number,
  ): Promise<MarginTransactionResult> {
    if (amount < this.config.minDepositAmount) {
      throw new SettlementError("Below min deposit", ErrorCode.INSUFFICIENT_MARGIN, {
        amount,
      });
    }
    const a = this.acc(traderId);
    a.totalBalance += amount;
    a.availableBalance += amount;
    this.save(a);
    return {
      success: true,
      account: snapshot(a),
      txHash: "local-deposit-" + traderId.slice(0, 8),
      amount,
      type: "deposit",
      timestamp: Date.now(),
    };
  }

  public async withdrawMargin(
    traderId: string,
    amount: number,
  ): Promise<MarginTransactionResult> {
    if (amount > this.config.maxWithdrawalAmount) {
      throw new SettlementError("Withdrawal exceeds cap", ErrorCode.INSUFFICIENT_MARGIN, {
        amount,
      });
    }
    const a = this.acc(traderId);
    if (amount > a.availableBalance) {
      throw new SettlementError("Insufficient available margin", ErrorCode.INSUFFICIENT_MARGIN, {
        amount,
        available: a.availableBalance,
      });
    }
    const test = { ...a, availableBalance: a.availableBalance - amount, totalBalance: a.totalBalance - amount };
    if (ratio(test) < this.config.liquidationThreshold && a.lockedMargin > 0) {
      throw new SettlementError("Withdrawal would breach maintenance", ErrorCode.LIQUIDATION_TRIGGERED, {});
    }
    a.availableBalance -= amount;
    a.totalBalance -= amount;
    this.save(a);
    return {
      success: true,
      account: snapshot(a),
      txHash: "local-withdraw-" + traderId.slice(0, 8),
      amount,
      type: "withdrawal",
      timestamp: Date.now(),
    };
  }

  public async checkMarginLevel(traderId: string): Promise<number> {
    return ratio(this.acc(traderId));
  }

  public async triggerMarginCall(traderId: string): Promise<MarginCallNotification> {
    const a = this.acc(traderId);
    const r = ratio(a);
    const need = Math.max(0, this.config.marginCallThreshold * a.lockedMargin - (a.totalBalance + a.unrealizedPnl));
    return {
      traderId,
      currentMarginRatio: r,
      maintenanceMarginRatio: this.config.liquidationThreshold,
      additionalMarginRequired: need,
      deadline: Date.now() + this.config.marginCallGracePeriodMs,
      positionsAtRisk: [],
    };
  }

  public async getMarginBalance(traderId: string): Promise<MarginAccount> {
    return snapshot(this.acc(traderId));
  }

  public async lockMargin(
    traderId: string,
    marginAmount: number,
    positionId: string,
  ): Promise<boolean> {
    void positionId;
    const a = this.acc(traderId);
    if (a.availableBalance < marginAmount) return false;
    a.availableBalance -= marginAmount;
    a.lockedMargin += marginAmount;
    this.locks.set(`${traderId}::${positionId}`, marginAmount);
    this.save(a);
    return true;
  }

  public async releaseMargin(
    traderId: string,
    positionId: string,
    pnl: number,
  ): Promise<MarginAccount> {
    const k = `${traderId}::${positionId}`;
    const locked = this.locks.get(k) ?? 0;
    this.locks.delete(k);
    const a = this.acc(traderId);
    a.lockedMargin = Math.max(0, a.lockedMargin - locked);
    a.availableBalance += locked + pnl;
    a.totalBalance += pnl;
    this.save(a);
    return snapshot(a);
  }
}
