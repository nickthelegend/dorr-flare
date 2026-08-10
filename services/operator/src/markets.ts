/**
 * dorr v1 markets — 5 perps, all quoted in dUSD, priced from Pyth Hermes (off-chain).
 * Feed ids are Pyth price-feed identifiers (verified at boot against Hermes;
 * a failing id is logged loudly and the market is disabled rather than mispriced).
 */
export interface MarketDef {
  /** dorr market id, e.g. "ADA-dUSD" (pairId in engine terms). */
  id: string;
  symbol: string;
  base: string;
  /** Pyth price feed id (hex, no 0x prefix required by Hermes v2). */
  pythFeedId: string;
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
    pythFeedId: "2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d",
    vammDepthUsd: 2_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
  {
    id: "BTC-dUSD",
    symbol: "BTC/dUSD",
    base: "BTC",
    pythFeedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    vammDepthUsd: 10_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "ETH-dUSD",
    symbol: "ETH/dUSD",
    base: "ETH",
    pythFeedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    vammDepthUsd: 10_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "SOL-dUSD",
    symbol: "SOL/dUSD",
    base: "SOL",
    pythFeedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    vammDepthUsd: 5_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_250_000,
  },
  {
    id: "DOGE-dUSD",
    symbol: "DOGE/dUSD",
    base: "DOGE",
    pythFeedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
    vammDepthUsd: 2_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
];

export const marketById = (id: string): MarketDef | undefined =>
  MARKETS.find((m) => m.id === id);
