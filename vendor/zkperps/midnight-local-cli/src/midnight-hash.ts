import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';

const vec1 = new CompactTypeVector(1, new CompactTypeBytes(32));
const vec2 = new CompactTypeVector(2, new CompactTypeBytes(32));

/** Matches `hash32` / `openCommitment` in `zkperps-matching.compact` and `zkperps-liquidation.compact`. */
export function hashSingle32(x: Uint8Array): Uint8Array {
  if (x.length !== 32) throw new Error('expected 32-byte preimage');
  return persistentHash(vec1, [x]);
}

/** Matches `combineDigest` in `zkperps-settlement.compact` and pair hashes in liquidation / aggregate. */
export function hashPair32(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== 32 || b.length !== 32) throw new Error('expected 32-byte inputs');
  return persistentHash(vec2, [a, b]);
}
