import { NextResponse } from "next/server";
import { loadStockOwnership, type OwnershipScope } from "@/lib/server/sec-ownership";

export const runtime = "nodejs";

const SCOPES: OwnershipScope[] = ["all", "filings", "institutional"];

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const symbol = (await context.params).symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) return NextResponse.json({ error: "Use a US ticker of one to five letters." }, { status: 400 });

  // The 13F archive is the slow half. Asking for the two halves separately lets
  // the insider tape and the FINRA figures render while it is still arriving.
  const requested = new URL(request.url).searchParams.get("scope");
  const scope: OwnershipScope = SCOPES.includes(requested as OwnershipScope) ? (requested as OwnershipScope) : "all";

  // 13F is quarterly and FINRA short interest is twice-monthly. Nothing here
  // moves within a session, so revisiting a ticker should never re-read them.
  return NextResponse.json(await loadStockOwnership(symbol, scope), {
    headers: { "Cache-Control": "private, max-age=900, stale-while-revalidate=86400" },
  });
}
