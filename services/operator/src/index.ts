import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app, warmChartHistory } from "./routes.js";
import { MARKETS } from "./markets.js";
import { validateFeeds, startPricePolling, getPrice } from "./ftso.js";
import { seedPool, recenter } from "./vamm.js";
import { loadStateAsync, getState } from "./state.js";
import { flareConfigured, syncLockedMargin } from "./flare.js";
import { applyFundingTick, scanLiquidations, scanLimitOrders, scanStops, settleSealedBatch, reconcileLockedMargin } from "./trading.js";

async function main() {
  console.log("dorr operator starting…");
  await loadStateAsync();

  // Heal any margin stranded by a crash mid-flow before serving a single request.
  for (const r of reconcileLockedMargin()) {
    console.log(`[margin] ${r.address.slice(0, 10)}… locked ${r.from.toFixed(6)} → ${r.to.toFixed(6)} (recomputed from open obligations)`);
  }

  // Listen first, validate after. Feed validation now retries each feed against a
  // public RPC that rate-limits, so awaiting it before `serve()` left the whole
  // API unreachable for seconds on every restart — long enough for the terminal's
  // health chip to flip to "offline" and for in-flight requests to fail outright.
  // `/markets` already reports a price-less market as such, so serving early is
  // honest: the venue is up, the prices arrive a moment later.
  serve({ fetch: app.fetch, port: env.port });
  console.log(`dorr operator listening on :${env.port}`);

  await validateFeeds();
  startPricePolling();
  // Live prices first. The archive walk is hundreds of `eth_call`s and the public
  // Coston2 RPC starts answering 429 under that load — running it the instant the
  // process boots put it in direct competition with feed validation and the first
  // polls, which is how a restart could leave every market disabled. The chart
  // filling in twenty seconds late is not something anyone notices; a venue with
  // no prices is.
  setTimeout(() => warmChartHistory(), 20_000);
  // Downtime leaves holes in the live samples; re-check periodically so the
  // chart repairs itself instead of carrying a gap until the next restart.
  setInterval(() => warmChartHistory(), 10 * 60 * 1000);

  // Seed vAMM pools once prices exist, then keep them centered on FTSO.
  const seeded = new Set<string>();
  setInterval(() => {
    for (const m of MARKETS) {
      const p = getPrice(m.feedId);
      if (!p) continue;
      if (!seeded.has(m.id)) {
        seedPool(m, p.price);
        seeded.add(m.id);
        console.log(`[vamm] seeded ${m.symbol} @ $${p.price.toFixed(6)}`);
      } else {
        recenter(m, p.price);
      }
    }
  }, 2_000);

  // Keepers: limit-order triggers, hidden SL/TP triggers, liquidation — every 5s.
  setInterval(() => {
    const limits = scanLimitOrders();
    if (limits.length) console.log(`[keeper] limit orders triggered: ${limits.join(", ")}`);
    const stops = scanStops();
    if (stops.length) console.log(`[keeper] stops triggered: ${stops.map((s) => `${s.id}:${s.reason}`).join(", ")}`);
    const liq = scanLiquidations();
    if (liq.length) console.log(`[keeper] liquidated: ${liq.join(", ")}`);
  }, 5_000);
  setInterval(() => applyFundingTick(), 60 * 60 * 1000);

  // Sealed-bid keeper: settle each market's sealed epoch once its drand round
  // lands (decrypt → verify → uniform-price clear → open positions). Talks to
  // the real drand network, so run it on its own interval and never overlap.
  let settling = false;
  setInterval(async () => {
    if (settling) return;
    settling = true;
    try {
      for (const m of MARKETS) {
        const r = await settleSealedBatch(m.id).catch(() => null);
        if (r && (r.cleared || r.dropped)) {
          console.log(`[seal] ${m.id}: cleared ${r.cleared} @ ${r.clearingPrice?.toFixed(6) ?? "?"}${r.dropped ? `, dropped ${r.dropped}` : ""}`);
        }
      }
    } finally {
      settling = false;
    }
  }, 6_000);

  // Margin-lock sweep: make the vault's on-chain `locked` agree with the ledger
  // for every account. Locks are awaited on the trading path, so this is a
  // self-healer for a dropped release (or a lock issued while the RPC was down)
  // rather than the primary mechanism.
  if (flareConfigured()) {
    let sweeping = false;
    setInterval(async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        for (const [address, acct] of Object.entries(getState().accounts)) {
          if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
          const moved = await syncLockedMargin(address, acct.locked).catch(() => 0);
          if (moved !== 0) {
            console.log(`[margin] resynced ${address.slice(0, 10)}… by ${moved.toFixed(6)} FXRP`);
          }
        }
      } finally {
        sweeping = false;
      }
    }, 60_000);
  }

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
