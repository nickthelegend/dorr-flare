"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ExternalLink,
  Lock,
  Zap,
  XCircle,
  Scissors,
  ShieldAlert,
  Skull,
  Target,
  Anchor as AnchorIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  SlidersHorizontal,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import { cn, truncateHash } from "@/lib/core";
import { useEvents } from "@/hooks/use-operator";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import type { DorrEvent, EventType } from "@/lib/operator";
import { MarketIcon } from "./market-icon";

/** Relative "12s / 5m / 2h ago" — kept local so lib/core stays untouched. */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type Tone = "neutral" | "blue" | "amber" | "red" | "green" | "teal" | "purple";

/** type → { icon, tone } per the terminal's event colour language. */
const EVENT_META: Record<EventType, { icon: LucideIcon; tone: Tone }> = {
  commit: { icon: Lock, tone: "neutral" },
  "limit-rest": { icon: Lock, tone: "neutral" },
  execute: { icon: Zap, tone: "blue" },
  "limit-fill": { icon: Zap, tone: "blue" },
  close: { icon: XCircle, tone: "amber" },
  "partial-close": { icon: Scissors, tone: "amber" },
  "stop-loss": { icon: ShieldAlert, tone: "red" },
  liquidated: { icon: Skull, tone: "red" },
  "take-profit": { icon: Target, tone: "green" },
  anchor: { icon: AnchorIcon, tone: "teal" },
  deposit: { icon: ArrowDownToLine, tone: "teal" },
  withdraw: { icon: ArrowUpFromLine, tone: "teal" },
  margin: { icon: Coins, tone: "neutral" },
  "stops-set": { icon: SlidersHorizontal, tone: "neutral" },
  disclose: { icon: Unlock, tone: "purple" },
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  blue: "text-sky-400",
  amber: "text-amber-400",
  red: "text-destructive",
  green: "text-success",
  teal: "text-teal-400",
  purple: "text-purple-400",
};
const TONE_RING: Record<Tone, string> = {
  neutral: "border-border/60 bg-muted/30",
  blue: "border-sky-400/40 bg-sky-400/10",
  amber: "border-amber-400/40 bg-amber-400/10",
  red: "border-destructive/40 bg-destructive/10",
  green: "border-success/40 bg-success/10",
  teal: "border-teal-400/40 bg-teal-400/10",
  purple: "border-purple-400/40 bg-purple-400/10",
};

const explorerTx = (h: string) => `https://preprod.cardanoscan.io/transaction/${h}`;

function EventRow({ event }: { event: DorrEvent }) {
  const meta = EVENT_META[event.type] ?? { icon: Activity, tone: "neutral" as Tone };
  const Icon = meta.icon;
  const base = event.marketId?.split("-")[0];
  const cardanoTx = event.txHash && event.chain === "cardano" ? event.txHash : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/10 p-2 hover:border-border transition-colors"
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border",
          TONE_RING[meta.tone],
        )}
      >
        <Icon className={cn("size-3.5", TONE_TEXT[meta.tone])} />
      </span>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5">
          {base && <MarketIcon base={base} size={14} />}
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1 text-[8px] uppercase tracking-wide border-0",
              TONE_RING[meta.tone],
              TONE_TEXT[meta.tone],
            )}
          >
            {event.type.replace("-", " ")}
          </Badge>
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">
            {relativeTime(event.at)}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-foreground/90 break-words">{event.detail}</p>
        {cardanoTx && (
          <a
            href={explorerTx(cardanoTx)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono text-primary underline"
          >
            {truncateHash(cardanoTx)} <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The trader's activity timeline — a premium scrollable log of every action
 * (commit / execute / close / SL-TP / anchor / deposit / withdraw / disclose).
 * Polls the connected wallet's address (falls back to recent global events when
 * no wallet is connected). Cardano tx hashes link to preprod cardanoscan.
 * Fails soft: operator down → empty state, never crashes.
 */
export default function ActivityLog() {
  const { connected, address } = useDorrWallet();
  const { data: events, isError } = useEvents(address);
  const rows = events ?? [];

  return (
    <Card className="h-full flex flex-col">
      <PanelHeader
        title="Activity log"
        bullet="default"
        icon={<Activity className="size-3" />}
        action={
          <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono tabular-nums">
            {rows.length}
          </Badge>
        }
      />
      <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Activity className="size-5 text-muted-foreground/50" />
            <div className="text-xs text-muted-foreground">
              {isError
                ? "Operator offline."
                : connected
                  ? "No activity yet — your trades will log here."
                  : "No recent activity — connect a wallet to track your own."}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((e, i) => (
              <EventRow key={`${e.at}-${e.type}-${i}`} event={e} />
            ))}
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}
