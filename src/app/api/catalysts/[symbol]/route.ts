import { NextResponse } from "next/server";
import { loadIssuerCatalysts } from "@/lib/server/issuer-catalysts";

export const runtime = "nodejs";
export async function GET(_: Request, context: { params: Promise<{ symbol: string }> }) {
  const symbol = (await context.params).symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) return NextResponse.json({ error: "Use a US ticker of one to five letters." }, { status: 400 });
  // The filing ledger changes when EDGAR accepts a document, not continuously.
  return NextResponse.json(await loadIssuerCatalysts(symbol), {
    headers: { "Cache-Control": "private, max-age=900, stale-while-revalidate=86400" },
  });
}
