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
# dorr

**Perpetual futures where the exchange cannot read your order.**

Try it: [dorr-flare.vercel.app](https://dorr-flare.vercel.app) · Live on Flare Coston2

---

Place a trade on any public exchange and your order is visible before it fills.
Bots read the order flow, buy ahead of you, and sell back at a worse price. You
lose money for no reason other than having been seen.

You can watch this happen inside dorr. Open the Attack Lab and run the sandwich
against a readable order: the front-runner takes **$205** out of the trade, and
the trader pays **204 basis points** more than the fair price. Run it again with
the order hidden and the attacker gets **nothing** — not because we blocked it,
but because there is no order to read. It tries twenty-five thousand real
SHA-256 preimages against the commitment, matches zero, and gives up. At that
measured rate the nonce space takes on the order of 10^26 years.

That is the whole product: remove the input the attack depends on.

## How it works

**Your order leaves the browser as a hash.** You sign it locally; what reaches
the public feed is a commitment — no side, no size, no price, no leverage. If you
want protection from us as well, seal the order to a drand timelock round: it is
encrypted in your browser and the operator cannot open it until that round
publishes. Not a promise, a construction.

**Something has to match it, and that something is a chip that keeps secrets.**
The matching engine runs inside Intel TDX — a sealed region of an Intel processor
— rented from Phala Cloud. Software outside that region, including us and
including the host, cannot look in. For every batch it settles, the processor
signs a 5,010-byte hardware receipt whose report data is that batch's payload
hash. The signature covers *this* batch and cannot be replayed onto another one.
The operator holds no attestation key at all, so it cannot forge a receipt even
for itself.

**Then Flare checks our work.** Before accepting a settlement, the contract
re-reads the price from **FTSO v2** on-chain and rejects the transaction if our
clearing price is more than 200 basis points away from the oracle. A second
contract verifies the enclave receipt: that the enclave is registered, that its
measurement matches, that the signature recovers to it, and that the payload hash
is exactly `keccak256(epochId, membershipRoot, clearingPrice, orderCount)`. If we
wanted to settle you at a dishonest price, the chain would not let us.

**Your collateral stays yours.** Margin is **FXRP** — XRP bridged onto Flare
through FAssets — held in a vault that pays out only to the depositor. There is
no operator withdrawal path; a fuzz test asserts a withdrawal can never exceed
free balance, and another asserts settlement can never drain the vault.
Committing an order reserves that margin on-chain, and the reservation is a
transaction you can open in the block explorer yourself.

**Everyone in an epoch gets the same price.** Orders clear at a single uniform
price, so a bot buying just before you and selling just after is filled at the
identical price on both legs. Its profit is exactly zero — by arithmetic, not by
detection.

## What Flare does here

FTSO v2 is not decoration. It supplies the live mark you trade against *and* the
on-chain price band the settlement contract enforces against us. FAssets supplies
the collateral: real FXRP, deposited, locked, and withdrawn through the vault.
And Flare is where the confidential-compute claim is settled — the TDX receipt is
checked by a contract, not by a status page we wrote.

## See it for yourself

The [`/verify`](https://dorr-flare.vercel.app/verify) page reads everything live
from the running system: the deployed contract addresses come from the operator,
the attestation comes from the enclave. Nothing on it is typed by hand, so if the
page and the deployment ever disagree, the page is wrong.

The contracts are on Coston2 and linked there:
the [vault](https://coston2-explorer.flare.network/address/0x65b705A49778b9d7bD741A0A979162393c699a98),
the [settlement contract](https://coston2-explorer.flare.network/address/0x047478DE7d2ed6B41dEFC14223764411288Db845),
and the [attestation verifier](https://coston2-explorer.flare.network/address/0x578D75dDbce7fBB05072b733F372De2241d698aE).

## What we have not solved

A judge finding a limitation we hid is worse than one we named, so these are on
the `/verify` page too, sitting next to the proofs.

The enclave's identity is **not sealed to the silicon** — its signing seed comes
from the environment, which keeps our on-chain registrations valid across
redeploys but means the host operator could read it. The clearing arithmetic is
**not ZK-proven**: the enclave computes the uniform price, and the chain checks it
against the oracle band and the attestation without re-executing the match. v1
still runs a **trusted operator** for matching, the way a rollup runs a sequencer
— what is cryptographic today is that it cannot read a sealed order, that the
epoch clears at one price, and that collateral is self-custodied. Liquidity is a
**virtual AMM**, not an external order book; that is the trade we made for being
able to seal orders at all. And this is **testnet** — Coston2, FXRP with no real
value, unaudited.

## Status

Built for Flare Summer Signal. 91 operator tests and 31 Solidity tests, including
fuzz tests for vault solvency and zero-sum PnL. The app, the operator, and the
Intel TDX enclave are all live right now.
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
