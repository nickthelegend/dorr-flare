import {
  Blockfrost,
  Lucid,
  Emulator,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import {
  blockfrostConfig,
  cardanoBackend,
  walletMnemonic,
} from "../config/cardano_env.js";

export type AppLucid = Awaited<ReturnType<typeof Lucid>>;

let sharedEmulator: Emulator | null = null;

/** Clears the in-process Cardano emulator (fresh genesis UTxO set). For benchmarks / repeated scripts. */
export function resetCardanoEmulator(): void {
  sharedEmulator = null;
}

function getOrCreateEmulator(mnemonic: string): Emulator {
  if (sharedEmulator) return sharedEmulator;
  const w = walletFromSeed(mnemonic, {
    network: "Custom",
    addressType: "Base",
    accountIndex: 0,
  });
  const lovelace = BigInt(process.env.EMULATOR_SEED_LOVELACE || "50000000000");
  sharedEmulator = new Emulator([
    {
      seedPhrase: mnemonic,
      address: w.address,
      privateKey: w.paymentKey,
      assets: { lovelace },
    },
  ]);
  return sharedEmulator;
}

export async function createAppLucid(): Promise<AppLucid> {
  const mnemonic = walletMnemonic();
  if (cardanoBackend() === "emulator") {
    const emulator = getOrCreateEmulator(mnemonic);
    const lucid = await Lucid(emulator, "Custom");
    lucid.selectWallet.fromSeed(mnemonic.trim(), {
      addressType: "Base",
      accountIndex: Number(process.env.EMULATOR_ACCOUNT_INDEX || "0"),
    });
    return lucid;
  }
  const c = blockfrostConfig();
  const lucid = await Lucid(new Blockfrost(c.url, c.projectId), c.network);
  lucid.selectWallet.fromSeed(mnemonic.trim(), {
    addressType: "Base",
    accountIndex: 0,
  });
  return lucid;
}
