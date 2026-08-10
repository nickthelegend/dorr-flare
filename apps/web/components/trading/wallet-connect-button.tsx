"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Copy, LogOut, Wallet, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn, truncateAddress } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";

/**
 * EVM wallet connect for Flare Coston2 (MetaMask, Rabby, Brave, …).
 *
 * dorr margins in FXRP — an ERC-20 on Flare — so the connected account has to be
 * an EVM account that can hold the collateral and sign settlement. Renders a
 * clear install prompt when no injected wallet is present, and a one-click
 * network switch when the wallet is on the wrong chain.
 */
export function WalletConnectButton({ className }: { className?: string }) {
  const {
    connected, connecting, connect, disconnect, address, walletName,
    available, wrongNetwork, switchToCoston2,
  } = useDorrWallet();

  const handleConnect = async () => {
    if (!available) {
      toast.error("No EVM wallet found", {
        description: "Install MetaMask or Rabby to trade on Flare.",
        action: { label: "MetaMask", onClick: () => window.open("https://metamask.io/download/", "_blank") },
      });
      return;
    }
    await connect();
  };

  if (!connected) {
    return (
      <Button
        onClick={handleConnect}
        disabled={connecting}
        className={cn("bg-primary hover:bg-primary/90 text-primary-foreground", className)}
      >
        {connecting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Wallet className="w-4 h-4 mr-2" />
        )}
        {connecting ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  if (wrongNetwork) {
    return (
      <Button
        onClick={() => switchToCoston2().catch(() => toast.error("Network switch rejected"))}
        className={cn("bg-destructive hover:bg-destructive/90 text-white", className)}
      >
        <AlertTriangle className="w-4 h-4 mr-2" />
        Switch to Coston2
      </Button>
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
