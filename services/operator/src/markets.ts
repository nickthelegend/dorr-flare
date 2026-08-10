/**
 * dorr markets — 6 perps, margined in FXRP (Flare FAssets), priced from Flare's
 * on-chain FTSO v2 oracle.
 *
 * Feed ids are FTSO v2 bytes21 identifiers: 0x01 (crypto category) + the ASCII
 * ticker, right-zero-padded to 21 bytes. Every id below was read live from the
 * FTSO v2 contract on Coston2; a failing feed is logged loudly and its market is
 * disabled rather than mispriced.
 *
 * Markets are USD-denominated (matching the oracle) and collateralised in FXRP,
 * which is how a real perp works: you quote in dollars, you post margin in a token.
 */
export interface MarketDef {
  /** dorr market id, e.g. "FLR-USD" (pairId in engine terms). */
  id: string;
  symbol: string;
  base: string;
  /** FTSO v2 feed id (bytes21: 0x01 category + ASCII name, zero-padded). */
  feedId: string;
  /**
   * Virtual AMM depth: quote-side notional (USD) of the virtual pool. Set per
   * market to track real relative liquidity — two markets sharing a depth would
   * quote identical slippage for the same order, which is neither true nor
   * convincing.
   */
  vammDepthUsd: number;
  /** Recenter vAMM to the oracle when drift exceeds this many bps. */
  recenterBps: number;
  maxLeverage: number;
  /** Risk limit: max total open interest (notional, USD) across all traders. */
  maxOiUsd: number;
}

export const MARKETS: MarketDef[] = [
  {
    // Flare's native token — the home market.
    id: "FLR-USD",
    symbol: "FLR/USD",
    base: "FLR",
    feedId: "0x01464c522f55534400000000000000000000000000",
    vammDepthUsd: 1_500_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
  {
    // XRP — the asset behind FXRP, so the collateral and the market rhyme.
    id: "XRP-USD",
    symbol: "XRP/USD",
    base: "XRP",
    feedId: "0x015852502f55534400000000000000000000000000",
    vammDepthUsd: 6_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_250_000,
  },
  {
    id: "BTC-USD",
    symbol: "BTC/USD",
    base: "BTC",
    feedId: "0x014254432f55534400000000000000000000000000",
    vammDepthUsd: 12_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "ETH-USD",
    symbol: "ETH/USD",
    base: "ETH",
    feedId: "0x014554482f55534400000000000000000000000000",
    vammDepthUsd: 8_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 2_500_000,
  },
  {
    id: "SOL-USD",
    symbol: "SOL/USD",
    base: "SOL",
    feedId: "0x01534f4c2f55534400000000000000000000000000",
    vammDepthUsd: 4_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_250_000,
  },
  {
    id: "DOGE-USD",
    symbol: "DOGE/USD",
    base: "DOGE",
    feedId: "0x01444f47452f555344000000000000000000000000",
    vammDepthUsd: 2_500_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 500_000,
  },
];

export const marketById = (id: string): MarketDef | undefined =>
  MARKETS.find((m) => m.id === id);
