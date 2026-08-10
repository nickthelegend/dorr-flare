"use client";

import { useEffect } from "react";
import { setWalletSigner, evmSigner } from "@/lib/operator";
import { useEvmWallet } from "./use-evm-wallet";

/**
 * dorr's wallet handle.
 *
 * Now backed by an EVM wallet on Flare Coston2 — dorr settles on Flare and
 * margins in FXRP (an ERC-20), so a Cardano CIP-30 wallet could neither hold the
 * collateral nor sign a settlement transaction. The shape of this hook is
 * unchanged so every consumer keeps working.
 */
export function useDorrWallet() {
  const evm = useEvmWallet();

  // Register a signer so value-moving operator calls are authenticated
  // (EIP-191 personal_sign). Cleared on disconnect.
  useEffect(() => {
    if (evm.connected && evm.address && evm.walletClient) {
      setWalletSigner(evmSigner(evm.walletClient, evm.address));
    } else {
      setWalletSigner(null);
    }
    return () => setWalletSigner(null);
  }, [evm.connected, evm.address, evm.walletClient]);

  return {
    walletName: evm.connected ? "evm" : undefined,
    connecting: evm.connecting,
    connected: evm.connected,
    /** The viem WalletClient — used for FXRP approve/deposit and signing. */
    wallet: evm.walletClient,
    connect: evm.connect,
    disconnect: evm.disconnect,
    error: evm.error,
    /** 0x address once connected (undefined while disconnected). */
    address: evm.address,
    // Flare-specific extras
    available: evm.available,
    chainId: evm.chainId,
    wrongNetwork: evm.wrongNetwork,
    switchToCoston2: evm.switchToCoston2,
  };
}
