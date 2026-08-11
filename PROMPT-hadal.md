# Prompt for the **hadal** session

Paste from the line below. It assumes cwd is `/Volumes/Extreme SSD/Projects/flare/hadal`.

---

```
Context you do not have yet: two sibling projects of mine — dorr (sealed perp orders,
github.com/nickthelegend/dorr-flare) and molfi (sealed-bid prediction markets) — are Flare
Summer Signal entries alongside hadal, and all three use confidential compute. I want them
on ONE attested machine instead of three, with each product keeping its own identity.

The candidate machine is molfi's, because it is already registered on Flare's native
registry and the network itself voted it available:

  cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getTeeMachineStatus(address)(uint8)" \
    0x0A752D897f7D61Ce0690EEF812027000813467bb \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
  # → 2 (PRODUCTION)

There is also a working staging enclave at
https://dorr-enclave-f7b366d50e22.herokuapp.com with a hadal tenant already derived
(GET /tenants). It has NO hardware — /tee/attestation reports available:false — so treat it
as dev only, never as the submission claim.

TASK, in this order:

1. Tell me what hadal's TEE trust model actually is today, read from the source rather than
   the docs. I believe ConfidentialFXRP.sol takes ITeeMachineRegistry and
   ITeeExtensionRegistry in its constructor and only releases value against an ecrecover to
   `teeAddress`. Confirm or correct that, and tell me exactly where teeAddress is set and by
   whom.

2. Establish where hadal's enclave key lives right now. tee/src/keys.ts mentions a key
   persisted to data/tee-key. Answer directly: can the hadal *server process* sign
   value-releasing messages by itself? If yes, the enclave is decorative for that path and I
   want it named, not smoothed over.

3. Then assess the move. If hadal points at the shared machine, hadal's teeAddress becomes
   the hadal tenant's derived signer on that machine, and hadal stops holding a signing key
   at all. Tell me:
     - what breaks,
     - what has to be re-registered or re-deployed,
     - whether hadal's contract needs any change or whether this is purely configuration,
     - and whether hadal loses anything it currently proves.

4. Only if the answer to 3 is favourable, implement it. hadal's per-tenant identity comes
   from the same derivation the other two use:
     signingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/sign",  info="hadal")
     sealingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/ecies", info="hadal")
   The package is `flare-tee-kit` (packages/tee-kit in the dorr repo). Vendor it if pulling
   a dependency into an attested image is the wrong trade — tell me which you chose and why.

5. Verify it end to end rather than by inspection: seal an amount to hadal's tenant key,
   confirm it opens for hadal, confirm it does NOT open for dorr's or molfi's tenant, and
   confirm a quote signed by another tenant is REJECTED by hadal's contract path. A check
   that only ever sees valid input has not been tested.

Two things I care about more than the feature:

  - hadal's attest.ts already refuses to fabricate an attestation, and its comments call out
    a reference implementation that shipped a verifyMockAttestation path. Keep that posture.
    If any step here would make hadal's claim weaker or vaguer, stop and tell me.
  - Be blunt about the shared-machine trade-off. One container serving three products means
    per-tenant keys and no cross-project replay, but a compromise of the container is a
    compromise of all three. If you think hadal should keep its own machine, say so — I
    would rather ship three honest enclaves than one shared claim I have to qualify.

Start by reading onchain/src/ConfidentialFXRP.sol, tee/src/keys.ts and tee/src/attest.ts,
then report what you found before changing anything.
```
