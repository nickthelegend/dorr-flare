"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Copy, LogOut, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn, truncateAddress } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";

interface AvailableWallet {
  id?: string;
  name: string;
  icon: string;
  version: string;
}

/**
 * Cardano wallet connect button (CIP-30 via Mesh).
 * Lists installed wallets (Lace/Eternl/...) — renders fine with none installed.
 */
export function WalletConnectButton({ className }: { className?: string }) {
  const { connected, connecting, connect, disconnect, address, walletName } = useDorrWallet();
  const [available, setAvailable] = useState<AvailableWallet[]>([]);
  const [open, setOpen] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);

  // Discover CIP-30 wallets lazily (client-only, wasm-free code path).
  useEffect(() => {
    if (!open || available.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserWallet } = await import("@meshsdk/core");
        const wallets = await BrowserWallet.getAvailableWallets();
        if (!cancelled) setAvailable(wallets as AvailableWallet[]);
      } catch (e) {
        console.warn("wallet discovery failed", e);
        if (!cancelled) setAvailable([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, available.length]);

  const handleConnect = async (name: string) => {
    setPendingWallet(name);
    try {
      await connect(name);
      setOpen(false);
    } catch (e) {
      toast.error(`Failed to connect ${name}`);
    } finally {
      setPendingWallet(null);
    }
  };

  if (!connected) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            className={cn(
              "bg-primary hover:bg-primary/90 text-primary-foreground",
              className,
            )}
            disabled={connecting}
          >
            {connecting || pendingWallet ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wallet className="w-4 h-4 mr-2" />
            )}
            Connect Wallet
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Cardano wallets (CIP-30)
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {available.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground text-center space-y-1">
              <div>No CIP-30 wallets found.</div>
              <div>
                Install{" "}
                <a
                  href="https://www.lace.io"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-primary"
                >
                  Lace
                </a>{" "}
                or{" "}
                <a
                  href="https://eternl.io"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-primary"
                >
                  Eternl
                </a>{" "}
                (preprod).
              </div>
            </div>
          ) : (
            available.map((w) => (
              <DropdownMenuItem
                key={w.id ?? w.name}
                className="cursor-pointer gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  handleConnect(w.id ?? w.name);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt={w.name} className="w-5 h-5 rounded" />
                <span className="capitalize">{w.name}</span>
                {pendingWallet === (w.id ?? w.name) && (
                  <Loader2 className="w-3 h-3 ml-auto animate-spin" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={cn("bg-primary hover:bg-primary/90 text-primary-foreground", className)}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="hidden sm:inline font-mono text-xs">
              {address ? truncateAddress(address) : "resolving…"}
            </span>
            <span className="sm:hidden">Connected</span>
            <ChevronDown className="w-4 h-4" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">
          <div className="capitalize">{walletName}</div>
          <div className="font-mono text-[10px] text-muted-foreground break-all mt-1">
            {address}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-xs"
          onSelect={() => {
            if (address) {
              navigator.clipboard.writeText(address);
              toast.success("Address copied");
            }
          }}
        >
          <Copy className="w-3.5 h-3.5" /> Copy address
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-xs text-destructive focus:text-destructive"
          onSelect={() => disconnect()}
        >
          <LogOut className="w-3.5 h-3.5" /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
