"use client";

import { Lock, Search, Sparkles, Swords, Wallet } from "lucide-react";
import { DorrMark } from "@/components/icons/dorr-mark";

/**
 * A still of the dorr terminal for the hero.
 *
 * Deliberately a static replica rather than the live `TradingTerminal`: the
 * landing page must render without an operator, must not open sockets or poll,
 * and must never be able to perturb the real trading surface. The numbers are
 * a captured moment from Coston2, labelled as such.
 */

const SPARK = [12, 18, 14, 22, 19, 27, 24, 31, 28, 36, 33, 41, 38, 34, 40, 46, 43, 50, 47, 55];

const FEED = [
  { market: "FLR-USD", hash: "ef645bee3c88efa9f9…93bab5c96", time: "22:26:12" },
  { market: "XRP-USD", hash: "70226429c17c8d6661…f6891a055", time: "22:25:56" },
  { market: "BTC-USD", hash: "130559eca81a0572cf…1b65c55f4", time: "20:28:26" },
];

const EVENTS = [
  { tag: "ANCHOR", tone: "text-[#7AA6FF]", text: "Sealed batch settled on Flare at one uniform price" },
  { tag: "SEAL", tone: "text-white/70", text: "Sealed order to drand round 31196918 — operator can't read it yet" },
  { tag: "COMMIT", tone: "text-white/70", text: "Committed private LONG — public sees only hash ef645bee3c…" },
];

export function TerminalMockup() {
  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#0e1014]/90 backdrop-blur-2xl shadow-[0_40px_120px_-20px_rgba(3,68,220,0.35)]">
      {/* title bar */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-white/10">
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <span className="flex-1 text-center text-xs text-white/50">dorr — terminal · Coston2</span>
        <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-white/40">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> LIVE
        </span>
      </div>

      <div className="grid grid-cols-12 h-[300px] sm:h-[420px] md:h-[520px]">
        {/* chart */}
        <div className="col-span-12 md:col-span-7 border-b md:border-b-0 md:border-r border-white/10 p-4 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <DorrMark className="w-5 h-5" />
              <span className="text-sm font-semibold">FLR/USD</span>
            </div>
            <span className="text-[11px] font-mono text-white/50">mark 0.006081</span>
            <span className="text-[11px] font-mono text-white/50 hidden sm:inline">index 0.006080</span>
            <span className="text-[11px] font-mono text-emerald-400">+1.3 bps</span>
            <span className="ml-auto text-[10px] text-white/40 hidden sm:inline">
              5m · vAMM mark vs FTSO index
            </span>
          </div>

          {/* candles */}
          <div className="mt-5 flex-1 min-h-[120px] flex items-end gap-[3px]">
            {SPARK.map((h, i) => {
              const up = i % 3 !== 1;
              return (
                <div key={i} className="flex-1 flex flex-col justify-end items-center gap-[2px]">
                  <div className={`w-[2px] ${up ? "bg-emerald-400/50" : "bg-rose-400/50"}`} style={{ height: `${Math.max(6, h / 3)}px` }} />
                  <div
                    className={`w-full rounded-[1px] ${up ? "bg-emerald-400/80" : "bg-rose-400/80"}`}
                    style={{ height: `${h * 2 + 24}px` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between text-[9px] text-white/30 font-mono">
            <span>15:00</span><span>17:00</span><span>19:00</span><span>20:35</span>
          </div>
        </div>

        {/* right rail */}
        <div className="col-span-12 md:col-span-5 flex flex-col">
          {/* order form */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2C6BFF]" /> market order
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-emerald-500/90 text-white text-xs font-semibold py-2 text-center">
                LONG
              </div>
              <div className="rounded-md border border-white/10 text-white/50 text-xs py-2 text-center">
                SHORT
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-[#2C6BFF]/40 bg-[#2C6BFF]/[0.07] p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#7AA6FF]">
                <Lock className="w-3 h-3" /> privacy mode
              </div>
              <p className="mt-2 text-[11px] leading-snug text-white/70">
                Sealed to a drand round — encrypted in your browser, unreadable even by the operator.
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-white/40">
              <span>Margin (FXRP)</span>
              <span className="font-mono">1,000 · 10×</span>
            </div>
            <div className="mt-3 rounded-full bg-white text-black text-xs font-semibold py-2.5 text-center flex items-center justify-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> SEAL LONG — OPERATOR-BLIND
            </div>
          </div>

          {/* what the public sees */}
          <div className="p-4 border-b border-white/10 hidden sm:block">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
              <Search className="w-3 h-3" /> what the public sees
            </div>
            <div className="mt-2 space-y-1.5">
              {FEED.map((f) => (
                <div key={f.hash} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/60">{f.market}</span>
                  <span className="px-1.5 py-0.5 rounded border border-[#2C6BFF]/40 text-[#7AA6FF] text-[9px]">
                    PRIVATE
                  </span>
                  <span className="truncate text-white/35">{f.hash}</span>
                  <span className="ml-auto text-white/25">{f.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* activity */}
          <div className="p-4 flex-1 min-h-0 hidden md:block">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
              <Sparkles className="w-3 h-3" /> activity
            </div>
            <div className="mt-2 space-y-2">
              {EVENTS.map((e) => (
                <div key={e.tag} className="rounded-md border border-white/10 bg-white/[0.02] p-2">
                  <div className={`text-[9px] uppercase tracking-wide ${e.tone}`}>{e.tag}</div>
                  <p className="mt-0.5 text-[10px] leading-snug text-white/60">{e.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* attack-lab teaser strip */}
      <div className="flex items-center gap-3 px-4 h-11 border-t border-white/10 bg-black/30 text-[11px]">
        <Swords className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-white/60">Attack Lab</span>
        <span className="text-rose-400 font-mono">SANDWICHED −$152.90</span>
        <span className="text-white/30">vs</span>
        <span className="text-emerald-400 font-mono">ABORTED 0 / 25,000</span>
      </div>
    </div>
  );
}
