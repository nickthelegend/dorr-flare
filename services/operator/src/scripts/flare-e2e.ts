/**
 * LIVE Flare end-to-end: sign an enclave quote, settle a sealed-bid epoch on
 * Coston2, and prove the on-chain FTSO price guard actually rejects a
 * manipulated clearing price.
 *
 * Every step is a real read/write against Flare Coston2. Nothing is simulated.
 *   bun run src/scripts/flare-e2e.ts
 */
import { keccak256, toHex, type Hex } from "viem";
import { env } from "../env.js";
import { signBatchQuote, enclaveAddress, batchPayloadHash } from "../attestation.js";
import {
  fxrpInfo,
  vaultSolvency,
  settleBatchOnChain,
  getBatchOnChain,
  epochCount,
  relayerBalance,
  usdToUnits,
  explorerAddress,
  flareConfigured,
} from "../flare.js";
import { readFeed, resolveFtsoAddress } from "../ftso.js";
import { marketById } from "../markets.js";

const failures: string[] = [];
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`   ✓ ${msg}`);
  else { failures.push(msg); console.log(`   ✗ ${msg}`); }
}

async function main() {
  console.log("═".repeat(70));
  console.log("dorr-flare LIVE E2E — Flare Coston2");
  console.log("═".repeat(70));
  if (!flareConfigured()) throw new Error("Flare contracts not configured in .env");

  console.log("\n[1] network + contracts");
  const ftso = await resolveFtsoAddress();
  console.log(`   FtsoV2 (registry): ${ftso}`);
  console.log(`   vault:             ${explorerAddress(env.flare.vault)}`);
  console.log(`   settlement:        ${explorerAddress(env.flare.settlement)}`);
  const rb = await relayerBalance();
  console.log(`   relayer ${rb.address} — ${rb.c2flr.toFixed(3)} C2FLR`);
  assert(rb.c2flr > 0.1, "relayer funded for gas");

  console.log("\n[2] FXRP collateral token (FAssets)");
  const fx = await fxrpInfo();
  console.log(`   ${fx.symbol} @ ${fx.address} · ${fx.decimals}dp · supply ${fx.totalSupply.toLocaleString()}`);
  assert(fx.decimals === 6, "FXRP has 6 decimals (real FAssets, not an 18dp lookalike)");

  console.log("\n[3] vault solvency (real on-chain reserves)");
  const sol = await vaultSolvency();
  console.log(`   reserves ${sol.reservesFxrp} FXRP · liabilities ${sol.liabilitiesFxrp} FXRP · solvent=${sol.solvent}`);
  assert(sol.solvent, "vault reserves back all credited balances");

  console.log("\n[4] enclave attestation");
  const signer = enclaveAddress();
  console.log(`   enclave signer: ${signer}`);

  const market = marketById("ADA-dUSD")!;
  const feed = await readFeed(market.feedId);
  console.log(`   FTSO ${market.symbol} = $${feed.price.toFixed(6)}`);

  // Honest batch: clear exactly at the oracle price.
  const epochId = keccak256(toHex(`dorr-epoch-${Date.now()}`));
  const membershipRoot = keccak256(toHex("sealed-order-set"));
  const clearingPrice = usdToUnits(feed.price);
  const quote = await signBatchQuote({ epochId, membershipRoot, clearingPrice, orderCount: 2 });
  assert(quote.signer.toLowerCase() === signer.toLowerCase(), "quote signed by the registered enclave key");
  assert(
    quote.payloadHash === batchPayloadHash({ epochId, membershipRoot, clearingPrice, orderCount: 2 }),
    "quote binds to this batch's payload hash",
  );

  console.log("\n[5] settle the epoch ON-CHAIN (real tx)");
  const before = await epochCount();
  const res = await settleBatchOnChain({
    epochId,
    membershipRoot,
    clearingPrice,
    feedId: market.feedId as Hex,
    orderCount: 2,
    traders: [],
    deltas: [],
    attestation: quote.attestation,
    feeWei: 0n,
  });
  console.log(`   tx: ${res.explorerUrl}`);
  const rec = await getBatchOnChain(epochId);
  console.log(`   recorded: clearing $${rec.clearingPrice.toFixed(6)} · FTSO $${rec.ftsoPrice.toFixed(6)} · orders ${rec.orderCount}`);
  assert(rec.exists, "batch recorded on-chain");
  assert((await epochCount()) === before + 1, "epoch count incremented");

  console.log("\n[6] THE GUARANTEE: a manipulated clearing price is rejected by the chain");
  const badEpoch = keccak256(toHex(`dorr-epoch-bad-${Date.now()}`));
  const badPrice = (clearingPrice * 150n) / 100n; // 50% off the oracle
  const badQuote = await signBatchQuote({
    epochId: badEpoch,
    membershipRoot,
    clearingPrice: badPrice,
    orderCount: 2,
  });
  let rejected = false;
  let reason = "";
  try {
    await settleBatchOnChain({
      epochId: badEpoch,
      membershipRoot,
      clearingPrice: badPrice,
      feedId: market.feedId as Hex,
      orderCount: 2,
      traders: [],
      deltas: [],
      attestation: badQuote.attestation,
      feeWei: 0n,
    });
  } catch (e) {
    rejected = true;
    reason = String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 100);
  }
  assert(rejected, `FTSO price guard rejected the manipulated batch (${reason})`);
  assert(!(await getBatchOnChain(badEpoch)).exists, "manipulated batch was NOT recorded");

  console.log("\n" + "═".repeat(70));
  if (failures.length === 0) {
    console.log("✓ FLARE E2E PASSED — settlement is live and the oracle guard is enforced on-chain");
    process.exit(0);
  }
  console.log(`✗ FAILED — ${failures.length} assertion(s):`);
  failures.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
