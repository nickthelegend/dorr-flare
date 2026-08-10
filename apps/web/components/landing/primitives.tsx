"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * Shared pieces for the landing page.
 *
 * Kept separate from `components/trading/*` on purpose: the terminal is a live
 * product surface and nothing here should be able to affect it.
 */

/** The shiny headline gradient, tuned to dorr's blue rather than a stock cyan. */
export const gradientStyle: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, #1E3A8A 0%, #2C6BFF 12.5%, #BBD3FF 32.5%, #7AA6FF 50%, #2C6BFF 67.5%, #1E3A8A 87.5%, #1E3A8A 100%)",
  backgroundSize: "200% auto",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
  filter: "url(#c3-noise)",
};

/** Primary CTA — routes into the live terminal, not a download. */
export function LaunchButton({
  label = "Launch the terminal",
  href = "/trade",
  full = false,
}: {
  label?: string;
  href?: string;
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 rounded-full bg-white text-black font-medium text-sm px-5 py-3 transition-all hover:bg-white/90 active:scale-[0.98] ${
        full ? "w-full" : ""
      }`}
    >
      {label}
      <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-[1px]" />
    </Link>
  );
}
