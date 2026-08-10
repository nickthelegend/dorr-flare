# 👛 Wallets & test setup

## TL;DR

dorr's frontend connects to **any CIP-30 Cardano wallet, set to Preprod**. Use **Lace** (the Cardano + Midnight reference wallet) or **Eternl** (smoothest for testnet dev). You do **not** need a Midnight browser wallet — see [below](#do-i-need-a-midnight-wallet).

## Supported wallets

The connect flow uses Mesh (`BrowserWallet.getAvailableWallets()`), so **anything CIP-30 that's installed shows up**. Each trade action is signed with the wallet's `signData` (CIP-30 data signature).

| Wallet | Recommendation | Notes |
|--------|----------------|-------|
| **Lace** | ⭐ primary | IOG's wallet; the one that also supports **Midnight**, so it matches dorr's story end-to-end. Clean Preprod switch, reliable `signData`. |
| **Eternl** | ⭐ best for dev/testing | Fastest testnet workflow, easy network toggle, great dApp connector, hardware-wallet support. My pick for iterating. |
| **Nami** | ✅ | Now Lace-powered; CIP-30 + `signData` work. |
| **Typhon** | ✅ | Full CIP-30, `signData`, good Plutus support. |
| **Vespr** | ✅ | CIP-30; mobile-first but has an extension. |
| **NuFi / Begin / Gero / Flint / Yoroi** | ✅ (varies) | Any CIP-30 with `signData`. Most work; a few older ones have quirky `signData`. |

If nothing is installed, the connect dropdown shows install links — the app never crashes wallet-less.

## Setup in ~2 minutes

1. **Install** Lace or Eternl (browser extension).
2. **Switch to Preprod.** Lace: Settings → Network → Preprod. Eternl: the network dropdown → Preprod.
3. **Get test ADA** (for tx fees — deposits/withdrawals are real preprod txs):
   → https://docs.cardano.org/cardano-testnets/tools/faucet — pick **Preprod**, paste your wallet address, request. A couple of tADA is plenty.
4. **Open dorr** (`http://localhost:3000`), click **Connect**, pick your wallet, approve.
5. **Get dUSD** — hit the in-app **faucet** (mints test dUSD straight to your address; a real preprod mint tx).
6. **Deposit** dUSD to the vault (your wallet signs + submits a real tx), then **trade**.

## Do I need a Midnight wallet?

**No — not in v1.** dorr's Midnight ZK proving runs **server-side** in the operator (it holds the Midnight wallet and drives the proof server). Your browser wallet only ever signs **Cardano** things: the vault deposit, the trade-authorization signatures, and the withdrawal.

That's why **any CIP-30 Cardano wallet works**, and why **Lace is *recommended* but not *required*** — Lace is the natural choice because it's also the Midnight wallet, so it fits a future v2 where the trader proves in-browser. Today the operator proves on your behalf (it already sees your order to execute it, so no extra trust is given up).

## No wallet? You can still demo

- **Live prices + charts** for all 5 markets work with no wallet.
- The **A/B sandwich showcase** (the money shot) runs with no wallet — it's a pure demonstration.
- For a full trade without a real wallet, the operator has a `/demo/seed` endpoint (instant off-chain margin) — handy for local walkthroughs, though real deposits/settlement need a connected wallet.

## Gotchas

- **Wrong network** is the #1 issue — the wallet **must be on Preprod**, not Mainnet or Preview. Symptoms: address starts with `addr1…` (mainnet) instead of `addr_test1…`.
- **No tADA** → the deposit tx fails at fee selection. Fund from the faucet first.
- **`signData` prompts** — with secure mode (`DORR_AUTH=1`) the wallet asks you to sign each trade action. That's the point: only you can place your trade. In the default demo mode it won't prompt.
