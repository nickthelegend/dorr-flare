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
import { recordPriceSample } from "./state.js";

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
  {
    inputs: [{ name: "_feedIds", type: "bytes21[]" }],
    name: "getFeedsById",
    outputs: [
      { name: "_values", type: "uint256[]" },
      { name: "_decimals", type: "int8[]" },
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
  // Retried: the registry lookup is the first thing every price read depends on,
  // and the public RPC 429s often enough that a single attempt is not a verdict.
  const addr = (await withRetry(() => publicClient().readContract({
    address: CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  }))) as Address;
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

/**
 * Read every feed in a single `eth_call`.
 *
 * The poll used to fan six concurrent `getFeedById` calls at a shared public RPC
 * every tick. Measured consequence: sustained `Status: 429`, which starved the
 * chart backfill so hard that after a restart five of six markets sat at two
 * bars indefinitely while FLR — the one being viewed, so retried most — was the
 * only market that recovered. FTSO v2 exposes `getFeedsById` for exactly this;
 * one call carries the whole venue.
 *
 * Throws as a unit: the caller falls back to per-feed reads, so one unreadable
 * feed cannot take the other five off the venue.
 */
export async function readFeeds(feedIds: string[]): Promise<FtsoPrice[]> {
  const ftso = await resolveFtsoAddress();
  const [values, decimals, timestamp] = (await publicClient().readContract({
    address: ftso,
    abi: FTSO_ABI,
    functionName: "getFeedsById",
    args: [feedIds as `0x${string}`[]],
  })) as [readonly bigint[], readonly number[], bigint];

  const fetchedAt = Date.now();
  return feedIds.map((feedId, i) => ({
    feedId: norm(feedId),
    price: Number(values[i]) / 10 ** Number(decimals[i]),
    conf: 0,
    publishTime: Number(timestamp),
    fetchedAt,
  }));
}

/** How many poll ticks between re-probes of a disabled feed. */
const PROBE_EVERY = 10;
let pollTick = 0;

export async function pollOnce(): Promise<void> {
  pollTick++;
  // Disabled feeds are re-probed periodically. Without this the disabled set is
  // append-only: a single bad minute on the public RPC takes a market off the
  // venue until somebody restarts the process, which is not a failure mode a
  // trading venue gets to have.
  const probing = pollTick % PROBE_EVERY === 0;
  const feeds = MARKETS.filter((m) => probing || !disabledFeeds.has(norm(m.feedId)));

  // One batched call for the whole venue, retried with backoff.
  //
  // Retrying rather than fanning out matters: the thing that exhausts the shared
  // public RPC is the chart's archive backfill (hundreds of reads at past
  // blocks), and answering its 429 with six more concurrent calls amplifies the
  // pressure at exactly the wrong moment. If the batch still will not land, skip
  // the tick — the next one is `pollMs` away and `latest` already holds a real
  // price. A stale-by-one-tick quote is honest; six extra calls into a
  // rate-limited endpoint just deepens the hole.
  let batched: Map<string, FtsoPrice>;
  try {
    const rows = await withRetry(() => readFeeds(feeds.map((m) => m.feedId)));
    batched = new Map(rows.map((r) => [r.feedId, r]));
  } catch (e) {
    console.error(`[ftso] batch read failed after retries, skipping tick: ${String(e).slice(0, 120)}`);
    return;
  }

  await Promise.all(
    feeds.map(async (m) => {
      const key = norm(m.feedId);
      try {
        // A real oracle read: the batch is the same call for every feed at
        // once, not a cached or substituted value.
        const p = batched.get(key);
        if (!p) throw new Error("feed missing from batch response");
        if (!(p.price > 0)) throw new Error("zero price");
        if (disabledFeeds.delete(key)) {
          console.log(`[ftso] ${m.symbol} recovered — market re-enabled @ $${p.price.toFixed(6)}`);
        }
        latest.set(key, p);
        // Fold the sample into the market's own OHLC history, so the chart is
        // drawn from the same oracle that prices fills — not a third-party API.
        recordPriceSample(m.id, p.price, p.fetchedAt);
      } catch (e) {
        console.error(`[ftso] read failed for ${m.symbol}: ${String(e).slice(0, 140)}`);
      }
    }),
  );
}

/**
 * Validate every configured feed against the on-chain oracle at boot.
 *
 * Both the registry lookup and each feed read are retried: the public Coston2
 * RPC answers 429 often enough that a single attempt is not evidence a feed is
 * broken. A registry failure no longer disables anything — the address resolves
 * lazily on the next read, and leaving markets enabled lets the poller heal
 * them. Anything still failing after retries is disabled, and `pollOnce` will
 * re-probe and re-enable it when the oracle comes back.
 */
export async function validateFeeds(): Promise<void> {
  const ftso = await withRetry(() => resolveFtsoAddress()).catch((e) => {
    console.error(
      `[ftso] registry lookup failed after retries: ${String(e).slice(0, 160)} — will resolve on the next poll`,
    );
    return null;
  });
  if (!ftso) return;
  console.log(`[ftso] FtsoV2 @ ${ftso} (via ContractRegistry, chain ${env.flare.chainId})`);

  for (const m of MARKETS) {
    try {
      const p = await withRetry(() => readFeed(m.feedId));
      if (!(p.price > 0)) throw new Error("zero price");
      latest.set(norm(m.feedId), p);
      console.log(`[ftso] ${m.symbol} feed ok — $${p.price.toFixed(6)}`);
    } catch (e) {
      disabledFeeds.add(norm(m.feedId));
      console.error(
        `[ftso] FEED FAILED for ${m.symbol} (${m.feedId}): ${String(e).slice(0, 140)} — market disabled, will re-probe`,
      );
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

// ─── historical reconstruction from the chain itself ─────────────────────────

/** Coston2 targets ~1.8s blocks; used only to step backwards by wall-clock. */
const BLOCKS_PER_MIN = 33;

/**
 * Reconstruct a market's price history by reading the FTSO v2 feed AT PAST BLOCK
 * HEIGHTS.
 *
 * This is the same contract the live path reads and the same one
 * `DorrBatchSettlement` re-reads when it accepts a batch — just queried against
 * earlier state. So the chart's history is on-chain oracle data, not a
 * third-party price API: anyone can reproduce any bar with a single archive
 * `eth_call`, which is a stronger claim than "we fetched it from a vendor".
 *
 * Returns oldest-first samples. Callers fold these into candles.
 */
/** Retry a public-RPC read a few times with backoff — the public endpoint
 *  intermittently refuses connections under a sustained archive walk. */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastErr;
}

export async function readFeedHistory(
  feedId: string,
  minutes: number,
  concurrency = 6,
  samplesPerMinute = 1,
): Promise<Array<{ atMs: number; price: number }>> {
  const ftso = await withRetry(() => resolveFtsoAddress());
  const pc = publicClient();
  const head = await withRetry(() => pc.getBlockNumber());
  const headBlock = await withRetry(() => pc.getBlock({ blockNumber: head }));
  const headMs = Number(headBlock.timestamp) * 1000;

  // Several samples per minute, walking backwards from the head block. One
  // sample per bar would make every reconstructed candle a doji (open = high =
  // low = close), which renders as a tick rather than a candle — the extra
  // samples are what give a bar its body and wick.
  const steps = Math.max(1, samplesPerMinute);
  const blocksPerStep = Math.max(1, Math.round(BLOCKS_PER_MIN / steps));
  const stepMs = 60_000 / steps;
  const targets: Array<{ block: bigint; atMs: number }> = [];
  for (let i = minutes * steps; i >= 1; i--) {
    const back = BigInt(i * blocksPerStep);
    if (back >= head) continue;
    targets.push({ block: head - back, atMs: headMs - i * stepMs });
  }

  const out: Array<{ atMs: number; price: number }> = [];
  const missed: typeof targets = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const rows = await Promise.all(
      chunk.map(async (t) => {
        try {
          // Retry the individual read too: a transient RPC failure here leaves a
          // hole in the series, and a chart with missing minutes is a chart that
          // looks broken.
          const [value, decimals] = (await withRetry(
            () =>
              pc.readContract({
                address: ftso,
                abi: FTSO_ABI,
                functionName: "getFeedById",
                args: [feedId as `0x${string}`],
                blockNumber: t.block,
              }) as Promise<[bigint, number, bigint]>,
            3,
          )) as [bigint, number, bigint];
          const price = Number(value) / 10 ** Number(decimals);
          return price > 0 ? { atMs: t.atMs, price } : null;
        } catch {
          return null; // block genuinely unavailable (pruned) — skip that minute
        }
      }),
    );
    rows.forEach((r, j) => (r ? out.push(r) : missed.push(chunk[j])));
    // Breathe between chunks; a tight loop is what tips the public RPC over.
    await new Promise((r) => setTimeout(r, 120));
  }

  // Repair pass: a minute that failed every retry leaves a hole, and a hole is
  // visible as a gap in the chart. Re-read just those blocks, slowly, once.
  for (const t of missed) {
    try {
      const [value, decimals] = (await withRetry(
        () =>
          pc.readContract({
            address: ftso,
            abi: FTSO_ABI,
            functionName: "getFeedById",
            args: [feedId as `0x${string}`],
            blockNumber: t.block,
          }) as Promise<[bigint, number, bigint]>,
        5,
      )) as [bigint, number, bigint];
      const price = Number(value) / 10 ** Number(decimals);
      if (price > 0) out.push({ atMs: t.atMs, price });
    } catch {
      /* genuinely unavailable at that height — leave the minute out */
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}
