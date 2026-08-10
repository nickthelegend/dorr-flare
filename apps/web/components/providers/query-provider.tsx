"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";

/**
 * Query devtools are a development affordance, and their floating launcher sits
 * on top of the terminal chrome — so they are OFF by default, including in dev
 * (which is how the app is demoed). Opt in with NEXT_PUBLIC_SHOW_DEVTOOLS=1.
 * Loaded lazily so production never carries the bundle.
 */
const DEVTOOLS_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SHOW_DEVTOOLS === "1";

const ReactQueryDevtools = DEVTOOLS_ENABLED
  ? dynamic(
      () => import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools),
      { ssr: false },
    )
  : () => null;

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            retry: 3,
            refetchOnWindowFocus: false,
            refetchOnMount: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
