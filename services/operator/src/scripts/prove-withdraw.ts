/**
 * Prove the vault WITHDRAW (Aiken PlutusV3 script spend) on real preprod.
 *
 * The operator wallet's funds had consolidated into mixed ADA+token UTxOs, so a
 * script spend couldn't source pure-ADA collateral. This script first splits off
 * clean ADA-only UTxOs (operator→operator), then runs the real vault withdraw and
 * confirms it on-chain. Leaves the wallet with spare collateral for future runs.
 *
 *   bun run services/operator/src/scripts/prove-withdraw.ts [destAddr] [usd]
 */
import { initCardano, vaultWithdraw, unitsToUsd } from "../cardano.js";
import { env } from "../env.js";

const KOIOS = env.cardano.koiosUrl;
const scan = (tx: string) => `https://preprod.cardanoscan.io/transaction/${tx}`;
const DEST =
  process.argv[2] ||
  "addr_test1qrtwf63hft69jktlsu2a5vkgcfyx8cs7exrcag8yuane303s9g4797d0zc9mzfpehyjrkxpvf0t3j36p53j70nvzs28qqu67d9";
const USD = Number(process.argv[3] || 1_000);

async function confirm(tx: string, label: string, timeoutMs = 240_000): Promise<boolean> {
  const t0 = Date.now();
  process.stdout.write(`   confirming ${label} ${tx.slice(0, 12)}…`);
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${KOIOS}/tx_status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _tx_hashes: [tx] }),
      });
      const d = (await r.json()) as Array<{ num_confirmations: number | null }>;
      if ((d[0]?.num_confirmations ?? 0) >= 1) {
        console.log(` ✓ (${d[0].num_confirmations} conf)`);
        return true;
      }
    } catch {
      /* koios hiccup */
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 8000));
  }
  console.log(" (timeout)");
  return false;
}

async function main() {
  const c = await initCardano();
  console.log("═".repeat(60));
  console.log("dorr — prove vault withdraw (Aiken script spend) on preprod");
  console.log("═".repeat(60));

  // How many pure-ADA UTxOs does the operator have right now?
  const utxos = await c.lucid.wallet().getUtxos();
  const pureAda = utxos.filter((u) => Object.keys(u.assets).filter((k) => k !== "lovelace").length === 0);
  console.log(`operator UTxOs: ${utxos.length} · pure-ADA (collateral-capable): ${pureAda.length}`);

  if (pureAda.length < 2) {
    console.log("\n[1] splitting off clean ADA-only collateral UTxOs (operator → operator)…");
    let tx = c.lucid.newTx();
    for (let i = 0; i < 5; i++) tx = tx.pay.ToAddress(c.operatorAddress, { lovelace: 5_000_000n });
    const built = await tx.complete();
    const signed = await built.sign.withWallet().complete();
    const splitTx = await signed.submit();
    console.log(`   ${scan(splitTx)}`);
    const ok = await confirm(splitTx, "split");
    if (!ok) throw new Error("split tx did not confirm — retry later");
    // Lucid caches the wallet UTxO set; reselect so the new pure-ADA UTxOs are visible.
    c.lucid.selectWallet.fromSeed(env.cardano.mnemonic);
  } else {
    console.log("   operator already has pure-ADA collateral — skipping split.");
  }

  console.log(`\n[2] vault withdraw: ${USD} dUSD → ${DEST.slice(0, 24)}… (operator-signed Aiken script spend)`);
  const wTx = await vaultWithdraw(DEST, USD);
  console.log(`   ${scan(wTx)}`);
  const ok = await confirm(wTx, "withdraw");

  console.log("═".repeat(60));
  if (ok) {
    console.log(`✓ VAULT WITHDRAW CONFIRMED ON PREPROD — ${scan(wTx)}`);
    process.exit(0);
  } else {
    console.log("✗ withdraw submitted but not yet confirmed (Koios lag) — check the link above");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 800));
  process.exit(1);
});
