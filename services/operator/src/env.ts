import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
dotenv({ path: resolve(DORR_ROOT, ".env") });

export const env = {
  port: Number(process.env.OPERATOR_PORT || 8790),
  /** When true, commit/execute/close/withdraw require a valid EIP-191 wallet signature. */
  authRequired: process.env.DORR_AUTH === "1" || process.env.DORR_AUTH === "required",
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
