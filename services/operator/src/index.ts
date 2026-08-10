import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./routes.js";
import { MARKETS } from "./markets.js";
import { validateFeeds, startPricePolling, getPrice } from "./ftso.js";
import { seedPool, recenter } from "./vamm.js";
import { loadState } from "./state.js";
import { applyFundingTick, scanLiquidations, scanLimitOrders, scanStops, settleSealedBatch } from "./trading.js";
import { initCardano } from "./cardano.js";

async function main() {
  console.log("dorr operator starting…");
  loadState();

  // Eagerly bring up Cardano so cardanoReady() is true from the start (enables
  // CIP-68 minting on execute). Non-fatal: an unfunded/misconfigured wallet just
  // leaves Cardano routes to surface their own errors.
  await initCardano().catch((e) =>
    console.warn(`[cardano] init deferred: ${String(e).slice(0, 160)}`),
  );

  await validateFeeds();
  startPricePolling();

  // Seed vAMM pools once prices exist, then keep them centered on Pyth.
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

  serve({ fetch: app.fetch, port: env.port });
  console.log(`dorr operator listening on :${env.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
