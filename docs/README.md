<div align="center">

# 📚 dorr docs

**Perps you can't front-run.** Private order flow on Flare.

</div>

Start at the [project README](../README.md) for the pitch and quickstart. These docs go deeper.

| Doc | What's inside |
|-----|---------------|
| 🏗️ [ARCHITECTURE](./ARCHITECTURE.md) | The five layers, the trade lifecycle (sequence diagram), the privacy boundary, and the trust model — with diagrams. |
| ⚡ [FEATURES](./FEATURES.md) | Private limit orders, hidden stop-loss/take-profit (anti stop-hunting), partial close, add/remove margin, slippage guard. |
| 👛 [WALLETS](./WALLETS.md) | Which wallets to test with, Coston2 setup, and how to fund FXRP. |
| 🔌 [API](./API.md) | Every operator endpoint, the contracts, and the on-chain artifacts. |
| 🔒 [SECURITY](./SECURITY.md) | Wallet-signature auth, the privacy/MEV model, and an honest scope statement. |
| 🧪 [TESTING](./TESTING.md) | The 47-test suite + the assertive on-chain E2E, and how to run each. |
| 🎬 [DEMO](../DEMO.md) | The 3-minute stage script. |
| 📐 [DESIGN](../DESIGN.md) | The original decision log that shaped the build. |
| 📓 [RUNBOOK](../RUNBOOK.md) | Ops: run it, ports, live tx evidence. |

## 30-second mental model

```
You seal an order  ──▶  the operator gets CIPHERTEXT it cannot read
                        (drand timelock — decryptable only at round R)
                        ↓
                        at round R the epoch clears at ONE uniform price
                        ↓
                        the batch is SETTLED ON FLARE — the contract re-reads
                        FTSO and rejects an off-market price
                         (auditable, still reveals nothing private)
```

The whole point: **a bot can't front-run what it can't see.** [Proven on-chain](./TESTING.md#on-chain-e2e).

## Status at a glance

| | |
|---|---|
| Markets | ADA · BTC · ETH · SOL · DOGE (vs FXRP), up to 20× |
| Prices | FTSO v2 (off-chain) |
| Privacy | drand-timelock sealed orders + SHA-256 commitments |
| Settlement audit | Flare Coston2 L1 anchor (inline datum) |
| Auth | EIP-191 wallet signatures (proven round-trip) |
| Tests | 47 green + assertive on-chain E2E (11 txs, all confirmed) |
| Trust (v1) | trusted operator/sequencer — privacy + audit are trustless, settlement is not yet |
