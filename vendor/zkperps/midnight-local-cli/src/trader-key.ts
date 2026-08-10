import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';

function pad32Utf8(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  const o = new Uint8Array(32);
  o.set(b.slice(0, 32));
  return o;
}

/** Must match `hashTraderPk` in `zkperps-order.compact`. */
export function traderLedgerPublicKey(traderSk: Uint8Array): Uint8Array {
  if (traderSk.length !== 32) {
    throw new Error('trader secret must be 32 bytes');
  }
  const t = new CompactTypeVector(2, new CompactTypeBytes(32));
  return persistentHash(t, [pad32Utf8('zkperps:order:trader:v1'), traderSk]);
}
