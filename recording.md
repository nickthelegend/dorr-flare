# recording.md — dorr, one clean take, ~7:00

**dorr only.** Perpetual futures on Flare Coston2 where the venue matching your
order cannot read it.

**Blockchain: yes.** Flare Coston2, chainId 114. Beats marked ✍️ produce a real
EIP-191 signature or a real on-chain transaction. **Testnet only** — FXRP and
C2FLR with no market value. No mainnet key exists in this repo and none is used;
the driver aborts with `PREFLIGHT_RPC_NOT_TESTNET` if the chain id is not 114.

**Slides.** Beats marked 🎞 are HyperFrames scenes, not browser capture. They
exist because a raw JSON blob on screen is unreadable at video bitrate — the TEE
quote is 5,010 bytes and its meaning lives in three fields. Those get typeset and
annotated. Everything else is the real app.

## Live surfaces at record time

| | |
|---|---|
| app | `https://dorr-flare.vercel.app` |
| operator | `https://dorr-operator-9449c5bb5086.herokuapp.com` |
| enclave | `https://59b7ffee2f565bdebf0ff4b076b0f1c0ba4152e4-8795.dstack-pha-prod5.phala.network` |
| explorer | `https://coston2-explorer.flare.network` |
| demo wallet | `0x0b6A564E9dC664b9223FFDAe35dD585cfC010B12` — vault **4.6 FXRP**, 4.5 locked, **0.1 free** |

> **Free margin is 0.1 FXRP.** Earlier takes locked 4.5 into open commitments.
> Either close them first or size every order at 0.05, or the commit beat fails
> on `Insufficient free balance` — which would be a real failure, not a bug to
> edit around.

**Motion.** Every scroll is page-driven `behavior:"smooth"`. Wheel events stutter
on capture, and dorr's landing scenes are scroll-linked — a jerky scroll makes a
working animation look broken. Explorer pages get the same treatment.

**Framing.** Playwright records the viewport at 1440×900. Not screen capture:
that put the macOS menu bar and Chrome's tab strip in frame and sliced the right
panel off mid-column.

---

## Beats

### Act 1 — the problem (0:00–1:15)

| id | beat | |
|---|---|---|
| `intro` | 🎞 Title. The problem in one sentence: on every public venue your order is visible before it fills. | 🎞 |
| `land-hero` | Landing hero. The badge number is **measured this pageview** — `/demo/ab` ran the attack against the live pool, so "$205.10" is a live result, not copy. | |
| `land-seal` | Scene 1 — your order is timelock-encrypted in the browser. | |
| `land-blind` | Scene 2 — the operator holds ciphertext it cannot open. | |
| `land-clear` | Scene 3 — the epoch clears at one uniform price. | |
| `land-band` | Scene 4 — the chain re-reads FTSO and reverts if our price is off-market. | |

### Act 2 — prove it (1:15–2:45)

| id | beat | |
|---|---|---|
| `attack-open` | Open the Attack Lab. Scope the click to the **navbar** — once the dialog is open its own tab is also labelled "Attack Lab" and the selector stops being unique. | |
| `attack-run` | Run it. Transparent DEX: bot front-runs, victim overpays **$205**. dorr: **0 / 25,000** real SHA-256 preimages, attack aborted, bot profit **$0.00**. | |
| `attack-sealed` | Sealed tab — a live drand round, and the operator **refused** when it tried to decrypt early. | |
| `attack-batch` | Batch tab — under uniform-price clearing a sandwich nets `0.000000`. Not policy, construction. | |
| `attack-ab` | A/B tab — same order, two venues, side by side. | |

### Act 3 — use it (2:45–4:45)

| id | beat | |
|---|---|---|
| `connect` | Connect wallet. Coston2. Balance is a **real vault read**, not a number the page invented. | |
| `collateral` | Collateral panel: balance, free, locked, and the vault address it reads from. | |
| `faucet` | `GET FXRP` — where testnet collateral comes from. | |
| `deposit` ✍️ | **Deposit FXRP into the vault.** Signing overlay held until the tx confirms on-chain. | ✍️ |
| `order-form` | Margin and leverage. Notional and liquidation distance recompute off the live FTSO mark. | |
| `privacy` | Privacy toggle: *Private* → "the public sees only a hash"; *Public foil* → "your full order is broadcast". A real behavioural switch. | |
| `commit` ✍️ | **Sign the order.** Real EIP-191 envelope bound to these exact parameters. Overlay until the commitment appears in the feed. | ✍️ |
| `feed` | The whole claim, on screen: the public feed shows a **hash**. No side, no size, no price, no leverage. | |
| `positions` | The position that hash became — visible to its owner, opaque to everyone else. | |
| `withdraw` ✍️ | **Withdraw.** Depositor-signed; the operator is uninvolved and has no withdrawal path. | ✍️ |

### Act 4 — check it (4:45–7:00)

| id | beat | |
|---|---|---|
| `explorer-tx` | Explorer: the settled batch transaction, logs expanded. | |
| `explorer-vault` | The vault's transaction list — deposits and depositor-signed withdrawals, no operator path among them. | |
| `verify` | `/verify` — contracts from the operator, attestation from the enclave. Nothing typed by hand. | |
| `tee-live` | The page states **"Hardware attestation is live"**, `live · dstack`, and that the operator holds no attestation key. | |
| `tee-json` | 🎞 The raw `/tee/attestation` JSON, typeset. Walk the three fields that matter. | 🎞 |
| `tee-bound` | 🎞 The one that matters: `report_data` **equals the batch payload hash**. The CPU signature covers *this batch*, not "an enclave exists". Contrast: the competing entry reports `process.env.IMAGE_DIGEST` and never fetches a quote. | 🎞 |
| `honest` | 🎞 What is *not* proven: trusted operator for matching, vAMM not an external book, testnet, unaudited. Said plainly. | 🎞 |
| `outro` | 🎞 Where to check every claim — repo, contracts, tx hashes, `/verify`. Thanks for watching. | 🎞 |

**28 beats.** Narration ~6:10; holds and scroll settles bring it to ~7:00.

---

## Pre-flight — each of these has cost a take

- **Warm all six markets.** After a dyno restart the operator backfills one at a
  time; an unwarmed market renders ~4 bars and looks broken. Poll each candle
  endpoint until ≥300 bars *before* rolling.
- **Free margin ≥ the order size.** Currently 0.1 FXRP. Close open commitments or
  size at 0.05.
- **Scope the Attack Lab trigger to the navbar.** The dialog contains a tab with
  the same label; `button:has-text('Attack Lab')` is ambiguous once open. This is
  what killed the previous take at beat 4.
- **Clear persisted state** — localStorage, wallet connection, positions cache.
- **Count console errors first**, then assert the count did not grow. Absolute
  zero fails on a pre-existing warning that is not this take's fault.
- **Detect completion by real state.** The commit is done when the commitment is
  in the feed — not when a toast appears, and not when a spinner leaves.
- **Do not poll `dorr-flare.vercel.app` in wait loops.** Repeated curls tripped
  Vercel's bot mitigation, which then served a checkpoint to the *recording*
  browser: zero buttons, and the first symptom was an unrelated `boundingBox`
  timeout 30s later. Use the RPC as a keep-alive instead.
- **Verify the recorder sees the app** — pull a frame and *look at it*. A byte
  count proves "not black", which is how a take full of desktop chrome passed.

## Known risks

- **The Phala CVM is billed hourly and will be destroyed.** `verify`, `tee-live`,
  `tee-json` and `tee-bound` must be filmed while it is up. Once it is gone
  `/verify` honestly reverts to "no hardware" — correct behaviour, and exactly
  why these beats cannot wait.
- **The public Coston2 RPC 429s** under load. A signing beat that times out is a
  real failure: fix it and re-record rather than trimming it out.
- **Signing beats are real transactions.** `deposit` and `withdraw` move testnet
  FXRP; `commit` locks margin. Sized so the take can run several times.
