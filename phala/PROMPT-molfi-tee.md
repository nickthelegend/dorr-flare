# Prompt for the **molfi** session — real hardware exists now

Paste after the dorr Phala CVM is live. **Replace `<CVM_URL>`**.

---

```
There is now a real Intel TDX machine running the shared enclave — a Phala
dstack CVM:

  <CVM_URL>

  curl -s <CVM_URL>/tee/attestation | jq '.hardwareAttestation'
  → available:true, a real quote

molfi's tenant is derived on it and unchanged:
  signer 0x8D642631287303432861e22B778166fB4Ca2404D

READ THIS BEFORE YOU PLAN ANYTHING. I am not asking you to migrate molfi, and
I do not want you to rebuild or re-register the FCC machine. You told me last
time not to bet status 2 on a rebuild this close to the deadline and I agree.
That still stands. molfi's ENCLAVE_PRIVATE_KEY / TEE_SIGNER_KEY stay exactly as
they are, and SealedBidBook.teeSigner keeps pointing where it points.

What I actually want is the honest sentence for the submission, because molfi
and dorr now have opposite halves of the same claim:

  molfi : registered PRODUCTION on Flare's own FlareTeeManager — reachability,
          governance and availability verified by Flare's data providers — but
          SIMULATED_TEE=true, so the code hash is not a hardware measurement.
  dorr  : real Intel TDX with a hardware quote, and a payload-bound attestation
          the chain checks — but not registered on FlareTeeManager.

TASK — analysis and writing, not deployment:

1. Verify from the chain that molfi is still status 2:
     cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
       "getTeeMachineStatus(address)(uint8)" \
       0x0A752D897f7D61Ce0690EEF812027000813467bb \
       --rpc-url https://coston2-api.flare.network/ext/C/rpc

2. Write the paragraph molfi submits about its TEE. It must state plainly what
   the 2 proves and what it does not — no rebuild, no new claim, just an
   accurate one. If a judge could read it as "hardware-attested enclave",
   rewrite it until they cannot.

3. The registered proxy URL decodes to a Cloudflare quick tunnel that now 404s.
   If a judge clicks it, it is dead. Tell me whether that is fixable WITHOUT a
   rebuild — an on-chain URL update, a re-pointed tunnel, anything that does not
   touch the image. If it needs a rebuild, say so and we leave it.

4. Tell me honestly whether pointing molfi's siblings (the DORR/HADAL opTypes
   you staged) at this TDX machine buys anything, or whether it is just moving
   the same tenant derivation to a different host. I suspect the latter and want
   you to say so if you agree.

Constraint: the CVM is billed hourly and will be destroyed shortly, so do not
design anything that assumes that URL persists. Capture what you need now.
```
