"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bullet } from "@/components/ui/bullet";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import {
  Loader2,
  Swords,
  Eye,
  Lock,
  TrendingDown,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { cn, formatUsd, humanizeError } from "@/lib/core";
import { useMarketSelection } from "@/context/market-context";
import { useMarkets } from "@/hooks/use-operator";
import { operator, type AbDemo, type Side } from "@/lib/operator";

export function Stat({
  label,
  value,
  tone = "default",
  big = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "good";
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          big ? "text-base font-bold" : "text-xs",
          tone === "danger" && "text-destructive",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The A/B sandwich body — the front-running showcase without any dialog chrome,
 * so it can be embedded inside the combined demo dialog's "A/B" tab as well as
 * its own standalone dialog.
 */
export function AbShowcaseBody() {
  const { selectedMarketId } = useMarketSelection();
  const { data: markets } = useMarkets();
  const [side, setSide] = useState<Side>("LONG");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AbDemo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const symbol = markets?.find((m) => m.id === selectedMarketId)?.symbol ?? selectedMarketId;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await operator.abDemo({
        marketId: selectedMarketId,
        side,
        marginUsd: 1000,
        leverage: 5,
      });
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
              <Bullet variant="destructive" />
              front-running showcase
            </div>
            <h2 className="text-2xl font-display leading-none">The sandwich attack, A/B tested</h2>
            <p className="text-xs text-muted-foreground">
              Same {formatUsd(1000, 0)} FXRP · 5x {side} on {symbol}. One on a transparent DEX, one on dorr.
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
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />}
              Run attack
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {error} — is the operator running?
            </div>
          )}

          {!result && !error && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              Run the attack to see what a front-running bot does to the same order on each venue.
            </div>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* PUBLIC — victim sandwiched */}
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                      <Eye className="size-3.5" /> Public DEX
                    </div>
                    <Badge variant="outline-destructive" className="text-[9px] h-4">
                      order visible to bot
                    </Badge>
                  </div>
                  <Stat label="Victim entry" value={formatUsd(result.public.victimEntry)} tone="danger" />
                  <Stat label="Bot front-run @" value={formatUsd(result.public.botFrontRunPrice)} />
                  <Separator />
                  <Stat
                    label="Extra cost"
                    value={`+$${result.public.victimExtraCostUsd.toFixed(2)}`}
                    tone="danger"
                    big
                  />
                  <Stat
                    label="Slippage"
                    value={`${result.public.victimSlippageBps.toFixed(1)} bps`}
                    tone="danger"
                  />
                  <Stat
                    label="Bot profit"
                    value={`$${result.public.botProfitUsd.toFixed(2)}`}
                    tone="danger"
                  />
                  <div className="flex items-center gap-1.5 text-[10px] text-destructive/80 pt-1">
                    <TrendingDown className="size-3" /> victim sandwiched
                  </div>
                </div>

                {/* PRIVATE — fair fill */}
                <div className="rounded-lg border border-success/50 bg-success/5 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-success">
                      <Lock className="size-3.5" /> dorr private
                    </div>
                    <Badge variant="outline-success" className="text-[9px] h-4">
                      bot is blind
                    </Badge>
                  </div>
                  <Stat label="Victim entry" value={formatUsd(result.private.victimEntry)} tone="good" />
                  <Stat label="Bot sees" value="hash only" />
                  <Separator />
                  <Stat label="Extra cost" value="$0.00" tone="good" big />
                  <Stat
                    label="Slippage"
                    value={`${result.private.victimSlippageBps.toFixed(1)} bps`}
                    tone="good"
                  />
                  <Stat label="Bot profit" value="$0.00" tone="good" />
                  <div className="flex items-center gap-1.5 text-[10px] text-success/90 pt-1">
                    <ShieldCheck className="size-3" /> {result.private.publicSees}
                  </div>
                </div>
              </div>

              {/* savings + headline */}
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-destructive line-through">
                    +${result.public.victimExtraCostUsd.toFixed(2)}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <span className="font-mono font-bold text-success">$0.00 with dorr</span>
                  <Badge variant="outline-success" className="ml-auto text-[10px]">
                    saved ${result.public.victimExtraCostUsd.toFixed(2)}
                  </Badge>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed">{result.headline}</p>
              </div>
            </motion.div>
          )}
        </div>
  );
}

/** Standalone A/B sandwich dialog (kept for direct use / backward-compat). */
export function SandwichShowcase() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Swords className="size-3.5" />
          <span className="hidden sm:inline">A/B sandwich</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        {/* The panel carries its own visual heading, so name the dialog for
            screen readers without duplicating it on screen. */}
        <DialogHeader className="sr-only">
          <DialogTitle>A/B sandwich showcase</DialogTitle>
          <DialogDescription>
            Run the same order publicly and privately to compare what a sandwich bot can extract.
          </DialogDescription>
        </DialogHeader>
        <AbShowcaseBody />
      </DialogContent>
    </Dialog>
  );
}
