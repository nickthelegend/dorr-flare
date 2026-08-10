"use client";

import { CardanoProvider } from "@/components/providers/mesh-provider";
import TradingNavbar from "./navbar";
import TradingChart from "./chart";
import PublicFeed from "./public-feed";
import TradingPanel from "./trading-panel";
import Portfolio from "./portfolio";
import CollateralPanel from "./collateral-panel";
import RestingOrders from "./resting-orders";
import ActivityLog from "./activity-log";

export default function TerminalInner() {
  return (
    <CardanoProvider>
      <div className="min-h-screen bg-background">
        <TradingNavbar />
        <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-73px)]">
          {/* Left: chart + positions */}
          <div className="flex-1 p-2 md:p-4 flex flex-col gap-2 md:gap-4 min-w-0">
            <div className="h-[300px] sm:h-[400px] lg:h-[58%]">
              <TradingChart />
            </div>
            <div className="h-[300px] sm:h-[400px] lg:h-[42%]">
              <Portfolio />
            </div>
          </div>

          {/* Right: public feed + activity log + trade/collateral */}
          <div className="flex flex-col md:flex-row lg:flex-row">
            <div className="w-full md:w-1/2 lg:w-80 p-2 md:p-4 lg:pl-0 flex flex-col gap-2 md:gap-4 lg:h-full">
              <div className="h-[400px] md:h-[380px] lg:h-1/2 lg:min-h-0">
                <PublicFeed />
              </div>
              <div className="h-[400px] md:h-[380px] lg:h-1/2 lg:min-h-0">
                <ActivityLog />
              </div>
            </div>
            <div className="w-full md:w-1/2 lg:w-80 p-2 md:p-4 lg:pl-0 flex flex-col gap-2 md:gap-4 lg:h-full lg:overflow-y-auto">
              <TradingPanel />
              <RestingOrders />
              <CollateralPanel />
            </div>
          </div>
        </div>
      </div>
    </CardanoProvider>
  );
}
