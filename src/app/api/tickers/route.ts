import { NextResponse } from "next/server";
import { searchTickers } from "@/lib/server/sec-tickers";

export const runtime = "nodejs";

/**
 * Ticker suggestions for the add-to-watchlist field.
 *
 * Served from the SEC company list this workstation already keeps, so a
 * keystroke costs a lookup in memory rather than a request to anyone.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim().length < 1) return NextResponse.json({ suggestions: [] });
  const suggestions = await searchTickers(query, 8);
  return NextResponse.json(
    { suggestions },
    // The company list changes when a company lists or delists, not by the minute.
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
