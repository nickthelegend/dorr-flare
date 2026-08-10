"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, EyeOff, TrendingUp, TrendingDown, X, Loader2 } from "lucide-react";
import { cn, formatTimestamp, formatUsd, humanizeError, truncateHash } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useRestingOrders, useInvalidateTrading } from "@/hooks/use-operator";
import { operator, type RestingOrder } from "@/lib/operator";
import { MarketIcon } from "./market-icon";

function RestingRow({ order, address }: { order: RestingOrder; address?: string }) {
  const isLong = order.side === "LONG";
  const invalidate = useInvalidateTrading();
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    setCancelling(true);
    try {
      await operator.cancelOrder(order.id);
      toast.success("Order cancelled", {
        description: `${formatUsd(order.marginUsd)} FXRP margin released`,
      });
      invalidate(address);
    } catch (e: any) {
      toast.error("Cancel failed", { description: humanizeError(e) });
      setCancelling(false);
    }
    // on success the row unmounts (list refetch) — no need to reset state
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-md border border-primary/30 bg-primary/[0.03] p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <MarketIcon base={order.marketId.split("-")[0]} size={16} />
          {isLong ? (
            <TrendingUp className="w-3 h-3 text-success shrink-0" />
          ) : (
            <TrendingDown className="w-3 h-3 text-destructive shrink-0" />
          )}
          <span className="text-xs font-medium truncate">{order.marketId}</span>
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1 text-[9px] uppercase tracking-wide border-0 text-white",
              isLong ? "bg-green-600" : "bg-red-600",
            )}
          >
            {order.side}
          </Badge>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {formatTimestamp(order.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">size</div>
          {order.sizeBase.toFixed(4)}
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">limit</div>
          <span className="text-primary font-semibold">{formatUsd(order.limitPrice)}</span>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">lev</div>
          {order.leverage}x
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-primary">
          <EyeOff className="w-2.5 h-2.5" /> hidden from public
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono text-muted-foreground/70" title={order.commitmentHash}>
            {truncateHash(order.commitmentHash, 8, 6)}
          </span>
          <button
            onClick={cancel}
            disabled={cancelling}
            title="Cancel order — releases locked margin"
            className={cn(
              "flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
              "text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {cancelling ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <X className="w-2.5 h-2.5" />}
            cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * The connected wallet's private resting limit orders. These publish only a ZK
 * commitment — their side/size/leverage and, crucially, the trigger price stay
 * hidden from the public feed, so no one can front-run or hunt the level. Polled
 * every 3s. Cancelling a row releases its locked margin. Fails soft: no wallet /
 * operator down → empty state, never crashes.
 */
export default function RestingOrders() {
  const { connected, address } = useDorrWallet();
  const { data: orders, isError } = useRestingOrders(address);

  const rows = orders ?? [];

  return (
    <Card className="flex flex-col">
      <PanelHeader
        title="Resting orders"
        bullet="default"
        icon={<Clock className="size-3" />}
        action={
          rows.length > 0 ? (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono tabular-nums">
              {rows.length}
            </Badge>
          ) : null
        }
      />
      <CardContent className="space-y-1.5">
        {!connected ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
            <EyeOff className="size-4 text-muted-foreground/50" />
            <div className="text-xs text-muted-foreground">Connect a wallet to see resting orders.</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
            <Clock className="size-4 text-muted-foreground/50" />
            <div className="text-xs text-muted-foreground">
              {isError ? "Operator offline." : "No resting limit orders."}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((o) => (
              <RestingRow key={o.id} order={o} address={address} />
            ))}
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}
