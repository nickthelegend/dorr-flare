/**
 * Midnight driver — spawns the vendored ZKPerps CLI (npm-managed, patched)
 * to run REAL proofs against the local Midnight network + proof server.
 * dorr-specific driver scripts live in vendor/zkperps/midnight-local-cli/src/.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env, ZKPERPS_ROOT } from "./env.js";

/**
 * TEST-ONLY ZK mode. When DORR_ZK_MODE=stub, the driver returns deterministic
 * tx vars WITHOUT spawning the (slow, real) Midnight prover — so the in-process
 * integration test can exercise the full trade wiring + privacy + accounting in
 * milliseconds. This is a test affordance, gated by env; the default (real)
 * path always spawns actual proofs. It is never enabled in production.
 */
const ZK_STUB = process.env.DORR_ZK_MODE === "stub";
const stubHash = (s: string) => createHash("sha256").update(`dorr-zk-stub:${s}`).digest("hex");
function stubRun(scriptRelPath: string, extraEnv: Record<string, string>): MidnightRun {
  const seed = scriptRelPath + JSON.stringify(extraEnv);
  const vars: Record<string, string> = {};
  if (scriptRelPath.includes("commit")) {
    vars.CONTRACT_ADDRESS = stubHash("contract:" + seed);
    vars.DEPLOY_TX = stubHash("deploy:" + seed);
    vars.AUTHORITY_TX = stubHash("auth:" + seed);
  } else if (scriptRelPath.includes("match")) {
    vars.MATCH_CONTRACT = stubHash("mc:" + seed);
    vars.MATCH_TX = stubHash("match:" + seed);
  } else if (scriptRelPath.includes("settle")) {
    vars.SETTLE_CONTRACT = stubHash("sc:" + seed);
    vars.SETTLE_TX = stubHash("settle:" + seed);
  } else if (scriptRelPath.includes("bind")) {
    vars.BIND_TX = stubHash("bind:" + seed);
  }
  return { code: 0, stdout: Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"), stderr: "", vars };
}

export interface MidnightRun {
  code: number;
  stdout: string;
  stderr: string;
  /** KEY=value lines parsed from stdout (drivers print e.g. CONTRACT_ADDRESS=..). */
  vars: Record<string, string>;
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BIP39_MNEMONIC: env.midnight.mnemonic,
    MIDNIGHT_DEPLOY_NETWORK: env.midnight.network,
    INDEXER_PORT: env.midnight.indexerPort,
    NODE_PORT: env.midnight.nodePort,
    PROOF_SERVER_PORT: env.midnight.proofServerPort,
  };
}

export function runCliScript(
  scriptRelPath: string,
  extraEnv: Record<string, string>,
  timeoutMs = 300_000,
): Promise<MidnightRun> {
  if (ZK_STUB) return Promise.resolve(stubRun(scriptRelPath, extraEnv));
  const abs = resolve(ZKPERPS_ROOT, scriptRelPath);
  if (!existsSync(abs)) {
    return Promise.resolve({
      code: 127,
      stdout: "",
      stderr: `driver script missing: ${abs}`,
      vars: {},
    });
  }
  return new Promise((resolveP) => {
    const child = spawn("npx", ["tsx", scriptRelPath], {
      cwd: ZKPERPS_ROOT,
      env: { ...baseEnv(), ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      stderr += `\n[dorr] killed after ${timeoutMs}ms timeout`;
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const vars: Record<string, string> = {};
      for (const line of stdout.split("\n")) {
        const m = line.match(/^([A-Z][A-Z0-9_]+)=(\S+)\s*$/);
        if (m) vars[m[1]] = m[2];
      }
      resolveP({ code: code ?? 1, stdout, stderr, vars });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolveP({ code: 1, stdout, stderr: stderr + String(e), vars: {} });
    });
  });
}

/** OPEN: deploy zkperps-order(commitment, traderPk) + proveTraderOrderAuthority. */
export function midnightCommit(commitmentHex: string, traderSkHex: string) {
  return runCliScript("midnight-local-cli/src/dorr-commit.ts", {
    ZKPERPS_ORDER_COMMITMENT_HEX: commitmentHex,
    ZKPERPS_TRADER_SK_HEX: traderSkHex,
  });
}

/** FILL: deploy zkperps-matching(bidC, askC) + proveAndFinalizeMatch (execution attestation). */
export function midnightMatch(
  bidPreimageHex: string,
  askPreimageHex: string,
  matchDigestHex: string,
) {
  return runCliScript("midnight-local-cli/src/dorr-match.ts", {
    ZKPERPS_BID_PREIMAGE_HEX: bidPreimageHex,
    ZKPERPS_ASK_PREIMAGE_HEX: askPreimageHex,
    ZKPERPS_MATCH_DIGEST_HEX: matchDigestHex,
  });
}

/** CLOSE: deploy zkperps-settlement(initial) + proveSettlementTransition(next = H(initial||payload)). */
export function midnightSettle(initialHex: string, payloadHex: string) {
  return runCliScript("midnight-local-cli/src/dorr-settle.ts", {
    ZKPERPS_SETTLEMENT_INITIAL_HEX: initialHex,
    ZKPERPS_SETTLEMENT_PAYLOAD_HEX: payloadHex,
  });
}

/** CLOSE (final): bindL1SettlementAnchor(anchorDigest) on the trade's order contract. */
export function midnightBindAnchor(
  orderContractAddress: string,
  traderSkHex: string,
  anchorHex: string,
) {
  return runCliScript("midnight-local-cli/src/dorr-bind-anchor.ts", {
    ZKPERPS_ORDER_CONTRACT_ADDRESS: orderContractAddress,
    ZKPERPS_TRADER_SK_HEX: traderSkHex,
    ZKPERPS_L1_ANCHOR_HEX: anchorHex,
  });
}
