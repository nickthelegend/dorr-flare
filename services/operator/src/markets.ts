/**
 * dorr v1 markets — 5 perps, all quoted in dUSD, priced from Flare FTSO v2 (on-chain oracle).
 * Feed ids are FTSO v2 bytes21 identifiers (verified at boot against the on-chain oracle;
 * a failing id is logged loudly and the market is disabled rather than mispriced).
 */
export interface MarketDef {
  /** dorr market id, e.g. "ADA-dUSD" (pairId in engine terms). */
  id: string;
  symbol: string;
  base: string;
  /** FTSO v2 feed id (bytes21: 0x01 category + ASCII name, zero-padded). */
  feedId: string;
  /** Virtual AMM depth: quote-side notional (dUSD) of the virtual pool. */
  vammDepthUsd: number;
  /** Recenter vAMM to Pyth when drift exceeds this many bps. */
  recenterBps: number;
  maxLeverage: number;
  /** Risk limit: max total open interest (notional, dUSD) across all traders. */
  maxOiUsd: number;
}

export const MARKETS: MarketDef[] = [
  {
    id: "ADA-dUSD",
    symbol: "ADA/dUSD",
    base: "ADA",
    feedId: "0x014144412f55534400000000000000000000000000", // FTSO v2 ADA/USD,
    vammDepthUsd: 2_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
  {
    id: "BTC-dUSD",
    symbol: "BTC/dUSD",
    base: "BTC",
    feedId: "0x014254432f55534400000000000000000000000000", // FTSO v2 BTC/USD,
    vammDepthUsd: 10_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "ETH-dUSD",
    symbol: "ETH/dUSD",
    base: "ETH",
    feedId: "0x014554482f55534400000000000000000000000000", // FTSO v2 ETH/USD,
    vammDepthUsd: 10_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "SOL-dUSD",
    symbol: "SOL/dUSD",
    base: "SOL",
    feedId: "0x01534f4c2f55534400000000000000000000000000", // FTSO v2 SOL/USD,
    vammDepthUsd: 5_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_250_000,
  },
  {
    id: "DOGE-dUSD",
    symbol: "DOGE/dUSD",
    base: "DOGE",
    feedId: "0x01444f47452f555344000000000000000000000000", // FTSO v2 DOGE/USD,
    vammDepthUsd: 2_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
];

export const marketById = (id: string): MarketDef | undefined =>
  MARKETS.find((m) => m.id === id);
