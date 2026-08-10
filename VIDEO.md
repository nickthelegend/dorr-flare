# dorr — demo video script (3:00)

Shot-by-shot script for the submission video. Every number below is real output
from the running app — re-run the pre-flight and read your own figures off screen
rather than trusting these if the market has moved.

> Companion: [DEMO.md](./DEMO.md) is the *live stage* version (presenter beats, no
> timecodes). This one is for recording.

---

## Pre-flight

```bash
bun install
bun run --cwd services/operator start   # :8791 — wait for the six "feed ok" lines
bun run --cwd apps/web dev              # :3000
```

- **Start the operator at least 30–60 minutes before you record.** The chart is
  drawn from the operator's own FTSO v2 samples — the same feed that prices fills
  — so its history is exactly as long as the operator has been running. History
  persists across restarts, so once it's warm it stays warm.
- MetaMask on **Coston2** (chain 114), holding C2FLR for gas and FXRP for margin.
- **Deposit before you record.** Don't burn 20 seconds of video on a confirmation.
- Browser at **1440×900**, dark theme, zoom 100%. Close every other tab.
- Second tab on `coston2-explorer.flare.network`, already signed in to nothing.
- Run the Attack Lab once before recording so the operator is warm.
- Record at 60fps if you can — the timeline reveals animate.

**Numbers this script quotes** (from a live run; yours will be within a few %):

| figure | value |
|---|---|
| victim overpay, public DEX | **$152.83** (152.1 bps) |
| brute-force preimage attempts | **0 / 25,000** |
| bot profit, uniform-price batch | **$0.00** |
| bot profit, sequential venue | **$152.90** |

---

## Shot list

### 0:00 – 0:12 · Hook

**Screen:** Terminal chart, prices ticking. Slow push-in on the FLR/USD chart.

> Every perp DEX has the same hole. Your order sits in the mempool where anyone
> can read it — and trade ahead of it. On leverage, that tax is brutal.

---

### 0:12 – 0:22 · Title

**Screen:** Cut to the full terminal. Hold on the navbar: `dorr · PRIVACY PERPS · FLARE · FXRP`, the LIVE chip, the six markets.

> This is dorr. Private perps on Flare. Watch what happens when a front-running
> bot attacks the same order twice.

---

### 0:22 – 0:50 · The foil — a public order gets sandwiched

**Screen:** Click **⚔️ Attack Lab** → **Attack** tab → **Run attack**. Let the left
timeline play out. Hold on the red **SANDWICHED** card.

> On the left, a transparent DEX. The bot sees a thousand-FXRP, ten-x long in the
> clear — buys ahead of it, and sells into the fill. The victim overpays a hundred
> and fifty-two dollars. A hundred and fifty-two basis points, straight into the
> bot's pocket.

**Caption:** `SANDWICHED · −$152.83 · 152.1 bps`

---

### 0:50 – 1:15 · The hero — the bot is blind

**Screen:** Pan right to the green timeline (drag the divider if you want to widen
it). Hold on **ATTACK ABORTED**, then the big **0 / 25,000**.

> Same order on dorr. The bot sees a thirty-two-byte hash. It runs twenty-five
> thousand real SHA-256 preimage guesses. Zero matches. There is nothing to
> front-run — so the attack aborts.

**Caption:** `0 / 25,000 preimage cracks · 2¹²⁸ search space`

---

### 1:15 – 1:45 · The real claim — blind to the *operator*

**Screen:** Close the lab. Toggle **"Seal from the operator (drand timelock)"** on.
Submit a market order — button reads **SEAL LONG — OPERATOR-BLIND**. Cut to
**Attack Lab → Sealed**. Hold on the red **REFUSED** line with the live round number.

> But hiding from the public isn't enough — the venue that matches your order can
> still read it. So dorr seals it in your browser, timelock-encrypted to a future
> drand round from the League of Entropy: a live, twelve-of-twenty-two threshold
> network. Watch the operator try to open it. Refused. Not by policy — by
> cryptography. That beacon does not exist yet.

**Caption:** `operator decrypt → REFUSED (decryptable at round N)`

---

### 1:45 – 2:10 · Front-running made impossible, not invisible

**Screen:** **Attack Lab → Batch** → **Run batch**. Hold on `$0.00` next to `$152.90`.

> When the round lands, the whole epoch clears at one uniform price. A bot that
> inserts a front-run and a back-run buys and sells at the *same* price. Its
> profit is zero — by construction. On a sequential venue, the identical sandwich
> takes a hundred and fifty-two dollars.

**Caption:** `$0.00 batch · $152.90 sequential`

---

### 2:10 – 2:35 · The chain is the referee

**Screen:** Activity log → the **ANCHOR** entry. Click the tx hash through to the
Coston2 explorer. Hold on the successful tx, then back to the app.

> Then it settles on Flare. `DorrBatchSettlement` doesn't take our word for the
> price — it re-reads the FTSO v2 feed itself and reverts if we're out of band.
> We've watched it reject a real batch. It also verifies a TEE attestation bound
> to that exact epoch. Here's the transaction, on Coston2.

**Caption:** `DorrBatchSettlement · FTSO re-read · enclave quote verified`

---

### 2:35 – 2:50 · Private, but provable

**Screen:** In the positions table, on an open position, hit **Disclose** (the
small button in the Manage column) → type `regulator` in the audience field →
**Generate**. Switch to the **Verify** tab, paste it back — green **Verified**.
Change one digit of the size, verify again — red **Rejected**. Quick cut to the
Collateral panel showing real FXRP in the vault.

> Private doesn't mean unaccountable. Open your position to an auditor — they
> recompute the hash against the on-chain commitment. Verified. Change one digit:
> rejected. And your collateral is real FXRP, in a vault only you can withdraw from.

---

### 2:50 – 3:00 · Close

**Screen:** Pull back to the full terminal. Hold.

> v1 has a trusted operator matching orders. What's cryptographic today: it cannot
> see or front-run your sealed order, the epoch clears at one price, and the chain
> enforces the band. dorr — perpetual futures you can't front-run.

**End card:** `dorr · perpetual futures you can't front-run` + repo URL.

---

## Recording notes

- **The VO is 365 words — about 2:30 spoken, in a 3:00 cut.** That gap is
  deliberate: the missing 30 seconds are pauses while the timelines animate, the
  drand round ticks, and the explorer loads. Don't fill them. The silence while a
  bot fails to crack a hash is the most persuasive part of the video.
- **Don't narrate the UI.** Say what it *means*, not "now I'm clicking the button."
- **Let the timelines finish.** The reveal animation is the drama — cutting it
  early kills the beat. It plays over ~2.5s.
- **The two numbers that land:** `152 bps stolen` and `0 / 25,000`. Hold on both.
- **If a batch reverts `PriceOutOfBand` on camera, keep it.** That's the guard
  working — call it out: *"that's the contract refusing our price."*
- **Do not speed-ramp the drand refusal.** The live round number on screen is the
  proof it isn't staged.
- If you need **2:00**, cut §2:35 (disclosure) and tighten the hook to one line.
  Never cut the sealed-refusal beat — it's the only claim no other submission makes.
