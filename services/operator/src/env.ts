import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
/** Vendored ZKPerps repo (npm-managed; Midnight CLI + Compact artifacts live here). */
export const ZKPERPS_ROOT = resolve(DORR_ROOT, "vendor/zkperps");

dotenv({ path: resolve(DORR_ROOT, ".env") });

// The engine's lucid_wallet/cardano_env read WALLET_MNEMONIC / CARDANO_* names.
// Map dorr's canonical names onto them so both stacks agree.
if (process.env.CARDANO_DEPLOYER_MNEMONIC && !process.env.WALLET_MNEMONIC) {
  process.env.WALLET_MNEMONIC = process.env.CARDANO_DEPLOYER_MNEMONIC;
}
if (process.env.MIDNIGHT_MNEMONIC && !process.env.BIP39_MNEMONIC) {
  process.env.BIP39_MNEMONIC = process.env.MIDNIGHT_MNEMONIC;
}

export const env = {
  port: Number(process.env.OPERATOR_PORT || 8790),
  /** When true, commit/execute/close/withdraw require a valid CIP-30 wallet signature. */
  authRequired: process.env.DORR_AUTH === "1" || process.env.DORR_AUTH === "required",
  cardano: {
    network: (process.env.CARDANO_NETWORK || "Preprod") as "Preprod" | "Preview" | "Mainnet",
    mnemonic: process.env.CARDANO_DEPLOYER_MNEMONIC || "",
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID || "",
    koiosUrl: process.env.KOIOS_URL || "https://preprod.koios.rest/api/v1",
  },
  midnight: {
    network: process.env.MIDNIGHT_DEPLOY_NETWORK || "undeployed",
    mnemonic: process.env.MIDNIGHT_MNEMONIC || "",
    indexerPort: process.env.INDEXER_PORT || "8088",
    nodePort: process.env.NODE_PORT || "9944",
    proofServerPort: process.env.PROOF_SERVER_PORT || "6300",
  },
  pyth: {
    hermesUrl: process.env.PYTH_HERMES_URL || "https://hermes.pyth.network",
    pollMs: Number(process.env.PYTH_POLL_MS || 3000),
  },
};
