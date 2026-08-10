# dorr web — port notes (uniperp EVM → Cardano/Midnight)

Ported from `uniperp/web` (Next.js 14 App Router, Radix + Tailwind v4, v0-styled).
`bun run build` exits 0; `bun run dev` serves and hydrates cleanly with the
operator **down** and with **no wallet installed** (both fail soft).

## Premium UI restoration pass (round 2)

The first port worked but read plainer than the original uniperp v0 UI. This pass
brought the **premium look** back while keeping every Cardano/operator data wire.
Method: match the v0-dashboard design language (the same one `components/dashboard/
layout` uses) — coloured `<Bullet/>` accents, uppercase-mono panel titles in the
fixed `h-9` `CardHeader`, `CardAction` control slots, dense tabular-nums, gradient
accents — rather than freelancing a new look.

- **`components/trading/panel-header.tsx`** (new) — shared premium header: `Bullet`
  (variant-coloured) + uppercase `CardTitle` + optional `CardAction`. Every panel
  now uses it so the terminal reads as one dashboard, not a stack of ad-hoc cards.
- **navbar** — brand lockup (lock glyph in a primary tile + "dorr" display font +
  "preprod" badge + "privacy perps · cardano + midnight"); health chips rebuilt as
  premium bordered pills with `Bullet` status dots (operator live/offline w/ pulse,
  markets count, cardano ready/cold, anchors count). Wired to `useHealth`/`useMarkets`/
  `useAnchors`. Added the A/B sandwich launcher here.
- **trading-panel** — restored the original's **gradient leverage slider** (success→
  warning→destructive fill + draggable thumb over an invisible native `range` for
  a11y) with **numbered clickable stops** (capped by market `maxLeverage`), and the
  quick-margin chips. The **privacy toggle is now the hero**: a bordered primary
  card with an animated LONG/SHORT-style segmented switch and a one-line
  "the public sees only a hash" explainer. Kept the full commit→prove→execute
  pipeline, commitment-hash reveal and fill card. (Leverage bar/thumb are driven by
  inline `style` + CSS `transition`, NOT framer `animate` — the latter left the
  fill stuck at its initial value; direct style tracks state reliably.)
- **portfolio** — `PanelHeader` (Bullet reflects total-uPnL sign) with uPnL / margin
  in the action slot; segmented open/closed tabs with count badges (sticky); denser
  uppercase table header. Kept the inline close→settlement job pipeline + anchor links.
- **chart** — `PanelHeader` (Activity icon) with a **timeframe selector** (5s/15s/1m/5m,
  which re-buckets the live candles per `market@bucket`) in the action slot; premium
  market dropdown w/ per-row coin chips, mark/index + spread-bps badges, a pulsing
  live bullet. Kept the client-side lightweight-charts candle fold.
- **public-feed** — repurposed the original orderbook's density: `PanelHeader`
  (destructive Bullet, Radio icon), order-flow vs **evidence** tab segmented control,
  private/public row badges, grid-aligned leaked columns in destructive colour,
  polished empty states, footer explainer. Second tab = real Cardano settlement
  anchors (`useAnchors`) with cardanoscan links.
- **collateral-panel** — `PanelHeader` (Vault icon); balance/free/locked as bordered
  stat cards with variant Bullets (free=success, locked=warning); `Separator` between
  balances and the faucet/deposit/withdraw actions. Kept the real Mesh-built deposit tx.
- **job-progress** — made cinematic: a `Progress` bar (completed/total steps, colours
  by status) above the animated step list; running step gets a highlighted row + a
  pulsing live seconds timer; idle steps show a hollow circle; tx hashes still link to
  preprod cardanoscan.

### Hackathon showcase pieces (new)

- **`components/trading/sandwich-showcase.tsx`** (new) — an A/B front-running dialog
  launched from the navbar. Calls `operator.abDemo` (`POST /demo/ab`) with the selected
  market + LONG/SHORT (1 000 dUSD, 5x). Renders side-by-side **Public DEX** (victim
  entry, bot front-run price, `victimExtraCostUsd`, `victimSlippageBps`, `botProfitUsd`
  all in destructive colour, "order visible to bot") vs **dorr private** (fair entry,
  $0 extra cost, "bot is blind", `publicSees`), a "saved $X" delta row, and the
  operator's `headline`. Verified live: public +$37.84 / 75.5 bps vs dorr $0.00.
- **evidence** — the on-chain settlement anchors are surfaced as the second public-feed
  tab (real preprod tx hashes + cardanoscan links via `useAnchors`).
- **`lib/operator.ts`** — added the `AbDemo` type + `operator.abDemo()` helper for
  `POST /demo/ab`.

### New perps features — limit orders, partial close, margin, TP/SL, resting orders (round 3)

Wired the operator's new trading capabilities into the client + UI. All value-moving
calls sign via the existing `postSigned(path, action, params)`; the signed `params` are
built to **byte-match** the server's reconstructed params (`services/operator/src/routes.ts`
+ `auth.ts:authMessage` sorts keys and drops `undefined`-valued keys), so the CIP-30
wallet signature validates.

- **`lib/operator.ts`** — client changes:
  - `commitOrder(p)` gains `orderType: "market"|"limit"`, `limitPrice?`, `maxSlippageBps?`.
    Passed through in the SAME params object; `orderType` is always present, `limitPrice`/
    `maxSlippageBps` only when supplied (mirrors the server, so the signature covers them).
    `POST /orders/commit` (unchanged path).
  - `closePosition(positionId, fraction=1)` — now sends `{ positionId, fraction }` (the
    server always signs `fraction`, default 1; 1 = full close, `(0,1)` = partial).
    `POST /positions/:id/close`.
  - `adjustMargin(positionId, delta)` (new) — `POST /positions/:id/margin`, signs
    `{ positionId, delta }`; `delta>0` adds, `<0` removes. Returns `{ position }`.
  - `setStops(positionId, { stopLoss, takeProfit })` (new) — `POST /positions/:id/stops`,
    signs `{ positionId, ...normalized }` where each stop is `null` (clear), a `Number`
    (set), or `undefined` (leave unchanged). Returns `{ position }`.
  - `restingOrders(address)` (new) — `GET /orders/resting/:address` → `RestingOrder[]`.
  - `Position` type gains `orderType?`, `liquidationPrice?`, `stopLossPrice?`,
    `takeProfitPrice?`; `Order` gains `orderType?`/`limitPrice?`/`maxSlippageBps?`; added
    `OrderType` + `RestingOrder` types.
- **`hooks/use-operator.ts`** — added `useRestingOrders(address)` (polls 3s, fails soft,
  `placeholderData` to avoid flicker); `useInvalidateTrading` now also busts the
  resting-orders query.
- **`components/trading/trading-panel.tsx`** — added a **Market / Limit** segmented toggle
  (Zap / Gauge icons). Limit mode shows a **limit price** input defaulting to the live mark
  (tracks the mark until first edit, with a "mark N" quick-set); market mode shows an
  optional **slippage tolerance (bps)** input with %-chips. Privacy toggle stays the hero.
  Submit passes `orderType`/`limitPrice`/`maxSlippageBps`. **Limit orders rest** (no
  auto-execute → new `"rested"` phase + confirmation card); market orders keep the
  commit→execute→fill pipeline. Header title switches Market/Limit.
- **`components/trading/resting-orders.tsx`** (new) — a premium panel in the right column
  listing the connected wallet's resting limit orders via `useRestingOrders` (3s poll):
  market icon + side + size + **limit price** + a "🔒 hidden from public" badge and the
  anti-front-running explainer. No cancel (no server endpoint) — display only. Empty/offline
  states, never crashes.
- **`components/trading/portfolio.tsx`** — positions table now 11-col:
  - **Liquidation price** column (from `liquidationPrice`, warning colour) + a mobile `liq.` cell.
  - **Partial close**: `CloseControl` with 25% / 50% / 100% buttons → `closePosition(id, f)`,
    polls the returned jobId through the existing `CloseJobPanel` settlement pipeline.
  - **Add/Remove margin**: `MarginControl` popover (amount input, +Add / −Remove, shows
    free balance) → `adjustMargin(id, ±amount)`.
  - **TP/SL**: `StopsControl` popover (stop-loss + take-profit inputs, blank clears →
    `null`) → `setStops(id, {...})`; rows show an `EyeOff` "hidden SL/TP set" hint.
- **`components/trading/market-icon.tsx`** (new) — self-contained `<MarketIcon base>` with
  inline brand SVGs for ADA/BTC/ETH/SOL/DOGE (no runtime CDN, build-safe), round ~16–24px,
  initials fallback. Shown in the chart header + dropdown, trade-panel header, portfolio
  rows, public-feed rows, and resting-order rows.

### Three premium panels — MEV Attack Lab, Activity Log, Selective Disclosure (round 4)

Three new showcase surfaces, all matching the existing premium look (Bullet accents,
uppercase-mono `PanelHeader` titles, the `ui/*` kit, tabular-nums, dark theme). All
fail soft (operator down / no wallet → empty/disabled states, never crash).

- **`lib/operator.ts`** — new types + client methods:
  - `AttackLab` / `AttackStep` / `AttackActor` types; `runAttack({marketId,side,marginUsd,leverage})`
    → `POST /demo/attack`. Returns `publicRun`/`privateRun` step timelines + `headline`.
  - `DorrEvent` / `EventType` types; `events(address?)` → `GET /events?address=…` → `DorrEvent[]`.
  - `Disclosure` / `DisclosureRevealed` / `DisclosureVerdict` types; `disclose(orderId, audience)`
    (SIGNED via `postSigned(path,"disclose",{orderId,audience})`) → `POST /disclose` → `Disclosure`;
    `verifyDisclosure(disclosure)` → `POST /disclose/verify` → `DisclosureVerdict` (no auth).
- **`hooks/use-operator.ts`** — `useEvents(address)` (polls 3s, `retry:false`, `placeholderData`;
  falls back to global events when no address). `useInvalidateTrading` now also busts `["operator","events"]`.
- **`components/trading/attack-lab.tsx`** (new) — the headline demo. `AttackLabBody` calls
  `operator.runAttack` then **animates both step timelines**: each step is scheduled with a
  `setTimeout` at `(step.ms / maxMs) * 2500ms`, so the raw server ms are rescaled onto a ~2.5s
  window and both columns finish together (feels like a live attack). Left column **"Transparent
  DEX"** (red) reveals the bot spotting the order → front-run → victim fill → back-run → SANDWICHED.
  Right column **"dorr (private)"** (green): private-side `ok:false` steps read as blocked (muted +
  strikethrough, 🛑) — the bot cracking the hash and aborting. Outcome badges land when each
  timeline finishes (public: **"SANDWICHED −$X · N bps"**; dorr: **"ATTACK FAILED · 0/25,000 cracks
  · $0.00 lost"**), and a prominent proof panel shows the huge **`0 / 25,000`** brute-force line +
  the commitment + `headline`. `DemoShowcase` is the navbar launcher: one dialog with tabs
  **"Attack Lab"** | **"A/B"** (the A/B tab embeds `AbShowcaseBody`, extracted from sandwich-showcase).
  Works with NO wallet.
- **`components/trading/sandwich-showcase.tsx`** — refactored: the A/B dialog body is extracted into
  an exported `AbShowcaseBody` (no dialog chrome) so the combined `DemoShowcase` dialog can embed it;
  `SandwichShowcase` is kept as a thin standalone-dialog wrapper. `Stat` is now exported.
- **`components/trading/navbar.tsx`** — the single "A/B sandwich" launcher is replaced by the combined
  **⚔️ ATTACK LAB** launcher (`DemoShowcase`, tabs A/B + Attack Lab).
- **`components/trading/activity-log.tsx`** (new) — a premium scrollable timeline (`Card` +
  `PanelHeader`, Activity icon) of the trader's events via `useEvents(address)` (3s poll). Each row:
  a type-icon in a tinted chip + coloured tone (commit/limit-rest = neutral, execute/limit-fill = blue,
  close/partial-close = amber, stop-loss/liquidated = red, take-profit = green, anchor/deposit/withdraw
  = teal, disclose = purple; margin/stops-set = neutral), a type badge, the `detail` line, a **relative
  time** (local `relativeTime` helper — `lib/core` untouched), and a preprod cardanoscan link when
  `txHash` + `chain==="cardano"`. Polls the connected wallet's address; no wallet → recent global
  events or an empty state. Mounted in the terminal's right column under PublicFeed (feed + log now
  split the column 50/50 on lg).
- **`components/trading/disclosure.tsx`** (new) — `DisclosureDialog` triggered from a position row
  (**🔓 Disclose**). Two tabs: **Disclose** (audience input → `operator.disclose(position.orderId,
  audience)` → copyable pretty JSON blob + a human summary "proves your LONG 6,667 ADA @ 0.157 to
  <audience>, verifiable against on-chain commitment 0x…, still hidden from everyone else") and
  **Verify** (paste a disclosure → `operator.verifyDisclosure` → ✓ Verified / ✗ Rejected with the
  recomputed + committed hashes). Framed as Midnight's "private by default, provably disclosable."
  Verify needs no wallet.
- **`components/trading/portfolio.tsx`** — open-position action rows (desktop + mobile) gained the
  `<DisclosureDialog position={p} />` action (positions carry `orderId`, the subject of the disclosure).
- **`components/trading/terminal-inner.tsx`** — right feed column is now a flex-col holding `PublicFeed`
  and the new `ActivityLog` (each `lg:h-1/2`).

Verified in-browser against the live operator (dev :3000, operator :8790): the Attack Lab dialog opens
and animates both timelines step-by-step to the SANDWICHED / ATTACK FAILED badges + the 0/25,000 proof;
the Activity Log panel renders (empty state with no wallet); the A/B tab selects and embeds the original
body; `POST /disclose/verify` round-trips from the app origin (200, rejected-verdict shape). No Next.js
error overlay; the only console output is the pre-existing dialog-overlay ref + Radix DialogTitle a11y
warnings (present for the prior SandwichShowcase dialog too) and the theme hydration notice — none from
the new code.

### Chart historical backfill + tight autoscale + 5s flat-line fix (round 3)

- **`components/trading/chart.tsx`** — on mount and on market/timeframe change, seed prior
  candles from **Pyth's public TradingView shim** (no key):
  `GET https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Crypto.<BASE>/USD&resolution=<R>&from=<sec>&to=<sec>`
  → `{ s:"ok", t[], o[], h[], l[], c[] }`. **Resolution map**: 5m→`"5"` (~24h), 1m→`"1"`
  (~6h), and the sub-minute 5s/15s dorr buckets → `"1"` (last ~2h of 1-minute bars, since
  the shim has no sub-minute data) so those charts aren't empty; live ticks then append.
  Refetches per `(base, bucketSec)`; **fails soft** (any fetch/CORS error → falls back to
  live-only, never crashes). Merge keeps any live candles newer than the last history bar.
  - **5s flat-line fix**: (a) backfill gives real bars instead of 1–2 live points; (b) the
    right price scale now uses tight `autoScale` + small `scaleMargins` (and re-applies
    `autoScale` on re-seed) so sub-bp ADA moves fill the pane instead of reading flat.
  - The live-fold now merges any tick whose bucket is `<=` the last stored bar (not just
    `===`) so series times stay strictly increasing after backfill (no lightweight-charts
    data-order errors).
  - Verified in-browser: 5s ADA shows a real candle line (≈0.1535–0.1565), tightly scaled;
    Limit toggle reveals a mark-defaulted limit-price input; resting-orders panel renders;
    zero console errors on a fresh load.

All new/restyled surfaces fail soft (operator down / no wallet → skeletons + empty
states, never crash) and were exercised in the browser preview against the live
operator (A/B dialog, privacy toggle, leverage stops, feed/evidence tabs, portfolio
tabs) with zero runtime console errors.

> Build/dev gotcha: never run `bun run build` while `bun run dev` is live — the prod
> build overwrites `.next/server` chunks and the dev server then 500s with
> `Cannot find module './NNN.js'`. Fix: `rm -rf .next` and restart dev (or build with
> dev stopped).

## Deleted (EVM/dead weight)

- **Deps**: wagmi, viem, ethers, @pythnetwork/hermes-client, @lighthouse-web3/sdk,
  @supabase/supabase-js, node-cron, cron, plotly.js, react-plotly.js, qr, dotenv,
  dayjs, geist, @vercel/analytics, pino-pretty, path/url shims, @number-flow/react,
  motion (indicator-bullet now imports framer-motion), date-fns (react-day-picker 9 bundles its own),
  tanstack persist packages.
- **Code**: `lib/contracts-frontend.ts`, `lib/events.ts`, `lib/event-listener-ethers.js`,
  `hooks/api/*` (zktls, lighthouse, positions, margin, market-data, vamm/amm price),
  `app/scripts/*`, `app/cron/*`, `app/api/*` (spot-data SSE, trades, trades-stream, market-details),
  `components/providers/wagmi-provider.tsx`, EVM wallet modals (wallet-selection,
  account-details), position-management-modal, orderbook, market-selection-modal,
  timeframe selector + context, portfolio-refresh context/hook, `contracts/` ABIs,
  `data/` (market-list + ETH CSVs), `mock.json`, `types/`, duplicate `components/layout`,
  `public/data` CSVs, `public/ethlogo.jpg`, duplicate `next.config.ts`.
- `lib/core.ts` was rewritten: now only `cn` + pure formatters (kept the module path so
  all ~50 `@/lib/core` imports in `components/ui/*` stayed untouched).

## Added

- **`lib/operator.ts`** — typed fetch client for every operator endpoint
  (`NEXT_PUBLIC_OPERATOR_URL`, default `http://localhost:8790`). Non-2xx → `OperatorError`.
- **`hooks/use-operator.ts`** — TanStack Query hooks: markets/feed/positions poll 3s,
  account 5s, health/anchors 10s, jobs poll 1s and stop when the job settles. All `retry: false`,
  errors surface as empty/offline states, never crashes.
- **`hooks/use-dorr-wallet.ts`** — wraps `useWallet` (@meshsdk/react), resolves the bech32
  identity via `wallet.getChangeAddress()` (what the operator keys accounts on).
- **`components/providers/mesh-provider.tsx`** — `<MeshProvider>` wrapper (client-only).
- **`components/trading/terminal.tsx` / `terminal-inner.tsx`** — the whole terminal is one
  `next/dynamic` `ssr:false` boundary (see gotchas), with a branded loading shell.
- **`components/trading/wallet-connect-button.tsx`** — lists CIP-30 wallets via
  `BrowserWallet.getAvailableWallets()` (lazy `import("@meshsdk/core")`), connect/disconnect,
  truncated address, copy. Renders an install-Lace/Eternl hint when no wallet exists.
- **`components/trading/trading-panel.tsx`** — LONG/SHORT, margin, leverage slider 1–20x
  (capped by market `maxLeverage`), privacy toggle **"dorr private" (default) vs "public (demo foil)"**.
  Submit → `POST /orders/commit` → commitment hash shown prominently ("this is ALL the public
  sees") → live job step polling (spinners + per-step timers) → auto `POST /orders/:id/execute`
  → execute pipeline → fill card. Both pipelines stay on screen for the full proof story.
- **`components/trading/job-progress.tsx`** — the hero: animated step list, running-step
  seconds counter, per-step ms, tx hashes (64-hex → preprod cardanoscan links).
- **`components/trading/collateral-panel.tsx`** — balance/free/locked from `/account`,
  **Faucet 10k dUSD**, **Deposit** (real browser-built Cardano tx, below), **Withdraw**
  (`POST /withdraw`).
- **`components/trading/portfolio.tsx`** — open/closed tabs from `/positions/:address`,
  live uPnL, Close → settlement job pipeline inline (proof → cardano anchor w/ explorer link
  → midnight bind), realized PnL + anchor links for closed rows.
- **`components/trading/public-feed.tsx`** — "what the public sees": private entries show
  market + commitment hash only; public (foil) entries leak side/size/leverage/address in red.
  Second tab lists Cardano anchors with explorer links.
- **`components/trading/navbar.tsx`** — dorr branding + live operator status chip
  (up/down, market count, cardanoReady, anchor count — replaces the mock.json dashboard stats).

## Chart approach (decision)

**Client-side candles from the polled `/markets` prices** (15s buckets, per-market
accumulators, lightweight-charts v5 `CandlestickSeries`). The alternative — reusing the
`app/api/spot-data` SSE route — dragged in `@pythnetwork/hermes-client`, per-timeframe
server state and CSV persistence for ~600 lines; the client-side fold is ~40 lines, has no
server state, keeps working when only the operator is up, and shows exactly the price the
engine trades on (vAMM mark, pyth index fallback). Header shows mark, index and the
mark/index spread in bps. Trade-off: history starts accumulating when the page opens
(no backfill) — honest for a live demo.

## Mesh gotchas (hard-won)

1. **WASM must never evaluate on the server.** Any *static* import of `@meshsdk/react`
   (even from a `"use client"` component) lands in the SSR bundle, and
   `@sidan-lab/sidan-csl-rs-browser` does `readFileSync(<wasm>)` at module scope →
   `ENOENT ... .next/server/chunks/sidan_csl_rs_bg.wasm` during prerender. A lazy
   `React.lazy`/`Suspense` provider is NOT enough because `useWallet` imports elsewhere
   still pull the module graph in. Fix: the entire terminal is one `dynamic(..., { ssr:false })`
   boundary (`components/trading/terminal.tsx`); page/layout stay mesh-free.
2. `next.config.mjs` needs `webpack.experiments = { asyncWebAssembly: true, layers: true }`
   plus `transpilePackages: ["@meshsdk/core", "@meshsdk/react"]`. The "async/await not
   supported in target environment" build warning for the wasm module is benign.
3. **Offline tx building works**: `new MeshTxBuilder({ verbose: false })` with no fetcher
   builds fine as long as inputs come via `selectUtxosFrom(await wallet.getUtxos())`
   (defaults to bundled protocol params). No Blockfrost key needed; the
   `NEXT_PUBLIC_BLOCKFROST_KEY` fallback was therefore **not** wired in.
4. `@meshsdk/core` is lazy-imported (`await import(...)`) inside the wallet dropdown and the
   deposit handler so the multi-MB wasm chunk loads on demand, not on first paint.
5. bun resolves `@meshsdk/core@^1.8.0` → **1.9.1** and `@meshsdk/react@^1.8.0` → **1.8.14**;
   builder/method signatures verified against the installed dists.
6. The template's `Button` wasn't `forwardRef`; Radix `DropdownMenuTrigger asChild` needs the
   ref to anchor the popper — converted Button to `React.forwardRef`.

## Deposit flow (browser-built Cardano tx)

`/vault/info?address=…` → `MeshTxBuilder.txOut(vault, [2 ADA, n×1e6 dUSD])
.txOutInlineDatumValue(depositDatumCbor, "CBOR").changeAddress(user)
.selectUtxosFrom(wallet.getUtxos())` → `complete()` → `wallet.signTx` → `wallet.submitTx`
→ poll `POST /deposits/sync` every 5s (up to 5 min) until credited.

## Kept

All `components/ui/*` Radix primitives, theme/QueryProvider, dark v0 visual style
(Rebels display font, Roboto Mono), icons, not-found page, sonner toasts,
TanStack Query devtools.

## TODO / known limits

- Chart now backfills from the Pyth shim on load (round 3); still no sub-minute native
  bars from the shim, so 5s/15s are seeded from 1m history then filled by live ticks.
- Order/positions flows are poll-based; a WS/SSE push channel would cut latency.
- `wallet.getUtxos()` deposit path assumes the connected wallet holds the dUSD being
  deposited (faucet sends to the wallet first) and ≥ ~5 tADA for fees/min-ADA.
- Withdraw/faucet are operator-signed txs; the UI only links the resulting tx hash.
- Liquidation price is now shown in the positions table (from the engine's
  `liquidationPrice`); the trade-panel pre-trade liq estimate is still not rendered.
- Resting limit orders are display-only (no cancel endpoint server-side).
- E2E with a live operator + Lace on preprod not exercised in CI — manual pass recommended.
