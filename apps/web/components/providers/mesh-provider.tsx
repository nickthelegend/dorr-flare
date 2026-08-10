"use client";

import { MeshProvider } from "@meshsdk/react";
import type { ReactNode } from "react";

/**
 * MeshProvider pulls in @meshsdk/core WASM, which must never evaluate on the
 * server. This wrapper is only ever imported from inside the ssr:false
 * terminal boundary (components/trading/terminal.tsx), so a static import is
 * safe here and keeps wallet context available synchronously on the client.
 */
export function CardanoProvider({ children }: { children: ReactNode }) {
  return <MeshProvider>{children}</MeshProvider>;
}
