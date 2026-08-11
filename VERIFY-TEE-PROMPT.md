# Prompt: prove the enclave a project talks to is the one you host

Paste this into a fresh agent session **inside the project you are checking** (hadal,
molfi, dorr, or anything else that claims to use the shared enclave). It is written to be
adversarial about its own answer: the failure it is hunting for is a project that *says* it
uses your enclave while actually signing locally, or pointing at a different host, or
accepting any signature at all.

---

```
Verify — with evidence, not by reading comments — that this project's confidential compute
really is the enclave hosted at:

  https://dorr-enclave-f7b366d50e22.herokuapp.com

Work in this order and show the command output for each step. If a step cannot be
completed, say so plainly and stop; do not substitute a weaker check that happens to pass.

1. IDENTITY THE ENCLAVE CLAIMS
   curl -s https://dorr-enclave-f7b366d50e22.herokuapp.com/tenants
   Record this project's `signer`, `teeId` and `sealingPublicKey`.
   Also fetch /tee/attestation and record `hardwareAttestation.available` and `.mode`
   verbatim — do not paraphrase them into something stronger.

2. WHAT THE CHAIN ACTUALLY TRUSTS
   Find every on-chain registration this project made for a TEE signer, and read it back
   from the chain rather than from a deployment file:
     - a custom verifier: cast call <verifier> "teeSigner(bytes32)(address)" <teeId>
     - Flare's registry:  cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
                            "getTeeMachineStatus(address)(uint8)" <machine>
   Compare against step 1. If the on-chain address is NOT the signer from /tenants, this
   project is not using the hosted enclave — say that outright.

3. WHERE THE CODE ACTUALLY SENDS ITS SIGNING REQUESTS
   Grep the source for the enclave hostname and for any local signing path. Specifically
   look for a private key in the app's own environment that could sign quotes without the
   enclave. If the app holds such a key, the hosted enclave is decorative: report it.

4. A LIVE QUOTE, END TO END
   Ask the enclave to sign a payload hash and recover the signer locally:
     curl -s -X POST .../t/<project>/sign -H 'content-type: application/json' \
       -d '{"payloadHash":"0x<64 hex>"}'
   Recover the address from `signature` over
     keccak256(abi.encodePacked(teeId, nonce, measurement, payloadHash))
   hashed with EIP-191. Confirm it equals the `signer` from step 1 AND the address
   registered in step 2.

5. TENANT ISOLATION IS REAL
   Seal a short plaintext to this project's `sealingPublicKey`, then POST the ciphertext to
   a DIFFERENT project's open endpoint. It must fail. If any other tenant can read this
   project's ciphertext, stop and report it as a critical finding.

6. THE NEGATIVE CASE
   Submit a quote signed by a different tenant (or a random key) to this project's
   verification path and confirm it is REJECTED. A check that only ever sees valid input
   has not been tested.

Then answer these four questions directly:
  a. Does this project use the hosted enclave, or does it sign locally?
  b. Does the chain verify the quote, or merely trust an address an owner set?
  c. Is the quote bound to the specific state transition being accepted, or is it a
     free-floating "an enclave exists" signature?
  d. Is there hardware behind it right now — quoting /tee/attestation exactly?

Be blunt where the answer is unflattering. A confidential-compute claim that turns out to
be a signature by whoever runs the process is the single thing most worth catching, and it
is much cheaper to catch it yourself than to have a judge do it.
```

---

## What good answers look like

For the **shared enclave as deployed today**:

- (a) uses the hosted enclave — the app holds no signing key
- (b) dorr: yes, `TEEAttestationVerifier.isTEEAttestedFor`. molfi: yes, via `FlareTeeManager`
      (machine status `2 = PRODUCTION`). hadal: check its registry wiring
- (c) yes for dorr — `DorrBatchSettlement` recomputes
      `keccak256(epochId, membershipRoot, clearingPrice, orderCount)` and rejects a quote
      over anything else
- (d) **no** — `/tee/attestation` currently reports `available: false, mode: "none"`. It runs on
      a normal Heroku dyno. That flips the moment the same image is deployed to Phala or
      Confidential Space, and not before.

If any answer comes back better than that list, re-read it — the endpoint is built to
report the weaker truth, so a stronger answer means something is being inferred rather
than measured.
