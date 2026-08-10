# 👛 Wallets & test setup

## TL;DR

dorr connects to **any EIP-1193 EVM wallet on Flare Coston2** (chain id `114`). Use **MetaMask** or **Rabby**. Margin is **FXRP**, a real ERC-20 on Coston2 — dorr cannot mint it, so test collateral comes from Flare's own faucet.

## Supported wallets

The connect flow talks to `window.ethereum` directly, so **any injected EVM wallet works**. Each value-moving action is signed with **EIP-191 `personal_sign`**, and the operator recovers the signer from the signature.

| Wallet | Recommendation | Notes |
|--------|----------------|-------|
| **MetaMask** | ⭐ primary | The default. dorr offers to add/switch to Coston2 for you (`wallet_addEthereumChain`). |
| **Rabby** | ⭐ best for dev | Clean network switching and a readable signature prompt. |
| **Brave Wallet** | ✅ | Injects `window.ethereum`; note it can inject *after* page load — dorr keeps looking, so no reload needed. |
| **Coinbase Wallet / OKX / Trust** | ✅ | Any injected EIP-1193 provider with `personal_sign`. |

If nothing is installed, the app says so plainly and never crashes wallet-less.

## Setup in ~2 minutes

1. **Install** MetaMask or Rabby (browser extension).
2. **Open dorr** (`http://localhost:3000`) and click **Connect Wallet**.
3. **Switch to Coston2.** If you're on the wrong network the navbar shows **Switch to Coston2** — one click adds and selects it. (Manual: chain id `114`, RPC `https://coston2-api.flare.network/ext/C/rpc`, explorer `https://coston2-explorer.flare.network`.)
4. **Get C2FLR + FXRP** from **[Flare's Coston2 faucet](https://faucet.flare.network/coston2)** — it hands out gas (C2FLR) *and* test FXRP. The **Get FXRP** button in the Collateral panel opens it.
5. **Deposit** FXRP into the vault from the Collateral panel. Your wallet signs an ERC-20 `approve` and then `DorrVault.deposit(uint256)` — two real transactions.
6. **Trade.** Free margin appears as soon as the deposit confirms.

## Why can't dorr just give me FXRP?

FXRP on Coston2 is a real asset and dorr holds no minting authority over it. An operator-side faucet would have to credit *unbacked* margin, which would break the vault's solvency invariant — so `/faucet` deliberately refuses and points you at Flare's faucet instead.

## No wallet? You can still demo

- **Live prices + charts** for all 6 markets work with no wallet.
- The **Attack Lab** — sandwich attack, sealed-order refusal, batch auction, A/B comparison — runs entirely without a wallet. It's the money shot and needs nothing installed.
- Panels that need an account show a plain "connect a wallet" state rather than empty boxes.

## Gotchas

- **Wrong network** is the #1 issue. dorr detects it, shows **Switch to Coston2** in the navbar, and a deposit/withdraw attempt offers to switch for you rather than failing with a chain-id error.
- **No C2FLR** → the approve/deposit transaction can't pay gas. The Flare faucet gives you both C2FLR and FXRP in one request.
- **Signature prompts** — with `DORR_AUTH=1` the wallet asks you to sign each trade action. That's the point: only you can place your trade. The default demo mode doesn't enforce it.
- **Withdrawals are yours alone.** `DorrVault.withdraw()` pays `msg.sender`, so the withdrawal is signed by your wallet and the operator is not involved. There is no operator-routed withdrawal path.
