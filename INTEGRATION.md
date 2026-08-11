# One enclave, three products — the plan across dorr, hadal and molfi

Written after reading all three. The headline is a correction to my own earlier
recommendation, so it goes first.

---

## The correction

I built a shared confidential-compute plane on Heroku and suggested pointing all three
projects at it. **Do not point molfi at it.** That would be a downgrade, and hadal is in the
same position.

Here is what each project actually has today, verified on-chain rather than from docs:

| | Registry | Status | Hardware |
|---|---|---|---|
| **molfi** | Flare `FlareTeeManager` `0x1a9C…18aE`, machine `0x0A75…67bb` | **`2` = PRODUCTION** | **None.** `SIMULATED_TEE=true` in `.env`, `.env.local`, `coston2.json`, and defaulted **on** by `post-build.sh:142` |
| **hadal** | Both registries are constructor immutables, but they appear **only** in `_sendInstruction` and `setExtensionId` — instruction routing, not the value path | not on the value path | fetches real quotes in `attest.ts`; the **signing key is a file on disk** |
| **dorr** | bespoke `TEEAttestationVerifier` `0x578D…98aE` — payload-bound, per batch | registered | **none** — a plain dyno |

molfi's `2` is not self-asserted, and it is not what I said it was. **Correcting my own
earlier claim:** I called it "real hardware, the strongest artifact of the three." It is
neither hardware nor, on its own, an attestation.

What the `2` genuinely proves: Flare's data providers reached the machine through its
registered URL, requested `tee-attestation`, matched policy consistency against reward epoch
5909, and obtained an availability proof. **Reachability, governance and availability are
real and network-verified.** A machine that cannot be reached stalls at `1`.

What it does not prove: a hardware measurement. `SIMULATED_TEE=true` is set in three places
and defaulted on by `post-build.sh`. And the URL that machine registered decodes to
`https://congressional-spin-precise-speak.trycloudflare.com` — an ephemeral Cloudflare quick
tunnel that now returns **404**.

Say this in the submission before a judge says it. It is still a strong artifact — no other
entry has Flare's own providers vouching for their machine — but it is *"network-verified
availability on Flare's native registry,"* not *"hardware-attested enclave."*

> **Cross-project consistency risk.** `COMPETITIVE.md` attacks Torch for
> `EXECUTION_MODE || "mock"` defaulting to mock. `post-build.sh:142` is
> `SIMULATED_TEE="${SIMULATED_TEE:-true}"` — the same shape. Submitting both without
> naming it hands a judge the contradiction for free.

So the arrow points the other way:

> **molfi's registered FCE container should host all three. dorr and hadal point at it.**

The Heroku plane stays useful — it is a working dev and staging instance, and it is what
runs today — but it is not the submission story.

---

## Why this is achievable rather than aspirational

molfi's extension dispatches on `(opType, opCommand)` pairs:

```ts
framework.handle(OP_TYPE_MOLFI, OP_COMMAND_SEAL_KEY,  handleSealKey);
framework.handle(OP_TYPE_MOLFI, OP_COMMAND_OPEN_BOOK, handleOpenBook);
```

Adding `OP_TYPE_DORR` and `OP_TYPE_HADAL` is more of the same. One registered machine,
three opTypes, three derived tenant identities from `flare-tee-kit`.

**The cost, stated up front:** changing the extension changes the image, which changes the
code hash, which means the machine must be re-registered and re-verified. molfi's
`REGISTRATION.md` already documents that loop — `sync-extension.mjs` → `start-services.sh`
→ `verify-image.mjs` → `register.sh`. Budget for one re-registration, and do it once with
all three opTypes in rather than three times.

---

## Target architecture

```
                       Flare data providers
                                │ signed instructions
                                ▼
              molfi's registered FCE container  ← status 2 on FlareTeeManager
              ┌─────────────────────────────────────────┐
              │  flare-tee-kit: one seed, three tenants │
              │                                         │
              │  MOLFI/*   sealed-bid book              │
              │  HADAL/*   confidential amounts         │
              │  DORR/*    sealed order batches         │
              └─────────────────────────────────────────┘
                    │              │              │
              molfi contracts  ConfidentialFXRP  DorrBatchSettlement
              (FlareTeeManager) (ITeeMachineRegistry) (TEEAttestationVerifier)
```

Each project keeps its own verifier and its own payload shape. What they share is the
attested machine — and because each tenant has its own derived signing key, a quote issued
for one does not recover to the address another registered. Cross-project replay is
impossible by construction, with no shared payload format to police.

**The limit, again:** this is separation of *identity*, not of *blast radius*. Code inside
the container can derive any tenant's key. If two of these must survive each other's bugs,
they need two machines. Say so in the submission rather than letting a judge ask.

---

## What is live right now

The Heroku plane, working and honest about what it is not:

| | |
|---|---|
| Enclave | `https://dorr-enclave-f7b366d50e22.herokuapp.com` |
| Tenants | `GET /tenants` |
| Machine attestation | `GET /tee/attestation` → `hardwareAttestation.available: false` |
| Per-project | `GET /t/{project}/pubkey`, `POST /t/{project}/{open,sign}` |

Current tenant identities (stable across restart — seed comes from the environment):

| project | signer | teeId |
|---|---|---|
| dorr | `0xE5f41AE46Dc48737D1232Ff33D8145fAa1004128` | `0x5871a505dc75db171a17ef52b0ae595bb8f4bd87db53f25b1202e6b95b4e7b15` |
| hadal | `0x24105E559E82627984AD9f8d57e24c54cd1D93bA` | `0x65b4560436c68751f5bbfe0c318b56d5b987edc806b4e48000ad680057378093` |
| molfi | `0x8D642631287303432861e22B778166fB4Ca2404D` | `0x6e66dbcdb67487667605ab3bbedea90f8719ee3a5a0528284807e896c3beaba1` |

dorr's tenant is registered on `TEEAttestationVerifier` — tx `0x4cfc42e4…`, and
`teeSigner(teeId)` reads back the same address the enclave reports.

---

## Order of work, by value

Revised after both sibling sessions reported back with verified findings. **Neither
migration should happen before the deadline** — and that conclusion is theirs, from
evidence, not caution.

0. **hadal's owner is the public anvil key `0xf39Fd6…2266`.** Anyone can call
   `setTeeAddress` on the live contract and repoint the trust anchor right now. Every other
   item here is theoretical until this one is fixed. `transferOwnership`, or redeploy.
1. **Implement tenant derivation in molfi, but do not rebuild or re-register.** The property
   worth proving — a quote for dorr does not recover to hadal's address, a bid sealed to
   molfi opens for neither — is a pure property of the HKDF derivation. It is testable today
   at zero risk. Vendor the ~80 lines rather than taking the dependency; it keeps the
   in-enclave surface small.
2. **Do not point hadal at the shared enclave.** The staging plane reports
   `seed.source: "env"` — the host operator can read the seed that derives all three keys.
   hadal would trade "hadal's operator holds hadal's key" for "the shared host's operator
   holds every key": same trust class, triple the blast radius.
3. **Make hadal's registries load-bearing.** They are currently ornamental — require
   `teeAddress` to be a machine at `getTeeMachineStatus == PRODUCTION`, or check membership
   via `getRandomTeeIds`. This is the highest-value change in any of the three repos, and it
   is worth doing whether or not a machine is ever shared.
4. **Document key provenance next to the attestation caveat.** hadal's `attest.ts` refuses
   to fabricate a quote; the docs should equally refuse to imply the signing key is
   enclave-held when it is a file on disk.

The revised submission sentence: *three products, one derivation, each identity independently
verified on-chain — with the machine's posture stated exactly, including what it does not
prove.* That is weaker than what I claimed yesterday and stronger than what a judge would
have found.
