"use client";

import type { ReactNode } from "react";
import { CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Bullet } from "@/components/ui/bullet";
import { cn } from "@/lib/core";

/**
 * The premium v0-dashboard panel header: a coloured Bullet accent + an uppercase
 * mono title, with an optional right-aligned action slot. Every trading panel
 * uses this so the whole terminal reads as one dense, intentional dashboard
 * rather than a stack of ad-hoc cards.
 */
export function PanelHeader({
  title,
  bullet = "default",
  icon,
  action,
  className,
}: {
  title: ReactNode;
  bullet?: "default" | "success" | "warning" | "destructive";
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <CardHeader className={cn("items-center", className)}>
      <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Bullet variant={bullet} />
        {icon}
        {title}
      </CardTitle>
      {action ? <CardAction className="self-center">{action}</CardAction> : null}
    </CardHeader>
  );
}
