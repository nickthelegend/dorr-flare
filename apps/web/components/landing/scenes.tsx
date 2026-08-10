"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll scenes for the dorr landing page.
 *
 * Each one is a small diagram that *performs* the claim its section makes: an
 * order turning to ciphertext, a threshold that never assembles, six prices
 * collapsing onto one, a settlement drifting out of band and getting rejected.
 * The hero is deliberately not in here — it stays a still frame.
 *
 * The contract every scene keeps: **the DOM renders the finished state.** GSAP
 * rewinds it inside `useLayoutEffect` (before paint, so there is no flash) and
 * plays it forward on scroll. No JS, a crawler, a headless screenshot, or
 * `prefers-reduced-motion` — all of them get the last frame, which is the frame
 * that carries the meaning. Motion is never what makes this page legible.
 *
 * Marketing surface only. Nothing here can reach `components/trading/*`.
 */

type Selector = (s: string) => Element[];

/**
 * Deliberately a plain media query rather than `gsap.matchMedia()`. This page
 * mounts nine independent `useGSAP` scopes; nesting a matchMedia inside each of
 * their contexts and reverting it by hand builds a cyclic context tree, and
 * `Context.getTweens()` recurses into it until the stack blows. A one-shot check
 * costs us live re-evaluation when the OS setting is toggled mid-session — a
 * reload picks that up — and buys a context tree that is always a tree.
 */
const wantsMotion = () =>
  typeof window === "undefined" ||
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scoped GSAP, reduced-motion opt-out, cleanup handled by the useGSAP context. */
function useScene<T extends HTMLElement = HTMLDivElement>(build: (q: Selector, root: T) => void) {
  const ref = useRef<T>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root || !wantsMotion()) return;
      build(gsap.utils.selector(root) as Selector, root);
    },
    { scope: ref },
  );

  return ref;
}

const HEX = "0123456789abcdef";
const DIGITS = "0123456789";

/** Settle `final` left-to-right, filling the unsettled tail with noise. */
function scrambleInto(
  el: Element | undefined,
  final: string,
  tl: gsap.core.Timeline,
  opts: { at?: gsap.Position; duration?: number; lock?: number; glyphs?: string } = {},
) {
  if (!el) return;
  const node = el as HTMLElement;
  const glyphs = opts.glyphs ?? HEX;
  const lock = opts.lock ?? 0;
  const o = { p: 0 };

  tl.to(
    o,
    {
      p: 1,
      duration: opts.duration ?? 1.1,
      ease: "power2.inOut",
      onUpdate() {
        const settled = lock + Math.floor(o.p * (final.length - lock));
        let out = "";
        for (let i = 0; i < final.length; i++) {
          const c = final[i];
          out += i < settled || !/[0-9a-zA-Z]/.test(c)
            ? c
            : glyphs[(Math.random() * glyphs.length) | 0];
        }
        node.textContent = out;
      },
      onComplete() {
        node.textContent = final;
      },
    },
    opts.at,
  );
}

/** Run a number up (or down) into an element, formatted every frame. */
function countInto(
  el: Element | undefined,
  from: number,
  to: number,
  format: (v: number) => string,
  tl: gsap.core.Timeline,
  opts: { at?: gsap.Position; duration?: number; ease?: string } = {},
) {
  if (!el) return;
  const node = el as HTMLElement;
  const o = { v: from };

  tl.to(
    o,
    {
      v: to,
      duration: opts.duration ?? 1.6,
      ease: opts.ease ?? "power2.out",
      onUpdate() {
        node.textContent = format(o.v);
      },
      onComplete() {
        node.textContent = format(to);
      },
    },
    opts.at,
  );
}

/** Rewind a stroked path so it can be drawn on. */
function undraw(paths: Element[]) {
  gsap.set(paths, { strokeDasharray: 1, strokeDashoffset: 1 });
}

const enter = (root: HTMLElement, start = "top 86%") =>
  gsap.timeline({ scrollTrigger: { trigger: root, start, once: true } });

const frame = "rounded-lg border border-white/[0.08] bg-black/40 p-4";
const micro = "font-mono text-[9px] uppercase tracking-[0.18em] text-white/30";

/* ───────────────────────── 01 · seal it in the browser ───────────────────── */

const CIPHERTEXT = "9f3a41c0b7e28d5614af09c3d8b27e15";
const ROUND = "12,043,551";

export function SealScene({ className = "" }: { className?: string }) {
  const ref = useScene((q, root) => {
    const tl = enter(root);
    const plain = q(".seal-plain")[0];
    undraw(q(".seal-arrow"));
    gsap.set(plain, { clipPath: "inset(0 100% 0 0)" });

    scrambleInto(q(".seal-round")[0], ROUND, tl, { duration: 0.55, glyphs: DIGITS });
    tl.to(plain, { clipPath: "inset(0 0% 0 0)", duration: 0.7, ease: "none" }, 0.15)
      .to(q(".seal-arrow"), { strokeDashoffset: 0, duration: 0.45, ease: "power2.out" }, "-=0.1");
    scrambleInto(q(".seal-cipher")[0], CIPHERTEXT, tl, { duration: 1.15, at: "-=0.2" });
  });

  return (
    <div ref={ref} className={`${frame} ${className}`}>
      <div className={`flex items-center justify-between ${micro}`}>
        <span>your machine</span>
        <span>
          drand round <span className="seal-round normal-case tracking-normal">{ROUND}</span>
        </span>
      </div>

      <p className="seal-plain mt-2.5 font-mono text-[11px] text-white/70">
        BUY 2.5 FLR-USD · 20× · market
      </p>

      <div className="mt-2 flex items-center gap-2">
        <svg viewBox="0 0 12 22" className="h-[18px] w-3 shrink-0" aria-hidden>
          <path
            className="seal-arrow"
            d="M6 1 V20 M1.6 15.5 L6 20 L10.4 15.5"
            fill="none"
            stroke="#2C6BFF"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />
        </svg>
        <span className="font-mono text-[9.5px] text-[#7AA6FF]/85">
          tlock · AES-256-GCM · BLS12-381
        </span>
      </div>

      <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/45 break-all">
        <span className="text-white/25">0x</span>
        <span className="seal-cipher">{CIPHERTEXT}</span>
      </p>
    </div>
  );
}

/* ───────────────────── 02 · the operator holds bytes it can't open ───────── */

const SHARES = 22;
const LIT = [3, 10, 17];

export function BlindScene({ className = "" }: { className?: string }) {
  const ref = useScene((q, root) => {
    const tl = enter(root);
    const dots = q(".blind-share");
    const lit = LIT.map((i) => dots[i]).filter(Boolean);
    undraw(q(".blind-strike"));

    // Shares arrive across the network — three of them. Twelve is the threshold.
    tl.to(dots, {
      backgroundColor: "rgba(255,255,255,0.30)",
      duration: 0.16,
      stagger: { each: 0.022, from: "start" },
      yoyo: true,
      repeat: 1,
    })
      .to(lit, { backgroundColor: "#2C6BFF", scale: 1.35, duration: 0.3, stagger: 0.06 }, "-=0.5")
      .to(lit, { scale: 1, duration: 0.25 }, "-=0.05");

    countInto(q(".blind-count")[0], 0, LIT.length, (v) => String(Math.round(v)), tl, {
      duration: 0.5,
      at: "-=0.6",
    });

    tl.to(q(".blind-strike"), { strokeDashoffset: 0, duration: 0.35, ease: "power2.in" }, "-=0.1")
      .fromTo(
        q(".blind-verdict"),
        { scale: 0.86 },
        { scale: 1, duration: 0.5, ease: "back.out(2.6)" },
        "-=0.1",
      );
  });

  return (
    <div ref={ref} className={`${frame} ${className}`}>
      <div className={`flex items-center justify-between ${micro}`}>
        <span>operator</span>
        <span>League of Entropy</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-[4px]" aria-hidden>
        {Array.from({ length: SHARES }, (_, i) => (
          <span
            key={i}
            className="blind-share h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: LIT.includes(i) ? "#2C6BFF" : "rgba(255,255,255,0.12)" }}
          />
        ))}
      </div>

      <p className="mt-3 font-mono text-[11px] tabular-nums">
        <span className="blind-count text-white/70">{LIT.length}</span>
        <span className="text-white/30"> / 12 signature shares · threshold not met</span>
      </p>

      <p className="mt-2 font-mono text-[11px]">
        <span className="relative inline-block text-white/45">
          decrypt(order)
          <svg
            className="pointer-events-none absolute left-0 top-1/2 h-[6px] w-full -translate-y-1/2"
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              className="blind-strike"
              d="M0 3 H100"
              stroke="#fb7185"
              strokeWidth="1.4"
              pathLength={1}
            />
          </svg>
        </span>
        <span className="blind-verdict ml-2 inline-block text-rose-400">REFUSED</span>
      </p>
    </div>
  );
}

/* ─────────────────────── 03 · the epoch clears at one price ──────────────── */

const ORDERS = [
  { x: 22, from: -25, bot: null },
  { x: 66, from: 23, bot: "front-run" },
  { x: 110, from: -17, bot: null },
  { x: 154, from: 27, bot: null },
  { x: 198, from: -29, bot: "back-run" },
  { x: 240, from: 15, bot: null },
] as const;

export function ClearScene({ className = "" }: { className?: string }) {
  const ref = useScene((q, root) => {
    const tl = enter(root);
    const groups = q(".clear-order");
    const pnl = q(".clear-pnl")[0];
    undraw(q(".clear-line"));
    gsap.set(groups, { y: (i: number) => ORDERS[i]?.from ?? 0 });
    gsap.set(pnl, { color: "#fb7185" });

    tl.to(q(".clear-line"), { strokeDashoffset: 0, duration: 0.7, ease: "power2.inOut" }).to(
      groups,
      {
        y: 0,
        duration: 0.95,
        ease: "back.out(1.35)",
        stagger: { each: 0.06, from: "random" },
      },
      "-=0.35",
    );

    // The bot's two legs land on the same number, so the spread it was going to
    // harvest converges to nothing as the orders converge.
    countInto(pnl, 152.9, 0, (v) => `$${v.toFixed(2)}`, tl, {
      duration: 1.0,
      ease: "power2.inOut",
      at: "-=0.85",
    });
    tl.to(pnl, { color: "#34d399", duration: 0.5 }, "-=0.4");
  });

  return (
    <div ref={ref} className={`${frame} ${className}`}>
      <div className={`flex items-center justify-between ${micro}`}>
        <span>epoch · 6 sealed orders</span>
        <span>one clearing price</span>
      </div>

      <svg viewBox="0 0 260 68" className="mt-1 w-full" aria-hidden>
        <path
          className="clear-line"
          d="M6 40 H254"
          fill="none"
          stroke="#2C6BFF"
          strokeWidth="1.3"
          strokeLinecap="round"
          pathLength={1}
        />
        {ORDERS.map((o) => (
          <g key={o.x} className="clear-order">
            <circle
              cx={o.x}
              cy={40}
              r={o.bot ? 4.2 : 3.2}
              fill={o.bot ? "#fb7185" : "#7AA6FF"}
            />
            {o.bot ? (
              <text
                x={o.x}
                y={30}
                textAnchor="middle"
                fontSize="6.5"
                fill="#fb7185"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {o.bot}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      <p className="font-mono text-[11px] tabular-nums">
        <span className="text-white/30">sandwich profit </span>
        <span className="clear-pnl text-emerald-400">$0.00</span>
      </p>
    </div>
  );
}

/* ──────────────────── 04 · the chain checks our arithmetic ───────────────── */

export function BandScene({ className = "" }: { className?: string }) {
  const ref = useScene((q, root) => {
    const tl = enter(root);
    const mark = q(".band-mark")[0];
    const verdict = q(".band-verdict")[0] as HTMLElement | undefined;
    if (!verdict) return;

    const say = (text: string, color: string) => () => {
      verdict.textContent = text;
      gsap.set(verdict, { color });
    };

    gsap.set(mark, { x: -104, y: 0 });

    tl.to(mark, { x: -46, duration: 0.75, ease: "power1.inOut" })
      .to(mark, { x: 6, y: -21, duration: 0.55, ease: "power2.in" })
      .call(say("revert PriceOutOfBand", "#fb7185"))
      .to(q(".band-box"), {
        stroke: "#fb7185",
        fill: "rgba(251,113,133,0.09)",
        duration: 0.14,
        yoyo: true,
        repeat: 3,
      })
      .to(mark, { x: 62, y: 0, duration: 0.7, ease: "power2.out" }, "-=0.2")
      .call(say("accepted", "#34d399"));
  });

  return (
    <div ref={ref} className={`${frame} ${className}`}>
      <div className={`flex items-center justify-between ${micro}`}>
        <span>DorrBatchSettlement</span>
        <span>re-reads FTSO v2</span>
      </div>

      <svg viewBox="0 0 260 58" className="mt-2 w-full" aria-hidden>
        <rect
          className="band-box"
          x="6"
          y="15"
          width="248"
          height="28"
          rx="4"
          fill="rgba(44,107,255,0.08)"
          stroke="rgba(44,107,255,0.35)"
          strokeWidth="1"
        />
        <line x1="6" y1="29" x2="254" y2="29" stroke="rgba(255,255,255,0.14)" strokeDasharray="2 4" />
        <text x="250" y="11" textAnchor="end" fontSize="6.5" fill="rgba(255,255,255,0.3)" fontFamily="ui-monospace, monospace">
          +200 bps
        </text>
        <text x="250" y="54" textAnchor="end" fontSize="6.5" fill="rgba(255,255,255,0.3)" fontFamily="ui-monospace, monospace">
          −200 bps
        </text>
        <circle className="band-mark" cx="124" cy="29" r="4.2" fill="#fff" />
      </svg>

      <p className="mt-1 font-mono text-[11px]">
        <span className="band-verdict text-emerald-400">accepted</span>
        <span className="text-white/30"> · the referee is Flare, not us</span>
      </p>
    </div>
  );
}

/* ─────────────────────────── attack lab · left card ──────────────────────── */

export function SandwichScene() {
  const ref = useScene((q, root) => {
    const tl = enter(root, "top 80%");
    undraw(q(".sw-path"));
    gsap.set(q(".sw-steal"), { scaleY: 0, transformOrigin: "50% 100%" });
    gsap.set(q(".sw-hit"), { scale: 0, transformOrigin: "50% 50%" });

    tl.to(q(".sw-path"), { strokeDashoffset: 0, duration: 1.15, ease: "none" })
      .to(q(".sw-steal"), { scaleY: 1, duration: 0.45, ease: "power2.out" }, "-=0.55")
      .to(
        q(".sw-hit"),
        { scale: 1, duration: 0.4, ease: "back.out(3)", stagger: 0.14 },
        "-=0.75",
      );

    countInto(q(".sw-loss")[0], 0, 152.9, (v) => `−$${v.toFixed(2)}`, tl, {
      duration: 1.3,
      at: "-=0.9",
    });
    countInto(q(".sw-bps")[0], 0, 152.1, (v) => `${v.toFixed(1)} bps stolen`, tl, {
      duration: 1.3,
      at: "<",
    });
  });

  return (
    <div ref={ref} className="rounded-xl border border-rose-500/25 bg-rose-500/[0.05] p-6">
      <p className="text-[11px] uppercase tracking-widest text-rose-300/80">Transparent DEX</p>

      <p className="sw-loss mt-4 font-mono text-3xl font-semibold tabular-nums text-rose-400">
        −$152.90
      </p>
      <p className="sw-bps mt-1 font-mono text-xs tabular-nums text-rose-300/60">
        152.1 bps stolen
      </p>

      <svg viewBox="0 0 240 96" className="mt-5 w-full" aria-hidden>
        {/* the spread the bot lifts your fill into */}
        <rect className="sw-steal" x="68" y="36" width="84" height="30" fill="rgba(251,113,133,0.14)" />
        <path
          className="sw-path"
          d="M6 66 H68 V36 H152 V66 H234"
          fill="none"
          stroke="#fb7185"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
        />
        <circle className="sw-hit" cx="68" cy="36" r="4.5" fill="#fb7185" />
        <circle className="sw-hit" cx="110" cy="36" r="4.5" fill="#fff" />
        <circle className="sw-hit" cx="152" cy="66" r="4.5" fill="#fb7185" />
        <text x="68" y="25" textAnchor="middle" fontSize="10" fill="#fb7185" fontFamily="ui-monospace, monospace">
          bot buys
        </text>
        <text x="110" y="56" textAnchor="middle" fontSize="9.5" fill="rgba(255,255,255,0.7)" fontFamily="ui-monospace, monospace">
          you fill here
        </text>
        <text x="152" y="85" textAnchor="middle" fontSize="10" fill="#fb7185" fontFamily="ui-monospace, monospace">
          bot sells
        </text>
      </svg>

      <p className="mt-4 text-sm leading-relaxed text-white/50">
        The bot reads the order, buys ahead, and sells into the fill.
      </p>
    </div>
  );
}

/* ────────────────────────── attack lab · right card ──────────────────────── */

const TRIES = 25_000;

export function CrackScene() {
  const ref = useScene((q, root) => {
    const tl = enter(root, "top 80%");
    const hash = q(".crack-hash")[0] as HTMLElement | undefined;
    gsap.set(q(".crack-bar"), { scaleX: 0, transformOrigin: "0% 50%" });

    tl.to(q(".crack-bar"), { scaleX: 1, duration: 1.9, ease: "power1.inOut" }, 0);
    countInto(
      q(".crack-tries")[0],
      0,
      TRIES,
      (v) => Math.round(v).toLocaleString("en-US"),
      tl,
      { duration: 1.9, ease: "power1.inOut", at: 0 },
    );

    // 25,000 preimages go past and the left-hand number never moves.
    if (hash) {
      const o = { p: 0 };
      tl.to(
        o,
        {
          p: 1,
          duration: 1.9,
          ease: "none",
          onUpdate() {
            let out = "";
            for (let i = 0; i < 24; i++) out += HEX[(Math.random() * 16) | 0];
            hash.textContent = out;
          },
          onComplete() {
            hash.textContent = "b41c07e9a5d3f28610cbe4a7";
          },
        },
        0,
      );
    }

    tl.fromTo(
      q(".crack-cracks"),
      { scale: 1.18 },
      { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.55)" },
      "-=0.35",
    );
  });

  return (
    <div ref={ref} className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-6">
      <p className="text-[11px] uppercase tracking-widest text-emerald-300/80">dorr, sealed</p>

      <p className="mt-4 font-mono text-3xl font-semibold tabular-nums text-emerald-400">
        <span className="crack-cracks inline-block">0</span>
        <span className="text-emerald-400/40"> / </span>
        <span className="crack-tries">25,000</span>
      </p>
      <p className="mt-1 font-mono text-xs text-emerald-300/60">commitment cracks</p>

      <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="crack-bar h-full w-full rounded-full bg-emerald-400/70" />
      </div>

      <p className="mt-3 font-mono text-[10px] text-white/30">
        sha256 preimage · <span className="crack-hash">b41c07e9a5d3f28610cbe4a7</span>
      </p>

      <p className="mt-4 text-sm leading-relaxed text-white/50">
        No side, no size, no price. The sandwich cannot even be constructed.
      </p>
    </div>
  );
}

/* ──────────────────────────────── proof ──────────────────────────────────── */

export type ProofRow = { k: string; v: string; note: string };

export function ProofLedger({ rows, className = "" }: { rows: readonly ProofRow[]; className?: string }) {
  const ref = useScene<HTMLDListElement>((q, root) => {
    const tl = enter(root);
    undraw(q(".proof-check"));

    // Transform-only on the row itself — the addresses must never depend on a
    // scroll event to be readable.
    tl.from(q(".proof-row"), {
      y: 16,
      duration: 0.6,
      ease: "power3.out",
      stagger: 0.09,
    });

    q(".proof-addr").forEach((el, i) => {
      scrambleInto(el, rows[i]?.v ?? "", tl, { duration: 0.7, lock: 2, at: 0.12 + i * 0.09 });
    });

    tl.to(
      q(".proof-check"),
      { strokeDashoffset: 0, duration: 0.35, ease: "power2.out", stagger: 0.09 },
      "-=0.5",
    );
  });

  return (
    <dl ref={ref} className={`divide-y divide-white/[0.07] border-y border-white/[0.07] ${className}`}>
      {rows.map((p) => (
        <div
          key={p.k}
          className="proof-row grid items-baseline gap-2 py-5 sm:grid-cols-[1fr_auto] sm:gap-8"
        >
          <div>
            <dt className="flex items-center gap-2 text-sm font-medium">
              {p.k}
              <svg viewBox="0 0 14 14" className="h-3 w-3 shrink-0" aria-hidden>
                <path
                  className="proof-check"
                  d="M2.5 7.5 L5.8 10.6 L11.5 3.8"
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                />
              </svg>
            </dt>
            <dd className="mt-1 text-xs text-white/45">{p.note}</dd>
          </div>
          <dd className="proof-addr font-mono text-xs text-[#7AA6FF]">{p.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Figure = { to: number; suffix: string; label: string };

export function ProofFigures({ items, className = "" }: { items: readonly Figure[]; className?: string }) {
  const ref = useScene((q, root) => {
    const tl = enter(root);

    q(".fig-value").forEach((el, i) => {
      const f = items[i];
      if (!f) return;
      const at = i * 0.09;

      if (f.to === 0) {
        // Nothing to count up to. Let the digits churn and land on the only
        // number this figure is ever allowed to be.
        const node = el as HTMLElement;
        const o = { p: 0 };
        tl.to(
          o,
          {
            p: 1,
            duration: 1.05,
            ease: "power2.out",
            onUpdate() {
              node.textContent = o.p < 0.9 ? String((Math.random() * 10) | 0) : "0";
            },
            onComplete() {
              node.textContent = "0";
            },
          },
          at,
        );
        return;
      }

      countInto(el, 0, f.to, (v) => `${Math.round(v)}${f.suffix}`, tl, { duration: 1.4, at });
    });
  });

  return (
    <div ref={ref} className={`grid grid-cols-2 gap-8 lg:grid-cols-4 ${className}`}>
      {items.map((n) => (
        <div key={n.label}>
          <p className="fig-value font-mono text-4xl font-semibold tabular-nums tracking-tight md:text-5xl">
            {n.to}
            {n.suffix}
          </p>
          <p className="mt-2 text-xs leading-snug text-white/45">{n.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────── page-level motion (non-hero sections) ───────────────── */

/**
 * The rises shared by every section below the hero, plus the two scrubbed
 * moments: the terminal standing up as you reach it, and the closing glow
 * opening out.
 *
 * Every rise is **transform-only**. An earlier build gated these on opacity and
 * a headless capture came back with an empty page — if a ScrollTrigger never
 * fires, the copy has to still be there, just 24px lower.
 */
export function useLandingMotion(root: React.RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const el = root.current;
      if (!el || !wantsMotion()) return;
      const q = gsap.utils.selector(el) as Selector;

      for (const node of q("[data-rise]")) {
        gsap.from(node, {
          y: 24,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: node, start: "top 88%", once: true },
        });
      }

      const figure = q("[data-terminal]")[0];
      if (figure) {
        gsap.fromTo(
          figure,
          { y: 54, scale: 0.965, rotateX: 7, transformPerspective: 1600 },
          {
            y: 0,
            scale: 1,
            rotateX: 0,
            ease: "none",
            scrollTrigger: { trigger: figure, start: "top 95%", end: "top 32%", scrub: 0.5 },
          },
        );
      }

      const glow = q("[data-glow]")[0];
      if (glow) {
        gsap.fromTo(
          glow,
          { scale: 0.55, opacity: 0.25 },
          {
            scale: 1,
            opacity: 1,
            duration: 1.4,
            ease: "power2.out",
            scrollTrigger: { trigger: glow, start: "top 85%", once: true },
          },
        );
      }

      // Web fonts and the terminal screenshot both change section heights.
      const refresh = () => ScrollTrigger.refresh();
      document.fonts?.ready.then(refresh).catch(() => {});
      window.addEventListener("load", refresh);
      return () => window.removeEventListener("load", refresh);
    },
    { scope: root },
  );
}
