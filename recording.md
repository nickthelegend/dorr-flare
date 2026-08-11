# dorr — demo recording plan

## What this app is

A privacy-preserving perpetual futures exchange. Orders are timelock-encrypted in the
browser so the venue matching them cannot read them; an epoch clears at one uniform
price; and `DorrBatchSettlement` re-reads the FTSO v2 oracle on-chain and reverts if the
operator's clearing price is off-market.

## Blockchain: yes

| | |
|---|---|
| Chain | **Flare Coston2 — testnet**, chainId `114` |
| Collateral | FXRP (FAssets `FTestXRP`, 6dp) — `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| Vault | `DorrVault` `0x65b705A49778b9d7bD741A0A979162393c699a98` |
| Settlement | `DorrBatchSettlement` `0x047478DE7d2ed6B41dEFC14223764411288Db845` |
| TEE verifier | `TEEAttestationVerifier` `0x578D75dDbce7fBB05072b733F372De2241d698aE` |
| Demo wallet | `0x0b6A564E9dC664b9223FFDAe35dD585cfC010B12` — key is `FLARE_RELAYER_KEY` in the repo `.env` |
| Funds | 6.4 FXRP in wallet, 3.6 FXRP in vault, 82 C2FLR gas — **all testnet, no real value** |

**Mainnet is never touched.** The injected provider is pinned to chainId `0x72` (114) and
proxies to `coston2-api.flare.network`. There is no mainnet key anywhere in the repo.

## Services the take needs running

| Service | Port | Role |
|---|---|---|
| web (Next.js) | 3000 | landing `/` + terminal `/trade` |
| operator | 8791 | matching, ledger, FTSO polling, settlement relayer |
| enclave | 8795 | confidential compute — sealed-order decryption + uniform clearing |
| wallet bridge | 8799 | EIP-1193 provider holding the testnet key (auto-approves this session) |

## Beats

Signing beats produce a **real Coston2 transaction** and hold a full-bleed
"Signing Transaction" overlay live in the capture until the transaction is confirmed
on-chain by polling — never a fixed sleep.

| # | id | What is on screen | Signing |
|---|---|---|---|
| 1 | `b01-hero` | Landing hero — "Your order. / Unfront-runnable" | |
| 2 | `b02-problem` | Attack Lab section: −$152.90 stolen on a transparent DEX vs 0 / 25,000 cracks sealed | |
| 3 | `b03-mechanism` | The four-step section; each step's scene performs its own claim as it scrolls in | |
| 4 | `b04-proof` | Proof section — the three deployed contract addresses | |
| 5 | `b05-terminal` | Click "Open terminal" → `/trade` loads live | |
| 6 | `b06-chart` | FLR/USD candles reconstructed from FTSO v2; mark vs index with the basis in bps | |
| 7 | `b07-connect` | Connect the wallet; collateral panel reads the real vault balance | |
| 8 | `b08-deposit` | Approve FXRP, then `DorrVault.deposit(...)` — real on-chain deposit | **YES** |
| 9 | `b09-order` | Private market order: commit → the commitment hash → execute → position opens | |
| 10 | `b10-feed` | Public feed shows only the hash — no side, no size, no leverage | |
| 11 | `b11-attack` | Attack Lab runs the real sandwich on the live vAMM, then 25,000 real SHA-256 preimage attempts against the commitment | |
| 12 | `b12-seal` | Seal an order to a future drand round — the operator receives ciphertext it cannot open | |
| 13 | `b13-settle` | The drand round lands, the enclave clears the epoch at one price, and the batch is settled on Flare | **YES** |
| 14 | `b14-close` | Close the position — realized PnL, margin released | |

Plus a spoken `intro` line over the opening frame and an `outro` line over the close.

## Pre-flight

- Clear persisted browser state (fresh context, no storage reuse) before driving.
- Close every open position and cancel every resting order so the take starts from a
  known ledger.
- Count console errors **before** the take begins; only growth during the take counts
  as a failure.
- The injected provider auto-approves, so no wallet extension popup can appear; the only
  overlay is the deliberate signing one.
- Verify the recorder is capturing real content by pulling a frame from a 2-second probe
  before the real take.
- "Finished" is detected from real state — the operator's own position/order/epoch
  records — never from a second element that might never render.

## Capture

Playwright records the page at a fixed viewport taken from `DEMO_W`/`DEMO_H`, so the
video *is* the app rect — cropped at capture time, with nothing else on screen and no
chance of an OS notification stealing the frame. Each beat logs
`DEMO_LINE <ms> <line-id>` the instant it starts.
