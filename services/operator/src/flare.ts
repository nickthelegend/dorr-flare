/**
 * Flare EVM client — FXRP collateral vault + on-chain batch settlement.
 *
 * This is dorr's settlement layer on Flare. It replaces the previous Cardano
 * tx layer:
 *   • collateral is FXRP (Flare FAssets) held in `DorrVault`, which only the
 *     depositor can withdraw from;
 *   • a cleared sealed-bid epoch is settled by `DorrBatchSettlement`, which
 *     independently re-reads the FTSO price on-chain and reverts if the
 *     operator's clearing price is out of band.
 *
 * Every write here is a real signed transaction on Flare (Coston2 by default).
 * There is no simulated path.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

export const flareChain = defineChain({
  id: env.flare.chainId,
  name: env.flare.chainId === 114 ? "Flare Coston2" : `Flare ${env.flare.chainId}`,
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [env.flare.rpcUrl] } },
  blockExplorers: { default: { name: "Flare Explorer", url: env.flare.explorer } },
});

export const FXRP_DECIMALS = 6;
export const usdToUnits = (v: number): bigint => BigInt(Math.round(v * 10 ** FXRP_DECIMALS));
export const unitsToUsd = (v: bigint): number => Number(v) / 10 ** FXRP_DECIMALS;

const ERC20_ABI = [
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalSupply", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "trader", type: "address" }], name: "accountOf", outputs: [{ name: "balance", type: "uint256" }, { name: "locked", type: "uint256" }, { name: "free", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "trader", type: "address" }], name: "freeBalanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "reserves", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalInternal", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "isSolvent", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "fxrp", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "settlement", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

const SETTLEMENT_ABI = [
  {
    inputs: [
      {
        name: "b",
        type: "tuple",
        components: [
          { name: "epochId", type: "bytes32" },
          { name: "membershipRoot", type: "bytes32" },
          { name: "clearingPrice", type: "uint256" },
          { name: "feedId", type: "bytes21" },
          { name: "orderCount", type: "uint32" },
          { name: "traders", type: "address[]" },
          { name: "deltas", type: "int256[]" },
          { name: "attestation", type: "bytes" },
        ],
      },
    ],
    name: "settleBatch",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "epochId", type: "bytes32" }],
    name: "getBatch",
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "membershipRoot", type: "bytes32" },
          { name: "clearingPrice", type: "uint256" },
          { name: "ftsoPrice", type: "uint256" },
          { name: "ftsoTimestamp", type: "uint64" },
          { name: "settledAt", type: "uint64" },
          { name: "orderCount", type: "uint32" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  { inputs: [], name: "epochCount", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "maxDriftBps", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "trader", type: "address" }, { name: "amount", type: "uint256" }],
    name: "lockMargin", outputs: [], stateMutability: "nonpayable", type: "function",
  },
  {
    inputs: [{ name: "trader", type: "address" }, { name: "amount", type: "uint256" }],
    name: "releaseMargin", outputs: [], stateMutability: "nonpayable", type: "function",
  },
] as const;

let _public: PublicClient | null = null;
let _wallet: WalletClient | null = null;

export function publicClient(): PublicClient {
  if (!_public) {
    _public = createPublicClient({ chain: flareChain, transport: http(env.flare.rpcUrl) }) as PublicClient;
  }
  return _public;
}

/** The relayer that pays gas to submit settlements. */
export function relayer() {
  if (!env.flare.relayerKey) throw new Error("FLARE_RELAYER_KEY not configured");
  return privateKeyToAccount(env.flare.relayerKey as Hex);
}

export function walletClient(): WalletClient {
  if (!_wallet) {
    _wallet = createWalletClient({ account: relayer(), chain: flareChain, transport: http(env.flare.rpcUrl) });
  }
  return _wallet;
}

/**
 * Serialize every write from the relayer account.
 *
 * All on-chain writes share one relayer key, and viem reads the pending nonce
 * per call. Two writes issued close together — a partial close releasing margin
 * and a margin top-up locking it, say — both read the same nonce and the second
 * is rejected by the node ("Missing or invalid parameters"). Chaining them means
 * the next write only builds its transaction once the previous one has a
 * receipt, so nonces are strictly sequential.
 */
let relayerQueue: Promise<unknown> = Promise.resolve();

function withRelayer<T>(fn: () => Promise<T>): Promise<T> {
  const run = relayerQueue.then(fn, fn);
  // Keep the chain alive even when a write fails, or one rejection would
  // permanently wedge every later transaction.
  relayerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function flareConfigured(): boolean {
  return Boolean(env.flare.vault && env.flare.settlement);
}

export const vaultAddress = (): Address => getAddress(env.flare.vault);
export const settlementAddress = (): Address => getAddress(env.flare.settlement);
export const fxrpAddress = (): Address => getAddress(env.flare.fxrp);

export const explorerTx = (h: string) => `${env.flare.explorer}/tx/${h}`;
export const explorerAddress = (a: string) => `${env.flare.explorer}/address/${a}`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VaultAccount {
  balance: number;
  locked: number;
  free: number;
}

/** A trader's on-chain FXRP margin account. */
export async function vaultAccount(trader: string): Promise<VaultAccount> {
  const [balance, locked, free] = (await publicClient().readContract({
    address: vaultAddress(),
    abi: VAULT_ABI,
    functionName: "accountOf",
    args: [getAddress(trader)],
  })) as [bigint, bigint, bigint];
  return { balance: unitsToUsd(balance), locked: unitsToUsd(locked), free: unitsToUsd(free) };
}

/** Real on-chain FXRP backing vs credited balances — proof of solvency. */
export async function vaultSolvency(): Promise<{
  reservesFxrp: number;
  liabilitiesFxrp: number;
  solvent: boolean;
  collateralizationRatio: number | null;
  vaultAddress: string;
  fxrpAddress: string;
}> {
  const pc = publicClient();
  const [reserves, totalInternal, solvent] = await Promise.all([
    pc.readContract({ address: vaultAddress(), abi: VAULT_ABI, functionName: "reserves" }) as Promise<bigint>,
    pc.readContract({ address: vaultAddress(), abi: VAULT_ABI, functionName: "totalInternal" }) as Promise<bigint>,
    pc.readContract({ address: vaultAddress(), abi: VAULT_ABI, functionName: "isSolvent" }) as Promise<boolean>,
  ]);
  const r = unitsToUsd(reserves);
  const l = unitsToUsd(totalInternal);
  return {
    reservesFxrp: r,
    liabilitiesFxrp: l,
    solvent,
    collateralizationRatio: l > 0 ? r / l : null,
    vaultAddress: vaultAddress(),
    fxrpAddress: fxrpAddress(),
  };
}

export async function fxrpInfo(): Promise<{ address: string; symbol: string; decimals: number; totalSupply: number }> {
  const pc = publicClient();
  const a = fxrpAddress();
  const [symbol, decimals, totalSupply] = await Promise.all([
    pc.readContract({ address: a, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
    pc.readContract({ address: a, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    pc.readContract({ address: a, abi: ERC20_ABI, functionName: "totalSupply" }) as Promise<bigint>,
  ]);
  return { address: a, symbol, decimals, totalSupply: Number(totalSupply) / 10 ** decimals };
}

export async function fxrpBalanceOf(who: string): Promise<number> {
  const bal = (await publicClient().readContract({
    address: fxrpAddress(),
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [getAddress(who)],
  })) as bigint;
  return unitsToUsd(bal);
}

export async function getBatchOnChain(epochId: Hex) {
  const b = (await publicClient().readContract({
    address: settlementAddress(),
    abi: SETTLEMENT_ABI,
    functionName: "getBatch",
    args: [epochId],
  })) as {
    membershipRoot: Hex;
    clearingPrice: bigint;
    ftsoPrice: bigint;
    ftsoTimestamp: bigint;
    settledAt: bigint;
    orderCount: number;
    exists: boolean;
  };
  return {
    exists: b.exists,
    membershipRoot: b.membershipRoot,
    clearingPrice: unitsToUsd(b.clearingPrice),
    ftsoPrice: unitsToUsd(b.ftsoPrice),
    ftsoTimestamp: Number(b.ftsoTimestamp),
    settledAt: Number(b.settledAt),
    orderCount: b.orderCount,
  };
}

export async function epochCount(): Promise<number> {
  const n = (await publicClient().readContract({
    address: settlementAddress(),
    abi: SETTLEMENT_ABI,
    functionName: "epochCount",
  })) as bigint;
  return Number(n);
}

// ---------------------------------------------------------------------------
// Write: settle a cleared epoch on-chain
// ---------------------------------------------------------------------------

export interface SettleBatchParams {
  epochId: Hex;
  membershipRoot: Hex;
  /** Uniform clearing price, 1e6 fixed point. */
  clearingPrice: bigint;
  /** FTSO v2 feed id for the market. */
  feedId: Hex;
  orderCount: number;
  traders: Address[];
  /** Zero-sum PnL in FXRP base units (6dp). */
  deltas: bigint[];
  attestation: Hex;
  /** Native value forwarded to cover any FTSO feed fee (refunded if unused). */
  feeWei?: bigint;
}

/**
 * Submit a cleared epoch to Flare. Reverts on-chain if the clearing price is out
 * of band with FTSO, if the enclave quote doesn't verify, or if the PnL isn't
 * zero-sum — those are the guarantees, enforced by the chain rather than by us.
 */
export async function settleBatchOnChain(p: SettleBatchParams): Promise<{ txHash: Hex; explorerUrl: string }> {
  if (!flareConfigured()) throw new Error("Flare contracts not configured");
  const wc = walletClient();
  const account = relayer();

  const txHash = await withRelayer(() => wc.writeContract({
    address: settlementAddress(),
    abi: SETTLEMENT_ABI,
    functionName: "settleBatch",
    args: [
      {
        epochId: p.epochId,
        membershipRoot: p.membershipRoot,
        clearingPrice: p.clearingPrice,
        feedId: p.feedId,
        orderCount: p.orderCount,
        traders: p.traders,
        deltas: p.deltas,
        attestation: p.attestation,
      },
    ],
    value: p.feeWei ?? 0n,
    account,
    chain: flareChain,
  }));

  await publicClient().waitForTransactionReceipt({ hash: txHash });
  return { txHash, explorerUrl: explorerTx(txHash) };
}

/** Relayer's native balance (gas headroom). */
export async function relayerBalance(): Promise<{ address: string; c2flr: number }> {
  const a = relayer().address;
  const bal = await publicClient().getBalance({ address: a });
  return { address: a, c2flr: Number(bal) / 1e18 };
}

/**
 * Make the vault's on-chain `locked` match the operator's ledger for one trader.
 *
 * This is what stops a trader withdrawing collateral that backs their own open
 * position: the vault refuses a withdrawal above `balance - locked`, so the
 * margin has to actually be locked *on-chain*, not merely recorded off-chain.
 *
 * Written as a reconciler rather than a call bolted onto each of the eight
 * places margin moves: it is idempotent, it repairs drift from a failed or
 * dropped transaction on the next call, and it can't wedge the trading path.
 * Callers await it when margin is *increasing* (the safety-critical direction)
 * and can fire it and forget when margin is being released.
 *
 * Returns the signed delta applied on-chain, or 0 when already in sync.
 */
export async function syncLockedMargin(trader: string, desiredLockedUsd: number): Promise<number> {
  if (!flareConfigured()) return 0;
  // Only an EVM account can hold a vault position; anything else (a test
  // fixture, a legacy identifier) has nothing on-chain to reserve.
  if (!/^0x[0-9a-fA-F]{40}$/.test(trader)) return 0;
  const who = getAddress(trader);
  const onChain = await vaultAccount(who);

  const desired = usdToUnits(Math.max(0, desiredLockedUsd));
  const current = usdToUnits(onChain.locked);
  if (desired === current) return 0;

  const wc = walletClient();
  const account = relayer();
  const increasing = desired > current;
  const amount = increasing ? desired - current : current - desired;

  await withRelayer(async () => {
    const txHash = await wc.writeContract({
      address: settlementAddress(),
      abi: SETTLEMENT_ABI,
      functionName: increasing ? "lockMargin" : "releaseMargin",
      args: [who, amount],
      account,
      chain: flareChain,
    });
    await publicClient().waitForTransactionReceipt({ hash: txHash });
  });
  return unitsToUsd(increasing ? amount : -amount);
}
