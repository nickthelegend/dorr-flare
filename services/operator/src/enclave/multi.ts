/**
 * The shared confidential-compute plane.
 *
 * One attested machine, several products. Each project is a *tenant* with its
 * own derived signing and sealing keys, so:
 *
 *   • a client seals to `/t/:project/pubkey` and only that tenant can open it;
 *   • a quote is signed by that tenant's key, so it recovers to the address that
 *     project registered on-chain and to no other — replaying dorr's quote at
 *     hadal's verifier fails on signature recovery, with no shared payload
 *     format to keep collision-free.
 *
 * The master seed is generated **in this process** and never leaves it. Every
 * tenant identity is derived from it, which is what lets the enclave come back
 * from a restart with the same addresses — and also what makes the seed the
 * whole security boundary.
 *
 * The honest limit, repeated here because it belongs next to the code: this is
 * separation of *identity*, not of *blast radius*. Code inside the enclave can
 * derive any tenant's key. Two products that must be safe from each other's bugs
 * need two enclaves, not two tenants.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import {
  generateMasterSeed,
  deriveTenants,
  signQuote,
  getHardwareQuote,
  detectTee,
  openInEnclave,
  decodeSealed,
  probeSocket,
  PROBE_PATHS,
  type Tenant,
} from "flare-tee-kit";

const PROJECTS = (process.env.TEE_PROJECTS || "dorr,hadal,molfi")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const MEASUREMENT = (process.env.TEE_MEASUREMENT || `0x${"00".repeat(32)}`) as Hex;

/**
 * Seed persistence.
 *
 * A restart must not change every tenant's on-chain identity — re-registering
 * three verifiers by hand is exactly the operational trap that makes people
 * disable attestation. Under real confidential compute this belongs in sealed
 * storage the platform binds to the image; on a host without one it is a file,
 * and `/attestation` reports which of the two you are looking at rather than
 * letting the stronger case be assumed.
 */
type SeedSource = "env" | "file" | "ephemeral";
const SEED_PATH = process.env.TEE_SEED_PATH || "";

function loadOrCreateSeed(): { seed: Buffer; source: SeedSource } {
  // Env first: on a host with an ephemeral filesystem this is the only thing that
  // actually survives a restart, and a restart that changes every tenant address
  // silently invalidates every on-chain registration.
  if (process.env.TEE_MASTER_SEED) {
    return { seed: Buffer.from(process.env.TEE_MASTER_SEED.replace(/^0x/, ""), "hex"), source: "env" };
  }
  if (SEED_PATH && existsSync(SEED_PATH)) {
    return { seed: Buffer.from(readFileSync(SEED_PATH, "utf8").trim(), "hex"), source: "file" };
  }
  const seed = generateMasterSeed();
  if (SEED_PATH) {
    mkdirSync(dirname(SEED_PATH), { recursive: true });
    writeFileSync(SEED_PATH, seed.toString("hex"), { mode: 0o600 });
    // Deliberately NOT reported as durable. Writing a file proves the write
    // succeeded, not that the filesystem survives a restart — on Heroku it does
    // not, and reporting "persisted" there produced exactly the wrong answer:
    // tenant addresses silently rotated while the endpoint said they were stable.
    return { seed, source: "file" };
  }
  return { seed, source: "ephemeral" };
}

const { seed, source: seedSource } = loadOrCreateSeed();
const tenants = deriveTenants(seed, PROJECTS);
const tenantOr404 = (id: string): Tenant | null => tenants.get(id.toLowerCase()) ?? null;

export const teePlane = new Hono();
const app = teePlane;
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

/** Machine + tenant summary, for mounting hosts that want to embed it. */
export const teeSummary = () => ({
  projects: PROJECTS,
  seedSource,
  tenants: PROJECTS.map((p) => {
    const t = tenants.get(p)!;
    return { projectId: p, teeId: t.tenantId, signer: t.signer.address, sealingPublicKey: t.sealingPublicKey };
  }),
});

app.get("/tee", (c) =>
  c.json({
    service: "flare-tee-kit/enclave",
    role: "shared confidential compute — one attested machine, per-project identities",
    projects: PROJECTS,
    note: "each project's sealing and signing keys are derived separately; a quote for one does not verify as another",
  }),
);

/** Machine-level identity: what the hardware says, and what each tenant is. */
app.get("/tee/attestation", async (c) => {
  const hw = await getHardwareQuote();
  return c.json({
    measurement: MEASUREMENT,
    hardwareAttestation: hw,
    seed: {
      source: seedSource,
      stableAcrossRestart: seedSource === "env",
      note:
        seedSource === "env"
          ? "Seed comes from the environment, so tenant addresses survive a restart. On a host without " +
            "hardware the host operator can read it — that is what running without a TEE means, and it is " +
            "stated rather than implied."
          : seedSource === "file"
            ? "Seed is on the local filesystem. That survives a restart only if the filesystem does — it does " +
              "not on an ephemeral dyno, where every restart rotates all tenant addresses and invalidates " +
              "their on-chain registrations. Set TEE_MASTER_SEED, or mount durable storage."
            : "Seed is in memory only. Tenant addresses change on every restart and must be re-registered.",
    },
    tenants: PROJECTS.map((p) => {
      const t = tenants.get(p)!;
      return {
        projectId: p,
        teeId: t.tenantId,
        signer: t.signer.address,
        sealingPublicKey: t.sealingPublicKey,
      };
    }),
    howToVerify:
      "Compare `signer` against what each project registered on-chain, and `hardwareAttestation.quote` " +
      "against the CVM's own attestation page. If hardwareAttestation.available is false, there is no " +
      "hardware behind this and the endpoint says so.",
  });
});

/** The key a client seals to, for one project. */
app.get("/t/:project/pubkey", (c) => {
  const t = tenantOr404(c.req.param("project"));
  if (!t) return c.json({ error: "unknown project" }, 404);
  return c.json({ projectId: t.projectId, sealingPublicKey: t.sealingPublicKey, curve: "secp256k1" });
});

/** Open a ciphertext sealed to this project. Only this tenant's key is tried. */
app.post("/t/:project/open", async (c) => {
  const t = tenantOr404(c.req.param("project"));
  if (!t) return c.json({ error: "unknown project" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const sealedHex = String(b.sealed || "");
  if (!sealedHex.startsWith("0x")) return c.json({ error: "sealed ciphertext required" }, 400);
  try {
    const plain = openInEnclave(t.sealingPrivateKey, decodeSealed(sealedHex));
    return c.json({ projectId: t.projectId, plaintext: plain.toString("utf8") });
  } catch {
    // Deliberately not "wrong key" vs "corrupt" — an oracle that distinguishes
    // them tells an attacker which tenant a ciphertext belongs to.
    return c.json({ error: "could not open" }, 400);
  }
});

/**
 * Sign a quote over a payload hash this project's contract will recompute.
 *
 * The kit does not care what the hash means; the project's verifier does. That
 * is what keeps this safe to expose: a signature over a payload no contract will
 * recompute is worth nothing, and a signature over the wrong one is rejected.
 */
app.post("/t/:project/sign", async (c) => {
  const t = tenantOr404(c.req.param("project"));
  if (!t) return c.json({ error: "unknown project" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const payloadHash = String(b.payloadHash || "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(payloadHash)) {
    return c.json({ error: "payloadHash must be bytes32" }, 400);
  }
  const quote = await signQuote({
    signer: t.signer,
    teeId: t.tenantId,
    measurement: MEASUREMENT,
    payloadHash: payloadHash as Hex,
    ...(b.nonce != null ? { nonce: BigInt(b.nonce) } : {}),
  });
  // A hardware quote over the same payload, when there is hardware: the machine
  // attests to this exact request, not merely to being switched on.
  const hardware = await getHardwareQuote(payloadHash as Hex);
  return c.json({ ...quote, nonce: quote.nonce.toString(), projectId: t.projectId, hardwareAttestation: hardware });
});

/**
 * What the guest-agent socket actually serves.
 *
 * Diagnostic, and deliberately shipped rather than run by hand: the socket only
 * exists inside the CVM, so the machine has to answer this question itself. Four
 * guessed `/prpc/*` names all returned HTML 404s on a live 0.5.9 host, which is a
 * different fault from a wrong method name and is not distinguishable from
 * outside. Read-only — it posts empty bodies and returns whatever comes back.
 */
app.get("/tee/socket-probe", async (c) => {
  // ?path=/Tappd/TdxQuote&method=POST probes one arbitrary path. Without it the
  // built-in list runs. The arbitrary form matters: each wrong guess otherwise
  // costs a rebuild plus a CVM boot, and the socket only exists in here.
  const one = c.req.query("path");
  if (one) {
    const method = (c.req.query("method") || "POST").toUpperCase() as "GET" | "POST";
    return c.json({ tee: detectTee(), results: [await probeSocket(one, method)] });
  }
  const results = [];
  for (const [path, method] of PROBE_PATHS) results.push(await probeSocket(path, method));
  return c.json({ tee: detectTee(), results });
});

app.get("/tee/health", (c) => c.json({ ok: true, projects: PROJECTS, tee: detectTee() }));

export function logTenants(): void {
  console.log(`[tee-kit] hardware: ${detectTee()} · seed source: ${seedSource}${seedSource === "env" ? "" : " (NOT stable across restart)"}`);
  for (const p of PROJECTS) {
    const t = tenants.get(p)!;
    console.log(`[tee-kit]   ${p.padEnd(8)} signer ${t.signer.address}  teeId ${t.tenantId.slice(0, 18)}…`);
  }
}
