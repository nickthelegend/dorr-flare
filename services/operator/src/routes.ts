import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MARKETS, marketById } from "./markets.js";
import { fundingRate } from "./trading-math.js";
import { getPrice, isFeedDisabled } from "./ftso.js";
import * as vamm from "./vamm.js";
import { account, getState, persist, logEvent } from "./state.js";
import { getJob } from "./jobs.js";
import { commitOrder, executeOrder, closePosition, cancelOrder, anchorOrderCommitment, addSealedOrder, settleSealedBatch, unrealizedPnl, adjustMargin, setStops, liqPriceOf } from "./trading.js";
import { runAbDemo, runAttackLab } from "./demo.js";
import { runBatchAuctionDemo, clearBatchUniform, batchDigest } from "./batch.js";
import { runSealedDemo, currentRound, secondsUntilRound, roundForTime } from "./sealbid.js";
import {
  flareConfigured, vaultSolvency, fxrpInfo, vaultAccount, epochCount,
  getBatchOnChain, explorerAddress, relayerBalance,
} from "./flare.js";
import { enclaveConfigured, enclaveAddress } from "./attestation.js";
import { resolveFtsoAddress } from "./ftso.js";
import { buildDisclosure, verifyDisclosure } from "./disclosure.js";
import {
  cardanoReady,
  faucetMint,
  initCardano,
  operatorBalances,
  pkhOf,
  scanVaultDeposits,
  vaultDatumFor,
  vaultReserves,
  vaultWithdraw,
} from "./cardano.js";
import { createJob, jobStep, completeJob, failJob } from "./jobs.js";
import { verifyAuth, type AuthEnvelope } from "./auth.js";
import { env } from "./env.js";

export const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

const bad = (c: Context, msg: string, code: ContentfulStatusCode = 400) =>
  c.json({ error: msg }, code);

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

// ─── system ──────────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  return c.json({
    ok: true,
    service: "dorr-operator",
    markets: MARKETS.length,
    cardanoReady: cardanoReady(),
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

// ─── vault / collateral ──────────────────────────────────────────────────────
app.get("/vault/info", async (c) => {
  const ctx = await initCardano();
  const owner = c.req.query("address");
  return c.json({
    vaultAddress: ctx.vaultAddress,
    ownerVaultAddress: ctx.ownerVaultAddress,
    dusdPolicyId: ctx.dusdPolicyId,
    dusdUnit: ctx.dusdUnit,
    dusdDecimals: 6,
    operatorAddress: ctx.operatorAddress,
    anchorAddress: ctx.anchorAddress,
    ...(owner ? { depositDatumCbor: vaultDatumFor(owner) } : {}),
  });
});

app.post("/faucet", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  const amount = Math.min(Number(body.amount || 10_000), 100_000);
  if (!address.startsWith("addr_test1")) return bad(c, "address must be a preprod bech32 address");
  const job = createJob("faucet", address);
  const step = jobStep(job, `mint ${amount} FXRP → ${address.slice(0, 24)}…`);
  try {
    const txHash = await faucetMint(address, amount);
    step.done({ txHash });
    completeJob(job);
    return c.json({ success: true, txHash, amount, jobId: job.id });
  } catch (e) {
    step.fail(String(e).slice(0, 300));
    failJob(job, String(e).slice(0, 300));
    return bad(c, `faucet failed: ${String(e).slice(0, 300)}`, 500);
  }
});

app.get("/account/:address", (c) => {
  const address = c.req.param("address");
  const acct = account(address);
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

/** Credit any new vault deposits attributable to this address (poll-friendly). */
app.post("/deposits/sync", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  if (!address) return bad(c, "address required");
  const myPkh = pkhOf(address);
  const deposits = await scanVaultDeposits();
  const acct = account(address);
  const credited: Array<{ utxoRef: string; dusd: number }> = [];
  for (const d of deposits) {
    if (d.ownerPkh !== myPkh) continue;
    if (acct.creditedUtxos.includes(d.utxoRef)) continue;
    acct.creditedUtxos.push(d.utxoRef);
    acct.balance += d.dusd;
    credited.push({ utxoRef: d.utxoRef, dusd: d.dusd });
  }
  persist();
  const total = credited.reduce((s, d) => s + d.dusd, 0);
  if (total > 0) logEvent({ type: "deposit", address, detail: `Deposited ${total.toFixed(2)} FXRP to the margin vault`, chain: "cardano" });
  return c.json({ credited, balance: acct.balance, free: acct.balance - acct.locked });
});

app.post("/withdraw", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  const amount = Number(body.amount || 0);
  if (!address || !(amount > 0)) return bad(c, "address and positive amount required");
  const authErr = checkAuth("withdraw", { address, amount }, body, address);
  if (authErr) return bad(c, authErr, 401);
  const acct = account(address);
  if (amount > acct.balance - acct.locked) return bad(c, "insufficient free balance");
  const job = createJob("withdraw", address);
  const step = jobStep(job, `vault → ${amount} FXRP → ${address.slice(0, 24)}…`);
  try {
    const txHash = await vaultWithdraw(address, amount);
    acct.balance -= amount;
    persist();
    logEvent({ type: "withdraw", address, detail: `Withdrew ${amount.toFixed(2)} FXRP from the vault`, txHash, chain: "cardano" });
    step.done({ txHash });
    completeJob(job);
    return c.json({ success: true, txHash, jobId: job.id, balance: acct.balance });
  } catch (e) {
    step.fail(String(e).slice(0, 300));
    failJob(job, String(e).slice(0, 300));
    return bad(c, `withdraw failed: ${String(e).slice(0, 300)}`, 500);
  }
});

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
  try {
    const { order, jobId } = commitOrder(p);
    return c.json({
      success: true,
      orderId: order.id,
      jobId,
      commitmentHash: order.commitmentHash,
      sizeBase: order.sizeBase,
      commitPrice: order.commitPrice,
    });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
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
    return c.json({ success: true, position: adjustMargin(id, delta) });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// set/clear hidden stop-loss & take-profit (anti stop-hunting)
app.post("/positions/:id/stops", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const stops = {
    stopLoss: body.stopLoss === null ? null : body.stopLoss != null ? Number(body.stopLoss) : undefined,
    takeProfit: body.takeProfit === null ? null : body.takeProfit != null ? Number(body.takeProfit) : undefined,
  };
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
    return c.json({ success: true, order: cancelOrder(id) });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
});

// anchor an order's commitment on Cardano L1 (public proof-of-existence, contents hidden)
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
      explorerUrl: `https://preprod.cardanoscan.io/transaction/${txHash}`,
      order,
    });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 500);
  }
});

// resting (private) limit orders for an address
app.get("/orders/resting/:address", (c) => {
  const address = c.req.param("address");
  const orders = getState().orders
    .filter((o) => o.address === address && o.status === "committed" && o.orderType === "limit")
    .map((o) => ({ id: o.id, marketId: o.marketId, side: o.side, sizeBase: o.sizeBase, leverage: o.leverage, marginUsd: o.marginUsd, limitPrice: o.limitPrice, commitmentHash: o.commitmentHash, createdAt: o.createdAt, commitAnchor: o.commitAnchor }));
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
    network: "preprod",
    explorerBase: "https://preprod.cardanoscan.io/transaction/",
    markets: MARKETS.map((m) => ({ id: m.id, symbol: m.symbol, base: m.base, maxLeverage: m.maxLeverage })),
    midnight: { network: "local", proofServer: "http://127.0.0.1:6301" },
  };
  try {
    const ctx = await initCardano();
    cfg.cardano = {
      operatorAddress: ctx.operatorAddress,
      dusdPolicyId: ctx.dusdPolicyId,
      dusdUnit: ctx.dusdUnit,
      vaultAddress: ctx.vaultAddress,
      ownerVaultAddress: ctx.ownerVaultAddress,
      anchorAddress: ctx.anchorAddress,
    };
  } catch {
    cfg.cardano = null;
  }
  return c.json(cfg);
});

// ─── demo admin: repeatable, snappy stage runs ───────────────────────────────
app.post("/demo/reset", (c) => {
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

/** Instant off-chain margin so a demo needn't wait on preprod deposit confirms. */
app.post("/demo/seed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const address = String(body.address || "");
  const dusd = Math.min(Number(body.dusd || 50_000), 1_000_000);
  if (!address) return bad(c, "address required");
  const acct = account(address);
  acct.balance = dusd;
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
      mode: body.mode === "live" ? "live" : "sim",
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
  try {
    const so = addSealedOrder(p);
    return c.json({ success: true, id: so.id, epochId: so.epochId, targetRound: so.targetRound, commitment: so.commitment });
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e));
  }
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
    const [fx, sol, ftso, epochs, relayer] = await Promise.all([
      fxrpInfo(),
      vaultSolvency(),
      resolveFtsoAddress(),
      epochCount(),
      relayerBalance(),
    ]);
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
        ? { configured: true, signer: enclaveAddress(), teeId: env.flare.teeId, measurement: env.flare.teeMeasurement }
        : { configured: false },
      batchesSettled: epochs,
      relayer,
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
    return bad(c, String(e instanceof Error ? e.message : e), 500);
  }
});

// a trader's on-chain FXRP margin account
app.get("/flare/account/:address", async (c) => {
  if (!flareConfigured()) return bad(c, "Flare contracts not configured", 503);
  try {
    return c.json(await vaultAccount(c.req.param("address")));
  } catch (e) {
    return bad(c, String(e instanceof Error ? e.message : e), 500);
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
  const owner = getState().orders.find((o) => o.id === orderId)?.address;
  const authErr = checkAuth("disclose", { orderId, audience }, body, owner);
  if (authErr) return bad(c, authErr, 401);
  try {
    const disclosure = buildDisclosure(orderId, audience);
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
    explorerUrl: `https://preprod.cardanoscan.io/transaction/${a.txHash}`,
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
  try {
    return c.json(await operatorBalances());
  } catch (e) {
    return bad(c, String(e).slice(0, 300), 500);
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
        dusdUnit: sol.fxrpAddress,
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

  try {
    const ctx = await initCardano();
    const reserves = await vaultReserves();
    const reservesUsd = reserves.dusd;
    const solvent = reservesUsd + 1e-6 >= liabilitiesUsd;
    const ratio = liabilitiesUsd > 0 ? reservesUsd / liabilitiesUsd : Infinity;
    const at = new Date().toISOString();
    const attestation = createHash("sha256")
      .update(`dorr-solvency:${ctx.vaultAddress}:${reservesUsd.toFixed(6)}:${liabilitiesUsd.toFixed(6)}:${at}`)
      .digest("hex");
    return c.json({
      solvent,
      reservesUsd,
      liabilitiesUsd,
      surplusUsd: reservesUsd - liabilitiesUsd,
      collateralizationRatio: ratio === Infinity ? null : ratio,
      vaultAddress: ctx.vaultAddress,
      dusdUnit: ctx.dusdUnit,
      vaultUtxos: reserves.utxos,
      attestation,
      at,
      note: "reserves are the live on-chain FXRP at vaultAddress — recompute and verify independently",
    });
  } catch (e) {
    return bad(c, `solvency check failed: ${String(e).slice(0, 200)}`, 500);
  }
});
