/**
 * dorr operator API client — typed fetch helpers for every REST endpoint.
 * All helpers throw OperatorError on non-2xx; callers (TanStack Query)
 * fail soft so the UI never crashes when the operator is down.
 */

const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_URL || "http://localhost:8790";

export const OPERATOR_URL = OPERATOR;

// ─── types ────────────────────────────────────────────────────────────────────

export type Side = "LONG" | "SHORT";
export type PrivacyMode = "private" | "public";
export type OrderType = "market" | "limit";

export interface Health {
  ok: boolean;
  service: string;
  markets: number;
  chain: string;
  flareReady: boolean;
  now?: string;
}

export interface Market {
  id: string;
  symbol: string;
  base: string;
  maxLeverage: number;
  disabled: boolean;
  indexPrice: number | null;
  markPrice: number | null;
  publishTime: number | null;
  vamm: { virtualBase: number; virtualQuote: number } | null;
}

export interface VaultInfo {
  chain: string;
  chainId: number;
  vaultAddress: string;
  settlementAddress: string;
  collateral: { symbol: string; address: string; decimals: number };
  explorerUrl: string;
  faucetUrl: string;
  note?: string;
}

export interface Account {
  address: string;
  balance: number;
  locked: number;
  free: number;
  openPositions: number;
}

export interface FaucetResult {
  success: boolean;
  txHash: string;
  amount: number;
  jobId?: string;
}

export interface DepositSyncResult {
  credited: Array<{ amount: number }>;
  balance: number;
  free: number;
}

export interface WithdrawResult {
  success: boolean;
  txHash: string;
  jobId?: string;
  balance?: number;
}

export interface CommitResult {
  success: boolean;
  orderId: string;
  jobId: string;
  commitmentHash: string;
  sizeBase: number;
  commitPrice: number;
}

export interface Order {
  id: string;
  address: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  leverage: number;
  marginUsd: number;
  commitPrice: number;
  privacyMode: PrivacyMode;
  nonce: string;
  commitmentHash: string;
  status: "committed" | "executed" | "cancelled" | "failed";
  createdAt: string;
  orderType?: OrderType;
  limitPrice?: number;
  maxSlippageBps?: number;
  executedFill?: { avgPrice: number; priceImpactBps: number; notional: number };
}

export interface Position {
  id: string;
  orderId: string;
  address: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  entryPrice: number;
  marginUsd: number;
  leverage: number;
  openedAt: string;
  fundingPaid: number;
  status: "open" | "closed" | "liquidated";
  closedAt?: string;
  exitPrice?: number;
  realizedPnl?: number;
  markPrice?: number;
  unrealizedPnl?: number;
  orderType?: OrderType;
  /** engine-computed liquidation price (open positions only). */
  liquidationPrice?: number;
  /** hidden stop-loss trigger price (never published — anti stop-hunting). */
  stopLossPrice?: number;
  /** hidden take-profit trigger price. */
  takeProfitPrice?: number;
  settlement?: {
    settlementId?: string;
    /** SHA-256(orderCommitment ‖ closeRecord) — proves what settled, not its contents. */
    settlementDigest?: string;
    batchEpochId?: string;
    batchTx?: string;
  };
}

/** A private (hidden) resting limit order — visible only to its owner. */
export interface RestingOrder {
  id: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  leverage: number;
  marginUsd: number;
  limitPrice: number;
  commitmentHash: string;
  createdAt: string;
}

export interface ExecuteResult {
  success: boolean;
  position: Position;
  jobId: string;
}

export interface JobStep {
  label: string;
  status: "running" | "complete" | "error";
  detail?: string;
  txHash?: string;
  ms?: number;
}

export interface Job {
  id: string;
  kind: "commit" | "execute" | "close";
  refId: string;
  status: "running" | "complete" | "error";
  steps: JobStep[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface FeedEntry {
  at: string;
  marketId: string;
  privacyMode: PrivacyMode;
  commitmentHash: string;
  leaked?: { side: Side; sizeBase: number; leverage: number; address: string };
}

export interface Anchor {
  settlementId: string;
  txHash: string;
  commitmentHex: string;
  at: string;
  explorerUrl: string;
}

/** POST /demo/ab — the front-running A/B showcase (public DEX vs dorr private). */
export interface AbDemo {
  marketId: string;
  symbol: string;
  indexPrice: number;
  victim: { side: Side; marginUsd: number; leverage: number; sizeBase: number };
  bot: { sizeBase: number; marginUsd: number };
  public: {
    botFrontRunPrice: number;
    victimEntry: number;
    botExitPrice: number;
    botProfitUsd: number;
    victimSlippageBps: number;
    victimExtraCostUsd: number;
    orderVisibleToBot: boolean;
  };
  private: {
    victimEntry: number;
    victimSlippageBps: number;
    orderVisibleToBot: boolean;
    publicSees: string;
  };
  headline: string;
}

/** POST /demo/attack — the MEV attack lab: same sandwich, public DEX vs dorr. */
export type AttackActor = "bot" | "victim" | "chain" | "dorr";
export interface AttackStep {
  ms: number;
  actor: AttackActor;
  ok: boolean;
  text: string;
}
export interface AttackLab {
  marketId: string;
  symbol: string;
  indexPrice: number;
  /** transparent DEX: the bot sees the order and sandwiches it. */
  publicRun: {
    steps: AttackStep[];
    victimEntry: number;
    victimExtraCostUsd: number;
    victimSlippageBps: number;
    botProfitUsd: number;
    outcome: "SANDWICHED";
  };
  /** dorr: the bot sees only a hash, tries to crack it, and aborts. */
  privateRun: {
    steps: AttackStep[];
    commitmentHash: string;
    bruteForceAttempts: number;
    bruteForceMatches: number;
    /** Wall-clock the brute-force actually took on the server, and its rate. */
    bruteForceMs: number;
    bruteForceRatePerSec: number;
    victimEntry: number;
    outcome: "ATTACK FAILED";
  };
  headline: string;
}

/** GET /events — the trader's own activity timeline. */
export type EventType =
  | "commit" | "limit-rest" | "execute" | "limit-fill"
  | "close" | "partial-close" | "stop-loss" | "take-profit" | "liquidated"
  | "margin" | "stops-set" | "anchor" | "deposit" | "withdraw" | "disclose";

export interface DorrEvent {
  at: string;
  type: EventType;
  address?: string;
  marketId?: string;
  detail: string;
  txHash?: string;
  chain?: "flare-coston2";
}

/** The private order fields opened by a selective disclosure. */
export interface DisclosureRevealed {
  pairId: string;
  side: Side;
  price: string;
  size: string;
  leverage: number;
  margin: string;
  nonce: string;
}

/** POST /disclose — a signed opening of a hidden order to a chosen audience. */
export interface Disclosure {
  kind: "dorr-selective-disclosure/v1";
  subject: "order";
  orderId: string;
  audience: string;
  /** the commitment published for this order (recorded in the on-chain batch). */
  commitment: string;
  /** the opened preimage — share ONLY with the intended auditor. */
  revealed: DisclosureRevealed;
  issuedAt: string;
  statement: string;
}

/** POST /disclose/verify — verdict on a disclosure handed to you (no auth). */
export interface DisclosureVerdict {
  valid: boolean;
  recomputed: string;
  commitment: string;
  matches: boolean;
  reason: string;
}

/** GET /stats — exchange telemetry: per-market OI/skew/funding + global TVL/volume. */
export interface MarketStat {
  id: string;
  symbol: string;
  base: string;
  indexPrice: number | null;
  markPrice: number | null;
  openPositions: number;
  longOiUsd: number;
  shortOiUsd: number;
  openInterestUsd: number;
  skewUsd: number;
  fundingRateHourly: number;
}
export interface Stats {
  markets: MarketStat[];
  global: {
    openInterestUsd: number;
    openPositions: number;
    accounts: number;
    tvlUsd: number;
    volumeUsd: number;
    insuranceFundUsd: number;
    anchors: number;
  };
  at: string;
}

/** GET /ops/solvency — attestation that the on-chain vault ≥ credited balances. */
export interface Solvency {
  solvent: boolean;
  reservesUsd: number;
  liabilitiesUsd: number;
  surplusUsd: number;
  collateralizationRatio: number | null;
  vaultAddress: string;
  collateralAddress: string;
  attestation: string;
  at: string;
  note: string;
}

/** POST /demo/batch — uniform-price batch auction: a sandwich nets $0 structurally. */
export interface BatchDemo {
  marketId: string;
  symbol: string;
  indexPrice: number;
  victim: { side: Side; marginUsd: number; leverage: number; sizeBase: number };
  epoch: {
    orders: Array<{ label: string; side: Side; sizeBase: number; commitment: string }>;
    clearingPrice: number;
    matchedBase: number;
    netImbalanceBase: number;
    impactBps: number;
  };
  attack: {
    frontRunSizeBase: number;
    botBuyPrice: number;
    botSellPrice: number;
    botProfitUsd: number;
    victimPriceWithBot: number;
    victimPriceWithoutBot: number;
    victimExtraCostUsd: number;
  };
  sequential: { botProfitUsd: number; victimExtraCostUsd: number; victimSlippageBps: number };
  /** How the two arms were measured — shown so the comparison is auditable. */
  methodology: string;
  headline: string;
}

/** POST /demo/sealed — REAL privacy from the operator via drand timelock. */
export interface SealedDemo {
  marketId: string;
  symbol: string;
  indexPrice: number;
  drand: { network: string; currentRound: number; periodSec: number };
  sealed: {
    targetRound: number;
    secondsUntilOpen: number;
    commitment: string;
    ciphertextPreview: string;
    ciphertextBytes: number;
    operatorCanReadNow: false;
    blindReason: string;
  };
  epoch: {
    orders: Array<{ label: string; side: Side; sizeBase: number; commitment: string }>;
    clearingPrice: number;
    netImbalanceBase: number;
    membershipRoot: string;
    allAtOnePrice: true;
  };
  attack: { botProfitUsd: number };
  headline: string;
}

// ─── fetch plumbing ───────────────────────────────────────────────────────────

export class OperatorError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OperatorError";
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OPERATOR}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    });
  } catch (e) {
    throw new OperatorError(`operator unreachable at ${OPERATOR}`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new OperatorError(
      typeof body?.error === "string" ? body.error : `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

const get = <T>(path: string) => req<T>(path);
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

// ─── wallet-signature auth ────────────────────────────────────────────────────
// The connected wallet signs each value-moving request; the operator verifies the
// signature is fresh, non-replayable, and bound to the acting address. The message
// format must byte-match the server (auth.ts:authMessage).
export interface DataSignature { signature: string; key: string }
export interface AuthEnvelope { signer: string; ts: number; sig: DataSignature }
export type WalletSigner = (action: string, params: Record<string, unknown>) => Promise<AuthEnvelope>;

let _signer: WalletSigner | null = null;
/** Called by the wallet provider once connected; cleared on disconnect. */
export function setWalletSigner(fn: WalletSigner | null) { _signer = fn; }

function toHex(s: string): string {
  return Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Canonical message the wallet signs — MUST match server auth.ts:authMessage. */
export function authMessage(action: string, params: Record<string, unknown>, ts: number): string {
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  return `dorr:${action}\n${canonical}\nts:${ts}`;
}
/** Build a signer from a connected Mesh wallet + its bech32 address. */
/**
 * EVM wallet signer (EIP-191 personal_sign) — dorr settles on Flare, so the
 * identity that authorises a value-moving call is an EVM account. The signed
 * message is byte-identical to what the operator reconstructs, so the server can
 * recover the signer and reject anything it can't attribute to the acting address.
 */
export function evmSigner(
  walletClient: { signMessage: (args: { account: `0x${string}`; message: string }) => Promise<string> },
  address: string,
): WalletSigner {
  return async (action, params) => {
    const ts = Date.now();
    const message = authMessage(action, params, ts);
    const signature = await walletClient.signMessage({
      account: address as `0x${string}`,
      message,
    });
    // `key` is unused for EVM (the address is recoverable from the signature);
    // kept so the envelope shape stays stable across wallet backends.
    return { signer: address, ts, sig: { signature, key: "" } };
  };
}

/** POST a value-moving action, attaching a wallet signature when a signer is set. */
async function postSigned<T>(path: string, action: string, params: Record<string, unknown>): Promise<T> {
  const auth = _signer ? await _signer(action, params) : undefined;
  return post<T>(path, { ...params, ...(auth ? { auth } : {}) });
}

// ─── endpoints ────────────────────────────────────────────────────────────────

export const operator = {
  health: () => get<Health>("/health"),

  markets: async () => (await get<{ markets: Market[] }>("/markets")).markets,

  vaultInfo: (address?: string) =>
    get<VaultInfo>(`/vault/info${address ? `?address=${encodeURIComponent(address)}` : ""}`),

  faucet: (address: string, amount?: number) =>
    post<FaucetResult>("/faucet", { address, ...(amount ? { amount } : {}) }),

  account: (address: string) => get<Account>(`/account/${encodeURIComponent(address)}`),

  syncDeposits: (address: string) => post<DepositSyncResult>("/deposits/sync", { address }),

  withdraw: (address: string, amount: number) =>
    postSigned<WithdrawResult>("/withdraw", "withdraw", { address, amount }),

  commitOrder: (p: {
    address: string;
    marketId: string;
    side: Side;
    marginUsd: number;
    leverage: number;
    privacyMode: PrivacyMode;
    orderType?: OrderType;
    limitPrice?: number;
    maxSlippageBps?: number;
  }) => {
    // Byte-match the server's reconstructed params (routes.ts:/orders/commit):
    // orderType is always present; limitPrice/maxSlippageBps only when supplied.
    const params: Record<string, unknown> = {
      address: p.address,
      marketId: p.marketId,
      side: p.side,
      marginUsd: p.marginUsd,
      leverage: p.leverage,
      privacyMode: p.privacyMode,
      orderType: p.orderType === "limit" ? "limit" : "market",
      ...(p.limitPrice != null ? { limitPrice: Number(p.limitPrice) } : {}),
      ...(p.maxSlippageBps != null ? { maxSlippageBps: Number(p.maxSlippageBps) } : {}),
    };
    return postSigned<CommitResult>("/orders/commit", "commit", params);
  },

  executeOrder: (orderId: string) =>
    postSigned<ExecuteResult>(`/orders/${encodeURIComponent(orderId)}/execute`, "execute", { orderId }),

  /** Cancel a resting (committed) order — releases its locked margin. Owner-signed. */
  cancelOrder: (orderId: string) =>
    postSigned<{ success: boolean; order: Order }>(
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      "cancel",
      { orderId },
    ),

  order: (orderId: string) => get<Order>(`/orders/${encodeURIComponent(orderId)}`),

  positions: async (address: string) =>
    (await get<{ positions: Position[] }>(`/positions/${encodeURIComponent(address)}`)).positions,

  /** Close all (fraction=1) or part (0<fraction<1) of a position. */
  closePosition: (positionId: string, fraction = 1) =>
    postSigned<ExecuteResult>(`/positions/${encodeURIComponent(positionId)}/close`, "close", {
      positionId,
      fraction,
    }),

  /** Add (delta>0) or remove (delta<0) margin on an open position. */
  adjustMargin: (positionId: string, delta: number) =>
    postSigned<{ position: Position }>(`/positions/${encodeURIComponent(positionId)}/margin`, "margin", {
      positionId,
      delta,
    }),

  /**
   * Set/clear the hidden stop-loss & take-profit. A number sets, `null` clears,
   * omitting a field leaves it unchanged. Params are byte-matched to the server
   * (routes.ts:/positions/:id/stops) so the wallet signature validates.
   */
  setStops: (
    positionId: string,
    stops: { stopLoss?: number | null; takeProfit?: number | null },
  ) => {
    // Mirror the server: null → null, number → Number(...), absent → undefined.
    // JSON.stringify drops undefined-valued keys, so the canonical message matches.
    const normalized = {
      stopLoss: stops.stopLoss === null ? null : stops.stopLoss != null ? Number(stops.stopLoss) : undefined,
      takeProfit:
        stops.takeProfit === null ? null : stops.takeProfit != null ? Number(stops.takeProfit) : undefined,
    };
    return postSigned<{ position: Position }>(
      `/positions/${encodeURIComponent(positionId)}/stops`,
      "stops",
      { positionId, ...normalized },
    );
  },

  /** The connected wallet's private resting limit orders (hidden from the public feed). */
  restingOrders: async (address: string) =>
    (await get<{ orders: RestingOrder[] }>(`/orders/resting/${encodeURIComponent(address)}`)).orders,

  job: (jobId: string) => get<Job>(`/jobs/${encodeURIComponent(jobId)}`),

  feed: async () => (await get<{ feed: FeedEntry[] }>("/feed")).feed,

  anchors: async () => (await get<{ anchors: Anchor[] }>("/anchors")).anchors,

  abDemo: (p: { marketId: string; side: Side; marginUsd: number; leverage: number }) =>
    post<AbDemo>("/demo/ab", p),

  /** MEV attack lab — same sandwich attack run against a public DEX and dorr. */
  runAttack: (p: { marketId: string; side: Side; marginUsd: number; leverage: number }) =>
    post<AttackLab>("/demo/attack", p),

  /** Batch auction demo — a sandwich nets $0 under uniform-price clearing. */
  batchDemo: (p: { marketId: string; side?: Side; marginUsd?: number; leverage?: number }) =>
    post<BatchDemo>("/demo/batch", p),

  /** Sealed-bid demo — the operator is timelock-blind until the drand round lands. */
  sealedDemo: (p: { marketId: string; side?: Side; marginUsd?: number; leverage?: number }) =>
    post<SealedDemo>("/demo/sealed", p),

  /** Current drand epoch — the round new sealed orders should target. */
  batchEpoch: () =>
    get<{ drandNetwork: string; currentRound: number; epochCloseRound: number; secondsToClose: number }>("/batch/epoch"),

  /** Submit a client-SEALED order — the operator stores ciphertext it can't read. */
  sealOrder: async (p: {
    address: string;
    marketId: string;
    commitment: string;
    ciphertext: string;
    targetRound: number;
    maxMarginUsd: number;
  }) => {
    // owner-signed over {commitment, targetRound} to match the server (routes:/orders/seal)
    const auth = _signer ? await _signer("seal", { commitment: p.commitment, targetRound: p.targetRound }) : undefined;
    return post<{ success: boolean; id: string; epochId: string; targetRound: number }>("/orders/seal", {
      ...p,
      ...(auth ? { auth } : {}),
    });
  },

  /** Exchange telemetry — per-market OI/skew/funding + global TVL/volume. */
  stats: () => get<Stats>("/stats"),

  /** Proof of solvency — on-chain vault reserves vs credited liabilities. */
  solvency: () => get<Solvency>("/ops/solvency"),

  /** Flare settlement layer: contracts, FXRP collateral, oracle, enclave. */
  flareInfo: () =>
    get<{
      network: string;
      chainId: number;
      explorer: string;
      contracts: { vault: string; settlement: string; teeVerifier: string; ftsoV2: string };
      collateral: { symbol: string; address: string; decimals: number; totalSupply: number };
      solvency: { solvent: boolean; reservesFxrp: number; liabilitiesFxrp: number };
      enclave: { configured: boolean; signer?: string; teeId?: string; measurement?: string };
      batchesSettled: number;
    }>("/flare/info"),

  /** The trader's own activity timeline (all events when no address). */
  events: async (address?: string) =>
    (await get<{ events: DorrEvent[] }>(`/events${address ? `?address=${encodeURIComponent(address)}` : ""}`))
      .events,

  /**
   * Open a hidden order to a chosen audience. Signs `{ orderId, audience }` so
   * only the order's owner can disclose it (byte-matched to routes.ts:/disclose).
   */
  disclose: async (orderId: string, audience: string) =>
    (await postSigned<{ success: boolean; disclosure: Disclosure }>("/disclose", "disclose", {
      orderId,
      audience: audience || "auditor",
    })).disclosure,

  /** Verify a disclosure you were handed against its on-chain commitment (no auth). */
  verifyDisclosure: (disclosure: Disclosure) =>
    post<DisclosureVerdict>("/disclose/verify", { disclosure }),
};
