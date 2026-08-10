"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, Anchor as AnchorIcon, ExternalLink, Radio } from "lucide-react";
import { cn, formatTimestamp, truncateAddress, truncateHash } from "@/lib/core";
import { useAnchors, useFeed } from "@/hooks/use-operator";
import type { FeedEntry } from "@/lib/operator";
import { MarketIcon } from "./market-icon";

function FeedRow({ entry }: { entry: FeedEntry }) {
  const isPrivate = entry.privacyMode === "private";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-md border p-2 space-y-1",
        isPrivate ? "border-border/60 bg-muted/20" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <MarketIcon base={entry.marketId.split("-")[0]} size={16} />
          {isPrivate ? (
            <Lock className="w-3 h-3 text-primary shrink-0" />
          ) : (
            <Eye className="w-3 h-3 text-destructive shrink-0" />
          )}
          <span className="text-xs font-medium truncate">{entry.marketId}</span>
          <Badge
            variant={isPrivate ? "outline" : "outline-destructive"}
            className="h-4 px-1 text-[8px] uppercase tracking-wide"
          >
            {isPrivate ? "private" : "public"}
          </Badge>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {formatTimestamp(entry.at)}
        </span>
      </div>

      {isPrivate ? (
        <div className="font-mono text-[10px] text-muted-foreground break-all leading-tight">
          {truncateHash(entry.commitmentHash, 18, 14)}
        </div>
      ) : (
        <div className="space-y-0.5">
          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-destructive">
            <span className="font-bold">{entry.leaked?.side}</span>
            <span className="text-right">{entry.leaked?.sizeBase?.toFixed(4)}</span>
            <span className="text-right">{entry.leaked?.leverage}x</span>
          </div>
          <div className="text-[10px] font-mono text-destructive/80 break-all">
            {truncateAddress(entry.leaked?.address, 16, 8)}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-destructive/70">
            fully visible — frontrunnable
          </div>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The attacker's-eye view: what an observer of the order flow actually sees.
 * dorr-private entries reveal only a commitment hash; foil entries leak it all.
 * Second tab is the on-chain evidence: real Cardano settlement anchors.
 */
export default function PublicFeed() {
  const [tab, setTab] = useState<"feed" | "anchors">("feed");
  const { data: feed, isError: feedError } = useFeed();
  const { data: anchors, isError: anchorsError } = useAnchors();

  return (
    <Card className="h-full flex flex-col">
      <PanelHeader
        title="What the public sees"
        bullet="destructive"
        icon={<Radio className="size-3" />}
        action={
          <div className="flex gap-1 p-0.5 bg-muted rounded-md">
            {(["feed", "anchors"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium rounded transition-colors capitalize",
                  tab === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "feed" ? "order flow" : "evidence"}
              </button>
            ))}
          </div>
        }
      />
      <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {tab === "feed" ? (
          !feed || feed.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Radio className="size-5 text-muted-foreground/50" />
              <div className="text-xs text-muted-foreground">
                {feedError ? "Operator offline." : "No orders yet — commit one."}
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {feed.map((entry, i) => (
                <FeedRow key={`${entry.at}-${entry.commitmentHash}-${i}`} entry={entry} />
              ))}
            </AnimatePresence>
          )
        ) : !anchors || anchors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <AnchorIcon className="size-5 text-muted-foreground/50" />
            <div className="text-xs text-muted-foreground">
              {anchorsError ? "Operator offline." : "No settlement anchors yet."}
            </div>
          </div>
        ) : (
          anchors
            .slice()
            .reverse()
            .map((a) => (
              <div
                key={a.txHash}
                className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-1 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <AnchorIcon className="w-3 h-3 text-primary" />
                    <span className="text-[11px] font-mono">{truncateHash(a.settlementId, 8, 4)}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {formatTimestamp(a.at)}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground break-all">
                  commitment {truncateHash(a.commitmentHex, 16, 12)}
                </div>
                <a
                  href={a.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono text-primary underline inline-flex items-center gap-1"
                >
                  {truncateHash(a.txHash)} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            ))
        )}
      </CardContent>
    </Card>
  );
}
