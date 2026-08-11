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
| **molfi** | Flare `FlareTeeManager` `0x1a9C…18aE`, machine `0x0A75…67bb` | **`2` = PRODUCTION** | Real — the confidential logic is compiled into the registered image |
| **hadal** | `ConfidentialFXRP` takes `ITeeMachineRegistry` + `ITeeExtensionRegistry` in its constructor; releases value only against `ecrecover` to a registered machine | wired | fetches real dstack / Confidential Space quotes |
| **dorr** | bespoke `TEEAttestationVerifier` `0x578D…98aE` — payload-bound, per batch | registered | **none** — a plain dyno |

molfi's `2` is not self-asserted. Flare's data providers reached the machine through its
registered URL, requested `tee-attestation`, matched policy consistency against reward epoch
5909, and obtained an availability proof. A machine that cannot be reached stalls at `1`.
That is the network's verdict, and it is the strongest confidential-compute artifact any of
the three has.

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

1. **Add DORR and HADAL opTypes to molfi's extension**, backed by `flare-tee-kit` tenant
   derivation. Re-register the machine once, with all three in.
2. **Point hadal's `teeAddress` at its tenant's signer** on the shared machine. hadal's
   contract already checks the machine registry, so this is configuration, not a rewrite.
3. **Have dorr additionally check `FlareTeeManager`** alongside its own verifier. Its
   payload-bound check is the strongest of the three and should stay; adding the native
   registry means it is anchored in Flare's attestation as well as its own.
4. Keep the Heroku plane as staging. It is the thing that works while step 1 is in flight.

If only step 1 happens, the submission still reads: *one machine registered PRODUCTION on
Flare's own confidential compute, serving three products, each with an independent identity
its contract verifies.* That is a better sentence than any of the three has alone.
