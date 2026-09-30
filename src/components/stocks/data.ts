"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inBatches } from "@/lib/batch";
import type {
  AnalystData,
  CatalystData,
  FlowData,
  MacroData,
  OptionBridgeData,
  OwnershipData,
  ProfileData,
  StockData,
  StockView,
} from "@/components/stocks/types";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type Resource<T> = {
  data: T | null;
  state: LoadState;
  error: string | null;
  /** A refresh is in flight while the previous figures are still on screen. */
  refreshing?: boolean;
};

const IDLE: Resource<never> = { data: null, state: "idle", error: null };

/**
 * Fetch a JSON endpoint, or nothing at all when `url` is null.
 *
 * A null url is the mechanism the detail route uses to skip a source entirely.
 * Every panel used to mount on every view — the eight "views" were CSS
 * `display: none` over one fully rendered page — so opening Ownership also
 * scraped analyst consensus, pulled a full option chain, and read the SEC
 * filing ledger. Passing null here means the request is never made.
 */
export function useJson<T>(url: string | null, nonce = 0, force = false): Resource<T> {
  // The settled url travels with the result, so a result belonging to a
  // previous url is ignored rather than cleared. That keeps every setState
  // inside an async callback: nothing has to be reset on the way in, and the
  // loading state is derived rather than stored.
  const [settled, setSettled] = useState<{ url: string; nonce: number; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    // A reload bypasses the browser's own copy. The route sets a two-minute
    // max-age so ordinary navigation is cheap, which also means a plain refetch
    // would be answered from that copy and the button would appear to do
    // nothing. Only an explicit refresh pays the cost of going past it.
    // The force flag travels on the request, not in the hook's identity: adding
    // it to `url` would make a refresh look like a different resource and blank
    // the panels that are still showing the previous figures.
    const requestUrl = force && nonce > 0 ? `${url}${url.includes("?") ? "&" : "?"}force=1` : url;
    fetch(requestUrl, { signal: controller.signal, cache: nonce > 0 ? "reload" : "default" })
      .then(async (response) => {
        const payload = (await response.json()) as T & { error?: string };
        if (payload && typeof payload === "object" && payload.error) throw new Error(payload.error);
        setSettled({ url, nonce, data: payload, error: null });
      })
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setSettled({ url, nonce, data: null, error: reason.message });
      });
    return () => controller.abort();
  }, [url, nonce, force]);

  if (!url) return IDLE;
  // A refresh keeps the figures it is replacing. Dropping to the loading state
  // would blank every panel back to a skeleton and rebuild the page, which is
  // the one thing a refresh button should not do: the reader asked for new
  // numbers, not for the page to go away and come back.
  if (!settled || settled.url !== url) return { data: null, state: "loading", error: null };
  if (settled.nonce !== nonce) {
    return settled.data
      ? { data: settled.data, state: "ready", error: null, refreshing: true }
      : { data: null, state: "loading", error: null, refreshing: true };
  }
  return settled.error
    ? { data: null, state: "error", error: settled.error }
    : { data: settled.data, state: "ready", error: null };
}

/** Which upstream sources a view actually reads. */
type Source = "stock" | "options" | "analyst" | "ownership" | "catalysts" | "macro" | "profile";

const VIEW_SOURCES: Record<StockView, Source[]> = {
  // Analyst consensus is a scrape of a third-party page and the slowest source
  // here. It belongs to its own view rather than to the one that opens first.
  overview: ["stock", "macro", "options", "profile"],
  signals: ["stock", "options", "analyst"],
  flow: ["stock", "options"],
  metrics: ["stock", "options", "profile"],
  sec: ["stock"],
  analysts: ["stock", "analyst"],
  ownership: ["stock", "ownership"],
  value: ["stock", "profile", "analyst"],
  // The earnings date drives the event-risk sizing, and it was typed in by hand.
  risk: ["stock", "options", "catalysts", "profile"],
};

export function viewNeeds(view: StockView, source: Source) {
  return VIEW_SOURCES[view].includes(source);
}

/**
 * Everything one ticker's detail route needs, and nothing the open view does not.
 *
 * The SEC fact set and ten years of daily bars are the slow sources; both are
 * cached server-side, so the cost that remains is the first population. What
 * this avoids is paying that cost for panels the reader is not looking at.
 */
export function useStockDetail(symbol: string | null, view: StockView, initialStock?: StockData | null) {
  const ticker = symbol ? symbol.toUpperCase() : null;
  const wants = (source: Source) => (ticker && viewNeeds(view, source) ? ticker : null);
  // Nothing on this page polls. The reader asks for fresh figures, and every
  // source on the open view answers together so the panels stay consistent
  // with one another rather than drifting a request apart.
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((current) => current + 1), []);

  // When the server rendered from a fresh snapshot the figures are already in
  // the HTML, so the browser never asks for them again — until a refresh, which
  // has to go past the seeded copy as well.
  const seeded = nonce === 0 ? initialStock ?? null : null;
  // The quote is the one source a refresh forces past its stored snapshot.
  const fetched = useJson<StockData>(!seeded && wants("stock") ? `/api/stock/${wants("stock")}` : null, nonce, true);
  // A server-rendered page has never fetched on the client, so the first
  // refresh has nothing of its own to hold on to and every panel fell back to a
  // skeleton — the reload this button exists to avoid. The figures the server
  // sent stay on screen until the ones that replace them arrive.
  const stock: Resource<StockData> =
    seeded
      ? { data: seeded, state: "ready", error: null }
      : !fetched.data && fetched.state === "loading" && initialStock
        ? { data: initialStock, state: "ready", error: null, refreshing: true }
        : fetched;
  const macro = useJson<MacroData>(wants("macro") ? "/api/macro?view=regime" : null, nonce);
  const options = useJson<OptionBridgeData>(wants("options") ? `/api/options/${wants("options")}?updates=eod` : null, nonce);
  const analyst = useJson<AnalystData>(wants("analyst") ? `/api/analyst/${wants("analyst")}` : null, nonce);
  // Two requests on purpose: the insider tape and the FINRA figures land in a
  // few seconds, while the 13F archive can take half a minute. Splitting them
  // means the panel is useful immediately instead of holding a skeleton until
  // the slowest source finishes.
  const ownershipFilings = useJson<OwnershipData>(wants("ownership") ? `/api/ownership/${wants("ownership")}?scope=filings` : null, nonce);
  const ownershipInstitutional = useJson<OwnershipData>(wants("ownership") ? `/api/ownership/${wants("ownership")}?scope=institutional` : null, nonce);
  const ownership: Resource<OwnershipData> & { institutionalState: LoadState } = {
    data: ownershipFilings.data
      ? { ...ownershipFilings.data, institutional: ownershipInstitutional.data?.institutional ?? null }
      : null,
    state: ownershipFilings.state,
    error: ownershipFilings.error,
    institutionalState: ownershipInstitutional.state,
  };
  const catalysts = useJson<CatalystData>(wants("catalysts") ? `/api/catalysts/${wants("catalysts")}` : null, nonce);
  const profile = useJson<ProfileData>(wants("profile") ? `/api/profile/${wants("profile")}` : null, nonce);

  const refreshing = [stock, options, analyst, catalysts, profile, ownershipFilings].some(
    (resource) => resource.refreshing || (nonce > 0 && resource.state === "loading"),
  );

  return { stock, macro, options, analyst, ownership, catalysts, profile, refresh, refreshing, refreshed: nonce };
}

/* --------------------------------------------------------------- watchlist */

const STORAGE_KEY = "gexlab-v3:stock-watchlist";
export const DEFAULT_WATCHLIST = ["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL", "TSLA"];

export function isTicker(value: string) {
  return /^[A-Z]{1,5}$/.test(value);
}

/** The saved list, persisted to this browser only. */
export function useWatchlist() {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const hydrated = useRef(false);

  // Deferred a tick so the server-rendered starter list is what hydration
  // matches; the saved list is applied immediately afterwards.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const valid = parsed.filter((value): value is string => typeof value === "string" && isTicker(value));
            if (valid.length) setWatchlist([...new Set(valid)].slice(0, 100));
          }
        }
      } catch {
        // A browser with storage disabled keeps the starter list.
      }
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }, [watchlist]);

  const add = useCallback((ticker: string) => {
    setWatchlist((current) => (current.includes(ticker) ? current : [...current, ticker]));
  }, []);
  const remove = useCallback((ticker: string) => {
    setWatchlist((current) => current.filter((item) => item !== ticker));
  }, []);

  return { watchlist, setWatchlist, add, remove };
}

/**
 * Summary rows for the saved list.
 *
 * Each row resolves on its own so the table fills in as answers arrive instead
 * of waiting for the slowest ticker. A failed ticker leaves its row in a
 * missing state rather than failing the whole list, which is what the previous
 * `Promise.all` did.
 */
export function useWatchlistRows(watchlist: string[]) {
  const key = watchlist.join(",");
  // Results carry the list they belong to, so changing the list discards them
  // by comparison instead of by clearing state on the way in.
  const [store, setStore] = useState<{ key: string; rows: Record<string, StockData>; settled: number }>({
    key: "",
    rows: {},
    settled: 0,
  });

  useEffect(() => {
    const tickers = key ? key.split(",") : [];
    if (!tickers.length) return;
    const controller = new AbortController();
    // A few at a time, not all of them. Each summary that misses its snapshot
    // pulls ten years of daily bars upstream, so a thirty-name list opened
    // thirty simultaneous reads and the origin answered several of them slowly
    // or not at all. Rows still appear one by one as they land — the limit
    // changes how many are in flight, not how the table fills.
    void inBatches(tickers, WATCHLIST_CONCURRENCY, async (ticker) => {
      try {
        const response = await fetch(`/api/stock/${ticker}?view=summary`, { signal: controller.signal });
        const payload = (await response.json()) as StockData & { error?: string };
        setStore((current) => {
          const base = current.key === key ? current : { key, rows: {}, settled: 0 };
          return {
            key,
            rows: payload.error ? base.rows : { ...base.rows, [ticker]: payload },
            settled: base.settled + 1,
          };
        });
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setStore((current) => {
          const base = current.key === key ? current : { key, rows: {}, settled: 0 };
          return { key, rows: base.rows, settled: base.settled + 1 };
        });
      }
    });
    return () => controller.abort();
  }, [key]);

  const active = store.key === key ? store : { key, rows: {}, settled: 0 };
  return { rows: active.rows, pending: Math.max(0, watchlist.length - active.settled) };
}

/**
 * Option-flow summaries, fetched only when the reader asks for them.
 *
 * Two things made a scan of a normal watchlist fail more often than it
 * succeeded. Every ticker was requested at once, and each response is a delayed
 * chain of several megabytes, so a twenty-name list opened twenty simultaneous
 * multi-megabyte reads and the origin throttled most of them. Worse, they were
 * gathered with `Promise.all`, so the first ticker to fail discarded the
 * nineteen that had already succeeded and the panel reported that nothing could
 * be scanned at all.
 *
 * Requests now run a few at a time and each ticker keeps its own outcome: the
 * ones that answered are shown, the ones that did not are named.
 */
const SCAN_CONCURRENCY = 3;
/** Summaries are far smaller than option chains, so a few more may run at once. */
const WATCHLIST_CONCURRENCY = 5;

export function useFlowScan() {
  const [flow, setFlow] = useState<Record<string, FlowData | null>>({});
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const scan = useCallback(async (tickers: string[]) => {
    if (!tickers.length) return;
    setScanning(true);
    setError("");
    const failed: string[] = [];
    try {
      const results = await inBatches(tickers, SCAN_CONCURRENCY, async (ticker) => {
        try {
          const response = await fetch(`/api/options/${ticker}?updates=eod`);
          const payload = (await response.json()) as OptionBridgeData;
          if (!response.ok || payload.error) throw new Error(payload.error || `${ticker} options activity is unavailable.`);
          return [ticker, payload.flow ?? null] as const;
        } catch {
          // One ticker without a published chain is not a failed scan.
          failed.push(ticker);
          return [ticker, null] as const;
        }
      });
      // Merge rather than replace: a ticker that failed this time keeps whatever
      // was already on screen from the last scan instead of blanking.
      setFlow((current) => {
        const next = { ...current };
        for (const [ticker, summary] of results) if (summary || !next[ticker]) next[ticker] = summary;
        return next;
      });
      setError(
        failed.length === tickers.length
          ? "No option activity could be scanned. The delayed chains are unavailable right now."
          : failed.length
            ? `No chain for ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` and ${failed.length - 4} more` : ""}.`
            : "",
      );
    } finally {
      setScanning(false);
    }
  }, []);

  const forget = useCallback((ticker: string) => {
    setFlow((current) => {
      const next = { ...current };
      delete next[ticker];
      return next;
    });
  }, []);

  return { flow, scanning, error, scan, forget };
}
