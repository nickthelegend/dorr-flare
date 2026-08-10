# dorr — demo script (≈3 min)

The one line: **on a public perp your order sits in the mempool and gets front-run. On dorr the operator itself only holds ciphertext until the batch is frozen — and the settlement contract rejects an off-market price.**

## Pre-flight (do before you're on stage)

```bash
cd dorr-flare
bun install
bun run --cwd services/operator start   # terminal A → :8791 (wait for the six "feed ok" lines)
bun run --cwd apps/web dev              # terminal B → http://localhost:3000
```

- Have MetaMask on **Coston2** with C2FLR (gas) and FXRP (margin) from https://faucet.flare.network/coston2.
- Deposit once before you're on stage so you're not waiting on confirmations mid-pitch.
- Keep `coston2-explorer.flare.network` open in a tab.

## Beat 1 — "this is a real perp" (30s)

- Connect MetaMask. Point at the 6 live markets (FLR/XRP/BTC/ETH/SOL/DOGE), prices ticking from **FTSO v2** — read on-chain, not from a price API.
- Show the Collateral panel: real FXRP in `DorrVault` on Coston2. Click the vault address through to the explorer. *"Collateral is a real asset, and only I can withdraw it."*

## Beat 2 — the foil: a public order gets sandwiched (45s)

- Open the **Attack Lab** → **Attack** tab. Run the sandwich against a *public* order.
- Read the numbers off the card: the victim pays ~150 bps more and the bot pockets it. *"This is what every public perp does to you."*

## Beat 3 — the hero: the operator can't even read it (60s)

- Close the lab. Flip **"Seal from the operator (drand timelock)"** on, and submit a market order.
- The button reads **SEAL LONG — OPERATOR-BLIND**. Point at the activity log: *"Sealed order to drand round N — operator can't read it until then."*
- Open **Attack Lab → Sealed**: the operator's own decrypt attempt is **REFUSED** with the live drand round. *"That's not a policy. It's cryptography — the League of Entropy hasn't published that beacon yet."*
- Show the public feed: **only a 32-byte commitment hash**. Same order, nothing exposed.

## Beat 4 — the chain is the referee (45s)

- When the round lands, the epoch clears at **one uniform price** and settles on Flare.
- Click the tx in the activity log → the Coston2 explorer. *"`DorrBatchSettlement` didn't take our word for the price. It re-read FTSO itself and would have reverted `PriceOutOfBand` if we'd lied — we've watched it do exactly that."*
- Open **Attack Lab → Batch**: the sandwich against a batch-cleared order nets **$0.00** vs `$152` on a sequential venue. *"Uniform price means front-running earns nothing even if you could see the order."*

## Beat 5 — private, but provable (20s)

- On an open position hit **Disclose** → audience "regulator" → **Generate**.
- Switch to the **Verify** tab, paste it back: **VERIFIED**. Then change one digit of the size and verify again: **REJECTED**.
- *"Private by default, provably disclosable. Compliance without surveillance."*

## The honest footnote (say it — it's a strength)

"v1 has a trusted operator doing matching and execution, like a sequencer. What's cryptographic today: the operator can't see or front-run a sealed order, the epoch clears at one price, collateral is self-custodied, and the settlement contract enforces the price band on-chain. What's still trusted: operator liveness, the clearing math isn't ZK-proven, liquidation is off-chain — and margin backing an open position isn't locked on-chain yet, which is the first thing we'd fix."

## If something is slow on stage

The sealed path waits on a real drand round (~30s to the epoch close). Talk through the privacy model while it runs — that *is* the pitch. Nothing is faked; every tx hash is real and clickable.

## Verified live evidence (this build, Coston2)

See [README](./README.md#proven-live-on-coston2) for the actual transactions: vault deposit, sealed batch settled on Flare, and a depositor-signed withdrawal.
