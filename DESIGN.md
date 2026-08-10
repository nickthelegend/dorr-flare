# dorr — design rationale

> **dorr** is a privacy-preserving perpetual-futures DEX on **Flare**.
> Its one reason to exist: **the venue that matches your order cannot read it in time to trade ahead of you — and the chain, not the venue, decides whether the settlement price was honest.**

This document explains *why* the system is shaped the way it is. For what it does, see [FEATURES](./docs/FEATURES.md); for how to run it, [RUNBOOK](./RUNBOOK.md); for what is and isn't trustless, [SECURITY](./docs/SECURITY.md).

---

## 1. The problem, stated precisely

On a public perp DEX your order is visible before it executes, so a searcher can trade ahead of it and sell it back to you. Three things have to be true to stop that, and most "private" designs only achieve the first:

1. **The public can't see the order.** A commitment does this.
2. **The venue can't see it either.** A commitment does *not* do this — the matching engine must open the order to fill it.
3. **Seeing it wouldn't help anyway.** Even a leaked order shouldn't be exploitable.

dorr addresses all three, and then adds a fourth that privacy alone creates: if nobody can see the orders, **how do you know the venue settled them at an honest price?**

## 2. The four mechanisms

| Problem | Mechanism | Why this one |
|---|---|---|
| Public can see the order | **SHA-256 commitment** over `(pair, side, price, size, leverage, margin, nonce)` | Hiding *and* binding, with a 128-bit nonce. Cheap, and it doubles as the handle for selective disclosure. |
| Operator can see the order | **drand timelock encryption** (tlock, IBE over BLS12-381) | The browser encrypts to a future drand round. The operator holds bytes it *provably* cannot open until the League of Entropy (12-of-22 threshold) publishes that beacon — which is after the batch is frozen. This is cryptography, not a promise. |
| Seeing it still helps | **Uniform-price batch auction** | Every order in an epoch clears at one price, so a front-run + back-run buys and sells at the *same* price. The sandwich nets $0 by construction, not by detection. |
| Was the settlement honest? | **On-chain FTSO check** | `DorrBatchSettlement` re-reads FTSO v2 itself and reverts `PriceOutOfBand` if our clearing price is out of band. The referee is the chain. |

The fourth is the one that makes the first three safe to use. Privacy without it just moves the trust from "the venue won't front-run me" to "the venue won't lie about the price."

## 3. Why Flare specifically

- **FTSO v2** is an on-chain oracle a *contract* can read. That's what lets settlement be checked by the chain rather than by us — the entire integrity story depends on it. An off-chain price API could not do this.
- **FAssets/FXRP** gives real, non-synthetic collateral on a testnet, so the vault holds an actual asset rather than a token we mint at will. That is why `/faucet` refuses: minting our own collateral would make the solvency attestation meaningless.
- **Confidential compute** lets the matching engine hold the decryption key in an enclave and attest to what it computed, with the attestation verified on-chain and bound to the exact batch payload.

## 4. Market structure: oracle-priced vAMM

A constant-product virtual AMM (`base × quote = k`) with price impact, re-centered to the FTSO index by a keeper when drift exceeds 5 bps.

**Why not an order book:** a perp needs a counterparty. A vAMM lets a single trader open a leveraged position with no one on the other side, which is what makes a hackathon demo possible at all — and it makes the sandwich demo *real*, because a bot can genuinely walk the curve against a victim.

**The cost:** the vAMM is the operator's, so the clearing math is auditable but not proven. That is stated plainly rather than papered over.

## 5. Trust model

| Actor | Can they see your order? |
|---|---|
| The public / mempool | **No** — only a 32-byte commitment |
| MEV bots | **No** — and even with the order, uniform pricing makes it worthless |
| The operator | **No, for a sealed order** — it holds ciphertext until the drand round lands |
| The enclave | Yes, at clearing time — that's its job; it signs an attestation of what it did |
| An auditor you choose | **Yes, if you disclose to them** — and they can verify it against the commitment |

What is **cryptographic** today: order confidentiality (public *and* operator), uniform-price clearing, self-custody of collateral, and the on-chain price band.

What is **trusted** today: operator liveness and censorship (the on-chain membership root makes censorship detectable, not impossible); the clearing computation itself (auditable, not ZK-proven); liquidation (off-chain keeper); and **margin backing an open position is not locked on-chain** — the one gap we would close first. See [SECURITY](./docs/SECURITY.md#️-known-gap-open-position-margin-is-not-locked-on-chain).

## 6. Deliberate scope cuts

| Cut | Why |
|---|---|
| ZK-proven clearing | A fixed-N circuit proving the uniform-price rule was applied correctly is the right v2 move, but the on-chain FTSO band already prevents the *harmful* version of a wrong price. |
| On-chain liquidation | Needs the margin lock first; the two are coupled. |
| Cross-margin / portfolio margin | Isolated margin keeps the accounting auditable, which matters more in v1 than capital efficiency. |
| Per-order on-chain anchoring | One transaction per order is the wrong economics. The batch record proves membership for the whole epoch at once. |

## 7. What was inherited, and from where

- **Perps core + terminal UI** — UniPerp: the vAMM, margin/funding/liquidation math, and the trading terminal.
- **Anti-front-running framing** — Nucast's Anti-Front-Running-ZKPerps research: the commit-then-reveal order lifecycle and the A/B sandwich demonstration.

The privacy mechanism itself (drand timelock sealing, uniform-price batch clearing, enclave attestation, and the FTSO-checked settlement contract) is dorr's own, and is what the project should be judged on.
