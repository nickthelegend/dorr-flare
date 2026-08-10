/**
 * SRS §8–aligned micro-benchmarks that run without a live Midnight stack:
 * - Order commitment latency (§8)
 * - Local commitment “verification” (re-hash compare) — nanoseconds, ≪ 10 ms
 *
 * On-chain ZK proof verification (≤10 ms Impact VM) is not exposed via this repo’s JS SDK;
 * see docs/benchmarks.md for how that target is tied to successful Midnight transactions.
 */
import { performance } from "node:perf_hooks";
import { orderCommitmentHex, verifyCommitmentMatches } from "../src/order/commitment.js";

const order = {
  pairId: "ADA-USD",
  side: "LONG" as const,
  price: "0.42",
  size: "250",
  leverage: 3,
  margin: "500",
  nonce: "srs-bench-nonce",
};

function main() {
  const runs = Number(process.env.BENCH_RUNS ?? "50000");

  const tCommit0 = performance.now();
  for (let i = 0; i < runs; i++) {
    orderCommitmentHex({ ...order, nonce: `srs-bench-${i}` });
  }
  const commitPerUs = ((performance.now() - tCommit0) / runs) * 1000;

  const h = orderCommitmentHex(order);
  const tVer0 = performance.now();
  for (let i = 0; i < runs; i++) {
    verifyCommitmentMatches({ ...order, nonce: order.nonce }, h);
  }
  const verifyPerUs = ((performance.now() - tVer0) / runs) * 1000;

  const out = {
    kind: "srs-client-microbench",
    runs,
    commitment_avg_us: Math.round(commitPerUs * 1000) / 1000,
    commitment_verify_avg_us: Math.round(verifyPerUs * 1000) / 1000,
    srs_order_commitment_target_s: 2,
    srs_proof_verification_target_ms: 10,
    note:
      "commitment_verify_avg_us is local SHA256+compare, not Midnight ZK verifier timing. " +
      "ZK verification ≤10 ms is satisfied by Midnight Impact VM per SRS; evidence = accepted ZK txs in docs/benchmarks.md §2.",
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
