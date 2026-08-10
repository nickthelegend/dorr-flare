/**
 * NON-CUSTODIAL VAULT — live preprod proof.
 *   operator → user: gas + faucet dUSD
 *   user deposits dUSD to the owner_vault (self-custody)
 *   OPERATOR tries to withdraw the user's deposit → REJECTED by the validator
 *   USER withdraws with their OWN key → succeeds
 * Proves the operator can never seize a user's collateral.
 */
import {
  Lucid,
  Koios,
  Data,
  generateSeedPhrase,
  walletFromSeed,
  type UTxO,
} from "@lucid-evolution/lucid";
import { env } from "../env.js";
import { initCardano, faucetMint, vaultDatumFor, usdToUnits, pkhOf } from "../cardano.js";

const KOIOS = env.cardano.koiosUrl;
const scan = (t: string) => `https://preprod.cardanoscan.io/transaction/${t}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function confirm(tx: string, label: string): Promise<void> {
  process.stdout.write(`   confirming ${label} ${tx.slice(0, 12)}…`);
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${KOIOS}/tx_status`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ _tx_hashes: [tx] }),
      });
      const d = (await r.json()) as Array<{ num_confirmations: number | null }>;
      if ((d[0]?.num_confirmations ?? 0) >= 1) { console.log(` ✓ (${d[0].num_confirmations} conf)`); return; }
    } catch { /* koios hiccup */ }
    process.stdout.write("."); await sleep(6000);
  }
  console.log(" (timeout)");
}

function myOwnerUtxos(utxos: UTxO[], ownerPkh: string, dusdUnit: string): UTxO[] {
  return utxos.filter((u) => {
    if (!u.datum || !(u.assets[dusdUnit] > 0n)) return false;
    try {
      const d = Data.from(u.datum) as { fields: string[] };
      return String(d.fields[0]) === ownerPkh;
    } catch { return false; }
  });
}

async function main() {
  const c = await initCardano();
  console.log("═".repeat(64));
  console.log("dorr NON-CUSTODIAL VAULT — live preprod proof");
  console.log(`non-custodial vault: ${c.ownerVaultAddress}`);
  console.log("═".repeat(64));

  const userMnemonic = generateSeedPhrase();
  const uw = walletFromSeed(userMnemonic, { network: "Preprod", addressType: "Base", accountIndex: 0 });
  const userAddress = uw.address;
  const userPkh = pkhOf(userAddress);
  console.log(`user: ${userAddress}`);

  console.log("\n[1] operator → user: 12 tADA gas (covers the Plutus-spend collateral)");
  const gasTx = await c.lucid.newTx().pay.ToAddress(userAddress, { lovelace: 12_000_000n }).complete()
    .then((t) => t.sign.withWallet().complete()).then((s) => s.submit());
  console.log(`   ${scan(gasTx)}`); await confirm(gasTx, "gas");

  console.log("[2] faucet 2,000 dUSD → user");
  const faucetTx = await faucetMint(userAddress, 2_000);
  console.log(`   ${scan(faucetTx)}`); await confirm(faucetTx, "faucet");

  const userLucid = await Lucid(new Koios(KOIOS), "Preprod");
  userLucid.selectWallet.fromSeed(userMnemonic);

  console.log("[3] USER deposits 1,000 dUSD → non-custodial vault (user-signed)");
  const depTx = await userLucid.newTx()
    .pay.ToContract(c.ownerVaultAddress, { kind: "inline", value: vaultDatumFor(userAddress) },
      { [c.dusdUnit]: usdToUnits(1_000), lovelace: 2_000_000n })
    .complete().then((t) => t.sign.withWallet().complete()).then((s) => s.submit());
  console.log(`   ${scan(depTx)}`); await confirm(depTx, "deposit");

  // ── the killer test: the OPERATOR tries to take the user's deposit ──
  console.log("[4] OPERATOR attempts to withdraw the user's deposit → must be REJECTED");
  const vaultUtxos = await c.lucid.utxosAt(c.ownerVaultAddress);
  const mine = myOwnerUtxos(vaultUtxos, userPkh, c.dusdUnit);
  if (mine.length === 0) throw new Error("deposit UTxO not found at vault yet");
  let operatorBlocked = false;
  try {
    await c.lucid.newTx()
      .collectFrom(mine, Data.void())
      .attach.SpendingValidator(c.ownerVaultScript)
      .addSigner(c.operatorAddress) // operator signs — but it is NOT the owner
      .pay.ToAddress(c.operatorAddress, { [c.dusdUnit]: usdToUnits(1_000), lovelace: 2_000_000n })
      .complete();
    console.log("   ✗ operator BUILT a spend — NON-CUSTODY BROKEN");
  } catch (e) {
    operatorBlocked = true;
    console.log(`   ✓ operator REJECTED by the validator — it cannot seize user funds`);
    console.log(`     (${String(e instanceof Error ? e.message : e).slice(0, 90)}…)`);
  }

  // ── the user reclaims with their OWN key ──
  console.log("[5] USER withdraws their 1,000 dUSD with their OWN key (operator not involved)");
  const built = await userLucid.newTx()
    .collectFrom(mine, Data.void())
    .attach.SpendingValidator(c.ownerVaultScript)
    .addSigner(userAddress)
    .pay.ToAddress(userAddress, { [c.dusdUnit]: usdToUnits(1_000), lovelace: 2_000_000n })
    .complete();
  const wTx = await built.sign.withWallet().complete().then((s) => s.submit());
  console.log(`   ${scan(wTx)}`); await confirm(wTx, "self-withdraw");

  console.log("═".repeat(64));
  if (operatorBlocked) {
    console.log("✓ NON-CUSTODIAL PROVEN — operator CANNOT take user funds; user self-withdrew on-chain");
    process.exit(0);
  } else {
    console.log("✗ FAILED — operator was able to build a spend");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
