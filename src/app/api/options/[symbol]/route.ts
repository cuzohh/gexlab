import { NextRequest, NextResponse } from "next/server";
import { fitSmile } from "@/lib/vol-smile";
import {
  easternDate,
  isRegularMarketOpen,
  latestMarketObservationTime,
  latestCompletedTradingDate,
  MARKET_CALENDAR_VERSION,
  nextQuarterHour,
  parseUtcTimestamp,
} from "@/lib/market-time";
import {
  aggregateExposure,
  buildSmile,
  calculateMaxPain,
  expirationIso,
  type ExposureRow,
  interpolateZero,
  modelGamma,
  priceStrikes,
  type Smile,
  strikeKey,
  yearsToExpiry,
} from "@/lib/options-math";
import { sessionFlow, summariseFlow, type ChainContract } from "@/lib/block-flow";
import { summarizeExposureMetrics } from "@/lib/exposure-magnitude";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { loadMacroSeries } from "@/lib/server/macro-sources";
import {
  getSnapshot,
  loadSnapshotSeries,
  loadSurfaceHistory,
  pruneSnapshotHistory,
  putSnapshot,
  saveEngineFeatures,
  saveIntradayFeatures,
  saveSurfaceHistory,
  snapshotIsFresh,
} from "@/lib/server/snapshot-store";

export const runtime = "nodejs";

type RawOption = {
  option?: string;
  open_interest?: number;
  volume?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  bid?: number;
  ask?: number;
  last_trade_price?: number;
};

type ParsedContract = {
  root: string;
  expiry: string;
  type: "call" | "put";
  strike: number;
  oi: number;
  volume: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number;
  bid: number;
  ask: number;
  last: number;
};

type ExposureMetric = "gamma" | "delta" | "vanna" | "charm" | "vega" | "speed" | "zomma" | "vomma";
const EXPOSURE_METRICS: ExposureMetric[] = [
  "gamma",
  "delta",
  "vanna",
  "charm",
  "vega",
  "speed",
  "zomma",
  "vomma",
];
const PROFILE_SPAN_PERCENT = 0.032;

const INDEX_SYMBOLS = {
  NDX: { endpoint: "_NDX", dividendYield: 0.006 },
  SPX: { endpoint: "_SPX", dividendYield: 0.012 },
  QQQ: { endpoint: "QQQ", dividendYield: 0.005 },
  SPY: { endpoint: "SPY", dividendYield: 0.011 },
} as const;

function optionConfig(symbol: string) {
  if (symbol in INDEX_SYMBOLS) return INDEX_SYMBOLS[symbol as keyof typeof INDEX_SYMBOLS];
  // Cboe publishes delayed chains under the equity ticker. We deliberately use
  // a zero dividend-yield assumption for unknown equities rather than inventing
  // a company-specific yield; the response documents that assumption.
  return { endpoint: symbol, dividendYield: 0 };
}

const DEFAULT_RISK_FREE_RATE = 0.045;
const USER_AGENT = "Mozilla/5.0 (compatible; GEXLab/3.0)";
const METHODOLOGY_VERSION = "options-exposure-v3.5.0";
// Roughly a month of trading kept as raw chains. Enough to recompute derived
// tables under a changed methodology; past that the storage is not worth it.
const RAW_HISTORY_SESSIONS = Number(process.env.GEXLAB_RAW_SESSIONS || 20);
type UpdateMode = "eod" | "live";

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Rounds a value for transport.
 *
 * A double serializes every digit it has: a moneyness of -0.04120556495460584
 * and a charm of -769785.1327963665 travelled in full on every row of every
 * response, seventeen significant figures each to feed a chart axis and a
 * label rounded to one decimal. Applied only where the response is built, so
 * everything computed from these values on the server — the sums, the levels,
 * the recorded history — still uses the full precision.
 */
function round(value: number, decimals: number) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchNasdaqFallback(symbol: string): Promise<{ payload: RawPayload; sourceTime: string | null }> {
  // Nasdaq's public quote page exposes its composite OPRA view for equities.
  // It is a fallback, never mixed into a Cboe snapshot: partial books make OI
  // changes and flow rankings look more precise than they are.
  const response = await fetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/option-chain?assetclass=stocks&limit=5000&fromdate=all&excode=oprac&callput=callput&money=all&type=all`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Nasdaq fallback returned ${response.status}`);
  const payload = nasdaqPayload(symbol, await response.json());
  if (!payload) throw new Error("Nasdaq fallback returned no usable option contracts.");
  const observedAt = new Date();
  payload.timestamp = observedAt.toISOString();
  return { payload, sourceTime: latestMarketObservationTime(observedAt.toISOString()) };
}

function parseContract(raw: RawOption): ParsedContract | null {
  const symbol = String(raw.option ?? "").replaceAll(" ", "");
  const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, root, date, cp, strike] = match;
  const year = 2000 + Number(date.slice(0, 2));
  const month = date.slice(2, 4);
  const day = date.slice(4, 6);

  return {
    root,
    expiry: `${year}-${month}-${day}`,
    type: cp === "C" ? "call" : "put",
    strike: Number(strike) / 1000,
    oi: number(raw.open_interest),
    volume: number(raw.volume),
    iv: optionalNumber(raw.iv),
    delta: optionalNumber(raw.delta),
    gamma: optionalNumber(raw.gamma),
    vega: optionalNumber(raw.vega),
    theta: number(raw.theta),
    bid: number(raw.bid),
    ask: number(raw.ask),
    last: number(raw.last_trade_price),
  };
}

function nearestProfileCrossing(rows: ExposureRow[], metric: ExposureMetric, spot: number) {
  const crossings: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const left = number(rows[index - 1][metric]);
    const right = number(rows[index][metric]);
    if (!left || !right || Math.sign(left) === Math.sign(right)) continue;
    const leftStrike = rows[index - 1].strike;
    const rightStrike = rows[index].strike;
    const crossing = interpolateZero(leftStrike, left, rightStrike, right);
    if (crossing !== null) crossings.push(crossing);
  }
  if (!crossings.length) return null;
  return crossings.reduce((best, value) =>
    Math.abs(value - spot) < Math.abs(best - spot) ? value : best,
  );
}

function calculateGammaFlip(
  contracts: ParsedContract[],
  spot: number,
  dividendYield: number,
  valuationTime: number,
  riskFreeRate: number,
) {
  // Priced per strike, for the reason priceStrikes gives: the flip is the zero
  // of the same profile the strike rows draw, so it has to be built out of the
  // same volatility. Repricing each leg at its own quoted vol put the two sides
  // of a strike on different curves and moved the crossing.
  //
  // A leg used to be dropped when its own volatility was missing, which deleted
  // its open interest from the flip while the strike beside it kept its own.
  // The strike's volatility now covers both legs, so a missing quote costs the
  // book nothing.
  const inBand = contracts.filter(
    (contract) =>
      contract.oi > 0 && contract.strike >= spot * 0.7 && contract.strike <= spot * 1.3,
  );
  const priced = priceStrikes(inBand, { spot, dividendYield, valuationTime, riskFreeRate });

  // Collapsed to one entry per strike: the two legs share a gamma, so only the
  // open interest they carry into it differs. This also halves the repricing,
  // which runs sixty-four times over plus twenty bisection steps.
  const eligible = new Map<string, { strike: number; years: number; iv: number; netOi: number }>();
  for (const contract of inBand) {
    const key = strikeKey(contract);
    const strike = priced.get(key);
    if (!strike || !(strike.iv >= 0.01)) continue;
    const entry = eligible.get(key) ?? {
      strike: contract.strike,
      years: strike.years,
      iv: strike.iv,
      netOi: 0,
    };
    entry.netOi += (contract.type === "call" ? 1 : -1) * contract.oi;
    eligible.set(key, entry);
  }
  if (!eligible.size) return null;

  const legs = [...eligible.values()];
  const exposureAt = (candidateSpot: number) =>
    legs.reduce((total, item) => {
      const gamma = modelGamma({
        spot: candidateSpot,
        strike: item.strike,
        years: item.years,
        iv: item.iv,
        riskFreeRate,
        dividendYield,
      });
      return total + item.netOi * gamma;
    }, 0);

  const samples = 64;
  const low = spot * 0.85;
  const high = spot * 1.15;
  const crossings: number[] = [];
  let leftSpot = low;
  let leftValue = exposureAt(leftSpot);
  for (let index = 1; index <= samples; index += 1) {
    const rightSpot = low + ((high - low) * index) / samples;
    const rightValue = exposureAt(rightSpot);
    if (leftValue === 0) {
      crossings.push(leftSpot);
    } else if (rightValue === 0 || Math.sign(leftValue) !== Math.sign(rightValue)) {
      let bracketLeft = leftSpot;
      let bracketRight = rightSpot;
      let bracketLeftValue = leftValue;
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const middle = (bracketLeft + bracketRight) / 2;
        const middleValue = exposureAt(middle);
        if (Math.sign(middleValue) === Math.sign(bracketLeftValue)) {
          bracketLeft = middle;
          bracketLeftValue = middleValue;
        } else {
          bracketRight = middle;
        }
      }
      crossings.push((bracketLeft + bracketRight) / 2);
    }
    leftSpot = rightSpot;
    leftValue = rightValue;
  }
  if (!crossings.length) return null;
  return crossings.reduce((best, value) =>
    Math.abs(value - spot) < Math.abs(best - spot) ? value : best,
  );
}

function strongest(
  rows: ExposureRow[],
  metric: ExposureMetric,
  predicate: (row: ExposureRow) => boolean,
) {
  const candidates = rows.filter(predicate);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(number(row[metric])) > Math.abs(number(best[metric])) ? row : best,
  ).strike;
}

function calculateLevels(
  rows: ExposureRow[],
  contracts: ParsedContract[],
  spot: number,
  dividendYield: number,
  valuationTime: number,
  riskFreeRate: number,
) {
  // Primary walls are intended as nearby trading levels. Extreme tail strikes
  // remain in concentrations/CSV but cannot displace an actionable wall solely
  // because a large, far-OTM open-interest print dominates the scale.
  const nearbyRows = rows.filter(
    (row) => row.strike >= spot * 0.94 && row.strike <= spot * 1.06,
  );
  return {
    callWall:
      strongest(nearbyRows, "gamma", (row) => row.strike >= spot && row.gamma > 0) ??
      strongest(nearbyRows, "gamma", (row) => row.strike >= spot) ??
      strongest(rows, "gamma", (row) => row.strike >= spot && row.gamma > 0) ??
      strongest(rows, "gamma", (row) => row.strike >= spot),
    putWall:
      strongest(nearbyRows, "gamma", (row) => row.strike <= spot && row.gamma < 0) ??
      strongest(nearbyRows, "gamma", (row) => row.strike <= spot) ??
      strongest(rows, "gamma", (row) => row.strike <= spot && row.gamma < 0) ??
      strongest(rows, "gamma", (row) => row.strike <= spot),
    gammaFlip: calculateGammaFlip(
      contracts,
      spot,
      dividendYield,
      valuationTime,
      riskFreeRate,
    ),
    profileCrossing: nearestProfileCrossing(rows, "gamma", spot),
    maxPain: calculateMaxPain(contracts),
    vannaMagnet: strongest(rows, "vanna", () => true),
  };
}

type RawPayload = {
  timestamp?: string;
  data?: {
    current_price?: number;
    options?: RawOption[];
    /** The source is transported with the raw chain: activity is not comparable
        unless the reader can see which delayed book supplied it. */
    provider?: "cboe" | "nasdaq";
    providerLabel?: string;
    coverageNote?: string;
  };
};

type NasdaqChainRow = Record<string, string | null> & {
  expirygroup?: string | null;
  expiryDate?: string | null;
  drillDownURL?: string | null;
  strike?: string | null;
};

/** Nasdaq publishes display strings, not a contract API schema. Keep its
 * normalisation deliberately narrow, and use it only when Cboe has no book. */
function nasdaqNumber(value: unknown) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  return text === "--" || text === "" ? 0 : number(text.replace(/^\$/, ""));
}

function nasdaqExpiry(value: string | null | undefined) {
  const match = String(value ?? "").match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
  if (!Number.isFinite(month)) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function nasdaqPayload(symbol: string, raw: unknown): RawPayload | null {
  const payload = raw as {
    data?: { lastTrade?: string | null; table?: { rows?: NasdaqChainRow[] } | null } | null;
  };
  const rows = payload.data?.table?.rows;
  const spot = Number(String(payload.data?.lastTrade ?? "").match(/\$([\d,.]+)/)?.[1]?.replaceAll(",", ""));
  if (!rows?.length || !Number.isFinite(spot) || spot <= 0) return null;

  let activeExpiry: string | null = null;
  const options: RawOption[] = [];
  for (const row of rows) {
    if (row.expirygroup) {
      activeExpiry = nasdaqExpiry(row.expirygroup);
      continue;
    }
    const strike = nasdaqNumber(row.strike);
    if (!activeExpiry || strike <= 0) continue;
    const compactDate = activeExpiry.replaceAll("-", "").slice(2);
    const strikeCode = String(Math.round(strike * 1000)).padStart(8, "0");
    for (const [prefix, type] of [["c", "C"], ["p", "P"]] as const) {
      const volume = nasdaqNumber(row[`${prefix}_Volume`]);
      const openInterest = nasdaqNumber(row[`${prefix}_Openinterest`]);
      const bid = nasdaqNumber(row[`${prefix}_Bid`]);
      const ask = nasdaqNumber(row[`${prefix}_Ask`]);
      const last = nasdaqNumber(row[`${prefix}_Last`]);
      // A side with no quote, volume or OI is merely an empty display cell.
      if (!(volume || openInterest || bid || ask || last)) continue;
      options.push({
        option: `${symbol}${compactDate}${type}${strikeCode}`,
        open_interest: openInterest,
        volume,
        bid,
        ask,
        last_trade_price: last,
      });
    }
  }
  if (!options.length) return null;
  return {
    data: {
      current_price: spot,
      options,
      provider: "nasdaq",
      providerLabel: "Nasdaq composite delayed chain",
      coverageNote: "Fallback chain: volume and open interest are available; provider greeks are not, so activity is readable but exposure fields are modeled or unavailable.",
    },
  };
}

// Per-expiry levels are a pure function of one stored snapshot, so a composite
// request reuses whatever a narrower selection already computed. Only the
// newest snapshots are retained; older keys fall out in insertion order.
function memoize<T>(limit: number) {
  const entries = new Map<string, T>();
  return (key: string, compute: () => T): T => {
    const cached = entries.get(key);
    if (cached !== undefined) {
      entries.delete(key);
      entries.set(key, cached);
      return cached;
    }
    const value = compute();
    entries.set(key, value);
    while (entries.size > limit) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return value;
  };
}

type ExpiryLevels = {
  expiry: string;
  contractCount: number;
  levels: ReturnType<typeof calculateLevels>;
};

type TopologyRow = Pick<
  ExposureRow,
  "strike" | "gamma" | "delta" | "vanna" | "charm" | "vega" | "speed" | "zomma" | "vomma"
>;

type TopologySlice = {
  expiry: string;
  dte: number;
  rows: TopologyRow[];
};

type SurfaceSlice = {
  expiry: string;
  dte: number;
  years: number;
  forward: number;
  atmIv: number;
  putIv25: number | null;
  callIv25: number | null;
  riskReversal25: number | null;
  butterfly25: number | null;
  points: Smile["points"];
};

const memoContracts = memoize<ParsedContract[]>(8);
const memoSurface = memoize<SurfaceSlice | null>(400);
const memoSelection = memoize<{
  rows: ExposureRow[];
  levels: ReturnType<typeof calculateLevels>;
  contractCount: number;
  openInterestContracts: number;
  roots: string[];
}>(32);
// Positioning summary for the forecast recorder, keyed by snapshot so a
// session is aggregated once no matter how many requests arrive.
const memoPositioning = memoize<{
  levels: ReturnType<typeof calculateLevels>;
  netGamma: number;
  callGamma: number;
  putGamma: number;
  netVanna: number;
  netCharm: number;
  openInterest: number;
  expiries: number;
} | null>(8);
const memoExpiryLevels = memoize<ExpiryLevels>(400);
const memoExpiryStats = memoize<{
  expiry: string;
  atmIv: number | null;
  openInterest: number;
  volume: number;
}>(400);
/** Large-trade summary, which depends only on the snapshot and the one before it. */
const memoFlow = memoize<{
  session: string;
  resolvedAgainst: string;
  rows: ReturnType<typeof sessionFlow>;
  summary: ReturnType<typeof summariseFlow>;
  method: string;
  caveat: string;
} | null>(8);

async function fetchRaw(symbol: string, updateMode: UpdateMode) {
  if (updateMode === "live" && !isRegularMarketOpen()) {
    return fetchRaw(symbol, "eod");
  }
  const key = `${symbol}:${updateMode}:market-asof`;
  const stored = getSnapshot<RawPayload>("options-raw", key);
  const targetEod = latestCompletedTradingDate();
  const storedMarketDate = stored?.sourceTime
    ? easternDate(new Date(stored.sourceTime))
    : null;
  const fresh =
    updateMode === "eod"
      ? Boolean(stored && storedMarketDate && storedMarketDate >= targetEod)
      : Boolean(stored && snapshotIsFresh(stored));
  if (fresh && stored) return { ...stored, stale: false };

  const refresh = () => dedupeRequest(`options:${key}`, async () => {
    const rechecked = getSnapshot<RawPayload>("options-raw", key);
    if (
      rechecked &&
      (updateMode === "live"
        ? snapshotIsFresh(rechecked)
        : Boolean(
            rechecked.sourceTime &&
              easternDate(new Date(rechecked.sourceTime)) >= latestCompletedTradingDate(),
          ))
    ) {
      return { ...rechecked, stale: false };
    }

    try {
      const endpoint = optionConfig(symbol).endpoint;
      // The origin supports conditional requests, so a poll that finds nothing
      // new costs one 304 instead of re-downloading roughly thirteen megabytes.
      const validator = getSnapshot<{ etag: string }>("http-validators", key);
      let payload: RawPayload;
      let sourceTime: string | null;
      let etag: string | null = null;
      try {
        const response = await fetch(
          `https://cdn.cboe.com/api/global/delayed_quotes/options/${endpoint}.json`,
          {
            cache: "no-store",
            headers: {
              Accept: "application/json",
              Referer: "https://www.cboe.com/",
              "User-Agent": USER_AGENT,
              ...(stored && validator?.payload.etag
                ? { "If-None-Match": validator.payload.etag }
                : {}),
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (response.status === 304 && stored) {
        // Unchanged upstream. Hold the existing snapshot and defer the next
        // check rather than re-parsing identical data.
        putSnapshot({
          namespace: "options-raw",
          key,
          payload: stored.payload,
          sourceTime: stored.sourceTime,
          fetchedAt: new Date().toISOString(),
          refreshAfter: new Date(
            Date.now() + (updateMode === "live" ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000),
          ).toISOString(),
          methodologyVersion: METHODOLOGY_VERSION,
        });
        return { ...stored, stale: false };
        }
        if (!response.ok) throw new Error(`Cboe returned ${response.status}`);
        etag = response.headers.get("etag");
        payload = (await response.json()) as RawPayload;
        payload.data = { ...payload.data, provider: "cboe", providerLabel: "Cboe delayed option chain" };
        const generatedAt = parseUtcTimestamp(payload.timestamp);
        sourceTime = generatedAt ? latestMarketObservationTime(generatedAt) : null;
        if (!payload.data?.options?.length || !number(payload.data.current_price)) {
          throw new Error("Cboe snapshot was empty or incomplete.");
        }
      } catch (cboeError) {
        // Index roots are Cboe-specific in this workspace. For equity symbols,
        // Nasdaq's composite quote page is the independent free fallback.
        if (symbol in INDEX_SYMBOLS) throw cboeError;
        const fallback = await fetchNasdaqFallback(symbol);
        payload = fallback.payload;
        sourceTime = fallback.sourceTime;
      }
      const fetchedAt = new Date().toISOString();
      const unchanged = Boolean(stored?.sourceTime && sourceTime === stored.sourceTime);
      const refreshAfter =
        updateMode === "live"
          ? unchanged
            ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
            : nextQuarterHour(new Date(), 20).toISOString()
          : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      putSnapshot({
        namespace: "options-raw",
        key,
        payload,
        sourceTime,
        fetchedAt,
        refreshAfter,
        methodologyVersion: METHODOLOGY_VERSION,
      });
      // Bound the history here rather than leaving it to a script somebody has
      // to remember: a chain revision is several megabytes, and this runs only
      // when a genuinely new snapshot lands, not on cached reads. Reclaiming
      // the freed pages still needs "npm run prune:history", which VACUUMs.
      try {
        pruneSnapshotHistory("options-raw", { retainSessions: RAW_HISTORY_SESSIONS });
      } catch {
        // Housekeeping must never fail the request that triggered it.
      }
      if (etag) {
        putSnapshot({
          namespace: "http-validators",
          key,
          payload: { etag },
          sourceTime,
          fetchedAt,
          refreshAfter,
          methodologyVersion: METHODOLOGY_VERSION,
        });
      }
      return {
        namespace: "options-raw",
        key,
        payload,
        sourceTime,
        fetchedAt,
        refreshAfter,
        methodologyVersion: METHODOLOGY_VERSION,
        stale: false,
      };
    } catch (error) {
      if (stored) return { ...stored, stale: true };
      throw error;
    }
  });

  // A live chain can be many megabytes. Once there is a usable snapshot, do
  // not hold the page open for CBOE's network response; display it and update
  // the cache for the next read. EOD keeps its completed-session guarantee.
  if (updateMode === "live" && stored) {
    void refresh().catch(() => undefined);
    return { ...stored, stale: true };
  }
  return refresh();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: requested } = await context.params;
  const symbol = requested.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(symbol)) {
    return NextResponse.json({ error: "Use a 1-5 letter U.S. option symbol." }, { status: 400 });
  }
  const config = optionConfig(symbol);

  try {
    const updateMode: UpdateMode =
      request.nextUrl.searchParams.get("updates") === "live" ? "live" : "eod";
    // Reversal only ranks the nearby aggregated Greek book. It does not need
    // the surface, historical flow, term structure, or chart-export payload
    // used by the larger Options workspace.
    const reversalView = request.nextUrl.searchParams.get("view") === "reversal";
    const [stored, rateSeries] = await Promise.all([
      fetchRaw(symbol, updateMode),
      reversalView ? Promise.resolve([]) : loadMacroSeries("DGS3MO").catch(() => []),
    ]);
    const raw = stored.payload;
    const spot = number(raw.data?.current_price);
    const sourceTime = stored.sourceTime ?? new Date(stored.fetchedAt).toISOString();
    const snapshotKey = `${symbol}:${sourceTime}:${stored.fetchedAt}`;
    const parsedContracts = memoContracts(snapshotKey, () =>
      (raw.data?.options ?? [])
        .map(parseContract)
        .filter((contract): contract is ParsedContract => Boolean(contract)),
    );
    const valuationTime = Date.parse(sourceTime);
    const observationDate = easternDate(new Date(valuationTime));
    const riskFreeObservation = rateSeries.filter((row) => row.date <= observationDate).at(-1);
    const riskFreeRate =
      riskFreeObservation && riskFreeObservation.value >= 0
        ? riskFreeObservation.value / 100
        : DEFAULT_RISK_FREE_RATE;
    // A contract stops mattering when it settles, not at the end of the day it
    // settles on. This filtered on the expiry date alone, so the 0DTE book
    // stayed selectable all evening: at 20:00 ET you could still read hedging
    // pressure off options that had ceased to exist at the close, which is
    // exactly the wrong picture to carry into an Asia session.
    //
    // The instant comes from expirationIso, which already knows that NDX and SPX
    // monthlies are AM-settled on the opening print and so are gone from 09:30
    // ET, while their PM-settled families (NDXP, SPXW) and the ETF books trade
    // to 16:00. Both roots share an expiry date, so this has to be per contract
    // rather than per date. Wall clock, not the snapshot time: whether a
    // contract still exists is a fact about now, even when the chain being read
    // is an end-of-day file.
    const now = Date.now();
    const contracts = parsedContracts.filter((contract) => {
      const settles = Date.parse(expirationIso(contract.expiry, contract.root) ?? "");
      // An unparseable expiry is kept rather than silently dropped; the pricing
      // path has its own fallback for it.
      return !Number.isFinite(settles) || settles > now;
    });
    const expiries = [...new Set(contracts.map((contract) => contract.expiry))].sort();
    if (!expiries.length) {
      return NextResponse.json(
        {
          error:
            parsedContracts.length > 0
              ? `Every ${symbol} contract in the saved snapshot has settled. The next chain publishes after the following session opens.`
              : `No unexpired ${symbol} contracts were present in the saved snapshot.`,
        },
        { status: 422 },
      );
    }
    // An absent parameter and a present-but-empty one have to mean the same
    // thing. They did not: `?expiry=` produced the empty string, which is not
    // null, so `requestedExpiry ?? expiries[0]` kept it and the selection became
    // [""]. Nothing matched, and the route answered 200 with zero contracts,
    // zero strikes and null levels — an empty book presented as a real snapshot
    // rather than an error or a fallback.
    const parameter = (name: string) => {
      const raw = request.nextUrl.searchParams.get(name)?.trim();
      return raw ? raw : null;
    };
    let requestedExpiry = parameter("expiry");
    let requestedThrough = parameter("through");
    let requestedExpiryList = parameter("expiries")
      ?.split(",")
      .map((date) => date.trim())
      .filter(Boolean);
    const allowPartialExpiries =
      request.nextUrl.searchParams.get("partialExpiries") === "1";
    if (requestedThrough && !/^\d{4}-\d{2}-\d{2}$/.test(requestedThrough)) {
      return NextResponse.json(
        { error: "The through date must use YYYY-MM-DD." },
        { status: 400 },
      );
    }

    // A date the snapshot lists but that has since settled is not a bad request,
    // it is a selection the clock invalidated: a reader holding the 0DTE book at
    // 15:59 would otherwise get a hard error on the next poll and no way back.
    // Those fall through to the nearest live expiry and are reported. A date the
    // snapshot never listed at all is still a 400.
    const settledDates = new Set(
      parsedContracts.map((contract) => contract.expiry).filter((date) => !expiries.includes(date)),
    );
    const settledRequests = [
      ...(requestedExpiry && settledDates.has(requestedExpiry) ? [requestedExpiry] : []),
      ...(requestedExpiryList?.filter((date) => settledDates.has(date)) ?? []),
    ];
    const settledExpiries = [...new Set(settledRequests)].sort();
    if (requestedExpiry && settledDates.has(requestedExpiry)) requestedExpiry = null;
    requestedExpiryList = requestedExpiryList?.filter((date) => !settledDates.has(date));

    // A horizon is a date, not a demand for one exact listed contract. This
    // matters for calendar-based callers: a 45-day horizon often falls on a
    // weekend, holiday, or a day on which this root has no expiry. Snap it to
    // the last live expiry at or before the requested date (or the front book
    // when the requested date is before every listed expiry).
    if (requestedThrough && !expiries.includes(requestedThrough)) {
      const requestedDate = requestedThrough;
      requestedThrough = expiries.filter((date) => date <= requestedDate).at(-1) ?? expiries[0];
    }

    const invalidExpiries = [
      ...(requestedExpiry && !expiries.includes(requestedExpiry) ? [requestedExpiry] : []),
      ...(requestedExpiryList?.filter((date) => !expiries.includes(date)) ?? []),
    ];
    if (
      invalidExpiries.length &&
      (!allowPartialExpiries || Boolean(requestedExpiry) || Boolean(requestedThrough))
    ) {
      return NextResponse.json(
        {
          error: `${symbol} does not list the requested expiry: ${[...new Set(invalidExpiries)].join(", ")}.`,
          expiries,
        },
        { status: 400 },
      );
    }
    const requestedExpiries = requestedExpiryList?.filter((date) => expiries.includes(date));
    if (requestedExpiryList?.length && !requestedExpiries?.length) {
      return NextResponse.json(
        {
          error: `${symbol} has no contracts for any selected expiry.`,
          expiries,
        },
        { status: 400 },
      );
    }
    const mode = requestedExpiries?.length ? "custom" : requestedThrough ? "through" : "single";
    const expiry =
      mode === "custom"
        ? requestedExpiries?.at(-1) ?? expiries[0]
        : mode === "through"
        ? requestedThrough ?? expiries[0]
        : requestedExpiry ?? expiries[0];
    const selectedExpiries =
      mode === "custom"
        ? [...new Set(requestedExpiries)].sort()
        : mode === "through"
          ? expiries.filter((date) => date <= expiry)
          : [expiry];
    const sliceKey = `${snapshotKey}:${riskFreeRate}`;
    // The aggregate profile and its gamma flip dominate a wide selection, so
    // the whole result is keyed by the exact expiry set the caller asked for.
    const selection = memoSelection(`${sliceKey}:set:${selectedExpiries.join(",")}`, () => {
      const selected = contracts.filter((contract) => selectedExpiries.includes(contract.expiry));
      const aggregated = aggregateExposure(selected, {
        spot,
        dividendYield: config.dividendYield,
        valuationTime,
        riskFreeRate,
      });
      return {
        rows: aggregated,
        levels: calculateLevels(
          aggregated,
          selected,
          spot,
          config.dividendYield,
          valuationTime,
          riskFreeRate,
        ),
        contractCount: selected.length,
        openInterestContracts: selected.filter((contract) => contract.oi > 0).length,
        roots: [...new Set(selected.map((contract) => contract.root))],
      };
    });
    const { rows, levels } = selection;
    if (reversalView) {
      const netGamma = rows.reduce((total, row) => total + row.gamma, 0);
      const frontExpiry = expiries[0] ?? null;
      const frontExpiryContracts = frontExpiry
        ? contracts
            .filter((contract) => contract.expiry === frontExpiry && contract.iv !== null && contract.iv > 0)
            .sort((left, right) => Math.abs(left.strike - spot) - Math.abs(right.strike - spot))
        : [];
      const frontContracts = frontExpiryContracts.slice(0, 8);
      // This is a reachability context, not a directional forecast. Equally
      // strong shelves are more useful when today's front-expiry option path
      // can plausibly reach them.
      const expectedMovePercent = frontContracts.length
        ? frontContracts.reduce(
            (total, contract) =>
              total + contract.iv! * Math.sqrt(yearsToExpiry(contract.expiry, Date.now(), contract.root)) * 100,
            0,
          ) / frontContracts.length
        : null;
      const currentDate = easternDate();
      const bucketDefinitions = [
        { label: "0DTE", minimum: 0, maximum: 0 },
        { label: "1–5D", minimum: 1, maximum: 5 },
        { label: "6–45D", minimum: 6, maximum: 45 },
      ] as const;
      // Keep expiry attribution compact: the complete profile still powers the
      // map, while these three independently aggregated shelves reveal whether
      // a level is immediate hedging pressure or only a longer-dated landmark.
      const expiryBuckets = bucketDefinitions.map((bucket) => {
        const bucketContracts = contracts.filter((contract) => {
          const dte = Math.round(
            (Date.parse(`${contract.expiry}T12:00:00Z`) - Date.parse(`${currentDate}T12:00:00Z`)) / 86_400_000,
          );
          return dte >= bucket.minimum && dte <= bucket.maximum;
        });
        const bucketRows = aggregateExposure(bucketContracts, {
          spot,
          dividendYield: config.dividendYield,
          valuationTime,
          riskFreeRate,
        });
        const nearby = bucketRows.filter((row) => Math.abs(row.strike / spot - 1) <= 0.06);
        return {
          label: bucket.label,
          contractCount: bucketContracts.length,
          netGamma: bucketRows.reduce((total, row) => total + row.gamma, 0),
          callWall: strongest(nearby, "gamma", (row) => row.strike >= spot && row.gamma > 0),
          putWall: strongest(nearby, "gamma", (row) => row.strike <= spot && row.gamma < 0),
          vannaMagnet: strongest(nearby, "vanna", () => true),
        };
      });
      const frontSmile = frontExpiry && frontExpiryContracts.length
        ? buildSmile({
            contracts: frontExpiryContracts,
            spot,
            years: yearsToExpiry(frontExpiry, Date.now(), frontExpiryContracts[0].root),
            riskFreeRate,
            dividendYield: config.dividendYield,
          })
        : null;
      const invalidStrike = rows.find((row) =>
        Object.values(row).some(
          (value) => value !== null && typeof value === "number" && !Number.isFinite(value),
        ),
      );
      const invalidLevel = Object.values(levels).some(
        (value) => value !== null && !Number.isFinite(value),
      );
      if (!Number.isFinite(spot) || !Number.isFinite(netGamma) || invalidStrike || invalidLevel) {
        throw new Error("A reversal-zone calculation produced a non-finite value.");
      }
      return NextResponse.json({
        symbol,
        spot,
        timestamp: sourceTime,
        retrievedAt: stored.fetchedAt,
        stale: stored.stale,
        netGamma,
        expectedMovePercent,
        riskReversal25: frontSmile?.riskReversal25 ?? null,
        expiryBuckets,
        levels,
        strikes: rows,
      });
    }
    const expiryLevels = selectedExpiries.map((date) =>
      memoExpiryLevels(`${sliceKey}:${date}`, () => {
        const sliceContracts = contracts.filter((contract) => contract.expiry === date);
        const sliceRows = aggregateExposure(sliceContracts, {
          spot,
          dividendYield: config.dividendYield,
          valuationTime,
          riskFreeRate,
        });
        return {
          expiry: date,
          contractCount: sliceContracts.length,
          // When this slice ceases to exist, so a chart reading an exported
          // payload can drop it rather than drawing walls for contracts that
          // have settled. The latest instant among the contracts still live:
          // an AM-settled root has already been filtered out by then, and it is
          // the last one standing that decides when the slice is finished.
          settlesAt: sliceContracts.reduce<string | null>((latest, contract) => {
            const settles = expirationIso(date, contract.root);
            if (!settles) return latest;
            return latest === null || settles > latest ? settles : latest;
          }, null),
          levels: calculateLevels(
            sliceRows,
            sliceContracts,
            spot,
            config.dividendYield,
            valuationTime,
            riskFreeRate,
          ),
        };
      }),
    );
    // Topology is a separate, compact field because the active profile can be
    // narrowed to one expiry while the surface still needs the term axis.
    // Keep only the near-spot window and a stable sample of each expiry's
    // listed strikes so a composite request does not return the full chain
    // eight times over.
    const topology = expiries.map<TopologySlice>((date) => {
      const sliceContracts = contracts.filter((contract) => contract.expiry === date);
      const sliceRows = aggregateExposure(sliceContracts, {
        spot,
        dividendYield: config.dividendYield,
        valuationTime,
        riskFreeRate,
      });
      const nearSpot = sliceRows
        .filter((row) => Math.abs(row.strike / spot - 1) <= 0.032)
        .sort((left, right) => left.strike - right.strike);
      const stride = Math.max(1, Math.ceil(nearSpot.length / 36));
      return {
        expiry: date,
        dte: Math.max(
          0,
          Math.round(
            (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${observationDate}T12:00:00Z`)) / 86_400_000,
          ),
        ),
        rows: nearSpot
          .filter((_, index) => index % stride === 0 || index === nearSpot.length - 1)
          .map(({ strike, gamma, delta, vanna, charm, vega, speed, zomma, vomma }) => ({
            strike,
            gamma,
            delta,
            vanna,
            charm,
            vega,
            speed,
            zomma,
            vomma,
          })),
      };
    });
    // One smile per listed expiry. Together these are the volatility surface:
    // the term axis comes from the expiry list, the strike axis from each
    // slice's own out-of-the-money quotes. Pooling strikes across expiries
    // would average away exactly the structure the surface is meant to show.
    const surface = expiries
      .map((date) =>
        memoSurface(`${sliceKey}:${date}`, () => {
          const sliceContracts = contracts.filter((contract) => contract.expiry === date);
          if (!sliceContracts.length) return null;
          const years = yearsToExpiry(date, valuationTime, sliceContracts[0].root);
          const smile = buildSmile({
            contracts: sliceContracts,
            spot,
            years,
            riskFreeRate,
            dividendYield: config.dividendYield,
          });
          if (!smile) return null;
          // Real time left, not the floored year fraction. yearsToExpiry clamps
          // at an hour so it cannot tell eight minutes from sixty, and it is
          // exactly the last few minutes where the implied volatility solve
          // blows up. The history refuses a slice this close to settlement.
          const settlesAt = Date.parse(expirationIso(date, sliceContracts[0].root) ?? "");
          const secondsToSettlement = Number.isFinite(settlesAt)
            ? (settlesAt - valuationTime) / 1000
            : null;
          return {
            expiry: date,
            secondsToSettlement,
            // Measured from the observation, not from the wall clock. This used
            // to run against max(observationDate, today), so reading a stale
            // snapshot restated every expiry as nearer than it was when the
            // chain was captured: the 24 July file, first read on the 27th, was
            // recorded with every slice three days short and its 3DTE expiry
            // labelled 0DTE. The table exists to compare surfaces at a constant
            // days-to-expiry, so a bucket that shifts with the reading date is
            // the one thing it cannot tolerate.
            dte: Math.max(
              0,
              Math.round(
                (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${observationDate}T12:00:00Z`)) / 86_400_000,
              ),
            ),
            years,
            forward: smile.forward,
            atmIv: smile.atmIv,
            putIv25: smile.putIv25,
            callIv25: smile.callIv25,
            riskReversal25: smile.riskReversal25,
            butterfly25: smile.butterfly25,
            points: smile.points,
          };
        }),
      )
      .filter((slice): slice is SurfaceSlice => slice !== null);

    // Record the shape summary so later sessions can compare against it. The
    // primary key is (symbol, snapshot, expiry), so replaying the same snapshot
    // rewrites the same rows instead of accumulating duplicates.
    //
    // Recorded from the full surface, before the per-strike points are trimmed
    // out of the response below.
    saveSurfaceHistory(symbol, sourceTime, observationDate, surface);

    // The per-strike smile of every listed expiry was 88% of this response —
    // 844KB of 963KB on NDX, forty-eight slices of about a hundred and twenty
    // points each — and most of it could not be displayed by anything. The
    // surface grid reads the first fourteen slices and the smile chart reads
    // the selected one; the remaining thirty-four were transferred, parsed and
    // held on every request so they could be filtered out on arrival.
    //
    // Each slice keeps its summary either way, which is what the term
    // structure and the change-on-yesterday comparison are built from. Only
    // the strike-level points are dropped, and only where nothing can reach
    // them.
    const SURFACE_POINT_SLICES = 14;
    const pointsWanted = new Set([
      ...surface.slice(0, SURFACE_POINT_SLICES).map((slice) => slice.expiry),
      ...selectedExpiries,
    ]);
    const responseSurface = surface.map((slice) =>
      pointsWanted.has(slice.expiry)
        ? {
            ...slice,
            points: slice.points.map((point) => ({
              ...point,
              moneyness: round(point.moneyness, 6),
              standardized: round(point.standardized, 6),
              delta: round(point.delta, 6),
              iv: round(point.iv, 6),
            })),
          }
        : { ...slice, points: [] },
    );

    // Prior observations are matched at a constant days-to-expiry, since the
    // calendar expiry that was 3DTE yesterday is 2DTE today.
    const frontSlice = surface.find((slice) => slice.dte > 0) ?? surface[0] ?? null;
    // The front slice already skips 0DTE; the baseline it is compared against
    // has to as well. A 1DTE request with a tolerance of one used to match a
    // stored 0DTE row, and those are the readings taken closest to settlement.
    const surfaceHistory = frontSlice
      ? loadSurfaceHistory(symbol, { dte: frontSlice.dte, dteTolerance: 1, limit: 60 }).filter(
          (row) =>
            row.observationDate !== observationDate &&
            (frontSlice.dte === 0 || row.dte > 0),
        )
      : [];
    const priorSurface = surfaceHistory[0] ?? null;
    // Percentile has meaning only against a real, constant-DTE history. A
    // shorter history would turn a handful of observations into a confident
    // sounding "rank", so withhold it until twenty distinct sessions exist.
    const ivHistory = [...new Map(surfaceHistory.map((row) => [row.observationDate, row.atmIv])).values()]
      .filter((value) => Number.isFinite(value));
    const ivRank = frontSlice && ivHistory.length >= 20
      ? (ivHistory.filter((value) => value <= frontSlice.atmIv).length / ivHistory.length) * 100
      : null;
    const surfaceChange =
      frontSlice && priorSurface
        ? {
            comparedTo: priorSurface.observationDate,
            dte: frontSlice.dte,
            atmIv: frontSlice.atmIv - priorSurface.atmIv,
            riskReversal25:
              frontSlice.riskReversal25 !== null && priorSurface.riskReversal25 !== null
                ? frontSlice.riskReversal25 - priorSurface.riskReversal25
                : null,
            butterfly25:
              frontSlice.butterfly25 !== null && priorSurface.butterfly25 !== null
                ? frontSlice.butterfly25 - priorSurface.butterfly25
                : null,
          }
        : null;

    // Positioning features for the forecast engine.
    //
    // No public archive carries a past option chain, so unlike every price
    // series on this site these cannot be backfilled: the only way to have a
    // year of dealer-gamma history is to have recorded a year of sessions. The
    // book measured here is fixed at every expiry inside forty-five days
    // regardless of what the caller asked for, so the value stored for a
    // session does not depend on which request happened to trigger it.
    {
      const positioning = memoPositioning(`${snapshotKey}:engine-features`, () => {
        const horizon = expiries.filter(
          (date) =>
            (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${observationDate}T12:00:00Z`)) /
              86_400_000 <=
            45,
        );
        const book = contracts.filter((contract) => horizon.includes(contract.expiry));
        if (!book.length) return null;
        const bookRows = aggregateExposure(book, {
          spot,
          dividendYield: config.dividendYield,
          valuationTime,
          riskFreeRate,
        });
        const bookLevels = calculateLevels(
          bookRows,
          book,
          spot,
          config.dividendYield,
          valuationTime,
          riskFreeRate,
        );
        const netGamma = bookRows.reduce((total, row) => total + row.gamma, 0);
        return {
          rows: bookRows,
          levels: bookLevels,
          netGamma,
          callGamma: bookRows.reduce((total, row) => total + Math.max(row.gamma, 0), 0),
          putGamma: bookRows.reduce((total, row) => total + Math.min(row.gamma, 0), 0),
          netVanna: bookRows.reduce((total, row) => total + row.vanna, 0),
          netCharm: bookRows.reduce((total, row) => total + row.charm, 0),
          openInterest: bookRows.reduce((total, row) => total + row.callOi + row.putOi, 0),
          expiries: horizon.length,
        };
      });
      if (positioning) {
        const flip = positioning.levels.gammaFlip;
        const frontSurface = surface.find((slice) => slice.dte > 0) ?? surface[0] ?? null;
        const measured = {
          spot,
          netGamma: positioning.netGamma,
          callGamma: positioning.callGamma,
          putGamma: positioning.putGamma,
          netVanna: positioning.netVanna,
          netCharm: positioning.netCharm,
          openInterest: positioning.openInterest,
          expiriesInBook: positioning.expiries,
          gammaFlip: flip,
          // Distance to the flip is the part that transfers across sessions:
          // the level itself moves with spot, the gap to it is comparable.
          flipDistancePercent: flip !== null && spot > 0 ? ((spot - flip) / spot) * 100 : null,
          callWallDistancePercent:
            positioning.levels.callWall !== null && spot > 0
              ? ((positioning.levels.callWall - spot) / spot) * 100
              : null,
          putWallDistancePercent:
            positioning.levels.putWall !== null && spot > 0
              ? ((positioning.levels.putWall - spot) / spot) * 100
              : null,
          frontAtmIv: frontSurface?.atmIv ?? null,
          frontRiskReversal25: frontSurface?.riskReversal25 ?? null,
          frontButterfly25: frontSurface?.butterfly25 ?? null,
          frontDte: frontSurface?.dte ?? null,
        };
        // Every distinct snapshot time is kept, which is what makes the sample
        // grow at the rate the data actually arrives rather than once a day.
        saveIntradayFeatures(sourceTime, observationDate, symbol, measured);
        // The settled snapshot is additionally kept as that session's single
        // end-of-day reading, so daily and intraday models read separate,
        // unambiguous tables.
        if (updateMode === "eod") {
          saveEngineFeatures(observationDate, symbol, sourceTime, measured);
        }
      }
    }

    // Large trades, from this session's chain and the one before it.
    //
    // Open interest in these snapshots lags a session, so the change between
    // two consecutive chains is produced by the volume in the earlier one. The
    // pair is therefore (older chain's volume, newer chain's open interest),
    // which is what makes intent trustworthy rather than merely plausible.
    // Reported for the whole book rather than the selected expiries: size shows
    // up where it wants to, and filtering it to the current selection would
    // hide the strike that mattered.
    // Memoized on the snapshot: this reads the two most recent raw chains back
    // out of the store and reparses both — about eleven megabytes of JSON and
    // thirty thousand OCC symbols — to produce twenty-four rows that depend on
    // nothing the caller asked for. Recomputing that per request cost a fifth
    // of a second on every load of the workspace.
    const flow = memoFlow(`${snapshotKey}:flow`, () => {
      const asContracts = (list: ParsedContract[]): ChainContract[] =>
        list.map((contract) => ({
          // Rebuild the OCC symbol, which is what pairs a contract across two
          // sessions. Strike is carried in thousandths, so it is restored to
          // the eight-digit form the source uses rather than printed as a
          // number that would not match.
          contract:
            contract.root +
            contract.expiry.replaceAll("-", "").slice(2) +
            (contract.type === "call" ? "C" : "P") +
            String(Math.round(contract.strike * 1000)).padStart(8, "0"),
          expiry: contract.expiry,
          strike: contract.strike,
          type: contract.type,
          openInterest: contract.oi,
          volume: contract.volume,
          bid: contract.bid,
          ask: contract.ask,
          last: contract.last,
        }));
      const history = loadSnapshotSeries<RawPayload>("options-raw", `${symbol}:eod:market-asof`, 2);
      // history[0] is the current chain; history[1] is the session before it.
      const older = history[1];
      if (!older) return null;
      const olderContracts = (older.payload?.data?.options ?? [])
        .map(parseContract)
        .filter((contract): contract is ParsedContract => Boolean(contract));
      if (!olderContracts.length) return null;
      const session = easternDate(new Date(older.sourceTime ?? older.fetchedAt));
      // That session's own spot, not today's. Intrinsic value is measured
      // against where the index was when the trade happened; using the current
      // price reprices the whole book and silently rewrites which contracts
      // were in the money. Applying the 30 July spot to the 29 July chain wiped
      // the extrinsic value off every call and left the ranking all puts.
      const sessionSpot = Number(older.payload?.data?.current_price);
      if (!Number.isFinite(sessionSpot) || sessionSpot <= 0) return null;
      const rows = sessionFlow(asContracts(olderContracts), asContracts(parsedContracts), {
        spot: sessionSpot,
        sessionDate: session,
        limit: 40,
      });
      if (!rows.length) return null;
      return {
        session,
        resolvedAgainst: observationDate,
        rows,
        summary: summariseFlow(rows),
        method:
          "Ranked by premium traded. Open interest here lags a session, so a session's volume is " +
          "matched against the open-interest change that arrives the next day; that pairing leaves " +
          "0.2% of contracts showing an impossible change, against 7.6% when paired the other way.",
        caveat:
          "Size, not order flow. End-of-day chains carry no timestamps, no bid-ask side and no " +
          "individual prints, so this cannot see when a trade happened, whether it was bought or " +
          "sold, or whether one order was worked in slices. It shows what traded and how much of " +
          "it stayed on.",
      };
    });

    const expiryStats = expiries.map((date) => memoExpiryStats(`${sliceKey}:${date}`, () => {
      const expiryContracts = contracts.filter((contract) => contract.expiry === date);
      const listedStrikes = [...new Set(expiryContracts.map((contract) => contract.strike))];
      const atmStrike = listedStrikes.reduce(
        (best, strike) => Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
        listedStrikes[0] ?? spot,
      );
      const atmContracts = expiryContracts.filter((contract) => contract.strike === atmStrike);
      const weightedIv = atmContracts.reduce(
        (accumulator, contract) => {
          const weight = Math.max(contract.oi, 1);
          if (contract.iv !== null && contract.iv > 0) {
            accumulator.ivTotal += contract.iv * weight;
            accumulator.ivWeight += weight;
          }
          return accumulator;
        },
        { ivTotal: 0, ivWeight: 0 },
      );
      return {
        expiry: date,
        atmIv: weightedIv.ivWeight ? weightedIv.ivTotal / weightedIv.ivWeight : null,
        openInterest: expiryContracts.reduce((total, contract) => total + contract.oi, 0),
        volume: expiryContracts.reduce((total, contract) => total + contract.volume, 0),
      };
    }));
    const invalidStrike = rows.find((row) =>
      Object.values(row).some(
        (value) => value !== null && typeof value === "number" && !Number.isFinite(value),
      ),
    );
    const invalidLevel = [
      ...Object.values(levels),
      ...expiryLevels.flatMap((slice) => Object.values(slice.levels)),
    ].some((value) => value !== null && !Number.isFinite(value));
    const profileRows = rows.filter(
      (row) => Math.abs(row.strike - spot) <= spot * PROFILE_SPAN_PERCENT,
    );
    // Exposures run to the millions and are read as "17.3M" or as a bar
    // length, so three decimals is already far past anything that can be seen.
    // Summed and ranked at full precision above; rounded only on the way out.
    const responseRows = rows.map((row) => ({
      ...row,
      ...Object.fromEntries(EXPOSURE_METRICS.map((metric) => [metric, round(row[metric], 3)])),
      callIv: row.callIv === null ? null : round(row.callIv, 6),
      putIv: row.putIv === null ? null : round(row.putIv, 6),
    }));
    const exposureMagnitude = summarizeExposureMetrics(profileRows, EXPOSURE_METRICS);
    const frontSurface = responseSurface[0] ?? null;
    const expectedMove = frontSurface?.atmIv !== null && frontSurface?.atmIv !== undefined && frontSurface.years !== null && frontSurface.years !== undefined
      ? { expiry: frontSurface.expiry, percent: frontSurface.atmIv * Math.sqrt(frontSurface.years) * 100, dollars: spot * frontSurface.atmIv * Math.sqrt(frontSurface.years) }
      : null;
    const netGamma = rows.reduce((total, row) => total + row.gamma, 0);
    if (!Number.isFinite(spot) || !Number.isFinite(netGamma) || invalidStrike || invalidLevel) {
      throw new Error("An option exposure calculation produced a non-finite value.");
    }

    const volDislocation = (() => {
      /**
       * The nearest expiry that can actually carry a curve.
       *
       * Not simply the front one. A three-day single-name chain is quoted in
       * pennies at two-and-a-half dollar strike spacing, so only a handful of
       * strikes are precise enough to compare — Apple offered three. Fitting a
       * curve through three points and reporting what lies off it would be
       * inventing structure. The search walks out in time until an expiry has
       * enough readable strikes, which for an index is usually the front week
       * and for a single name a week or two later.
       */
      const buildQuotes = (expiry: string) => {
        // The out-of-the-money side at every strike, which is the only side
        // whose implied volatility means anything. An in-the-money option is
        // almost all intrinsic value, so its volatility is inferred from the
        // sliver of extrinsic left over and the vendor's figure is unusable —
        // reading them produced a "smile" through 780% volatility and a fit
        // whose own noise was 262 volatility points.
        const byStrike = new Map<number, { strike: number; iv: number | null; openInterest: number; volume: number; bid: number; ask: number; vega: number | null }>();
        for (const contract of contracts) {
          if (contract.expiry !== expiry) continue;
          const wantCall = contract.strike >= spot;
          if (wantCall !== (contract.type === "call")) continue;
          byStrike.set(contract.strike, {
            strike: contract.strike,
            // A volatility outside this range is a broken quote rather than a
            // frightened market: nothing trades at half a vol or at 400.
            iv: contract.iv !== null && contract.iv > 0.01 && contract.iv < 3 ? contract.iv : null,
            openInterest: contract.oi,
            volume: contract.volume,
            bid: contract.bid,
            ask: contract.ask,
            vega: contract.vega,
          });
        }
        return [...byStrike.values()];
      };

      for (const expiry of expiries.slice(0, 8)) {
        const fit = fitSmile(buildQuotes(expiry), spot);
        if (!fit || !fit.points.length) continue;
        return {
          expiry,
          noise: round(fit.noise * 100, 2),
          rejected: fit.rejected,
          readable: fit.points.length,
          strikes: fit.dislocations.slice(0, 6).map((point) => ({
            strike: point.strike,
            iv: round(point.iv * 100, 2),
            fitted: round(point.fitted * 100, 2),
            // Volatility points, the unit the reader thinks in.
            residual: round(point.residual * 100, 2),
            openInterest: point.openInterest,
            volume: point.volume,
            relativeSpread: round(point.relativeSpread * 100, 1),
            ivUncertainty: round(point.ivUncertainty, 2),
          })),
        };
      }
      return null;
    })();

    return NextResponse.json({
      source: raw.data?.providerLabel ?? "Options market snapshot",
      provider: raw.data?.provider ?? "cboe",
      coverageNote: raw.data?.coverageNote ?? null,
      symbol,
      roots: selection.roots,
      spot,
      timestamp: sourceTime,
      retrievedAt: stored.fetchedAt,
      updateMode,
      stale: stored.stale,
      nextRefreshAt: stored.refreshAfter,
      methodologyVersion: METHODOLOGY_VERSION,
      marketCalendarVersion: MARKET_CALENDAR_VERSION,
      expiry,
      expiries,
      selection: {
        mode,
        start: selectedExpiries[0],
        end: selectedExpiries.at(-1),
        expiries: selectedExpiries,
        omittedExpiries: requestedExpiryList?.filter((date) => !expiries.includes(date)) ?? [],
        /** Requested dates that had settled by the time of the request. */
        settledExpiries,
      },
      expiryLevels,
      topology,
      expiryStats,
      flow,
      surface: responseSurface,
      expectedMove,
      surfaceChange,
      ivRank,
      surfaceHistoryDays: new Set(surfaceHistory.map((row) => row.observationDate)).size,
      contractCount: selection.contractCount,
      openInterestContracts: selection.openInterestContracts,
      assumptions: {
        dealerSign: "calls positive / puts negative",
        riskFreeRate,
        riskFreeRateDate: riskFreeObservation?.date ?? null,
        riskFreeRateSource: riskFreeObservation ? "3-month Treasury constant maturity" : "documented fallback",
        dividendYield: config.dividendYield,
        higherGreeks: "Black-Scholes-Merton from snapshot IV; AM/PM settlement follows the option root",
        standardGreeks: "Snapshot supplied where available; missing delta, gamma, and vega are modeled",
        gammaFlip: "Nearest zero of the full selected book after repricing gamma across ±15% spot",
        walls: "Largest signed strike gamma on the appropriate side of spot within ±6%; tail concentrations remain available separately",
      },
      levels,
      // The flip locates a zero crossing. The sign at spot is returned
      // separately so clients never infer a gamma regime merely from which
      // side of a possibly non-monotonic crossing price currently sits on.
      netGamma,
      // Absolute magnitude is reported for the same near-spot window the
      // profile renders. The shape remains normalized in the chart; this is
      // the context needed to compare a small and a large profile honestly.
      exposureMagnitude,
      strikes: responseRows,
      // Where one strike is priced away from the volatility curve fitted
      // through its neighbours. Deliberately separate from the walls above:
      // those are gamma, which is what forces dealers to trade the underlying,
      // while this is demand for one contract and moves nothing by itself.
      volDislocation,
    }, {
      // The chain is republished on a fifteen-minute cadence at best, and in
      // EOD mode not at all during the session. Every stock view that shows a
      // wall was re-deriving this from the saved chain on each navigation.
      headers: {
        "Cache-Control": updateMode === "live"
          ? "private, max-age=60, stale-while-revalidate=900"
          : "private, max-age=600, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load the option chain.",
        source: "Options market snapshot",
      },
      { status: 502 },
    );
  }
}
