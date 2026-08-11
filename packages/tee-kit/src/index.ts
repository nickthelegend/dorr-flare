/**
 * flare-tee-kit — confidential compute for Flare apps.
 *
 * Four pieces, each usable on its own:
 *
 *   `hardware`  ask a real enclave for a real quote (Phala dstack / Intel TDX,
 *               or Google Confidential Space), with `report_data` bound to the
 *               payload you are attesting. Reports `available: false` and says
 *               why when there is no enclave, and never substitutes a
 *               self-declared environment variable for a measurement the
 *               hardware declined to give.
 *
 *   `attest`    the 161-byte envelope `teeId|nonce|payloadHash|sig`, signed so a
 *               Solidity verifier can recover it and check it against the exact
 *               state transition it is about to accept.
 *
 *   `tenants`   several products on one attested machine, each with its own
 *               derived signing and sealing keys, so a quote for one cannot be
 *               replayed at another.
 *
 *   `ecies`     secp256k1 ECDH → HKDF-SHA256 → AES-256-GCM, so clients can seal
 *               data to the enclave that nothing outside it can read.
 *
 * The design opinion behind all of it: an attestation is only worth what the
 * chain checks. Hardware you cannot verify on-chain is a screenshot; an on-chain
 * check with no hardware behind it is a signature. Say which of the two you have
 * — the kit is built so you can have both, and so the honest answer is the easy
 * one to publish.
 */
export {
  getHardwareQuote,
  detectTee,
  type HardwareQuote,
  type TeeMode,
} from "./hardware.js";

export { signQuote, parseQuote, attestationDigest, type Quote } from "./attest.js";

export {
  deriveTenant,
  deriveTenants,
  generateMasterSeed,
  type Tenant,
  type ProjectId,
} from "./tenants.js";

export * from "./ecies.js";
