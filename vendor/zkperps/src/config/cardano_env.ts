import "dotenv/config";

export type CardanoBackend = "blockfrost" | "emulator";

export function cardanoBackend(): CardanoBackend {
  const raw = (process.env.CARDANO_BACKEND || "blockfrost").toLowerCase();
  if (raw === "emulator" || raw === "local") return "emulator";
  return "blockfrost";
}

export function blockfrostProjectId(): string {
  const id = process.env.BLOCKFROST_PROJECT_ID || process.env.BLOCKFROST_API_KEY;
  if (!id) {
    throw new Error(
      "Set BLOCKFROST_PROJECT_ID (or BLOCKFROST_API_KEY) when CARDANO_BACKEND=blockfrost",
    );
  }
  return id;
}

export function blockfrostConfig() {
  return {
    url:
      process.env.BLOCKFROST_URL ||
      "https://cardano-preprod.blockfrost.io/api/v0",
    projectId: blockfrostProjectId(),
    network: (process.env.CARDANO_NETWORK || "Preprod") as
      | "Preprod"
      | "Preview"
      | "Mainnet",
  };
}

export function walletMnemonic(): string {
  const m = process.env.WALLET_MNEMONIC?.trim();
  if (!m) throw new Error("Set WALLET_MNEMONIC (testnet wallet)");
  return m;
}
