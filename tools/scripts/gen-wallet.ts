/**
 * Generate the two EVM keypairs dorr needs to run on Flare Coston2:
 *
 *  - the **relayer**, which pays gas to submit batch settlements, and
 *  - the **enclave** signer, whose key never leaves the confidential-compute
 *    process and whose address is what TEEAttestationVerifier checks quotes against.
 *
 * Idempotent: refuses to overwrite an existing .env (pass --force to regenerate).
 * Secrets land in the repo-root .env, which is gitignored and written 0600.
 * Never commit it.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const outFlag = process.argv.indexOf("--out");
const ENV_PATH =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? resolve(process.cwd(), process.argv[outFlag + 1]!)
    : resolve(__dirname, "../../.env");

const force = process.argv.includes("--force");
if (existsSync(ENV_PATH) && !force) {
  console.error(`Refusing to overwrite ${ENV_PATH} — run with --force to regenerate.`);
  console.error("Regenerating replaces the relayer and enclave keys; any C2FLR held by the old relayer stays there.");
  process.exit(1);
}

const relayerKey = generatePrivateKey();
const relayer = privateKeyToAccount(relayerKey);

const enclaveKey = generatePrivateKey();
const enclave = privateKeyToAccount(enclaveKey);

// The TEE identity is an opaque 32-byte label bound into every quote. A fresh
// random value is correct for a dev enclave; a real deployment would derive it
// from the attested measurement its hardware reports.
const teeId = toHex(randomBytes(32));
const teeMeasurement = keccak256(toHex(`dorr-enclave:${enclave.address}`));

const body = `# ── Flare Coston2 ────────────────────────────────────────────────────────────
FLARE_RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
FLARE_CHAIN_ID="114"
FLARE_EXPLORER="https://coston2-explorer.flare.network"

# FAssets FXRP on Coston2 (6dp) — the margin collateral
FXRP_ADDRESS="0x0b6A3645c240605887a5532109323A3E12273dc7"

# ── Deployed contracts (fill in after \`forge script script/Deploy.s.sol\`) ─────
DORR_VAULT_ADDRESS=""
DORR_SETTLEMENT_ADDRESS=""
DORR_TEE_VERIFIER_ADDRESS=""

# ── Relayer — pays gas for batch settlement. FUND THIS WITH C2FLR. ───────────
FLARE_RELAYER_KEY="${relayerKey}"

# ── Confidential compute enclave — the order-decryption key lives only here ───
TEE_ENCLAVE_KEY="${enclaveKey}"
TEE_ID="${teeId}"
TEE_MEASUREMENT="${teeMeasurement}"

# ── Operator ─────────────────────────────────────────────────────────────────
OPERATOR_PORT="8791"
# Require an EIP-191 wallet signature on every value-moving call.
DORR_AUTH="1"
`;

writeFileSync(ENV_PATH, body, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

console.log(`Wrote ${ENV_PATH} (0600).\n`);
console.log("RELAYER ADDRESS (fund this with C2FLR):");
console.log(`  ${relayer.address}`);
console.log("Faucet: https://faucet.flare.network/coston2");
console.log("(it also hands out the FXRP you need for margin)\n");
console.log("ENCLAVE SIGNER (TEEAttestationVerifier checks quotes against this):");
console.log(`  ${enclave.address}`);
