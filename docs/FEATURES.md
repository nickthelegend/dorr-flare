# ⚡ Perps features

dorr isn't a toy perp — it has the order types and position management real traders expect, and it extends its **privacy** into the features that matter most against MEV.

## The differentiators (privacy where it counts)

### 🕶️ Private limit orders
A limit order is committed as a **SHA-256 hash** and **rests invisibly**. The public feed shows only `{ market, commitmentHash }` — never your side, size, or **limit price**. A keeper watches FTSO and triggers execution when the price crosses.

> **Why it wins:** on a transparent DEX, resting limit orders are a public target — searchers front-run them and pick them off. On dorr, **no one can see your resting orders**, so there's nothing to front-run. `GET /orders/resting/:address` returns *your* orders (owner-only); everyone else sees hashes.

### 🎯 Hidden stop-loss / take-profit (anti stop-hunting)
Attach a stop-loss and/or take-profit to a position. The levels are **never public** — the keeper closes the position when FTSO crosses them, but the trigger prices live only with the operator (from your revealed order), not on any feed.

> **Why it wins:** **stop-hunting** — pushing price to trigger visible stops, then reversing — is one of the most hated forms of perp MEV. If the stops are invisible, they can't be hunted. This is dorr's thesis applied to the single feature traders lose the most money to.

Verified in tests: setting a stop never leaks the level to `/feed`; the keeper fires it when crossed (`test/features.test.ts`).

### 🗡️ MEV attack lab — run the attack, watch it fail
A built-in tool (`POST /demo/attack`) runs the *same* order two ways with a step-by-step, animated attack timeline:
- **Transparent DEX** — the bot sees the order in the clear, front-runs, the victim is **SANDWICHED** (~$150 / 150 bps stolen), bot profits.
- **dorr** — the bot sees only the 32-byte commitment, runs **25,000 real SHA-256 preimage guesses → 0 matches**, and **ABORTS**. There's nothing to front-run.

> **Why it wins:** it doesn't *claim* MEV-resistance, it **demonstrates** it — a real attacker bot trying and failing, live, with the "0 / 25,000 cracks" line as the proof. Live result: `PUBLIC SANDWICHED $152.85 / DORR ATTACK FAILED`.

### ⚖️ Batch auction — one uniform clearing price (front-running is *impossible*, not just hidden)
The commitment **hides** an order until execution. The batch auction removes the *economic value of ordering* entirely: every order collected in an epoch clears at **one uniform price** (`POST /demo/batch`, `GET /batch/preview`). Matched longs and shorts cross internally at zero pool impact; only the **net imbalance** touches the vAMM. Because arrival order no longer changes anyone's fill, a bot that inserts a front-run **and** back-run into the same epoch buys and sells at the *identical* price — the sandwich nets **$0**.

> **Why it wins:** hiding an order defeats a bot that must *see* it; uniform-price clearing defeats a bot even if it *could*. It's the difference between "you can't find the order" and "finding it earns you nothing." Live result: **batch bot profit `$0.00` vs the same sandwich on a sequential venue `$152.87`.** Each epoch emits a `batchDigest` — a compact attestation that it cleared uniformly.

### 🔐 Sealed-bid — real privacy *from the operator itself* (drand timelock)
The commitment hides an order from the **public**; this hides it from the **operator too**. The trader's client **timelock-encrypts** the order to a future **drand** round (the League of Entropy — a live, decentralized **12-of-22 threshold network**) via `tlock-js` (real IBE over BLS12-381). The operator receives only ciphertext + a hash and **physically cannot decrypt it** until that round's beacon is published — which happens only *after* the epoch's batch is frozen. Then the whole epoch clears at one uniform price.

It's a **real execution path**, not just a demo — and it's wired into the order form (a **"Seal from the operator"** switch on private market orders, where your browser does the timelock encryption). `POST /orders/seal` submits a sealed order (the operator locks only a public margin *bound* — exact size/side/price stay sealed); a **6-second keeper** calls `settleSealedBatch` once the round lands to decrypt, verify each commitment, clear the survivors at one uniform price, and open a position each. It then **settles the epoch on Flare** (a real Coston2 tx) — a public, immutable record of which orders were in the epoch, so the operator can't fabricate, hide, or reorder the set. `POST /demo/sealed` proves the operator-blindness live, `GET /batch/epoch` shows the current drand round, `GET /orders/sealed/:address` shows your sealed orders, and `GET /anchors` shows the on-chain batch anchors.

> **Why it wins:** every other "private" DEX on a single sequencer still lets the sequencer read your order and trade ahead of it. dorr borrows drand as an **external decryption committee**, so a lone operator is **cryptographically blind** — it never sees your order in time to front-run, and uniform pricing means a bot that inserts itself pays the same price ($0 profit). This is the encrypted-mempool / sealed-bid model (Shutter / Penumbra / CoW) made single-operator-friendly. **Verified live: order sealed to drand round 30300792, operator's decrypt REFUSED (`"too early — decryptable at round 30300792"`), epoch cleared at one price, bot profit `$0`.** Proven by 5 tests against the real drand network (`test/sealbid.test.ts`).
>
> **Honest residual trust:** drand liveness/threshold (external, decentralized — *not* the operator); operator censorship/liveness — **mitigated** by recording the exact sealed-batch membership root on Flare at settlement (live-verified: `0xc3a1c184…`), so the order set is publicly auditable, though this is *evidence*, not prevention; and the clearing math is not yet ZK-proven (a fixed-N circuit is the mapped next step). What IS cryptographically real, end-to-end: **confidentiality from the operator** — it cannot see or front-run your order. That's the piece a trusted-operator v1 otherwise can't claim.

### 🔓 Selective disclosure — private by default, provably disclosable
Your position is a hidden commitment. When you *choose*, you open it to a specific auditor/counterparty: `POST /disclose` hands them the revealed fields + nonce; `POST /disclose/verify` recomputes `SHA-256` and checks it equals the **on-chain commitment**. They learn exactly what you traded; the public still learns nothing.

> **Why it wins:** this is **rational privacy** applied to a perp — no other perps DEX has it. Compliance without surveillance. Verified: a genuine disclosure is accepted, a tampered one (inflated leverage) is rejected.

### ⚓ On-chain batch record — provable membership, hidden contents
Rather than paying a transaction per order, dorr records the **epoch** on Flare: `DorrBatchSettlement.settleBatch` stores the sealed batch's `membershipRoot` and its single clearing price. That proves *which* orders were in the set and *what* price they all got, while every order's side/size/leverage stays hidden behind its commitment. It's the companion to selective disclosure: the batch record proves *when and with whom* you cleared, a disclosure later proves *what* — both checkable against the same hashes.

> **Why it wins:** the operator can't fabricate, drop, or reorder the set after the fact, and the acceptance isn't its decision — the contract re-reads FTSO and refuses an off-market price. Live on Coston2: [`0xc3a1c184…`](https://coston2-explorer.flare.network/tx/0xc3a1c184d35ccb1799425df0). Surfaced in the activity log with a clickable explorer link.

### 📜 Activity log
Every action — commit, limit-rest, fill, partial close, stop-loss/take-profit fire, liquidation, margin change, cancel, anchor, deposit/withdraw, disclosure — is recorded to a per-trader timeline (`GET /events?address`) with tx links. Hidden stop levels stay generic in the log (they're the point). Nice, readable position history.

## Exchange integrity (trust the operator less)

### 🔑 Non-custodial vault
`DorrVault` (Solidity, on Coston2) pays FXRP out **only to the depositor** — `withdraw()` acts on `msg.sender`, so there is no operator path, no admin path, and no pause. Settlement is granted a strictly weaker power: it may lock/release margin and apply PnL, and `applyPnl` reverts unless the deltas sum to zero, so it can move value *between* traders but never drain reserves. Proven by 9 Foundry tests plus a fuzz run over arbitrary deposit/lock/withdraw triples, and exercised live from the browser: deposit [`0x1d716fc5…`](https://coston2-explorer.flare.network/tx/0x1d716fc540915da12051700e4a74b74160804b8bf45d60ab2f0b99149b910b71), depositor-signed withdrawal [`0x32d2aad1…`](https://coston2-explorer.flare.network/tx/0x32d2aad1f82f3b1ea3791a397f40cdd78de04aefbdab88351c134473baa98bd2).
>
> Margin behind an open position is **reserved in the vault**, not just in the ledger: the keeper locks it before an order is confirmed, so `withdraw()` reverts above `balance − locked`. Verified live on Coston2.

### 🛡️ Proof of solvency
`GET /ops/solvency` reads the **live on-chain FXRP** held in the margin vault and attests that reserves ≥ the sum of every credited balance (what all users could withdraw). It returns the vault address, reserves, liabilities, collateralization ratio, and a `sha256` attestation — so **anyone can recompute reserves independently** from the returned address and check the claim. A trusted-operator v1 that lets you *verify* the trust.

### 📊 Exchange stats
`GET /stats` surfaces per-market **open interest** (long/short), **skew**, **funding rate**, mark vs index, and open positions, plus global TVL, volume, insurance-fund size, and anchor count. Real risk telemetry, computed from live state + FTSO.

### 🛑 Oracle-divergence guard
Every execution is refused if the vAMM mark has drifted more than `MAX_ORACLE_DIVERGENCE_BPS` (200 bps) from the FTSO index — a fill is only allowed when the venue price agrees with the oracle. Stops a taker from being handed a mispriced entry on a manipulated or stalled pool. Verified in `test/features-v2.test.ts`.

### 📉 Per-market open-interest caps
Each market has a `maxOiUsd` risk limit; `/orders/commit` rejects an order that would push the market's reserved open interest (open positions + committed orders) past the cap, so no single market can over-lever the vAMM. Utilization is exposed in `/stats` (`oiUtilizationPct`). Verified in `test/features-v2.test.ts`.

## Position management (table stakes, done right)

| Feature | What it does | API |
|---------|--------------|-----|
| **Partial close** | Close 25% / 50% / any fraction; realizes proportional PnL, shrinks size + margin, keeps the rest open | `POST /positions/:id/close { fraction }` |
| **Add margin** | Top up a position → lower leverage, safer liquidation price | `POST /positions/:id/margin { delta: +N }` |
| **Remove margin** | Withdraw excess margin → higher leverage (refused if it would risk liquidation) | `POST /positions/:id/margin { delta: -N }` |
| **Cancel order** | Cancel a resting (committed) order and release its locked margin back to free | `POST /orders/:id/cancel` |
| **Slippage guard** | Reject a fill whose realized slippage vs the reference exceeds your tolerance (previewed on a scratch pool, so a rejected fill never perturbs the vAMM) | `maxSlippageBps` on commit |
| **Oracle-divergence guard** | Refuse a fill when the vAMM mark drifts > 200 bps from the FTSO index (manipulated/stalled venue) | automatic on execute |
| **Liquidation price** | Live liq price per position, from the maintenance-margin formula | in `GET /positions/:address` |

## Order execution

- **Market orders** — fill immediately against the oracle-priced vAMM (FTSO mark + constant-product impact).
- **Limit orders** — rest privately, keeper-triggered when the index crosses (`LONG` fills at/below, `SHORT` at/above).
- **Leverage** — up to 20×; margin in FXRP; funding accrues from the vAMM-mark vs FTSO-index premium.
- **Liquidation** — keeper closes positions below the 5% maintenance margin; fees flow to the insurance fund.

## How the keeper works

One 5-second loop in the operator does three privacy-preserving jobs — and crucially, **all the trigger levels it acts on are hidden from the public**:

```
every 5s:
  scanLimitOrders()  → trigger resting limit orders whose (hidden) price crossed
  scanStops()        → close positions whose (hidden) SL/TP crossed
  scanLiquidations() → close positions under maintenance margin
```

## Everything stays private + auditable

Each feature rides the same rails as a basic trade: the order is a **commitment**, execution runs on the vAMM, and the epoch's clearing is **recorded on Flare**. Limit prices and stop levels are part of the hidden preimage — they never touch a public feed or an on-chain datum in the clear.

## Try it

```bash
# a private limit order that rests until price crosses:
curl -sX POST localhost:8790/orders/commit -H 'content-type: application/json' \
  -d '{"address":"addr_test1…","marketId":"ADA-FXRP","side":"LONG","marginUsd":500,
       "leverage":5,"privacyMode":"private","orderType":"limit","limitPrice":0.14}'

# the public sees only a hash:
curl -s localhost:8790/feed

# you (the owner) can see your resting orders:
curl -s localhost:8790/orders/resting/addr_test1…
```

Tests: `test/features.test.ts` (limit trigger, hidden SL/TP, partial close, add/remove margin, slippage guard) + `test/trading-math.test.ts` (liq price, slippage, trigger math). See [TESTING](./TESTING.md).
