import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MARKETS, marketById } from "./markets.js";
import { fundingRate } from "./trading-math.js";
import { getPrice, isFeedDisabled } from "./ftso.js";
import * as vamm from "./vamm.js";
import { account, getState, persist, logEvent, recordPriceSample } from "./state.js";
import { getJob } from "./jobs.js";
import { commitOrder, executeOrder, closePosition, cancelOrder, anchorOrderCommitment, addSealedOrder, settleSealedBatch, unrealizedPnl, adjustMargin, setStops, liqPriceOf } from "./trading.js";
import { runAbDemo, runAttackLab } from "./demo.js";
import { runBatchAuctionDemo, clearBatchUniform, batchDigest } from "./batch.js";
import { runSealedDemo, currentRound, secondsUntilRound, roundForTime } from "./sealbid.js";
import {
  flareConfigured, vaultSolvency, fxrpInfo, vaultAccount, epochCount,
  getBatchOnChain, explorerAddress, explorerTx, relayerBalance, syncLockedMargin,
} from "./flare.js";
import { enclaveConfigured, enclaveSigner, enclaveUrl } from "./attestation.js";
import { resolveFtsoAddress, readFeedHistory } from "./ftso.js";
import { buildDisclosure, verifyDisclosure } from "./disclosure.js";
import { createJob, jobStep, completeJob, failJob } from "./jobs.js";
import { verifyAuth, type AuthEnvelope } from "./auth.js";
import { env } from "./env.js";

export const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

const bad = (c: Context, msg: string, code: ContentfulStatusCode = 400) =>
  c.json({ error: msg }, code);

/**
 * Reject anything that is not a 20-byte hex address.
 *
 * Without this, a typo'd address is indistinguishable from a real one with
 * nothing in it: every lookup below filters an in-memory list by string
 * equality, so garbage matches nothing and returns `200 []`. In a positions
 * panel that reads as "your positions are gone" rather than "that is not an
 * address", which is the wrong thing to tell someone about their money.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const badAddress = (c: Context, address: string) =>
  ADDRESS.test(address) ? null : bad(c, `not a valid address: ${address}`);

/**
 * Gate a value-moving action on a wallet signature. Returns an error string to
 * reject with, or null to proceed. No-op when auth isn't required (dev). The
 * client signs authMessage(action, params, ts) and sends body.auth = {signer, ts, sig}.
 */
function checkAuth(
  action: string,
  params: Record<string, unknown>,
  body: Record<string, unknown>,
  expectedSigner: string | undefined,
): string | null {
  if (!env.authRequired) return null;
  const res = verifyAuth(action, params, body.auth as AuthEnvelope | undefined, expectedSigner);
  return res.ok ? null : res.error;
}

/**
 * A tiny TTL cache for the read-only chain summaries the UI polls.
 *
 * `/flare/info` fans five `eth_call`s out at once and both the landing page and
 * /verify hit it on every load. Against a public RPC that rate-limits, that is a
 * 500 waiting to happen — and none of the data is per-request: the contract
 * addresses never move and solvency changes on the order of minutes. One read
 * shared across a few seconds of traffic is both gentler and more honest about
 * what the number actually is.
 */
const chainCache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = chainCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  try {
    const value = await load();
    chainCache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    // Serve the last good read rather than a 500. A contract address that was
    // correct twenty seconds ago is still correct, and a status page that goes
    // blank every time a shared public RPC hiccups tells a reviewer less than a
    // slightly stale one. `staleFor` below says how old it is, so nothing here
    // is passed off as fresher than it is.
    if (hit) return hit.value as T;
    throw e;
  }
}

/** Seconds since a cached chain summary was last successfully refreshed. */
const staleFor = (key: string): number | null => {
  const hit = chainCache.get(key);
  return hit ? Math.round((Date.now() - hit.at) / 1000) : null;
};

// ─── system ──────────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  return c.json({
    ok: true,
    service: "dorr-operator",
    markets: MARKETS.length,
    chain: "flare-coston2",
    flareReady: flareConfigured(),
    now: new Date().toISOString(),
  });
});

// ─── markets + prices ────────────────────────────────────────────────────────
app.get("/markets", (c) => {
  const out = MARKETS.map((m) => {
    const idx = getPrice(m.feedId);
    const pool = vamm.snapshot(m.id);
    return {
      id: m.id,
      symbol: m.symbol,
      base: m.base,
      maxLeverage: m.maxLeverage,
      maxOiUsd: m.maxOiUsd,
      disabled: isFeedDisabled(m.feedId),
      indexPrice: idx?.price ?? null,
      markPrice: pool?.markPrice ?? null,
      publishTime: idx?.publishTime ?? null,
      vamm: pool ? { virtualBase: pool.virtualBase, virtualQuote: pool.virtualQuote } : null,
    };
  });
  return c.json({ markets: out });
});

/** Markets whose archive backfill has run (or is running) this process. */
const historyFilled = new Map<string, Promise<void>>();

/** Serialises archive backfills across all markets — see `ensureHistory`. */
let backfillChain: Promise<void> = Promise.resolve();

/**
 * Fill a market's candle history from on-chain FTSO reads at past blocks, once.
 *
 * Deduped per market so concurrent chart requests don't fan out hundreds of
 * duplicate archive calls, and skipped entirely once enough history exists.
 */
export function ensureHistory(marketId: string, feedId: string, minutes = 360): Promise<void> {
  const series = getState().candles[marketId] ?? [];
  // Length alone is not enough: downtime punches holes into an already-long
  // series (no live samples while the operator is stopped), and those minutes
  // render as gaps in the chart forever because the series still looks "full".
  const hasHole = series.some((c, i) => i > 0 && c.t - series[i - 1].t > 60);
  if (series.length >= minutes && !hasHole) return Promise.resolve();

  const running = historyFilled.get(marketId);
  if (running) return running;

  // Backfills are serialised across markets, not just deduped within one.
  //
  // `readFeedHistory` already caps itself at 6 concurrent archive reads, but the
  // dedupe above is per-market — so a visitor clicking through all six markets
  // launched six independent walks and put 36 concurrent reads on a shared public
  // RPC. Measured result: sustained 429s, and five of six charts stuck at two
  // bars after a restart while only the market being watched ever filled.
  // Chaining them keeps the ceiling at 6 no matter how many markets are asked
  // for; each one still completes, just in turn.
  const job = (backfillChain = backfillChain.then(async () => {
    try {
      const samples = await readFeedHistory(feedId, minutes);
      for (const s of samples) recordPriceSample(marketId, s.price, s.atMs);
      persist();
      const what = hasHole ? "re-read (filling gaps in)" : "reconstructed";
      console.log(`[chart] ${marketId}: ${what} ${samples.length} min of FTSO history from chain`);
    } catch (e) {
      // Chart falls back to live-only; never fail a request over history.
      console.error(`[chart] history backfill failed for ${marketId}: ${String(e).slice(0, 140)}`);
    } finally {
      // Only the *in-flight* walk is deduped. Keeping the settled promise here
      // made the ten-minute repair sweep a no-op after its first pass: every
      // later call got the old resolved promise back and never re-read, so a
      // hole punched by downtime survived until the next restart — which is the
      // opposite of what the sweep exists to do. The `hasHole`/length check
      // above is what stops this from re-reading when there is nothing to fix.
      historyFilled.delete(marketId);
    }
  }));
  historyFilled.set(marketId, job);
  return job;
}

/**
 * Reconstruct every market's history in the background at boot.
 *
 * Runs one market at a time so the archive walk never competes with live price
 * polling for RPC throughput. By the time anyone opens the terminal the default
 * market is already filled; the rest land within a minute.
 */
export function warmChartHistory(): void {
  // Every market, but strictly one at a time. Six concurrent archive walks get
  // the public RPC to start refusing connections; sequentially it is steady and
  // the whole set lands in a few minutes. Lazily filling only on first view is
  // not enough — switching markets would show a ten-minute chart until the walk
  // caught up, which is exactly the moment someone is deciding whether to trade.
  void (async () => {
    // Several passes: the public RPC refuses connections often enough that one
    // sweep reliably leaves a market or two short, and a market with no history
    // is the thing someone sees the moment they switch to it.
    for (let pass = 1; pass <= 3; pass++) {
      const short: string[] = [];
      for (const m of MARKETS) {
        await ensureHistory(m.id, m.feedId).catch(() => {});
        if ((getState().candles[m.id]?.length ?? 0) < 120) short.push(m.id);
      }
      if (short.length === 0) {
        console.log("[chart] all markets have reconstructed FTSO history");
        return;
      }
      console.log(`[chart] pass ${pass}: still short — ${short.join(", ")}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  })();
}

/**
 * OHLC history for a market, built from the FTSO v2 samples this operator read.
 *
 * The chart draws the same feed that prices fills and that DorrBatchSettlement
 * re-reads on-chain — there is no third-party price API in the loop. Stored as
 * 1-minute bars and aggregated up to whatever bucket the client asks for.
 */
app.get("/markets/:id/candles", async (c) => {
  const id = c.req.param("id");
  const market = marketById(id);
  if (!market) return bad(c, `unknown market ${id}`, 404);
  const bucketSec = Math.max(60, Math.min(86_400, Number(c.req.query("bucketSec") || 60)));
  const limit = Math.max(1, Math.min(2_000, Number(c.req.query("limit") || 500)));

  // Kick off the archive reconstruction if this market hasn't been filled yet,
  // but never block the response on it — a chart that takes 30s to answer is
  // worse than one that fills in a moment later. `warmChartHistory()` normally
  // has this done before the first request arrives.
  void ensureHistory(id, market.feedId);

  const minutes = getState().candles[id] ?? [];
  if (bucketSec === 60) {
    return c.json({ marketId: id, bucketSec, source: "ftso-v2", candles: minutes.slice(-limit) });
  }

  // Aggregate 1m bars into the requested bucket: first open, max high, min low,
  // last close — the same fold the client would do, done once here.
  const out: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
  for (const m of minutes) {
    const t = Math.floor(m.t / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, m.h);
      last.l = Math.min(last.l, m.l);
      last.c = m.c;
    } else {
      out.push({ t, o: m.o, h: m.h, l: m.l, c: m.c });
    }
  }
  return c.json({ marketId: id, bucketSec, source: "ftso-v2", candles: out.slice(-limit) });
});

// ─── vault / collateral ──────────────────────────────────────────────────────
app.get("/vault/info", async (c) => {
  if (flareConfigured()) {
    try {
      const { fx, sol } = await cached("vault/info", 15_000, async () => ({
        fx: await fxrpInfo(),
        sol: await vaultSolvency(),
      }));
      return c.json({
        chain: "flare-coston2",
        chainId: env.flare.chainId,
        vaultAddress: sol.vaultAddress,
        settlementAddress: env.flare.settlement,
        collateral: {
          symbol: fx.symbol,
          address: fx.address,
          decimals: fx.decimals,
        },
        explorerUrl: explorerAddress(sol.vaultAddress),
        faucetUrl: "https://faucet.flare.network/coston2",
        note: "deposit FXRP by approving the vault then calling deposit(uint256); only the depositor can withdraw",
      });
    } catch (e) {
      return bad(c, `vault info unavailable: ${String(e).slice(0, 160)}`, 503);
    }
  }
  return bad(c, "vault not configured", 503);
});

/**
 * FXRP is a real asset on Coston2 — the operator holds no minting authority for
 * it, so there is no operator-side faucet to hand out margin. Test FXRP comes
 * from Flare's own faucet; this endpoint tells the caller exactly that instead
 * of pretending to mint (or crediting unbacked margin, which would break the
 * vault's solvency invariant).
 */
app.post("/faucet", (c) =>
  c.json(
    {
      error: "dorr cannot mint FXRP — it is a real asset on Coston2.",
      howTo:
        "Claim test FXRP from Flare's faucet, then deposit it into the vault from the Collateral panel.",
      faucetUrl: "https://faucet.flare.network/coston2",
    },
    501,
  ),
);

/**
 * Reconcile a trader's margin ledger against the on-chain DorrVault.
 *
 * Collateral is the vault's business — FXRP enters via the depositor's own
 * `deposit()` and leaves only via their own `withdraw()`. Realized PnL is the
 * ledger's business. So the tradable balance is simply re-derived:
 *
 *     balance = vault.accountOf(trader).balance + pnlCum
 *
 * That makes a deposit spendable the moment it confirms, a withdrawal reflected
 * immediately, and — because collateral is never *stored* here — it is
 * impossible for a blank or damaged ledger to strand a trader's real FXRP.
 *
 * Returns the change in balance (positive when collateral arrived).
 */
/** Addresses whose collateral we have successfully read from the vault at least once. */
const everReconciled = new Set<string>();

async function reconcileVault(address: string): Promise<number> {
  if (!flareConfigured()) return 0;
  const acct = account(address);
  let onChain: number;
  try {
    onChain = (await vaultAccount(address)).balance;
    everReconciled.add(address);
  } catch (e) {
    // A failed read on an account we have seen before is survivable: the stored
    // balance is genuinely the last known one, so keep it.
    if (everReconciled.has(address)) return 0;
    // On an account we have NEVER read, the stored zero is not "last known", it
    // is "never known" — and asserting it tells a funded trader they are broke.
    // A fresh process hit exactly that: one 429 during the first reconcile and
    // the order came back "insufficient free margin: 0.00 FXRP". Surface it as
    // the transient upstream failure it is so the caller can retry.
    throw new Error(
      `collateral temporarily unreadable for ${address.slice(0, 10)}… — ${String(e).slice(0, 100)}`,
    );
  }
  const before = acct.balance;
  acct.balance = Math.max(0, onChain + (acct.pnlCum ?? 0));
  if (acct.balance === before) return 0;
  persist();
  return acct.balance - before;
}

/**
 * Push the ledger's locked margin for one trader onto the vault.
 *
 * Awaited where margin *increases* (commit, seal) so the chain reserves the
 * collateral before we acknowledge the order. Fired and forgotten where margin
 * is released — a late release only briefly under-reports a trader's own free
 * balance, and the next call reconciles it anyway.
 */
async function lockMarginForTrader(address: string): Promise<void> {
  if (!flareConfigured()) return;
  // Retried, because refusing the order is the fallback and that is a harsh
  // outcome for a momentary 429 from a public RPC. Safe to repeat: the call
  // re-reads the vault's current `locked` and derives the delta from it, so a
  // second attempt after a partial failure converges on the same target rather
  // than double-locking.
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await syncLockedMargin(address, account(address).locked);
      return;
    } catch (e) {
      last = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

/** Best-effort release; failures self-heal on the next reconcile. */
function releaseMarginSoon(address: string): void {
  if (!flareConfigured()) return;
  void syncLockedMargin(address, account(address).locked).catch(() => {
    /* the next commit/seal or the sweep will fix it */
  });
}


app.get("/account/:address", async (c) => {
  const address = c.req.param("address");
  const invalid = badAddress(c, address);
  if (invalid) return invalid;
  const acct = account(address);
  await reconcileVault(address);
  persist();
  const positions = getState().positions.filter((p) => p.address === address);
  return c.json({
    address,
    balance: acct.balance,
    locked: acct.locked,
    free: acct.balance - acct.locked,
    openPositions: positions.filter((p) => p.status === "open").length,
  });
});

/** Credit any new on-chain vault deposits to the trader's margin (poll-friendly). */
app.post("/deposits/sync", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  if (!address) return bad(c, "address required");
  if (!flareConfigured()) return bad(c, "vault not configured", 503);

  const delta = await reconcileVault(address);
  const acct = account(address);
  if (delta > 0) {
    logEvent({
      type: "deposit",
      address,
      detail: `Deposited ${delta.toFixed(2)} FXRP to the margin vault`,
      chain: "flare-coston2",
    });
  }
  return c.json({
    credited: delta > 0 ? [{ amount: delta }] : [],
    balance: acct.balance,
    free: acct.balance - acct.locked,
  });
});

/**
 * Withdrawal is non-custodial by construction: DorrVault only ever pays FXRP
 * out to the depositor who calls `withdraw()` themselves. The operator has no
 * authority to move a trader's collateral — that is the property the whole
 * design rests on — so this endpoint deliberately refuses rather than offering
 * an operator-routed path. The client withdraws straight from the wallet.
 */
app.post("/withdraw", (c) =>
  c.json(
    {
      error: "dorr cannot withdraw on your behalf — the vault pays out only to the depositor.",
      howTo: "Withdraw from the Collateral panel; your wallet signs DorrVault.withdraw(uint256) directly.",
      vaultAddress: flareConfigured() ? env.flare.vault : undefined,
    },
    501,
  ),
);

// ─── trading ─────────────────────────────────────────────────────────────────
app.post("/orders/commit", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const p = {
    address: String(body.address || ""),
    marketId: String(body.marketId || ""),
    side: (body.side === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
    marginUsd: Number(body.marginUsd || 0),
    leverage: Number(body.leverage || 1),
    privacyMode: (body.privacyMode === "public" ? "public" : "private") as "public" | "private",
    orderType: (body.orderType === "limit" ? "limit" : "market") as "market" | "limit",
    ...(body.limitPrice != null ? { limitPrice: Number(body.limitPrice) } : {}),
    ...(body.maxSlippageBps != null ? { maxSlippageBps: Number(body.maxSlippageBps) } : {}),
  };
  const authErr = checkAuth("commit", p, body, p.address);
  if (authErr) return bad(c, authErr, 401);
  // Pick up collateral the trader deposited on-chain before judging free margin,
  // so a fresh wallet with FXRP in the vault isn't told it has none.
  try {
    await reconcileVault(p.address);
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 503);
  }
  let committed;
  try {
    committed = commitOrder(p);
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }

  // Reserve the margin ON-CHAIN before acknowledging the order. Until the vault
  // itself knows the collateral is committed, the trader could withdraw it out
  // from under their own position. If the lock can't be made, undo the order
  // rather than open a position the chain doesn't back.
  try {
    await lockMarginForTrader(p.address);
  } catch (e) {
    try {
      cancelOrder(committed.order.id);
    } catch {
      /* best effort — the ledger release below is what matters */
    }
    return bad(c, `could not reserve margin on-chain: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`, 503);
  }

  const { order, jobId } = committed;
  return c.json({
    success: true,
    orderId: order.id,
    jobId,
    commitmentHash: order.commitmentHash,
    sizeBase: order.sizeBase,
    commitPrice: order.commitPrice,
  });
});

app.post("/orders/:id/execute", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const owner = getState().orders.find((o) => o.id === id)?.address;
  const authErr = checkAuth("execute", { orderId: id }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const { position, jobId } = executeOrder(id);
    return c.json({ success: true, position, jobId });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

app.get("/orders/:id", (c) => {
  const order = getState().orders.find((o) => o.id === c.req.param("id"));
  if (!order) return bad(c, "not found", 404);
  return c.json(order);
});

app.get("/positions/:address", (c) => {
  const address = c.req.param("address");
  const invalid = badAddress(c, address);
  if (invalid) return invalid;
  const positions = getState().positions
    .filter((p) => p.address === address)
    .map((p) => {
      const m = marketById(p.marketId);
      const idx = m ? getPrice(m.feedId) : undefined;
      const mark = idx?.price ?? p.entryPrice;
      return {
        ...p,
        markPrice: mark,
        unrealizedPnl: p.status === "open" ? unrealizedPnl(p, mark) - p.fundingPaid : undefined,
        liquidationPrice: p.status === "open" ? liqPriceOf(p) : undefined,
      };
    });
  return c.json({ positions });
});

app.post("/positions/:id/close", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const fraction = body.fraction != null ? Number(body.fraction) : 1;
  const owner = getState().positions.find((x) => x.id === id)?.address;
  const authErr = checkAuth("close", { positionId: id, fraction }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const { position, jobId } = closePosition(id, "close", fraction);
    releaseMarginSoon(position.address);
    return c.json({ success: true, position, jobId });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// add (+) or remove (−) margin on an open position
app.post("/positions/:id/margin", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const delta = Number(body.delta || 0);
  const owner = getState().positions.find((x) => x.id === id)?.address;
  const authErr = checkAuth("margin", { positionId: id, delta }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const position = adjustMargin(id, delta);
    // Adding margin raises the on-chain lock; removing it lowers it. Await the
    // increase so the chain reserves it before we confirm.
    if (delta > 0) await lockMarginForTrader(position.address);
    else releaseMarginSoon(position.address);
    return c.json({ success: true, position });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// set/clear hidden stop-loss & take-profit (anti stop-hunting)
app.post("/positions/:id/stops", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  // A request that names neither field would otherwise return success while
  // changing nothing — reject it so a misspelled param is visible, not silent.
  if (body.stopLoss === undefined && body.takeProfit === undefined) {
    return bad(c, "send stopLoss and/or takeProfit (a number to set, null to clear)");
  }
  const stops = {
    stopLoss: body.stopLoss === null ? null : body.stopLoss != null ? Number(body.stopLoss) : undefined,
    takeProfit: body.takeProfit === null ? null : body.takeProfit != null ? Number(body.takeProfit) : undefined,
  };
  for (const [k, v] of Object.entries(stops)) {
    if (v !== null && v !== undefined && !(Number.isFinite(v) && v > 0)) {
      return bad(c, `${k} must be a positive price, or null to clear`);
    }
  }
  const owner = getState().positions.find((x) => x.id === id)?.address;
  const authErr = checkAuth("stops", { positionId: id, ...stops }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    return c.json({ success: true, position: setStops(id, stops) });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// cancel a resting (committed) order — releases locked margin
app.post("/orders/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const owner = getState().orders.find((o) => o.id === id)?.address;
  const authErr = checkAuth("cancel", { orderId: id }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const order = cancelOrder(id);
    releaseMarginSoon(order.address);
    return c.json({ success: true, order });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

/**
 * Per-order L1 anchoring is not how Flare records membership: the
 * epoch's membership root is what DorrBatchSettlement records on-chain, and it
 * covers every order in the batch at once. Kept as a documented refusal so an
 * old client gets an explanation rather than a 404, and answered 501 like the
 * other deliberate refusals — a 500 reads as a crash in a network tab.
 */
app.post("/orders/:id/anchor-commit", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const owner = getState().orders.find((o) => o.id === id)?.address;
  const authErr = checkAuth("anchor-commit", { orderId: id }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const { txHash, order } = await anchorOrderCommitment(id);
    return c.json({
      success: true,
      txHash,
      explorerUrl: explorerTx(txHash),
      order,
    });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 501);
  }
});

// resting (private) limit orders for an address
app.get("/orders/resting/:address", (c) => {
  const address = c.req.param("address");
  const invalid = badAddress(c, address);
  if (invalid) return invalid;
  const orders = getState().orders
    .filter((o) => o.address === address && o.status === "committed" && o.orderType === "limit")
    .map((o) => ({ id: o.id, marketId: o.marketId, side: o.side, sizeBase: o.sizeBase, leverage: o.leverage, marginUsd: o.marginUsd, limitPrice: o.limitPrice, commitmentHash: o.commitmentHash, createdAt: o.createdAt }));
  return c.json({ orders });
});

// ─── async jobs (proofs are slow — poll me) ──────────────────────────────────
app.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return bad(c, "not found", 404);
  return c.json(job);
});

// ─── public order feed (what an attacker can see) ────────────────────────────
app.get("/feed", (c) => {
  const feed = [...getState().feed].slice(-100).reverse();
  return c.json({ feed });
});

// ─── config (addresses + explorer + markets for the UI evidence panel) ───────
app.get("/config", async (c) => {
  const cfg: Record<string, unknown> = {
    network: env.flare.chainId === 114 ? "flare-coston2" : `flare-${env.flare.chainId}`,
    chainId: env.flare.chainId,
    explorerBase: `${env.flare.explorer}/tx/`,
    markets: MARKETS.map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, maxLeverage: m.maxLeverage })),
  };
  if (!flareConfigured()) {
    cfg.flare = null;
    return c.json(cfg);
  }
  try {
    const { fx, sol } = await cached("config/flare", 15_000, async () => ({
      fx: await fxrpInfo(),
      sol: await vaultSolvency(),
    }));
    cfg.flare = {
      vaultAddress: sol.vaultAddress,
      settlementAddress: env.flare.settlement,
      collateral: { symbol: fx.symbol, address: fx.address, decimals: fx.decimals },
      ftso: await resolveFtsoAddress().catch(() => null),
      faucetUrl: "https://faucet.flare.network/coston2",
    };
  } catch {
    cfg.flare = null;
  }
  return c.json(cfg);
});

// ─── test-only admin ─────────────────────────────────────────────────────────
/**
 * `/demo/reset` and `/demo/seed` are indispensable to the in-process test suite
 * and indefensible on a live operator.
 *
 * `reset` wipes every account, position and anchor; `seed` credits spendable
 * margin that no FXRP backs. The second is the dangerous one: `/ops/solvency`
 * derives liabilities from the vault *on-chain*, so phantom balance never shows
 * up there — the venue would report "fully backed" while an address traded on
 * margin that does not exist. Neither is called by any client.
 *
 * Bun sets NODE_ENV=test for `bun test`, which is also what points the ledger at
 * `state.test.json`, so the same flag gates both.
 */
const testOnly = (c: Context) =>
  process.env.NODE_ENV === "test" ? null : bad(c, "not found", 404);

app.post("/demo/reset", (c) => {
  const gate = testOnly(c);
  if (gate) return gate;
  const s = getState();
  s.accounts = {};
  s.orders = [];
  s.positions = [];
  s.sealedOrders = [];
  s.jobs = [];
  s.feed = [];
  s.anchors = [];
  s.insuranceFundUsd = 0;
  s.fundingHistory = [];
  persist();
  return c.json({ ok: true, reset: true });
});

/** Test-only: unbacked margin so unit tests needn't deposit real FXRP. */
app.post("/demo/seed", async (c) => {
  const gate = testOnly(c);
  if (gate) return gate;
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  const fxrp = Math.min(Number(body.fxrp ?? 50_000), 1_000_000);
  if (!address) return bad(c, "address required");
  const acct = account(address);
  acct.balance = fxrp;
  acct.locked = 0;
  persist();
  return c.json({ ok: true, address, balance: acct.balance });
});

// ─── A/B anti-front-running demo (deterministic, fund-free) ──────────────────
app.post("/demo/ab", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = runAbDemo({
      marketId: String(body.marketId || "FLR-USD"),
      side: body.side === "SHORT" ? "SHORT" : "LONG",
      marginUsd: Number(body.marginUsd || 1000),
      leverage: Number(body.leverage || 10),
      botMultiple: body.botMultiple ? Number(body.botMultiple) : undefined,
      // Real fills on the live vAMM by default — the reserves are snapshotted and
      // restored, so the demo costs no one anything. `mode: "sim"` is an explicit
      // opt-in for a deterministic scratch-clone run.
      mode: body.mode === "sim" ? "sim" : "live",
    });
    return c.json(result);
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// MEV attack lab — bot sandwiches a public order, but the same attack FAILS on dorr
app.post("/demo/attack", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(
      runAttackLab({
        marketId: String(body.marketId || "FLR-USD"),
        side: body.side === "SHORT" ? "SHORT" : "LONG",
        marginUsd: Number(body.marginUsd || 1000),
        leverage: Number(body.leverage || 10),
        botMultiple: body.botMultiple ? Number(body.botMultiple) : undefined,
      }),
    );
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// batch auction — prove a sandwich nets $0 under uniform-price clearing
app.post("/demo/batch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(
      runBatchAuctionDemo({
        marketId: String(body.marketId || "FLR-USD"),
        side: body.side === "SHORT" ? "SHORT" : "LONG",
        marginUsd: body.marginUsd != null ? Number(body.marginUsd) : undefined,
        leverage: body.leverage != null ? Number(body.leverage) : undefined,
        botMultiple: body.botMultiple != null ? Number(body.botMultiple) : undefined,
      }),
    );
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// how the currently-resting (committed) MARKET orders for a market would clear
// as one uniform-price epoch — real state, read-only.
app.get("/batch/preview", (c) => {
  const marketId = c.req.query("marketId") || "FLR-USD";
  const pool = vamm.snapshot(marketId);
  if (!pool) return bad(c, `market ${marketId} not ready`);
  const orders = getState()
    .orders.filter((o) => o.marketId === marketId && o.status === "committed" && o.orderType === "market")
    .map((o) => ({ id: o.id, side: o.side, sizeBase: o.sizeBase }));
  if (orders.length === 0) {
    return c.json({ marketId, epochOrders: 0, note: "no committed market orders resting for this epoch" });
  }
  const cleared = clearBatchUniform({ base: pool.virtualBase, quote: pool.virtualQuote, k: pool.k }, orders);
  return c.json({
    marketId,
    epochOrders: orders.length,
    clearing: cleared,
    digest: batchDigest(cleared),
    note: "every order in the epoch settles at one uniform price — arrival order is worthless to a front-runner",
  });
});

// sealed-bid batch auction — REAL privacy from the operator (drand timelock).
// Proves the operator is cryptographically blind until the epoch's round lands.
app.post("/demo/sealed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(
      await runSealedDemo({
        marketId: String(body.marketId || "FLR-USD"),
        side: body.side === "SHORT" ? "SHORT" : "LONG",
        marginUsd: body.marginUsd != null ? Number(body.marginUsd) : undefined,
        leverage: body.leverage != null ? Number(body.leverage) : undefined,
      }),
    );
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 500);
  }
});

// submit a timelock-SEALED order — the operator stores ciphertext it cannot read
app.post("/orders/seal", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const p = {
    address: String(body.address || ""),
    marketId: String(body.marketId || ""),
    commitment: String(body.commitment || ""),
    ciphertext: String(body.ciphertext || ""),
    targetRound: Number(body.targetRound || 0),
    maxMarginUsd: Number(body.maxMarginUsd || 0),
  };
  const authErr = checkAuth("seal", { commitment: p.commitment, targetRound: p.targetRound }, body, p.address);
  if (authErr) return bad(c, authErr, 401);
  // Pick up collateral the trader deposited on-chain before judging free margin,
  // so a fresh wallet with FXRP in the vault isn't told it has none.
  try {
    await reconcileVault(p.address);
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 503);
  }
  let so;
  try {
    so = addSealedOrder(p);
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
  try {
    await lockMarginForTrader(p.address);
  } catch (e) {
    return bad(c, `could not reserve margin on-chain: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`, 503);
  }
  return c.json({ success: true, id: so.id, epochId: so.epochId, targetRound: so.targetRound, commitment: so.commitment });
});

// settle a market's sealed epoch — decrypt (round permitting), clear at one price, open positions
app.post("/batch/settle", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const marketId = String(body.marketId || "FLR-USD");
  try {
    return c.json({ success: true, ...(await settleSealedBatch(marketId)) });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 500);
  }
});

// a trader's sealed orders (status only — contents stay sealed until settled)
app.get("/orders/sealed/:address", (c) => {
  const address = c.req.param("address");
  const invalid = badAddress(c, address);
  if (invalid) return invalid;
  const orders = getState()
    .sealedOrders.filter((o) => o.address === address)
    .map((o) => ({ id: o.id, marketId: o.marketId, commitment: o.commitment, targetRound: o.targetRound, maxMarginUsd: o.maxMarginUsd, status: o.status, clearingPrice: o.clearingPrice, positionId: o.positionId, droppedReason: o.droppedReason, createdAt: o.createdAt }));
  return c.json({ orders });
});

// live drand epoch info — the current round + when the next ~30s epoch would seal
app.get("/batch/epoch", async (c) => {
  try {
    const now = await currentRound();
    const closeRound = await roundForTime(Date.now() + 30_000);
    const secondsToClose = await secondsUntilRound(closeRound);
    return c.json({
      drandNetwork: "quicknet",
      currentRound: now,
      epochCloseRound: closeRound,
      secondsToClose: Math.max(0, Math.round(secondsToClose)),
      note: "orders are timelock-sealed to epochCloseRound; the operator can't open any until drand publishes it",
    });
  } catch (e) {
    return bad(c, `drand unreachable: ${String(e).slice(0, 120)}`, 502);
  }
});

// Flare settlement layer — contracts, collateral, oracle, enclave (evidence panel)
app.get("/flare/info", async (c) => {
  if (!flareConfigured()) return bad(c, "Flare contracts not configured", 503);
  try {
    // Sequential, not Promise.all: five simultaneous eth_calls is exactly the
    // burst the public RPC answers with 429.
    const { fx, sol, ftso, epochs, relayer } = await cached("flare/info", 15_000, async () => ({
      fx: await fxrpInfo(),
      sol: await vaultSolvency(),
      ftso: await resolveFtsoAddress(),
      epochs: await epochCount(),
      relayer: await relayerBalance(),
    }));
    return c.json({
      network: "flare-coston2",
      chainId: env.flare.chainId,
      explorer: env.flare.explorer,
      contracts: {
        vault: sol.vaultAddress,
        settlement: env.flare.settlement,
        teeVerifier: env.flare.teeVerifier,
        ftsoV2: ftso,
      },
      collateral: { symbol: fx.symbol, address: fx.address, decimals: fx.decimals, totalSupply: fx.totalSupply },
      solvency: { solvent: sol.solvent, reservesFxrp: sol.reservesFxrp, liabilitiesFxrp: sol.liabilitiesFxrp },
      enclave: enclaveConfigured()
        ? {
            configured: true,
            signer: await enclaveSigner(),
            teeId: env.flare.teeId,
            measurement: env.flare.teeMeasurement,
            // Stated plainly: with this set the matching engine holds no
            // attestation key and cannot sign a batch quote itself.
            delegatedTo: enclaveUrl(),
          }
        : { configured: false },
      batchesSettled: epochs,
      relayer,
      readAgeSec: staleFor("flare/info"),
      explorerUrls: {
        vault: explorerAddress(sol.vaultAddress),
        settlement: explorerAddress(env.flare.settlement),
      },
    });
  } catch (e) {
    return bad(c, `flare info failed: ${String(e).slice(0, 200)}`, 500);
  }
});

// a settled epoch as recorded on Flare
app.get("/flare/batch/:epochId", async (c) => {
  if (!flareConfigured()) return bad(c, "Flare contracts not configured", 503);
  try {
    return c.json(await getBatchOnChain(c.req.param("epochId") as `0x${string}`));
  } catch (e) {
    // 503, and truncated: a failed chain read is an upstream problem, not a bug
    // here, and viem's error carries the RPC's whole HTML body — dumping that
    // into a JSON error is unreadable and leaks internals for no benefit.
    return bad(c, `batch read failed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`, 503);
  }
});

// a trader's on-chain FXRP margin account
app.get("/flare/account/:address", async (c) => {
  const invalid = badAddress(c, c.req.param("address"));
  if (invalid) return invalid;
  if (!flareConfigured()) return bad(c, "Flare contracts not configured", 503);
  try {
    return c.json(await vaultAccount(c.req.param("address")));
  } catch (e) {
    return bad(c, `vault read failed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`, 503);
  }
});

// activity log — the trader's own timeline (commit/execute/close/limit/SL-TP/anchor/…)
app.get("/events", (c) => {
  const address = c.req.query("address");
  const all = [...getState().events].reverse();
  const events = (address ? all.filter((e) => !e.address || e.address === address) : all).slice(0, 100);
  return c.json({ events });
});

// selective disclosure — open your (hidden) position to a chosen auditor
app.post("/disclose", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const orderId = String(body.orderId || "");
  const audience = String(body.audience || "auditor");
  // A position opened through the sealed path is owned by a SealedOrder, so look
  // there too — otherwise the ownership check silently passes for sealed orders.
  const st0 = getState();
  const owner =
    st0.orders.find((o) => o.id === orderId)?.address ??
    st0.sealedOrders.find((o) => o.id === orderId)?.address;
  const authErr = checkAuth("disclose", { orderId, audience }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const disclosure = await buildDisclosure(orderId, audience);
    if (owner) logEvent({ type: "disclose", address: owner, marketId: disclosure.revealed.pairId, detail: `Disclosed position to "${audience}" — verifiable against the on-chain commitment, still private to the public` });
    return c.json({ success: true, disclosure });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// verify a disclosure you were handed (public — no auth)
app.post("/disclose/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(verifyDisclosure(body.disclosure ?? body));
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

app.get("/anchors", (c) => {
  const anchors = getState().anchors.map((a) => ({
    ...a,
    explorerUrl: explorerTx(a.txHash),
  }));
  return c.json({ anchors });
});

// ─── exchange stats — open interest, skew, funding, TVL, volume ───────────────
app.get("/stats", (c) => {
  const st = getState();
  const open = st.positions.filter((p) => p.status === "open");
  const perMarket = MARKETS.map((m) => {
    const idx = getPrice(m.feedId);
    const mark = vamm.markPrice(m.id);
    const px = mark ?? idx?.price ?? 0;
    const mine = open.filter((p) => p.marketId === m.id);
    const longOi = mine.filter((p) => p.side === "LONG").reduce((s, p) => s + p.sizeBase * px, 0);
    const shortOi = mine.filter((p) => p.side === "SHORT").reduce((s, p) => s + p.sizeBase * px, 0);
    return {
      id: m.id,
      symbol: m.symbol,
      base: m.base,
      indexPrice: idx?.price ?? null,
      markPrice: mark ?? null,
      openPositions: mine.length,
      longOiUsd: longOi,
      shortOiUsd: shortOi,
      openInterestUsd: longOi + shortOi,
      skewUsd: longOi - shortOi,
      maxOiUsd: m.maxOiUsd,
      oiUtilizationPct: m.maxOiUsd > 0 ? ((longOi + shortOi) / m.maxOiUsd) * 100 : 0,
      fundingRateHourly: mark && idx ? fundingRate(mark, idx.price) : 0,
    };
  });
  const volumeUsd = st.orders.reduce((s, o) => s + Math.abs(o.executedFill?.notional ?? 0), 0);
  const tvlUsd = Object.values(st.accounts).reduce((s, a) => s + a.balance, 0);
  return c.json({
    markets: perMarket,
    global: {
      openInterestUsd: perMarket.reduce((s, x) => s + x.openInterestUsd, 0),
      openPositions: open.length,
      accounts: Object.keys(st.accounts).length,
      tvlUsd,
      volumeUsd,
      insuranceFundUsd: st.insuranceFundUsd,
      anchors: st.anchors.length,
    },
    at: new Date().toISOString(),
  });
});

// ─── ops/diagnostics ─────────────────────────────────────────────────────────
app.get("/ops/balances", async (c) => {
  if (!flareConfigured()) return bad(c, "flare not configured", 503);
  try {
    const { relayer, fx, sol } = await cached("ops/balances", 15_000, async () => ({
      relayer: await relayerBalance(),
      fx: await fxrpInfo(),
      sol: await vaultSolvency(),
    }));
    return c.json({
      chain: "flare-coston2",
      relayer: { address: relayer.address, c2flr: relayer.c2flr },
      vault: { address: sol.vaultAddress, fxrp: sol.reservesFxrp },
      collateral: { symbol: fx.symbol, address: fx.address, decimals: fx.decimals },
    });
  } catch (e) {
    return bad(c, `balances unavailable: ${String(e).slice(0, 160)}`, 503);
  }
});

/**
 * Proof of solvency — the operator attests that the on-chain margin vault holds
 * at least the sum of every credited FXRP balance (what users could withdraw).
 * Reserves are read live from the vault script address, so anyone can recompute
 * them independently from the returned address and check the ratio.
 */
app.get("/ops/solvency", async (c) => {
  const st = getState();
  const liabilitiesUsd = Object.values(st.accounts).reduce((s, a) => s + a.balance, 0);

  // Flare is the settlement layer: reserves are the real FXRP held by DorrVault
  // on Coston2. Anyone can recompute this from vaultAddress + fxrpAddress.
  if (flareConfigured()) {
    try {
      const sol = await vaultSolvency();
      const at = new Date().toISOString();
      const attestation = createHash("sha256")
        .update(`dorr-solvency:${sol.vaultAddress}:${sol.reservesFxrp.toFixed(6)}:${sol.liabilitiesFxrp.toFixed(6)}:${at}`)
        .digest("hex");
      return c.json({
        solvent: sol.solvent,
        reservesUsd: sol.reservesFxrp,
        liabilitiesUsd: sol.liabilitiesFxrp,
        surplusUsd: sol.reservesFxrp - sol.liabilitiesFxrp,
        collateralizationRatio: sol.collateralizationRatio,
        vaultAddress: sol.vaultAddress,
        collateralAddress: sol.fxrpAddress,
        collateral: "FXRP",
        chain: "flare-coston2",
        explorerUrl: explorerAddress(sol.vaultAddress),
        attestation,
        at,
        note: "reserves are the live on-chain FXRP held by DorrVault — recompute and verify independently",
      });
    } catch (e) {
      return bad(c, `solvency check failed: ${String(e).slice(0, 200)}`, 500);
    }
  }

  // No vault configured — report that plainly rather than inventing reserves.
  return c.json(
    {
      error: "solvency unavailable — the Flare vault is not configured",
      liabilitiesUsd,
      note: "set the DorrVault address so reserves can be read on-chain",
    },
    503,
  );
});
