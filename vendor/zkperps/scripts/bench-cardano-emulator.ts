/**
 * Cardano throughput / latency bench (Lucid Evolution). Repeated **Aiken settlement_anchor** outputs
 * (same path as `cardano-anchor-settlement.ts`).
 *
 * Supports **emulator** and **blockfrost** (Preprod / Preview) backends.
 * Env: CARDANO_BACKEND, WALLET_MNEMONIC, optional BENCH_CARDANO_TXS (default 5).
 */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { createHash } from "node:crypto";
import { createAppLucid } from "../src/cardano/lucid_wallet.js";
import {
  anchorDatumCbor,
  settlementAnchorScriptAddress,
  settlementAnchorSpendingScript,
} from "../src/cardano/settlement_anchor.js";
import { cardanoBackend } from "../src/config/cardano_env.js";

async function main() {
  const backend = cardanoBackend();
  const n = Math.max(1, Number.parseInt(process.env.BENCH_CARDANO_TXS || "5", 10));
  const lucid = await createAppLucid();
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const script = settlementAnchorSpendingScript();
  const scriptAddr = settlementAnchorScriptAddress(network, script);
  const minLovelace = BigInt(process.env.ANCHOR_MIN_LOVELACE || "2000000");

  const timesMs: number[] = [];
  const txHashes: string[] = [];

  const walletAddr = await lucid.wallet().address();
  const isLive = backend !== "emulator";
  const maxRetries = isLive ? 5 : 0;

  async function waitForFreshUtxos(lastTxHash: string): Promise<void> {
    if (!isLive) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, 5_000));
      const utxos = await lucid.utxosAt(walletAddr);
      const spent = utxos.some((u) => u.txHash === lastTxHash);
      if (spent) {
        lucid.overrideUTxOs(utxos);
        return;
      }
    }
    const utxos = await lucid.utxosAt(walletAddr);
    lucid.overrideUTxOs(utxos);
  }

  for (let i = 0; i < n; i++) {
    const settlementId = `bench-${i}-${Date.now()}`;
    const orderCommitmentHex = createHash("sha256").update(`zkperps-bench:${i}`).digest("hex");
    const datumCbor = anchorDatumCbor({
      settlementId,
      orderCommitmentHex,
      midnightTxUtf8: new Date().toISOString(),
    });
    const t0 = performance.now();
    let txHash = "";
    for (let retry = 0; ; retry++) {
      try {
        const signed = await lucid
          .newTx()
          .pay.ToContract(scriptAddr, { kind: "inline", value: datumCbor }, { lovelace: minLovelace })
          .complete()
          .then((tb) => tb.sign.withWallet().complete());
        txHash = await signed.submit();
        break;
      } catch (e) {
        if (retry >= maxRetries) throw e;
        console.error(`  retry ${retry + 1}/${maxRetries} after UTxO conflict…`);
        await new Promise((r) => setTimeout(r, 10_000));
        const utxos = await lucid.utxosAt(walletAddr);
        lucid.overrideUTxOs(utxos);
      }
    }
    await lucid.awaitTx(txHash.trim());
    timesMs.push(performance.now() - t0);
    txHashes.push(txHash.trim());
    console.error(`  tx ${i + 1}/${n}: ${txHash.trim()} (${timesMs[timesMs.length - 1]!.toFixed(0)} ms)`);
    if (i < n - 1) await waitForFreshUtxos(txHash.trim());
  }

  const sorted = [...timesMs].sort((a, b) => a - b);
  const sum = timesMs.reduce((a, b) => a + b, 0);
  const row = {
    run_id: new Date().toISOString(),
    backend,
    txs: n,
    script_address: scriptAddr,
    hardware_note: process.env.BENCH_HARDWARE_NOTE || `${process.platform}:${cpus()[0]?.model ?? "cpu"}`,
    submit_ms_avg: (sum / n).toFixed(2),
    submit_ms_p50: sorted[Math.floor((n - 1) / 2)]!.toFixed(2),
    submit_ms_min: sorted[0]!.toFixed(2),
    submit_ms_max: sorted[sorted.length - 1]!.toFixed(2),
    tx_hashes: txHashes.join("|"),
  };

  console.log(JSON.stringify(row, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
