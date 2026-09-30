import { NextResponse } from "next/server";
import { flattenHtml, proseOf } from "@/lib/analyst-forecast";
import { parseDividendDetail, parseIssuerProfile } from "@/lib/issuer-profile";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

export const runtime = "nodejs";
const NAMESPACE = "issuer-profile";
const VERSION = "issuer-profile-v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

const HEADERS = { Accept: "text/html", "User-Agent": "GEXLab/3.0 research workstation" };

async function page(url: string) {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Issuer profile returned ${response.status}`);
  return flattenHtml(await response.text());
}

/**
 * The next earnings date, the dividend, and what the company does.
 *
 * Two documents rather than one: the quote page carries the earnings date and
 * the description, and the dividend page carries the payout record that a
 * single yield figure does not convey. An issuer that pays nothing has no
 * dividend page worth reading, so that half is allowed to fail on its own
 * rather than taking the earnings date down with it.
 */
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const symbol = (await context.params).symbol.toLowerCase();
  if (!/^[a-z]{1,5}$/.test(symbol)) return NextResponse.json({ error: "Use a one-to-five letter ticker." }, { status: 400 });
  const key = symbol.toUpperCase();

  const stored = getSnapshot<Record<string, unknown>>(NAMESPACE, key);
  if (stored?.methodologyVersion === VERSION && snapshotIsFresh(stored)) {
    return NextResponse.json({ ...stored.payload, stale: false }, { headers: { "Cache-Control": "private, max-age=900" } });
  }

  const url = `https://stockanalysis.com/stocks/${symbol}/`;
  const dividendUrl = `${url}dividend/`;
  try {
    const payload = await dedupeRequest(`issuer-profile:${symbol}`, async () => {
      const flat = await page(url);
      const profile = parseIssuerProfile(flat, proseOf(flat), key);
      const dividend = await page(dividendUrl).then(parseDividendDetail).catch(() => null);
      if (
        profile.earningsDate === null &&
        profile.description === null &&
        profile.marketCap === null &&
        dividend === null
      ) {
        throw new Error("No issuer profile was published for this ticker.");
      }
      return {
        symbol: key,
        ...profile,
        dividendDetail: dividend,
        source: "StockAnalysis",
        sourceUrl: url,
        checkedAt: new Date().toISOString(),
      };
    });
    putSnapshot({
      namespace: NAMESPACE,
      key,
      payload,
      sourceTime: payload.checkedAt,
      fetchedAt: payload.checkedAt,
      refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
      methodologyVersion: VERSION,
    });
    return NextResponse.json({ ...payload, stale: false }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    // A saved profile beats nothing: an earnings date days old is still the
    // right earnings date.
    if (stored?.payload) return NextResponse.json({ ...stored.payload, stale: true }, { status: 200 });
    return NextResponse.json(
      { symbol: key, error: error instanceof Error ? error.message : "Issuer profile unavailable." },
      { status: 200 },
    );
  }
}
