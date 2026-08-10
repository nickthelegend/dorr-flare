"use client";

import type { ReactNode } from "react";

/**
 * Wallet context boundary.
 *
 * dorr now connects an EVM wallet directly over EIP-1193 (see
 * `hooks/use-evm-wallet.ts`), so no provider component is required. This stays
 * as a thin pass-through so the terminal's tree shape is unchanged; it replaced
 * a MeshProvider that pulled Cardano WASM into the client bundle.
 */
export function CardanoProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export { CardanoProvider as WalletProvider };
