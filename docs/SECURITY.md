# 🔒 Security, privacy & honest scope

Four questions matter: **can the public see my order?** (no), **can the *operator* see or front-run my order?** (no, if you seal it — via drand timelock), **can someone place a trade as me?** (no), and **is it fully trustless?** (not yet — and we say exactly where).

## 1. Privacy — the public can't see your order

Every order is published only as a commitment:

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
          at ONE uniform price → open positions → settle the batch on Flare
```

- **Operator-blind** — the operator holds only ciphertext until drand (the **League of Entropy**, a live 12-of-22 threshold network) publishes round `R`'s beacon, which is *after* the batch is frozen. It never sees your order in time to trade ahead of it. *Verified live: the operator's decrypt is refused (`"too early — decryptable at round N"`).*
- **No ordering edge** — the whole epoch clears at one uniform price, so a bot that inserts itself pays the same price ($0 profit) even if it *could* see the order.
- **Censorship evidence** — the exact sealed-batch membership root is recorded on **Flare** at settlement by `DorrBatchSettlement.settleBatch` (live-verified on Coston2: [`0x3a732edf…`](https://coston2-explorer.flare.network/tx/0x3a732edf643605afbbfaa0c98bd1bc6214ab894759415e7c5a5b76e2209e3312)), so the operator can't fabricate, hide, or reorder the set. The same call is gated by the contract's own FTSO re-read and the enclave quote — see §2d.

Proven by `test/sealbid.test.ts` + `test/sealed-e2e.test.ts` (8 tests against the **live** drand network): operator-blind, round-trip, uniform clearing, commitment binding, sealed→position, tamper-drop-and-refund, future-round-stays-sealed. Driveable from the UI ("Seal from the operator" switch) — the browser does the encryption, so the operator never receives plaintext.

**Residual trust here:** drand's threshold (external/decentralized, not the operator) and operator **liveness/censorship** (evidence via the on-chain membership root, not prevention). The clearing math is **auditable, not yet ZK-proven**.

## 2c. Non-custodial vault — the operator can't seize your collateral

A trusted-operator v1 usually means the operator custodies your funds. dorr ships a **non-custodial vault** (`contracts/src/DorrVault.sol`) holding real FXRP on Flare, where FXRP leaves **only** via the depositor's own `withdraw()`:

```solidity
function withdraw(uint256 amount) external {
    Account storage a = _accounts[msg.sender];      // msg.sender — never a third party
    if (amount > a.balance - a.locked) revert InsufficientFree();
    a.balance -= amount;
    fxrp.safeTransfer(msg.sender, amount);          // paid to the caller, always
}
```

The settlement contract can only `lockMargin` / `releaseMargin` / `applyPnl` — and `applyPnl` reverts unless the deltas sum to zero, so settlement can move value *between* traders but can never drain the vault. There is no admin path, no pause, no operator withdrawal.

**Proven by `contracts/test/DorrVault.t.sol`** (9 tests + a fuzz run over arbitrary deposit/lock/withdraw triples): `test_NoOneElseCanTakeYourCollateral`, `test_SettlementCannotDrainVault`, `test_PnlMustBeZeroSum`, `test_OnlySettlementCanLockMargin`, `testFuzz_WithdrawNeverExceedsFree`. Live-exercised on Coston2: deposit ([`0x1d716fc5…`](https://coston2-explorer.flare.network/tx/0x1d716fc540915da12051700e4a74b74160804b8bf45d60ab2f0b99149b910b71)) and depositor-signed withdrawal ([`0x32d2aad1…`](https://coston2-explorer.flare.network/tx/0x32d2aad1f82f3b1ea3791a397f40cdd78de04aefbdab88351c134473baa98bd2)), both from the browser with the operator uninvolved.

So collateral is **self-custodied**: even if the operator vanishes or turns malicious, your deposit is reclaimable with your key.

### Margin behind an open position is locked on-chain

Collateral backing a position isn't just recorded in the operator's ledger — it is
reserved in the vault itself. `DorrBatchSettlement` exposes a keeper-gated
`lockMargin`/`releaseMargin` passthrough (the vault only accepts margin calls from
its settlement contract), and the operator locks **before** it acknowledges an
order. So `withdraw()` refuses anything above `balance - locked`:

```
balance 3.6 FXRP, locked 1.5 (two open positions)
  withdraw(3.0) → reverts InsufficientFree   ← the position stays backed
  withdraw(2.0) → succeeds                    ← free collateral is still yours
```

*Verified against the live vault on Coston2, exactly as shown above.*

Locking can never move value: it only shifts a trader's own balance between
"free" and "locked", reserves are untouched, and `withdraw()` still pays only the
depositor. Proven by `contracts/test/MarginCustody.t.sol` (9 tests + a fuzz run
asserting a withdrawal never exceeds `balance − locked` for any lock amount).

The lock is awaited on the increasing direction (commit, seal, add-margin) so the
chain reserves collateral before an order is confirmed; releases are fired
optimistically and a 60-second sweep re-converges any account whose on-chain
`locked` drifts from the ledger.

## 3. Auth — only you can place your trade

Every value-moving action (`commit` / `execute` / `close` / `withdraw`) is bound to an **EIP-191 wallet signature**:

```
message = "dorr:<action>\n" + JSON(params, keys sorted) + "\nts:<ms>"
client:  sig = wallet.signMessage(message)            // EIP-191 personal_sign, MetaMask/Rabby/…
server:  recover(message, sig) === claimedSigner      // secp256k1 recovery, no public key sent
```

The operator checks, in order: **freshness** (±120s replay window), **no-reuse** (signature dedupe), **signer == acting address**, and the **cryptographic signature** itself — the signer is *recovered* from the signature, so a caller cannot act for an account whose key they don't hold. A throwing/garbage signature is treated as rejection, never a crash.

**Proven end-to-end** in `test/auth-crypto.test.ts` against the production verifier with real EVM keys:
- ✅ a genuine signature is accepted
- ❌ tampered params (e.g. inflated margin) are rejected
- ❌ a signature from wallet A can't authorize an action for address B
- ❌ a malformed signature is rejected rather than throwing

Also verified against a running operator with `DORR_AUTH=1`: signed → accepted, unsigned → `401 missing auth`, forged → `401 invalid signature for this message/address`.

Enable enforcement with `DORR_AUTH=1` (the web signs automatically when a wallet is connected). Default is off so the wallet-less demo and E2E run out of the box.

## Threat model (v1)

| Threat | Status | How |
|--------|--------|-----|
| Mempool/MEV front-running (public) | **mitigated** | order is a hash until execution |
| **Operator** seeing / front-running your order | **mitigated** (sealed orders) | drand timelock — operator holds ciphertext, can't decrypt until the batch is frozen |
| Ordering advantage within a batch | **mitigated** | uniform-price batch clearing — a sandwich nets $0 |
| Operator fabricating/hiding batch membership | **mitigated** (evidence) | exact sealed-batch root recorded on Flare by `settleBatch` |
| Operator settling at an off-market price | **mitigated** (enforced on-chain) | `DorrBatchSettlement` re-reads FTSO v2 itself and reverts `PriceOutOfBand` beyond `maxDriftBps` — observed rejecting a real batch |
| Forged enclave quote | **mitigated** (enforced on-chain) | attestation is bound to `keccak256(epochId, membershipRoot, clearingPrice, orderCount)`; a quote for another payload fails |
| Order-detail leakage on-chain | **mitigated** | only commitment + membership root ever hit chain |
| Placing/closing someone else's trade | **mitigated** | EIP-191 auth bound to the recovered address |
| Signature replay | **mitigated** | freshness window + dedupe |
| Commitment preimage recovery | **mitigated** | 128-bit nonce, SHA-256 |
| Operator seizing user collateral | **mitigated** (non-custodial vault) | `DorrVault.withdraw()` pays `msg.sender` only; settlement is zero-sum and cannot drain reserves |
| Withdrawing margin that backs an open position | **mitigated** (enforced on-chain) | the keeper locks margin in the vault before an order is confirmed; `withdraw()` reverts above `balance − locked` |
| Clearing/PnL correctness on-chain | **partly enforced** | price band + attestation + zero-sum PnL are enforced by the contract; the uniform-price computation itself is auditable, not ZK-proven |
| Operator liveness / censorship | **trusted** (v1) | anchored membership gives evidence, not prevention |

## Honest scope

dorr's guarantee **today** is: *neither the public **nor the operator** can see or front-run a sealed order, the whole epoch clears at one uniform price, a self-custodial vault means the operator **can't seize your collateral**, and the batch's membership and price are recorded on Flare by a contract that independently re-reads FTSO before it will accept them.* What remains **trusted** (so it's **not yet fully trustless**):

- the operator is trusted for **liveness/censorship** — the on-chain membership root makes censorship *detectable*, not impossible;
- the **uniform-price computation is auditable but not ZK-proven** — the operator computes it off-chain; the chain checks the *result* is within FTSO band and carries a valid enclave quote, not that the auction rule was applied correctly;
- **liquidation is off-chain** — the keeper closes positions; nothing on-chain forces it.

**Pitch it as "private order flow the operator itself can't front-run (drand-sealed), uniform-price clearing, and a settlement contract that rejects an off-market price — trusted-operator v1 for clearing-correctness and liveness." That's exactly true. Don't claim "fully trustless."**

### The path to fully trustless (v2)
1. **On-chain liquidation** — enforce margin and liquidation against the FTSO price the settlement contract already reads, so the vault releases funds without trusting a keeper.
2. **ZK-proven clearing** — prove the disclosed clearing price and net flow are the correct output of the uniform-price rule over the committed order set, removing clearing-correctness trust. ✅ **Operator-blindness is already done** via the drand sealed-bid — the operator never sees a sealed order's plaintext.

## Not-secrets, by design
- The **market** you trade and the **timing** of your commit are public. Only side/size/price/leverage/identity are hidden.
- FXRP on Coston2 is a **testnet asset**. dorr holds no minting authority over it — test collateral comes from [Flare's faucet](https://faucet.flare.network/coston2), not from the operator.
