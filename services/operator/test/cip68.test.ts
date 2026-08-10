/**
 * CIP-68 position NFT mint, verified on the emulator (no funds).
 * Asserts: (222) lands in the trader's wallet, (100) reference + inline
 * metadata datum lands with the operator, and the datum decodes back.
 */
import { test, expect } from "bun:test";
import {
  Emulator,
  Lucid,
  generateSeedPhrase,
  walletFromSeed,
  scriptFromNative,
  mintingPolicyToId,
  paymentCredentialOf,
  fromText,
  toText,
  Data,
  Constr,
} from "@lucid-evolution/lucid";
import { cip68Units, mintPositionNftWith } from "../src/cardano-nft.js";

test("mint CIP-68 position NFT: 222 to trader, 100+metadata to operator", async () => {
  const opSeed = generateSeedPhrase();
  const userSeed = generateSeedPhrase();
  const op = walletFromSeed(opSeed, { network: "Custom", addressType: "Base", accountIndex: 0 });
  const user = walletFromSeed(userSeed, { network: "Custom", addressType: "Base", accountIndex: 0 });
  const emulator = new Emulator([
    { seedPhrase: opSeed, address: op.address, privateKey: op.paymentKey, assets: { lovelace: 50_000_000_000n } },
    { seedPhrase: userSeed, address: user.address, privateKey: user.paymentKey, assets: { lovelace: 50_000_000_000n } },
  ]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(opSeed);

  const operatorPkh = paymentCredentialOf(op.address).hash;
  const policy = scriptFromNative({ type: "sig", keyHash: operatorPkh });
  const policyId = mintingPolicyToId(policy);
  const tokenNameHex = fromText("dorrpos-abcd1234");

  const meta = {
    name: "dorr FLR-USD LONG",
    market: "FLR-USD",
    side: "LONG",
    entryPrice: "0.15790",
    size: "31787.83",
    leverage: "5",
  };

  const res = await mintPositionNftWith(
    lucid,
    { policy, policyId, operatorAddress: op.address },
    user.address,
    tokenNameHex,
    meta,
  );
  emulator.awaitBlock(1);

  const { refUnit, userUnit } = cip68Units(policyId, tokenNameHex);
  expect(res.userUnit).toBe(userUnit);
  expect(res.refUnit).toBe(refUnit);

  // (222) user NFT is in the trader's wallet
  const userUtxos = await lucid.utxosAt(user.address);
  expect(userUtxos.some((u) => (u.assets[userUnit] ?? 0n) === 1n)).toBe(true);

  // (100) reference NFT + inline metadata datum is with the operator
  const opUtxos = await lucid.utxosAt(op.address);
  const ref = opUtxos.find((u) => (u.assets[refUnit] ?? 0n) === 1n && u.datum);
  expect(ref).toBeDefined();

  const datum = Data.from(ref!.datum!) as Constr<unknown>;
  expect(datum.index).toBe(0);
  const [mdMap, version] = datum.fields as [Map<string, string>, bigint];
  expect(version).toBe(1n);
  expect(toText(mdMap.get(fromText("market"))!)).toBe("FLR-USD");
  expect(toText(mdMap.get(fromText("side"))!)).toBe("LONG");
  expect(toText(mdMap.get(fromText("leverage"))!)).toBe("5");
}, 60_000);
