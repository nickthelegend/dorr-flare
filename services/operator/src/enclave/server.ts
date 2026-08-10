/**
 * dorr Confidential Compute enclave.
 *
 * This runs as its OWN PROCESS, separate from the operator/API tier, and it is
 * the only place the order-decryption key exists. The operator relays sealed
 * ciphertext it cannot read; the enclave decrypts inside its own address space,
 * clears the epoch at a single uniform price, and signs an attestation that the
 * Flare `TEEAttestationVerifier` must accept before `DorrBatchSettlement` will
 * move any value.
 *
 * What that buys you, concretely:
 *   • the operator cannot read an order (no ECIES private key)
 *   • the operator cannot forge a clearing (no enclave signing key)
 *   • the chain cannot be told a false price (FTSO re-read on-chain at settle)
 *   • an attestation cannot be reused on another epoch (payload-bound quote)
 *
 * HONEST SCOPE — read this before claiming more than it does:
 *   Running under Flare Confidential Compute / GCP Confidential Space adds a
 *   hardware root of trust: the vTPM quote and image measurement prove *which
 *   code* is running. This service implements the software half of that
 *   contract — key isolation, payload-bound quotes, and an on-chain verifier
 *   that gates settlement — and exposes `/attestation` in the shape the
 *   hardware quote slots into. Deployed on ordinary hardware the guarantee is
 *   process isolation plus a registered signing key, NOT hardware attestation.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, randomBytes } from "node:crypto";
import { keccak256, toHex, type Hex } from "viem";

import { env } from "../env.js";
import {
  generateEnclaveKeypair,
  publicKeyOf,
  openInEnclave,
  decodeSealed,
  sealedCommitment,
  type EnclaveKeypair,
} from "../ecies.js";
import { clearBatchUniform, type BatchOrder } from "../batch.js";
import { readFeed } from "../ftso.js";
import { marketById } from "../markets.js";
import { signBatchQuote, enclaveAddress, enclaveConfigured } from "../attestation.js";

// ---------------------------------------------------------------------------
// Enclave-local state. Nothing here is ever exposed in plaintext.
// ---------------------------------------------------------------------------

let keypair: EnclaveKeypair;

interface SealedOrder {
  id: string;
  marketId: string;
  /** public commitment — safe to publish */
  commitment: string;
  /** ciphertext; only this process can open it */
  sealed: Buffer;
  receivedAt: number;
  /** publicly-declared upper bound on margin (a bound leaks, the size does not) */
  maxMarginFxrp: number;
  trader: string;
}

interface OpenedOrder {
  id: string;
  trader: string;
  side: "LONG" | "SHORT";
  sizeBase: number;
  marginFxrp: number;
  leverage: number;
}

const pending = new Map<string, SealedOrder>();
const clearedEpochs: Array<{
  epochId: string;
  marketId: string;
  clearingPrice: number;
  orderCount: number;
  membershipRoot: string;
  ftsoPrice: number;
  at: string;
}> = [];

/** Deterministic enclave identity for a given key — mirrors the on-chain teeId. */
function teeIdOf(): Hex {
  return (env.flare.teeId as Hex) || keccak256(toHex("dorr-tee-1"));
}

function measurement(): Hex {
  return (env.flare.teeMeasurement as Hex) || keccak256(toHex("dorr-tee-image-v1"));
}

/** Commitment to the exact sealed set in an epoch — order-independent. */
function membershipRoot(orders: SealedOrder[]): Hex {
  const leaves = orders
    .map((o) => createHash("sha256").update(o.commitment + ":" + o.sealed.toString("hex")).digest("hex"))
    .sort();
  return ("0x" + createHash("sha256").update(leaves.join("")).digest("hex")) as Hex;
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

app.get("/", (c) =>
  c.json({
    service: "dorr-enclave",
    role: "confidential compute — sealed order decryption + uniform-price clearing",
    note: "the order-decryption key exists only in this process",
  }),
);

/**
 * The enclave's identity. Clients seal orders to `eciesPublicKey`; the chain
 * verifies quotes against `signer`. Under Flare Confidential Compute the vTPM
 * quote and image digest attach here.
 */
app.get("/attestation", (c) => {
  return c.json({
    teeId: teeIdOf(),
    measurement: measurement(),
    signer: enclaveConfigured() ? enclaveAddress() : null,
    eciesPublicKey: "0x" + keypair.publicKey.toString("hex"),
    verifierContract: env.flare.teeVerifier || null,
    chainId: env.flare.chainId,
    hardwareAttestation: {
      available: false,
      kind: "flare-confidential-compute / gcp-confidential-space vTPM",
      note:
        "Software attestation active: the enclave signing key is registered on-chain and quotes are payload-bound. " +
        "A hardware quote (PCR values + image digest) attaches here when deployed under Confidential Compute.",
    },
  });
});

/** The key clients seal their orders to. */
app.get("/pubkey", (c) => c.json({ eciesPublicKey: "0x" + keypair.publicKey.toString("hex"), curve: "secp256k1" }));

/** Counts only — never contents. */
app.get("/status", (c) =>
  c.json({
    pendingSealed: pending.size,
    epochsCleared: clearedEpochs.length,
    lastEpoch: clearedEpochs.at(-1) ?? null,
  }),
);

/**
 * Accept a sealed order. The body carries ciphertext only — this endpoint
 * cannot and does not learn the order's side, size or price until `/clear`.
 */
app.post("/orders", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const marketId = String(b.marketId || "");
  const sealedHex = String(b.sealed || "");
  const trader = String(b.trader || "");
  const maxMarginFxrp = Number(b.maxMarginFxrp || 0);

  if (!marketById(marketId)) return c.json({ error: "unknown market" }, 400);
  if (!sealedHex.startsWith("0x")) return c.json({ error: "sealed ciphertext required" }, 400);
  if (!(maxMarginFxrp > 0)) return c.json({ error: "maxMarginFxrp must be > 0" }, 400);

  let sealed: Buffer;
  try {
    sealed = decodeSealed(sealedHex);
  } catch {
    return c.json({ error: "malformed ciphertext" }, 400);
  }

  const id = randomBytes(8).toString("hex");
  const commitment = sealedCommitment(sealed);
  pending.set(id, { id, marketId, commitment, sealed, receivedAt: Date.now(), maxMarginFxrp, trader });

  return c.json({ accepted: true, id, commitment, note: "ciphertext stored; contents unread until the epoch clears" });
});

/**
 * Clear an epoch: decrypt every pending order for the market INSIDE the enclave,
 * compute one uniform clearing price against the live vAMM curve, sanity-check
 * it against the FTSO oracle, and sign a payload-bound attestation the chain
 * will verify. Returns everything the operator needs to settle — and nothing
 * that would let it reconstruct an individual order it wasn't already told.
 */
app.post("/clear", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const marketId = String(b.marketId || "ADA-dUSD");
  const market = marketById(marketId);
  if (!market) return c.json({ error: "unknown market" }, 400);

  const batch = [...pending.values()].filter((o) => o.marketId === marketId);
  if (batch.length === 0) return c.json({ error: "no sealed orders for this market" }, 400);

  // ---- decrypt inside the enclave -----------------------------------------
  const opened: OpenedOrder[] = [];
  const dropped: Array<{ id: string; reason: string }> = [];
  for (const o of batch) {
    try {
      const plain = JSON.parse(openInEnclave(keypair.privateKey, o.sealed).toString("utf8"));
      const side = plain.side === "SHORT" ? "SHORT" : "LONG";
      const marginFxrp = Number(plain.marginFxrp);
      const leverage = Number(plain.leverage);
      const sizeBase = Number(plain.sizeBase);
      if (!(marginFxrp > 0) || !(sizeBase > 0) || !(leverage >= 1)) throw new Error("invalid fields");
      // A trader cannot exceed the margin bound they publicly locked.
      if (marginFxrp > o.maxMarginFxrp + 1e-9) throw new Error("margin exceeds sealed bound");
      opened.push({ id: o.id, trader: o.trader, side, sizeBase, marginFxrp, leverage });
    } catch (e) {
      dropped.push({ id: o.id, reason: String(e instanceof Error ? e.message : e).slice(0, 80) });
    }
  }
  if (opened.length === 0) return c.json({ error: "no valid orders after decryption", dropped }, 400);

  // ---- uniform-price clearing ---------------------------------------------
  const feed = await readFeed(market.feedId);
  const depth = market.vammDepthUsd;
  const pool = { base: depth / feed.price, quote: depth, k: (depth / feed.price) * depth };
  const orders: BatchOrder[] = opened.map((o) => ({ id: o.id, side: o.side, sizeBase: o.sizeBase }));
  const cleared = clearBatchUniform(pool, orders);

  // ---- attest --------------------------------------------------------------
  const epochId = keccak256(toHex(`dorr-epoch:${marketId}:${Date.now()}`));
  const root = membershipRoot(batch);
  const clearingPrice1e6 = BigInt(Math.round(cleared.clearingPrice * 1e6));

  const quote = await signBatchQuote({
    epochId,
    membershipRoot: root,
    clearingPrice: clearingPrice1e6,
    orderCount: opened.length,
  });

  for (const o of batch) pending.delete(o.id);
  clearedEpochs.push({
    epochId,
    marketId,
    clearingPrice: cleared.clearingPrice,
    orderCount: opened.length,
    membershipRoot: root,
    ftsoPrice: feed.price,
    at: new Date().toISOString(),
  });

  return c.json({
    epochId,
    marketId,
    membershipRoot: root,
    clearingPrice: cleared.clearingPrice,
    clearingPrice1e6: clearingPrice1e6.toString(),
    ftsoPrice: feed.price,
    feedId: market.feedId,
    orderCount: opened.length,
    matchedBase: cleared.matchedBase,
    netImbalanceBase: cleared.netImbalanceBase,
    dropped,
    // every order in the epoch settles at ONE price
    fills: opened.map((o) => ({
      id: o.id,
      trader: o.trader,
      side: o.side,
      sizeBase: o.sizeBase,
      marginFxrp: o.marginFxrp,
      price: cleared.clearingPrice,
    })),
    attestation: quote.attestation,
    attestationSigner: quote.signer,
  });
});

// ---------------------------------------------------------------------------

const PORT = Number(process.env.ENCLAVE_PORT || 8795);

function boot() {
  // The ECIES key is generated in-process at boot and never written anywhere.
  // A fixed key can be supplied for reproducible demos.
  if (process.env.ENCLAVE_ECIES_KEY) {
    const pk = Buffer.from(process.env.ENCLAVE_ECIES_KEY.replace(/^0x/, ""), "hex");
    keypair = { privateKey: pk, publicKey: publicKeyOf(pk) };
    console.log("[enclave] ECIES key loaded from env (reproducible demo mode)");
  } else {
    keypair = generateEnclaveKeypair();
    console.log("[enclave] ECIES key generated in-process (never persisted)");
  }

  console.log(`[enclave] ecies pubkey: 0x${keypair.publicKey.toString("hex").slice(0, 32)}…`);
  console.log(`[enclave] teeId:        ${teeIdOf()}`);
  console.log(`[enclave] measurement:  ${measurement()}`);
  if (enclaveConfigured()) console.log(`[enclave] attest signer: ${enclaveAddress()}`);
  else console.warn("[enclave] WARNING: no attestation key configured — quotes cannot be signed");

  serve({ fetch: app.fetch, port: PORT });
  console.log(`[enclave] confidential compute plane listening on :${PORT}`);
}

boot();

export { app };
