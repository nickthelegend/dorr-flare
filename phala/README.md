# Phala deploy kit — real Intel TDX for all three projects

One `tdx.small` CVM (~$0.06/hr) runs the shared enclave. dorr, hadal and molfi
all get hardware attestation from it, because it is the **same image already
running on Heroku** — three tenants, three derived identities, one machine.

**Deploy → prove → destroy.** $20 of credit is ~333 hours on `tdx.small`; the
only way to waste it is leaving a CVM idle. Nothing here runs on a schedule.

---

## Before the first deploy: one blocker

**The image must be on a PUBLIC registry.** It currently lives at
`registry.heroku.com/dorr-enclave/web`, which is private — the CVM pulls the
image itself and has no credentials, so it would fail with an unhelpful pull
error after billing has already started.

One-time, from the repo root:

```bash
docker login                                   # Docker Hub
docker build --platform linux/amd64 --provenance=false --sbom=false \
  -t docker.io/<you>/dorr-enclave:1 .
docker push docker.io/<you>/dorr-enclave:1
```

Tag by number, not `latest` — the code hash a judge checks should point at a
specific build, and `latest` moving under you is how that claim goes stale.

---

## The cycle

```bash
export PHALA_API_KEY=phak_…
export HEROKU_API_KEY=HRKU-…
export ENCLAVE_IMAGE=ghcr.io/nickthelegend/dorr-enclave:1

./deploy.sh      # refuses if a CVM already exists — billing starts here
                 # wait ~2 min
./verify.sh      # the proof. capture this output.
./teardown.sh    # stops the meter
```

`verify.sh` checks the one thing that actually changes on Phala:

```
1 · hardwareAttestation.available  →  must be true (it is false on Heroku)
2 · all three tenant signers unchanged, so on-chain registrations still resolve
3 · cross-tenant isolation intact
4 · a real quote over a payload hash
```

If item 2 fails, `TEE_MASTER_SEED` did not carry over — **destroy immediately
and fix it.** Fresh tenant addresses silently invalidate dorr's registration on
`TEEAttestationVerifier`, and the chain stops recognising our quotes.

---

## What the three projects point at

`deploy.sh` prints the CVM URL. After deploying, that URL replaces the Heroku
enclave everywhere:

| project | what to change | where |
|---|---|---|
| **dorr** | `ENCLAVE_URL` config var on `dorr-operator` | Heroku |
| **hadal** | `setTeeAddress(0x24105E559E…)` — already the hadal tenant | one owner tx |
| **molfi** | `TENANT_MASTER_SEED` / point its sibling handlers at the CVM | molfi env |

Tenant identities (unchanged across deploys, because the seed is):

| project | signer |
|---|---|
| dorr | `0xE5f41AE46Dc48737D1232Ff33D8145fAa1004128` |
| hadal | `0x24105E559E82627984AD9f8d57e24c54cd1D93bA` |
| molfi | `0x8D642631287303432861e22B778166fB4Ca2404D` |

---

## Cost

| | |
|---|---|
| credit | $20 |
| `tdx.small` | $0.06/hr → ~333 hours |
| a deploy → verify → destroy cycle | ~15 min ≈ **$0.02** |
| leaving it up for the judging window (3 days) | ≈ **$4.32** |
| leaving it up for a week by accident | ≈ **$10** — half the budget, for nothing |

Rehearse the cycle as often as you like; it is effectively free. The expensive
mistake is forgetting `teardown.sh`.

**Destroy, don't stop.** A stopped CVM still bills for its disk.

---

## Honest limits to keep saying

- **Shared blast radius.** Three tenants, separate identities, no cross-project
  replay — but code inside the container can derive any tenant's key. One
  attested machine, three tenants, shared blast radius. Say it before a judge
  asks.
- **The seed comes from the environment**, not sealed to the hardware. That
  keeps the registered addresses valid, which is worth more this week — but it
  means the host operator could read it. Do not claim hardware-sealed custody.
