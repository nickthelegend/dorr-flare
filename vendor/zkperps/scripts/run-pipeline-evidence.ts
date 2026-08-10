/**
 * Orchestrates: `npm run bench` → `npm run midnight:run-pipeline` → `npm run bench:cardano-emulator`,
 * then appends a short summary to docs/srs-pipeline-run.md
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outMd = path.join(root, "docs/srs-pipeline-run.md");

function run(label: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): string {
  console.error(`\n--- ${label} ---\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (r.status !== 0) {
    throw new Error(`${label} failed with exit ${r.status}`);
  }
  return stdout;
}

async function main() {
  const stamp = new Date().toISOString();
  const sections: string[] = [`# Pipeline run capture\n\n**Started:** ${stamp}\n\n`];

  sections.push("## bench (commitment + zkir totals)\n\n```\n");
  sections.push(
    run(
      "bench",
      "npm",
      ["run", "bench"],
      {
        CARDANO_BACKEND: process.env.CARDANO_BACKEND ?? "emulator",
      },
    ),
  );
  sections.push("\n```\n\n## midnight:run-pipeline (undeployed / funded wallet)\n\n```\n");
  sections.push(
    run(
      "midnight:run-pipeline",
      "npm",
      ["run", "midnight:run-pipeline"],
      {
        MIDNIGHT_DEPLOY_NETWORK: process.env.MIDNIGHT_DEPLOY_NETWORK ?? "undeployed",
        MIDNIGHT_PROOF_SERVER: process.env.MIDNIGHT_PROOF_SERVER ?? "http://127.0.0.1:6300",
        BIP39_MNEMONIC:
          process.env.BIP39_MNEMONIC ??
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        ZKPERPS_TRADER_SK_HEX:
          process.env.ZKPERPS_TRADER_SK_HEX ??
          "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
        ZKPERPS_ORDER_COMMITMENT_HEX:
          process.env.ZKPERPS_ORDER_COMMITMENT_HEX ??
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ZKPERPS_L1_ANCHOR_HEX:
          process.env.ZKPERPS_L1_ANCHOR_HEX ??
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ),
  );
  sections.push("\n```\n\n## bench:cardano-emulator\n\n```\n");
  sections.push(
    run(
      "bench:cardano-emulator",
      "npm",
      ["run", "bench:cardano-emulator"],
      {
        CARDANO_BACKEND: "emulator",
        WALLET_MNEMONIC:
          process.env.WALLET_MNEMONIC ??
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        BENCH_CARDANO_TXS: process.env.BENCH_CARDANO_TXS ?? "5",
      },
    ),
  );
  sections.push("\n```\n");

  appendFileSync(outMd, sections.join(""));
  console.error(`\nAppended run log to ${path.relative(root, outMd)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
