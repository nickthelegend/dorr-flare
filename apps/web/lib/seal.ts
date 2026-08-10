/**
 * Client-side timelock sealing — the browser encrypts the order to a drand round
 * so the operator only ever receives ciphertext + a commitment. The commitment
 * byte-matches the operator's scheme (engine/order/commitment + sealbid), so the
 * operator can verify the opened preimage against it. tlock-js does real IBE over
 * BLS12-381 against the live drand quicknet — no operator ever sees the plaintext.
 */
import { timelockEncrypt, HttpChainClient, HttpCachingChain, Buffer as TlockBuffer } from "tlock-js";

/** drand quicknet — timelock-enabled (unchained, 3s rounds). */
const QUICKNET_URL =
  "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export interface SealOrderInput {
  marketId: string;
  side: "LONG" | "SHORT";
  sizeBase: number;
  leverage: number;
  marginUsd: number;
  price: number;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomNonceHex(): string {
  const a = new Uint8Array(16); // 128-bit nonce
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Must byte-match engine/order/commitment.orderCommitmentHex + sealbid.commitmentFor. */
async function commitmentFor(p: SealOrderInput, nonce: string): Promise<string> {
  const canonical = JSON.stringify({
    pairId: p.marketId,
    side: p.side,
    price: p.price.toFixed(8),
    size: p.sizeBase.toFixed(8),
    leverage: p.leverage,
    margin: p.marginUsd.toFixed(2),
    nonce,
  });
  return sha256Hex(canonical);
}

let _client: HttpChainClient | null = null;
function drandClient(): HttpChainClient {
  if (!_client) _client = new HttpChainClient(new HttpCachingChain(QUICKNET_URL));
  return _client;
}

/**
 * Seal an order to a drand round. Returns the public commitment + the AGE
 * ciphertext (undecryptable until the round's beacon lands). The preimage shape
 * matches sealbid.OrderPreimage so the operator can open + verify it.
 */
export async function sealOrderClient(
  p: SealOrderInput,
  targetRound: number,
): Promise<{ commitment: string; ciphertext: string }> {
  const nonce = randomNonceHex();
  const preimage = {
    marketId: p.marketId,
    side: p.side,
    sizeBase: p.sizeBase,
    leverage: p.leverage,
    marginUsd: p.marginUsd,
    price: p.price,
    nonce,
  };
  const commitment = await commitmentFor(p, nonce);
  const ciphertext = await timelockEncrypt(
    targetRound,
    TlockBuffer.from(JSON.stringify(preimage)),
    drandClient(),
  );
  return { commitment, ciphertext };
}
