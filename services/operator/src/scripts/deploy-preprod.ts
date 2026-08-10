/**
 * dorr preprod bootstrap — run once the deployer wallet is funded.
 *
 *   bun run src/scripts/deploy-preprod.ts
 *
 * 1. Verifies deployer has tADA (else prints the faucet ask and exits).
 * 2. Mints an initial dUSD treasury to the operator.
 * 3. Seeds the vault with a small dUSD float (proves the vault address is live).
 * 4. Submits one settlement anchor so there's an explorer link on day one.
 * Idempotent-ish: safe to re-run; it only mints/anchors, never destroys.
 */
import { createHash } from "node:crypto";
import { env } from "../env.js";
import {
  initCardano,
  operatorBalances,
  faucetMint,
  anchorSettlement,
  usdToUnits,
} from "../cardano.js";
import { Data, Constr, paymentCredentialOf } from "@lucid-evolution/lucid";

const MIN_TADA = 8;

async function main() {
  const c = await initCardano();
  console.log("─".repeat(64));
  console.log("dorr preprod bootstrap");
  console.log("─".repeat(64));
  console.log(`operator : ${c.operatorAddress}`);
  console.log(`dUSD     : ${c.dusdPolicyId}`);
  console.log(`vault    : ${c.vaultAddress}`);
  console.log(`anchor   : ${c.anchorAddress}`);

  const bal = await operatorBalances();
  console.log(`balance  : ${bal.tada.toFixed(2)} tADA, ${bal.dusd.toFixed(2)} dUSD`);

  if (bal.tada < MIN_TADA) {
    console.error(`\n✗ Need ≥ ${MIN_TADA} tADA. Fund this address on the preprod faucet:`);
    console.error(`  ${c.operatorAddress}`);
    console.error(`  https://docs.cardano.org/cardano-testnets/tools/faucet (select Preprod)\n`);
    process.exit(1);
  }

  console.log("\n[1/3] minting 1,000,000 dUSD treasury → operator");
  const mintTx = await faucetMint(c.operatorAddress, 1_000_000);
  console.log(`      tx ${mintTx}`);
  await waitConfirm(mintTx);

  console.log("[2/3] seeding vault float (100 dUSD, operator-owned datum)");
  const seedTx = await seedVault(c, 100);
  console.log(`      tx ${seedTx}`);
  await waitConfirm(seedTx);

  console.log("[3/3] submitting genesis settlement anchor");
  const digest = createHash("sha256").update("dorr:genesis-anchor").digest("hex");
  const anchor = await anchorSettlement("dorr-genesis", digest, "bootstrap");
  console.log(`      tx ${anchor.txHash}`);
  console.log(`      https://preprod.cardanoscan.io/transaction/${anchor.txHash}`);

  console.log("\n✓ preprod bootstrap complete — operator is live.");
  process.exit(0);
}

async function seedVault(c: Awaited<ReturnType<typeof initCardano>>, dusd: number): Promise<string> {
  const datum = Data.to(new Constr(0, [paymentCredentialOf(c.operatorAddress).hash]));
  const tx = await c.lucid
    .newTx()
    .pay.ToContract(
      c.vaultAddress,
      { kind: "inline", value: datum },
      { lovelace: 2_000_000n, [c.dusdUnit]: usdToUnits(dusd) },
    )
    .complete();
  const signed = await tx.sign.withWallet().complete();
  return signed.submit();
}

async function waitConfirm(txHash: string) {
  const c = await initCardano();
  process.stdout.write("      confirming");
  for (let i = 0; i < 60; i++) {
    try {
      await c.lucid.awaitTx(txHash);
      console.log(" ✓");
      return;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(" (timeout — continuing)");
}

void env;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
