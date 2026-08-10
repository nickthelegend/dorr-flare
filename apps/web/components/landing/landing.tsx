"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Menu, X } from "lucide-react";
import { DorrMark } from "@/components/icons/dorr-mark";
import { LaunchButton, gradientStyle } from "./primitives";

/**
 * The dorr landing page.
 *
 * One header, six anchored sections, and a single authored motion moment (the
 * hero). Below the fold sections reveal on their own terms rather than repeating
 * one entrance animation six times.
 *
 * Everything here is marketing surface — it renders with no operator running and
 * cannot touch `components/trading/*`.
 */

const SECTIONS = [
  { id: "terminal", label: "Terminal" },
  { id: "sealed", label: "How it works" },
  { id: "attack", label: "Attack Lab" },
  { id: "proof", label: "Proof" },
  { id: "access", label: "Access" },
] as const;

const STEPS = [
  {
    n: "01",
    title: "You seal it in the browser",
    body: "Your order is timelock-encrypted to a drand round that has not been published yet. What leaves your machine is ciphertext plus a 32-byte commitment.",
    stat: "AES-GCM · BLS12-381",
  },
  {
    n: "02",
    title: "The operator holds bytes it cannot open",
    body: "Not a policy — the League of Entropy is a live 12-of-22 threshold network, and the beacon for that round does not exist yet. We have the ciphertext and no way in.",
    stat: "decrypt → REFUSED",
  },
  {
    n: "03",
    title: "The epoch clears at one price",
    body: "When the round lands, every order in the batch settles at a single uniform price. A bot that front-runs and back-runs buys and sells at the same number.",
    stat: "sandwich → $0.00",
  },
  {
    n: "04",
    title: "The chain checks our arithmetic",
    body: "DorrBatchSettlement re-reads FTSO v2 itself and reverts PriceOutOfBand if our clearing price is off-market. The referee is Flare, not us.",
    stat: "reverts on drift > 200 bps",
  },
];

const PROOF = [
  { k: "DorrVault", v: "0x65b705A4…", note: "FXRP margin, depositor-only withdrawal" },
  { k: "DorrBatchSettlement", v: "0x047478DE…", note: "FTSO re-read + enclave quote" },
  { k: "TEEAttestationVerifier", v: "0x578D75dD…", note: "quote bound to one batch" },
];

const NUMBERS = [
  { v: "6", l: "markets on FTSO v2" },
  { v: "20×", l: "max leverage" },
  { v: "125", l: "tests, all green" },
  { v: "0", l: "orders the operator can read" },
];

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string>("terminal");
  const reduce = useReducedMotion();

  // Light-up the nav item for whichever section owns the viewport.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0.01, 0.25, 0.5] },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  // Transform-only, never opacity: if IntersectionObserver never fires — a
  // crawler, a screenshot, a browser with motion disabled — the copy is still
  // on the page. Motion is the enhancement, not the gate.
  const rise = reduce
    ? {}
    : {
        initial: { y: 22 },
        whileInView: { y: 0 },
        viewport: { once: true, margin: "-80px" },
        transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div className="landing-root relative min-h-screen overflow-x-hidden bg-[#0c0c0c] text-white">
      {/* ── ambient backdrop ── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden
          className="w-full h-full object-cover pointer-events-none opacity-50"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_064122_c4750c0e-7476-4b44-94a2-a85a65c63bf2.mp4"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c0c0c]/70 via-[#0c0c0c]/85 to-[#0c0c0c]" />
      </div>

      <div className="hidden lg:block pointer-events-none fixed inset-y-0 left-1/2 -translate-x-[calc(50%+36rem)] w-px bg-white/[0.07] z-[5]" />
      <div className="hidden lg:block pointer-events-none fixed inset-y-0 left-1/2 translate-x-[calc(-50%+36rem)] w-px bg-white/[0.07] z-[5]" />

      <svg className="absolute w-0 h-0" aria-hidden>
        <filter id="c3-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite in2="SourceGraphic" operator="in" result="noise" />
          <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
        </filter>
      </svg>

      {/* ── the one header ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#0c0c0c]/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <a href="#top" className="flex items-center gap-2.5" aria-label="dorr, back to top">
            <DorrMark className="w-7 h-7" title="dorr" />
            <span className="text-[15px] font-semibold lowercase tracking-tight">dorr</span>
          </a>

          <nav className="hidden md:flex items-center gap-1" aria-label="Sections">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                className={`relative px-3 py-2 text-sm font-medium rounded-full transition-colors ${
                  active === s.id ? "text-white" : "text-white/55 hover:text-white/90"
                }`}
              >
                {s.label}
                {active === s.id ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-white/[0.08]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                ) : null}
              </a>
            ))}
          </nav>

          <div className="hidden md:block">
            <LaunchButton label="Open terminal" />
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="md:hidden w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center active:scale-95 transition-transform"
          >
            {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {menuOpen ? (
          <div className="md:hidden border-t border-white/[0.07] bg-[#0c0c0c]/95 px-6 py-4">
            <div className="flex flex-col">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="py-3 text-sm text-white/70 hover:text-white border-b border-white/5 last:border-0"
                >
                  {s.label}
                </a>
              ))}
              <div className="pt-4">
                <LaunchButton label="Open terminal" full />
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main id="top" className="relative z-10">
        {/* ── 1 · hero ── */}
        <section className="px-6 pt-20 md:pt-32 pb-16 text-center flex flex-col items-center">
          <a
            href="#attack"
            style={{ "--reveal-delay": "0.05s" } as React.CSSProperties}
            className="reveal group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pl-1.5 pr-3 py-1.5 text-xs text-white/70 hover:text-white hover:border-white/20 transition-colors"
          >
            <span className="rounded-full bg-[#2C6BFF] text-white px-2 py-0.5 text-[10px] font-semibold">
              LIVE
            </span>
            A bot tried to sandwich this. It got $0.00.
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>

          <h1
            style={{ "--reveal-delay": "0.14s" } as React.CSSProperties}
            className="reveal mt-8 text-[2.75rem] leading-[0.92] md:text-7xl md:leading-[0.9] font-semibold tracking-[-0.03em] max-w-4xl text-balance"
          >
            <span className="block text-white">Your order.</span>
            <span className="block animate-shiny" style={gradientStyle}>
              Unfront-runnable
            </span>
          </h1>

          <p
            style={{ "--reveal-delay": "0.24s" } as React.CSSProperties}
            className="reveal mt-7 text-white/55 max-w-xl text-[15px] md:text-base leading-relaxed text-pretty"
          >
            Perpetual futures on Flare, where the venue matching your order cannot read it —
            and the chain, not the venue, decides whether the settlement price was honest.
          </p>

          <div
            style={{ "--reveal-delay": "0.34s" } as React.CSSProperties}
            className="reveal mt-9 flex flex-col items-center gap-4"
          >
            <div className="flex flex-wrap items-center justify-center gap-3">
              <LaunchButton label="Open the terminal" />
              <a
                href="#sealed"
                className="group inline-flex items-center gap-2 rounded-full border border-white/15 text-white/90 text-sm font-medium px-5 py-3 hover:bg-white/5 hover:border-white/25 transition-colors"
              >
                See how it works
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
            <p className="text-xs text-white/35">
              Live on Flare Coston2 · FXRP-margined · up to 20×
            </p>
          </div>
        </section>

        {/* ── 2 · the terminal, for real ── */}
        <section id="terminal" className="scroll-mt-20 px-6 pb-24 md:pb-32">
          <motion.figure
            initial={reduce ? false : { y: 36, scale: 0.985 }}
            whileInView={{ y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-6xl mx-auto"
          >
            <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-[0_50px_140px_-40px_rgba(3,68,220,0.5)]">
              <Image
                src="/assets/trade-terminal.png"
                alt="The dorr terminal on Flare Coston2: a live FLR/USD candlestick chart priced from FTSO v2, the sealed order form with privacy mode on, the public feed showing only commitment hashes, and the activity log."
                width={2880}
                height={1800}
                priority
                className="w-full h-auto"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0c0c0c] to-transparent" />
            </div>
            <figcaption className="mt-5 text-center text-xs text-white/40">
              The real terminal, not a render — every price on it came from FTSO v2 on Coston2.
            </figcaption>
          </motion.figure>
        </section>

        {/* ── 3 · how it works ── */}
        <section id="sealed" className="scroll-mt-20 px-6 py-20 md:py-28 border-t border-white/[0.07]">
          <div className="max-w-6xl mx-auto">
            <motion.div {...rise} className="max-w-2xl">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.04] text-balance">
                Four steps. The third one
                <br className="hidden sm:block" /> is the one nobody else does.
              </h2>
              <p className="mt-5 text-white/55 text-[15px] leading-relaxed max-w-lg text-pretty">
                Hiding an order from the public is table stakes. Hiding it from the venue that
                matches it is the hard part — and it only matters if the settlement price can
                still be audited afterwards.
              </p>
            </motion.div>

            <ol className="mt-14 grid gap-px bg-white/[0.07] md:grid-cols-2 rounded-xl overflow-hidden border border-white/[0.07]">
              {STEPS.map((s, i) => (
                <motion.li
                  key={s.n}
                  initial={reduce ? false : { y: 14 }}
                  whileInView={{ y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative bg-[#0c0c0c] p-7 md:p-9 transition-colors hover:bg-[#101319]"
                >
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-xs text-[#2C6BFF] tabular-nums">{s.n}</span>
                    <h3 className="text-lg md:text-xl font-semibold tracking-tight">{s.title}</h3>
                  </div>
                  <p className="mt-3 ml-0 md:ml-10 text-sm text-white/55 leading-relaxed max-w-md text-pretty">
                    {s.body}
                  </p>
                  <p className="mt-4 ml-0 md:ml-10 font-mono text-[11px] text-white/35">{s.stat}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 4 · attack lab ── */}
        <section id="attack" className="scroll-mt-20 px-6 py-20 md:py-28 border-t border-white/[0.07]">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.15fr] gap-12 lg:gap-16 items-center">
            <motion.div {...rise}>
              <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.04] text-balance">
                Run the attack yourself.
              </h2>
              <p className="mt-5 text-white/55 text-[15px] leading-relaxed max-w-md text-pretty">
                The Attack Lab ships in the product. It runs a real sandwich against the live
                vAMM — actual fills, actual price impact — then runs the identical attack against
                a sealed order and shows you the bot failing.
              </p>
              <p className="mt-4 text-white/40 text-sm leading-relaxed max-w-md">
                The brute-force is 25,000 real SHA-256 preimage guesses against the commitment. It
                is timed on the server and reported with the rate it achieved.
              </p>
              <div className="mt-8">
                <LaunchButton label="Open the Attack Lab" href="/trade" />
              </div>
            </motion.div>

            <motion.div {...rise} className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.05] p-6">
                <p className="text-[11px] uppercase tracking-widest text-rose-300/80">
                  Transparent DEX
                </p>
                <p className="mt-4 font-mono text-3xl font-semibold tabular-nums text-rose-400">
                  −$152.90
                </p>
                <p className="mt-1 font-mono text-xs text-rose-300/60">152.1 bps stolen</p>
                <p className="mt-5 text-sm text-white/50 leading-relaxed">
                  The bot reads the order, buys ahead, and sells into the fill.
                </p>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-6">
                <p className="text-[11px] uppercase tracking-widest text-emerald-300/80">
                  dorr, sealed
                </p>
                <p className="mt-4 font-mono text-3xl font-semibold tabular-nums text-emerald-400">
                  0 / 25,000
                </p>
                <p className="mt-1 font-mono text-xs text-emerald-300/60">commitment cracks</p>
                <p className="mt-5 text-sm text-white/50 leading-relaxed">
                  No side, no size, no price. The sandwich cannot even be constructed.
                </p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── 5 · proof ── */}
        <section id="proof" className="scroll-mt-20 px-6 py-20 md:py-28 border-t border-white/[0.07]">
          <div className="max-w-6xl mx-auto">
            <motion.div {...rise} className="max-w-2xl">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.04] text-balance">
                Every claim on this page
                <br className="hidden sm:block" /> has an address.
              </h2>
              <p className="mt-5 text-white/55 text-[15px] leading-relaxed max-w-lg text-pretty">
                Deployed and verifiable on Flare Coston2. The vault holds real FXRP that only its
                depositor can withdraw — we hold no minting authority over it, which is exactly why
                the solvency figure means something.
              </p>
            </motion.div>

            <motion.dl {...rise} className="mt-12 divide-y divide-white/[0.07] border-y border-white/[0.07]">
              {PROOF.map((p) => (
                <div key={p.k} className="grid sm:grid-cols-[1fr_auto] gap-2 sm:gap-8 py-5 items-baseline">
                  <div>
                    <dt className="text-sm font-medium">{p.k}</dt>
                    <dd className="mt-1 text-xs text-white/45">{p.note}</dd>
                  </div>
                  <dd className="font-mono text-xs text-[#7AA6FF]">{p.v}</dd>
                </div>
              ))}
            </motion.dl>

            <motion.div {...rise} className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-8">
              {NUMBERS.map((n) => (
                <div key={n.l}>
                  <p className="font-mono text-4xl md:text-5xl font-semibold tabular-nums tracking-tight">
                    {n.v}
                  </p>
                  <p className="mt-2 text-xs text-white/45 leading-snug">{n.l}</p>
                </div>
              ))}
            </motion.div>

            <motion.p {...rise} className="mt-14 max-w-2xl text-sm text-white/40 leading-relaxed">
              <span className="text-white/70">Honest scope:</span> v1 runs a trusted operator for
              matching and execution, like a sequencer. What is cryptographic today is that it
              cannot see or front-run a sealed order, the epoch clears at one price, collateral is
              self-custodied, and the settlement contract enforces the price band on-chain. The
              clearing arithmetic is not yet ZK-proven.
            </motion.p>
          </div>
        </section>

        {/* ── 6 · access ── */}
        <section id="access" className="scroll-mt-20 px-6 py-20 md:py-32 border-t border-white/[0.07]">
          <motion.div
            {...rise}
            className="max-w-4xl mx-auto relative overflow-hidden rounded-2xl border border-white/10 px-8 py-16 md:py-24 text-center"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(700px circle at 50% -10%, rgba(44,107,255,0.22), transparent 65%)",
              }}
            />
            <div className="relative">
              <h2 className="text-3xl md:text-6xl font-semibold tracking-[-0.03em] leading-[1.02] text-balance">
                Stop paying
                <br /> the timing tax.
              </h2>
              <p className="mt-6 text-white/55 max-w-md mx-auto text-[15px] leading-relaxed text-pretty">
                No waitlist and no signup — connect a wallet on Coston2, claim test FXRP, and the
                terminal is yours.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <LaunchButton label="Open the terminal" />
                <a
                  href="https://github.com/nickthelegend/dorr-flare"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-2 rounded-full border border-white/15 text-white text-sm font-medium px-5 py-3 hover:bg-white/5 hover:border-white/25 transition-colors"
                >
                  Read the code
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </a>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-5 text-xs text-white/35">
          <div className="flex items-center gap-2.5">
            <DorrMark className="w-4 h-4" />
            <span>dorr — perpetual futures you can&apos;t front-run</span>
          </div>
          <div className="flex items-center gap-5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="hover:text-white/70 transition-colors">
                {s.label}
              </a>
            ))}
            <Link href="/trade" className="hover:text-white/70 transition-colors">
              Terminal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
