import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StockDetail } from "@/components/stocks/detail";
import { STOCK_VIEWS, type StockData, type StockView } from "@/components/stocks/types";
import { peekStockPayload } from "@/lib/server/stock-payload";

/** "overview" is the bare /stocks/[symbol] route, so it is not addressable here. */
const VIEWS = new Set<string>(STOCK_VIEWS.map((entry) => entry.view).filter((view) => view !== "overview"));

export async function generateMetadata({ params }: { params: Promise<{ symbol: string; view: string }> }): Promise<Metadata> {
  const { symbol, view } = await params;
  return { title: `${symbol.toUpperCase()} ${view} · GEXLab V3` };
}

export default async function StockResearchViewPage({ params }: { params: Promise<{ symbol: string; view: string }> }) {
  const { symbol, view } = await params;
  const ticker = symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(ticker)) notFound();
  if (!VIEWS.has(view)) notFound();
  const initialStock = peekStockPayload(ticker) as StockData | null;
  return <StockDetail symbol={ticker} view={view as StockView} initialStock={initialStock} />;
}
