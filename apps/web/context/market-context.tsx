"use client";

import { createContext, useState, useContext, type ReactNode } from "react";

/**
 * Holds the selected dorr market id (e.g. "ADA-dUSD").
 * Live market data (prices, leverage caps) comes from useMarkets() polling.
 */
export const DEFAULT_MARKET_ID = "ADA-dUSD";

interface MarketContextType {
  selectedMarketId: string;
  setSelectedMarketId: (id: string) => void;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider = ({ children }: { children: ReactNode }) => {
  const [selectedMarketId, setSelectedMarketId] = useState<string>(DEFAULT_MARKET_ID);

  return (
    <MarketContext.Provider value={{ selectedMarketId, setSelectedMarketId }}>
      {children}
    </MarketContext.Provider>
  );
};

export const useMarketSelection = () => {
  const context = useContext(MarketContext);
  if (context === undefined) {
    throw new Error("useMarketSelection must be used within a MarketProvider");
  }
  return context;
};
