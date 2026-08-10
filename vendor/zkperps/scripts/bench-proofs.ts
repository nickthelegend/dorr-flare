/**
 * Benchmark harness: commitment latency + on-disk ZK artifact sizes (zkir) as proxy for proof payload.
 * Compare results to docs/benchmarks.md (specification §8 targets).
 */
import { writeFileSync, readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { orderCommitmentHex } from "../src/order/commitment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const managedRoot = path.join(root, "contract/src/managed");
const CONTRACT_PACKAGES = [
  "zkperps-order",
  "zkperps-matching",
  "zkperps-settlement",
  "zkperps-liquidation",
  "zkperps-aggregate",
] as const;

function zkirBytesPerPackage(): { totalKb: string; perPackage: Record<string, number>; circuitNames: string[] } {
  const perPackage: Record<string, number> = {};
  const circuitNames: string[] = [];
  let total = 0;
  for (const pkg of CONTRACT_PACKAGES) {
    const zkirDir = path.join(managedRoot, pkg, "zkir");
    let bytes = 0;
    try {
      const names = readdirSync(zkirDir).filter((f) => f.endsWith(".zkir"));
      bytes = names.reduce((acc, f) => acc + statSync(path.join(zkirDir, f)).size, 0);
      for (const n of names) {
        circuitNames.push(`${pkg}:${n.replace(/\.zkir$/, "")}`);
      }
    } catch {
      bytes = 0;
    }
    perPackage[pkg] = bytes;
    total += bytes;
  }
  const perKb: Record<string, string> = {};
  for (const [k, b] of Object.entries(perPackage)) {
    perKb[k] = (b / 1024).toFixed(2);
  }
  return { totalKb: (total / 1024).toFixed(2), perPackageKb: perKb, perPackageBytes: perPackage, circuitNames };
}

function contractInfoCircuitNames(): string {
  const names: string[] = [];
  for (const pkg of CONTRACT_PACKAGES) {
    const contractInfoPath = path.join(managedRoot, pkg, "compiler", "contract-info.json");
    try {
      const j = JSON.parse(readFileSync(contractInfoPath, "utf8")) as {
        circuits?: Array<{ name?: string }>;
      };
      for (const c of j.circuits ?? []) {
        names.push(`${pkg}:${c.name ?? "?"}`);
      }
    } catch {
      names.push(`${pkg}:n/a`);
    }
  }
  return names.join("|");
}

async function main() {
  const runs = Number(process.env.BENCH_RUNS || "50");
  const gitSha = process.env.GITHUB_SHA || "local";

  const order = {
    pairId: "ADA-USD",
    side: "LONG" as const,
    price: "0.42",
    size: "250",
    leverage: 3,
    margin: "500",
    nonce: "bench-nonce",
  };

  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    orderCommitmentHex({ ...order, nonce: `bench-nonce-${i}` });
  }
  const commitMs = (performance.now() - t0) / runs;

  const zkir = zkirBytesPerPackage();
  const circuits = contractInfoCircuitNames() || "n/a";

  const row = {
    run_id: new Date().toISOString(),
    hardware_note: process.env.BENCH_HARDWARE_NOTE || `${process.platform}:${cpus()[0]?.model ?? "cpu"}`,
    circuit: circuits,
    constraints_estimate: "see-compiler-output",
    prove_ms: "",
    proof_kb: zkir.totalKb,
    zkir_kb_per_package: zkir.perPackageKb,
    zkir_bytes_per_package: zkir.perPackageBytes,
    zkir_files: zkir.circuitNames.join(","),
    verify_ms: "",
    commitment_only_us: (commitMs * 1000).toFixed(3),
    git_sha: gitSha,
  };

  const csvPath = path.join(root, "docs/benchmarks.csv");
  const header =
    "run_id,hardware_note,circuit,constraints_estimate,prove_ms,proof_bytes_kb,verify_ms,commitment_only_us,git_sha\n";
  const line = [
    row.run_id,
    row.hardware_note,
    row.circuit,
    row.constraints_estimate,
    row.prove_ms,
    row.proof_kb,
    row.verify_ms,
    row.commitment_only_us,
    row.git_sha,
  ].join(",");

  let existing = "";
  try {
    existing = readFileSync(csvPath, "utf8");
  } catch {
    writeFileSync(csvPath, header);
  }
  if (!existing.includes("run_id")) {
    writeFileSync(csvPath, header);
  }
  appendFileSync(csvPath, `${line}\n`);

  console.log(JSON.stringify(row, null, 2));
  console.log("Appended row to docs/benchmarks.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
