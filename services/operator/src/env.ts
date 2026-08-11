import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
dotenv({ path: resolve(DORR_ROOT, ".env") });

export const env = {
  // Hosts inject PORT; OPERATOR_PORT stays as an explicit local override.
  port: Number(process.env.OPERATOR_PORT || process.env.PORT || 8790),
  /**
   * Every value-moving call (commit/seal/execute/close/margin/stops/cancel/
   * disclose) must carry an EIP-191 signature from the acting address.
   *
   * Defaults to ON and must be turned off deliberately. It was opt-in once, and
   * with it unset the operator would happily open a leveraged position against
   * any address that had collateral in the vault — the caller never had to prove
   * they owned it. Failing closed is the only safe default for an endpoint that
   * can spend someone else's margin.
   */
  authRequired: !["0", "off", "false", "none"].includes(
    (process.env.DORR_AUTH ?? "").toLowerCase(),
  ),
  flare: {
    rpcUrl: process.env.FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    chainId: Number(process.env.FLARE_CHAIN_ID || 114),
    explorer: process.env.FLARE_EXPLORER || "https://coston2-explorer.flare.network",
    pollMs: Number(process.env.FLARE_POLL_MS || 3000),
    /** FAssets FXRP (Coston2 FTestXRP, 6dp) — resolve via AssetManagerFXRP.fAsset() */
    fxrp: process.env.FXRP_ADDRESS || "0x0b6A3645c240605887a5532109323A3E12273dc7",
    vault: process.env.DORR_VAULT_ADDRESS || "",
    settlement: process.env.DORR_SETTLEMENT_ADDRESS || "",
    teeVerifier: process.env.DORR_TEE_VERIFIER_ADDRESS || "",
    /** Enclave signing key + identity for batch attestations. */
    teeKey: process.env.TEE_ENCLAVE_KEY || "",
    teeId: process.env.TEE_ID || "",
    teeMeasurement: process.env.TEE_MEASUREMENT || "",
    /** Relayer that submits settlement txs (pays gas). */
    relayerKey: process.env.FLARE_RELAYER_KEY || "",
  },
};
