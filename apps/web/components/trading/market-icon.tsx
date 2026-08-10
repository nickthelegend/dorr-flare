"use client";

import { cn } from "@/lib/core";

/**
 * Self-contained token brand marks for the dorr markets. Inline SVG paths (no
 * runtime CDN, build-safe), each drawn inside a 32×32 viewBox on the brand
 * colour so they read cleanly on the premium dark theme. Falls back to the
 * ticker initials for any unknown base.
 */

type Glyph = { bg: string; fg: string; path: React.ReactNode };

const GLYPHS: Record<string, Glyph> = {
  // Flare — the network's rounded chevron mark on its magenta brand colour.
  FLR: {
    bg: "#E62058",
    fg: "#FFFFFF",
    path: (
      <>
        <path d="M9.5 10.2h13.2c.6 0 1 .5 1 1v2.1c0 .6-.4 1-1 1H14v2.4h7.1c.6 0 1 .5 1 1v2.1c0 .6-.4 1-1 1H14v3.1c0 .6-.5 1-1 1h-2.4c-.6 0-1-.4-1-1V11.2c0-.6.4-1 1-1Z" />
        <circle cx="22.4" cy="23.6" r="2.2" />
      </>
    ),
  },
  // XRP — the Ripple double-chevron.
  XRP: {
    bg: "#23292F",
    fg: "#FFFFFF",
    path: (
      <>
        <path d="M8.6 8.4h3.2l4.2 4.3 4.2-4.3h3.2l-5.8 5.9a2.2 2.2 0 0 1-3.2 0L8.6 8.4Z" />
        <path d="M8.6 23.6h3.2l4.2-4.3 4.2 4.3h3.2l-5.8-5.9a2.2 2.2 0 0 0-3.2 0l-5.8 5.9Z" />
      </>
    ),
  },
  // Bitcoin — the ₿ mark.
  BTC: {
    bg: "#F7931A",
    fg: "#FFFFFF",
    path: (
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        ₿
      </text>
    ),
  },
  // Ethereum — the octahedron diamond.
  ETH: {
    bg: "#627EEA",
    fg: "#FFFFFF",
    path: (
      <>
        <path d="M16 4 L16 13 L23.5 16.3 Z" fillOpacity="0.9" />
        <path d="M16 4 L8.5 16.3 L16 13 Z" fillOpacity="0.6" />
        <path d="M16 17.6 L16 27 L23.5 17.7 Z" fillOpacity="0.9" />
        <path d="M16 27 L16 17.6 L8.5 17.7 Z" fillOpacity="0.6" />
        <path d="M16 16.1 L23.5 16.3 L16 13 Z" fillOpacity="1" />
        <path d="M8.5 16.3 L16 16.1 L16 13 Z" fillOpacity="0.75" />
      </>
    ),
  },
  // Solana — three slanted bars.
  SOL: {
    bg: "#000000",
    fg: "url(#sol-grad)",
    path: (
      <>
        <defs>
          <linearGradient id="sol-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9945FF" />
            <stop offset="1" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <path d="M9 10.5 L23.5 10.5 L21 13 L6.5 13 Z" />
        <path d="M9 15 L23.5 15 L21 17.5 L6.5 17.5 Z" transform="translate(1.5 0)" />
        <path d="M6.5 19.5 L21 19.5 L23.5 22 L9 22 Z" />
      </>
    ),
  },
  // Dogecoin — the Ð mark.
  DOGE: {
    bg: "#C2A633",
    fg: "#FFFFFF",
    path: (
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        Ð
      </text>
    ),
  },
};

export function MarketIcon({
  base,
  size = 22,
  className,
}: {
  base: string | undefined;
  size?: number;
  className?: string;
}) {
  const key = (base ?? "").toUpperCase();
  const glyph = GLYPHS[key];

  if (!glyph) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-bold",
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-label={base}
      >
        {key.slice(0, 3) || "?"}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden", className)}
      style={{ width: size, height: size }}
      aria-label={base}
      title={base}
    >
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        <circle cx="16" cy="16" r="16" fill={glyph.bg} />
        <g fill={glyph.fg}>{glyph.path}</g>
      </svg>
    </span>
  );
}
