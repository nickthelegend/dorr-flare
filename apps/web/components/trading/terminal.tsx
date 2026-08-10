"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

/**
 * The entire trading terminal loads client-side only (ssr:false): every panel
 * touches useWallet → @meshsdk/react → cardano WASM, which cannot run during
 * server prerendering. The shell below keeps first paint from being blank.
 */
const TerminalInner = dynamic(() => import("./terminal-inner"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="w-full border-b border-border px-4 py-4 flex items-center justify-between">
        <span className="text-xl font-display lowercase">dorr</span>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
          private perps · cardano + midnight
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> loading terminal…
      </div>
    </div>
  ),
});

export default function TradingTerminal() {
  return <TerminalInner />;
}
