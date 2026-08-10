"use client";

import { useEffect } from "react";
import { setWalletSigner, evmSigner } from "@/lib/operator";
import { useEvmWallet } from "./use-evm-wallet";

/**
 * dorr's wallet handle.
 *
 * Now backed by an EVM wallet on Flare Coston2 — dorr settles on Flare and
 * margins in FXRP (an ERC-20), so the signing identity is an EVM account.
 */
export function useDorrWallet() {
  const evm = useEvmWallet();

  /**
   * Register a signer so value-moving operator calls are authenticated
   * (EIP-191 personal_sign).
   *
   * Deliberately no unmount cleanup. The signer lives in a module-level slot in
   * `lib/operator.ts`, and six components call this hook — the order ticket, the
   * positions table, resting orders, the collateral panel, the activity log and
   * the connect button. A `return () => setWalletSigner(null)` here fires
   * whenever *any one* of them unmounts, so closing a position (which unmounts
   * its row) disarmed signing for the entire app: the wallet still read
   * "connected", and the next order went out with no envelope and came back 401
   * "missing auth". Disconnecting is what should clear the signer, and the
   * `else` branch below already does that — every consumer re-runs this effect
   * when the wallet state changes.
   */
  useEffect(() => {
    if (evm.connected && evm.address && evm.walletClient) {
      setWalletSigner(evmSigner(evm.walletClient, evm.address));
    } else {
      setWalletSigner(null);
    }
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
