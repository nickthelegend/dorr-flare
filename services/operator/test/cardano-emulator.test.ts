/**
 * Verify the ENTIRE Cardano tx layer against Lucid's in-process emulator —
 * no preprod funds required. This proves the same tx-building + datum logic the
 * operator uses on preprod: dUSD mint (faucet) → vault deposit (attributed
 * datum) → scan/decode → operator-signed withdraw → settlement anchor.
 * If this is green, funding preprod is the only thing between us and mainnet-shaped txs.
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
  validatorToAddress,
  applyParamsToScript,
  fromText,
  Data,
  Constr,
  type LucidEvolution,
  type Script,
} from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorDatumCbor, settlementAnchorSpendingScript, settlementAnchorScriptAddress } from "@dorr/engine/cardano/settlement_anchor";
import { DORR_ROOT } from "../src/env.js";

const DUSD_NAME_HEX = fromText("dUSD");
const usd = (n: number) => BigInt(Math.round(n * 1e6));

async function boot() {
  const operatorSeed = generateSeedPhrase();
  const userSeed = generateSeedPhrase();
  const opW = walletFromSeed(operatorSeed, { network: "Custom", addressType: "Base", accountIndex: 0 });
  const userW = walletFromSeed(userSeed, { network: "Custom", addressType: "Base", accountIndex: 0 });
  const emulator = new Emulator([
    { seedPhrase: operatorSeed, address: opW.address, privateKey: opW.paymentKey, assets: { lovelace: 50_000_000_000n } },
    { seedPhrase: userSeed, address: userW.address, privateKey: userW.paymentKey, assets: { lovelace: 50_000_000_000n } },
  ]);
  const lucid = await Lucid(emulator, "Custom");

  const operatorAddress = opW.address;
  const userAddress = userW.address;
  const operatorPkh = paymentCredentialOf(operatorAddress).hash;

  const dusdPolicy = scriptFromNative({ type: "sig", keyHash: operatorPkh });
  const dusdPolicyId = mintingPolicyToId(dusdPolicy);
  const dusdUnit = dusdPolicyId + DUSD_NAME_HEX;

  const vaultBlueprint = JSON.parse(
    readFileSync(resolve(DORR_ROOT, "packages/contracts-aiken/dorr-vault/plutus.json"), "utf8"),
  ) as { validators: Array<{ title: string; compiledCode: string }> };
  const vaultRow = vaultBlueprint.validators.find((v) => v.title === "margin_vault.margin_vault.spend")!;
  const vaultScript: Script = { type: "PlutusV3", script: applyParamsToScript(vaultRow.compiledCode, [operatorPkh]) };
  const vaultAddress = validatorToAddress("Custom", vaultScript);

  return { lucid, emulator, operatorSeed, userSeed, operatorAddress, userAddress, operatorPkh, dusdPolicy, dusdUnit, vaultScript, vaultAddress };
}

function vaultDatum(ownerAddress: string): string {
  return Data.to(new Constr(0, [paymentCredentialOf(ownerAddress).hash]));
}

async function balance(lucid: LucidEvolution, address: string, unit: string): Promise<bigint> {
  const utxos = await lucid.utxosAt(address);
  return utxos.reduce((a, u) => a + (u.assets[unit] ?? 0n), 0n);
}

test("faucet mint → vault deposit → scan → withdraw → anchor (emulator)", async () => {
  const b = await boot();
  const { lucid, emulator } = b;

  // 1) faucet: operator mints 10,000 dUSD to the user
  lucid.selectWallet.fromSeed(b.operatorSeed);
  const mintTx = await lucid.newTx()
    .mintAssets({ [b.dusdUnit]: usd(10_000) })
    .pay.ToAddress(b.userAddress, { [b.dusdUnit]: usd(10_000), lovelace: 2_000_000n })
    .attach.MintingPolicy(b.dusdPolicy)
    .complete();
  await (await mintTx.sign.withWallet().complete()).submit();
  emulator.awaitBlock(1);
  expect(await balance(lucid, b.userAddress, b.dusdUnit)).toBe(usd(10_000));

  // 2) deposit: USER sends 4,000 dUSD to the vault with an attributed inline datum
  lucid.selectWallet.fromSeed(b.userSeed);
  const depTx = await lucid.newTx()
    .pay.ToContract(b.vaultAddress, { kind: "inline", value: vaultDatum(b.userAddress) }, { [b.dusdUnit]: usd(4_000), lovelace: 2_000_000n })
    .complete();
  await (await depTx.sign.withWallet().complete()).submit();
  emulator.awaitBlock(1);

  // 3) scan: decode depositor attribution from the vault datum
  const vaultUtxos = await lucid.utxosAt(b.vaultAddress);
  const deposit = vaultUtxos.find((u) => (u.assets[b.dusdUnit] ?? 0n) > 0n && u.datum);
  expect(deposit).toBeDefined();
  const decoded = Data.from(deposit!.datum!) as Constr<string>;
  expect(String(decoded.fields[0])).toBe(paymentCredentialOf(b.userAddress).hash);
  expect(deposit!.assets[b.dusdUnit]).toBe(usd(4_000));

  // 4) withdraw: OPERATOR spends the vault UTxO (operator sig required) back to the user
  lucid.selectWallet.fromSeed(b.operatorSeed);
  const wTx = await lucid.newTx()
    .collectFrom([deposit!], Data.void())
    .attach.SpendingValidator(b.vaultScript)
    .addSigner(b.operatorAddress)
    .pay.ToAddress(b.userAddress, { [b.dusdUnit]: usd(4_000), lovelace: 2_000_000n })
    .complete();
  await (await wTx.sign.withWallet().complete()).submit();
  emulator.awaitBlock(1);
  expect(await balance(lucid, b.userAddress, b.dusdUnit)).toBe(usd(10_000));

  // 5) anchor: operator locks a settlement digest at the Aiken settlement_anchor
  const anchorScript = settlementAnchorSpendingScript();
  const anchorAddr = settlementAnchorScriptAddress("Custom", anchorScript);
  const datum = anchorDatumCbor({
    settlementId: "emu-1",
    orderCommitmentHex: "ab".repeat(32),
    midnightTxUtf8: "midnight-tx-ref",
  });
  const aTx = await lucid.newTx()
    .pay.ToContract(anchorAddr, { kind: "inline", value: datum }, { lovelace: 2_000_000n })
    .complete();
  const anchorHash = await (await aTx.sign.withWallet().complete()).submit();
  emulator.awaitBlock(1);
  expect(anchorHash).toMatch(/^[0-9a-f]{64}$/);
  const anchored = (await lucid.utxosAt(anchorAddr)).find((u) => u.txHash === anchorHash);
  expect(anchored).toBeDefined();
}, 60_000);
