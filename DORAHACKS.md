# DoraHacks BUIDL submission — dorr

Everything below is copy-paste ready. Fields are in the order the DoraHacks form
asks for them. Anything you must supply yourself is marked **[YOU]**.

---

## BUIDL logo

`submission/dorr-logo.png` — 480 × 480 PNG, 26 KB, full-bleed (no transparent
corners, so it survives whatever card the platform renders it in).

---

## BUIDL (project) name

```
dorr
```

If the form rejects a lowercase-only name, use:

```
dorr — privacy perps on Flare
```

---

## Vision

### Describe the problem which this project solves

```
On every public exchange, your order is visible before it fills. Bots read the
order flow, buy ahead of you, and sell back to you at a worse price. You lose
money for no reason other than being seen. Sandwiching that one order costs the
trader $205 on a transparent venue — and it is not a bug in any single exchange,
it is what happens when the venue can read the order it is matching.

dorr is a perpetual futures exchange on Flare where the venue matching your
order cannot read it. Your order is committed as a hash; the public feed carries
no side, no size, no price, no leverage. Matching runs inside a sealed area of an
Intel processor (Intel TDX, on Phala Cloud), which signs a receipt for every
batch it settles — bound to that batch's payload hash, so the signature cannot be
reused. Flare then checks the result: DorrBatchSettlement re-reads FTSO v2
on-chain and reverts if our clearing price is more than 200 bps off the oracle.
Collateral is FXRP in a vault that pays out only to the depositor; there is no
operator withdrawal path.

Run the attack yourself in the app: with the order readable, the front-runner
takes $205 from the trader. With it hidden, 25,000 real SHA-256 preimage attempts
recover nothing and the sandwich cannot even be constructed — no direction, no
size, nothing to get in front of.
```

### Vision (≤ 256 characters)

Pick one — all three are under the limit (count shown):

```
Trading where the venue cannot read your order. dorr runs perpetual futures on Flare: orders are committed as hashes, matched inside an Intel TDX enclave, and settled against FTSO on-chain. Front-running fails because there is nothing to front-run.
```
*(248 chars — recommended)*

```
Markets should not leak your intent. dorr is a privacy perps DEX on Flare: your order is a hash to everyone, matching happens inside attested Intel TDX silicon, and Flare's own oracle verifies the settlement price. MEV loses its input.
```
*(235 chars)*

```
Every public order is a target. dorr hides yours — committed as a hash, matched in an Intel TDX enclave, settled on Flare against FTSO v2, collateralised in FXRP that only you can withdraw. Front-running an order nobody can read is impossible.
```
*(243 chars)*

---

## Category

Select, in order of fit:

1. **DeFi** — primary
2. **Infrastructure** — TEE-attested off-chain execution verified on-chain
3. **Privacy** (or **ZK/Privacy**, whichever the form offers)

If only one is allowed: **DeFi**.

---

## Links

### GitHub

```
https://github.com/nickthelegend/dorr-flare
```

### Project website

```
https://dorr-flare.vercel.app
```

### Demo video

**[YOU]** Upload `out/dorr-flare-demo.mp4` (5:10, 1440×900, 16 MB) to YouTube and
paste the watch URL here. `out/dorr-flare-demo.srt` is the subtitle file — upload
it as captions in YouTube Studio.

Suggested YouTube title:

```
dorr — perpetual futures on Flare where the exchange cannot read your order
```

Suggested YouTube description:

```
dorr is a perpetual futures DEX on Flare Coston2 where your order is a hash to
everyone, including the venue matching it. Matching runs inside Intel TDX on
Phala Cloud; Flare's FTSO v2 oracle verifies the settlement price on-chain.

In this demo, every transaction is real and on Coston2 testnet:
0:00  the problem — visible orders get front-run
0:35  claiming test FXRP and depositing into the vault
1:30  the same trade, public and then private
2:05  each order's transaction on the Flare explorer
2:55  the Intel TDX attestation and how it is bound to the batch
3:30  running the sandwich attack against both versions
4:40  /verify — read live from the running system

Contracts (Flare Coston2, chainId 114)
Vault        0x65b705A49778b9d7bD741A0A979162393c699a98
Settlement   0x047478DE7d2ed6B41dEFC14223764411288Db845
TEE verifier 0x578D75dDbce7fBB05072b733F372De2241d698aE

App    https://dorr-flare.vercel.app
Verify https://dorr-flare.vercel.app/verify
Code   https://github.com/nickthelegend/dorr-flare
```

### Social links (at least one)

1. ```
   https://github.com/nickthelegend
   ```
2. **[YOU]** your X/Twitter profile — `https://x.com/<handle>`
3. **[YOU]** the YouTube video URL from above (doubles as a social link if you
   are short one)

---

## Full description — paste this into the BUIDL description field

```markdown
## dorr — perpetual futures where the exchange cannot read your order

On a public venue your order is visible before it fills. Bots read the order
flow, buy ahead of you, and sell back at a worse price. You lose money for being
seen. dorr removes the input that attack depends on.

**Live on Flare Coston2. Every number below is read from the running system.**

- App — https://dorr-flare.vercel.app
- Verify page (live, nothing typed by hand) — https://dorr-flare.vercel.app/verify
- Code — https://github.com/nickthelegend/dorr-flare

### How it works

**1 · Your order is a hash.** You sign an order in the browser; what reaches the
public feed is a commitment. No side, no size, no price, no leverage. Optionally
the order is also timelock-encrypted to a drand round, so the operator itself
cannot open it until that round publishes — not by policy, by construction.

**2 · Matching happens inside silicon that can keep a secret.** The matching
engine runs in an Intel TDX confidential VM on Phala Cloud. It returns a
5,010-byte hardware quote whose `report_data` is the batch payload hash, so the
CPU signature covers *this* batch rather than the mere fact that an enclave
exists. The operator holds no attestation key and cannot forge a quote even for
itself.

**3 · Flare checks the result.** `DorrBatchSettlement` re-reads **FTSO v2**
on-chain and reverts `PriceOutOfBand` if our clearing price is more than 200 bps
off the oracle. `TEEAttestationVerifier` checks the enclave quote: registered
`teeId`, matching measurement, signature recovery, and `payloadHash ==
keccak256(epochId, membershipRoot, clearingPrice, orderCount)`.

**4 · Your collateral is yours.** Margin is **FXRP** (FAssets) in `DorrVault`,
which pays out only to the depositor. There is no operator withdrawal path —
proven by `testFuzz_WithdrawNeverExceedsFree` and
`test_SettlementCannotDrainVault`. Committing an order locks margin on-chain, and
that lock is a transaction you can open in the explorer.

**5 · One price for the whole epoch.** Orders in an epoch clear at a single
uniform price. A bot that buys just before you and sells just after receives the
same price on both legs, so the sandwich nets exactly zero — economics, not
detection.

### Attack it yourself

The app ships an **Attack Lab** that runs the classic sandwich twice against the
live vAMM at its current reserves (snapshotted and restored, so no open position
moves):

| | readable order | hidden order |
|---|---|---|
| attacker profit | **$205.06** | **$0.00** |
| victim overpays | **203.7 bps** | 0 |
| commitment cracks | n/a | **0 / 25,000** real SHA-256 preimages |

At the measured rate, exhausting the 128-bit nonce space takes ~10^26 years. The
attack is not blocked; it has no input.

### Flare integrations

| | |
|---|---|
| **FTSO v2** | Live marks, and the on-chain price band the settlement contract enforces |
| **FAssets (FXRP)** | Collateral, deposits, withdrawals, margin locks — 6-decimal FXRP throughout |
| **Confidential compute** | Intel TDX on Phala Cloud, verified on-chain by `TEEAttestationVerifier` |

### Deployed contracts — Flare Coston2 (chainId 114)

| contract | address |
|---|---|
| DorrVault | `0x65b705A49778b9d7bD741A0A979162393c699a98` |
| DorrBatchSettlement | `0x047478DE7d2ed6B41dEFC14223764411288Db845` |
| TEEAttestationVerifier | `0x578D75dDbce7fBB05072b733F372De2241d698aE` |
| FTSO v2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |
| FXRP (FTestXRP) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |

Enclave (live Intel TDX): `59b7ffee…-8795.dstack-pha-prod5.phala.network`

### What is not proven — stated plainly

- **The enclave's identity is not sealed to the silicon.** Its signing seed comes
  from the environment, which keeps on-chain registrations valid across
  redeploys, but means the host operator could read it. One attested machine
  serves sibling projects under separate derived identities, so the blast radius
  is shared.
- **The clearing arithmetic is not ZK-proven.** The enclave computes the uniform
  price; the chain checks it against the oracle band and the attestation, but
  does not re-execute the match.
- **v1 runs a trusted operator** for matching and execution, like a sequencer.
  What is cryptographic today: it cannot read a sealed order, the epoch clears at
  one price, and collateral is self-custodied.
- **Liquidity is a virtual AMM, not an external book.** Depth is whatever the
  pool is seeded with — the trade we made for being able to seal orders at all.
- **Testnet only.** Coston2, FXRP with no real value, unaudited.

That list is on the `/verify` page too, next to the proofs, because a judge
finding a limitation we hid is worse than a limitation we named.

### Tests

91 operator tests (bun) and 31 Solidity tests (forge), including fuzz tests for
vault solvency and zero-sum PnL.
```

---

## Pre-submit checklist

- [ ] Upload `submission/dorr-logo.png`
- [ ] Upload the demo video to YouTube, add `out/dorr-flare-demo.srt` as captions
- [ ] Paste the YouTube URL into **Demo video**
- [ ] Add your X handle as a social link
- [ ] Confirm the enclave is still up before judging opens —
      `curl -s https://59b7ffee2f565bdebf0ff4b076b0f1c0ba4152e4-8795.dstack-pha-prod5.phala.network/tee/attestation`
      should report `"available": true`. If it is down, `/verify` honestly says so.
