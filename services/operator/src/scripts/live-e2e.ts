/**
 * LIVE preprod end-to-end with a REAL user wallet (headless).
 *   operator → user: 6 tADA  ·  faucet 5,000 dUSD  ·  user deposits 3,000 to vault
 *   → /deposits/sync  →  commit (ZK) → execute (ZK match + CIP-68 mint) → close (ZK settle + L1 anchor + ZK bind)
 *   → operator withdraws 1,000 dUSD from vault
 * Prints every real tx hash + explorer link. Operator must be running on :8790.
 */
import {
  Lucid,
  Koios,
  generateSeedPhrase,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { env } from "../env.js";
import { initCardano, faucetMint, vaultDatumFor, usdToUnits } from "../cardano.js";

const OP = `http://localhost:${env.port}`;
const KOIOS = env.cardano.koiosUrl;
const scan = (tx: string) => `https://preprod.cardanoscan.io/transaction/${tx}`;

async function confirm(tx: string, label: string, timeoutMs = 240_000): Promise<void> {
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
      if (d[0]?.num_confirmations && d[0].num_confirmations >= 1) {
        console.log(` ✓ (${d[0].num_confirmations} conf)`);
        return;
      }
    } catch {
      /* koios hiccup */
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 8000));
  }
  console.log(" (timeout — continuing)");
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${OP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function get(path: string): Promise<any> {
  return (await fetch(`${OP}${path}`)).json();
}
async function waitJob(id: string): Promise<any> {
  for (;;) {
    const j = await get(`/jobs/${id}`);
    if (j.status === "complete" || j.status === "error") return j;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
function printSteps(j: any) {
  for (const s of j.steps) console.log(`     - ${s.label} → ${s.status} ${s.txHash ?? s.detail?.slice?.(0, 60) ?? ""}`);
}

// ── assertion harness: this script IS the on-chain E2E test ──
const failures: string[] = [];
const chainTxs: Array<{ label: string; tx: string }> = [];
function assert(cond: unknown, msg: string) {
  if (cond) { console.log(`   ✓ ${msg}`); } else { failures.push(msg); console.log(`   ✗ ${msg}`); }
}
function assertJob(j: any, label: string) {
  assert(j.status === "complete", `${label} job completed (was ${j.status})`);
  for (const s of j.steps) if (s.txHash) chainTxs.push({ label: s.label, tx: s.txHash });
}
async function confirmedCount(tx: string): Promise<number> {
  try {
    const r = await fetch(`${KOIOS}/tx_status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tx_hashes: [tx] }),
    });
    const d = (await r.json()) as Array<{ num_confirmations: number | null }>;
    return d[0]?.num_confirmations ?? 0;
  } catch { return 0; }
}

async function main() {
  const c = await initCardano();
  console.log("═".repeat(66));
  console.log("dorr LIVE preprod E2E");
  console.log("═".repeat(66));

  const userMnemonic = generateSeedPhrase();
  const uw = walletFromSeed(userMnemonic, { network: "Preprod", addressType: "Base", accountIndex: 0 });
  const userAddress = uw.address;
  console.log(`user wallet: ${userAddress}`);

  console.log("\n[1] operator → user: 6 tADA (gas)");
  const gasTx = await c.lucid.newTx().pay.ToAddress(userAddress, { lovelace: 6_000_000n }).complete()
    .then((t) => t.sign.withWallet().complete()).then((s) => s.submit());
  console.log(`   ${scan(gasTx)}`);
  await confirm(gasTx, "gas");

  console.log("[2] faucet 5,000 dUSD → user");
  const faucetTx = await faucetMint(userAddress, 5_000);
  console.log(`   ${scan(faucetTx)}`);
  await confirm(faucetTx, "faucet");

  console.log("[3] USER deposits 3,000 dUSD → vault (user-signed)");
  const userLucid = await Lucid(new Koios(KOIOS), "Preprod");
  userLucid.selectWallet.fromSeed(userMnemonic);
  const depTx = await userLucid.newTx()
    .pay.ToContract(c.vaultAddress, { kind: "inline", value: vaultDatumFor(userAddress) },
      { [c.dusdUnit]: usdToUnits(3_000), lovelace: 2_000_000n })
    .complete().then((t) => t.sign.withWallet().complete()).then((s) => s.submit());
  console.log(`   ${scan(depTx)}`);
  await confirm(depTx, "deposit");

  console.log("[4] /deposits/sync → credit off-chain margin");
  console.log("   ", await post("/deposits/sync", { address: userAddress }));

  console.log("[4b] proof-of-solvency: on-chain vault dUSD ≥ credited balances");
  const solv = await get("/ops/solvency");
  console.log(`   reserves ${solv.reservesUsd} dUSD (${solv.vaultUtxos} utxos) · liabilities ${solv.liabilitiesUsd} dUSD · ratio ${solv.collateralizationRatio?.toFixed?.(2) ?? "∞"}`);
  assert(solv.solvent === true, `operator solvent — on-chain vault ≥ credited balances (attestation ${String(solv.attestation).slice(0, 12)}…)`);

  console.log("[4c] cancel round-trip: a resting limit order releases its margin");
  const lockedBefore = (await get(`/account/${userAddress}`)).locked;
  const climit = await post("/orders/commit", {
    address: userAddress, marketId: "FLR-USD", side: "LONG", marginUsd: 500, leverage: 3,
    privacyMode: "private", orderType: "limit", limitPrice: 0.10, // below index → LONG limit rests, won't trigger
  });
  await waitJob(climit.jobId);
  const cancel = await post(`/orders/${climit.orderId}/cancel`, {});
  assert(cancel.success === true && cancel.order?.status === "cancelled", "resting limit order cancelled");
  const lockedAfter = (await get(`/account/${userAddress}`)).locked;
  assert(Math.abs(lockedAfter - lockedBefore) < 1e-6, "cancel released the locked margin back to free");

  console.log("[4d] batch auction: a sandwich nets $0 under uniform clearing");
  const batch = await post("/demo/batch", { marketId: "FLR-USD", side: "LONG", marginUsd: 1000, leverage: 10 });
  console.log(`   batch bot profit $${batch.attack.botProfitUsd.toFixed(2)} · sequential bot profit $${batch.sequential.botProfitUsd.toFixed(2)}`);
  assert(Math.abs(batch.attack.botProfitUsd) < 1e-6 && batch.sequential.botProfitUsd > 0,
    "uniform-price batch makes the sandwich worthless (bot $0), sequential venue does not");

  console.log("[5] commit private ADA 4x LONG (1,000 dUSD)");
  const commit = await post("/orders/commit", {
    address: userAddress, marketId: "FLR-USD", side: "LONG", marginUsd: 1_000, leverage: 4, privacyMode: "private",
  });
  console.log(`   commitment (public sees only this): ${commit.commitmentHash}`);
  assert(/^[0-9a-f]{64}$/.test(commit.commitmentHash), "commitment is a 32-byte hash");
  const feed = (await get("/feed")).feed[0];
  assert(feed.leaked === undefined && feed.commitmentHash === commit.commitmentHash,
    "PRIVACY: public feed exposes only the commitment hash (no side/size/price)");
  const cj = await waitJob(commit.jobId); printSteps(cj); assertJob(cj, "commit");
  chainTxs.push({ label: "gas", tx: gasTx }, { label: "faucet", tx: faucetTx }, { label: "deposit", tx: depTx });

  console.log("[6] execute → vAMM fill + real CIP-68 NFT mint");
  const exe = await post(`/orders/${commit.orderId}/execute`, {});
  const ej = await waitJob(exe.jobId); printSteps(ej); assertJob(ej, "execute");
  const pos = (await get(`/positions/${userAddress}`)).positions.find((p: any) => p.id === exe.position.id);
  assert(pos && pos.status === "open" && pos.entryPrice > 0, "position opened with a real entry price");
  if (pos?.positionNft?.txHash) { console.log(`   NFT ${scan(pos.positionNft.txHash)}`); chainTxs.push({ label: "cip68-nft", tx: pos.positionNft.txHash }); }
  assert(!!pos?.positionNft?.txHash, "CIP-68 position NFT minted on-chain");

  console.log("[7] close → ZK settle + real L1 anchor + ZK bind");
  const close = await post(`/positions/${exe.position.id}/close`, {});
  const clj = await waitJob(close.jobId); printSteps(clj); assertJob(clj, "close");
  const anchor = (await get("/anchors")).anchors.at(-1);
  assert(!!anchor?.txHash, "settlement digest anchored on Cardano L1");
  if (anchor) console.log(`   anchor ${scan(anchor.txHash)}`);

  console.log("[8] operator withdraws 1,000 dUSD from vault → user (via operator)");
  // Route the withdraw THROUGH the operator: the same wallet/provider that minted
  // the NFT and posted the anchor also builds the script spend, so it knows its own
  // recent spends — no cross-process stale-UTxO race on keyless Koios. The operator
  // ensures pure-ADA collateral itself (ensureOperatorCollateral). Let the anchor
  // settle into the UTxO view first.
  await new Promise((r) => setTimeout(r, 20_000));
  const wd = await post("/withdraw", { address: userAddress, amount: 1_000 });
  if (!wd?.txHash) {
    assert(false, `withdraw succeeded (got: ${JSON.stringify(wd).slice(0, 160)})`);
  } else {
    console.log(`   ${scan(wd.txHash)}`);
    chainTxs.push({ label: "withdraw", tx: wd.txHash });
    assert(wd.success === true, "operator-signed vault withdraw submitted");
    await confirm(wd.txHash, "withdraw");
  }

  // ── on-chain confirmation sweep: every preprod tx must confirm ──
  console.log("\n[verify] confirming every preprod tx on-chain (Koios)…");
  for (const { label, tx } of chainTxs) {
    // Midnight ZK tx hashes are not Cardano — skip those; only check preprod ones.
    if (["gas", "faucet", "deposit", "cip68-nft", "withdraw"].includes(label) || label.includes("anchor")) {
      let conf = 0;
      for (let i = 0; i < 30 && conf < 1; i++) { conf = await confirmedCount(tx); if (conf < 1) await new Promise((r) => setTimeout(r, 6000)); }
      assert(conf >= 1, `on-chain confirmed: ${label} (${conf} conf) ${tx.slice(0, 12)}…`);
    }
  }

  const acct = await get(`/account/${userAddress}`);
  console.log(`\n   user account: ${JSON.stringify(acct)}`);
  console.log("═".repeat(66));
  if (failures.length === 0) {
    console.log(`✓ ON-CHAIN E2E PASSED — ${chainTxs.length} txs, all assertions green`);
    process.exit(0);
  } else {
    console.log(`✗ ON-CHAIN E2E FAILED — ${failures.length} assertion(s):`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
