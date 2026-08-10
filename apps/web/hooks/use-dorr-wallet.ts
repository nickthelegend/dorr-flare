"use client";

import { useWallet } from "@meshsdk/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { setWalletSigner, meshSigner } from "@/lib/operator";

/**
 * Thin wrapper over @meshsdk/react's useWallet that resolves the connected
 * wallet's bech32 change address (the identity the operator keys accounts on).
 */
export function useDorrWallet() {
  const { name, connecting, connected, wallet, connect, disconnect, error } = useWallet();

  const { data: address } = useQuery({
    queryKey: ["cardano", "change-address", name ?? "none", connected],
    enabled: connected && !!wallet,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const addr = await wallet.getChangeAddress();
      return addr as string;
    },
  });

  // Register a wallet signer so value-moving operator calls are signed (secure
  // trade placement). Cleared on disconnect / address loss.
  useEffect(() => {
    if (connected && wallet && address) {
      setWalletSigner(meshSigner(wallet as unknown as { signData: (p: string, a?: string) => Promise<{ signature: string; key: string }> }, address));
    } else {
      setWalletSigner(null);
    }
    return () => setWalletSigner(null);
  }, [connected, wallet, address]);

  return {
    walletName: name,
    connecting,
    connected,
    wallet,
    connect,
    disconnect,
    error,
    /** bech32 change address once connected (undefined while resolving). */
    address: connected ? address : undefined,
  };
}
