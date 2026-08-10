/**
 * Generate dorr deployer wallets:
 *  - Cardano preprod deployer (MeshWallet, networkId 0) — fund this with tADA
 *  - Midnight wallet mnemonic (BIP39) — for the local Midnight network / preprod
 *
 * Idempotent: refuses to overwrite an existing dorr/.env (use --force to regenerate).
 * Secrets land in dorr/.env (gitignored, chmod 600). NEVER commit.
 */
import { MeshWallet } from "@meshsdk/core";
import { generateMnemonic } from "bip39";
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../.env");

const force = process.argv.includes("--force");
if (existsSync(ENV_PATH) && !force) {
  console.error(`Refusing to overwrite ${ENV_PATH} — run with --force to regenerate.`);
  process.exit(1);
}

// --- Cardano preprod deployer ---
const cardanoWords = MeshWallet.brew() as string[];
const cardanoMnemonic = cardanoWords.join(" ");
const wallet = new MeshWallet({
  networkId: 0, // 0 = testnet (preprod)
  key: { type: "mnemonic", words: cardanoWords },
});
// Newer Mesh versions require async init before address derivation.
if (typeof (wallet as any).init === "function") {
  await (wallet as any).init();
}
const deployerAddress = await wallet.getChangeAddress();

// --- Midnight wallet (BIP39, used by midnight-js wallet builder) ---
const midnightMnemonic = generateMnemonic(256); // 24 words

const env = `# ─── dorr secrets — DO NOT COMMIT ────────────────────────────────
# Cardano preprod deployer (operator custody + contract deploys)
CARDANO_DEPLOYER_MNEMONIC="${cardanoMnemonic}"
CARDANO_DEPLOYER_ADDRESS="${deployerAddress}"
CARDANO_NETWORK="Preprod"
CARDANO_BACKEND="blockfrost"
# Get a free key at https://blockfrost.io (project for PREPROD) and paste it:
BLOCKFROST_PROJECT_ID=""

# Midnight (local network via docker: ghost-midnight-localnet-*)
MIDNIGHT_MNEMONIC="${midnightMnemonic}"
MIDNIGHT_DEPLOY_NETWORK="undeployed"
MIDNIGHT_INDEXER_HTTP="http://127.0.0.1:8087/api/v1/graphql"
MIDNIGHT_INDEXER_WS="ws://127.0.0.1:8087/api/v1/graphql/ws"
MIDNIGHT_NODE_RPC="http://127.0.0.1:9944"
MIDNIGHT_PROOF_SERVER="http://127.0.0.1:6300"

# Operator service
OPERATOR_PORT="8787"
`;

writeFileSync(ENV_PATH, env, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

console.log("─".repeat(64));
console.log("dorr deployer wallets generated → dorr/.env (chmod 600)");
console.log("─".repeat(64));
console.log("");
console.log("CARDANO PREPROD DEPLOYER ADDRESS (fund this):");
console.log("");
console.log(`  ${deployerAddress}`);
console.log("");
console.log("Faucet: https://docs.cardano.org/cardano-testnets/tools/faucet");
console.log("(select Preprod, paste the address, request tADA — do it 2-3x if allowed)");
console.log("─".repeat(64));
