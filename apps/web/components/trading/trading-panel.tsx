"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn, formatUsd } from "@/lib/core";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Lock,
  Eye,
  ShieldCheck,
  Copy,
  Zap,
  Gauge,
  Radio,
  ChevronRight,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { WalletConnectButton } from "./wallet-connect-button";
import { JobProgress } from "./job-progress";
import { MarketIcon } from "./market-icon";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useMarketSelection } from "@/context/market-context";
import { useAccount, useJob, useMarket, useInvalidateTrading } from "@/hooks/use-operator";
import { operator, type CommitResult, type OrderType, type PrivacyMode, type Side } from "@/lib/operator";
import { sealOrderClient } from "@/lib/seal";

type Phase =
  | "idle"
  | "committing"
  | "commit-job"
  | "executing"
  | "execute-job"
  | "sealing"
  | "sealed"
  | "done"
  | "rested"
  | "error";

export default function TradingPanel() {
  const [side, setSide] = useState<Side>("LONG");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [margin, setMargin] = useState("");
  const [leverage, setLeverage] = useState(2);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("private");
  const [sealMode, setSealMode] = useState(false);
  const [sealedInfo, setSealedInfo] = useState<{ round: number; secondsToOpen: number } | null>(null);
  const [limitPrice, setLimitPrice] = useState("");
  const [limitTouched, setLimitTouched] = useState(false);
  const [slippageBps, setSlippageBps] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [executeJobId, setExecuteJobId] = useState<string | undefined>();
  const [fill, setFill] = useState<{ entryPrice: number; sizeBase: number } | null>(null);
  const executeStarted = useRef(false);
  // The order type of the in-flight commit — limit orders rest (no auto-execute).
  const committedType = useRef<OrderType>("market");

  const { connected, address } = useDorrWallet();
  const { selectedMarketId } = useMarketSelection();
  const { market } = useMarket(selectedMarketId);
  const { data: account } = useAccount(address);
  const invalidate = useInvalidateTrading();

  // Poll both jobs whenever they exist — useJob stops itself once a job settles,
  // and keeping the commit pipeline mounted preserves the full proof story on screen.
  const commitJob = useJob(commit?.jobId);
  const execJob = useJob(executeJobId);

  const maxLeverage = market?.maxLeverage ?? 20;
  const markPrice = market?.markPrice ?? market?.indexPrice ?? null;
  const marginNum = parseFloat(margin) || 0;
  const limitNum = parseFloat(limitPrice) || 0;
  const slippageNum = parseFloat(slippageBps) || 0;
  const isLimit = orderType === "limit";
  // Sizing uses the price the fill will reference: the limit price for limit
  // orders, otherwise the live mark.
  const refPrice = isLimit ? limitNum || markPrice : markPrice;
  const estSize = refPrice && marginNum > 0 ? (marginNum * leverage) / refPrice : 0;
  const busy =
    phase !== "idle" && phase !== "done" && phase !== "error" && phase !== "rested" && phase !== "sealed";

  // Default the limit price to the live mark until the user edits it (and keep it
  // tracking the mark while untouched, so it never goes stale before the first edit).
  useEffect(() => {
    if (!limitTouched && markPrice != null) setLimitPrice(String(markPrice));
  }, [markPrice, limitTouched]);

  // Numbered leverage stops (like the original), capped by the market's max leverage.
  // Four stops, not nine. The slider already covers every value in between, so
  // extra chips only add scan cost — and wrap onto a second row at rail width.
  const leverageStops = useMemo(() => {
    const base = [2, 5, 10, 20, 50];
    const stops = base.filter((v) => v <= maxLeverage);
    if (!stops.includes(maxLeverage)) stops.push(maxLeverage);
    return stops.slice(-4);
  }, [maxLeverage]);

  // Clamp leverage if the market changes to a lower cap.
  useEffect(() => {
    if (leverage > maxLeverage) setLeverage(maxLeverage);
  }, [maxLeverage, leverage]);

  // When the commit job completes → execute the order (once).
  useEffect(() => {
    if (phase !== "commit-job" || !commit || !commitJob.data) return;
    if (commitJob.data.status === "error") {
      setPhase("error");
      toast.error("Commit failed", { description: commitJob.data.error });
      return;
    }
    if (commitJob.data.status === "complete" && !executeStarted.current) {
      executeStarted.current = true;
      // Limit orders rest until the (hidden) trigger price is crossed by the
      // keeper — do NOT auto-execute; they surface in the resting-orders panel.
      if (committedType.current === "limit") {
        setPhase("rested");
        invalidate(address);
        toast.success("Limit order resting", {
          description: "Hidden from the public feed until your price is hit.",
        });
        return;
      }
      setPhase("executing");
      operator
        .executeOrder(commit.orderId)
        .then((res) => {
          setExecuteJobId(res.jobId);
          setFill({ entryPrice: res.position.entryPrice, sizeBase: res.position.sizeBase });
          setPhase("execute-job");
        })
        .catch((e) => {
          setPhase("error");
          toast.error("Execute failed", { description: String(e?.message ?? e) });
        });
    }
  }, [phase, commit, commitJob.data]);

  // When the execute job settles → done.
  useEffect(() => {
    if (phase !== "execute-job" || !execJob.data) return;
    if (execJob.data.status === "complete") {
      setPhase("done");
      invalidate(address);
      toast.success(`${side} position opened`, {
        description: fill ? `${fill.sizeBase.toFixed(4)} ${market?.base ?? ""} @ ${formatUsd(fill.entryPrice)}` : undefined,
      });
    } else if (execJob.data.status === "error") {
      setPhase("error");
      toast.error("Execution failed", { description: execJob.data.error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, execJob.data?.status]);

  const handleSubmit = async () => {
    if (!connected || !address) {
      toast.error("Connect a wallet first.");
      return;
    }
    if (!market) {
      toast.error("Market data unavailable — is the operator running?");
      return;
    }
    if (!(marginNum > 0)) {
      toast.error("Enter a margin amount.");
      return;
    }
    if (account && marginNum > account.free) {
      toast.error(`Insufficient free balance (${formatUsd(account.free)} FXRP).`, {
        description: "Deposit FXRP into the vault from the Collateral panel.",
      });
      return;
    }
    if (isLimit && !(limitNum > 0)) {
      toast.error("Enter a limit price.");
      return;
    }

    // ── SEALED path: the browser timelock-encrypts the order to a drand round, so
    // the operator only ever receives ciphertext — it can't read (or front-run) it.
    if (sealMode && privacyMode === "private" && !isLimit) {
      const px = refPrice ?? 0;
      if (!(px > 0) || !(estSize > 0)) {
        toast.error("Waiting for a live price — try again in a moment.");
        return;
      }
      setPhase("sealing");
      setSealedInfo(null);
      try {
        const epoch = await operator.batchEpoch();
        const { commitment, ciphertext } = await sealOrderClient(
          { marketId: market.id, side, sizeBase: estSize, leverage, marginUsd: marginNum, price: px },
          epoch.epochCloseRound,
        );
        await operator.sealOrder({
          address,
          marketId: market.id,
          commitment,
          ciphertext,
          targetRound: epoch.epochCloseRound,
          maxMarginUsd: marginNum,
        });
        setSealedInfo({ round: epoch.epochCloseRound, secondsToOpen: epoch.secondsToClose });
        setPhase("sealed");
        invalidate(address);
        toast.success("Order sealed to drand — the operator can't read it", {
          description: `Unseals at round ${epoch.epochCloseRound} (~${epoch.secondsToClose}s); your position opens when the epoch clears.`,
        });
      } catch (e: any) {
        setPhase("error");
        toast.error("Seal failed", { description: String(e?.message ?? e) });
      }
      return;
    }

    setPhase("committing");
    setCommit(null);
    setExecuteJobId(undefined);
    setFill(null);
    executeStarted.current = false;
    committedType.current = orderType;
    try {
      const res = await operator.commitOrder({
        address,
        marketId: market.id,
        side,
        marginUsd: marginNum,
        leverage,
        privacyMode,
        orderType,
        ...(isLimit ? { limitPrice: limitNum } : {}),
        ...(!isLimit && slippageNum > 0 ? { maxSlippageBps: slippageNum } : {}),
      });
      setCommit(res);
      setPhase("commit-job");
      invalidate(address);
    } catch (e: any) {
      setPhase("error");
      toast.error("Order commit failed", { description: String(e?.message ?? e) });
    }
  };

  const reset = () => {
    setPhase("idle");
    setCommit(null);
    setExecuteJobId(undefined);
    setFill(null);
    setSealedInfo(null);
    executeStarted.current = false;
    setMargin("");
    // Re-arm the limit price to track the live mark again for the next order.
    setLimitTouched(false);
    setSlippageBps("");
  };

  const leverPct = ((leverage - 1) / (maxLeverage - 1)) * 100;

  return (
    <Card className="flex flex-col">
      <PanelHeader
        title={isLimit ? "Limit order" : "Market order"}
        bullet={side === "LONG" ? "success" : "destructive"}
        action={
          <span className="flex items-center gap-1.5 text-xs font-mono text-foreground">
            <MarketIcon base={market?.base} size={16} />
            {market?.symbol ?? selectedMarketId}
          </span>
        }
      />
      <CardContent className="space-y-4">
        {/* LONG/SHORT toggle */}
        <div className="relative p-1 bg-muted rounded-lg">
          <motion.div
            className={cn(
              "absolute top-1 bottom-1 w-[calc(50%-2px)] rounded-md",
              side === "LONG" ? "bg-success" : "bg-destructive",
            )}
            initial={false}
            animate={{ x: side === "LONG" ? 0 : "calc(100% + 4px)" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
          <div className="relative grid grid-cols-2 gap-1">
            {(["LONG", "SHORT"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setSide(option)}
                disabled={busy}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-bold uppercase tracking-wide rounded-md transition-colors duration-200",
                  side === option ? "text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "LONG" ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {option}
              </button>
            ))}
          </div>
        </div>

        {/* Market / Limit order-type toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
          {(["market", "limit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              disabled={busy}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors",
                orderType === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                busy && "opacity-50 cursor-not-allowed",
              )}
            >
              {t === "market" ? <Zap className="size-3.5" /> : <Gauge className="size-3.5" />}
              <span className="capitalize">{t}</span>
            </button>
          ))}
        </div>

        {/* Privacy toggle — the dorr hero */}
        <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary">
            <ShieldCheck className="size-3.5" /> Privacy mode
          </div>
          <div className="relative p-1 bg-muted rounded-lg">
            <motion.div
              className={cn(
                "absolute top-1 bottom-1 w-[calc(50%-2px)] rounded-md",
                privacyMode === "private" ? "bg-primary" : "bg-destructive",
              )}
              initial={false}
              animate={{ x: privacyMode === "private" ? 0 : "calc(100% + 4px)" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
            <div className="relative grid grid-cols-2 gap-1">
              <button
                onClick={() => setPrivacyMode("private")}
                disabled={busy}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-md transition-colors",
                  privacyMode === "private" ? "text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Lock className="size-3.5" /> Private
              </button>
              <button
                onClick={() => setPrivacyMode("public")}
                disabled={busy}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-md transition-colors",
                  privacyMode === "public" ? "text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Eye className="size-3.5" /> Public foil
              </button>
            </div>
          </div>
          <p
            className="text-[10px] text-muted-foreground leading-snug"
            title={
              privacyMode === "private"
                ? "Side, size and leverage stay hidden until settlement — bots can't front-run what they can't see."
                : "Foil mode leaks your full order to the public feed, like a transparent DEX, so you can watch it get front-run."
            }
          >
            {privacyMode === "private" ? (
              <>The public sees only a hash.</>
            ) : (
              <span className="text-destructive">Your full order is broadcast.</span>
            )}
          </p>

          {/* Sealed-bid: timelock-seal client-side so even the operator can't read it */}
          {privacyMode === "private" && !isLimit && (
            <div
              className={cn(
                "mt-2 flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                sealMode ? "border-primary/50 bg-primary/5" : "border-border",
              )}
            >
              <Switch checked={sealMode} onCheckedChange={setSealMode} disabled={busy} className="mt-0.5" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Radio className={cn("size-3.5", sealMode ? "text-primary" : "text-muted-foreground")} />
                  Seal from the operator (drand timelock)
                </div>
                <p
                  className="text-[10px] text-muted-foreground leading-snug"
                  title="Your browser encrypts the order to a future drand round. The operator holds only ciphertext and cannot read it until the batch freezes, then the whole epoch clears at one uniform price."
                >
                  Encrypted in your browser — even the operator can&apos;t read it.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Margin */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="margin" className="text-xs">
              Margin (FXRP)
            </Label>
            <div className="flex gap-1">
              {[100, 500, 1000, 5000].map((amount) => (
                <Button
                  key={amount}
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs font-mono"
                  disabled={busy}
                  onClick={() => setMargin(String(amount))}
                >
                  {amount >= 1000 ? `${amount / 1000}k` : amount}
                </Button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Input
              id="margin"
              placeholder="0"
              inputMode="decimal"
              className="pr-14 font-mono"
              disabled={!connected || busy}
              value={margin}
              // Margin is a positive decimal amount: keep letters, signs and stray
              // separators out of the field rather than letting them fall through to
              // a NaN that silently disables the button with no explanation.
              onChange={(e) => {
                const next = e.target.value;
                if (next === "" || /^\d*\.?\d*$/.test(next)) setMargin(next);
              }}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              FXRP
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Free balance</span>
            <span className="font-mono">
              {account ? `${formatUsd(account.free)} FXRP` : connected ? "…" : "—"}
            </span>
          </div>
        </div>

        {/* Limit price (limit orders) — defaults to the live mark */}
        {isLimit && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="limit-price" className="text-xs">
                Limit price (FXRP)
              </Label>
              <button
                type="button"
                disabled={busy || markPrice == null}
                onClick={() => {
                  if (markPrice != null) {
                    setLimitPrice(String(markPrice));
                    setLimitTouched(true);
                  }
                }}
                className="text-[10px] font-mono text-primary hover:underline disabled:opacity-50"
              >
                mark {formatUsd(markPrice)}
              </button>
            </div>
            <div className="relative">
              <Input
                id="limit-price"
                placeholder="0"
                inputMode="decimal"
                className="pr-14 font-mono"
                disabled={!connected || busy}
                value={limitPrice}
                onChange={(e) => {
                  setLimitTouched(true);
                  setLimitPrice(e.target.value);
                }}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                FXRP
              </div>
            </div>
            <p
              className="text-[10px] text-muted-foreground leading-snug"
              title="The order waits off the public feed and fills only when the mark crosses your price, so no one can see or front-run the trigger."
            >
              Rests hidden until the mark crosses it.
            </p>
          </div>
        )}

        {/* Slippage tolerance (market orders) — optional guard, collapsed by default */}
        {!isLimit && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className={cn("size-3 transition-transform", showAdvanced && "rotate-90")} />
              Advanced
              {slippageNum > 0 && (
                <span className="ml-auto font-mono text-[10px] text-foreground normal-case tracking-normal">
                  max slip {(slippageNum / 100).toFixed(2)}%
                </span>
              )}
            </button>
          </div>
        )}

        {!isLimit && showAdvanced && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="slippage"
                className="text-xs"
                title="If the fill would move worse than this versus the index, the order is rejected and left resting instead of filling at a bad price."
              >
                Max slippage
                <span className="ml-1 text-muted-foreground normal-case">(optional)</span>
              </Label>
              <div className="flex gap-1">
                {[10, 30, 50, 100].map((bps) => (
                  <Button
                    key={bps}
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs font-mono"
                    disabled={busy}
                    onClick={() => setSlippageBps(String(bps))}
                  >
                    {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                  </Button>
                ))}
              </div>
            </div>
            <div className="relative">
              <Input
                id="slippage"
                placeholder="unbounded"
                inputMode="decimal"
                className="pr-12 font-mono"
                disabled={!connected || busy}
                value={slippageBps}
                onChange={(e) => setSlippageBps(e.target.value)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                bps
              </div>
            </div>
          </div>
        )}

        {/* Leverage — gradient slider + numbered stops (restored premium interaction) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Leverage</Label>
            <motion.span
              key={leverage}
              initial={{ scale: 1.2, opacity: 0.8 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="text-xs font-mono font-bold text-primary"
            >
              {leverage}x
            </motion.span>
          </div>

          <div className="relative">
            <div className="h-2 bg-muted rounded-full relative overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-success via-warning to-destructive rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(4, leverPct)}%` }}
              />
            </div>
            <div
              className="pointer-events-none absolute top-1 -translate-y-1/2 size-4 bg-white border-2 border-primary rounded-full shadow-lg transition-[left] duration-300 ease-out"
              style={{ left: `${leverPct}%`, marginLeft: "-8px" }}
            />
            {/* invisible native range for drag/keyboard a11y */}
            <input
              type="range"
              min={1}
              max={maxLeverage}
              step={1}
              value={leverage}
              disabled={busy}
              onChange={(e) => setLeverage(Number(e.target.value))}
              aria-label="Leverage"
              className="absolute inset-0 -top-1 h-4 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          </div>

          <div className="flex flex-wrap justify-between gap-1">
            {leverageStops.map((option) => (
              <motion.button
                key={option}
                onClick={() => setLeverage(option)}
                disabled={busy}
                className={cn(
                  "text-[11px] font-mono px-1.5 py-0.5 rounded transition-all duration-200",
                  leverage === option
                    ? "text-white font-bold bg-primary"
                    : "text-muted-foreground hover:text-primary hover:bg-muted",
                  busy && "opacity-50 cursor-not-allowed",
                )}
                whileHover={busy ? {} : { scale: 1.08 }}
                whileTap={busy ? {} : { scale: 0.95 }}
              >
                {option}x
              </motion.button>
            ))}
          </div>
        </div>

        {/* Order summary */}
        {marginNum > 0 && (
          <div className="space-y-1 text-xs p-3 bg-muted/40 rounded-lg border border-border/60">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Notional</span>
              <span className="font-mono font-semibold">{formatUsd(marginNum * leverage)} FXRP</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. size ({market?.base ?? "…"})</span>
              <span className="font-mono">{estSize ? estSize.toFixed(4) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{isLimit ? "Limit price" : "Mark price"}</span>
              <span className="font-mono">{formatUsd(isLimit ? limitNum || null : markPrice)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction</span>
              <span className={cn("font-mono font-semibold", side === "LONG" ? "text-success" : "text-destructive")}>
                {side}
              </span>
            </div>
          </div>
        )}

        {/* Submit / wallet */}
        {!connected ? (
          <WalletConnectButton className="w-full" />
        ) : phase === "done" || phase === "error" || phase === "rested" || phase === "sealed" ? (
          <Button onClick={reset} variant="outline" className="w-full">
            New order
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={busy || !marginNum || !market || (isLimit && !(limitNum > 0))}
            size="lg"
            className={cn(
              "w-full transition-all duration-300",
              side === "LONG" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90",
              "text-white disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : side === "LONG" ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            {phase === "sealing"
              ? "Sealing to drand…"
              : phase === "committing"
                ? "Committing…"
                : phase === "commit-job"
                  ? "Proving commitment…"
                  : phase === "executing" || phase === "execute-job"
                    ? "Executing fill…"
                    : isLimit
                      ? `Place limit ${side.toLowerCase()} ${privacyMode === "private" ? "privately" : "publicly"}`
                      : sealMode && privacyMode === "private"
                        ? `Seal ${side.toLowerCase()} — operator-blind`
                        : `${side} ${market?.base ?? ""} ${privacyMode === "private" ? "privately" : "publicly"}`}
          </Button>
        )}

        {/* Sealed — the operator holds ciphertext it can't read until the round lands */}
        {phase === "sealed" && sealedInfo && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Lock className="size-3.5" /> Sealed from the operator
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Your order is timelock-encrypted to <span className="text-foreground font-mono">drand round {sealedInfo.round}</span>.
              The operator holds only ciphertext — it <span className="text-primary">can&apos;t read it</span> for ~{sealedInfo.secondsToOpen}s.
              When the beacon lands, the epoch clears at one uniform price and your position opens.
            </p>
          </motion.div>
        )}

        {/* Commitment hash — what the world sees */}
        {commit && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-lg border p-3 space-y-1.5",
              privacyMode === "private" ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5",
            )}
          >
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              {privacyMode === "private" ? "This is ALL the public sees" : "Commitment (but foil mode leaked everything)"}
            </div>
            <button
              className="font-mono text-xs break-all text-left text-foreground/90 hover:text-primary transition-colors inline-flex items-start gap-1"
              onClick={() => {
                navigator.clipboard.writeText(commit.commitmentHash);
                toast.success("Commitment hash copied");
              }}
              title={commit.commitmentHash}
            >
              <span>{commit.commitmentHash}</span>
              <Copy className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
            </button>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>size {commit.sizeBase.toFixed(4)}</span>
              <span>commit @ {formatUsd(commit.commitPrice)}</span>
            </div>
          </motion.div>
        )}

        {/* Live proof pipeline — hero moment */}
        {(phase === "commit-job" ||
          phase === "executing" ||
          phase === "execute-job" ||
          phase === "done" ||
          (phase === "error" && (commitJob.data || execJob.data))) && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
            {commitJob.data && <JobProgress job={commitJob.data} title="commit · sealed-order pipeline" />}
            {phase === "executing" && !execJob.data && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> submitting execution…
              </div>
            )}
            {execJob.data && <JobProgress job={execJob.data} title="execute · match + fill" />}
          </div>
        )}

        {/* Fill confirmation */}
        {phase === "done" && fill && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg border border-success/50 bg-success/5 p-3 text-xs space-y-1"
          >
            <div className="font-semibold text-success">Position opened</div>
            <div className="flex justify-between font-mono">
              <span>
                {fill.sizeBase.toFixed(4)} {market?.base}
              </span>
              <span>@ {formatUsd(fill.entryPrice)} FXRP</span>
            </div>
          </motion.div>
        )}

        {/* Resting limit-order confirmation */}
        {phase === "rested" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg border border-primary/50 bg-primary/5 p-3 text-xs space-y-1.5"
          >
            <div className="flex items-center gap-1.5 font-semibold text-primary">
              <Lock className="w-3.5 h-3.5" /> Limit order resting
            </div>
            <div className="flex justify-between font-mono text-muted-foreground">
              <span>
                {side} {estSize ? estSize.toFixed(4) : "—"} {market?.base}
              </span>
              <span>@ {formatUsd(limitNum || null)} FXRP</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Hidden from the public feed. It fills automatically when the mark crosses your price — track it
              in <span className="text-primary font-semibold">Resting orders</span>.
            </p>
          </motion.div>
        )}

        {leverage > 10 && phase === "idle" && (
          <div className="flex items-start gap-2 p-2.5 bg-warning/10 border border-warning/30 rounded-lg text-[11px] text-warning">
            <Badge variant="outline-warning" className="text-[9px] h-4 shrink-0">
              risk
            </Badge>
            <span>
              {leverage}x leverage — a {(100 / leverage).toFixed(1)}% adverse move liquidates you.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
