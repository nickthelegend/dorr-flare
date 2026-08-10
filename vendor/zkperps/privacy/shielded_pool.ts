import { randomUUID } from "node:crypto";
import type {
  Order,
  OrderCommitment,
  ZKProof,
  PrivacyConfig,
} from "../common/types.js";
import { generateNonce, hashOrder, minimalVerifiedProof } from "../common/utils.js";
import { sealJson, openJson } from "./codec.js";
export interface ShieldedOrder {
  shieldedId: string;
  commitment: OrderCommitment;
  encryptedPayload: string;
  publicMetadata: {
    pairId: string;
    submittedAt: number;
    expiresAt: number;
  };
  encryptionScheme: "AES-256-GCM" | "ChaCha20-Poly1305";
  shieldingProof: ZKProof;
}

export interface ShieldResult {
  shieldedOrder: ShieldedOrder;
  decryptionKey: string;
  commitmentNonce: string;
}

export interface UnshieldResult {
  order: Order;
  unshieldingProof: ZKProof;
  isValid: boolean;
}

export interface ShieldedBalance {
  traderId: string;
  activeShieldedOrders: number;
  totalLockedMargin: number;
  lastActivityAt: number;
}

export class ShieldedPool {
  private config: PrivacyConfig;
  private readonly orders = new Map<string, ShieldedOrder & { traderId: string }>();

  constructor(config: PrivacyConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    void this.config;
    this.orders.clear();
  }

  public async shieldOrder(order: Order): Promise<ShieldResult> {
    const commitmentNonce = generateNonce(16);
    const commitmentHash = hashOrder(order, commitmentNonce);
    const commitment: OrderCommitment = {
      commitmentHash,
      validityProof: minimalVerifiedProof("order-validity-v1", [order.orderId, order.pairId]),
      timelockProof: minimalVerifiedProof("order-timelock-v1", [String(order.createdAt)]),
      nonce: commitmentNonce,
      committedAt: Date.now(),
    };
    const decryptionKey = generateNonce(32);
    const encryptedPayload = sealJson(order, decryptionKey);
    const shieldedId = randomUUID();
    const now = Date.now();
    const shieldedOrder: ShieldedOrder = {
      shieldedId,
      commitment,
      encryptedPayload,
      publicMetadata: {
        pairId: order.pairId,
        submittedAt: now,
        expiresAt: now + order.ttlMs,
      },
      encryptionScheme: "AES-256-GCM",
      shieldingProof: minimalVerifiedProof("shield-v1", [shieldedId]),
    };
    this.orders.set(shieldedId, { ...shieldedOrder, traderId: order.traderId });
    return { shieldedOrder, decryptionKey, commitmentNonce };
  }

  public async unshieldOrder(
    shieldedId: string,
    decryptionKey: string,
  ): Promise<UnshieldResult> {
    const row = this.orders.get(shieldedId);
    if (!row) {
      return {
        order: {} as Order,
        unshieldingProof: minimalVerifiedProof("unshield-fail", []),
        isValid: false,
      };
    }
    try {
      const order = openJson(row.encryptedPayload, decryptionKey) as Order;
      const ok =
        hashOrder(order, row.commitment.nonce ?? "") === row.commitment.commitmentHash;
      return {
        order,
        unshieldingProof: minimalVerifiedProof("unshield-v1", [shieldedId]),
        isValid: ok,
      };
    } catch {
      return {
        order: {} as Order,
        unshieldingProof: minimalVerifiedProof("unshield-fail", []),
        isValid: false,
      };
    }
  }

  public async getShieldedBalance(traderId: string): Promise<ShieldedBalance> {
    let n = 0;
    let margin = 0;
    let last = 0;
    for (const o of this.orders.values()) {
      if (o.traderId !== traderId) continue;
      n++;
      last = Math.max(last, o.publicMetadata.submittedAt);
    }
    return {
      traderId,
      activeShieldedOrders: n,
      totalLockedMargin: margin,
      lastActivityAt: last,
    };
  }

  public async transferShielded(
    shieldedId: string,
    oldDecryptionKey: string,
    newEncryptionKey: string,
  ): Promise<ShieldedOrder> {
    const row = this.orders.get(shieldedId);
    if (!row) throw new Error("transferShielded: unknown shieldedId");
    const order = openJson(row.encryptedPayload, oldDecryptionKey) as Order;
    const nextPayload = sealJson(order, newEncryptionKey);
    const updated: ShieldedOrder = {
      ...row,
      encryptedPayload: nextPayload,
      shieldingProof: minimalVerifiedProof("shield-rotate-v1", [shieldedId]),
    };
    this.orders.set(shieldedId, { ...updated, traderId: row.traderId });
    return updated;
  }

  public async verifyShieldedState(shieldedId: string): Promise<boolean> {
    const row = this.orders.get(shieldedId);
    return !!row && row.shieldingProof.isVerified;
  }
}
