"use client";

import { cn } from "@/lib/core";
import { WalletConnectButton } from "./wallet-connect-button";
import { DemoShowcase } from "./attack-lab";
import { Bullet } from "@/components/ui/bullet";
import { Badge } from "@/components/ui/badge";
import LockIcon from "@/components/icons/lock";
import { useHealth, useMarkets, useAnchors, useSolvency } from "@/hooks/use-operator";

/** One premium status pill: bullet + label + optional value. */
function Chip({
  label,
  value,
  variant = "default",
  pulse = false,
  title,
}: {
  label: string;
  value?: string | number;
  variant?: "default" | "success" | "warning" | "destructive";
  pulse?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
    >
      <Bullet variant={variant} className={cn("rounded-full", pulse && "animate-pulse")} size="sm" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {value !== undefined && (
        <span className="font-mono text-[10px] text-foreground tabular-nums">{value}</span>
      )}
    </div>
  );
}

/**
 * Two signals, not five. A trader needs to know the venue is up and that their
 * collateral is backed; market count, chain readiness and anchor totals are
 * operator telemetry and live in the hover detail rather than on the chrome.
 */
function HealthChips() {
  const { data: health, isError } = useHealth();
  const { data: markets } = useMarkets();
  const { data: anchors } = useAnchors();
  const { data: solvency } = useSolvency();
  const up = !!health?.ok && !isError;

  const detail = [
    `Operator ${up ? "live" : "offline"}`,
    `${markets?.length ?? health?.markets ?? 0} markets`,
    `${anchors?.length ?? 0} settlement anchors`,
  ].join(" · ");

  return (
    <div className="hidden md:flex items-center gap-1.5">
      <Chip
        label={up ? "live" : "offline"}
        variant={up ? "success" : "destructive"}
        pulse={!up}
        title={detail}
      />
      {solvency && (
        <Chip
          label="backed"
          value={
            solvency.solvent
              ? solvency.collateralizationRatio != null
                ? `${solvency.collateralizationRatio.toFixed(1)}x`
                : "ok"
              : "under"
          }
          variant={solvency.solvent ? "success" : "destructive"}
          title={`Collateral reserves ${solvency.solvent ? "fully back" : "do NOT cover"} all credited balances`}
        />
      )}
    </div>
  );
}

export default function TradingNavbar() {
  return (
    <nav className="w-full bg-background border-b border-border px-2 sm:px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        {/* Left: brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center rounded bg-primary size-8 shrink-0">
            <LockIcon className="size-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-lg sm:text-2xl font-display lowercase leading-none">dorr</span>
              <Badge variant="outline" className="hidden lg:inline-flex text-[9px] h-4 px-1.5 uppercase tracking-wider">
                preprod
              </Badge>
            </div>
            <span className="hidden sm:block text-[9px] text-muted-foreground uppercase tracking-[0.2em] mt-1">
              privacy perps · cardano + midnight
            </span>
          </div>
        </div>

        {/* Right: status + demo + wallet */}
        <div className="flex items-center gap-2 sm:gap-3">
          <HealthChips />
          <DemoShowcase />
          <WalletConnectButton />
        </div>
      </div>
    </nav>
  );
}
