/**
 * Operator state — the authoritative off-chain ledger (v1 trusted-operator model).
 * JSON-persisted with atomic writes; engine modules provide the math,
 * this store owns the facts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DORR_ROOT } from "./env.js";

export type Side = "LONG" | "SHORT";
export type PrivacyMode = "private" | "public";

export interface Account {
  address: string;
  /** FXRP margin credited from on-chain vault deposits, ± realized PnL (free + locked). */
  balance: number;
  locked: number;
  /**
   * Realized PnL (net of fees and funding) accumulated off-chain by the vAMM.
   *
   * Collateral itself is never tracked here — it lives in the DorrVault, which
   * is the only thing that can move FXRP. The tradable balance is re-derived on
   * every reconciliation as `vault.balanceOf(trader) + pnlCum`, so a deposit is
   * always spendable and a lost/blank ledger can never strand real collateral.
   */
  pnlCum?: number;
}

export interface DorrOrder {
  id: string;
  address: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  leverage: number;
  marginUsd: number;
  /** market fills immediately on execute; limit rests until the keeper triggers it. */
  orderType: "market" | "limit";
  /** limit trigger price (hidden — part of the commitment preimage). */
  limitPrice?: number;
  /** reject a fill whose realized slippage vs reference exceeds this (bps). */
  maxSlippageBps?: number;
  /** Index price captured at commit time — part of the commitment preimage. */
  commitPrice: number;
  privacyMode: PrivacyMode;
  nonce: string;
  commitmentHash: string;
  status: "committed" | "executed" | "cancelled" | "failed";
  createdAt: string;
  executedFill?: { avgPrice: number; priceImpactBps: number; notional: number };
}

export interface DorrPosition {
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
  /** hidden protective triggers — never public; the keeper closes when Pyth crosses. */
  stopLossPrice?: number;
  takeProfitPrice?: number;
  /** accumulates across partial closes. */
  realizedPnlCum?: number;
  positionNft?: { unit: string; txHash: string };
  closedAt?: string;
  exitPrice?: number;
  realizedPnl?: number;
  closeReason?: "close" | "liquidated" | "stop-loss" | "take-profit";
  settlement?: {
    settlementId?: string;
    /** SHA-256(orderCommitment ‖ closeRecord) — proves what settled without revealing it. */
    settlementDigest?: string;
    /** Set when the position settled as part of an on-chain sealed batch. */
    batchEpochId?: string;
    batchTx?: string;
  };
}

/**
 * A timelock-SEALED order — the operator holds only ciphertext + a commitment and
 * cannot read the contents until the epoch's drand round lands. `maxMarginUsd` is
 * the publicly-locked upper bound (only a bound leaks; exact size/side/price stay
 * sealed). Settled in a uniform-price batch once decryptable.
 */
export interface SealedOrder {
  id: string;
  address: string;
  marketId: string;
  /** public — H(contents); anchorable before any key exists */
  commitment: string;
  /** tlock/AGE ciphertext — undecryptable until `targetRound` */
  ciphertext: string;
  /** drand quicknet round whose beacon unseals this order (the epoch close) */
  targetRound: number;
  epochId: string;
  /** locked upper bound on margin; the sealed order's true margin must be ≤ this */
  maxMarginUsd: number;
  status: "sealed" | "cleared" | "dropped";
  createdAt: string;
  positionId?: string;
  clearingPrice?: number;
  droppedReason?: string;
  settledAt?: string;
}

export interface Job {
  id: string;
  kind: "commit" | "execute" | "close" | "faucet" | "withdraw";
  refId: string;
  status: "running" | "complete" | "error";
  steps: Array<{ label: string; status: "running" | "complete" | "error"; detail?: string; txHash?: string; ms?: number }>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface FeedEntry {
  at: string;
  marketId: string;
  privacyMode: PrivacyMode;
  /** private mode: only the commitment hash is public. */
  commitmentHash: string;
  /** public mode leaks everything (the A/B foil). */
  leaked?: { side: Side; sizeBase: number; leverage: number; address: string };
}

export type EventType =
  | "commit" | "limit-rest" | "execute" | "limit-fill" | "cancel"
  | "seal" | "batch-settle"
  | "close" | "partial-close" | "stop-loss" | "take-profit" | "liquidated"
  | "margin" | "stops-set" | "anchor" | "deposit" | "withdraw" | "disclose";

export interface DorrEvent {
  at: string;
  type: EventType;
  address?: string;
  marketId?: string;
  /** human-readable line for the activity log. */
  detail: string;
  txHash?: string;
  /** which chain the tx is on (for explorer links). */
  chain?: "flare-coston2";
}

export interface StateFile {
  accounts: Record<string, Account>;
  orders: DorrOrder[];
  positions: DorrPosition[];
  sealedOrders: SealedOrder[];
  jobs: Job[];
  feed: FeedEntry[];
  events: DorrEvent[];
  anchors: Array<{ settlementId: string; txHash: string; commitmentHex: string; at: string }>;
  insuranceFundUsd: number;
  fundingHistory: Array<{ marketId: string; rate: number; markPrice: number; indexPrice: number; at: string }>;
  /**
   * 1-minute OHLC built from the FTSO v2 samples this operator actually read,
   * keyed by marketId. This is what the chart draws: the same feed that prices
   * fills and that the settlement contract re-reads — not a third-party price
   * API. Persisted so history survives a restart; trimmed to CANDLE_CAP.
   */
  candles: Record<string, Array<{ t: number; o: number; h: number; l: number; c: number }>>;
}

const DATA_DIR = resolve(DORR_ROOT, "services/operator/data");

/**
 * Where the ledger lives.
 *
 * The test suite drives the real routes in-process — including `/demo/reset`,
 * which wipes accounts, positions and anchors. Pointed at the default file that
 * would destroy a running operator's state, so tests get their own file. Set
 * DORR_STATE_PATH to override explicitly.
 */
const STATE_PATH = process.env.DORR_STATE_PATH
  ? resolve(process.env.DORR_STATE_PATH)
  : resolve(DATA_DIR, process.env.NODE_ENV === "test" ? "state.test.json" : "state.json");

const empty = (): StateFile => ({
  accounts: {},
  orders: [],
  positions: [],
  sealedOrders: [],
  jobs: [],
  feed: [],
  events: [],
  anchors: [],
  insuranceFundUsd: 0,
  fundingHistory: [],
  candles: {},
});

/** Keep ~24h of 1-minute bars per market. */
const CANDLE_CAP = 1_440;

/**
 * Fold an FTSO sample into the market's 1-minute OHLC series. Called on every
 * poll; opens a new bar when the minute rolls over, otherwise extends the
 * current one. Cheap enough to run per-tick and the only source the chart needs.
 */
export function recordPriceSample(marketId: string, price: number, atMs: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const minute = Math.floor(atMs / 60_000) * 60; // bar time, seconds
  const series = (state.candles[marketId] ??= []);

  // Fast path: extending the newest bar, which is what live polling always does.
  const last = series[series.length - 1];
  if (last && last.t === minute) {
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    last.c = price;
    return;
  }
  if (!last || minute > last.t) {
    series.push({ t: minute, o: price, h: price, l: price, c: price });
    if (series.length > CANDLE_CAP) series.splice(0, series.length - CANDLE_CAP);
    return;
  }

  // Out-of-order sample — this is the archive backfill filling in minutes that
  // predate what live polling already recorded. The series MUST stay sorted:
  // consumers aggregate by walking it, so an unsorted array collapses every bar
  // into whichever bucket happens to be adjacent.
  let lo = 0;
  let hi = series.length; // first index with t >= minute
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < minute) lo = mid + 1;
    else hi = mid;
  }
  const at = series[lo];
  if (at && at.t === minute) {
    at.h = Math.max(at.h, price);
    at.l = Math.min(at.l, price);
    at.c = price;
    return;
  }
  series.splice(lo, 0, { t: minute, o: price, h: price, l: price, c: price });
  if (series.length > CANDLE_CAP) series.splice(0, series.length - CANDLE_CAP);
}

let state: StateFile = empty();

export function loadState(): StateFile {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(STATE_PATH)) {
    state = { ...empty(), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
  }
  return state;
}

export function getState(): StateFile {
  return state;
}

/** Atomic persist (write temp, rename). Call after every mutation. */
export function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

/** Append to the activity log (keeps the last 500) and persist. */
export function logEvent(e: Omit<DorrEvent, "at"> & { at?: string }): void {
  const { at, ...rest } = e;
  state.events.push({ at: at ?? new Date().toISOString(), ...rest });
  if (state.events.length > 500) state.events = state.events.slice(-500);
  persist();
}

export function account(address: string): Account {
  if (!state.accounts[address]) {
    state.accounts[address] = { address, balance: 0, locked: 0 };
  }
  return state.accounts[address];
}
