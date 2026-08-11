# dorr-flare — full audit plan

Target: **deployed** stack, not localhost.
- web `https://dorr-flare.vercel.app`
- operator `https://dorr-operator-9449c5bb5086.herokuapp.com`
- enclave `https://dorr-enclave-f7b366d50e22.herokuapp.com`
- chain Coston2 (114)

**Network verification method.** `read_network_requests` does not capture cross-origin
XHR from this page — it reported zero requests while the app was demonstrably live.
Every network assertion below is made by reading `performance.getEntriesByType("resource")`
and by patching `window.fetch`, not by trusting the network panel. A "no errors" claim
made from the panel alone is void.

Status: `PASS` / `FAIL` / `UNTESTABLE` (with reason).

---

## A · Landing page (`/`)

| # | Item | "Correct" means |
|---|---|---|
| A1 | Page loads | 200, `<title>` set, no console error of any level |
| A2 | Hero renders | Headline + CTA visible without scroll at 1280×800 |
| A3 | 8 GSAP scenes | Each scene's final frame is visible after its scroll range; no scene stuck at opacity 0 |
| A4 | No stack overflow | Zero `Maximum call stack` errors (the regression that shipped once) |
| A5 | Reduced motion | With `prefers-reduced-motion: reduce`, all content visible, no animation runs |
| A6 | Nav anchors | Every nav link scrolls to a section that exists; no dead anchors |
| A7 | CTA → /trade | Navigates and `/trade` boots |
| A8 | Mobile 375×812 | No horizontal scroll, no overlap, text legible |
| A9 | Console/network | Zero errors, zero 4xx/5xx |

## B · Trade page (`/trade`)

| # | Item | "Correct" means |
|---|---|---|
| B1 | Boots | Chart, panels, navbar all render; no error boundary |
| B2 | Live badge | Shows LIVE only when `/health` is ok |
| B3 | Chart candles | ≥100 real bars from `/markets/:id/candles`, no gaps, no synthetic |
| B4 | Mark vs index | Both shown, differ correctly, bps spread matches computation |
| B5 | Market switch | All 6 markets load; each has its own candles + price |
| B6 | Timeframe 1m/5m/15m | Each refetches and redraws |
| B7 | Order form validation | Empty/zero/negative/over-max rejected with a specific message |
| B8 | Leverage 2/5/10/20 | Updates margin requirement correctly |
| B9 | Privacy mode toggle | Private vs public foil changes the submitted path |
| B10 | Disconnected state | Panels say connect-wallet, no crash, no fake data |
| B11 | Wallet connect | Button renders when disconnected; connects on click |
| B12 | Positions panel | Empty state correct; no stale demo rows |
| B13 | Activity log | Empty state correct; populates from `/events` |
| B14 | Public feed | Shows sealed commitments as hashes only |
| B15 | Resting orders | Empty state; populates from `/orders/resting/:addr` |
| B16 | Collateral panel | Reads real vault balance |
| B17 | Attack Lab | Runs against the live vAMM, reports real numbers |
| B18 | Disclosure | Verifies a real commitment |
| B19 | Responsive 375/768 | No overflow, panels stack |
| B20 | Console/network | Zero errors, zero 4xx/5xx |

## C · Verify page (`/verify`)

| # | Item | "Correct" means |
|---|---|---|
| C1 | Loads | Renders without error |
| C2 | Contracts from operator | Addresses match `/flare/info`, not hardcoded |
| C3 | Attestation from enclave | Reflects `/tee/attestation` live |
| C4 | Honest negative | Shows `available:false` as false — never upgraded to a stronger claim |
| C5 | Key custody | `signsForOperator` reported truthfully |
| C6 | Console/network | Zero errors |

## D · Operator API

| # | Item | "Correct" means |
|---|---|---|
| D1 | `/health` | 200, `flareReady:true`, market count 6 |
| D2 | `/markets` | 6 markets, each with live index price |
| D3 | `/markets/:id/candles` | ≥100 bars, monotonic timestamps, zero gaps, all 6 markets |
| D4 | `/feed` | Real sealed entries |
| D5 | `/events` | Real events |
| D6 | `/flare/info` | Real deployed addresses, enclave delegation shown |
| D7 | `/ops/solvency` | vault == totalLocked; balances reconcile |
| D8 | `/ops/balances` | Real on-chain reads |
| D9 | `/attestation` | Delegates to enclave; operator holds no key |
| D10 | `/anchors` | Real anchored commitments |
| D11 | Auth fails closed | Unsigned mutating request → 401 |
| D12 | Demo endpoints gated | `/demo/reset`, `/demo/seed` → 403 in production |
| D13 | Unknown account | Never-reconciled address → 503, not fake zeros |
| D14 | Bad input | Malformed market id / address → 4xx with message, never 500 |
| D15 | `/status` 404 | Confirm whether route exists; dead route is a FAIL |

## E · Enclave API

| # | Item | "Correct" means |
|---|---|---|
| E1 | `/tee/health` | 200 |
| E2 | `/tenants` | 3 tenants, stable addresses |
| E3 | `/tee/attestation` | `available:false`, `mode:none`, `seed.source:env` — honest |
| E4 | `/t/:p/pubkey` | Distinct key per tenant |
| E5 | `/t/:p/sign` | Signature recovers to that tenant's signer |
| E6 | Cross-tenant isolation | dorr ciphertext fails to open at hadal |
| E7 | Unknown tenant | 404, not 500 |
| E8 | Bad payloadHash | 400 with message |

## F · On-chain (Coston2)

| # | Item | "Correct" means |
|---|---|---|
| F1 | Vault deployed | Code at address, reads back |
| F2 | Settlement deployed | Code at address |
| F3 | TEE verifier | `teeSigner(teeId)` == enclave's dorr signer |
| F4 | Solvency on-chain | vault FXRP == sum of locked margin |
| F5 | A real settled epoch | Batch tx exists and verifies |

## G · Repo-level

| # | Item | "Correct" means |
|---|---|---|
| G1 | Unit tests | All bun tests pass |
| G2 | Contract tests | All Solidity tests pass |
| G3 | Typecheck | Clean |
| G4 | Lint | Zero errors |
| G5 | Build | Web builds |
| G6 | Zero mocks | No mock/stub/fallback data in shipped source |

---

# RESULTS

Run against the deployed stack. Fixes were made, redeployed, and re-verified live.

## Fixed during this run

| # | What was wrong | Fix |
|---|---|---|
| A-hero | `LIVE` badge over the hard-coded string "It got $0.00" — the landing page fetched nothing | Fetches `/demo/ab`; says LIVE only once measured, and only if `orderVisibleToBot` is false. Now reads "On a public DEX it took $205.10" — a real number that moves with price |
| A-figure | "125 tests, all green" — actual count 134 | Corrected, with a comment naming both commands |
| G4 | **Lint had never run.** Flat config + Next 14 (wants `.eslintrc`) + neither `eslint` nor `eslint-config-next` installed → interactive prompt. Every prior "0 lint errors" was vacuous | Matching versions installed, switched to `.eslintrc.json` |
| G4a | `useEffect` calling `invalidate(address)` without `address` in deps — a wallet switch mid-commit refreshes the **previous** account's cache | Deps added; `executeStarted` ref already guards re-entry |
| G4b | Unescaped entity in `portfolio.tsx` | Escaped |
| D14 | Five `:address` routes accepted anything; a typo'd address returned `200 []`, which a positions panel renders as "your positions are gone" | `badAddress()` on all five → 400 |
| **DEPLOY** | **The last 2 production deploys had failed (one 7h old).** Root Directory `.` but `next` lives in `apps/web` → "No Next.js version detected". The site was serving a stale build and **no change was shippable** | Root Directory → `apps/web`, stale build overrides cleared |
| **ENV** | CLI deploy uploaded local `apps/web/.env.local`, baking **`http://localhost:8790`** into production | Real URLs set as Vercel project env vars; `.vercelignore` added so local env can never ship |

## Status

- **A landing** A1–A4, A6, A8, A9 PASS. A5 (reduced motion), A7 (CTA→/trade) **not tested**.
- **B trade** B1–B7, B10, B12–B15, B17, B20 PASS. B8, B9, B18, B19 **not tested**. B11, B16 and the balance half of B7 **need a connected wallet — untested**.
- **C verify** C1–C6 PASS. 4/4 addresses match `/flare/info`; states plainly "There is no hardware attestation here."
- **D operator** all PASS after fixes. D9/D13/D15 were **plan errors, not product bugs** — `/attestation` and `/status` live on the enclave, and `reconcileVault` genuinely reads chain (a 0 balance is a true read).
- **E enclave** E1–E5, E7, E8 PASS. E6 (cross-tenant isolation over HTTP) **not re-tested this run**.
- **F chain** F1–F3 PASS — real code at all 4 addresses; **both** TEE identities resolve on `teeSigner`. F4, F5 **not tested**.
- **G repo** all PASS. 103 bun + 31 Solidity, typecheck clean, lint clean, build clean, zero mocks in shipped source.

## Known-honest, not fixed

- **D3 candle gaps.** The repair sweep works — SOL went 2 gaps → 0 on re-request. FLR keeps one 180s gap because the on-chain FTSO history has no sample there. The operator **refuses to fabricate a candle the oracle never published**. My "zero gaps" criterion was wrong; inventing the bar would have been the exact violation this audit exists to catch.
- **Cold-start degradation.** After any restart the public Coston2 RPC 429s under the 6-market fan-out: solvency errors and a market's chart shows ~4 bars until its first request finishes the lazy backfill (~10s). Self-heals. Heroku cycles dynos daily, so a judge can hit this.
- **No hardware attestation.** `/tee/attestation` reports `available:false, mode:none`. Correct, and stated on `/verify`.
