import type { Metadata } from "next";
import { Watchlist } from "@/components/stocks/watchlist";

export const metadata: Metadata = { title: "Equity desk · GEXLab V3" };

export default function StocksPage() {
  return <Watchlist />;
}
