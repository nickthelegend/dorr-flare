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
  /** dUSD credited from on-chain vault deposits (free + locked). */
  balance: number;
  locked: number;
  /** vault deposit txs already credited (idempotency). */
  creditedUtxos: string[];
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
  midnight?: {
    contractAddress?: string;
    deployTx?: string;
    authorityProofTx?: string;
    anchorBindTx?: string;
    matchProofTx?: string;
  };
  /** Optional Cardano L1 proof-of-existence for the commitment (public, hides contents). */
  commitAnchor?: { txHash: string; at: string };
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
    midnightSettlementTx?: string;
    cardanoAnchorTx?: string;
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
  chain?: "cardano" | "midnight";
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
}

const DATA_DIR = resolve(DORR_ROOT, "services/operator/data");
const STATE_PATH = resolve(DATA_DIR, "state.json");

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
});

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
    state.accounts[address] = { address, balance: 0, locked: 0, creditedUtxos: [] };
  }
  return state.accounts[address];
}
