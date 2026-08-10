/**
 * FTSO v2 price feeds — Flare's native on-chain oracle.
 *
 * This replaces the previous off-chain Pyth Hermes HTTP feed. Prices are now read
 * from the FTSO v2 contract on Flare via `eth_call`, resolved through Flare's
 * ContractRegistry so no address is ever hardcoded (the registry is the single
 * stable entry point Flare guarantees).
 *
 * The same prices are independently re-read ON-CHAIN by DorrBatchSettlement when a
 * batch settles, so the operator cannot settle at a price the oracle disagrees
 * with. This module and that contract are two views of one source of truth.
 *
 * The exported surface is intentionally identical to the module it replaced so the
 * trading engine, routes and the web app are unaffected by the migration.
 */
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { env } from "./env.js";
import { MARKETS } from "./markets.js";

/** Flare's ContractRegistry — the same address on every Flare network. */
export const CONTRACT_REGISTRY: Address = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

const REGISTRY_ABI = [
  {
    inputs: [{ name: "_name", type: "string" }],
    name: "getContractAddressByName",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * `getFeedById` is declared `payable` on-chain (feeds may carry a fee), but a
 * read-only `eth_call` needs no fee and no state change, so we describe it as
 * `view` locally to read it for free.
 */
const FTSO_ABI = [
  {
    inputs: [{ name: "_feedId", type: "bytes21" }],
    name: "getFeedById",
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface FtsoPrice {
  feedId: string;
  price: number;
  /** FTSO does not publish a confidence interval; kept for interface parity. */
  conf: number;
  publishTime: number;
  fetchedAt: number;
}

const latest = new Map<string, FtsoPrice>();
const disabledFeeds = new Set<string>();

let client: PublicClient | null = null;
let ftsoAddress: Address | null = null;

const norm = (id: string) => id.toLowerCase();

function publicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(env.flare.rpcUrl) }) as PublicClient;
  }
  return client;
}

/** Resolve the FTSO v2 address from Flare's ContractRegistry (never hardcoded). */
export async function resolveFtsoAddress(): Promise<Address> {
  if (ftsoAddress) return ftsoAddress;
  const addr = (await publicClient().readContract({
    address: CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  })) as Address;
  if (!addr || addr === "0x0000000000000000000000000000000000000000") {
    throw new Error("ContractRegistry returned no FtsoV2 address");
  }
  ftsoAddress = addr;
  return addr;
}

/** Read one feed straight from the on-chain oracle. */
export async function readFeed(feedId: string): Promise<FtsoPrice> {
  const ftso = await resolveFtsoAddress();
  const [value, decimals, timestamp] = (await publicClient().readContract({
    address: ftso,
    abi: FTSO_ABI,
    functionName: "getFeedById",
    args: [feedId as `0x${string}`],
  })) as [bigint, number, bigint];

  const price = Number(value) / 10 ** Number(decimals);
  return {
    feedId: norm(feedId),
    price,
    conf: 0,
    publishTime: Number(timestamp),
    fetchedAt: Date.now(),
  };
}

export async function pollOnce(): Promise<void> {
  const feeds = MARKETS.filter((m) => !disabledFeeds.has(norm(m.feedId)));
  await Promise.all(
    feeds.map(async (m) => {
      try {
        latest.set(norm(m.feedId), await readFeed(m.feedId));
      } catch (e) {
        console.error(`[ftso] read failed for ${m.symbol}: ${String(e).slice(0, 140)}`);
      }
    }),
  );
}

/** Validate every configured feed against the on-chain oracle at boot. */
export async function validateFeeds(): Promise<void> {
  const ftso = await resolveFtsoAddress().catch((e) => {
    console.error(`[ftso] registry lookup failed: ${String(e).slice(0, 160)}`);
    return null;
  });
  if (!ftso) {
    for (const m of MARKETS) disabledFeeds.add(norm(m.feedId));
    return;
  }
  console.log(`[ftso] FtsoV2 @ ${ftso} (via ContractRegistry, chain ${env.flare.chainId})`);

  for (const m of MARKETS) {
    try {
      const p = await readFeed(m.feedId);
      if (!(p.price > 0)) throw new Error("zero price");
      latest.set(norm(m.feedId), p);
      console.log(`[ftso] ${m.symbol} feed ok — $${p.price.toFixed(6)}`);
    } catch (e) {
      disabledFeeds.add(norm(m.feedId));
      console.error(`[ftso] FEED FAILED for ${m.symbol} (${m.feedId}): ${String(e).slice(0, 140)} — market disabled`);
    }
  }
}

export function getPrice(feedId: string): FtsoPrice | undefined {
  return latest.get(norm(feedId));
}

/** TEST-ONLY: inject a deterministic price without touching the network. */
export function _setPriceForTest(feedId: string, price: number): void {
  latest.set(norm(feedId), {
    feedId: norm(feedId),
    price,
    conf: 0,
    publishTime: Math.floor(Date.now() / 1000),
    fetchedAt: Date.now(),
  });
}

export function isFeedDisabled(feedId: string): boolean {
  return disabledFeeds.has(norm(feedId));
}

export function startPricePolling(): void {
  const tick = () =>
    pollOnce().catch((e) => console.error(`[ftso] poll error: ${String(e).slice(0, 200)}`));
  void tick();
  setInterval(tick, env.flare.pollMs);
}
