import { NextResponse } from "next/server";
import { buildStockPayload } from "@/lib/server/stock-payload";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const symbol = (await context.params).symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) return NextResponse.json({ error: "Use a US ticker of one to five letters." }, { status: 400 });

  const parameters = new URL(request.url).searchParams;
  const summary = parameters.get("view") === "summary";
  // Set only by the refresh button. It bypasses the stored snapshot and reads
  // upstream, which is what the reader is asking for by pressing it.
  const force = parameters.get("force") === "1";
  const payload = await buildStockPayload(symbol, { summary, force });

  // Daily bars and annual filings change at most once a session, but the
  // watchlist refetches every one of these on each navigation. Without a cache
  // header a seven-name list was twenty-one uncached upstream reads per visit.
  // The summary view is the hot path, so it gets the longer window.
  return NextResponse.json(payload, {
    headers: {
      // A forced read is never cached: storing it would answer the next
      // ordinary navigation from a response the reader paid an upstream
      // request for, and hide the following refresh behind it.
      "Cache-Control": force
        ? "private, no-store"
        : summary
          ? "private, max-age=300, stale-while-revalidate=3600"
          : "private, max-age=120, stale-while-revalidate=1800",
    },
  });
}
