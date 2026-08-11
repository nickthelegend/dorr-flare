# Prompt for the **molfi** session

Paste from the line below. It assumes cwd is
`/Volumes/Extreme SSD/Projects/molfi-flare/molfi-flare-monorepo`.

---

```
Context you do not have yet: two sibling projects of mine — dorr (sealed perp orders,
github.com/nickthelegend/dorr-flare) and hadal (confidential FXRP amounts) — are Flare
Summer Signal entries alongside molfi, and all three want confidential compute.

I had a shared enclave built on Heroku and was about to point molfi at it. That is the
wrong direction and I want you to check my reasoning before we do anything.

What molfi already has, which I want you to verify from the chain rather than from
REGISTRATION.md:

  cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getTeeMachineStatus(address)(uint8)" \
    0x0A752D897f7D61Ce0690EEF812027000813467bb \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc

If that still returns 2 (PRODUCTION), then molfi has the strongest confidential-compute
artifact of the three: a machine Flare's own data providers reached, attested and voted
available. Moving molfi onto a Heroku box would throw that away.

So the proposal is the inverse. TASK:

1. Confirm or refute that molfi's registered FCE container can host additional opTypes
   beyond MOLFI. I believe it can — extension/src/app/handlers.ts wires handlers with
   framework.handle(OP_TYPE, OP_COMMAND, fn), so OP_TYPE_DORR and OP_TYPE_HADAL look like
   more of the same. Tell me if there is a constraint I am missing (registration binds an
   opType list, the scaffold rejects unknown types, an ABI assumption, anything).

2. Cost me the re-registration honestly. Adding opTypes changes the image, which changes
   the code hash, which I assume means re-running sync-extension.mjs → start-services.sh →
   verify-image.mjs → register.sh and waiting for the availability check again. Tell me
   what actually has to happen, what can go wrong, and whether the machine drops out of
   status 2 while it happens. If there is a way to stage it so molfi is never unregistered,
   say so.

3. If it is viable, implement it: add DORR and HADAL opTypes to the extension, with each
   product getting its OWN derived signing and sealing key rather than sharing molfi's.
   There is a package for exactly this — `flare-tee-kit` in the dorr repo
   (packages/tee-kit) — with tenant derivation:

     signingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/sign",  info=p)
     sealingKey(p) = HKDF-SHA256(seed, salt="flare-tee-kit/v1/ecies", info=p)

   Use it or reimplement it, your call — but the property I need is that a quote signed for
   dorr does not recover to the address hadal registered, and a bid sealed to molfi cannot
   be opened by either. Vendor the code if pulling a dependency into the registered image
   is a problem; a smaller audited surface inside the enclave may be the better trade and I
   would rather you told me that than silently added a dependency.

4. Keep molfi's existing MOLFI/SEAL_KEY and MOLFI/OPEN_BOOK behaviour bit-identical. This
   must not become a molfi refactor.

5. Extend verify-image.mjs so it proves the new property from inside the running container:
   a ciphertext sealed to dorr's tenant must fail to open under molfi's key, and vice
   versa. That check is the whole point — if it is not tested from the container it is not
   real.

Constraints, and I mean these:
  - No mocks. If SIMULATED_TEE is on anywhere in the path, say so rather than letting it
    stand in for the real container.
  - Do not weaken anything molfi already proves. The `2` on FlareTeeManager and everything
    verify-image.mjs asserts today must still hold at the end.
  - Tell me plainly if the answer is "this is not worth the re-registration risk this close
    to submission". A working molfi with status 2 beats a broken three-tenant experiment,
    and I would rather hear that now.

Start by reading molfi-fcc/REGISTRATION.md, molfi-fcc/extension/src/app/handlers.ts and
molfi-fcc/src/server.mjs, then tell me what you found before you change anything.
```
