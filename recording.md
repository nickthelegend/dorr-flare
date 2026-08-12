# recording.md — three-project demo, one clean take

Three submissions to one hackathon, one confidential-compute story split across
them. Recorded as **three takes** sharing one intro and one outro, because a
judge scoring dorr should not have to sit through molfi to reach the part that
matters to them.

**Blockchain: yes.** Flare Coston2 (chainId 114) throughout. Beats marked ✍️
involve a real EIP-191 signature or an on-chain transaction. Testnet only — FXRP
and C2FLR with no market value. No mainnet key exists in any of these repos and
none is used.

**Live surfaces at record time**

| | |
|---|---|
| dorr | `https://dorr-flare.vercel.app` |
| dorr operator | `https://dorr-operator-9449c5bb5086.herokuapp.com` |
| dorr enclave | Phala dstack CVM, `…8795.dstack-pha-prod5.phala.network` |
| hadal | `https://hadal-flare.vercel.app` |
| molfi | `https://molfi.fun` |
| explorer | `https://coston2-explorer.flare.network` |

**Motion rule.** Every scroll is `behavior:"smooth"` driven from the page, never
a wheel event — wheel scrolling stutters on capture and the GSAP scenes on
dorr's landing page are scroll-linked, so a jerky scroll makes a working
animation look broken. Explorer pages get the same treatment.

---

## Take A — dorr (the main one, ~3:10)

| id | beat | signing |
|---|---|---|
| `a-intro` | Title card. The problem in one sentence: on every public venue, your order is visible before it fills. | |
| `a-land-hero` | dorr landing. Hero reads a **measured** number — `/demo/ab` ran this pageview, so "on a public DEX it took $205.10" is live, not copy. | |
| `a-land-scroll` | Smooth-scroll the four GSAP scenes: seal → operator blind → uniform clearing → chain checks the band. | |
| `a-attack-open` | Open the Attack Lab from the navbar. | |
| `a-attack-run` | Run the sandwich. Transparent DEX: bot front-runs, victim overpays **$205.01**. dorr: 25,000 real SHA-256 preimage guesses, 0 matches, attack aborted, bot profit **$0.00**. | |
| `a-attack-tabs` | Sealed tab — real drand round, operator **refused** to decrypt early. Batch tab — sandwich clears to `0.000000`. | |
| `a-connect` | Connect wallet. Coston2. Real balance appears from the vault: **4.60 FXRP**. | |
| `a-order-form` | Set margin and leverage. Notional and liquidation distance recompute live off the FTSO mark. | |
| `a-commit` ✍️ | **Sign the order.** Overlay held until the commit is accepted. Real EIP-191 envelope. | ✍️ |
| `a-feed` | The public feed shows the commitment **hash only** — no side, size or price. That is the whole claim, on screen. | |
| `a-explorer` | Explorer: the vault deposit and a settled batch. Smooth-scroll the logs. | |
| `a-verify` | `/verify` — contracts read from the operator, attestation from the enclave. **"Hardware attestation is live. Intel TDX quote…"** | |
| `a-tee` | The raw quote: `available: true`, 5010 bytes, `report_data` = the batch payload hash. Bound to *this* batch, not "an enclave exists". | |

## Take B — hadal (~1:00)

> `b-wrap` and `b-send` were cut, not skipped. Both need hadal's TEE service,
> which is not publicly deployed — `NEXT_PUBLIC_TEE_URL` still points at
> localhost. Filming a wrap that cannot complete, or narrating one that did not
> happen, would be worse than not showing it. The guard beat carries hadal's
> claim instead, and it is the honest half.

| id | beat | signing |
|---|---|---|
| `b-land` | hadal landing. Confidential FXRP payments on Flare — the chain records that you paid, never how much. | |
| `b-explorer` | Explorer: the transfer exists, the amount does not appear. Scroll the event log slowly to make the absence legible. | |
| `b-guard` | The honest part: `ConfidentialFXRP` releases value only against a signer Flare's registry reports as PRODUCTION. A TDX quote alone is refused with `TeeNotAttested` — two different attestations, and the contract reads one of them. | |

## Take C — molfi (~1:10)

> `c-bid` was cut for the same reason: `SealedBidBook.sealBid` needs a funded
> wallet and molfi's own bid flow, neither of which was set up. The market page
> shows real live data; a staged bid would not have been real.

| id | beat | signing |
|---|---|---|
| `c-land` | molfi landing — LIVE ON FLARE · COSTON2. | |
| `c-markets` | A real market: BTC above $63,400, live FTSO price, odds both sides, countdown. | |
| `c-tee` | `getTeeMachineStatus` → **2 = PRODUCTION** on Flare's own `FlareTeeManager`. Flare's data providers reached the machine and voted it available. | |
| `c-honest` | And what it does not prove: registration ran with `SIMULATED_TEE=true`, so the code hash is declared, not measured. Said out loud, on camera. | |
| `c-outro` | The three together: molfi has Flare's verdict, dorr has the hardware measurement, hadal keeps its own key custody. Thanks for watching. | |

---

## Pre-flight (each of these has cost a take before)

- **Warm every market first.** After a dyno restart the operator backfills charts
  one market at a time; an unwarmed market renders ~4 bars and looks broken. Hit
  all six candle endpoints and wait for ≥300 bars each *before* rolling.
- **Clear persisted state** — `localStorage`, wallet connection, positions cache.
- **Count console errors first**, then assert the count did not grow. Absolute
  zero is the wrong check; a pre-existing warning is not this take's failure.
- **Detect completion by real state**, never by a spinner disappearing: the
  commit is done when the feed contains the commitment hash, not when a toast
  shows.
- **Suppress every popup that is not the deliberate overlay** — OS notifications,
  the wallet's own confirm dialog (auto-approved for the session), Vercel's
  toolbar.
- **Verify the recorder sees content** — 2s capture, extract a frame, check it is
  not black. Already done once: 925 KB frame, real content.

## Known risks

- **The Phala CVM is billed hourly and will be destroyed.** Record `a-verify` and
  `a-tee` while it is up. Once it is gone `/verify` honestly reverts to "no
  hardware" — which is correct behaviour and exactly why it must be filmed now.
- **The public Coston2 RPC 429s** under load. If a signing beat times out, that
  is a real failure: fix and re-record rather than trimming it out.

---

# RECORDING STATUS (last run)

| take | beats | footage | verdict |
|---|---|---|---|
| **C — molfi** | 5 of 6 | `raw-take-c.mp4`, 88.9s, real content at 10/40/70/95% | **REJECT** — `c-bid` missing |
| **A — dorr** | 4 of 13 | partial | **REJECT** — blocked at the Attack Lab dialog |
| **B — hadal** | 0 | none | not attempted |

## Why C is rejected

`c-bid` is a **signing beat** — "place a sealed bid, ciphertext leaves the
browser". It was never written into the driver because `SealedBidBook.sealBid`
needs a funded wallet and molfi's own bid flow, which was not set up. Everything
else about take C is good: 5 beats in order, no gaps, real frames throughout,
zero console errors.

Cutting it as-is would ship a molfi video where nobody ever places a bid — the
one beat that shows molfi *doing* something rather than displaying something.

## Why A is rejected

Blocked at `a-attack-run`. The Attack Lab dialog opens (`a-attack-open` logs),
then `locator.boundingBox` times out on the run button. Two label fixes already
landed and neither was it:

- the navbar trigger is `Attack Lab`, title case — **not** `ATTACK LAB`
- the run control's DOM text is `Run attack` — the uppercase is CSS, and
  `:has-text` matches the DOM, not the rendered transform

The remaining suspect is selector ambiguity: the dialog contains its own tab
also labelled "Attack Lab", so `button:has-text('Attack Lab')` is no longer
unique once the dialog is open. Next step is to scope the trigger to the navbar
and the run control to the active tab panel, then re-run.

## Fixed along the way (all verified by a real run)

- **`NOT_HYDRATED` guard** — names a bot checkpoint or failed load instead of
  surfacing as an unrelated `boundingBox` timeout 30s later on the next click.
- Guard checks interactivity **and** copy, not buttons alone — molfi's landing
  is entirely links and legitimately has zero buttons.
- `/trade` is client-rendered (~12 words of SSR text); it now waits for the real
  terminal (`LIVE CHART` + a canvas) rather than a word count.
- Challenge-tolerant navigation and a non-automation browser fingerprint, after
  my own curl wait-loops tripped Vercel's bot mitigation and it then served the
  checkpoint to the recording browser.
- Wait-loops must not poll `dorr-flare.vercel.app`. That is what caused the
  mitigation in the first place.
