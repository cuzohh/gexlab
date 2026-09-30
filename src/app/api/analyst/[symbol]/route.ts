import { NextResponse } from "next/server";
import {
  flattenHtml,
  parseConsensus,
  parseFiscalYears,
  parseForecastRange,
  proseOf,
} from "@/lib/analyst-forecast";
import { loadEstimateTrend, recordEstimateObservation } from "@/lib/server/estimate-revisions";
import { dedupeRequest } from "@/lib/server/request-deduper";

export const runtime = "nodejs";

/**
 * Published analyst consensus, price targets, and the financial forecast.
 *
 * The parsing lives in `@/lib/analyst-forecast` so it can be exercised against
 * saved markup without a network call.
 */
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const symbol = (await context.params).symbol.toLowerCase();
  if (!/^[a-z]{1,5}$/.test(symbol)) return NextResponse.json({ error: "Use a one-to-five letter ticker." }, { status: 400 });
  const url = `https://stockanalysis.com/stocks/${symbol}/forecast/`;
  try {
    // Two panels on the detail route ask for the same ticker, and without
    // deduping that was two scrapes of the same document, each holding a
    // twenty-second timeout open.
    const payload = await dedupeRequest(`analyst-consensus:${symbol}`, async () => {
      const response = await fetch(url, {
        headers: { Accept: "text/html", "User-Agent": "GEXLab/3.0 research workstation" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Analyst consensus returned ${response.status}`);

      const flat = flattenHtml(await response.text());
      const targets = parseConsensus(proseOf(flat));
      const fiscalYears = parseFiscalYears(flat);

      if (targets.count === null && targets.average === null && targets.consensus === null && !fiscalYears.length) {
        throw new Error("No analyst consensus was published for this ticker.");
      }

      return {
        symbol: symbol.toUpperCase(),
        ...targets,
        fiscalYears,
        revenueForecast: parseForecastRange(flat, "Revenue"),
        epsForecast: parseForecastRange(flat, "EPS"),
        source: "StockAnalysis · S&P Global Market Intelligence",
        sourceUrl: url,
        checkedAt: new Date().toISOString(),
      };
    });
    // Record one dated observation each day, as five numbers rather than the
    // whole document. The revision is the point of keeping any history at all,
    // and keeping the full payload for every ticker every day to derive it
    // would cost tens of megabytes a year to answer a question worth a
    // hundred bytes.
    const forecast = payload.fiscalYears.find((row) => row.forecast) ?? null;
    recordEstimateObservation(symbol, {
      target: payload.average,
      analysts: payload.count,
      eps: forecast?.eps ?? null,
      revenue: forecast?.revenue ?? null,
      year: forecast?.label ?? null,
    });
    const trend = loadEstimateTrend(symbol);

    // Consensus and forecasts are republished daily at most.
    return NextResponse.json({
      ...payload,
      revision: trend.windows[0]?.comparedTo
        ? { comparedTo: trend.windows[0].comparedTo, targetChange: trend.windows[0].targetChange, analystCountChange: trend.windows[0].analystChange }
        : null,
      trend,
    }, {
      headers: { "Cache-Control": "private, max-age=900, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return NextResponse.json(
      { symbol: symbol.toUpperCase(), error: error instanceof Error ? error.message : "Analyst consensus unavailable." },
      { status: 200 },
    );
  }
}
