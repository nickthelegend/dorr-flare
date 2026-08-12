# Phala deploy kit — deploying the enclave to real Intel TDX

> **Status: the host is TDX, the quote is not yet obtained.** See the run log at the
> bottom before repeating any hardware claim from this file.

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

---

## Run log — first real deploy (2026-08-11)

Two CVMs created and destroyed on prod5. Total spend: **under 10 cents.**

**Proven:**

| | |
|---|---|
| Deploy → verify → destroy cycle | works end to end, `tdx.small` @ $0.058/hr |
| Enclave detects the TEE | `/tee/health` → `"tee":"dstack"` (it is `"none"` on Heroku) |
| **All three tenant signers unchanged** | dorr `0xE5f41AE4…`, hadal `0x24105E55…`, molfi `0x8D642631…` — the seed carried over, so every on-chain registration still resolves. This was the one failure that would have wasted the window. |
| Cross-tenant isolation | intact on hardware |

**Not proven — the quote itself.** `hardwareAttestation.available` is still `false`.
All four RPC spellings 404, and they return **HTML**, not a JSON-RPC error:

```
/prpc/GetQuote?json         → 404 <!DOCTYPE html>
/prpc/Worker.GetQuote?json  → 404 <!DOCTYPE html>
/prpc/Dstack.GetQuote?json  → 404 <!DOCTYPE html>
/prpc/Tappd.TdxQuote?json   → 404 <!DOCTYPE html>
```

An HTML body means `/var/run/dstack.sock` is not serving the guest-agent RPC that
`hardware.ts` expects on this image — not that the method name is merely wrong.
Note the CLI auto-selected `dstack-dev-0.5.9` (`is_dev: true`); pinning a
non-dev image is the first thing to try.

**The next step is a discovery run, not another guess.** Add a temporary endpoint
that proxies an arbitrary path to the socket, deploy once, and ask the socket what
it actually serves (`/`, `/prpc/Info`, `/prpc`). One CVM, a few cents, and the
answer instead of a fifth guess.

The behaviour under failure is correct and worth keeping: it reports
`available:false` with the attempts rather than falling back to a self-declared
image digest — which is precisely what the competing entry does.
