import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { NASDAQ_100 } from "@/lib/indices";
import { secRequestHeaders } from "@/lib/server/sec-request";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

/**
 * The SEC's ticker-to-CIK map.
 *
 * One file listing every reporting issuer, and both the fact loader and the
 * ownership loader were fetching it with `cache: "no-store"` on every request —
 * a multi-megabyte download repeated for each ticker and each panel, before any
 * of the work the reader actually asked for could begin. It changes when a
 * registrant is added, so a day is a generous refresh interval.
 */

const SOURCE_VERSION = "sec-company-tickers-v1";
const CACHE_MS = 24 * 60 * 60 * 1000;

export type IssuerRecord = { ticker: string; title: string; cik: string; cikNumber: number };

type TickerMap = Record<string, { ticker: string; title: string; cik_str: number }>;

/** symbol → issuer, built once per refresh rather than scanned per lookup. */
async function loadIndex(): Promise<Record<string, IssuerRecord>> {
  const stored = getSnapshot<Record<string, IssuerRecord>>("sec-company-tickers", "all");
  if (stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) return stored.payload;

  return dedupeRequest("sec-company-tickers", async () => {
    try {
      const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: secRequestHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`SEC ticker map returned ${response.status}`);
      const map = (await response.json()) as TickerMap;
      const index: Record<string, IssuerRecord> = {};
      for (const entry of Object.values(map)) {
        if (!entry?.ticker) continue;
        index[entry.ticker.toUpperCase()] = {
          ticker: entry.ticker.toUpperCase(),
          title: entry.title,
          cik: String(entry.cik_str).padStart(10, "0"),
          cikNumber: entry.cik_str,
        };
      }
      putSnapshot({
        namespace: "sec-company-tickers",
        key: "all",
        payload: index,
        sourceTime: null,
        fetchedAt: new Date().toISOString(),
        refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return index;
    } catch (error) {
      // A saved map that is merely old still resolves every established ticker.
      if (stored?.payload) return stored.payload;
      throw error;
    }
  });
}

/** The issuer behind a ticker, or null when it is not an SEC registrant. */
export async function findIssuer(symbol: string): Promise<IssuerRecord | null> {
  const index = await loadIndex();
  return index[symbol.toUpperCase()] ?? null;
}

/**
 * Symbols this workstation supports that the SEC list does not carry.
 *
 * Company tickers cover registrants, so an exchange-traded fund or an index —
 * the very things the benchmark and option panels are built around — never
 * appear. Searching for "SPY" against the SEC list alone returns nothing, which
 * would be a strange answer from a terminal whose front page compares
 * everything to it.
 */
const NON_REGISTRANTS: { ticker: string; title: string }[] = [
  { ticker: "SPY", title: "SPDR S&P 500 ETF Trust" },
  { ticker: "QQQ", title: "Invesco QQQ Trust (Nasdaq-100)" },
  { ticker: "SPX", title: "S&P 500 Index" },
  { ticker: "NDX", title: "Nasdaq-100 Index" },
  { ticker: "IWM", title: "iShares Russell 2000 ETF" },
  { ticker: "DIA", title: "SPDR Dow Jones Industrial Average ETF" },
  { ticker: "SOXX", title: "iShares Semiconductor ETF" },
  { ticker: "XLK", title: "Technology Select Sector SPDR" },
  { ticker: "XLF", title: "Financial Select Sector SPDR" },
  { ticker: "XLE", title: "Energy Select Sector SPDR" },
  { ticker: "XLV", title: "Health Care Select Sector SPDR" },
  { ticker: "XLY", title: "Consumer Discretionary Select Sector SPDR" },
  { ticker: "XLC", title: "Communication Services Select Sector SPDR" },
  { ticker: "XLP", title: "Consumer Staples Select Sector SPDR" },
  { ticker: "XLI", title: "Industrial Select Sector SPDR" },
  { ticker: "XLU", title: "Utilities Select Sector SPDR" },
  { ticker: "XLB", title: "Materials Select Sector SPDR" },
  { ticker: "XLRE", title: "Real Estate Select Sector SPDR" },
];

export type TickerSuggestion = { symbol: string; name: string };

const SUPPORTED_FUNDS = new Set(NON_REGISTRANTS.map((entry) => entry.ticker));

/**
 * Ticker suggestions for a partial query, best match first.
 *
 * Ranked rather than merely filtered: someone typing "AAP" wants AAPL near the
 * top, not the first company alphabetically whose name happens to contain those
 * letters. An exact symbol wins, then a symbol that starts with the query, then
 * a company name that starts with it, then a name that merely contains it —
 * and shorter symbols break ties, since those are the widely held ones.
 */
export async function searchTickers(query: string, limit = 8): Promise<TickerSuggestion[]> {
  const needle = query.trim().toUpperCase();
  if (!needle) return [];
  let index: Record<string, IssuerRecord>;
  try {
    index = await loadIndex();
  } catch {
    index = {};
  }

  // One entry per symbol. The SEC list already carries the larger funds, so
  // adding the supported non-registrants blindly listed SPY and QQQ twice.
  const bySymbol = new Map<string, TickerSuggestion>();
  for (const entry of Object.values(index)) bySymbol.set(entry.ticker, { symbol: entry.ticker, name: entry.title });
  for (const entry of NON_REGISTRANTS) if (!bySymbol.has(entry.ticker)) bySymbol.set(entry.ticker, { symbol: entry.ticker, name: entry.title });
  const candidates = [...bySymbol.values()];

  const scored: { entry: TickerSuggestion; rank: number }[] = [];
  for (const entry of candidates) {
    const symbol = entry.symbol;
    const name = entry.name.toUpperCase();
    const rank =
      symbol === needle ? 0
        : symbol.startsWith(needle) ? 1
          : name.startsWith(needle) ? 2
            : name.includes(needle) ? 3
              : -1;
    // An exact symbol is what the reader typed and wins outright.
    if (rank === 0) { scored.push({ entry, rank: -1 }); continue; }
    if (rank < 0) continue;
    // A household name outranks an obscure one that merely shares the prefix.
    // Typing "AAP" returned Advance Auto Parts, Ascentage Pharma and Apple
    // iSports before Apple, because nothing distinguished them but the
    // alphabet.
    const prominent = NASDAQ_100.has(symbol) || SUPPORTED_FUNDS.has(symbol);
    scored.push({ entry, rank: rank * 2 + (prominent ? 0 : 1) });
    // The full list is ten thousand issuers and a query of one or two letters
    // matches thousands of them. Collecting every match to sort it wastes the
    // work; anything past a few hundred cannot change the top eight.
    if (scored.length > 400) break;
  }

  return scored
    .sort((left, right) =>
      left.rank - right.rank ||
      left.entry.symbol.length - right.entry.symbol.length ||
      left.entry.symbol.localeCompare(right.entry.symbol))
    .slice(0, limit)
    .map((row) => row.entry);
}
