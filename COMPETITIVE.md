# dorr vs Torch — honest head-to-head

Both are Flare Summer Signal entries. Both take FXRP margin on Coston2. Both claim a
TEE. We collide directly on the **Confidential Compute Apps** bounty.

Everything below was read out of `_compeititor/torch` at commit `cee6c2d` (113 commits)
and checked against their live endpoints on 2026-08-11, not taken from their README.

---

## 1 · Where Torch genuinely beats us

Stated first, because pretending otherwise loses hackathons.

| # | Torch has | We have | Severity |
|---|---|---|---|
| T1 | **Real Intel TDX.** Live Phala dstack CVM, 57,092 loop cycles, real image digest `sha256:9218f1a2…`, `executionMode: testnet` | A software enclave process. Our own status endpoint says `hardwareAttestation.available: false` | **Critical** — this is the bounty |
| T2 | **Publicly deployed.** `usetorch.xyz` returns 200, custom domain, anyone can trade in 3 minutes | localhost only. A judge cannot click anything | **Critical** |
| T3 | **Real external liquidity.** Orders on venue-listed markets route to Hyperliquid's live testnet book; first user round trip oid `57497722789` | A self-contained vAMM. No external venue | High |
| T4 | **FDC integration.** `TorchFdcConsumer.sol` verifies Web2Json proofs on-chain, binding exchange fills to positions. 385 attestations queued | We do not use FDC at all | High |
| T5 | **Both bounties.** Interoperable Asset Products *and* Confidential Compute | One bounty | Medium |
| T6 | **A published adversarial self-audit.** `AUDIT.md`, 26 KB, three reviewers, findings they refused to fix because re-verification proved the fix wrong | We have no such artifact | Medium |
| T7 | **A `/verify` page** that publishes what is *not* proven next to what is | We have an honest-scope paragraph on the landing page. Weaker | Medium |
| T8 | **Track record.** Dated proofs, XRPL one-signature margin spike, tester feedback across Paper Perps League seasons | Shorter, less externally witnessed | Low |

## 2 · Where Torch is mocking or missing

Also verified in source, not inferred.

| # | Finding | Evidence |
|---|---|---|
| M1 | **Default execution mode is `mock`.** `EXECUTION_MODE \|\| "mock"` — mock fills at the FTSO mark and issues internal sequence numbers instead of exchange order ids | `agent/src/index.ts:24`, `agent/src/exchange.ts:47` |
| M2 | **XRP — the headline asset — never routes to Hyperliquid.** Their testnet lists no XRP market, so XRP always fills at the FTSO mark with nothing to attest. The pitch is "trade perps with your XRP"; XRP is the one market that gets none of the architecture | README, "What settles where" |
| M3 | **The dstack attestation is never fetched.** `getAttestation()` opens a socket for Confidential Space but for dstack returns a hardcoded string; `imageDigest` comes from `process.env.IMAGE_DIGEST` — self-declared by the container it is meant to attest | `agent/src/tee.ts:93-99` |
| M4 | **No on-chain TEE verification whatsoever.** `TorchVaultV2.setExecutor(address) onlyOwner`. Flare has no idea whether that key is in a TEE or on a laptop. Every enclave guarantee is off-chain assertion | `TorchVaultV2.sol:87,200` |
| M5 | **1,546 lines of TEE/executor logic with zero tests.** `npm test` runs contracts only; no test file exists anywhere in `agent/` or `web/` | repo-wide search |
| M6 | **Builder-code revenue is wired but never exercised** — their words: address unset, no builder-tagged order ever placed, and circular anyway since the only flow is the house's own hedge | README |
| M7 | **Hedge PnL → insurance fund is a manual operator step**, not a bridge | README |
| M8 | **`:latest` image tag undermines the attestation** — their own audit, finding 0c | `AUDIT.md:60` |
| M9 | **No order privacy of any kind.** Every match for `private\|encrypt\|commit\|seal\|hidden` in their source is a TypeScript access modifier | repo-wide search |

## 3 · Where we genuinely beat Torch

| # | dorr has | Torch has | Why it matters |
|---|---|---|---|
| D1 | **Order privacy.** drand timelock-encrypted orders; the operator holds ciphertext it cannot open until the round publishes | **Nothing.** Zero | The whole category. See §5 |
| D2 | **On-chain TEE verification.** `TEEAttestationVerifier.isTEEAttestedFor(attestation, payloadHash)` — a registered `teeId`, a matching `expectedMeasurement`, and a signature bound to *that specific batch* | `setExecutor` by the owner | Their enclave is trusted; ours is checked |
| D3 | **Uniform-price batch clearing.** Front-run and back-run legs fill at the same number, so a sandwich is structurally worth $0.00 | Sequential fills | Torch's design cannot adopt this |
| D4 | **125 tests** (94 operator/engine + 31 Solidity) incl. fuzz `testFuzz_WithdrawNeverExceedsFree`, `test_SettlementCannotDrainVault`, `test_PnlMustBeZeroSum` | 53 contract tests, 0 elsewhere | Depth, and ours covers the off-chain engine |
| D5 | **Auth fails closed.** Every value-moving call needs an EIP-191 signature bound to the acting address; the integration suite signs for real | Not comparable — no equivalent surface | |
| D6 | **No mock path anywhere in shipped source.** 0 hits; the demo-only endpoints are gated to `NODE_ENV=test` | `mock` is the default mode | |
| D7 | **A measurable attack demo.** 25,000 real SHA-256 preimage attempts in 34 ms (735,294/s), 0 cracks, beside a real $205.06 sandwich on the live pool | No adversarial demo | Judges remember this |

## 4 · The TEE question, precisely

This is the bounty, so it deserves no hand-waving.

|  | Torch | dorr |
|---|---|---|
| Hardware | **Intel TDX, live on Phala dstack** | None — a normal process |
| Key custody | Generated in-enclave, never exported | Held by the enclave process |
| Quote fetched from hardware | Confidential Space: yes. **dstack: no** — returns a string | No |
| Measurement source | `process.env.IMAGE_DIGEST` (self-declared) | `.env`, registered on-chain |
| **Verified on-chain** | **No** | **Yes** — payload-bound, per batch |
| Binds to the thing it protects | No — the executor is trusted for everything | Yes — the quote covers epochId ‖ membershipRoot ‖ clearingPrice ‖ orderCount |

> **Before using this section, read the glass-house note.** M1 attacks Torch for
> `EXECUTION_MODE || "mock"` defaulting to mock. A sibling submission of ours,
> molfi, ships `SIMULATED_TEE="${SIMULATED_TEE:-true}"` in `post-build.sh:142` — the same
> shape, also defaulted on. The criticism is still valid, but it must be made while stating
> our own, or it reads as one rule for them and another for us. See
> [INTEGRATION.md](INTEGRATION.md).

**Neither side is complete.** Torch has the hardware and no chain-side proof. We have the
chain-side proof and no hardware. A judge who only asks "is it a real TEE?" scores Torch
higher. A judge who asks "what does the chain actually check?" scores us higher.

**So we take the union** — that was the plan, and it is not done. We deployed the enclave
to a Phala dstack CVM on 2026-08-11. The host is genuine TDX and `detectTee()` correctly
reported `dstack` where Heroku reports `none`, but the guest agent never served a quote:
all four `/prpc/*` spellings returned HTML 404s, so `hardwareAttestation.available` stayed
`false`. See [phala/README.md](phala/README.md) for the run log.

**So the honest scoreboard is:** Torch has the hardware and no chain-side proof. We have
the chain-side proof and no hardware measurement. Neither of us is hardware-attested in a
way a verifier could check today — the difference is that our endpoint says so and theirs
reports a self-declared `IMAGE_DIGEST`.

## 5 · The one thing Torch cannot copy

Torch routes orders to Hyperliquid's orderbook. That means the order **must** be legible
to the executor and to Hyperliquid — a resting order on a public book is the opposite of a
sealed one. Their architecture forecloses order privacy permanently. It is not an
unfinished feature; it is a consequence of the design.

dorr's thesis — the venue matching your order cannot read it — is therefore not a feature
Torch is behind on. It is the axis they conceded when they chose to borrow liquidity.

Conversely, we concede *their* axis: we have no external liquidity, so our depth is
whatever the vAMM is seeded with. That is a real limitation and we should say so rather
than let a judge find it.

## 6 · Who loses the hackathon as things stand

Honestly: **on the Confidential Compute bounty as of today, Torch wins on optics.** They
have a URL, a live TDX CVM and a public audit. We have better cryptography that nobody can
click on.

That gap is closable, and it is mostly deployment rather than research.

## 7 · The plan

Ordered by how much a judge's score moves per hour of work.

| # | Move | Closes | Status |
|---|---|---|---|
| P1 | **Fetch a real hardware quote** (dstack + Confidential Space) in the enclave, with `report_data` = the batch payload hash | T1, M3 — and puts us ahead, because theirs is never fetched | **Done, unverified on hardware.** Degrades honestly to `available:false`; lighting it up needs a Phala Cloud account |
| P2 | **Deploy publicly** — web + operator + enclave on real URLs | T2 | **Done.** [dorr-flare.vercel.app](https://dorr-flare.vercel.app), operator + enclave on Heroku |
| P3 | **A `/verify` page** stating what is proven, what is not, and the exact on-chain checks | T6, T7 | **Done.** Reads contracts from the operator and attestation from the enclave |
| P4 | **Say the privacy thesis louder**, and name the liquidity trade-off ourselves | D1, honesty | **Done** — the "not proven" column names the vAMM depth limit outright |
| P5 | **Take the attestation key off the operator entirely** | Beats T1 on Torch's own terms | **Done.** The operator delegates to the enclave over `/sign-batch` and holds only the gas key |

### P5 — the move that settles the TEE argument

Torch's strongest claim is that the executor key is generated in the enclave and never
exported. Ours was weaker than it sounded: the operator process held `TEE_ENCLAVE_KEY`
itself, so the isolation was nominal — the thing the enclave was supposed to be isolated
*from* could sign its own quotes.

That is now closed. The operator asks the enclave for a quote over `/sign-batch` and holds
no attestation key; `heroku config -a dorr-operator` shows one key, the relayer's, which
only pays gas. Delegating is safe precisely because the chain checks the payload:
`DorrBatchSettlement` recomputes `keccak256(epochId, membershipRoot, clearingPrice,
orderCount)` from the batch it is settling and rejects a quote over anything else, so a
forged request buys an attacker a signature over a batch that will not settle.

Proven end to end on the deployed stack: epoch 6, tx
[`0xaf46e37d…`](https://coston2-explorer.flare.network/tx/0xaf46e37d9478b6188bae9f0d51b7a31bf308cc6aceb9ab6ef80de308ae5cd9ce).

**Net position on Confidential Compute:** Torch has hardware with no on-chain check and a
quote that is never fetched. dorr has an on-chain check, a quote bound to the specific
batch, and a key the matching engine cannot reach — and no hardware. Of the two gaps, ours
is a deployment target away; theirs is a contract rewrite.

FDC (T4) is deliberately *not* on this list: attesting an exchange fill is meaningful for
Torch because they have an exchange. We have no external venue, so an FDC round trip would
be ceremony rather than evidence — exactly the kind of thing this project has spent its
whole life removing.
