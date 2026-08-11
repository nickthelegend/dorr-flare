# Sharing one attested enclave across several projects

You have one confidential-compute machine and three products that want it: **dorr**
(sealed perp orders), **hadal** (confidential FXRP amounts), **molfi** (sealed-bid
prediction markets). This is how to point all three at it without the sharing quietly
undoing the thing you are sharing.

> **Read [INTEGRATION.md](INTEGRATION.md) first.** It corrects the obvious plan: molfi is
> already registered PRODUCTION on Flare's own `FlareTeeManager`, and hadal's contract
> already checks the native machine registry — so the shared enclave should end up on
> molfi's attested container, not on the Heroku box described below. The Heroku instance is
> a working staging environment, not the submission claim.

---

## The live one

| | |
|---|---|
| Shared enclave | `https://dorr-enclave-f7b366d50e22.herokuapp.com` |
| Tenants | `GET /tenants` |
| Machine attestation | `GET /tee/attestation` |
| Per-project key | `GET /t/{project}/pubkey` |
| Per-project open | `POST /t/{project}/open` |
| Per-project sign | `POST /t/{project}/sign` |

```bash
curl -s https://dorr-enclave-f7b366d50e22.herokuapp.com/tenants | jq
```

---

## Read this part before the integration steps

**One enclave, three identities — not three sandboxes.**

Each project gets its own signing key and its own sealing key, derived from the enclave's
master seed:

```
signingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/sign",  info=p)
sealingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/ecies", info=p)
```

That buys two real things:

- **Ciphertext sealed to one project cannot be opened by another.** Verified in
  `packages/tee-kit/src/kit.test.ts` and over HTTP — `POST /t/hadal/open` on a dorr
  ciphertext returns `could not open`.
- **A quote for one project cannot be replayed at another.** dorr's quote recovers to
  dorr's signer, which is not the address hadal registered. No shared payload format to
  keep collision-free, no domain-separation discipline to remember.

It does **not** buy isolation between tenants inside the process. Code running in the
enclave can derive any tenant's key, so a compromise of the enclave compromises all three.
If two of these products must be safe from each other's *bugs*, run two enclaves — it is
the same image with a different `TEE_PROJECTS`.

Say this in your submission rather than letting a judge find it. "One attested machine,
three tenants, separate identities, shared blast radius" is a defensible sentence. "Three
projects share a TEE" invites the question you did not answer.

---

## Integrating a project

### 1 · Get the project's identity

```bash
ENCLAVE=https://dorr-enclave-f7b366d50e22.herokuapp.com
curl -s $ENCLAVE/tenants | jq '.tenants[] | select(.projectId=="hadal")'
```

You get `signer` (register this on-chain), `teeId`, and `sealingPublicKey` (hand this to
clients).

### 2 · Register the signer on-chain

Whatever your verifier is, it needs to know the address quotes will recover to.

**dorr** uses its own `TEEAttestationVerifier`:

```bash
cast send $TEE_VERIFIER "registerTEE(bytes32,address,bytes32)" \
  $TEE_ID $SIGNER $MEASUREMENT --rpc-url $RPC --private-key $OWNER_KEY
```

**molfi** is already registered on Flare's native registry — `FlareTeeManager`
`0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`, machine
`0x0A752D897f7D61Ce0690EEF812027000813467bb`, status `2 = PRODUCTION`. That proves
reachability, governance and availability — Flare's own providers vouching for the machine.
It does **not** prove a hardware measurement: `SIMULATED_TEE=true` is defaulted on by
`post-build.sh`. See [INTEGRATION.md](INTEGRATION.md) for the corrected claim.

**hadal** fetches real dstack/Confidential Space quotes in `tee/src/attest.ts`, but its
value-releasing path checks only `ecrecover(...) == teeAddress` — a mutable address, with
the signing key in a file on disk. The registries it holds are used for instruction routing
only. Do not describe hadal as registry-verified until that changes.

### 3 · Seal to the project's key

```ts
import { sealToEnclave, encodeSealed } from "flare-tee-kit";

const { sealingPublicKey } = await (await fetch(`${ENCLAVE}/t/hadal/pubkey`)).json();
const sealed = encodeSealed(
  sealToEnclave(Buffer.from(sealingPublicKey.slice(2), "hex"), JSON.stringify(payload)),
);
// `sealed` is safe to put on-chain or through your API — only hadal's tenant can open it.
```

### 4 · Get a quote your contract will check

```ts
const payloadHash = keccak256(encodePacked([...], [...]));  // whatever your contract recomputes
const quote = await (await fetch(`${ENCLAVE}/t/hadal/sign`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ payloadHash }),
})).json();
// quote.attestation → 161 bytes: teeId(32) | nonce(32) | payloadHash(32) | sig(65)
```

### 5 · Make the contract recompute the hash

This is the step that matters, and the one most projects skip.

```solidity
bytes32 payloadHash = keccak256(abi.encodePacked(/* the state transition you are accepting */));
if (!teeVerifier.isTEEAttestedFor(b.attestation, payloadHash)) revert NotAttested();
```

A verifier that only checks "an enclave signed something" is checking that the enclave is
switched on. Recomputing the hash from the transition in front of it is what makes the
quote mean *this* transition came from the enclave — and it is also what makes step 4 safe
to expose publicly: a signature over a payload no contract recomputes is worth nothing.

---

## Running your own instance

```bash
TEE_PROJECTS=hadal,molfi \
TEE_SEED_PATH=/data/seed.hex \
TEE_MEASUREMENT=0x… \
bun run --cwd services/operator tee
```

`TEE_SEED_PATH` matters more than it looks. Without it the master seed is regenerated on
every restart, every tenant address changes, and every on-chain registration you made goes
stale. `/attestation` reports `seed.persisted` so you can see which you have.

Under real confidential compute the seed belongs in sealed storage the platform binds to
the image. On a plain host it is a file, and the endpoint says so rather than implying
otherwise.

---

## Turning on real hardware

The kit already asks for a real quote — `packages/tee-kit/src/hardware.ts` opens
`/var/run/dstack.sock` (Phala / Intel TDX) or the Confidential Space launcher socket, with
`report_data` set to the payload hash so the hardware signature covers the specific request
rather than merely the fact that an enclave exists.

On a host with no enclave it reports `available: false` and says why. It never substitutes
a self-declared environment variable for a measurement the hardware declined to give — which
is worth knowing, because at least one competing entry does exactly that.

To light it up, deploy the same image to Phala Cloud or GCP Confidential Space. No code
changes: the socket appears, `detectTee()` stops returning `none`, and `/attestation`
starts carrying a real quote and image digest.

---

## Publishing the kit

`packages/tee-kit` is publish-ready and has no dependency on any of the three apps.

```bash
cd packages/tee-kit
npm login
npm publish --access public
```

It is currently unpublished — you were not logged into npm — so projects consume it as a
workspace dependency or a git path until you run that.
