"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operator, type Job, type Market } from "@/lib/operator";

/** Everything fails soft: components render loading/empty states on error. */

/**
 * The venue's heartbeat. It has to keep beating while the tab is in the
 * background, otherwise the status chip can latch on a failure from a blip and
 * still read "offline" long after the operator is back.
 */
export function useHealth() {
  return useQuery({
    queryKey: ["operator", "health"],
    queryFn: operator.health,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

/** 5 dorr markets polled every 3s — the app's price heartbeat. */
export function useMarkets() {
  return useQuery<Market[]>({
    queryKey: ["operator", "markets"],
    queryFn: operator.markets,
    refetchInterval: 3_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useMarket(marketId: string | undefined) {
  const { data: markets, ...rest } = useMarkets();
  return { market: markets?.find((m) => m.id === marketId), markets, ...rest };
}

export function useAccount(address: string | undefined) {
  return useQuery({
    queryKey: ["operator", "account", address],
    queryFn: () => operator.account(address!),
    enabled: !!address,
    refetchInterval: 5_000,
    retry: false,
  });
}

export function usePositions(address: string | undefined) {
  return useQuery({
    queryKey: ["operator", "positions", address],
    queryFn: () => operator.positions(address!),
    enabled: !!address,
    refetchInterval: 3_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/** The connected wallet's private resting limit orders — polled every 3s. */
export function useRestingOrders(address: string | undefined) {
  return useQuery({
    queryKey: ["operator", "resting-orders", address],
    queryFn: () => operator.restingOrders(address!),
    enabled: !!address,
    refetchInterval: 3_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useFeed() {
  return useQuery({
    queryKey: ["operator", "feed"],
    queryFn: operator.feed,
    refetchInterval: 3_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/**
 * The connected wallet's activity timeline — polled every 3s. With no address
 * the operator returns recent global events, so the log is never empty for the
 * demo. Fails soft to an empty timeline when the operator is down.
 */
export function useEvents(address: string | undefined) {
  return useQuery({
    queryKey: ["operator", "events", address ?? "global"],
    queryFn: () => operator.events(address),
    refetchInterval: 3_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useAnchors() {
  return useQuery({
    queryKey: ["operator", "anchors"],
    queryFn: operator.anchors,
    refetchInterval: 10_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/** Exchange telemetry — per-market OI/skew/funding + global TVL/volume, every 5s. */
export function useStats() {
  return useQuery({
    queryKey: ["operator", "stats"],
    queryFn: operator.stats,
    refetchInterval: 5_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/** Proof of solvency — on-chain vault reserves vs credited liabilities, every 15s. */
export function useSolvency() {
  return useQuery({
    queryKey: ["operator", "solvency"],
    queryFn: operator.solvency,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/**
 * Poll a job until it completes/errors — proof steps take 12-45s, so this
 * polls fast (1s) to animate the step list live.
 */
export function useJob(jobId: string | undefined) {
  return useQuery<Job>({
    queryKey: ["operator", "job", jobId],
    queryFn: () => operator.job(jobId!),
    enabled: !!jobId,
    retry: false,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job && job.status !== "running") return false;
      return 1_000;
    },
  });
}

export function useInvalidateTrading() {
  const qc = useQueryClient();
  return (address?: string) => {
    qc.invalidateQueries({ queryKey: ["operator", "positions", address] });
    qc.invalidateQueries({ queryKey: ["operator", "account", address] });
    qc.invalidateQueries({ queryKey: ["operator", "resting-orders", address] });
    qc.invalidateQueries({ queryKey: ["operator", "feed"] });
    qc.invalidateQueries({ queryKey: ["operator", "anchors"] });
    qc.invalidateQueries({ queryKey: ["operator", "events"] });
  };
}
