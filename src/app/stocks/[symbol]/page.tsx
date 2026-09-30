import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StockDetail } from "@/components/stocks/detail";
import type { StockData } from "@/components/stocks/types";
import { peekStockPayload } from "@/lib/server/stock-payload";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} · GEXLab V3` };
}

export default async function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const ticker = symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(ticker)) notFound();
  // Free when the snapshot is fresh, null when it is not; either way nothing
  // here waits on the network.
  const initialStock = peekStockPayload(ticker) as StockData | null;
  return <StockDetail symbol={ticker} view="overview" initialStock={initialStock} />;
}
