# dorr — demo script (≈3 min)

The one line: **on a public perp your order sits in the mempool and gets front-run; on dorr it's a hash on Midnight until it executes, so it can't be.**

## Pre-flight (do before you're on stage)
```bash
cd dorr
./tools/scripts/dev.sh up            # Midnight localnet (proof 6301 / indexer 8088 / node 9945)
./tools/scripts/dev.sh fund-midnight # once per fresh localnet
./tools/scripts/dev.sh operator      # terminal A → :8790  (waits for "cardanoReady":true)
./tools/scripts/dev.sh web           # terminal B → http://localhost:3000
```
- Pre-warm the proof server: run one throwaway trade so the first on-stage proof isn't cold.
- Have Lace on **preprod** with a little tADA; the app faucets its own dUSD.
- Keep `preprod.cardanoscan.io` open in a tab.

## Beat 1 — "this is a real perp" (30s)
- Connect Lace. Point at the 5 live markets (ADA/BTC/ETH/SOL/DOGE), prices ticking from Pyth.
- Faucet 10k dUSD → **Deposit to vault**. Show the deposit tx on cardanoscan: real dUSD, real UTxO at the vault script. "Collateral is real and on-chain."

## Beat 2 — the foil: public order gets sandwiched (45s)
- Flip the privacy toggle to **public (demo foil)**. Open an ADA long.
- Show the **public feed** panel: side, size, leverage, address — all exposed.
- Hit **A/B demo** (`POST /demo/ab`): "a bot that can see this order front-runs it — the victim pays ~150 bps more, and the bot pockets the difference." Read the numbers off the card.

## Beat 3 — the hero: dorr hides the order (60s)
- Flip the toggle back to **dorr private**. Open the same trade.
- The instant you submit, show the feed again: **only a 32-byte commitment hash**. "Same order. This is everything the public, the mempool, and any bot can see."
- The **proof panel** lights up live: `deploy zkperps-order + proveTraderOrderAuthority` → a real Midnight ZK tx (~40s). "The order's validity is proven in zero-knowledge; the contents never leave the trader."
- Position opens on the vAMM. A **CIP-68 position NFT** lands in the wallet — show it in Lace.

## Beat 4 — settle + anchor on Cardano (45s)
- Close the position. Watch the pipeline:
  1. `proveSettlementTransition` — ZK settlement proof (Midnight)
  2. **`anchor settlement digest` — a real preprod tx**; click through to cardanoscan and show the inline `AnchorDatum` (settlement id, order commitment hash, Midnight tx ref) — "auditable on L1, still reveals nothing private."
  3. `bindL1SettlementAnchor` — ZK proof binding Midnight ↔ Cardano.
- Land the point: **the public could never see or front-run the order; the settlement is auditable on Cardano; the order details were never exposed.**

## The honest footnote (say it — it's a strength)
"v1 has a trusted operator doing the matching/execution, like a sequencer. What's trustless today is the privacy and the L1 audit trail. The path to trustless settlement is Pyth Lazer (live on Cardano) + an Aiken settlement/liquidation validator — the datum and anchor are already there."

## If a proof is slow on stage
Every proof is ~40s. Talk through the privacy model while it runs — that's the pitch, not dead air. Nothing is faked; the tx hashes are real and clickable.

## Verified live evidence (this build, preprod)
See RUNBOOK.md → "Verified evidence" for the actual tx hashes (dUSD mint, vault deposit, ZK proofs, L1 anchor, CIP-68 mint).
