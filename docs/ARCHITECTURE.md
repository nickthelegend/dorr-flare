# 🏗️ Architecture

dorr fuses two things that normally don't meet: a **real perps trading app** (UniPerp's UI + engine) and a **ZK privacy layer** (the Anti-Front-Running-ZKPerps research on Midnight). The result is a perp where your order is a zero-knowledge commitment until it settles.

## The five layers

```mermaid
flowchart TB
  U["👤 Trader + Lace/Eternl (CIP-30)"]

  subgraph FE["① Frontend — Next.js (apps/web)"]
    UI["Trading terminal · charts · portfolio"]
    W["Mesh wallet · signs every action"]
  end

  subgraph OP["② Operator — Node/Hono (services/operator)"]
    EX["vAMM executor (Pyth mark + impact)"]
    ENG["engine: margin · funding · liquidation"]
    AUTH["wallet-sig auth · privacy projection"]
    PR["Midnight prover driver"]
    CX["Cardano tx builder (Lucid)"]
    KP["keepers: price · funding · liquidation"]
  end

  subgraph MN["③ Midnight — real ZK (local net + proof server)"]
    C1["zkperps-order · commit + authority"]
    C2["zkperps-matching · execution attest"]
    C3["zkperps-settlement · state digest"]
  end

  subgraph CD["④ Cardano preprod"]
    DUSD["dUSD policy + faucet"]
    VLT["margin vault (Aiken, operator-sig)"]
    ANC["settlement anchor (inline datum)"]
    NFT["CIP-68 position NFT"]
  end

  PY["⑤ Pyth Hermes (off-chain prices)"]

  U --> UI --> W -->|signed request| OP
  PY -.prices.-> EX
  PY -.prices.-> KP
  W -->|deposit dUSD| VLT
  PR --> C1 & C2 & C3
  CX --> DUSD & VLT & ANC & NFT
  style MN fill:#0b7,stroke:#0b7,color:#fff
```

| Layer | Package | Real vs stub |
|-------|---------|--------------|
| Frontend | `apps/web` | ported UniPerp premium UI, EVM ripped out, Mesh/Lace + operator client |
| Operator | `services/operator` | vAMM, accounting, auth, ZK driver, Cardano tx, keepers, A/B demo |
| Engine | `packages/engine` | off-chain perps engine from the ZKPerps research (margin/funding/liquidation/commitment) |
| Compact | `vendor/zkperps` + `dorr-*` drivers | 5 real Midnight Compact contracts + per-trade proof drivers |
| Aiken | `packages/contracts-aiken` | dUSD policy · margin vault · settlement anchor (Plutus V3, `aiken build` green) |

## A trade, end to end

```mermaid
sequenceDiagram
  autonumber
  participant U as Trader (wallet)
  participant O as Operator
  participant M as Midnight (ZK)
  participant C as Cardano preprod
  participant P as Public feed

  U->>C: deposit dUSD to vault (user-signed)
  U->>O: commit {market,side,size,lev} + wallet signature
  O->>M: deploy zkperps-order + proveTraderOrderAuthority (ZK)
  O->>P: publish ONLY the 32-byte commitment hash
  Note over P: 🔒 side/size/price/leverage hidden — bots see nothing
  U->>O: execute
  O->>O: fill on the oracle-priced vAMM
  O->>M: proveAndFinalizeMatch (ZK, execution attest)
  O->>C: mint CIP-68 position NFT
  U->>O: close
  O->>M: proveSettlementTransition (ZK)
  O->>C: anchor settlement digest (inline datum)
  O->>M: bindL1SettlementAnchor (ZK, Midnight↔Cardano)
  O->>U: PnL settled in dUSD; withdraw available
```

Every step above is **real** — [proven on-chain](./TESTING.md#on-chain-e2e) with 4 ZK proofs and 6 preprod txs in one run.

## The privacy boundary

The single source of truth for "what the public can see" is one pure function, `publicFeedView` (`services/operator/src/privacy.ts`), pinned by tests:

```mermaid
flowchart LR
  O["Order: side, size, price, leverage, trader, nonce"]
  O -->|private mode| H["Public sees: { market, 32-byte hash }"]
  O -->|public mode - A/B foil| L["Public sees: EVERYTHING (leaked, on purpose)"]
  H --> B1["🤖 bot: no signal → cannot front-run"]
  L --> B2["🤖 bot: full signal → sandwiches the victim"]
```

The commitment is `SHA-256(pairId, side, price, size, leverage, margin, nonce)` — hiding (no field is recoverable) and binding (any change alters the hash). Brute-forcing the 128-bit nonce is infeasible. See [SECURITY](./SECURITY.md).

## The oracle-priced vAMM

Ported from UniPerp's constant-product model: virtual reserves, price impact on fills, and a keeper that re-centers the pool to the Pyth index. One trader can open a leveraged long/short with no counterparty; the A/B demo can run a *real* sandwich on it (then restore the pool).

```
mark = virtualQuote / virtualBase        (constant product: base × quote = k)
fill walks the curve → price impact       LONG buys base (price ↑), SHORT sells (price ↓)
keeper recenters to Pyth when drift > 5bps
```

## Trust model (read this)

```mermaid
flowchart TB
  subgraph T["🔓 Trustless today"]
    P1["Order privacy — public/mempool cannot see or front-run"]
    P2["L1 audit trail — every settlement anchored on Cardano"]
  end
  subgraph N["🔑 Trusted in v1 (like a sequencer)"]
    N1["Operator matches + executes (sees plaintext post-reveal)"]
    N2["Operator custodies collateral (vault = operator-sig)"]
    N3["ZK attests the pipeline, not the trade math"]
  end
  N -.->|v2 path| V["Pyth Lazer on Cardano + Aiken settlement/liquidation validator = trustless settlement"]
```

We claim **"the public can't see or front-run your order"** — not "trustless perp." That distinction is deliberate and documented; see [SECURITY → honest scope](./SECURITY.md#honest-scope).

## Runtime processes

| Process | Port | Notes |
|---------|------|-------|
| web (Next.js) | 3000 | premium trading terminal |
| operator (Hono) | 8790 | the brain |
| Midnight proof server | 6301 | real ZK proofs |
| Midnight indexer (GraphQL v3) | 8088 | local net |
| Midnight node RPC | 9945 | local net |
| Cardano preprod | remote | Blockfrost primary, keyless Koios fallback |
