# Prompt for the **hadal** session — point it at the real TEE

Paste after the dorr Phala CVM is live. **Replace `<CVM_URL>`** with the URL
`./verify.sh` printed.

---

```
The shared enclave now runs on real Intel TDX hardware — a Phala dstack CVM, not
a plain container. Live at:

  <CVM_URL>

Confirm that yourself before anything else:

  curl -s <CVM_URL>/tee/attestation | jq '.hardwareAttestation'

It must show available:true with a real quote. If it shows false, stop and tell
me — the rest of this is pointless without it.

hadal's tenant on that machine is already derived and has NOT changed:

  signer  0x24105E559E82627984AD9f8d57e24c54cd1D93bA
  key     HKDF-SHA256(seed, salt="flare-tee-kit/v1/sign", info="hadal")

Last time you assessed this move you recommended AGAINST it, and you were right
at the time: the enclave reported seed.source "env" with no hardware, so hadal
would have traded its own key custody for a host with the same trust posture and
triple the blast radius. One thing has changed — the hardware — and one has not:
the seed is still injected as an env var, not sealed to the TEE. So re-run that
judgement with the new facts rather than assuming the answer flipped.

TASK:

1. Re-read your own earlier conclusion and say whether real TDX changes it. Be
   specific about what hardware does and does not fix. It does not make the seed
   hardware-sealed, so the deployer can still read it.

2. If — and only if — you now think the move is right, point hadal's teeAddress
   at the hadal tenant:

     cast send <ConfidentialFXRP> "setTeeAddress(address,bytes32,bytes32)" \
       0x24105E559E82627984AD9f8d57e24c54cd1D93bA <pubKeyX> <pubKeyY> \
       --rpc-url https://coston2-api.flare.network/ext/C/rpc --private-key $OWNER_KEY

   Get pubKeyX/pubKeyY from <CVM_URL>/t/hadal/pubkey. Do this on the DEMO
   instance (0xb10C22607284DDC2D35a450706B2796638A78cA3), not the token holding
   the 20 FXRP pool — the same reasoning you used before still applies.

3. Whatever you decide, prove the enclave actually signs for hadal:
   - POST a payloadHash to <CVM_URL>/t/hadal/sign
   - recover the signer locally and confirm it equals 0x24105E559E…
   - confirm a quote signed for dorr does NOT recover to hadal's address

4. If you migrate, verify the existing ECIES ledger. Anything sealed to hadal's
   OLD key cannot be opened by the new tenant key. Say what happens to it —
   drained first, or a stated migration window. Do not let value get stranded.

Constraints:
  - The CVM is billed per hour and gets destroyed when I'm done, so do the
    verification now and record the output. Don't design anything that assumes
    the URL is permanent.
  - Keep the honest posture. attest.ts refuses to fabricate a quote; if any step
    would let hadal imply hardware-sealed key custody it does not have, stop.
  - "Don't migrate, just demonstrate" is a completely acceptable answer. Real
    hardware on a machine hadal doesn't control is not automatically better than
    a key hadal does control.
```
