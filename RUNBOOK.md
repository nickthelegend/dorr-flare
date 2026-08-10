# dorr — runbook

Privacy-preserving perps on **Flare**. Everything runs locally except the Coston2 legs, which are real on-chain transactions.

## Status

| Piece | State |
|---|---|
| Monorepo (`apps/web`, `packages/engine`, `services/operator`, `contracts`) | ✅ |
| Off-chain engine (matching, margin, funding, liquidation, commitment) | ✅ tests pass |
| Solidity contracts — `DorrVault`, `DorrBatchSettlement`, `TEEAttestationVerifier` | ✅ deployed on Coston2, 22 Foundry tests green |
| FTSO v2 price feeds (6 markets, read on-chain via ContractRegistry) | ✅ live |
| Sealed-bid path — browser tlock → operator-blind → uniform-price clearing → `settleBatch` | ✅ live-verified on Coston2 |
| Confidential compute — enclave holds the ECIES key, signs batch quotes | ✅ |
| Web app (UniPerp UI on EIP-1193) | ✅ builds; renders offline + wallet-less |
| Tests | ✅ 85 operator + 22 Solidity, all green |

## Auth

Every value-moving call (`commit` / `execute` / `close` / `seal` / `disclose`) carries an
**EIP-191** signature over a canonical, key-sorted, timestamped message. The operator
recovers the signer from the signature and checks freshness (±120s), no-reuse, and that
the signer matches the acting address. **You cannot place or close someone else's trade.**
Enforcement is on with `DORR_AUTH=1`; the default demo mode doesn't require it.

## Run it

```bash
bun install
bun run --cwd services/operator start          # :8791 — wait for six "feed ok" lines
bun run --cwd services/operator src/enclave/server.ts   # :8795 — optional, for the confidential path
bun run --cwd apps/web dev                     # :3000
```

No Docker, no local chain, no proof server — the only external dependencies are the Coston2 RPC and the public drand network.

## Tests

```bash
bun test --cwd services/operator     # 85: math, auth, auth-crypto, privacy, vAMM, sealbid,
                                     #     sealed-e2e (live drand), confidential, integration, features
cd contracts && forge test           # 22: vault invariants + fuzz, batch settlement, TEE attestation
```

- **Sealed E2E** runs against the **live drand network** — no mocks. It seals real orders, proves the operator can't open them early, clears an epoch at one uniform price, and checks a cleared sealed order is selectively disclosable.
- **On-chain E2E** (`src/scripts/flare-e2e.ts`, `src/scripts/confidential-e2e.ts`): real Coston2 transactions — vault reads, batch settlement, and the negative cases (a forged attestation and an out-of-band price are both rejected by the contract).
- Fast tests use their own state file (`state.test.json`), so running the suite never touches a live operator's ledger.

## Funding

The relayer needs **C2FLR** for gas; traders need **C2FLR + FXRP**.
Faucet: https://faucet.flare.network/coston2 — it hands out both.

dorr holds no minting authority over FXRP, so there is no operator-side faucet. `POST /faucet` returns 501 and points at Flare's.

## Environment

`.env` at the repo root:

```
FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
FLARE_CHAIN_ID=114
FLARE_EXPLORER=https://coston2-explorer.flare.network
FXRP_ADDRESS=0x0b6A3645c240605887a5532109323A3E12273dc7
DORR_VAULT_ADDRESS=0x65b705A49778b9d7bD741A0A979162393c699a98
DORR_SETTLEMENT_ADDRESS=0x047478DE7d2ed6B41dEFC14223764411288Db845
DORR_TEE_VERIFIER_ADDRESS=0x578D75dDbce7fBB05072b733F372De2241d698aE
FLARE_RELAYER_KEY=0x…        # pays gas for settleBatch
TEE_ENCLAVE_KEY=0x…          # enclave signing key
TEE_ID=0x…
TEE_MEASUREMENT=0x…
OPERATOR_PORT=8791
DORR_AUTH=1                  # optional: enforce wallet signatures
```

## Demo walkthrough

1. Connect **MetaMask** on Coston2. Claim C2FLR + FXRP from the Flare faucet.
2. Deposit FXRP from the Collateral panel (approve + `deposit`, two real txs).
3. Open the **Attack Lab** → sandwich a public order, then show it netting **$0.00** against a batch.
4. Flip **"Seal from the operator"** and submit — the activity log shows the drand round the operator must wait for.
5. When the round lands, the epoch clears at one price and **settles on Flare**; click the tx through to the explorer.
6. **Disclose** a position to an audience, then **Verify** it — and verify a tampered copy to watch it be rejected.
7. Withdraw from the Collateral panel — your wallet signs it; the operator is not involved.

## Ports

| Service | Port |
|---|---|
| web (Next.js) | 3000 |
| operator (Hono) | 8791 |
| enclave | 8795 |

## Verified evidence (this build, Coston2)

| Leg | Tx |
|---|---|
| FXRP approve + vault deposit | `0x1d716fc5…` |
| Sealed batch settled on Flare (FTSO re-read + quote verified) | `0x3a732edf…` |
| Earlier sealed batch | `0xd942461e…` |
| Depositor-signed withdrawal (operator uninvolved) | `0x32d2aad1…` |

Any hash → `https://coston2-explorer.flare.network/tx/<hash>`.

We have also observed the contract **rejecting** a batch with `PriceOutOfBand` when the clearing price drifted from FTSO — the guard is not decorative.

## Key files

- `services/operator/src/vamm.ts` — the vAMM (FTSO mark + constant-product impact)
- `services/operator/src/trading.ts` — commit→execute→close lifecycle, sealed-batch keeper, Flare settlement
- `services/operator/src/sealbid.ts` — drand timelock sealing/opening
- `services/operator/src/flare.ts` — contract reads + `settleBatch`
- `services/operator/src/attestation.ts` — enclave quote signing (matches the verifier's digest layout)
- `services/operator/src/demo.ts` — the deterministic A/B sandwich
- `contracts/src/DorrVault.sol` — collateral; depositor-only withdrawal
- `contracts/src/DorrBatchSettlement.sol` — FTSO band + attestation gate
