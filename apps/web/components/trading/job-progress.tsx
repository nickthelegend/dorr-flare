"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, XCircle, ExternalLink, Circle } from "lucide-react";
import { cn, truncateHash } from "@/lib/core";
import { Progress } from "@/components/ui/progress";
import type { Job, JobStep } from "@/lib/operator";

function StepTimer({ running }: { running: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!running) return null;
  return (
    <span className="font-mono text-[10px] text-primary tabular-nums animate-pulse">{seconds}s</span>
  );
}

function txExplorerUrl(txHash: string): string | null {
  // 64-hex hashes → Flare Coston2 explorer.
  if (/^[0-9a-f]{64}$/i.test(txHash)) {
    return `https://coston2-explorer.flare.network/tx/${txHash}`;
  }
  return null;
}

function StepRow({ step, index }: { step: JobStep; index: number }) {
  const explorer = step.txHash ? txExplorerUrl(step.txHash) : null;
  const running = step.status === "running";
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "relative flex items-start gap-2.5 py-1.5 pl-1",
        running && "bg-primary/5 rounded-md -mx-1 px-2",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {running ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        ) : step.status === "complete" ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-success" />
        ) : step.status === "error" ? (
          <XCircle className="w-3.5 h-3.5 text-destructive" />
        ) : (
          <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-xs leading-tight",
              running && "text-foreground font-medium",
              step.status === "complete" && "text-muted-foreground",
              step.status === "error" && "text-destructive",
            )}
          >
            {step.label}
          </span>
          <span className="shrink-0">
            {running ? (
              <StepTimer running />
            ) : step.ms !== undefined ? (
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {(step.ms / 1000).toFixed(1)}s
              </span>
            ) : null}
          </span>
        </div>
        {step.detail && (
          <div className="text-[10px] text-muted-foreground/80 break-all leading-tight mt-0.5">
            {step.detail}
          </div>
        )}
        {step.txHash && (
          <div className="text-[10px] font-mono mt-0.5 flex items-center gap-1">
            <span className="text-muted-foreground">tx</span>
            {explorer ? (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline inline-flex items-center gap-0.5"
              >
                {truncateHash(step.txHash)}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : (
              <span className="text-foreground/80">{truncateHash(step.txHash)}</span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Live proof/settlement pipeline view — the dorr hero moment.
 * ZK proof steps take 12-45s; every step animates in with a running timer,
 * and a progress bar tracks completed steps for a cinematic feel.
 */
export function JobProgress({ job, title }: { job: Job | undefined; title?: string }) {
  if (!job) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> starting job…
      </div>
    );
  }

  const total = job.steps.length || 1;
  const done = job.steps.filter((s) => s.status === "complete").length;
  const pct = job.status === "complete" ? 100 : Math.round((done / total) * 100);

  return (
    <div className="space-y-1.5">
      {title && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</span>
          <span
            className={cn(
              "text-[10px] font-mono uppercase font-bold",
              job.status === "running" && "text-primary",
              job.status === "complete" && "text-success",
              job.status === "error" && "text-destructive",
            )}
          >
            {job.status}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Progress
          value={pct}
          className={cn(
            "h-1.5",
            job.status === "error" && "[&_[data-slot=progress-indicator]]:bg-destructive",
            job.status === "complete" && "[&_[data-slot=progress-indicator]]:bg-success",
          )}
        />
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
          {done}/{total}
        </span>
      </div>
      <div className="divide-y divide-border/40">
        <AnimatePresence initial={false}>
          {job.steps.map((step, i) => (
            <StepRow key={`${i}-${step.label}`} step={step} index={i} />
          ))}
        </AnimatePresence>
      </div>
      {job.error && <div className="text-[10px] text-destructive break-all pt-1">{job.error}</div>}
    </div>
  );
}
