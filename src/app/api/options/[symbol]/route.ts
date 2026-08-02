import { NextRequest, NextResponse } from "next/server";
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
  buildSmile,
  calculateMaxPain,
  expirationIso,
  interpolateZero,
  modelGamma,
  modelGreeks,
  type Smile,
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

type StrikeRow = {
  strike: number;
  gamma: number;
  delta: number;
  vanna: number;
  charm: number;
  vega: number;
  speed: number;
  zomma: number;
  vomma: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  callIvWeighted: number;
  putIvWeighted: number;
  callIvWeight: number;
  putIvWeight: number;
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

const SYMBOLS = {
  NDX: { endpoint: "_NDX", dividendYield: 0.006 },
  SPX: { endpoint: "_SPX", dividendYield: 0.012 },
  QQQ: { endpoint: "QQQ", dividendYield: 0.005 },
  SPY: { endpoint: "SPY", dividendYield: 0.011 },
} as const;

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

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function aggregate(
  contracts: ParsedContract[],
  spot: number,
  dividendYield: number,
  valuationTime: number,
  riskFreeRate: number,
) {
  const rows = new Map<number, StrikeRow>();

  for (const contract of contracts) {
    if (contract.strike < spot * 0.72 || contract.strike > spot * 1.28) continue;
    const sign = contract.type === "call" ? 1 : -1;
    const weight = contract.oi;
    const modeled = modelGreeks({
      spot,
      strike: contract.strike,
      years: yearsToExpiry(contract.expiry, valuationTime, contract.root),
      iv: contract.iv && contract.iv > 0 ? contract.iv : 0.2,
      type: contract.type,
      riskFreeRate,
      dividendYield,
    });
    const gamma = contract.gamma !== null && contract.gamma > 0 ? contract.gamma : modeled.gamma;
    const delta = contract.delta ?? modeled.delta;
    const vegaPerVolPoint =
      contract.vega ?? modeled.vega / 100;
    const row = rows.get(contract.strike) ?? {
      strike: contract.strike,
      gamma: 0,
      delta: 0,
      vanna: 0,
      charm: 0,
      vega: 0,
      speed: 0,
      zomma: 0,
      vomma: 0,
      callOi: 0,
      putOi: 0,
      callVolume: 0,
      putVolume: 0,
      callIvWeighted: 0,
      putIvWeighted: 0,
      callIvWeight: 0,
      putIvWeight: 0,
    };

    row.gamma += sign * weight * gamma * 100 * spot * spot * 0.01;
    row.delta += weight * delta * 100 * spot;
    row.vanna += sign * weight * modeled.vanna * 100 * spot;
    row.charm += sign * weight * modeled.charm * 100 * spot;
    row.vega += sign * weight * vegaPerVolPoint * 100;
    row.speed += sign * weight * modeled.speed * 100 * spot * spot * 0.01;
    row.zomma += sign * weight * modeled.zomma * 100 * spot * spot * 0.01;
    row.vomma += sign * weight * modeled.vomma * 100;

    if (contract.type === "call") {
      row.callOi += contract.oi;
      row.callVolume += contract.volume;
      if (contract.iv !== null && contract.iv > 0) {
        row.callIvWeighted += contract.iv * Math.max(contract.oi, 1);
        row.callIvWeight += Math.max(contract.oi, 1);
      }
    } else {
      row.putOi += contract.oi;
      row.putVolume += contract.volume;
      if (contract.iv !== null && contract.iv > 0) {
        row.putIvWeighted += contract.iv * Math.max(contract.oi, 1);
        row.putIvWeight += Math.max(contract.oi, 1);
      }
    }
    rows.set(contract.strike, row);
  }

  return [...rows.values()]
    .map((row) => ({
      strike: row.strike,
      gamma: row.gamma,
      delta: row.delta,
      vanna: row.vanna,
      charm: row.charm,
      vega: row.vega,
      speed: row.speed,
      zomma: row.zomma,
      vomma: row.vomma,
      callOi: row.callOi,
      putOi: row.putOi,
      callVolume: row.callVolume,
      putVolume: row.putVolume,
      callIv: row.callIvWeight ? row.callIvWeighted / row.callIvWeight : null,
      putIv: row.putIvWeight ? row.putIvWeighted / row.putIvWeight : null,
    }))
    .sort((left, right) => left.strike - right.strike);
}

function nearestProfileCrossing(rows: ReturnType<typeof aggregate>, metric: ExposureMetric, spot: number) {
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
  const eligible = contracts
    .filter(
      (contract) =>
        contract.oi > 0 &&
        contract.iv !== null &&
        contract.iv >= 0.01 &&
        contract.strike >= spot * 0.7 &&
        contract.strike <= spot * 1.3,
    )
    .map((contract) => ({
      contract,
      years: yearsToExpiry(contract.expiry, valuationTime, contract.root),
    }));
  if (!eligible.length) return null;

  const exposureAt = (candidateSpot: number) =>
    eligible.reduce((total, item) => {
      const { contract, years } = item;
      const gamma = modelGamma({
        spot: candidateSpot,
        strike: contract.strike,
        years,
        iv: contract.iv!,
        riskFreeRate,
        dividendYield,
      });
      return total + (contract.type === "call" ? 1 : -1) * contract.oi * gamma;
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
  rows: ReturnType<typeof aggregate>,
  metric: ExposureMetric,
  predicate: (row: ReturnType<typeof aggregate>[number]) => boolean,
) {
  const candidates = rows.filter(predicate);
  if (!candidates.length) return null;
  return candidates.reduce((best, row) =>
    Math.abs(number(row[metric])) > Math.abs(number(best[metric])) ? row : best,
  ).strike;
}

function calculateLevels(
  rows: ReturnType<typeof aggregate>,
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
  };
};

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
  rows: ReturnType<typeof aggregate>;
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

async function fetchRaw(symbol: keyof typeof SYMBOLS, updateMode: UpdateMode) {
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

  return dedupeRequest(`options:${key}`, async () => {
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
      const endpoint = SYMBOLS[symbol].endpoint;
      // The origin supports conditional requests, so a poll that finds nothing
      // new costs one 304 instead of re-downloading roughly thirteen megabytes.
      const validator = getSnapshot<{ etag: string }>("http-validators", key);
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
      if (!response.ok) throw new Error(`Market-data request returned ${response.status}`);
      const etag = response.headers.get("etag");
      const payload = (await response.json()) as RawPayload;
      const generatedAt = parseUtcTimestamp(payload.timestamp);
      const sourceTime = generatedAt ? latestMarketObservationTime(generatedAt) : null;
      if (!payload.data?.options?.length || !number(payload.data.current_price)) {
        throw new Error("Market-data snapshot was empty or incomplete.");
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
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: requested } = await context.params;
  const symbol = requested.toUpperCase() as keyof typeof SYMBOLS;
  if (!(symbol in SYMBOLS)) {
    return NextResponse.json({ error: "Supported sources are NDX, SPX, QQQ, and SPY." }, { status: 404 });
  }

  try {
    const updateMode: UpdateMode =
      request.nextUrl.searchParams.get("updates") === "live" ? "live" : "eod";
    const [stored, rateSeries] = await Promise.all([
      fetchRaw(symbol, updateMode),
      loadMacroSeries("DGS3MO").catch(() => []),
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
      const aggregated = aggregate(
        selected,
        spot,
        SYMBOLS[symbol].dividendYield,
        valuationTime,
        riskFreeRate,
      );
      return {
        rows: aggregated,
        levels: calculateLevels(
          aggregated,
          selected,
          spot,
          SYMBOLS[symbol].dividendYield,
          valuationTime,
          riskFreeRate,
        ),
        contractCount: selected.length,
        openInterestContracts: selected.filter((contract) => contract.oi > 0).length,
        roots: [...new Set(selected.map((contract) => contract.root))],
      };
    });
    const { rows, levels } = selection;
    const expiryLevels = selectedExpiries.map((date) =>
      memoExpiryLevels(`${sliceKey}:${date}`, () => {
        const sliceContracts = contracts.filter((contract) => contract.expiry === date);
        const sliceRows = aggregate(
          sliceContracts,
          spot,
          SYMBOLS[symbol].dividendYield,
          valuationTime,
          riskFreeRate,
        );
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
            SYMBOLS[symbol].dividendYield,
            valuationTime,
            riskFreeRate,
          ),
        };
      }),
    );
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
            dividendYield: SYMBOLS[symbol].dividendYield,
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
    saveSurfaceHistory(symbol, sourceTime, observationDate, surface);

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
        const bookRows = aggregate(
          book,
          spot,
          SYMBOLS[symbol].dividendYield,
          valuationTime,
          riskFreeRate,
        );
        const bookLevels = calculateLevels(
          bookRows,
          book,
          spot,
          SYMBOLS[symbol].dividendYield,
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
    const flow = (() => {
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
    })();

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
    const exposureMagnitude = summarizeExposureMetrics(profileRows, EXPOSURE_METRICS);
    const netGamma = rows.reduce((total, row) => total + row.gamma, 0);
    if (!Number.isFinite(spot) || !Number.isFinite(netGamma) || invalidStrike || invalidLevel) {
      throw new Error("An option exposure calculation produced a non-finite value.");
    }

    return NextResponse.json({
      source: "Options market snapshot",
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
      expiryStats,
      flow,
      surface,
      surfaceChange,
      surfaceHistoryDays: new Set(surfaceHistory.map((row) => row.observationDate)).size,
      contractCount: selection.contractCount,
      openInterestContracts: selection.openInterestContracts,
      assumptions: {
        dealerSign: "calls positive / puts negative",
        riskFreeRate,
        riskFreeRateDate: riskFreeObservation?.date ?? null,
        riskFreeRateSource: riskFreeObservation ? "3-month Treasury constant maturity" : "documented fallback",
        dividendYield: SYMBOLS[symbol].dividendYield,
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
      strikes: rows,
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
