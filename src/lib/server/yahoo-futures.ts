import "server-only";

import { buildOvernightContext, parseYahooChartPayload, type OvernightContext } from "@/lib/overnight-context";
import { dedupeRequest } from "@/lib/server/request-deduper";
import {
  getSnapshot,
  loadOvernightCoverage,
  putSnapshot,
  saveOvernightSession,
  snapshotIsFresh,
  type StoredSnapshot,
} from "@/lib/server/snapshot-store";

const SOURCE_VERSION = "yahoo-overnight-v1";
const QUOTE_VERSION = "yahoo-futures-quote-v1";
const REFRESH_MS = 5 * 60 * 1000;

export type YahooFuturesQuote = {
  symbol: "NQ" | "ES";
  price: number;
  observedAt: string;
  source: "Yahoo Finance 5-minute futures";
  delayed: true;
  stale?: boolean;
};

async function fetchBars(symbol: "NQ=F" | "ES=F") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&events=history`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Yahoo futures request returned ${response.status}`);
  return parseYahooChartPayload(await response.json());
}

export async function loadYahooFuturesQuote(symbol: "NQ" | "ES"): Promise<YahooFuturesQuote> {
  const cached = getSnapshot<YahooFuturesQuote>("futures-quote", symbol);
  if (cached && cached.methodologyVersion === QUOTE_VERSION && snapshotIsFresh(cached)) {
    return { ...cached.payload, stale: false };
  }

  return dedupeRequest(`futures-quote:${symbol}`, async () => {
    const rechecked = getSnapshot<YahooFuturesQuote>("futures-quote", symbol);
    if (rechecked && rechecked.methodologyVersion === QUOTE_VERSION && snapshotIsFresh(rechecked)) {
      return { ...rechecked.payload, stale: false };
    }
    try {
      const bars = await fetchBars(symbol === "NQ" ? "NQ=F" : "ES=F");
      const latest = bars
        .filter((bar) => bar.close !== null && Number.isFinite(bar.close) && bar.close > 0)
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
      if (!latest || latest.close === null) throw new Error(`Yahoo returned no current ${symbol} quote.`);
      const payload: YahooFuturesQuote = {
        symbol,
        price: latest.close,
        observedAt: latest.timestamp,
        source: "Yahoo Finance 5-minute futures",
        delayed: true,
      };
      putSnapshot({
        namespace: "futures-quote",
        key: symbol,
        payload,
        sourceTime: payload.observedAt,
        refreshAfter: new Date(Date.now() + REFRESH_MS).toISOString(),
        methodologyVersion: QUOTE_VERSION,
      });
      return { ...payload, stale: false };
    } catch (error) {
      if (cached?.methodologyVersion === QUOTE_VERSION) return { ...cached.payload, stale: true };
      throw error;
    }
  });
}

async function refreshOvernightContext(input: {
  sessionDate: string;
  priorSessionDate: string;
}, key: string, cached: StoredSnapshot<OvernightContext> | null): Promise<OvernightContext> {
  const refreshed = getSnapshot<OvernightContext>("futures-overnight", key);
  if (refreshed && refreshed.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(refreshed)) return refreshed.payload;

  try {
    const [nq, es] = await Promise.all([fetchBars("NQ=F"), fetchBars("ES=F")]);
    const basePayload = buildOvernightContext({
      sessionDate: input.sessionDate,
      priorSessionDate: input.priorSessionDate,
      nq,
      es,
    });
    // A partial NQ/ES window can still be useful for the current panel, but
    // it is not a complete validation observation. Do not let it inflate the
    // history count that the page uses to describe confidence.
    if (basePayload.status === "available") {
      saveOvernightSession({
        sessionDate: basePayload.sessionDate,
        payload: basePayload,
        sourceTime: basePayload.observedThrough,
      });
    }
    const coverage = loadOvernightCoverage();
    const payload = {
      ...basePayload,
      history: { ...coverage, required: 30 },
    };
    putSnapshot({
      namespace: "futures-overnight",
      key,
      payload,
      sourceTime: payload.observedThrough,
      refreshAfter: new Date(Date.now() + REFRESH_MS).toISOString(),
      methodologyVersion: SOURCE_VERSION,
    });
    return payload;
  } catch (error) {
    const fallback = [refreshed, cached].find(
      (snapshot) => snapshot?.methodologyVersion === SOURCE_VERSION,
    );
    if (fallback) {
      const coverage = loadOvernightCoverage();
      return {
        ...fallback.payload,
        stale: true,
        note: error instanceof Error
          ? `Yahoo futures refresh failed; showing the last saved overnight snapshot. ${error.message}`
          : "Yahoo futures refresh failed; showing the last saved overnight snapshot.",
        history: { ...coverage, required: 30 },
      };
    }
    const basePayload = buildOvernightContext({
      sessionDate: input.sessionDate,
      priorSessionDate: input.priorSessionDate,
      nq: [],
      es: [],
      note: error instanceof Error ? `Yahoo futures unavailable: ${error.message}` : "Yahoo futures unavailable.",
    });
    const coverage = loadOvernightCoverage();
    const payload = {
      ...basePayload,
      history: { ...coverage, required: 30 },
    };
    putSnapshot({
      namespace: "futures-overnight",
      key,
      payload,
      refreshAfter: new Date(Date.now() + REFRESH_MS).toISOString(),
      methodologyVersion: SOURCE_VERSION,
    });
    return payload;
  }
}

export async function loadYahooOvernightContext(input: {
  sessionDate: string;
  priorSessionDate: string;
  /** Return the last usable session immediately and refresh Yahoo in the background. */
  staleWhileRevalidate?: boolean;
}): Promise<OvernightContext> {
  const key = `${input.priorSessionDate}:${input.sessionDate}`;
  const cached = getSnapshot<OvernightContext>("futures-overnight", key);
  if (cached && cached.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) return cached.payload;
  const refresh = () => dedupeRequest(`futures-overnight:${key}`, () => refreshOvernightContext(input, key, cached));
  if (cached && cached.methodologyVersion === SOURCE_VERSION && input.staleWhileRevalidate) {
    void refresh().catch(() => undefined);
    const coverage = loadOvernightCoverage();
    return {
      ...cached.payload,
      stale: true,
      note: "Saved overnight snapshot; refreshing Yahoo futures in the background.",
      history: { ...coverage, required: 30 },
    };
  }
  return refresh();
}
