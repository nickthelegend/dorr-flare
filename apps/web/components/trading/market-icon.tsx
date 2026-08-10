"use client";

import { cn } from "@/lib/core";

/**
 * Self-contained token brand marks for the five dorr markets. Inline SVG paths
 * (no runtime CDN, build-safe), each drawn inside a 32×32 viewBox on the brand
 * colour so they read cleanly on the premium dark theme. Falls back to the
 * ticker initials for any unknown base.
 */

type Glyph = { bg: string; fg: string; path: React.ReactNode };

const GLYPHS: Record<string, Glyph> = {
  // Cardano — three concentric rings of dots, simplified to the signet ring.
  ADA: {
    bg: "#0033AD",
    fg: "#FFFFFF",
    path: (
      <>
        <circle cx="16" cy="16" r="3.1" />
        <circle cx="16" cy="6.4" r="1.5" />
        <circle cx="16" cy="25.6" r="1.5" />
        <circle cx="7.7" cy="11.2" r="1.5" />
        <circle cx="24.3" cy="11.2" r="1.5" />
        <circle cx="7.7" cy="20.8" r="1.5" />
        <circle cx="24.3" cy="20.8" r="1.5" />
        <circle cx="16" cy="11" r="1" />
        <circle cx="16" cy="21" r="1" />
        <circle cx="11.7" cy="13.5" r="1" />
        <circle cx="20.3" cy="13.5" r="1" />
        <circle cx="11.7" cy="18.5" r="1" />
        <circle cx="20.3" cy="18.5" r="1" />
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
