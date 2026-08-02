import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

export type DailyOhlc = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
const CACHE_MS = 6 * 60 * 60 * 1000;

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

export async function loadYahooDailyOhlc(symbol: "NDX" | "SPX"): Promise<DailyOhlc[]> {
  const key = symbol;
  const stored = getSnapshot<DailyOhlc[]>("yahoo-daily-ohlc", key);
  if (stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) return stored.payload;
  return dedupeRequest(`yahoo-daily-ohlc:${symbol}`, async () => {
    try {
      const ticker = symbol === "NDX" ? "^NDX" : "^GSPC";
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
        sourceTime: `${rows.at(-1)?.date ?? ""}T21:00:00.000Z`,
        refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return rows;
    } catch {
      if (stored?.payload.length) return stored.payload;
      return [];
    }
  });
}
