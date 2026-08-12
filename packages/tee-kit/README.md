# flare-tee-kit

Confidential compute for Flare apps: it asks the host for a real TDX / Confidential Space
quote and reports honestly when it does not get one, ECIES
sealing, and multi-tenant enclave identities a contract can actually verify.

Extracted from [dorr](https://dorr-flare.vercel.app) and used by three Flare Summer Signal
entries from one hosted enclave.

## Why

Two common shapes, both weaker than they read:

- **Hardware you cannot check on-chain.** A live TDX machine is worth little if the
  contract just trusts an address the owner set — the chain has no idea whether that key is
  in an enclave or on a laptop.
- **An on-chain check with nothing behind it.** A registered signer with no hardware is a
  signature by whoever runs the process.

This kit is built so you can have both, and so the honest answer about which you currently
have is the easy one to publish.

## Install

```bash
npm i flare-tee-kit viem @noble/curves
```

## Use

```ts
import {
  generateMasterSeed, deriveTenant, signQuote, getHardwareQuote,
  sealToEnclave, openInEnclave,
} from "flare-tee-kit";

// In the enclave: one seed, one identity per product.
const seed = generateMasterSeed();
const hadal = deriveTenant(seed, "hadal");

hadal.signer.address;      // register this on-chain
hadal.sealingPublicKey;    // clients seal to this

// Clients seal; only this tenant can open.
const sealed = sealToEnclave(Buffer.from(hadal.sealingPublicKey.slice(2), "hex"), "amount:250");
openInEnclave(hadal.sealingPrivateKey, sealed);          // ok
openInEnclave(otherTenant.sealingPrivateKey, sealed);    // throws

// A quote bound to the state transition your contract is about to accept.
const quote = await signQuote({
  signer: hadal.signer,
  teeId: hadal.tenantId,
  measurement: MEASUREMENT,
  payloadHash,                       // what your contract recomputes
});

// And what the hardware says — honestly.
await getHardwareQuote(payloadHash);
// { available: false, mode: "none", note: "No enclave on this host. …" } off-enclave
// { available: true,  mode: "dstack", quote: "0x…" }                     on TDX
```

## The one thing to get right

Make your contract **recompute** `payloadHash` from the transition it is accepting:

```solidity
bytes32 payloadHash = keccak256(abi.encodePacked(epochId, root, price, count));
if (!verifier.isTEEAttestedFor(attestation, payloadHash)) revert NotAttested();
```

Without that, a quote proves an enclave is switched on. With it, the quote proves *this*
transition came from the enclave — and exposing a public signing endpoint becomes safe,
because a signature over a payload no contract recomputes is worth nothing.

## Multi-tenant, honestly

Per-tenant derived keys give you cross-project replay protection and key separation. They
do **not** isolate tenants from each other inside the process — enclave code can derive any
tenant's key. Two products that must survive each other's bugs need two enclaves.

## Envelope

161 bytes: `teeId(32) | nonce(32) | payloadHash(32) | signature(65)`, signed EIP-191 over
`keccak256(teeId, nonce, measurement, payloadHash)`. Both sides keccak256 — the reference
implementation this came from signed with SHA-256 against a keccak256 verifier, so none of
its quotes could ever verify. Pin it with a test against your verifier's own digest view.

MIT.
