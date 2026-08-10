/**
 * LIVE confidential-compute end-to-end.
 *
 *   client seals an order to the enclave key  (operator cannot read it)
 *     → operator relays ciphertext            (proves it cannot read it)
 *       → enclave decrypts + clears at ONE uniform price
 *         → enclave signs a payload-bound attestation
 *           → Flare settles, gated on that attestation + the FTSO price guard
 *
 * Everything is real: real ECIES, a real separate enclave process, real FTSO
 * reads, and a real signed transaction on Coston2.
 *
 * Requires the enclave to be running:  bun run src/enclave/server.ts
 *   bun run src/scripts/confidential-e2e.ts
 */
import { type Hex } from "viem";
import { sealToEnclave, openInEnclave, encodeSealed, decodeSealed } from "../ecies.js";
import { settleBatchOnChain, getBatchOnChain, epochCount, usdToUnits } from "../flare.js";
import { marketById } from "../markets.js";

const ENCLAVE = process.env.ENCLAVE_URL || "http://localhost:8795";
const failures: string[] = [];
const ok = (c: unknown, m: string) => {
  if (c) console.log(`   ✓ ${m}`);
  else { failures.push(m); console.log(`   ✗ ${m}`); }
};
const post = (p: string, b: unknown): Promise<any> =>
  fetch(ENCLAVE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p: string): Promise<any> => fetch(ENCLAVE + p).then((r) => r.json());

async function main() {
  console.log("═".repeat(72));
  console.log("dorr-flare — CONFIDENTIAL COMPUTE E2E (Flare Coston2)");
  console.log("═".repeat(72));

  console.log("\n[1] enclave attestation + sealing key");
  const att = await get("/attestation");
  console.log(`   teeId:       ${att.teeId}`);
  console.log(`   measurement: ${att.measurement}`);
  console.log(`   signer:      ${att.signer}`);
  console.log(`   ecies pubkey ${String(att.eciesPublicKey).slice(0, 34)}…`);
  ok(att.eciesPublicKey?.length === 132, "enclave published a 65-byte ECIES public key");
  ok(!!att.signer, "enclave has an on-chain-registered attestation signer");
  const enclavePub = decodeSealed(att.eciesPublicKey);

  console.log("\n[2] two traders seal orders to the enclave (client-side)");
  const market = marketById("FLR-USD")!;
  const orders = [
    { trader: "0xA1", side: "LONG", sizeBase: 30_000, marginFxrp: 1.5, leverage: 4 },
    { trader: "0xB0", side: "SHORT", sizeBase: 12_000, marginFxrp: 0.6, leverage: 4 },
  ];
  const sealedHexes: string[] = [];
  for (const o of orders) {
    const sealed = sealToEnclave(enclavePub, JSON.stringify(o));
    sealedHexes.push(encodeSealed(sealed));
    console.log(`   ${o.side.padEnd(5)} ${o.sizeBase} → ciphertext ${encodeSealed(sealed).slice(0, 26)}… (${sealed.length}B)`);
  }

  console.log("\n[3] PROOF: the operator cannot read what it relays");
  const cipher = decodeSealed(sealedHexes[0]);
  const asText = cipher.toString("utf8");
  ok(!asText.includes("LONG") && !asText.includes("30000"), "ciphertext leaks no side/size to the relaying tier");
  let operatorCouldDecrypt = false;
  try {
    // The operator holds no enclave key; the closest it can do is guess one.
    openInEnclave(Buffer.from("11".repeat(32), "hex"), cipher);
    operatorCouldDecrypt = true;
  } catch {
    /* expected */
  }
  ok(!operatorCouldDecrypt, "decryption without the enclave key fails (AES-GCM auth)");

  console.log("\n[4] submit sealed orders through the operator tier");
  for (let i = 0; i < orders.length; i++) {
    const r = await post("/orders", {
      marketId: market.id,
      sealed: sealedHexes[i],
      trader: orders[i].trader,
      maxMarginFxrp: orders[i].marginFxrp,
    });
    ok(r.accepted === true, `sealed order ${i + 1} accepted (commitment ${String(r.commitment).slice(0, 14)}…)`);
  }
  const st = await get("/status");
  ok(st.pendingSealed === 2, "enclave holds 2 sealed orders, still unread");

  console.log("\n[5] enclave decrypts + clears the epoch at ONE uniform price");
  const cleared = await post("/clear", { marketId: market.id });
  if (cleared.error) throw new Error(`clear failed: ${cleared.error}`);
  console.log(`   epoch:         ${cleared.epochId}`);
  console.log(`   clearing:      $${cleared.clearingPrice.toFixed(6)}  (FTSO $${cleared.ftsoPrice.toFixed(6)})`);
  console.log(`   matched/net:   ${cleared.matchedBase.toFixed(0)} / ${cleared.netImbalanceBase.toFixed(0)} base`);
  const prices = new Set(cleared.fills.map((f: { price: number }) => f.price));
  ok(prices.size === 1, "every order in the epoch settles at exactly ONE price");
  ok(cleared.orderCount === 2, "both orders cleared");
  ok(!!cleared.attestation, "enclave signed a batch attestation");

  console.log("\n[6] settle on Flare — gated on the enclave quote AND the FTSO guard");
  const before = await epochCount();
  const res = await settleBatchOnChain({
    epochId: cleared.epochId as Hex,
    membershipRoot: cleared.membershipRoot as Hex,
    clearingPrice: BigInt(cleared.clearingPrice1e6),
    feedId: cleared.feedId as Hex,
    orderCount: cleared.orderCount,
    traders: [],
    deltas: [],
    attestation: cleared.attestation as Hex,
  });
  console.log(`   tx: ${res.explorerUrl}`);
  const rec = await getBatchOnChain(cleared.epochId as Hex);
  ok(rec.exists, "epoch recorded on Flare");
  ok(rec.membershipRoot === cleared.membershipRoot, "on-chain membership root matches the enclave's");
  ok((await epochCount()) === before + 1, "settled epoch count incremented");
  console.log(`   on-chain: clearing $${rec.clearingPrice.toFixed(6)} · FTSO $${rec.ftsoPrice.toFixed(6)} · orders ${rec.orderCount}`);

  console.log("\n[7] a forged attestation cannot settle");
  const forged = ("0x" + "ab".repeat(161)) as Hex;
  let rejected = false;
  try {
    await settleBatchOnChain({
      epochId: ("0x" + "cd".repeat(32)) as Hex,
      membershipRoot: cleared.membershipRoot as Hex,
      clearingPrice: BigInt(cleared.clearingPrice1e6),
      feedId: cleared.feedId as Hex,
      orderCount: 2,
      traders: [],
      deltas: [],
      attestation: forged,
    });
  } catch {
    rejected = true;
  }
  ok(rejected, "chain rejected a batch with a forged enclave quote");

  console.log("\n" + "═".repeat(72));
  if (failures.length === 0) {
    console.log("✓ CONFIDENTIAL COMPUTE E2E PASSED");
    console.log("  orders unreadable by the operator · one uniform clearing price ·");
    console.log("  attested by the enclave · settled on Flare under an on-chain oracle guard");
    process.exit(0);
  }
  console.log(`✗ FAILED — ${failures.length}:`);
  failures.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
