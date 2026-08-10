# 🔒 Security, privacy & honest scope

Four questions matter: **can the public see my order?** (no), **can the *operator* see or front-run my order?** (no, if you seal it — via drand timelock), **can someone place a trade as me?** (no), and **is it fully trustless?** (not yet — and we say exactly where).

## 1. Privacy — the public can't see your order

Every order is a commitment on Midnight:

```
commitment = SHA-256(pairId, side, price, size, leverage, margin, nonce)
```

- **Hiding** — the 32-byte hash reveals none of the fields (tested: no field value appears in the hash; the only public projection contains just `{ market, commitmentHash }`).
- **Binding** — changing *any* field changes the hash (tested field-by-field).
- **Brute-force-proof** — an attacker who knows everything *except* the 128-bit `nonce` still can't match the commitment (tested: 20k guesses, zero hits; the real space is 2¹²⁸).

The single public projection is `publicFeedView()` (`services/operator/src/privacy.ts`) — the *only* code path that exposes an order. `leaksSensitiveData()` asserts a private view carries nothing beyond the safe fields. See `test/privacy.test.ts`.

## 2. Anti-MEV — a bot can't front-run what it can't see

On a public perp, your pending order sits in the mempool; a searcher front-runs it, you fill worse, they profit. dorr removes the *signal*: the public feed shows only a hash until execution.

The **A/B showcase** (`/demo/ab`) proves it both ways:
- **`mode: "sim"`** (default) — deterministic scratch-clone of the live pool; reproducible on stage, leaves the live pool untouched.
- **`mode: "live"`** — runs an **actual** front-run → victim → back-run on the live vAMM (recenter paused, reserves snapshot + restored). A real bot really sandwiches the public victim (~150 bps), and against a dorr-private order it's **blind** ($0). The `integration.test.ts` pins the pool-restore invariant so real traders are never left perturbed.

## 2b. Sealed-bid — the *operator* can't see or front-run your order either

Hiding an order from the public still leaves the operator (the matching engine) able to read it. dorr closes that with a **sealed-bid batch auction over drand timelock encryption**:

```
client:   ciphertext = timelockEncrypt(order, drandRound R)   // tlock-js, IBE over BLS12-381
operator: stores { ciphertext, commitment } — CANNOT decrypt until R's beacon exists
at round R (after the batch freezes): decrypt → verify commitment → clear the epoch
          at ONE uniform price → open positions → anchor the batch membership on Cardano L1
```

- **Operator-blind** — the operator holds only ciphertext until drand (the **League of Entropy**, a live 12-of-22 threshold network) publishes round `R`'s beacon, which is *after* the batch is frozen. It never sees your order in time to trade ahead of it. *Verified live: the operator's decrypt is refused (`"too early — decryptable at round N"`).*
- **No ordering edge** — the whole epoch clears at one uniform price, so a bot that inserts itself pays the same price ($0 profit) even if it *could* see the order.
- **Censorship evidence** — the exact sealed-batch membership root is anchored on **Cardano L1** at settlement (real preprod tx, live-verified `742dc0a9…`), so the operator can't fabricate, hide, or reorder the set.

Proven by `test/sealbid.test.ts` + `test/sealed-e2e.test.ts` (8 tests against the **live** drand network): operator-blind, round-trip, uniform clearing, commitment binding, sealed→position, tamper-drop-and-refund, future-round-stays-sealed. Driveable from the UI ("Seal from the operator" switch) — the browser does the encryption, so the operator never receives plaintext.

**Residual trust here:** drand's threshold (external/decentralized, not the operator) and operator **liveness/censorship** (evidence via the L1 anchor, not prevention). The clearing math is **auditable, not yet ZK-proven**.

## 2c. Non-custodial vault — the operator can't seize your collateral

A trusted-operator v1 usually means the operator custodies your funds. dorr ships a **non-custodial vault** (`packages/contracts-aiken/dorr-vault/validators/owner_vault.ak`) where a deposit can be spent **only by the depositor** (the `owner` pkh in its inline datum):

```aiken
validator owner_vault {
  spend(datum, _r, _utxo, self) {
    expect Some(OwnerDatum { owner }) = datum
    list.has(self.extra_signatories, owner)   // ONLY the owner can move it
  }
}
```

**Live-proven on Cardano preprod** (`services/operator/src/scripts/noncustodial-proof.ts`):
- user deposits 1,000 dUSD → non-custodial vault: [`b675b375…`](https://preprod.cardanoscan.io/transaction/b675b375dd8f0bd35b2759f20f222cca2f5c8825c745a67e13e3fd68255f1fb3)
- **the operator tries to withdraw it → the validator REJECTS the spend** (`failed script execution Spend[1]`) — it *cannot* take user funds;
- the user reclaims with their **own** key, operator uninvolved: [`81ecf30f…`](https://preprod.cardanoscan.io/transaction/81ecf30f57d2e333317e546406344ff53297b2f95582ec74a5a92e0deeef8f5c)

So collateral is **self-custodied**: even if the operator vanishes or turns malicious, your deposit is reclaimable with your key. **Remaining step:** make this the *default* margin vault, which requires the on-chain settlement validator (below) so margin backing an *open* position can't be pulled — non-custodial custody and on-chain settlement are coupled.

## 3. Auth — only you can place your trade

Every value-moving action (`commit` / `execute` / `close` / `withdraw`) is bound to a **CIP-30 wallet signature**:

```
message = "dorr:<action>\n" + JSON(params, keys sorted) + "\nts:<ms>"
client:  sig = wallet.signData( hex(message) )        // Lace/Eternl/…
server:  verifyDataSignature(sig, key, message, addr) // cardano-verify-datasignature
```

The operator checks, in order: **freshness** (±120s replay window), **no-reuse** (signature dedupe), **signer == acting address**, and the **cryptographic signature** itself. A throwing/garbage signature is treated as rejection, never a crash.

**Proven end-to-end** in `test/auth-crypto.test.ts` using a *real* CIP-8 signer (bip32ed25519 + COSE + typhon address):
- ✅ a genuine signature is accepted by the production verifier
- ❌ tampered params (e.g. inflated margin) are rejected
- ❌ a signature from wallet A can't authorize an action for address B

Enable enforcement with `DORR_AUTH=1` (the web signs automatically when a wallet is connected). Default is off so the wallet-less demo and E2E run out of the box.

## Threat model (v1)

| Threat | Status | How |
|--------|--------|-----|
| Mempool/MEV front-running (public) | **mitigated** | order is a hash until execution |
| **Operator** seeing / front-running your order | **mitigated** (sealed orders) | drand timelock — operator holds ciphertext, can't decrypt until the batch is frozen |
| Ordering advantage within a batch | **mitigated** | uniform-price batch clearing — a sandwich nets $0 |
| Operator fabricating/hiding batch membership | **mitigated** (evidence) | exact sealed-batch root anchored on Cardano L1 |
| Order-detail leakage on-chain | **mitigated** | only commitment + anchor digest ever hit chain |
| Placing/closing someone else's trade | **mitigated** | wallet-signature auth bound to address |
| Signature replay | **mitigated** | freshness window + dedupe |
| Commitment preimage recovery | **mitigated** | 128-bit nonce, SHA-256 |
| Operator seizing user collateral | **mitigated** (non-custodial vault) | `owner_vault` — only the depositor can spend; live-proven: the operator's withdrawal attempt is **rejected on-chain** |
| Clearing/PnL correctness on-chain | **not enforced** (v1) | clearing is auditable + membership-anchored, not yet ZK-proven |
| Operator liveness / censorship | **trusted** (v1) | anchored membership gives evidence, not prevention |

## Honest scope

dorr's guarantee **today** is: *neither the public **nor the operator** can see or front-run a sealed order, the whole epoch clears at one uniform price, a self-custodial vault means the operator **can't seize your collateral**, and the batch membership + settlement leave an auditable Cardano L1 trail.* What remains **trusted** (so it's **not yet fully trustless**):

- the operator is trusted for **liveness/censorship** (the L1 membership anchor makes censorship *detectable*, not impossible) and, in the **default trading path**, still manages the margin vault (the non-custodial `owner_vault` is built + on-chain-proven, but making it the default is coupled to on-chain settlement — see below);
- the **clearing/PnL math is auditable but not yet ZK-proven** — the operator computes it off-chain (the Midnight ZK legs attest the pipeline: order authority, match, settlement transition).

**Pitch it as "private order flow the operator itself can't front-run (drand-sealed), uniform-price clearing, auditable L1 trail — trusted-operator v1 for custody + clearing-correctness." That's exactly true. Don't claim "fully trustless" or "the ZK proves the trade math."**

### The path to fully trustless (v2)
1. **On-chain price** — Pyth Lazer is live on Cardano (Aiken pull-oracle); feed it into a validator.
2. **On-chain settlement/liquidation** — an Aiken validator that enforces margin, PnL, and liquidation against that price, so the vault releases funds *trustlessly* (removes custody trust).
3. **ZK-proven clearing** — a fixed-N Compact `zkperps-batch` circuit that proves the disclosed clearing price + net flow are the correct output of the uniform-price rule over the committed orders (removes clearing-correctness trust). ✅ **Operator-blindness (item was "user-held keys") is already done** via the drand sealed-bid — the operator never sees a sealed order's plaintext.

## Not-secrets, by design
- The **market** you trade and the **timing** of your commit are public (they're on-chain anyway). Only side/size/price/leverage/identity are hidden.
- dUSD is a **mock testnet** stablecoin (operator-mintable) — it's collateral for the demo, not a real asset.
