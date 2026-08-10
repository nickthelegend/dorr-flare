<div align="center">

# 📚 dorr docs

**Perps you can't front-run.** Private order flow on Cardano + Midnight.

</div>

Start at the [project README](../README.md) for the pitch and quickstart. These docs go deeper.

| Doc | What's inside |
|-----|---------------|
| 🏗️ [ARCHITECTURE](./ARCHITECTURE.md) | The five layers, the trade lifecycle (sequence diagram), the privacy boundary, and the trust model — with diagrams. |
| ⚡ [FEATURES](./FEATURES.md) | Private limit orders, hidden stop-loss/take-profit (anti stop-hunting), partial close, add/remove margin, slippage guard. |
| 🔗 [MIDNIGHT_CARDANO](./MIDNIGHT_CARDANO.md) | Exactly how the two ledgers are linked (shared digest, two-way hash reference). |
| 👛 [WALLETS](./WALLETS.md) | Which wallets to test with, Preprod setup, funding, and the "do I need a Midnight wallet?" answer. |
| 🔌 [API](./API.md) | Every operator endpoint, the contracts, and the on-chain artifacts. |
| 🔒 [SECURITY](./SECURITY.md) | Wallet-signature auth, the privacy/MEV model, and an honest scope statement. |
| 🧪 [TESTING](./TESTING.md) | The 47-test suite + the assertive on-chain E2E, and how to run each. |
| 🎬 [DEMO](../DEMO.md) | The 3-minute stage script. |
| 📐 [DESIGN](../DESIGN.md) | The original decision log that shaped the build. |
| 📓 [RUNBOOK](../RUNBOOK.md) | Ops: run it, ports, live tx evidence. |

## 30-second mental model

```
You sign an order  ──▶  it becomes a HASH on Midnight (ZK proof of validity)
                         the public sees only the hash — no side/size/price
                         ↓
                        the operator executes it on an oracle-priced vAMM
                         ↓
                        the settlement digest is ANCHORED on Cardano L1
                         (auditable, still reveals nothing private)
```

The whole point: **a bot can't front-run what it can't see.** [Proven on-chain](./TESTING.md#on-chain-e2e).

## Status at a glance

| | |
|---|---|
| Markets | ADA · BTC · ETH · SOL · DOGE (vs dUSD), up to 20× |
| Prices | Pyth Hermes (off-chain) |
| Privacy | Midnight ZK order commitments (real proofs) |
| Settlement audit | Cardano preprod L1 anchor (inline datum) |
| Auth | CIP-30 wallet signatures (proven round-trip) |
| Tests | 47 green + assertive on-chain E2E (11 txs, all confirmed) |
| Trust (v1) | trusted operator/sequencer — privacy + audit are trustless, settlement is not yet |
