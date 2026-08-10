"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ExternalLink, X, Briefcase, Plus, Minus, Target, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn, formatUsd } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { usePositions, useAccount, useJob, useInvalidateTrading } from "@/hooks/use-operator";
import { operator, type Position } from "@/lib/operator";
import { JobProgress } from "./job-progress";
import { MarketIcon } from "./market-icon";
import { DisclosureDialog } from "./disclosure";

const explorerTx = (h: string) => `https://coston2-explorer.flare.network/tx/${h}`;

function SideBadge({ side }: { side: Position["side"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "w-fit text-[10px] h-5 border-0 text-white",
        side === "LONG" ? "bg-green-600" : "bg-red-600",
      )}
    >
      {side}
    </Badge>
  );
}

function PnlCell({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-bold", value >= 0 ? "text-green-500" : "text-red-500")}>
      {value >= 0 ? "+" : ""}
      {formatUsd(value)}
    </span>
  );
}

/** Close-flow: settlement proof → Flare settlement, live. */
function CloseJobPanel({
  jobId,
  position,
  onDone,
}: {
  jobId: string;
  position: Position;
  onDone: () => void;
}) {
  const { data: job } = useJob(jobId);
  const invalidate = useInvalidateTrading();
  const { address } = useDorrWallet();

  useEffect(() => {
    if (job && job.status !== "running") {
      invalidate(address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  return (
    <div className="mx-4 my-2 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          closing {position.marketId} · settlement pipeline
        </span>
        <button onClick={onDone} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <JobProgress job={job} />
      {job?.status === "complete" && (
        <div className="text-[11px] text-green-500">settled — position closed</div>
      )}
    </div>
  );
}

/** 25 / 50 / 100% partial-close control. 100% = full close. */
function CloseControl({
  position,
  busy,
  onClose,
}: {
  position: Position;
  busy: boolean;
  onClose: (position: Position, fraction: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[0.25, 0.5, 1].map((f) => (
        <Button
          key={f}
          size="sm"
          variant="outline"
          className="h-6 px-1.5 text-[10px] font-mono"
          disabled={busy}
          onClick={() => onClose(position, f)}
          title={f === 1 ? "Close entire position" : `Close ${f * 100}% of the position`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : f === 1 ? "100%" : `${f * 100}%`}
        </Button>
      ))}
    </div>
  );
}

/** Add (+) / remove (−) margin via a small popover with an amount input. */
function MarginControl({
  position,
  freeBalance,
  onAdjusted,
}: {
  position: Position;
  freeBalance: number | undefined;
  onAdjusted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const amt = parseFloat(amount) || 0;

  const submit = async (sign: 1 | -1) => {
    if (!(amt > 0)) {
      toast.error("Enter an amount.");
      return;
    }
    setBusy(true);
    try {
      await operator.adjustMargin(position.id, sign * amt);
      toast.success(sign > 0 ? `Added ${formatUsd(amt)} FXRP margin` : `Removed ${formatUsd(amt)} FXRP margin`);
      setOpen(false);
      setAmount("");
      onAdjusted();
    } catch (e: any) {
      toast.error("Margin adjust failed", { description: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          title="Add or remove margin"
        >
          <Plus className="w-2.5 h-2.5" />
          <Minus className="w-2.5 h-2.5 -ml-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Adjust margin</Label>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Add to reduce liquidation risk, or withdraw excess back to free balance.
          </p>
        </div>
        <div className="relative">
          <Input
            placeholder="0"
            inputMode="decimal"
            className="pr-12 font-mono h-8 text-xs"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            FXRP
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>free {freeBalance != null ? formatUsd(freeBalance) : "—"}</span>
          <span>margin {formatUsd(position.marginUsd)}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs bg-success hover:bg-success/90 text-white"
            disabled={busy || !(amt > 0)}
            onClick={() => submit(1)}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy || !(amt > 0)}
            onClick={() => submit(-1)}
          >
            <Minus className="w-3 h-3" /> Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Set/clear the hidden stop-loss & take-profit for a position. */
function StopsControl({ position, onSaved }: { position: Position; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed inputs from the current (hidden) values whenever the popover opens.
  useEffect(() => {
    if (open) {
      setSl(position.stopLossPrice != null ? String(position.stopLossPrice) : "");
      setTp(position.takeProfitPrice != null ? String(position.takeProfitPrice) : "");
    }
  }, [open, position.stopLossPrice, position.takeProfitPrice]);

  const hasStops = position.stopLossPrice != null || position.takeProfitPrice != null;

  const save = async () => {
    const slNum = sl.trim() === "" ? null : parseFloat(sl);
    const tpNum = tp.trim() === "" ? null : parseFloat(tp);
    if (slNum !== null && !(slNum > 0)) {
      toast.error("Stop-loss must be a positive price (or blank to clear).");
      return;
    }
    if (tpNum !== null && !(tpNum > 0)) {
      toast.error("Take-profit must be a positive price (or blank to clear).");
      return;
    }
    setBusy(true);
    try {
      // Blank input → null (clears). Sending both keeps them explicit.
      await operator.setStops(position.id, { stopLoss: slNum, takeProfit: tpNum });
      toast.success("Stops updated", { description: "Trigger prices stay hidden from the public feed." });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error("Set stops failed", { description: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn("h-6 px-1.5 text-[10px]", hasStops && "border-primary/50 text-primary")}
          title="Set hidden stop-loss / take-profit"
        >
          <Target className="w-2.5 h-2.5" /> SL/TP
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Stop-loss / take-profit</Label>
            <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide text-primary">
              <EyeOff className="w-2.5 h-2.5" /> hidden
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Trigger prices are never published — no stop-hunting. Leave a field blank to clear it.
          </p>
        </div>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-destructive">Stop-loss (FXRP)</Label>
            <Input
              placeholder="none"
              inputMode="decimal"
              className="font-mono h-8 text-xs"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-success">Take-profit (FXRP)</Label>
            <Input
              placeholder="none"
              inputMode="decimal"
              className="font-mono h-8 text-xs"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <Button size="sm" className="h-7 w-full text-xs" disabled={busy} onClick={save}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save stops"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export default function Portfolio() {
  const [activeTab, setActiveTab] = useState<"open" | "closed">("open");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeJobs, setCloseJobs] = useState<Record<string, string>>({}); // positionId → jobId

  const { connected, address } = useDorrWallet();
  const { data: positions, isLoading, isError } = usePositions(address);
  const { data: account } = useAccount(address);
  const invalidate = useInvalidateTrading();

  const all = positions ?? [];
  const open = all.filter((p) => p.status === "open");
  const closed = all.filter((p) => p.status !== "open");
  const rows = activeTab === "open" ? open : closed;

  const totalUpnl = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const totalMargin = open.reduce((s, p) => s + p.marginUsd, 0);

  const handleClose = async (position: Position, fraction = 1) => {
    setClosingId(position.id);
    try {
      const res = await operator.closePosition(position.id, fraction);
      setCloseJobs((m) => ({ ...m, [position.id]: res.jobId }));
      invalidate(address);
    } catch (e: any) {
      toast.error("Close failed", { description: String(e?.message ?? e) });
    } finally {
      setClosingId(null);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <PanelHeader
        title="Positions"
        bullet={connected && totalUpnl >= 0 ? "success" : connected ? "destructive" : "default"}
        icon={<Briefcase className="size-3" />}
        action={
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wide text-[10px]">uPnL</span>
              <PnlCell value={connected ? totalUpnl : undefined} />
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-muted-foreground uppercase tracking-wide text-[10px]">margin</span>
              <span className="font-mono">{connected ? formatUsd(totalMargin, 0) : "—"}</span>
            </div>
          </div>
        }
      />

      <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* segmented tabs */}
        <div className="flex items-center gap-1 p-2 border-b border-border/60 sticky top-0 bg-card z-20">
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {(["open", "closed"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "relative px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="capitalize">{tab}</span>
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 px-1 text-[9px] font-mono tabular-nums"
                >
                  {(tab === "open" ? open : closed).length}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        {/* header row */}
        <div className="hidden lg:grid lg:grid-cols-11 gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/20">
          <span>Market</span>
          <span>Side</span>
          <span className="text-right">Size</span>
          <span className="text-right">Entry</span>
          <span className="text-right">{activeTab === "open" ? "Mark" : "Exit"}</span>
          <span className="text-right">{activeTab === "open" ? "Liq." : "Realized"}</span>
          <span className="text-right">{activeTab === "open" ? "uPnL" : ""}</span>
          <span className="text-right">Lev</span>
          <span className="text-right">Margin</span>
          <span className="col-span-2 text-right">{activeTab === "open" ? "Manage" : "Settlement"}</span>
        </div>

        {!connected ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            Connect a wallet to see your positions.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            Operator unreachable — positions will appear when it's back.
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            No {activeTab} positions.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="border-b border-border/50"
              >
                {/* desktop row */}
                <div className="hidden lg:grid lg:grid-cols-11 gap-2 px-4 py-3 text-xs font-mono items-center hover:bg-muted/30 transition-colors">
                  <span className="font-sans font-medium flex items-center gap-1.5">
                    <MarketIcon base={p.marketId.split("-")[0]} size={18} />
                    {p.marketId}
                  </span>
                  <SideBadge side={p.side} />
                  <span className="text-right">{p.sizeBase.toFixed(4)}</span>
                  <span className="text-right">{formatUsd(p.entryPrice)}</span>
                  <span className="text-right">
                    {activeTab === "open" ? formatUsd(p.markPrice) : formatUsd(p.exitPrice)}
                  </span>
                  {activeTab === "open" ? (
                    <span className="text-right text-warning" title="Liquidation price">
                      {formatUsd(p.liquidationPrice)}
                    </span>
                  ) : (
                    <span className="text-right">
                      <PnlCell value={p.realizedPnl} />
                    </span>
                  )}
                  <span className="text-right">
                    {activeTab === "open" ? <PnlCell value={p.unrealizedPnl} /> : null}
                  </span>
                  <span className="text-right">{p.leverage.toFixed(p.leverage % 1 === 0 ? 0 : 1)}x</span>
                  <span className="text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {formatUsd(p.marginUsd, 0)}
                      {(p.stopLossPrice != null || p.takeProfitPrice != null) && (
                        <span title="hidden SL/TP set" className="inline-flex">
                          <EyeOff className="w-2.5 h-2.5 text-primary" />
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="col-span-2 text-right">
                    {p.status === "open" ? (
                      <div className="inline-flex items-center gap-1 justify-end flex-wrap">
                        <DisclosureDialog position={p} />
                        <StopsControl position={p} onSaved={() => invalidate(address)} />
                        <MarginControl
                          position={p}
                          freeBalance={account?.free}
                          onAdjusted={() => invalidate(address)}
                        />
                        <CloseControl
                          position={p}
                          busy={closingId === p.id || !!closeJobs[p.id]}
                          onClose={handleClose}
                        />
                      </div>
                    ) : p.settlement?.cardanoAnchorTx ? (
                      <a
                        href={explorerTx(p.settlement.cardanoAnchorTx)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline inline-flex items-center gap-0.5 text-[10px]"
                      >
                        anchor <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className={cn("text-[10px]", p.status === "liquidated" ? "text-destructive" : "text-muted-foreground")}>
                        {p.status}
                      </span>
                    )}
                  </span>
                </div>

                {/* mobile row */}
                <div className="lg:hidden px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MarketIcon base={p.marketId.split("-")[0]} size={18} />
                      <span className="font-medium text-sm">{p.marketId}</span>
                      <SideBadge side={p.side} />
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {p.leverage.toFixed(p.leverage % 1 === 0 ? 0 : 1)}x
                      </span>
                      {(p.stopLossPrice != null || p.takeProfitPrice != null) && (
                        <span title="hidden SL/TP set" className="inline-flex">
                          <EyeOff className="w-3 h-3 text-primary" />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-muted-foreground">size</div>
                      {p.sizeBase.toFixed(4)}
                    </div>
                    <div>
                      <div className="text-muted-foreground">entry</div>
                      {formatUsd(p.entryPrice)}
                    </div>
                    <div>
                      <div className="text-muted-foreground">
                        {activeTab === "open" ? "uPnL" : "realized"}
                      </div>
                      <PnlCell value={activeTab === "open" ? p.unrealizedPnl : p.realizedPnl} />
                    </div>
                    {activeTab === "open" && (
                      <div>
                        <div className="text-muted-foreground">liq.</div>
                        <span className="text-warning">{formatUsd(p.liquidationPrice)}</span>
                      </div>
                    )}
                    <div>
                      <div className="text-muted-foreground">mark</div>
                      {formatUsd(p.markPrice)}
                    </div>
                    <div>
                      <div className="text-muted-foreground">margin</div>
                      {formatUsd(p.marginUsd, 0)}
                    </div>
                  </div>
                  {p.status === "open" && (
                    <div className="flex items-center gap-1 flex-wrap pt-1">
                      <DisclosureDialog position={p} />
                      <StopsControl position={p} onSaved={() => invalidate(address)} />
                      <MarginControl
                        position={p}
                        freeBalance={account?.free}
                        onAdjusted={() => invalidate(address)}
                      />
                      <CloseControl
                        position={p}
                        busy={closingId === p.id || !!closeJobs[p.id]}
                        onClose={handleClose}
                      />
                    </div>
                  )}
                </div>

                {/* live close pipeline */}
                {closeJobs[p.id] && (
                  <CloseJobPanel
                    jobId={closeJobs[p.id]}
                    position={p}
                    onDone={() =>
                      setCloseJobs((m) => {
                        const { [p.id]: _, ...rest } = m;
                        return rest;
                      })
                    }
                  />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}
