"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Badge } from "@/components/ui/badge";
import { Bullet } from "@/components/ui/bullet";
import { ChevronDown, WifiOff, Activity } from "lucide-react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatUsd } from "@/lib/core";
import { useMarketSelection } from "@/context/market-context";
import { useMarkets } from "@/hooks/use-operator";
import { MarketIcon } from "./market-icon";

/** Candle bucket sizes (seconds) — the operator polls every 3s, so small buckets fill fast. */
const TIMEFRAMES = [
  { label: "5s", sec: 5 },
  { label: "15s", sec: 15 },
  { label: "1m", sec: 60 },
  { label: "5m", sec: 300 },
] as const;

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Per-(market, bucket) candle accumulators shared across market/timeframe switches. */
type CandleStore = Map<string, Candle[]>;

/** How far back to seed, in seconds, per bucket (bigger buckets → longer history). */
function backfillWindowSec(bucketSec: number): number {
  if (bucketSec >= 300) return 24 * 3600; // 5m bars over ~24h
  if (bucketSec >= 60) return 6 * 3600; // 1m bars over ~6h
  return 2 * 3600; // sub-minute: last ~2h
}

/**
 * Seed prior candles from the operator's own FTSO v2 history — the same feed that
 * prices fills and that `DorrBatchSettlement` re-reads on-chain, so the chart and
 * the settlement layer can never disagree. The operator stores 1-minute bars and
 * aggregates them to the requested bucket; sub-minute views seed from 1m and then
 * extend with live ticks. Returns [] on any failure and the caller falls back to
 * live-only rather than reaching for a third-party price API.
 */
async function fetchBackfill(marketId: string, bucketSec: number, signal: AbortSignal): Promise<Candle[]> {
  const requested = Math.max(60, bucketSec);
  const limit = Math.ceil(backfillWindowSec(bucketSec) / requested) + 2;
  const base = (process.env.NEXT_PUBLIC_OPERATOR_URL || "http://localhost:8791").replace(/\/$/, "");
  const res = await fetch(
    `${base}/markets/${encodeURIComponent(marketId)}/candles?bucketSec=${requested}&limit=${limit}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`candles HTTP ${res.status}`);
  const j = (await res.json()) as {
    candles?: Array<{ t: number; o: number; h: number; l: number; c: number }>;
  };
  const rows = j.candles ?? [];
  const out: Candle[] = [];
  let prevTime = -1;
  for (const r of rows) {
    const time = Math.floor(r.t) as UTCTimestamp;
    const close = Number(r.c);
    if (!(close > 0) || time <= prevTime) continue; // strictly increasing, valid
    prevTime = time;
    out.push({
      time,
      open: Number(r.o) || close,
      high: Number(r.h) || close,
      low: Number(r.l) || close,
      close,
    });
  }
  return out;
}

export default function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const candlesRef = useRef<CandleStore>(new Map());
  const renderedKeyRef = useRef<string | null>(null);
  // Bar count last painted for the current key — refit the view when it grows.
  const renderedLenRef = useRef<number>(0);
  // Keys we've already tried to backfill (so we don't refetch on every poll).
  const backfilledRef = useRef<Set<string>>(new Set());
  // Bumped when a backfill completes to re-run the fold effect and paint history.
  const [backfillTick, setBackfillTick] = useState(0);

  const { selectedMarketId, setSelectedMarketId } = useMarketSelection();
  const { data: markets, isError } = useMarkets();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [bucketSec, setBucketSec] = useState<number>(15);

  const market = markets?.find((m) => m.id === selectedMarketId);
  const price = market?.markPrice ?? market?.indexPrice ?? null;
  const storeKey = `${selectedMarketId}@${bucketSec}`;

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#9c9a9d",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(120,120,120,0.12)" },
        horzLines: { color: "rgba(120,120,120,0.12)" },
      },
      timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false },
      // Tight autoscale so small (sub-bp) ADA moves fill the pane instead of
      // reading as a flat line against a wide fixed range.
      rightPriceScale: {
        borderVisible: false,
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // The chart lives in a flex/min-h-0 pane that can be 0×0 on first paint, so
    // the initial fitContent() has no width to fit against (bars bunch on the
    // right, history hidden). Refit whenever the container gains/changes size.
    let lastW = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0 && w !== lastW) {
        lastW = w;
        chart.timeScale().fitContent();
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      renderedKeyRef.current = null;
    };
  }, []);

  // Seed prior candles from the operator's FTSO history on market/timeframe
  // change, then let live ticks append. Fails soft: on any error we keep
  // live-only behaviour.
  // NB: mark the key done ONLY on success — marking eagerly meant React StrictMode's
  // dev mount→cleanup→remount aborted the in-flight fetch and the remount bailed on
  // the already-marked key, so history never loaded.
  useEffect(() => {
    const base = market?.base;
    if (!base) return;
    const key = `${selectedMarketId}@${bucketSec}`;
    if (backfilledRef.current.has(key)) return;

    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const history = await fetchBackfill(selectedMarketId, bucketSec, ctrl.signal);
        if (cancelled || history.length === 0) return;
        backfilledRef.current.add(key); // mark done only once history is in hand
        const existing = candlesRef.current.get(key) ?? [];
        // Merge: keep any live candles that are newer than the last history bar.
        const lastHist = history[history.length - 1].time;
        const newer = existing.filter((c) => c.time > lastHist);
        const merged = [...history, ...newer].slice(-500);
        candlesRef.current.set(key, merged);
        // Force the fold effect to repaint this key's series with the history.
        renderedKeyRef.current = null;
        setBackfillTick((n) => n + 1);
      } catch {
        // network/CORS/abort → key stays unmarked so the next run retries.
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.base, bucketSec, selectedMarketId]);

  // Fold every poll tick into per-(market, bucket) candles; re-seed series on switch.
  useEffect(() => {
    if (!markets || !seriesRef.current) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = (Math.floor(nowSec / bucketSec) * bucketSec) as UTCTimestamp;

    for (const m of markets) {
      const p = m.markPrice ?? m.indexPrice;
      if (p === null || p === undefined || !(p > 0)) continue;
      const key = `${m.id}@${bucketSec}`;
      const list = candlesRef.current.get(key) ?? [];
      const last = list[list.length - 1];
      if (last && bucket <= last.time) {
        // Same (or, after backfill, an earlier) bucket than the last stored bar —
        // merge into it so series times stay strictly increasing (no data errors).
        last.high = Math.max(last.high, p);
        last.low = Math.min(last.low, p);
        last.close = p;
      } else {
        list.push({ time: bucket, open: last?.close ?? p, high: p, low: p, close: p });
        if (list.length > 500) list.shift();
      }
      candlesRef.current.set(key, list);
    }

    const series = seriesRef.current;
    const mine = candlesRef.current.get(storeKey) ?? [];
    if (renderedKeyRef.current !== storeKey) {
      series.setData(mine.map((c) => ({ ...c })));
      chartRef.current?.timeScale().fitContent();
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      renderedKeyRef.current = storeKey;
      renderedLenRef.current = mine.length;
    } else if (mine.length > 0) {
      series.update({ ...mine[mine.length - 1] });
      // A new bar was appended — refit so the whole series (history + latest)
      // stays in view rather than the newest bar sliding off the right edge.
      if (mine.length !== renderedLenRef.current) {
        chartRef.current?.timeScale().fitContent();
        renderedLenRef.current = mine.length;
      }
    }
  }, [markets, storeKey, bucketSec, backfillTick]);

  const spreadBps =
    market?.markPrice && market?.indexPrice
      ? ((market.markPrice - market.indexPrice) / market.indexPrice) * 10_000
      : null;

  const tfLabel = useMemo(
    () => TIMEFRAMES.find((t) => t.sec === bucketSec)?.label ?? `${bucketSec}s`,
    [bucketSec],
  );

  return (
    <div className="h-full flex flex-col">
      <Card className="h-full flex flex-col">
        <PanelHeader
          title="Live chart"
          icon={<Activity className="size-3" />}
          className="h-auto"
          action={
            <div className="flex items-center gap-1">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.sec}
                  onClick={() => setBucketSec(t.sec)}
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors",
                    bucketSec === t.sec
                      ? "bg-primary text-primary-foreground font-bold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 sm:px-4 pb-2">
          {/* market selector */}
          <DropdownMenu open={selectorOpen} onOpenChange={setSelectorOpen}>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 hover:bg-accent/50 rounded px-2 py-1 -ml-2 transition-colors">
                <MarketIcon base={market?.base} size={24} />
                <span className="text-base sm:text-lg font-display">
                  {market?.symbol ?? selectedMarketId}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    selectorOpen && "rotate-180",
                  )}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {(markets ?? []).map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  className={cn(
                    "cursor-pointer justify-between font-mono text-xs",
                    m.id === selectedMarketId && "bg-accent/50",
                  )}
                  disabled={m.disabled}
                  onSelect={() => setSelectedMarketId(m.id)}
                >
                  <span className="font-sans font-medium flex items-center gap-2">
                    <MarketIcon base={m.base} size={20} />
                    {m.symbol}
                  </span>
                  <span className={cn(m.disabled && "line-through")}>
                    {formatUsd(m.markPrice ?? m.indexPrice)}
                  </span>
                </DropdownMenuItem>
              ))}
              {!markets?.length && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {isError ? "Operator offline" : "Loading markets…"}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* live prices */}
          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-muted-foreground mr-1.5">mark</span>
              <span className="text-foreground font-semibold text-sm">{formatUsd(market?.markPrice)}</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-muted-foreground mr-1.5">index</span>
              <span>{formatUsd(market?.indexPrice)}</span>
            </div>
            {spreadBps !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px] h-5 border-0",
                  Math.abs(spreadBps) < 5
                    ? "bg-muted text-muted-foreground"
                    : spreadBps > 0
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive",
                )}
              >
                {spreadBps >= 0 ? "+" : ""}
                {spreadBps.toFixed(1)} bps
              </Badge>
            )}
            {market?.disabled && (
              <Badge variant="outline-destructive" className="text-[10px] h-5">
                feed disabled
              </Badge>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <Bullet variant="success" size="sm" className="rounded-full animate-pulse" />
            <span className="hidden md:inline">{tfLabel} · vAMM mark vs FTSO index</span>
          </div>
        </div>
        <CardContent className="flex-1 p-0 relative min-h-0">
          {isError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 z-10">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <WifiOff className="w-4 h-4" /> operator offline — waiting for prices
              </div>
            </div>
          )}
          {!isError && !price && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 pointer-events-none">
              <div className="text-sm text-muted-foreground">waiting for first price…</div>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </CardContent>
      </Card>
    </div>
  );
}
