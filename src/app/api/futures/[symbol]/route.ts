import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { easternDate, previousWeekday } from "@/lib/market-time";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";
import { loadYahooFuturesQuote, loadYahooOvernightContext } from "@/lib/server/yahoo-futures";

export const runtime = "nodejs";

type FuturesSymbol = "NQ" | "ES";

type SettlementResponse = {
  symbol: FuturesSymbol;
  contract: string;
  price: number;
  tradeDate: string;
  kind: "official-settlement";
  source: string;
  delayed: true;
  retrievedAt?: string;
  stale?: boolean;
};

const BULLETIN_URL =
  "https://www.cmegroup.com/daily_bulletin/current/Section11_Equity_And_Index_Futures.pdf";

const METHODOLOGY_VERSION = "daily-settlement-v3.1.0";

function bulletinDate(text: string) {
  const match = text.match(/PG11\s+(?:BULLETIN\s+#\s+\d+@\s+)?(?:Mon|Tue|Wed|Thu|Fri),\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
  if (!match) throw new Error("Settlement bulletin trade date was not found.");
  const parsed = new Date(`${match[1]} 12:00:00 UTC`);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Settlement bulletin trade date was invalid.");
  return parsed.toISOString().slice(0, 10);
}

function frontSettlement(text: string, heading: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headingIndex = lines.findIndex((line) => line === heading);
  if (headingIndex < 0) throw new Error(`${heading} was not found in the settlement bulletin.`);

  const row = lines.slice(headingIndex + 1).find((line) => /^[A-Z]{3}\d{2}\s/.test(line));
  if (!row) throw new Error(`The front ${heading} contract was not found.`);
  const rowIndex = lines.indexOf(row);
  const contract = row.match(/^([A-Z]{3}\d{2})\s/)?.[1];
  const settlementText = row.match(/\t(\d+\.\d+)(?:\s+\d+)?$/)?.[1];
  if (!contract || !settlementText) throw new Error(`The ${heading} settlement could not be parsed.`);

  let normalized = settlementText;
  const decimals = normalized.split(".")[1]?.length ?? 0;
  if (decimals === 1) {
    const continuation = lines[rowIndex + 1]?.match(/^(\d)\s/);
    if (continuation) normalized += continuation[1];
  }
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`The ${heading} settlement was invalid.`);
  return { contract, price };
}

function expectedSettlementDate() {
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(eastern.find((entry) => entry.type === type)?.value ?? 0);
  const afterPublicationWindow = part("hour") * 60 + part("minute") >= 70;
  const reference = afterPublicationWindow ? new Date() : new Date(Date.now() - 24 * 60 * 60 * 1000);
  return previousWeekday(reference);
}

async function settlements() {
  const stored = getSnapshot<Record<FuturesSymbol, SettlementResponse>>(
    "futures-settlement",
    "front-contracts",
  );
  const storedTradeDate = stored?.payload.NQ?.tradeDate;
  if (
    stored &&
    ((storedTradeDate !== undefined && storedTradeDate >= expectedSettlementDate()) ||
      snapshotIsFresh(stored))
  ) {
    return { values: stored.payload, retrievedAt: stored.fetchedAt, stale: false };
  }

  return dedupeRequest("futures:settlements", async () => {
    const parser = new PDFParse({ url: BULLETIN_URL });
    try {
      const result = await parser.getText({ partial: [1] });
      const tradeDate = bulletinDate(result.text);
      const nq = frontSettlement(result.text, "EMINI NASD FUT");
      const es = frontSettlement(result.text, "EMINI S&P FUT");
      const shared = {
        tradeDate,
        kind: "official-settlement" as const,
        source: "Daily settlement",
        delayed: true as const,
      };
      const values: Record<FuturesSymbol, SettlementResponse> = {
        NQ: { symbol: "NQ", ...nq, ...shared },
        ES: { symbol: "ES", ...es, ...shared },
      };
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "futures-settlement",
        key: "front-contracts",
        payload: values,
        sourceTime: `${tradeDate}T21:00:00.000Z`,
        fetchedAt,
        refreshAfter: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        methodologyVersion: METHODOLOGY_VERSION,
      });
      return { values, retrievedAt: fetchedAt, stale: false };
    } catch (error) {
      if (stored) return { values: stored.payload, retrievedAt: stored.fetchedAt, stale: true };
      throw error;
    } finally {
      await parser.destroy();
    }
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await context.params;
  const symbol = rawSymbol.toUpperCase();
  if (symbol !== "NQ" && symbol !== "ES") {
    return NextResponse.json({ error: "Supported futures symbols are NQ and ES." }, { status: 400 });
  }

  try {
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "live") {
      const quote = await loadYahooFuturesQuote(symbol);
      return NextResponse.json(quote, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    }
    if (mode === "overnight") {
      const sessionDate = easternDate();
      const priorSessionDate = previousWeekday(new Date(`${sessionDate}T12:00:00Z`));
      const overnight = await loadYahooOvernightContext({
        sessionDate,
        priorSessionDate,
        staleWhileRevalidate: true,
      });
      return NextResponse.json(overnight, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    }
    const result = await settlements();
    return NextResponse.json({
      ...result.values[symbol],
      retrievedAt: result.retrievedAt,
      stale: result.stale,
    }, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement request failed." },
      { status: 502 },
    );
  }
}
