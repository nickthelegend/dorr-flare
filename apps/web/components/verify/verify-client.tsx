"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { DorrMark } from "@/components/icons/dorr-mark";
import { OPERATOR_URL } from "@/lib/operator";

/**
 * The verify page.
 *
 * Everything here is fetched from the running system at load — contracts from the
 * operator, the attestation surface from the enclave itself — so the page cannot
 * quietly disagree with what is actually deployed. The "not proven" column is not
 * a disclaimer bolted on the end; it is the same size as the other one, because a
 * reviewer's first question is what we are *not* claiming.
 */

const ENCLAVE_URL = process.env.NEXT_PUBLIC_ENCLAVE_URL || "http://localhost:8795";
const EXPLORER = "https://coston2-explorer.flare.network/address/";

type FlareInfo = {
  chainId: number;
  contracts: { vault: string; settlement: string; teeVerifier: string; ftsoV2: string };
  collateral: { symbol: string; address: string; decimals: number };
  solvency: { solvent: boolean; reservesFxrp: number; liabilitiesFxrp: number };
  enclave: { configured: boolean; signer?: string; teeId?: string; measurement?: string };
  batchesSettled: number;
};
type Attestation = {
  keyCustody?: { signsForOperator: boolean; note: string };
  signer: string | null;
  teeId: string;
  measurement: string;
  hardwareAttestation: {
    available: boolean;
    mode: string;
    note: string;
    imageDigest?: string;
    /** hex quote — its length is the honest way to state the size on screen */
    quote?: string;
    quoteHash?: string;
    reportData?: string;
  };
  onChainVerification: { contract: string | null; checks: string[]; note: string };
};

const short = (a?: string | null, n = 10) => (a ? `${a.slice(0, n)}…${a.slice(-6)}` : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.07] py-3 sm:grid-cols-[220px_1fr] sm:gap-6">
      <dt className="text-sm text-white/50">{label}</dt>
      <dd className="font-mono text-xs text-white/90 break-all">{children}</dd>
    </div>
  );
}

function Addr({ a }: { a?: string | null }) {
  if (!a) return <span className="text-white/40">—</span>;
  return (
    <a
      href={`${EXPLORER}${a}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[#7AA6FF] hover:underline"
    >
      {a} <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export default function VerifyClient() {
  const [info, setInfo] = useState<FlareInfo | null>(null);
  const [att, setAtt] = useState<Attestation | null>(null);
  const [err, setErr] = useState<{ info?: string; att?: string }>({});

  useEffect(() => {
    fetch(`${OPERATOR_URL}/flare/info`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setInfo)
      .catch((e) => setErr((s) => ({ ...s, info: String(e.message ?? e) })));
    fetch(`${ENCLAVE_URL}/attestation`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setAtt)
      .catch((e) => setErr((s) => ({ ...s, att: String(e.message ?? e) })));
  }, []);

  const hw = att?.hardwareAttestation;

  const hardwareLive = Boolean(hw?.available);

  return (
    <div className="landing-root min-h-screen bg-[#0c0c0c] text-white">
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#0c0c0c]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <DorrMark className="h-7 w-7" title="dorr" />
            <span className="text-[15px] font-semibold lowercase tracking-tight">dorr</span>
          </Link>
          <Link
            href="/trade"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-all hover:bg-white/90"
          >
            Open terminal
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-[1px]" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16 md:py-24">
        <h1 className="text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Verify</h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-white/55">
          Read live from the running system: the contracts below come from the operator, the
          attestation from the enclave itself. If this page and the deployment ever disagree, the
          page is wrong — which is why nothing here is typed by hand.
        </p>

        {/* ── the two columns that matter ── */}
        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-emerald-300/80">
              What the chain actually checks
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/75">
              <li>
                <span className="text-white">The settlement price.</span> DorrBatchSettlement
                re-reads FTSO v2 on-chain and reverts <code className="text-emerald-300">PriceOutOfBand</code> if
                the clearing price is more than 200 bps off. The operator cannot settle at a price
                the oracle disagrees with.
              </li>
              <li>
                <span className="text-white">The enclave.</span> Every batch carries a quote that
                TEEAttestationVerifier checks:
                <ul className="mt-2 space-y-1 pl-4 font-mono text-[11px] text-white/55">
                  {(att?.onChainVerification.checks ?? []).map((c) => (
                    <li key={c}>— {c}</li>
                  ))}
                  {!att && <li className="text-white/30">— loading from the enclave…</li>}
                </ul>
              </li>
              <li>
                <span className="text-white">The hardware.</span>{" "}
                {hw === undefined
                  ? "Reading the enclave\u2026"
                  : hw?.available
                    ? `The matching engine is running inside Intel TDX and signing with it — a ${
                        hw.quote ? (hw.quote.length - 2) / 2 : 0
                      }-byte quote from the ${hw.mode ?? "dstack"} guest agent, with report_data set to the batch payload hash. The signature covers this batch, not merely the fact that an enclave exists.`
                    : "No hardware attestation is being served right now, and this page says so rather than substituting a self-declared image digest."}
              </li>
              <li>
                <span className="text-white">The key the matching engine cannot reach.</span> The
                operator delegates batch signing to the enclave and holds no attestation key, so it
                cannot forge a quote even for itself. Delegating is safe because the chain checks the
                payload: a signature over any batch other than the one being settled is worthless.
              </li>
              <li>
                <span className="text-white">Your collateral.</span> DorrVault pays out only to the
                depositor. There is no operator withdrawal path — proven by
                <code className="text-emerald-300"> testFuzz_WithdrawNeverExceedsFree</code> and
                <code className="text-emerald-300"> test_SettlementCannotDrainVault</code>.
              </li>
              <li>
                <span className="text-white">Zero-sum PnL.</span> The settlement contract cannot mint
                balance or drain the vault — <code className="text-emerald-300">test_PnlMustBeZeroSum</code>.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-amber-300/80">
              What is not proven
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/75">
              <li>
                <span className="text-white">The enclave&rsquo;s identity is not sealed to the silicon.</span>{" "}
                Its signing seed comes from the environment, which keeps the on-chain registrations
                valid across redeploys but means the host operator could read it. One attested
                machine also serves our sibling projects under separate derived identities, so the
                blast radius is shared.
              </li>
              <li>
                <span className="text-white">The clearing arithmetic is not ZK-proven.</span> The
                enclave computes the uniform price; the chain checks it against the oracle band and
                the attestation, but does not re-execute the match.
              </li>
              <li>
                <span className="text-white">v1 runs a trusted operator</span> for matching and
                execution, like a sequencer. What is cryptographic today is that it cannot read a
                sealed order, the epoch clears at one price, and collateral is self-custodied.
              </li>
              <li>
                <span className="text-white">Liquidity is a virtual AMM, not an external book.</span>{" "}
                Depth is whatever the pool is seeded with. We borrow no external liquidity, which is
                the trade we made for being able to seal orders at all.
              </li>
              <li>
                <span className="text-white">Testnet only.</span> Coston2, FXRP with no real value,
                unaudited.
              </li>
            </ul>
          </section>
        </div>

        {/* ── live deployment ── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Live deployment</h2>
        <p className="mt-2 text-sm text-white/45">
          Fetched from <code className="font-mono text-white/60">{OPERATOR_URL}/flare/info</code>
        </p>
        <dl className="mt-6 border-t border-white/[0.07]">
          {err.info && (
            <Row label="operator">
              <span className="text-rose-400">unreachable — {err.info}</span>
            </Row>
          )}
          <Row label="Network">
            {info ? `Flare Coston2 · chainId ${info.chainId}` : "…"}{" "}
            <span className="text-white/40">(testnet)</span>
          </Row>
          <Row label="DorrVault">
            <Addr a={info?.contracts.vault} />
          </Row>
          <Row label="DorrBatchSettlement">
            <Addr a={info?.contracts.settlement} />
          </Row>
          <Row label="TEEAttestationVerifier">
            <Addr a={info?.contracts.teeVerifier} />
          </Row>
          <Row label="FTSO v2 (via registry)">
            <Addr a={info?.contracts.ftsoV2} />
          </Row>
          <Row label="Collateral">
            {info ? `${info.collateral.symbol} · ${info.collateral.decimals}dp` : "…"}{" "}
            <Addr a={info?.collateral.address} />
          </Row>
          <Row label="Solvency">
            {info ? (
              <span className={info.solvency.solvent ? "text-emerald-400" : "text-rose-400"}>
                {info.solvency.solvent ? "backed" : "UNDER-COLLATERALISED"} · reserves{" "}
                {info.solvency.reservesFxrp} FXRP vs liabilities {info.solvency.liabilitiesFxrp} FXRP
              </span>
            ) : (
              "…"
            )}
          </Row>
          <Row label="Batches settled on-chain">{info ? info.batchesSettled : "…"}</Row>
        </dl>

        {/* ── enclave ── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Confidential compute</h2>
        <p className="mt-2 text-sm text-white/45">
          Fetched from <code className="font-mono text-white/60">{ENCLAVE_URL}/attestation</code> —
          the enclave speaks for itself.
        </p>
        <dl className="mt-6 border-t border-white/[0.07]">
          {err.att && (
            <Row label="enclave">
              <span className="text-rose-400">unreachable — {err.att}</span>
            </Row>
          )}
          <Row label="Enclave signer">
            <Addr a={att?.signer} />
          </Row>
          <Row label="TEE id">{short(att?.teeId, 18)}</Row>
          <Row label="Measurement">{short(att?.measurement, 18)}</Row>
          <Row label="Hardware attestation">
            {hw ? (
              <span className={hw.available ? "text-emerald-400" : "text-amber-400"}>
                {hw.available ? `live · ${hw.mode}` : `none · mode "${hw.mode}"`}
                {hw.imageDigest ? ` · ${short(hw.imageDigest, 14)}` : ""}
              </span>
            ) : (
              "…"
            )}
          </Row>
          <Row label="Verified by">
            <Addr a={att?.onChainVerification.contract} />
          </Row>
          <Row label="Signs for the operator">
            {att?.keyCustody ? (
              <span className={att.keyCustody.signsForOperator ? "text-emerald-400" : "text-white/50"}>
                {att.keyCustody.signsForOperator
                  ? "yes — the operator holds no attestation key"
                  : "no — single-process mode"}
              </span>
            ) : (
              "…"
            )}
          </Row>
        </dl>

        <p className="mt-14 max-w-3xl text-sm leading-relaxed text-white/40">
          {/* Reads the live attestation rather than asserting either way. This
              sentence used to say "without hardware attestation on this host"
              unconditionally, and once the enclave moved to a TDX CVM it sat
              directly under a row reading "live · dstack" and contradicted it.
              A verify page that argues with itself is worse than one that
              claims nothing. */}
          The honest summary: dorr is the only entry we know of whose enclave quote is{" "}
          <span className="text-white/70">checked on-chain and bound to the specific batch it
          settled</span>
          {hardwareLive ? (
            <>
              , and that quote now comes from{" "}
              <span className="text-white/70">real Intel TDX hardware</span> whose report data is the
              batch payload hash. Both halves at once — which is the thing this page exists to let
              you check rather than take our word for.
            </>
          ) : (
            <>
              , and it is also an enclave without hardware attestation on this host. Both of those
              are true at once, and a reviewer deserves to see them on the same page.
            </>
          )}
        </p>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            href="/trade"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition-all hover:bg-white/90"
          >
            Open the terminal
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://github.com/nickthelegend/dorr-flare"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition-colors hover:border-white/25 hover:bg-white/5"
          >
            Read the code
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </main>
    </div>
  );
}
