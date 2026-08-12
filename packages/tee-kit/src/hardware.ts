/**
 * Hardware attestation for the dorr enclave.
 *
 * Two real backends, and an honest "no hardware here" when neither is present:
 *
 *   • **Phala Cloud / dstack** (Intel TDX) — the guest agent's Unix socket returns
 *     a TDX quote plus its event log.
 *   • **Google Confidential Space** (AMD SEV-SNP behind a vTPM) — the launcher's
 *     socket returns an OIDC token whose claims carry the image digest.
 *
 * What makes this worth more than a badge: the quote is requested with
 * `report_data` set to the **batch payload hash**. A TDX quote's report data is
 * covered by the hardware signature, so the quote does not merely say "some
 * enclave was running" — it says "this enclave, running this image, was holding
 * *this* batch". That is the claim `TEEAttestationVerifier` then enforces on
 * Flare, so the hardware evidence and the on-chain check describe the same
 * object rather than two loosely related ones.
 *
 * A note on honesty, because it is the whole point of the exercise: when no
 * enclave is present this reports `available: false` and says so. It never
 * substitutes a self-declared environment variable for a measurement the
 * hardware refused to give.
 */
import http from "node:http";
import { existsSync } from "node:fs";
import { keccak256, type Hex } from "viem";

const DSTACK_SOCKET = process.env.DSTACK_SOCKET || "/var/run/dstack.sock";
const TAPPD_SOCKET = process.env.TAPPD_SOCKET || "/var/run/tappd.sock";
const CS_SOCKET = process.env.CS_SOCKET || "/run/container_launcher/teeserver.sock";

export type TeeMode = "none" | "dstack" | "confidential-space";

export interface HardwareQuote {
  available: boolean;
  mode: TeeMode;
  /** Vendor quote, hex. Present only when the hardware actually returned one. */
  quote?: Hex;
  /** keccak256 of the quote — a short handle for logs and the UI. */
  quoteHash?: Hex;
  /** What the hardware says is running: TDX event log digest, or the CS image digest. */
  imageDigest?: string;
  /** The 32 bytes bound into the quote — always the batch payload hash when one is supplied. */
  reportData?: Hex;
  /** Confidential Space OIDC token, when that is the backend. */
  token?: string;
  note: string;
}

const socketPost = (socketPath: string, path: string, body: unknown, timeoutMs = 4000) =>
  new Promise<string>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          res.statusCode && res.statusCode < 300
            ? resolve(data)
            : reject(new Error(`${socketPath}${path} → ${res.statusCode}: ${data.slice(0, 200)}`)),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("socket timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

export function detectTee(): TeeMode {
  if (existsSync(DSTACK_SOCKET) || existsSync(TAPPD_SOCKET) || process.env.DSTACK === "1") return "dstack";
  if (existsSync(CS_SOCKET) || process.env.CONFIDENTIAL_SPACE === "1") return "confidential-space";
  return "none";
}

/** 64 hex chars of report data — the batch hash when we have one, zeroes otherwise. */
const reportDataFor = (payloadHash?: Hex): string =>
  (payloadHash ?? `0x${"00".repeat(32)}`).replace(/^0x/, "").padEnd(64, "0").slice(0, 64);

/**
 * Ask the hardware for a quote over `payloadHash`.
 *
 * Never throws: a TEE that cannot produce a quote is a fact to report, not an
 * exception to swallow somewhere upstream.
 */
export async function getHardwareQuote(payloadHash?: Hex): Promise<HardwareQuote> {
  const mode = detectTee();
  const reportData = reportDataFor(payloadHash);

  if (mode === "dstack") {
    const socket = existsSync(DSTACK_SOCKET) ? DSTACK_SOCKET : TAPPD_SOCKET;
    // dstack renamed this RPC across releases and the socket answers 404 for the
    // wrong name, so probe the known spellings newest-first. Measured on a live
    // 0.5.9 CVM: the 0.3.x names both 404, which is why the failures are now
    // reported instead of swallowed — "no quote" and "wrong method name" are
    // very different problems and the note has to tell them apart.
    const attempts: string[] = [];
    for (const rpc of [
      "/prpc/GetQuote?json",           // dstack 0.5.x
      "/prpc/Worker.GetQuote?json",
      "/prpc/Dstack.GetQuote?json",    // 0.4.x
      "/prpc/Tappd.TdxQuote?json",     // 0.3.x tappd
    ]) {
      try {
        const raw = await socketPost(socket, rpc, { report_data: reportData });
        const j = JSON.parse(raw) as { quote?: string; event_log?: string };
        if (!j.quote) throw new Error("no quote field in response");
        const quote = (j.quote.startsWith("0x") ? j.quote : `0x${j.quote}`) as Hex;
        return {
          available: true,
          mode,
          quote,
          quoteHash: keccak256(quote),
          reportData: `0x${reportData}`,
          imageDigest: j.event_log ? keccak256(`0x${Buffer.from(j.event_log).toString("hex")}`) : undefined,
          note:
            "Intel TDX quote from the dstack guest agent. report_data is the batch payload hash, so the " +
            "hardware signature covers this exact batch — not merely the fact that an enclave was running.",
        };
      } catch (e) {
        attempts.push(`${rpc} → ${String(e).slice(0, 90)}`);
      }
    }
    return {
      available: false,
      mode,
      note: `dstack socket present at ${socket} but no quote could be fetched — reporting that rather than a self-declared digest.`,
      attempts,
    };
  }

  if (mode === "confidential-space") {
    try {
      const token = (
        await socketPost(CS_SOCKET, "/v1/token", {
          audience: "dorr-enclave",
          token_type: "OIDC",
          nonces: [reportData],
        })
      ).trim();
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      return {
        available: true,
        mode,
        token,
        reportData: `0x${reportData}`,
        imageDigest: claims?.submods?.container?.image_digest,
        quoteHash: keccak256(`0x${Buffer.from(token).toString("hex")}`),
        note:
          "Confidential Space vTPM attestation. The batch payload hash is carried as the token nonce, so the " +
          "signed token is bound to this batch.",
      };
    } catch (e) {
      return {
        available: false,
        mode,
        note: `Confidential Space env detected but the token fetch failed: ${(e as Error).message.slice(0, 140)}`,
      };
    }
  }

  return {
    available: false,
    mode: "none",
    note:
      "No enclave on this host. The signing key is registered on-chain and every batch quote is payload-bound and " +
      "checked by TEEAttestationVerifier, but there is no hardware measurement behind it here.",
  };
}
