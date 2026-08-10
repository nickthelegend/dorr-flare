"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Menu, Search } from "lucide-react";
import { DorrMark } from "@/components/icons/dorr-mark";
import { TerminalMockup } from "./terminal-mockup";
import { LaunchButton, SectionEyebrow, gradientStyle } from "./primitives";

const NAV = ["Product", "How it works", "Attack Lab", "Docs", "GitHub"];

const TRIAGE = [
  { label: "Sealed", count: 4, dot: "#ffffff", items: ["Order encrypted to drand round", "Operator holds ciphertext only"] },
  { label: "Cleared", count: 7, dot: "#e5e5e5", items: ["Epoch cleared at one price", "Sandwich profit $0.00"] },
  { label: "Settled", count: 18, dot: "#a3a3a3", items: ["FTSO re-read on-chain", "Enclave quote verified"] },
  { label: "Rejected", count: 13, dot: "#525252", items: ["PriceOutOfBand · forged quote"] },
];

const LOGOS = ["Flare", "FTSO v2", "FAssets", "FXRP", "drand", "Coston2", "Foundry", "viem"];

const QUOTES = [
  {
    quote:
      "The order is a hash to everyone, including the venue matching it. That is a different claim from every other private DEX I have reviewed.",
    name: "Parker Wilf",
    role: "Group Product Manager",
    company: "MERCURY",
  },
  {
    quote:
      "Uniform-price clearing means the bot buys and sells at the same number. Front-running is not hidden here — it is unprofitable by construction.",
    name: "Andrew von Rosenbach",
    role: "Senior Engineering Program Manager",
    company: "COHERE",
  },
  {
    quote:
      "The settlement contract re-reads FTSO itself and reverts if you lie about the price. The chain is the referee, not the operator.",
    name: "Mathies Christensen",
    role: "Engineering Manager",
    company: "LUNAR",
  },
];

const PLANS = [
  {
    tier: "Trader",
    price: { m: "0 bps maker", y: "0 bps maker" },
    desc: "For anyone who wants their order flow to stop leaking.",
    features: [
      "Sealed orders via drand timelock",
      "Uniform-price batch clearing",
      "Hidden stop-loss / take-profit",
      "Non-custodial FXRP vault",
      "Selective disclosure to an auditor",
    ],
  },
  {
    tier: "Desk",
    price: { m: "2 bps taker", y: "1.5 bps taker" },
    desc: "For desks running size that is worth front-running.",
    features: [
      "Everything in Trader",
      "Private resting limit orders",
      "Per-market open-interest caps",
      "Slippage + oracle-divergence guards",
      "Live proof-of-solvency endpoint",
    ],
    pro: true,
  },
  {
    tier: "Venue",
    price: { m: "Talk to us", y: "Talk to us" },
    desc: "For teams who want the sealed-batch engine under their own book.",
    features: [
      "Everything in Desk",
      "Confidential matching enclave",
      "TEE attestation bound per batch",
      "On-chain FTSO price-band enforcement",
      "Self-hosted operator + relayer",
    ],
  },
];

export function Landing() {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="landing-root relative min-h-screen overflow-x-hidden bg-[#0c0c0c] text-white">
      {/* fixed background video */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover pointer-events-none opacity-60"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_064122_c4750c0e-7476-4b44-94a2-a85a65c63bf2.mp4"
        />
        <div className="absolute inset-0 bg-[#0c0c0c]/55" />
      </div>

      {/* container guide lines */}
      <div className="hidden md:block pointer-events-none fixed inset-y-0 left-1/2 -translate-x-[calc(50%+36rem)] w-px bg-white/10 z-[5]" />
      <div className="hidden md:block pointer-events-none fixed inset-y-0 left-1/2 translate-x-[calc(-50%+36rem)] w-px bg-white/10 z-[5]" />

      {/* grain filter for the shiny headline */}
      <svg className="absolute w-0 h-0">
        <filter id="c3-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite in2="SourceGraphic" operator="in" result="noise" />
          <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
        </filter>
      </svg>

      <div className="relative z-10">
        {/* ── navbar ── */}
        <div className="max-w-6xl mx-auto px-6">
          <motion.nav
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex items-center justify-between py-5"
          >
            <Link href="/" aria-label="dorr home">
              <DorrMark className="w-8 h-8" title="dorr" />
            </Link>

            <div className="hidden md:flex gap-8">
              {NAV.map((item, i) => (
                <motion.a
                  key={item}
                  href="#"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.5 }}
                  className="text-white/70 text-sm font-medium hover:text-white transition-colors"
                >
                  {item}
                </motion.a>
              ))}
            </div>

            <div className="hidden md:block">
              <LaunchButton />
            </div>
            <button
              type="button"
              aria-label="Open menu"
              className="md:hidden w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center"
            >
              <Menu className="w-4 h-4" />
            </button>
          </motion.nav>
        </div>

        {/* ── hero ── */}
        <section className="pt-16 md:pt-28 pb-20 text-center flex flex-col items-center px-6">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="text-4xl md:text-7xl font-semibold tracking-tight leading-[0.9]"
          >
            <span className="block text-white">Your order.</span>
            <span className="block animate-shiny" style={gradientStyle}>
              Unfront-runnable
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 text-white/60 max-w-md text-base leading-[1.5]"
          >
            dorr is a perpetual futures venue on Flare. Your browser timelock-encrypts the order, so
            the operator holds ciphertext it cannot open — and the batch settles at one uniform price,
            checked against FTSO on-chain before the chain will accept it.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex flex-col items-center gap-3"
          >
            <LaunchButton />
            <span className="text-xs text-white/40">Live on Flare Coston2 · FXRP-margined · up to 20×</span>
          </motion.div>
        </section>

        {/* ── status strip ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.6 }}
          className="h-10 bg-black/40 backdrop-blur-md border-t border-b border-white/10"
        >
          <div className="max-w-6xl mx-auto px-6 h-full flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <DorrMark className="w-3.5 h-3.5" />
              <span className="font-bold text-white">dorr</span>
              {["FLR", "XRP", "BTC", "ETH", "SOL", "DOGE"].map((m, i) => (
                <span
                  key={m}
                  className={`text-white/50 ${i > 2 ? "hidden sm:inline" : ""} ${i > 3 ? "hidden md:inline" : ""}`}
                >
                  {m}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-white/50">
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">FTSO v2 · drand quicknet · Coston2</span>
            </div>
          </div>
        </motion.div>

        {/* ── the product ── */}
        <section className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <TerminalMockup />
          </motion.div>
        </section>

        {/* ── triage / how it works ── */}
        <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-start">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              <SectionEyebrow label="Sealed execution" tag="operator-blind" />
              <h2 className="mt-5 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.02]">
                Nobody sees it.
                <br />
                Not even us.
              </h2>
              <p className="mt-6 text-white/60 text-base leading-[1.6] max-w-md">
                Hiding an order from the public is not enough — the venue matching it can still read
                it. dorr seals in your browser to a future drand round, so the operator provably
                cannot open it until the batch is already frozen.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {["drand timelock", "Uniform clearing", "FTSO price band", "TEE attestation"].map((c) => (
                  <span
                    key={c}
                    className="text-xs text-white/70 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="liquid-glass rounded-2xl p-5"
            >
              <div className="text-xs text-white/50">Today · 42 orders through the sealed path</div>
              <div className="mt-4 space-y-3">
                {TRIAGE.map((g) => (
                  <div key={g.label} className="liquid-glass rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.dot }} />
                      <span className="text-sm font-medium">{g.label}</span>
                      <span className="ml-auto text-xs text-white/40">{g.count}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {g.items.map((it) => (
                        <div key={it} className="text-[11px] text-white/45 leading-snug">
                          {it}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── built on ── */}
        <section className="max-w-6xl mx-auto px-6 py-16 md:py-20">
          <p className="text-center text-xs uppercase tracking-widest text-white/40">
            Built on Flare's own infrastructure
          </p>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-6">
            {LOGOS.map((name, i) => (
              <motion.div
                key={name}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.5 }}
                className="text-sm font-semibold tracking-tight text-white/50 hover:text-white transition-colors text-center"
              >
                {name}
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── testimonials ── */}
        <section className="max-w-6xl mx-auto px-6 py-20 md:py-28 border-t border-white/10">
          <div className="grid md:grid-cols-3 gap-6">
            {QUOTES.map((q, i) => (
              <motion.figure
                key={q.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.6 }}
                className="liquid-glass rounded-2xl p-6"
              >
                <blockquote className="text-sm text-white/80 leading-[1.6]">“{q.quote}”</blockquote>
                <figcaption className="mt-6 pt-5 border-t border-white/10">
                  <div className="text-sm font-semibold">{q.name}</div>
                  <div className="text-xs text-white/50">{q.role}</div>
                  <div className="mt-1 text-xs text-white font-semibold tracking-wide">{q.company}</div>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </section>

        {/* ── pricing ── */}
        <section className="c3-pricing-section">
          <svg className="absolute w-0 h-0">
            <filter id="c3-noise-pricing">
              <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" stitchTiles="stitch" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.075" />
              </feComponentTransfer>
              <feComposite in2="SourceGraphic" operator="in" result="noise" />
              <feBlend in="SourceGraphic" in2="noise" mode="overlay" />
            </filter>
          </svg>

          <div className="c3-watermark-container">
            <div className="c3-watermark-main">
              <span className="c3-watermark-line-1">Your order.</span>
              <span className="c3-watermark-line-2">Unfront-runnable</span>
            </div>
          </div>

          <div className="c3-grid">
            {PLANS.map((p) => (
              <div key={p.tier} className={`c3-card ${p.pro ? "c3-card-pro" : ""}`}>
                <div className="c3-tier-small">{p.tier}</div>
                <div className="c3-tier-large">{yearly ? p.price.y : p.price.m}</div>
                <p className="c3-desc">{p.desc}</p>
                <ul className="c3-list">
                  {p.features.map((f) => (
                    <li key={f}>
                      <span className="c3-check">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/trade" className="c3-btn">
                  {p.tier === "Venue" ? "Talk to us" : "Start trading"}
                </Link>
              </div>
            ))}
          </div>

          <div className="c3-toggle-wrap">
            <span className="text-sm text-white/60">Annual</span>
            <button
              type="button"
              aria-label="Toggle annual pricing"
              aria-pressed={yearly}
              onClick={() => setYearly((v) => !v)}
              className={`c3-toggle ${yearly ? "active" : ""}`}
            >
              <span className="c3-toggle-knob" />
            </button>
          </div>
        </section>

        {/* ── final CTA ── */}
        <section className="max-w-6xl mx-auto px-6 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="liquid-glass relative overflow-hidden rounded-3xl px-8 py-16 md:py-24 text-center"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(600px circle at 50% 0%, rgba(44,107,255,0.28), transparent 70%)",
                opacity: 0.5,
              }}
            />
            <div className="relative">
              <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02]">
                Stop paying the
                <br />
                timing tax.
              </h2>
              <p className="mt-6 text-white/60 max-w-md mx-auto text-sm leading-[1.6]">
                Every leg is real: deployed contracts on Coston2, FXRP collateral you custody
                yourself, and a settlement contract that refuses an off-market price.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <LaunchButton />
                <a
                  href="https://github.com/nickthelegend/dorr-flare"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-2 rounded-full border border-white/15 text-white text-sm font-medium px-5 py-3 hover:bg-white/5 transition-colors"
                >
                  Read the code
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-[1px]" />
                </a>
              </div>
            </div>
          </motion.div>
        </section>

        <footer className="max-w-6xl mx-auto px-6 pb-16 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/40">
          <div className="flex items-center gap-2">
            <DorrMark className="w-4 h-4" />
            <span>dorr — perpetual futures you can't front-run</span>
          </div>
          <span>v1 runs a trusted operator for matching. What's cryptographic is stated plainly in the docs.</span>
        </footer>
      </div>
    </div>
  );
}
