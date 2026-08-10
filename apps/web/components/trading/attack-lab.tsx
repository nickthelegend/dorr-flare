"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bullet } from "@/components/ui/bullet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Swords,
  Eye,
  Lock,
  ShieldCheck,
  ShieldOff,
  Bot,
  Target,
  Link2,
  KeyRound,
  Scale,
  TrendingUp,
  TrendingDown,
  Radio,
  Clock,
  EyeOff,
} from "lucide-react";
import { cn, formatUsd, humanizeError } from "@/lib/core";
import { useMarketSelection } from "@/context/market-context";
import { useMarkets } from "@/hooks/use-operator";
import { operator, type AttackLab, type AttackStep, type BatchDemo, type SealedDemo, type Side } from "@/lib/operator";
import { MarketIcon } from "./market-icon";
import { AbShowcaseBody } from "./sandwich-showcase";

/** The whole animation plays out over this window regardless of raw ms spread. */
const PLAY_MS = 2500;

const ACTOR_ICON = {
  bot: Bot,
  victim: Target,
  chain: Link2,
  dorr: Lock,
} as const;

/** One revealed step row in a timeline. */
function StepRow({ step, side }: { step: AttackStep; side: "public" | "private" }) {
  const Icon = ACTOR_ICON[step.actor] ?? Bot;
  // On the private side a blocked step (ok:false) is a GOOD thing — the attack is
  // being aborted — so it reads muted/struck rather than alarming.
  const blocked = side === "private" && !step.ok;
  const failure = side === "public" && !step.ok; // the victim getting sandwiched
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "public" ? -8 : 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "flex items-start gap-2 rounded-md border px-2 py-1.5",
        side === "public"
          ? failure
            ? "border-destructive/50 bg-destructive/10"
            : "border-destructive/25 bg-destructive/[0.04]"
          : blocked
            ? "border-border/60 bg-muted/20"
            : "border-success/40 bg-success/[0.06]",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 mt-0.5 shrink-0",
          side === "public"
            ? "text-destructive"
            : blocked
              ? "text-muted-foreground"
              : "text-success",
        )}
      />
      <span
        className={cn(
          "text-[11px] leading-snug",
          blocked && "text-muted-foreground line-through decoration-muted-foreground/40",
          !blocked && "text-foreground/90",
        )}
      >
        {step.text}
      </span>
    </motion.div>
  );
}

/** A single attack timeline column with an animated, progressively-revealed step list. */
function Timeline({
  title,
  side,
  icon,
  revealed,
  steps,
  badge,
  outcome,
}: {
  title: string;
  side: "public" | "private";
  icon: React.ReactNode;
  revealed: number;
  steps: AttackStep[];
  badge: React.ReactNode;
  outcome: React.ReactNode;
}) {
  const done = revealed >= steps.length;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 flex flex-col",
        side === "public" ? "border-destructive/40 bg-destructive/5" : "border-success/50 bg-success/5",
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
            side === "public" ? "text-destructive" : "text-success",
          )}
        >
          {icon}
          {title}
        </div>
        {badge}
      </div>

      <div className="space-y-1.5 min-h-[168px]">
        <AnimatePresence initial={false}>
          {steps.slice(0, revealed).map((s, i) => (
            <StepRow key={`${side}-${i}`} step={s} side={side} />
          ))}
        </AnimatePresence>
        {!done && (
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {side === "public" ? "bot working…" : "watching the chain…"}
          </div>
        )}
      </div>

      {/* outcome badge lands once the timeline finishes playing */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="pt-1"
          >
            {outcome}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The MEV attack lab body — the headline demo. On "RUN ATTACK" it calls
 * `operator.runAttack` then animates BOTH step timelines: each step is revealed
 * at its own `ms` offset (rescaled so the whole thing plays over ~2.5s), so it
 * feels like a live sandwich attempt. The transparent DEX ends SANDWICHED; dorr
 * ends ATTACK FAILED with a prominent 0 / 25,000 brute-force line — the proof.
 */
export function AttackLabBody() {
  const { selectedMarketId } = useMarketSelection();
  const { data: markets } = useMarkets();
  const [side, setSide] = useState<Side>("LONG");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AttackLab | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pubRevealed, setPubRevealed] = useState(0);
  const [privRevealed, setPrivRevealed] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const symbol = markets?.find((m) => m.id === selectedMarketId)?.symbol ?? selectedMarketId;
  const base = selectedMarketId.split("-")[0];

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const play = (res: AttackLab) => {
    clearTimers();
    setPubRevealed(0);
    setPrivRevealed(0);
    // Rescale each run's raw ms range onto the PLAY_MS window so both timelines
    // finish together and the reveal always feels live regardless of the data.
    const schedule = (steps: AttackStep[], set: (n: number) => void) => {
      const maxMs = Math.max(1, ...steps.map((s) => s.ms));
      steps.forEach((s, i) => {
        const delay = (s.ms / maxMs) * PLAY_MS;
        timers.current.push(setTimeout(() => set(i + 1), delay));
      });
    };
    schedule(res.publicRun.steps, setPubRevealed);
    schedule(res.privateRun.steps, setPrivRevealed);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    clearTimers();
    setResult(null);
    setPubRevealed(0);
    setPrivRevealed(0);
    try {
      const res = await operator.runAttack({
        marketId: selectedMarketId,
        side,
        marginUsd: 1000,
        leverage: 10,
      });
      setResult(res);
      play(res);
    } catch (e: any) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  };

  const cracks = result
    ? `${result.privateRun.bruteForceMatches.toLocaleString()} / ${result.privateRun.bruteForceAttempts.toLocaleString()}`
    : "0 / 25,000";

  return (
    // Header + controls stay pinned; the result below owns the remaining height.
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full min-h-0">
      <div className="space-y-3 p-4 pb-3 border-b">
      {/* header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Bullet variant="destructive" />
          mev attack lab
        </div>
        <h2 className="text-2xl font-display leading-none flex items-center gap-2">
          <Swords className="size-5 text-destructive" /> Run a sandwich attack
        </h2>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MarketIcon base={base} size={14} />
          Same {formatUsd(1000, 0)} FXRP · 10x {side} on {symbol}. A front-running bot attacks it on a
          transparent DEX, then tries the same on dorr.
        </p>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg flex-1 max-w-[200px]">
          {(["LONG", "SHORT"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "py-1.5 text-xs font-medium rounded-md transition-colors",
                side === s
                  ? s === "LONG"
                    ? "bg-success text-white"
                    : "bg-destructive text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Button onClick={run} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <span className="text-base leading-none">🗡️</span>}
          Run attack
        </Button>
      </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-4 space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error} — is the operator running?
        </div>
      )}

      {!result && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          Run the attack to watch a sandwich bot sandwich the order on a transparent DEX — then watch the
          exact same attack fail against dorr.
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {(() => {
            // Defined once and rendered in both layouts — the same two runs,
            // side-by-side with a draggable divider on desktop, stacked on mobile.
            const publicTimeline = (
              <Timeline
                title="Transparent DEX"
                side="public"
                icon={<Eye className="size-3.5" />}
                revealed={pubRevealed}
                steps={result.publicRun.steps}
                badge={
                  <Badge variant="outline-destructive" className="text-[9px] h-4">
                    order visible to bot
                  </Badge>
                }
                outcome={
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-2 flex items-center gap-2">
                    <ShieldOff className="size-4 text-destructive shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-destructive uppercase tracking-wide">
                        Sandwiched
                      </div>
                      <div className="font-mono text-[11px] text-destructive tabular-nums">
                        −{formatUsd(result.publicRun.victimExtraCostUsd)} ·{" "}
                        {result.publicRun.victimSlippageBps.toFixed(1)} bps
                      </div>
                    </div>
                  </div>
                }
              />
            );

            const privateTimeline = (
              <Timeline
                title="dorr (private)"
                side="private"
                icon={<Lock className="size-3.5" />}
                revealed={privRevealed}
                steps={result.privateRun.steps}
                badge={
                  <Badge variant="outline-success" className="text-[9px] h-4">
                    bot sees a hash
                  </Badge>
                }
                outcome={
                  <div className="rounded-md border border-success/50 bg-success/10 px-2.5 py-2 flex items-center gap-2">
                    <ShieldCheck className="size-4 text-success shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-success uppercase tracking-wide">
                        Attack failed
                      </div>
                      <div className="font-mono text-[11px] text-success tabular-nums">
                        {cracks} cracks · $0.00 lost
                      </div>
                    </div>
                  </div>
                }
              />
            );

            return (
              <>
                {/*
                  The two runs are meant to be read against each other, and the
                  steps are different lengths, so a fixed 50/50 split always
                  squeezes one of them — let the presenter drag the divider.
                */}
                {/* The group sets an inline `display: flex`, so a `hidden`
                    class on it can never win — gate it from a wrapper. */}
                <div className="hidden md:block min-h-[400px]">
                  <ResizablePanelGroup
                    direction="horizontal"
                    className="rounded-lg border bg-muted/10"
                  >
                    <ResizablePanel defaultSize={50} minSize={22} className="!overflow-y-auto p-3">
                      {publicTimeline}
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize={50} minSize={22} className="!overflow-y-auto p-3">
                      {privateTimeline}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>

                {/* Dragging a divider is a poor fit on a phone — stack instead. */}
                <div className="md:hidden space-y-3">
                  {publicTimeline}
                  {privateTimeline}
                </div>
              </>
            );
          })()}

          {/* the proof: 0 / 25,000 brute-force matches — made prominent */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary shrink-0" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                brute-force preimage attack (real SHA-256)
              </span>
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-3xl font-bold tabular-nums text-success leading-none">
                {result.privateRun.bruteForceMatches.toLocaleString()}
                <span className="text-muted-foreground"> / </span>
                {result.privateRun.bruteForceAttempts.toLocaleString()}
              </span>
              <span className="text-[11px] text-muted-foreground">
                commitment cracks — the 128-bit nonce makes the search space 2¹²⁸ (infeasible)
              </span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground break-all">
              commitment {result.privateRun.commitmentHash.slice(0, 22)}…
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed pt-0.5">{result.headline}</p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * The batch-auction demo body. On "RUN" it calls `operator.batchDemo` and shows
 * the structural anti-MEV result: under uniform-price clearing a bot's front-run +
 * back-run settle at the SAME price, so the sandwich nets $0 — versus the identical
 * sandwich on a sequential venue, which profits the bot. The epoch's orders are all
 * stamped with one clearing price. This is "impossible", not merely "hidden".
 */
export function BatchAuctionBody() {
  const { selectedMarketId } = useMarketSelection();
  const { data: markets } = useMarkets();
  const [side, setSide] = useState<Side>("LONG");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchDemo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const symbol = markets?.find((m) => m.id === selectedMarketId)?.symbol ?? selectedMarketId;
  const base = selectedMarketId.split("-")[0];

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await operator.batchDemo({ marketId: selectedMarketId, side, marginUsd: 1000, leverage: 10 });
      setResult(res);
    } catch (e: any) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Bullet variant="default" />
          batch auction
        </div>
        <h2 className="text-2xl font-display leading-none flex items-center gap-2">
          <Scale className="size-5 text-primary" /> One price for the whole epoch
        </h2>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MarketIcon base={base} size={14} />
          Every order in an epoch clears at a single uniform price on {symbol}. A bot that inserts itself pays
          the same price as its victim — the sandwich nets $0, <span className="text-primary">by construction</span>.
        </p>
      </div>

      {/* controls */}
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg flex-1 max-w-[200px]">
          {(["LONG", "SHORT"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "py-1.5 text-xs font-medium rounded-md transition-colors",
                side === s
                  ? s === "LONG"
                    ? "bg-success text-white"
                    : "bg-destructive text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Button onClick={run} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
          Run batch
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {error} — is the operator running?
        </div>
      )}

      {!result && !error && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          Run the batch auction to see a sandwich earn $0 under uniform-price clearing — next to the identical
          sandwich on a sequential venue, which profits the bot.
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* the money shot: batch $0 vs sequential $X */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-success/50 bg-success/5 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
                <Scale className="size-3.5" /> dorr batch auction
              </div>
              <div className="font-mono text-3xl font-bold tabular-nums text-success leading-none">
                {formatUsd(result.attack.botProfitUsd)}
              </div>
              <div className="text-[11px] text-muted-foreground leading-snug">
                bot sandwich profit — front-run & back-run clear at the <span className="text-success">same price</span>
              </div>
            </div>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
                <Eye className="size-3.5" /> sequential DEX
              </div>
              <div className="font-mono text-3xl font-bold tabular-nums text-destructive leading-none">
                {formatUsd(result.sequential.botProfitUsd)}
              </div>
              <div className="text-[11px] text-muted-foreground leading-snug">
                identical sandwich — victim overpays {formatUsd(Math.abs(result.sequential.victimExtraCostUsd))}
              </div>
            </div>
          </div>

          {/* the epoch — every order at one clearing price */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                epoch · {result.epoch.orders.length} orders
              </span>
              <Badge variant="outline" className="text-[9px] h-4">
                clears @ {result.epoch.clearingPrice.toFixed(6)}
              </Badge>
            </div>
            <div className="space-y-1">
              {result.epoch.orders.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {o.side === "LONG" ? (
                      <TrendingUp className="size-3 text-success shrink-0" />
                    ) : (
                      <TrendingDown className="size-3 text-destructive shrink-0" />
                    )}
                    <span className="text-muted-foreground truncate">{o.commitment}</span>
                  </span>
                  <span className="shrink-0">
                    {o.sizeBase.toFixed(2)} {base} @{" "}
                    <span className="text-primary font-semibold">{result.epoch.clearingPrice.toFixed(6)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground pt-0.5 border-t border-border/50">
              {result.epoch.matchedBase.toFixed(2)} {base} crossed internally (zero impact) · net imbalance{" "}
              {result.epoch.netImbalanceBase.toFixed(2)} · {result.epoch.impactBps.toFixed(1)} bps
            </div>
          </div>

          <p className="text-xs text-foreground/90 leading-relaxed">{result.headline}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The combined hackathon demo dialog, launched from the navbar. Three tabs:
 * "Attack Lab" (animated live sandwich attempt — the headline), "Batch" (uniform-
 * price clearing makes the sandwich net $0), and "A/B" (side-by-side outcome).
 * Works with no wallet (pure demo).
 */
/**
 * The sealed-bid body. On "RUN" it calls `operator.sealedDemo` and shows the
 * order timelock-sealed to a drand round — proof the OPERATOR itself cannot read
 * it until the batch is frozen — then the epoch clearing at one uniform price.
 */
export function SealedBidBody() {
  const { selectedMarketId } = useMarketSelection();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SealedDemo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      setResult(await operator.sealedDemo({ marketId: selectedMarketId, side: "LONG", marginUsd: 1000, leverage: 10 }));
    } catch (e: any) {
      setErr(humanizeError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <EyeOff className="size-3.5 text-primary" /> Sealed-bid · real privacy from the operator
      </div>
      <h3 className="text-lg font-display flex items-center gap-2">
        <Lock className="size-4 text-primary" /> THE OPERATOR CAN&apos;T SEE YOUR ORDER
      </h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Your order is <span className="text-foreground">timelock-encrypted to a future drand round</span> — the League of
        Entropy, a live 12-of-22 threshold network. The operator holds only ciphertext + a hash and{" "}
        <span className="text-primary">physically cannot decrypt it</span> until that round&apos;s beacon lands — by which
        time the batch is frozen. Then the whole epoch clears at one price, so front-running is impossible even for the operator.
      </p>

      <Button onClick={run} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}
        {loading ? "Sealing to drand…" : "Seal an order"}
      </Button>

      {err && <div className="text-xs text-destructive">{err}</div>}

      {result && (
        <div className="space-y-3">
          {/* live drand + sealed order */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Radio className="size-3 text-primary animate-pulse" /> drand {result.drand.network} · round {result.drand.currentRound} · {result.drand.periodSec}s
              </span>
              <span className="flex items-center gap-1 text-primary">
                <Clock className="size-3" /> opens in ~{result.sealed.secondsUntilOpen}s
              </span>
            </div>
            <div className="font-mono text-[11px] break-all text-foreground/80">
              <span className="text-muted-foreground">sealed → round {result.sealed.targetRound}:</span> {result.sealed.ciphertextPreview}
              <span className="text-muted-foreground"> ({result.sealed.ciphertextBytes} bytes)</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-2 py-1.5">
              <ShieldCheck className="size-3.5 text-success shrink-0" />
              <span className="text-[11px] text-foreground/90">
                Operator tried to read it now → <span className="text-success font-semibold">REFUSED</span>:{" "}
                <span className="font-mono text-[10px] text-muted-foreground">{result.sealed.blindReason}</span>
              </span>
            </div>
          </div>

          {/* epoch clears at one price */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Scale className="size-3.5" /> epoch cleared · one uniform price
              </span>
              <span className="font-mono text-sm text-foreground">{result.epoch.clearingPrice.toFixed(6)}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {result.epoch.orders.map((o, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-border/60 bg-muted/20 px-2 py-1 text-[10px] font-mono">
                  <span className={cn("uppercase", o.side === "LONG" ? "text-success" : "text-destructive")}>
                    {o.label}
                  </span>
                  <span className="text-muted-foreground">{o.commitment}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1">
              <span>batch root {result.epoch.membershipRoot.slice(0, 14)}…</span>
              <span className="text-success">bot profit ${result.attack.botProfitUsd.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-2">
            {result.headline}
          </p>
        </div>
      )}
    </div>
  );
}

export function DemoShowcase() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("attack");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <span className="text-sm leading-none">⚔️</span>
          <span className="hidden sm:inline">Attack Lab</span>
        </Button>
      </DialogTrigger>
      {/*
        The lab is the demo's centrepiece and its output is long (two attack
        timelines plus the brute-force proof). Bound it to the viewport and let
        the body scroll, rather than letting the dialog grow past the top and
        bottom of the screen — which is exactly what it did at 2xl.
      */}
      {/* flex, not grid: the sr-only title/description are children too, so a
          fixed grid-rows template would put the tabs in an implicit row. */}
      <DialogContent
        className="!max-w-[min(96vw,1120px)] w-[min(96vw,1120px)] h-[86vh] max-h-[880px] !flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton
      >
        <DialogTitle className="sr-only">dorr MEV Attack Lab</DialogTitle>
        <DialogDescription className="sr-only">
          Run a sandwich attack against a transparent DEX and watch the same attack fail against dorr — plus the
          uniform-price batch auction and a side-by-side A/B comparison.
        </DialogDescription>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="gap-0 min-h-0 flex-1 flex flex-col"
        >
          {/* pr-10 keeps the last tab clear of the absolutely-positioned close button */}
          <TabsList className="w-full rounded-none border-b bg-transparent p-2 pr-10">
            <TabsTrigger value="attack" className="gap-1.5">
              <Swords className="size-3.5" /> Attack Lab
            </TabsTrigger>
            <TabsTrigger value="sealed" className="gap-1.5">
              <Lock className="size-3.5" /> Sealed
            </TabsTrigger>
            <TabsTrigger value="batch" className="gap-1.5">
              <Scale className="size-3.5" /> Batch
            </TabsTrigger>
            <TabsTrigger value="ab" className="gap-1.5">
              <Eye className="size-3.5" /> A/B
            </TabsTrigger>
          </TabsList>
          {/* Each tab owns its own scroll region so the dialog chrome stays put. */}
          <TabsContent value="attack" className="flex-1 min-h-0 overflow-hidden">
            <AttackLabBody />
          </TabsContent>
          <TabsContent value="sealed" className="flex-1 min-h-0 overflow-y-auto p-4">
            <SealedBidBody />
          </TabsContent>
          <TabsContent value="batch" className="flex-1 min-h-0 overflow-y-auto p-4">
            <BatchAuctionBody />
          </TabsContent>
          <TabsContent value="ab" className="flex-1 min-h-0 overflow-y-auto p-4">
            <AbShowcaseBody />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
