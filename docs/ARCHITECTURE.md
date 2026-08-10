# 🏗️ Architecture

dorr fuses two things that normally don't meet: a **real perps trading app** (UniPerp's UI + engine) and an **anti-front-running execution layer** (drand-timelock sealed orders cleared in uniform-price batches, settled on Flare). The result is a perp whose operator cannot read your order in time to trade ahead of it.

## The five layers

```mermaid
flowchart TB
  U["👤 Trader + MetaMask/Rabby (EIP-191)"]

  subgraph FE["① Frontend — Next.js (apps/web)"]
    UI["Trading terminal · charts · portfolio"]
    W["EIP-1193 wallet · seals orders in-browser (tlock)"]
  end

  subgraph OP["② Operator — Bun/Hono (services/operator)"]
    EX["vAMM executor (FTSO mark + impact)"]
    ENG["engine: margin · funding · liquidation"]
    AUTH["EIP-191 auth · privacy projection"]
    SB["sealed-bid keeper · uniform-price clearing"]
    FX["Flare tx layer (viem)"]
  end

  subgraph TEE["③ Confidential compute"]
    E1["enclave holds the ECIES key"]
    E2["signs a quote bound to the batch payload"]
  end

  subgraph FL["④ Flare Coston2"]
    VLT["DorrVault — FXRP, depositor-only withdraw"]
    SET["DorrBatchSettlement — FTSO band + quote check"]
    VER["TEEAttestationVerifier"]
  end

  FT["⑤ FTSO v2 (read on-chain)"]

  U --> UI --> W -->|sealed order + signature| OP
  FT -.prices.-> EX
  FT -.contract re-reads.-> SET
  W -->|deposit FXRP| VLT
  SB --> TEE
  FX --> SET --> VLT
  SET --> VER
  style FL fill:#e62058,stroke:#e62058,color:#fff
```

| Layer | Package | Real vs stub |
|-------|---------|--------------|
| Frontend | `apps/web` | UniPerp premium UI on an EIP-1193 wallet; seals orders in-browser with tlock |
| Operator | `services/operator` | vAMM, accounting, EIP-191 auth, sealed-bid keeper, Flare tx layer |
| Enclave | `services/operator/src/enclave` | separate process; holds the ECIES key and signs batch attestations |
| Engine | `packages/engine` | off-chain perps engine (margin/funding/liquidation/commitment/uniform-price clearing) |
| Contracts | `contracts` | `DorrVault` · `DorrBatchSettlement` · `TEEAttestationVerifier` (Solidity, Foundry green) |

## A trade, end to end

```mermaid
sequenceDiagram
  autonumber
  participant U as Trader (wallet)
  participant O as Operator
  participant E as Enclave
  participant C as Flare Coston2
  participant P as Public feed

  U->>C: approve + DorrVault.deposit() (user-signed)
  U->>U: timelock-encrypt the order to drand round R
  U->>O: submit ciphertext + commitment + margin bound
  Note over O: 🔒 operator holds bytes it cannot decrypt until R
  O->>P: publish ONLY the 32-byte commitment hash
  Note over C: round R lands
  O->>O: open the epoch, verify commitments, clear at ONE price
  O->>E: request a quote for (epochId, root, price, count)
  E-->>O: EIP-191 attestation bound to that payload
  O->>C: settleBatch(...)
  C->>C: re-read FTSO — revert PriceOutOfBand if off-market
  C->>C: verify the enclave quote
  O->>U: position opened at the uniform clearing price
  U->>C: DorrVault.withdraw() — operator not involved
```

Every step above is **real** — driven from a browser against Coston2, with the deposit, batch settlement and withdrawal all on-chain. See the [README](../README.md#proven-live-on-coston2) for the transactions.

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

Ported from UniPerp's constant-product model: virtual reserves, price impact on fills, and a keeper that re-centers the pool to the FTSO index. One trader can open a leveraged long/short with no counterparty; the A/B demo can run a *real* sandwich on it (then restore the pool).

```
mark = virtualQuote / virtualBase        (constant product: base × quote = k)
fill walks the curve → price impact       LONG buys base (price ↑), SHORT sells (price ↓)
keeper recenters to FTSO when drift > 5bps
```

## Trust model (read this)

```mermaid
flowchart TB
  subgraph T["🔓 Cryptographic today"]
    P1["Order privacy — the public AND the operator cannot read a sealed order"]
    P2["Uniform price — a sandwich nets $0 by construction"]
    P3["Self-custody — DorrVault pays only the depositor"]
    P4["Price band — the settlement contract re-reads FTSO and rejects off-market"]
  end
  subgraph N["🔑 Trusted in v1 (like a sequencer)"]
    N1["Operator liveness / censorship (evidence, not prevention)"]
    N2["Clearing math is auditable, not ZK-proven"]
    N3["Liquidation runs off-chain"]
    N4["Open-position margin is not locked on-chain"]
  end
  N -.->|v2 path| V["lock margin on-chain → on-chain liquidation → ZK-proven clearing"]
```

We claim **"the public can't see or front-run your order"** — not "trustless perp." That distinction is deliberate and documented; see [SECURITY → honest scope](./SECURITY.md#honest-scope).

## Runtime processes

| Process | Port | Notes |
|---------|------|-------|
| web (Next.js) | 3000 | premium trading terminal |
| operator (Hono) | 8791 | the brain |
| enclave | 8795 | confidential matching — holds the ECIES key |
| Flare Coston2 | remote | public RPC `coston2-api.flare.network` |
