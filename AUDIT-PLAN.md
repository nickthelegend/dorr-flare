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
