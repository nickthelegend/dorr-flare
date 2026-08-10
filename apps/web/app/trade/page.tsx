import type { Metadata } from "next";
import TradingTerminal from "@/components/trading/terminal";

export const metadata: Metadata = {
  title: "Trade",
  description:
    "The dorr terminal — FXRP-margined perpetuals on Flare, with orders sealed until the batch clears.",
};

export default function TradePage() {
  return <TradingTerminal />;
}
