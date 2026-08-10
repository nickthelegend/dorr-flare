/**
 * Submit a Cardano transaction that locks min-ADA at the **settlement_anchor** Aiken script
 * with **inline AnchorDatum** (settlement id, 32-byte order commitment, optional midnight/proof id bytes).
 * Blueprint: `cardano/settlement-anchor/plutus.json` (rebuild with `aiken build` in that directory).
 * Uses `.env` (see `.env.example`).
 *
 * Usage:
 *   npx tsx scripts/cardano-anchor-settlement.ts <settlementId> <orderCommitmentHex64> [midnightProveTx]
 */
import "dotenv/config";
import { createAppLucid } from "../src/cardano/lucid_wallet.js";
import {
  anchorDatumCbor,
  settlementAnchorScriptAddress,
  settlementAnchorSpendingScript,
} from "../src/cardano/settlement_anchor.js";
import { cardanoBackend } from "../src/config/cardano_env.js";

function usage(): never {
  console.error(
    "Usage: tsx scripts/cardano-anchor-settlement.ts <settlementId> <orderCommitmentHex64> [midnightProveTx]",
  );
  process.exit(1);
}

async function main() {
  const settlementId = process.argv[2];
  const orderCommitment = process.argv[3]?.replace(/^0x/i, "");
  const midnightProveTx = process.argv[4] ?? "";
  if (!settlementId || !orderCommitment || orderCommitment.length !== 64) usage();

  const lucid = await createAppLucid();
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const minLovelace = BigInt(process.env.ANCHOR_MIN_LOVELACE || "2000000");

  const script = settlementAnchorSpendingScript();
  const scriptAddr = settlementAnchorScriptAddress(network, script);
  const datumCbor = anchorDatumCbor({
    settlementId,
    orderCommitmentHex: orderCommitment,
    midnightTxUtf8: midnightProveTx,
  });

  const signed = await lucid
    .newTx()
    .pay.ToContract(scriptAddr, { kind: "inline", value: datumCbor }, { lovelace: minLovelace })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  const txHash = await signed.submit();
  console.log("txHash=", txHash);
  console.log("scriptAddress=", scriptAddr);
  if (cardanoBackend() === "emulator") {
    console.log("explorer= (emulator — no public explorer; tx is in-process only)");
    return;
  }
  const net = process.env.CARDANO_NETWORK || "Preprod";
  const explorer =
    net === "Preview"
      ? `https://preview.cardanoscan.io/transaction/${txHash}`
      : `https://preprod.cardanoscan.io/transaction/${txHash}`;
  console.log("explorer=", explorer);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
