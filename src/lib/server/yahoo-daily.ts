import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { easternDate, isRegularMarketOpen } from "@/lib/market-time";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

export type DailyOhlc = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type YahooDailyData = {
  rows: DailyOhlc[];
  stale: boolean;
};

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
    } | null>;
  };
};

const SOURCE_VERSION = "yahoo-daily-ohlc-v1";
const CLOSED_CACHE_MS = 6 * 60 * 60 * 1000;
const OPEN_CACHE_MS = 5 * 60 * 1000;

/**
 * How long this series stays fresh, which depends on whether the market is open.
 *
 * A flat six hours meant a series pulled at 09:02 Eastern — before the opening
 * bell — stayed "fresh" until 15:02, so the whole session was served Friday's
 * close while the tape moved. The daily bar for the current session is a live,
 * still-forming bar, so while the market is open it is worth re-reading every
 * few minutes; once it has settled, nothing about it changes until the next
 * open and six hours is generous.
 */
function cacheMs(now = new Date()) {
  return isRegularMarketOpen(now) ? OPEN_CACHE_MS : CLOSED_CACHE_MS;
}

export function parseYahooDailyOhlc(payload: unknown): DailyOhlc[] {
  const result = (payload as YahooChart)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  return (result?.timestamp ?? []).flatMap((timestamp, index) => {
    const open = Number(quote?.open?.[index]);
    const high = Number(quote?.high?.[index]);
    const low = Number(quote?.low?.[index]);
    const close = Number(quote?.close?.[index]);
    if (![timestamp, open, high, low, close].every(Number.isFinite) || high < low || low <= 0) return [];
    return [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), open, high, low, close }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The saved series, if it is still fresh, without touching the network.
 *
 * Lets a server component render a page from what is already stored and skip
 * the client's request entirely. A miss returns null and the client fetches as
 * before, so a cold cache never blocks the first byte.
 */
export function peekYahooDailyOhlc(symbol: string): DailyOhlc[] | null {
  const stored = getSnapshot<DailyOhlc[]>("yahoo-daily-ohlc", symbol.toUpperCase());
  return stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored) ? stored.payload : null;
}

/**
 * The shortest interval a forced read may repeat at.
 *
 * A refresh the reader asked for should go upstream rather than answer from a
 * snapshot taken four minutes ago — that is the whole point of pressing it. It
 * should not, however, become a way to issue one request per click for as fast
 * as a mouse can be clicked, so a forced read still declines to repeat itself
 * within a few seconds.
 */
const FORCE_FLOOR_MS = 10 * 1000;

export async function loadYahooDailyOhlc(symbol: string, { force = false }: { force?: boolean } = {}): Promise<YahooDailyData> {
  const key = symbol.toUpperCase();
  const stored = getSnapshot<DailyOhlc[]>("yahoo-daily-ohlc", key);
  const withinFloor = force && stored ? Date.now() - Date.parse(stored.fetchedAt) < FORCE_FLOOR_MS : false;
  if (stored?.methodologyVersion === SOURCE_VERSION && (withinFloor || (!force && snapshotIsFresh(stored)))) {
    return { rows: stored.payload, stale: false };
  }
  return dedupeRequest(`yahoo-daily-ohlc:${symbol}`, async () => {
    try {
      const ticker = key === "NDX" ? "^NDX" : key === "SPX" ? "^GSPC" : key;
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=history`,
        { cache: "no-store", headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error(`Yahoo daily ${symbol} request returned ${response.status}`);
      const rows = parseYahooDailyOhlc(await response.json());
      if (rows.length < 280) throw new Error(`Yahoo daily ${symbol} response was incomplete`);
      putSnapshot({
        namespace: "yahoo-daily-ohlc",
        key,
        payload: rows,
        // The current session's bar is still forming, so it carries the time it
        // was read rather than a 21:00 settle it has not reached.
        sourceTime: isRegularMarketOpen() && rows.at(-1)?.date === easternDate()
          ? new Date().toISOString()
          : `${rows.at(-1)?.date ?? ""}T21:00:00.000Z`,
        refreshAfter: new Date(Date.now() + cacheMs()).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return { rows, stale: false };
    } catch {
      if (stored?.payload.length) return { rows: stored.payload, stale: true };
      return { rows: [], stale: true };
    }
  });
}
