import { NextResponse } from "next/server";
import { easternDate, latestCompletedTradingDate, nextWeekday, sessionsBehind } from "@/lib/market-time";
import { nextSessionOutlook, pivotReturn } from "@/lib/regime-forecast";
import {
  curveRecessionProbability,
  netLiquidity,
  skewPercentile,
  weightedAvailable,
  yieldDecomposition,
} from "@/lib/macro-math";
import { loadMacroSeriesStore } from "@/lib/server/macro-sources";
import { MACRO_SERIES_IDS } from "@/lib/server/series-catalog";
import {
  loadFomcMeetings,
  loadPublishedReleaseDates,
  loadRecentReleases,
  loadScheduledReleases,
} from "@/lib/server/event-sources";
import { dedupeRequest } from "@/lib/server/request-deduper";
import {
  backfillVintages,
  loadVintagePanel,
  vintageGrid,
  vintageStoreAt,
  VINTAGE_SERIES,
} from "@/lib/server/vintage-store";
import {
  getSnapshot,
  loadSurfaceHistory,
  putSnapshot,
  snapshotIsFresh,
} from "@/lib/server/snapshot-store";

export const runtime = "nodejs";

type Observation = { date: string; value: number };
type SeriesStore = Record<string, Observation[]>;
type Tone = "constructive" | "caution" | "stress" | "neutral";

type MacroMetric = {
  id: string;
  label: string;
  group: string;
  value: number | null;
  display: string;
  change: number | null;
  changeDisplay: string;
  date: string | null;
  frequency: string;
  source: "Economic release" | "Positioning report";
  series: string;
  meaning: string;
  // Context for the ledger: where this reading sits in its own recent history,
  // and a coarse shape of how it got there.
  context: {
    spark: number[];
    zScore: number | null;
    percentile: number | null;
    windowYears: number;
    observations: number;
  } | null;
};

const FRED_IDS = MACRO_SERIES_IDS;

const CACHE_MS = 15 * 60 * 1000;
const COT_CACHE_MS = 20 * 60 * 60 * 1000;
const METHODOLOGY_VERSION = "macro-regime-v3.13.0";
// Derived, not written out again. These were two hand-kept strings, so adding a
// field to the payload left the key pointing at the old shape and the cached
// response was served for the full window with the new field missing — and
// indefinitely if a later refresh failed, since the error path falls back to
// whatever is stored. Deriving it means a methodology bump cannot be applied to
// the computation and forgotten on the cache.
const OUTPUT_CACHE_KEY = `dashboard-${METHODOLOGY_VERSION}`;
// Sessions replayed beyond what the chart shows, so the outlook can resample
// one-day changes and fit its recalibration on already-resolved forecasts.
const REGIME_OUTLOOK_SESSIONS = 800;

function clamp(value: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value));
}

function latest(series: Observation[] | undefined, offset = 0) {
  if (!series?.length || series.length <= offset) return null;
  return series[series.length - 1 - offset];
}

function atOrBefore(series: Observation[] | undefined, date: string) {
  if (!series?.length) return null;
  let low = 0;
  let high = series.length - 1;
  let found: Observation | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].date <= date) {
      found = series[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function change(series: Observation[] | undefined, periods: number) {
  const current = latest(series);
  const prior = latest(series, periods);
  return current && prior ? current.value - prior.value : null;
}

function percentChange(series: Observation[] | undefined, periods: number) {
  const current = latest(series);
  const prior = latest(series, periods);
  return current && prior && prior.value !== 0 ? (current.value / prior.value - 1) * 100 : null;
}

function movingAverage(series: Observation[] | undefined, periods: number) {
  if (!series?.length || series.length < periods) return null;
  const values = series.slice(-periods).map((row) => row.value);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Collapses a daily series into calendar-month averages, which is the form
 * the published yield-curve recession model is estimated on. The most recent
 * bucket covers only the sessions so far in the current month.
 */
function monthlyAverages(series: Observation[] | undefined, months: number) {
  if (!series?.length) return [];
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of series) {
    const key = row.date.slice(0, 7);
    const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += row.value;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(-months)
    .map(([month, bucket]) => ({ date: `${month}-01`, value: bucket.sum / bucket.count }));
}

function pathEfficiency(series: Observation[] | undefined, periods: number) {
  if (!series?.length || series.length <= periods) return null;
  const rows = series.slice(-(periods + 1));
  const displacement = Math.abs(rows.at(-1)!.value - rows[0].value);
  const distance = rows.slice(1).reduce(
    (sum, row, index) => sum + Math.abs(row.value - rows[index].value),
    0,
  );
  return distance === 0 ? 0 : displacement / distance;
}

function directionalPersistence(series: Observation[] | undefined, periods: number) {
  if (!series?.length || series.length <= periods) return null;
  const rows = series.slice(-(periods + 1));
  const changes = rows.slice(1).map((row, index) => row.value - rows[index].value);
  const netDirection = rows.at(-1)!.value >= rows[0].value ? 1 : -1;
  return changes.filter((value) => Math.sign(value) === netDirection).length / changes.length;
}

function returnAutocorrelation(series: Observation[] | undefined, periods: number) {
  if (!series?.length || series.length <= periods + 1) return null;
  const rows = series.slice(-(periods + 2));
  const returns = rows.slice(1).map((row, index) => Math.log(row.value / rows[index].value));
  const x = returns.slice(0, -1);
  const y = returns.slice(1);
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const covariance = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0);
  const varianceX = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const varianceY = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator === 0 ? 0 : covariance / denominator;
}

function realizedVolatility(series: Observation[] | undefined, periods: number) {
  if (!series?.length || series.length <= periods) return null;
  const rows = series.slice(-(periods + 1));
  const returns = rows.slice(1).map((row, index) => Math.log(row.value / rows[index].value));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  return Math.sqrt(variance * 252) * 100;
}

function drawdownFromHigh(series: Observation[] | undefined, periods: number) {
  if (!series?.length) return null;
  const rows = series.slice(-periods);
  const current = rows.at(-1)?.value;
  const high = Math.max(...rows.map((row) => row.value));
  return current && high ? (current / high - 1) * 100 : null;
}

function signedScale(value: number | null, scale: number) {
  return value === null ? 0 : Math.tanh(value / scale) * 100;
}

function yoy(series: Observation[] | undefined, periods: number) {
  return percentChange(series, periods);
}

function formatNumber(value: number | null, digits = 2) {
  return value === null ? "Unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatSigned(value: number | null, suffix = "", digits = 2) {
  if (value === null) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

const CONTEXT_WINDOW_YEARS = 5;
const SPARK_POINTS = 48;

/**
 * Rebuilds a series in the units a metric actually displays, so the ledger
 * ranks like against like. Comparing a year-over-year rate against the level
 * series it came from would rank the reading against the wrong distribution.
 */
function yoySeries(series: Observation[] | undefined, periods: number): Observation[] {
  if (!series?.length) return [];
  return series.slice(periods).flatMap((row, index) => {
    const prior = series[index];
    return prior.value === 0 ? [] : [{ date: row.date, value: (row.value / prior.value - 1) * 100 }];
  });
}

function diffSeries(series: Observation[] | undefined, periods: number): Observation[] {
  if (!series?.length) return [];
  return series.slice(periods).map((row, index) => ({
    date: row.date,
    value: row.value - series[index].value,
  }));
}

function ratioSeries(
  numerator: Observation[] | undefined,
  denominator: Observation[] | undefined,
): Observation[] {
  if (!numerator?.length || !denominator?.length) return [];
  const byDate = new Map(denominator.map((row) => [row.date, row.value]));
  return numerator.flatMap((row) => {
    const other = byDate.get(row.date);
    return other === undefined || other === 0 ? [] : [{ date: row.date, value: row.value / other }];
  });
}

/**
 * Recomputes a rolling statistic across history so a derived market reading
 * can be ranked against its own past values rather than against price.
 */
function rollingSeries(
  series: Observation[] | undefined,
  periods: number,
  compute: (window: Observation[]) => number | null,
  limit = 1400,
): Observation[] {
  if (!series?.length || series.length <= periods) return [];
  const rows = series.slice(-(limit + periods));
  const output: Observation[] = [];
  for (let index = periods; index < rows.length; index += 1) {
    const value = compute(rows.slice(index - periods, index + 1));
    if (value !== null && Number.isFinite(value)) output.push({ date: rows[index].date, value });
  }
  return output;
}

/**
 * Difference of two series on their shared dates. Used where both sides are
 * already expressed in the same units, such as two year-over-year rates.
 */
function diffTwoSeries(
  left: Observation[] | undefined,
  right: Observation[] | undefined,
): Observation[] {
  if (!left?.length || !right?.length) return [];
  const byDate = new Map(right.map((row) => [row.date, row.value]));
  return left.flatMap((row) => {
    const other = byDate.get(row.date);
    return other === undefined ? [] : [{ date: row.date, value: row.value - other }];
  });
}

/**
 * Rebuilds the number of unemployed people from the unemployment rate and the
 * payroll-consistent labor force, so job openings can be compared against
 * people rather than against a percentage.
 */
function unemployedLevelSeries(store: SeriesStore): Observation[] {
  const rate = store.UNRATE ?? [];
  const level = store.CLF16OV ?? [];
  if (!rate.length || !level.length) return [];
  const byDate = new Map(level.map((row) => [row.date, row.value]));
  return rate.flatMap((row) => {
    const force = byDate.get(row.date);
    return force === undefined ? [] : [{ date: row.date, value: (row.value / 100) * force }];
  });
}

function downsample(values: number[], points: number) {
  if (values.length <= points) return values;
  const step = (values.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, index) => values[Math.round(index * step)]);
}

function metricContext(track: Observation[], value: number | null): MacroMetric["context"] {
  if (!track.length) return null;
  const cutoffYear = Number(track.at(-1)!.date.slice(0, 4)) - CONTEXT_WINDOW_YEARS;
  const window = track.filter((row) => Number(row.date.slice(0, 4)) >= cutoffYear);
  const values = window.map((row) => row.value).filter((entry) => Number.isFinite(entry));
  if (values.length < 8) return null;
  const mean = values.reduce((sum, entry) => sum + entry, 0) / values.length;
  const variance =
    values.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) / Math.max(values.length - 1, 1);
  const deviation = Math.sqrt(variance);
  const ranked = value === null ? null : values.filter((entry) => entry < value).length / values.length;
  return {
    spark: downsample(values, SPARK_POINTS).map((entry) => Number(entry.toPrecision(6))),
    zScore: value === null || deviation === 0 ? null : Number(((value - mean) / deviation).toFixed(2)),
    percentile: ranked === null ? null : Math.round(ranked * 100),
    windowYears: CONTEXT_WINDOW_YEARS,
    observations: values.length,
  };
}

function metric(
  store: SeriesStore,
  config: {
    id: string;
    label: string;
    group: string;
    series: string;
    value: number | null;
    display: string;
    change: number | null;
    changeDisplay: string;
    frequency: string;
    meaning: string;
    // Used when a metric is calculated at an earlier date than its display
    // series runs to, so the shown date matches the number.
    observedAt?: string | null;
    // The series in the metric's own display units. Defaults to the raw
    // series, which is only correct for metrics that display a level.
    track?: Observation[];
  },
): MacroMetric {
  const { observedAt, track, ...rest } = config;
  return {
    ...rest,
    date: observedAt ?? latest(store[config.series])?.date ?? null,
    source: "Economic release",
    context: metricContext(track ?? store[config.series] ?? [], config.value),
  };
}

type CotRow = {
  report_date_as_yyyy_mm_dd?: string;
  asset_mgr_positions_long?: string;
  asset_mgr_positions_short?: string;
  lev_money_positions_long?: string;
  lev_money_positions_short?: string;
};

async function fetchCot(contract: "NASDAQ MINI" | "E-MINI S&P 500") {
  const key = contract === "NASDAQ MINI" ? "nq" : "es";
  const stored = getSnapshot<CotRow[]>("macro-positioning", key);
  if (stored && snapshotIsFresh(stored)) return stored.payload;
  return dedupeRequest(`macro:positioning:${key}`, async () => {
    try {
      const params = new URLSearchParams({
        "$select": "report_date_as_yyyy_mm_dd,asset_mgr_positions_long,asset_mgr_positions_short,lev_money_positions_long,lev_money_positions_short",
        "$where": `contract_market_name='${contract}'`,
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": "156",
      });
      const response = await fetch(
        `https://publicreporting.cftc.gov/resource/gpe5-46if.json?${params}`,
        { cache: "no-store", signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error(`Positioning-data request returned ${response.status}`);
      const payload = (await response.json()) as CotRow[];
      if (!payload.length) throw new Error("Positioning-data response was empty.");
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-positioning",
        key,
        payload,
        sourceTime: payload[0]?.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? null,
        fetchedAt,
        refreshAfter: new Date(Date.now() + COT_CACHE_MS).toISOString(),
        methodologyVersion: METHODOLOGY_VERSION,
      });
      return payload;
    } catch (error) {
      if (stored) return stored.payload;
      throw error;
    }
  });
}

function cotNet(row: CotRow | undefined, type: "asset" | "leveraged") {
  if (!row) return null;
  const long = Number(type === "asset" ? row.asset_mgr_positions_long : row.lev_money_positions_long);
  const short = Number(type === "asset" ? row.asset_mgr_positions_short : row.lev_money_positions_short);
  return Number.isFinite(long) && Number.isFinite(short) ? long - short : null;
}

function tone(score: number): Tone {
  if (score >= 60) return "constructive";
  if (score <= 40) return "stress";
  return "caution";
}

function label(score: number, positive: string, negative: string) {
  return score >= 60 ? positive : score <= 40 ? negative : "Mixed";
}

function percentile(values: number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function conservativeMonthlyAvailabilityDate(referenceDate: string) {
  const [year, month] = referenceDate.split("-").map(Number);
  if (!year || !month) return referenceDate;
  // The last day of the following month avoids starting the return window
  // before that reference month's CPI/PCE releases would normally be known.
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

function validateSeriesStore(store: SeriesStore) {
  const issues: string[] = [];
  const strictlyPositiveSeries = new Set([
    "NASDAQ100", "SP500", "CPIAUCSL", "CPILFESL", "PCEPILFE",
    "PAYEMS", "INDPRO", "RSAFS", "M2SL", "WALCL", "WTREGEN", "WRESBAL",
  ]);
  for (const [seriesId, rows] of Object.entries(store)) {
    let previousDate = "";
    const dates = new Set<string>();
    for (const row of rows) {
      if (!Number.isFinite(row.value)) issues.push(`${seriesId} contains a non-finite value.`);
      if (strictlyPositiveSeries.has(seriesId) && row.value <= 0) {
        issues.push(`${seriesId} contains a non-positive value.`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) issues.push(`${seriesId} contains an invalid date.`);
      if (row.date < previousDate) issues.push(`${seriesId} is not chronological.`);
      if (dates.has(row.date)) issues.push(`${seriesId} contains duplicate dates.`);
      dates.add(row.date);
      previousDate = row.date;
    }
  }

  const latestRanges: Record<string, [number, number]> = {
    CPIAUCSL: [50, 1_000],
    CPILFESL: [50, 1_000],
    UNRATE: [0, 30],
    DGS2: [-10, 30],
    DGS10: [-10, 30],
    DGS30: [-10, 30],
    DFII10: [-10, 30],
    VIXCLS: [0, 200],
    NASDAQ100: [100, 100_000],
    SP500: [100, 20_000],
    WALCL: [100_000, 20_000_000],
    RECPROUSM156N: [0, 100],
    GDPNOW: [-40, 40],
    THREEFYTP10: [-5, 10],
  };
  for (const [seriesId, [minimum, maximum]] of Object.entries(latestRanges)) {
    const value = latest(store[seriesId])?.value;
    if (value !== undefined && (value < minimum || value > maximum)) {
      issues.push(`${seriesId} latest value is outside its validation range.`);
    }
  }
  return [...new Set(issues)];
}

function scoreAt(store: SeriesStore, date: string) {
  const unrate = atOrBefore(store.UNRATE, date)?.value;
  const payroll = atOrBefore(store.PAYEMS, date);
  const payrollSeries = store.PAYEMS?.filter((row) => row.date <= date) ?? [];
  const payrollPrior = payrollSeries.at(-4);
  const claims = atOrBefore(store.ICSA, date);
  const claimsSeries = store.ICSA?.filter((row) => row.date <= date) ?? [];
  const claimsPrior = claimsSeries.at(-14);
  const indpro = atOrBefore(store.INDPRO, date);
  const indproSeries = store.INDPRO?.filter((row) => row.date <= date) ?? [];
  const indproPrior = indproSeries.at(-13);
  const gdp = atOrBefore(store.GDPC1, date);
  const gdpSeries = store.GDPC1?.filter((row) => row.date <= date) ?? [];
  const gdpPrior = gdpSeries.at(-5);

  const payrollAverage =
    payroll && payrollPrior ? (payroll.value - payrollPrior.value) / 3 : 100;
  const claimsChange =
    claims && claimsPrior ? (claims.value / claimsPrior.value - 1) * 100 : 0;
  const indproYoy =
    indpro && indproPrior ? (indpro.value / indproPrior.value - 1) * 100 : 0;
  const gdpYoy = gdp && gdpPrior ? (gdp.value / gdpPrior.value - 1) * 100 : 2;
  const unemploymentScore = unrate === undefined ? 50 : 70 - Math.max(0, unrate - 3.5) * 12;
  const growth = clamp(
    (clamp(50 + (payrollAverage - 100) / 5) +
      clamp(50 - claimsChange * 2) +
      clamp(50 + indproYoy * 8) +
      clamp(50 + (gdpYoy - 1.5) * 12) +
      clamp(unemploymentScore)) / 5,
  );

  const inflationSeries = ["CPIAUCSL", "CPILFESL", "PCEPILFE"] as const;
  const coolingSignals = inflationSeries.map((id) => {
    const rows = store[id]?.filter((row) => row.date <= date) ?? [];
    const current = rows.at(-1);
    const yearAgo = rows.at(-13);
    const threeMonthsAgo = rows.at(-4);
    const fifteenMonthsAgo = rows.at(-16);
    if (!current || !yearAgo || !threeMonthsAgo || !fifteenMonthsAgo) return 50;
    const currentYoy = (current.value / yearAgo.value - 1) * 100;
    const priorYoy = (threeMonthsAgo.value / fifteenMonthsAgo.value - 1) * 100;
    return clamp(50 - (currentYoy - priorYoy) * 28);
  });
  // Sticky-price CPI and trimmed-mean PCE are published as year-over-year
  // rates already, so their three-month change is read directly rather than
  // rebuilt from an index. They carry the same weight as one index series each
  // because they answer a different question: whether the disinflation is in
  // the components that rarely reverse.
  const persistentSignals = (["CORESTICKM159SFRBATL", "PCETRIM12M159SFRBDAL"] as const).map((id) => {
    const rows = store[id]?.filter((row) => row.date <= date) ?? [];
    const current = rows.at(-1);
    const threeMonthsAgo = rows.at(-4);
    if (!current || !threeMonthsAgo) return null;
    return clamp(50 - (current.value - threeMonthsAgo.value) * 28);
  });
  const availableSignals = [...coolingSignals, ...persistentSignals].filter(
    (value): value is number => value !== null,
  );
  const inflation =
    availableSignals.reduce((sum, value) => sum + value, 0) / availableSignals.length;
  return { growth, inflation };
}

/**
 * Observations up to and including a date.
 *
 * Binary search rather than a filter, because replaying the daily model walks
 * this over every session in the calibration window and a linear scan of the
 * full series per call makes that quadratic. The series are stored ascending,
 * which is what makes the search valid.
 */
function observationsThrough(series: Observation[] | undefined, date: string) {
  if (!series?.length) return [];
  let low = 0;
  let high = series.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (series[middle].date <= date) low = middle + 1;
    else high = middle;
  }
  return series.slice(0, low);
}

/**
 * Replays the same end-of-day direction/behavior model used by the current
 * read, but stops every input at a historical session. This avoids the common
 * charting error of plotting today's classification against old prices.
 */
function marketStateAt(store: SeriesStore, date: string) {
  const nq = observationsThrough(store.NASDAQ100, date);
  const spx = observationsThrough(store.SP500, date);
  const credit = observationsThrough(store.BAMLH0A0HYM2, date);
  const volatility = observationsThrough(store.VIXCLS, date);
  if (nq.length < 62 || spx.length < 62) return null;

  const nq20 = percentChange(nq, 20);
  const nq60 = percentChange(nq, 60);
  const spx20 = percentChange(spx, 20);
  const spx60 = percentChange(spx, 60);
  const nq20Average = movingAverage(nq, 20);
  const nq60Average = movingAverage(nq, 60);
  const spx20Average = movingAverage(spx, 20);
  const spx60Average = movingAverage(spx, 60);
  const nqAverageGap =
    nq20Average !== null && nq60Average !== null ? (nq20Average / nq60Average - 1) * 100 : null;
  const spxAverageGap =
    spx20Average !== null && spx60Average !== null ? (spx20Average / spx60Average - 1) * 100 : null;
  const nqEfficiency = pathEfficiency(nq, 20);
  const spxEfficiency = pathEfficiency(spx, 20);
  const nqPersistence = directionalPersistence(nq, 20);
  const spxPersistence = directionalPersistence(spx, 20);
  const nqAutocorrelation = returnAutocorrelation(nq, 20);
  const spxAutocorrelation = returnAutocorrelation(spx, 20);
  const creditImpulse = change(credit, 20);
  const vixImpulse = percentChange(volatility, 20);
  const directionComponents = [
    { value: signedScale(nq20, 6), weight: 0.24 },
    { value: signedScale(nq60, 12), weight: 0.18 },
    { value: signedScale(spx20, 5), weight: 0.16 },
    { value: signedScale(spx60, 10), weight: 0.12 },
    { value: signedScale(nqAverageGap, 2.5), weight: 0.12 },
    { value: signedScale(spxAverageGap, 2.2), weight: 0.08 },
    { value: signedScale(creditImpulse === null ? null : -creditImpulse, 0.45), weight: 0.06 },
    { value: signedScale(vixImpulse === null ? null : -vixImpulse, 18), weight: 0.04 },
  ];
  const directionScore = directionComponents.reduce(
    (sum, component) => sum + component.value * component.weight,
    0,
  );
  const averageEfficiency = ((nqEfficiency ?? 0.25) + (spxEfficiency ?? 0.25)) / 2;
  const averagePersistence = ((nqPersistence ?? 0.5) + (spxPersistence ?? 0.5)) / 2;
  const averageSeparation = (Math.abs(nqAverageGap ?? 0) + Math.abs(spxAverageGap ?? 0)) / 2;
  const averageAutocorrelation = ((nqAutocorrelation ?? 0) + (spxAutocorrelation ?? 0)) / 2;
  const behaviorScore = clamp(
    clamp(((averageEfficiency - 0.15) / 0.45) * 100) * 0.5 +
      clamp(((averagePersistence - 0.5) / 0.2) * 100) * 0.2 +
      clamp(averageSeparation * 20) * 0.2 +
      clamp(50 + averageAutocorrelation * 200) * 0.1,
  );
  const direction =
    directionScore >= 15 ? "Bullish" : directionScore <= -15 ? "Bearish" : "Neutral";
  const behavior =
    behaviorScore >= 58 ? "Trending" : behaviorScore <= 42 ? "Mean-reverting" : "Transitional";
  const name =
    behavior === "Trending"
      ? direction === "Neutral" ? "Trend without a clear bias" : `${direction} trend`
      : behavior === "Mean-reverting"
        ? direction === "Neutral" ? "Range / mean-reverting" : `${direction} but mean-reverting`
        : `${direction} transition`;
  return {
    date,
    direction,
    behavior,
    name,
    directionScore: Math.round(directionScore),
    behaviorScore: Math.round(behaviorScore),
    ndxReturn20: nq20,
  };
}

/**
 * Measures how the index behaved around a set of scheduled events.
 *
 * Sessions are located by date rather than by index arithmetic, so a release
 * that lands on a holiday or weekend simply uses the next session. Returns are
 * close-to-close, which means the release-day figure includes the reaction to
 * a number published before the open.
 */
function eventWindowStudy(
  series: Observation[] | undefined,
  dates: string[],
  label: string,
  note: string,
) {
  if (!series?.length || !dates.length) return null;
  const indexByDate = new Map(series.map((row, index) => [row.date, index]));
  const sessionIndex = (date: string) => {
    const exact = indexByDate.get(date);
    if (exact !== undefined) return exact;
    const found = series.findIndex((row) => row.date >= date);
    return found === -1 ? null : found;
  };
  const sample: Array<{ date: string; day: number; next: number | null; week: number | null }> = [];
  for (const date of dates) {
    const index = sessionIndex(date);
    if (index === null || index < 1) continue;
    const previous = series[index - 1];
    const current = series[index];
    if (!previous || !current) continue;
    const day = (current.value / previous.value - 1) * 100;
    const nextRow = series[index + 1];
    const weekRow = series[index + 5];
    sample.push({
      date: current.date,
      day,
      next: nextRow ? (nextRow.value / current.value - 1) * 100 : null,
      week: weekRow ? (weekRow.value / current.value - 1) * 100 : null,
    });
  }
  if (sample.length < 8) return null;

  const dayMoves = sample.map((row) => row.day);
  const absoluteMoves = dayMoves.map((value) => Math.abs(value));
  const weekMoves = sample.flatMap((row) => (row.week === null ? [] : [row.week]));
  const baselineMoves = series
    .slice(1)
    .map((row, index) => Math.abs((row.value / series[index].value - 1) * 100));
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    label,
    note,
    events: sample.length,
    firstEvent: sample[0].date,
    lastEvent: sample.at(-1)!.date,
    medianDayMove: percentile(dayMoves, 0.5),
    medianAbsoluteMove: percentile(absoluteMoves, 0.5),
    baselineAbsoluteMove: percentile(baselineMoves, 0.5),
    positiveShare: (dayMoves.filter((value) => value > 0).length / dayMoves.length) * 100,
    worst: Math.min(...dayMoves),
    best: Math.max(...dayMoves),
    medianWeekMove: weekMoves.length >= 8 ? percentile(weekMoves, 0.5) : null,
    meanDayMove: mean(dayMoves),
    recent: sample.slice(-6).reverse(),
  };
}

/**
 * Extends an index series with the session FRED has not published yet.
 *
 * FRED republishes an equity close on the next business day, so the regime runs
 * a session behind for no reason other than the publication calendar: the close
 * itself is already in this database, captured by the options workspace from
 * the exchange at the time of the snapshot. Reading it here is not forecasting
 * and not a second opinion on a published number — it is the same session,
 * ahead of the wire.
 *
 * Three guards, because a provisional close is only worth having if it cannot
 * be wrong. The snapshot must be for a date after the last published one, that
 * date's session must have finished, and the price has to be a positive number.
 * A partial intraday print can never enter as a close.
 */
function nowcastSession(series: Observation[] | undefined, symbol: "NDX" | "SPX") {
  const published = series?.at(-1);
  if (!series || !published) return { series: series ?? [], provisional: null };
  const stored = getSnapshot<{ data?: { current_price?: unknown } }>(
    "options-raw",
    `${symbol}:eod:market-asof`,
  );
  if (!stored?.sourceTime) return { series, provisional: null };
  const date = easternDate(new Date(stored.sourceTime));
  if (date <= published.date) return { series, provisional: null };
  if (date > latestCompletedTradingDate()) return { series, provisional: null };
  const price = Number(stored.payload?.data?.current_price);
  if (!Number.isFinite(price) || price <= 0) return { series, provisional: null };
  return {
    series: [...series, { date, value: price }],
    provisional: { date, value: price },
  };
}

async function buildPayload() {
  const [seriesResult, cotResults, fomcMeetings, recentReleases, scheduledReleases] = await Promise.all([
    loadMacroSeriesStore(FRED_IDS),
    Promise.allSettled([fetchCot("NASDAQ MINI"), fetchCot("E-MINI S&P 500")]),
    loadFomcMeetings().catch(() => null),
    loadRecentReleases().catch(() => null),
    loadScheduledReleases().catch(() => null),
  ]);
  const studyYears = Array.from({ length: 11 }, (_, index) => new Date().getUTCFullYear() - 10 + index);
  const publishedReleaseDates = await loadPublishedReleaseDates(studyYears).catch(() => []);
  // A meeting is "upcoming" through its final day, so a two-day meeting stays
  // listed while it is in progress.
  const todayEastern = easternDate();
  const upcomingMeetings = (fomcMeetings ?? [])
    .filter((meeting) => meeting.end >= todayEastern)
    .slice(0, 6);
  const upcomingReleases = (scheduledReleases ?? [])
    .filter((release) => release.startsAt >= new Date().toISOString())
    .filter((release) => release.importance === "major")
    .slice(0, 12);
  const publishedStore = seriesResult.store as SeriesStore;
  const unavailableSeries = seriesResult.unavailable;
  // Close the publication gap before anything is scored, so the regime, the
  // history chart and the outlook all describe the same latest session.
  const nowcastNdx = nowcastSession(publishedStore.NASDAQ100, "NDX");
  const nowcastSpx = nowcastSession(publishedStore.SP500, "SPX");
  // Only when both indices can be advanced. The direction score blends the two,
  // and moving one without the other would read as a divergence that did not
  // happen.
  const nowcast =
    nowcastNdx.provisional && nowcastSpx.provisional &&
    nowcastNdx.provisional.date === nowcastSpx.provisional.date
      ? { date: nowcastNdx.provisional.date, ndx: nowcastNdx.provisional.value, spx: nowcastSpx.provisional.value }
      : null;
  const store: SeriesStore = nowcast
    ? { ...publishedStore, NASDAQ100: nowcastNdx.series, SP500: nowcastSpx.series }
    : publishedStore;
  const requiredSeries = [
    "CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "ICSA", "GDPC1",
    "INDPRO", "DFII10", "WALCL", "WTREGEN", "RRPONTSYD", "BAMLH0A0HYM2", "NFCI", "VIXCLS",
    "NASDAQ100", "SP500",
  ];
  const missingRequired = requiredSeries.filter((id) => !store[id]?.length);
  if (missingRequired.length) {
    throw new Error(`Required economic series unavailable: ${missingRequired.join(", ")}`);
  }
  const qualityIssues = validateSeriesStore(store);
  const requiredQualityIssue = qualityIssues.find((issue) =>
    requiredSeries.some((seriesId) => issue.startsWith(seriesId)),
  );
  if (requiredQualityIssue) throw new Error(`Economic-data validation failed: ${requiredQualityIssue}`);
  const nqCot = cotResults[0].status === "fulfilled" ? cotResults[0].value : [];
  const esCot = cotResults[1].status === "fulfilled" ? cotResults[1].value : [];

  const cpiYoy = yoy(store.CPIAUCSL, 12);
  const coreCpiYoy = yoy(store.CPILFESL, 12);
  const corePceYoy = yoy(store.PCEPILFE, 12);
  const payrollChange = change(store.PAYEMS, 1);
  const gdpYoy = yoy(store.GDPC1, 4);
  const m2Yoy = yoy(store.M2SL, 12);
  const industrialYoy = yoy(store.INDPRO, 12);
  const retailYoy = yoy(store.RSAFS, 12);
  const walcl = latest(store.WALCL)?.value ?? null;
  const tga = latest(store.WTREGEN)?.value ?? null;
  const rrpBillions = latest(store.RRPONTSYD)?.value ?? null;
  const currentNetLiquidity = netLiquidity(walcl, tga, rrpBillions);
  const walcl13 = latest(store.WALCL, 13)?.value ?? null;
  const tga13 = latest(store.WTREGEN, 13)?.value ?? null;
  const rrp13 = latest(store.RRPONTSYD, 65)?.value ?? null;
  const netLiquidity13 = netLiquidity(walcl13, tga13, rrp13);
  const liquidityChange =
    currentNetLiquidity !== null && netLiquidity13 !== null && netLiquidity13 !== 0
      ? (currentNetLiquidity / netLiquidity13 - 1) * 100
      : null;
  const nq20 = percentChange(store.NASDAQ100, 20);
  const nq60 = percentChange(store.NASDAQ100, 60);
  const spx20 = percentChange(store.SP500, 20);
  const spx60 = percentChange(store.SP500, 60);
  const nq20Average = movingAverage(store.NASDAQ100, 20);
  const nq60Average = movingAverage(store.NASDAQ100, 60);
  const spx20Average = movingAverage(store.SP500, 20);
  const spx60Average = movingAverage(store.SP500, 60);
  const nqAverageGap =
    nq20Average !== null && nq60Average !== null ? (nq20Average / nq60Average - 1) * 100 : null;
  const spxAverageGap =
    spx20Average !== null && spx60Average !== null ? (spx20Average / spx60Average - 1) * 100 : null;
  const nqEfficiency = pathEfficiency(store.NASDAQ100, 20);
  const spxEfficiency = pathEfficiency(store.SP500, 20);
  const nqPersistence = directionalPersistence(store.NASDAQ100, 20);
  const spxPersistence = directionalPersistence(store.SP500, 20);
  const nqAutocorrelation = returnAutocorrelation(store.NASDAQ100, 20);
  const spxAutocorrelation = returnAutocorrelation(store.SP500, 20);
  const nqRealizedVol = realizedVolatility(store.NASDAQ100, 20);
  const nqDrawdown = drawdownFromHigh(store.NASDAQ100, 60);
  const vixValue = latest(store.VIXCLS)?.value ?? null;
  const vix3mValue = latest(store.VXVCLS)?.value ?? null;
  const vixCurve =
    vixValue !== null && vix3mValue !== null && vix3mValue !== 0
      ? vixValue / vix3mValue
      : null;
  const housingYoy = yoy(store.HOUST, 12);
  const continuingClaims13w = percentChange(store.CCSA, 13);

  // The published curve model runs on monthly average spreads, so the daily
  // series is collapsed before the probit is applied.
  const curveMonths = monthlyAverages(store.T10Y3M, 61);
  const curveProbabilities = curveMonths.flatMap((row) => {
    const probability = curveRecessionProbability(row.value);
    return probability === null ? [] : [{ date: row.date, spread: row.value, probability: probability * 100 }];
  });
  const currentCurveRisk = curveProbabilities.at(-1) ?? null;
  const curveRisk3mAgo = curveProbabilities.at(-4) ?? null;
  const curveRisk12mAgo = curveProbabilities.at(-13) ?? null;
  const curveRiskChange3m =
    currentCurveRisk && curveRisk3mAgo ? currentCurveRisk.probability - curveRisk3mAgo.probability : null;
  const smoothedByMonth = new Map(
    (store.RECPROUSM156N ?? []).map((row) => [row.date.slice(0, 7), row.value]),
  );
  const smoothedRecession = latest(store.RECPROUSM156N);
  const smoothedRecessionChange = change(store.RECPROUSM156N, 3);
  const gdpNow = latest(store.GDPNOW);
  const gdpNowChange = change(store.GDPNOW, 1);
  // GDPNow is published for the quarter it is estimating, and FRED carries the
  // last value of each quarter. Labelling it "current quarter" would be wrong
  // between the end of a quarter and the first estimate of the next one.
  const gdpNowQuarterStart = gdpNow ? Number(gdpNow.date.slice(5, 7)) : null;
  const gdpNowQuarter = gdpNow && gdpNowQuarterStart
    ? `Q${Math.floor((gdpNowQuarterStart - 1) / 3) + 1} ${gdpNow.date.slice(0, 4)}`
    : null;
  const gdpNowQuarterEnd = gdpNow
    ? new Date(Date.UTC(Number(gdpNow.date.slice(0, 4)), Number(gdpNow.date.slice(5, 7)) + 2, 0))
        .toISOString()
        .slice(0, 10)
    : null;
  const gdpNowInProgress = gdpNowQuarterEnd !== null && gdpNowQuarterEnd >= easternDate();
  // Kim-Wright is published with a short lag, so the nominal yield is read at
  // the term-premium observation date rather than at today's close. Otherwise
  // the residual would absorb several sessions of unrelated yield movement.
  const termPremiumLatest = latest(store.THREEFYTP10);
  const termPremiumPrior = latest(store.THREEFYTP10, 20);
  const alignedTenYear = termPremiumLatest
    ? atOrBefore(store.DGS10, termPremiumLatest.date)?.value ?? null
    : null;
  const alignedTenYearPrior = termPremiumPrior
    ? atOrBefore(store.DGS10, termPremiumPrior.date)?.value ?? null
    : null;
  const decomposition = yieldDecomposition(alignedTenYear, termPremiumLatest?.value ?? null);
  const termPremiumChange =
    termPremiumLatest && termPremiumPrior ? termPremiumLatest.value - termPremiumPrior.value : null;
  const nominalChange =
    alignedTenYear !== null && alignedTenYearPrior !== null ? alignedTenYear - alignedTenYearPrior : null;
  const expectationsChange =
    nominalChange !== null && termPremiumChange !== null ? nominalChange - termPremiumChange : null;

  const stickyCpi = latest(store.CORESTICKM159SFRBATL);
  const trimmedPce = latest(store.PCETRIM12M159SFRBDAL);
  const headlineYoySeries = yoySeries(store.CPIAUCSL, 12);
  const inflationGapSeries = diffTwoSeries(store.CORESTICKM159SFRBATL, headlineYoySeries);
  const inflationGap = latest(inflationGapSeries)?.value ?? null;
  const inflationGapChange = change(inflationGapSeries, 3);

  const tempHelpYoy = yoy(store.TEMPHELPS, 12);
  const quitsRate = latest(store.JTSQUR);
  const weeklyHours = latest(store.AWHAETP);
  // Openings are a level in thousands and unemployment is a rate, so the ratio
  // is rebuilt from the unemployment level implied by the labor force rather
  // than mixing units.
  const openingsRatioSeries = ratioSeries(store.JTSJOL, unemployedLevelSeries(store));
  const openingsPerUnemployed = latest(openingsRatioSeries)?.value ?? null;
  const openingsRatioChange = change(openingsRatioSeries, 3);

  const lendingStandards = latest(store.DRTSCILM);
  const bankCreditYoy = yoy(store.TOTBKCR, 52);
  const ciLoansYoy = yoy(store.BUSLOANS, 12);

  const expectationsTrack = (store.THREEFYTP10 ?? []).flatMap((row) => {
    const nominal = atOrBefore(store.DGS10, row.date)?.value;
    return nominal === undefined ? [] : [{ date: row.date, value: nominal - row.value }];
  });
  const netLiquidityTrack = (store.WALCL ?? []).flatMap((row) => {
    const cash = atOrBefore(store.WTREGEN, row.date)?.value ?? null;
    const repo = atOrBefore(store.RRPONTSYD, row.date)?.value ?? null;
    const value = netLiquidity(row.value, cash, repo);
    return value === null ? [] : [{ date: row.date, value }];
  });

  const metrics: MacroMetric[] = [
    metric(store, { id: "cpi", label: "CPI inflation", group: "Inflation", series: "CPIAUCSL", track: yoySeries(store.CPIAUCSL, 12), value: cpiYoy, display: `${formatNumber(cpiYoy)}% YoY`, change: percentChange(store.CPIAUCSL, 1), changeDisplay: `${formatSigned(percentChange(store.CPIAUCSL, 1), "% MoM", 2)}`, frequency: "Monthly", meaning: "Headline consumer-price inflation." }),
    metric(store, { id: "core-cpi", label: "Core CPI", group: "Inflation", series: "CPILFESL", track: yoySeries(store.CPILFESL, 12), value: coreCpiYoy, display: `${formatNumber(coreCpiYoy)}% YoY`, change: percentChange(store.CPILFESL, 1), changeDisplay: `${formatSigned(percentChange(store.CPILFESL, 1), "% MoM", 2)}`, frequency: "Monthly", meaning: "Consumer inflation excluding food and energy." }),
    metric(store, { id: "core-pce", label: "Core PCE", group: "Inflation", series: "PCEPILFE", track: yoySeries(store.PCEPILFE, 12), value: corePceYoy, display: `${formatNumber(corePceYoy)}% YoY`, change: percentChange(store.PCEPILFE, 1), changeDisplay: `${formatSigned(percentChange(store.PCEPILFE, 1), "% MoM", 2)}`, frequency: "Monthly", meaning: "The Federal Reserve's preferred underlying inflation gauge." }),
    metric(store, { id: "sticky-cpi", label: "Sticky-price CPI", group: "Inflation", series: "CORESTICKM159SFRBATL", value: stickyCpi?.value ?? null, display: `${formatNumber(stickyCpi?.value ?? null)}% YoY`, change: change(store.CORESTICKM159SFRBATL, 3), changeDisplay: `${formatSigned(change(store.CORESTICKM159SFRBATL, 3), " pp")} over 3 months`, frequency: "Monthly", meaning: "Atlanta Fed index built from the CPI components that change price infrequently. Because those prices embed expectations, it moves late but reverses rarely, so it distinguishes durable disinflation from a favorable base effect." }),
    metric(store, { id: "trimmed-pce", label: "Trimmed-mean PCE", group: "Inflation", series: "PCETRIM12M159SFRBDAL", value: trimmedPce?.value ?? null, display: `${formatNumber(trimmedPce?.value ?? null)}% YoY`, change: change(store.PCETRIM12M159SFRBDAL, 3), changeDisplay: `${formatSigned(change(store.PCETRIM12M159SFRBDAL, 3), " pp")} over 3 months`, frequency: "Monthly", meaning: "Dallas Fed measure that discards the largest price moves in both directions each month rather than excluding fixed categories, so a single volatile component cannot flatter or spoil the read." }),
    metric(store, { id: "inflation-breadth", label: "Sticky less headline", group: "Inflation", series: "CORESTICKM159SFRBATL", track: inflationGapSeries, value: inflationGap, display: `${formatSigned(inflationGap, " pp")}`, change: inflationGapChange, changeDisplay: `${formatSigned(inflationGapChange, " pp")} over 3 months`, frequency: "Monthly", meaning: "Sticky-price inflation minus headline CPI. A wide positive gap means headline cooling is running ahead of the persistent core, which historically closes by headline rising rather than sticky falling." }),
    metric(store, { id: "breakevens", label: "5y / 10y breakevens", group: "Inflation", series: "T5YIE", value: latest(store.T5YIE)?.value ?? null, display: `${formatNumber(latest(store.T5YIE)?.value ?? null)}% / ${formatNumber(latest(store.T10YIE)?.value ?? null)}%`, change: change(store.T5YIE, 5), changeDisplay: `${formatSigned(change(store.T5YIE, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Market-implied average inflation over five and ten years." }),
    metric(store, { id: "forward-inflation", label: "5y5y forward inflation", group: "Inflation", series: "T5YIFR", value: latest(store.T5YIFR)?.value ?? null, display: `${formatNumber(latest(store.T5YIFR)?.value ?? null)}%`, change: change(store.T5YIFR, 5), changeDisplay: `${formatSigned(change(store.T5YIFR, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Longer-run market inflation expectations." }),

    metric(store, { id: "unemployment", label: "Unemployment rate", group: "Growth", series: "UNRATE", value: latest(store.UNRATE)?.value ?? null, display: `${formatNumber(latest(store.UNRATE)?.value ?? null, 1)}%`, change: change(store.UNRATE, 3), changeDisplay: `${formatSigned(change(store.UNRATE, 3), " pp", 1)} over 3 months`, frequency: "Monthly", meaning: "Share of the labor force actively seeking work." }),
    metric(store, { id: "payrolls", label: "Nonfarm payrolls", group: "Growth", series: "PAYEMS", track: diffSeries(store.PAYEMS, 1), value: payrollChange, display: `${formatSigned(payrollChange, "k", 0)}`, change: change(store.PAYEMS, 3), changeDisplay: `${formatSigned(change(store.PAYEMS, 3), "k", 0)} over 3 months`, frequency: "Monthly", meaning: "Monthly change in US payroll employment." }),
    metric(store, { id: "claims", label: "Initial jobless claims", group: "Growth", series: "ICSA", value: latest(store.ICSA)?.value ?? null, display: latest(store.ICSA) ? `${formatNumber(latest(store.ICSA)!.value / 1000, 0)}k` : "Unavailable", change: percentChange(store.ICSA, 13), changeDisplay: `${formatSigned(percentChange(store.ICSA, 13), "%", 1)} over 13 weeks`, frequency: "Weekly", meaning: "New unemployment-insurance claims." }),
    metric(store, { id: "gdp", label: "Real GDP", group: "Growth", series: "GDPC1", track: yoySeries(store.GDPC1, 4), value: gdpYoy, display: `${formatSigned(gdpYoy, "% YoY", 1)}`, change: percentChange(store.GDPC1, 1), changeDisplay: `${formatSigned(percentChange(store.GDPC1, 1), "% from prior quarter", 1)}`, frequency: "Quarterly", meaning: "Inflation-adjusted economic output; the quarter-over-quarter change shown is not annualized." }),
    metric(store, { id: "industrial", label: "Industrial production", group: "Growth", series: "INDPRO", track: yoySeries(store.INDPRO, 12), value: industrialYoy, display: `${formatSigned(industrialYoy, "% YoY", 1)}`, change: percentChange(store.INDPRO, 1), changeDisplay: `${formatSigned(percentChange(store.INDPRO, 1), "% MoM", 1)}`, frequency: "Monthly", meaning: "Output from factories, mines, and utilities." }),
    metric(store, { id: "retail", label: "Retail sales", group: "Growth", series: "RSAFS", track: yoySeries(store.RSAFS, 12), value: retailYoy, display: `${formatSigned(retailYoy, "% YoY", 1)}`, change: percentChange(store.RSAFS, 1), changeDisplay: `${formatSigned(percentChange(store.RSAFS, 1), "% MoM", 1)}`, frequency: "Monthly", meaning: "Nominal spending at US retailers." }),
    metric(store, { id: "sentiment", label: "Consumer sentiment", group: "Growth", series: "UMCSENT", value: latest(store.UMCSENT)?.value ?? null, display: formatNumber(latest(store.UMCSENT)?.value ?? null, 1), change: change(store.UMCSENT, 1), changeDisplay: `${formatSigned(change(store.UMCSENT, 1), " points", 1)} MoM`, frequency: "Monthly", meaning: "University of Michigan consumer sentiment index." }),
    metric(store, { id: "temp-help", label: "Temporary-help payrolls", group: "Labor", series: "TEMPHELPS", track: yoySeries(store.TEMPHELPS, 12), value: tempHelpYoy, display: `${formatSigned(tempHelpYoy, "% YoY", 1)}`, change: percentChange(store.TEMPHELPS, 3), changeDisplay: `${formatSigned(percentChange(store.TEMPHELPS, 3), "%", 1)} over 3 months`, frequency: "Monthly", meaning: "Staffing-agency employment. Firms cut and add temporary workers before permanent ones, so this turns ahead of headline payrolls in both directions." }),
    metric(store, { id: "quits", label: "Quits rate", group: "Labor", series: "JTSQUR", value: quitsRate?.value ?? null, display: `${formatNumber(quitsRate?.value ?? null, 1)}%`, change: change(store.JTSQUR, 3), changeDisplay: `${formatSigned(change(store.JTSQUR, 3), " pp", 1)} over 3 months`, frequency: "Monthly", meaning: "Share of employed people voluntarily leaving each month. Quitting is a confidence decision, so the rate falls before layoffs rise." }),
    metric(store, { id: "openings-per-unemployed", label: "Openings per unemployed", group: "Labor", series: "JTSJOL", track: openingsRatioSeries, value: openingsPerUnemployed, display: formatNumber(openingsPerUnemployed, 2), change: openingsRatioChange, changeDisplay: `${formatSigned(openingsRatioChange, "", 2)} over 3 months`, frequency: "Monthly", meaning: "Job openings divided by unemployed people. Above one means more vacancies than job seekers; the speed of the decline matters more than the level." }),
    metric(store, { id: "weekly-hours", label: "Average weekly hours", group: "Labor", series: "AWHAETP", value: weeklyHours?.value ?? null, display: `${formatNumber(weeklyHours?.value ?? null, 1)} hours`, change: change(store.AWHAETP, 3), changeDisplay: `${formatSigned(change(store.AWHAETP, 3), " hours", 1)} over 3 months`, frequency: "Monthly", meaning: "Hours are trimmed before headcount, so a falling workweek is an early sign of labor demand weakening even while payrolls still grow." }),
    metric(store, { id: "continuing-claims", label: "Continuing jobless claims", group: "Cycle", series: "CCSA", value: latest(store.CCSA)?.value ?? null, display: latest(store.CCSA) ? `${formatNumber(latest(store.CCSA)!.value / 1000, 0)}k` : "Unavailable", change: continuingClaims13w, changeDisplay: `${formatSigned(continuingClaims13w, "%", 1)} over 13 weeks`, frequency: "Weekly", meaning: "People continuing to receive unemployment insurance; useful for detecting labor-market deterioration." }),
    metric(store, { id: "housing-starts", label: "Housing starts", group: "Cycle", series: "HOUST", track: yoySeries(store.HOUST, 12), value: housingYoy, display: `${formatSigned(housingYoy, "% YoY", 1)}`, change: percentChange(store.HOUST, 1), changeDisplay: `${formatSigned(percentChange(store.HOUST, 1), "% MoM", 1)}`, frequency: "Monthly", meaning: "New residential construction starts, a rate-sensitive leading-cycle indicator." }),
    metric(store, { id: "cfnai", label: "Chicago Fed activity trend", group: "Cycle", series: "CFNAIMA3", value: latest(store.CFNAIMA3)?.value ?? null, display: formatNumber(latest(store.CFNAIMA3)?.value ?? null, 2), change: change(store.CFNAIMA3, 1), changeDisplay: `${formatSigned(change(store.CFNAIMA3, 1), "", 2)} MoM`, frequency: "Monthly", meaning: "Three-month average of national activity; zero represents growth near its historical trend." }),
    metric(store, { id: "gdpnow", label: `GDPNow · ${gdpNowQuarter ?? "latest quarter"}`, group: "Cycle", series: "GDPNOW", value: gdpNow?.value ?? null, display: `${formatSigned(gdpNow?.value ?? null, "% annualized", 1)}`, change: gdpNowChange, changeDisplay: `${formatSigned(gdpNowChange, " pp", 1)} versus the prior quarter`, frequency: "Quarterly", meaning: `Atlanta Fed nowcast of real GDP growth built from the releases already published. ${gdpNowInProgress ? "This quarter is still in progress, so the estimate moves with every input release." : "This quarter has closed, so the value is its final nowcast; the next quarter's estimate begins once enough source data is published."}` }),
    metric(store, { id: "recession-curve", label: "Curve recession probability", group: "Cycle", series: "T10Y3M", observedAt: currentCurveRisk?.date ?? null, value: currentCurveRisk?.probability ?? null, display: `${formatNumber(currentCurveRisk?.probability ?? null, 1)}%`, change: curveRiskChange3m, changeDisplay: `${formatSigned(curveRiskChange3m, " pp", 1)} over 3 months`, frequency: "Monthly", meaning: "Probability of a recession beginning within twelve months, recomputed here from the monthly average 10y–3m spread using the published probit specification. It is a reconstruction of the New York Fed model, not their released number." }),
    metric(store, { id: "recession-smoothed", label: "Smoothed recession probability", group: "Cycle", series: "RECPROUSM156N", value: smoothedRecession?.value ?? null, display: `${formatNumber(smoothedRecession?.value ?? null, 2)}%`, change: smoothedRecessionChange, changeDisplay: `${formatSigned(smoothedRecessionChange, " pp", 2)} over 3 months`, frequency: "Monthly", meaning: "Chauvet-Piger dynamic-factor estimate of whether the economy is in recession now, from payrolls, income, production, and sales. It describes the present, not the next twelve months." }),
    metric(store, { id: "sahm", label: "Real-time Sahm indicator", group: "Cycle", series: "SAHMREALTIME", value: latest(store.SAHMREALTIME)?.value ?? null, display: `${formatNumber(latest(store.SAHMREALTIME)?.value ?? null, 2)} pp`, change: change(store.SAHMREALTIME, 1), changeDisplay: `${formatSigned(change(store.SAHMREALTIME, 1), " pp", 2)} MoM`, frequency: "Monthly", meaning: "A recession-onset indicator based on the rise in unemployment; 0.50 percentage points is the traditional trigger." }),

    metric(store, { id: "ndx-momentum", label: "Nasdaq-100 momentum", group: "Market", series: "NASDAQ100", track: yoySeries(store.NASDAQ100, 20), value: nq20, display: `${formatSigned(nq20, "%", 1)} / ${formatSigned(nq60, "%", 1)}`, change: nq20, changeDisplay: "20-session / 60-session return", frequency: "Daily", meaning: "Short- and medium-horizon Nasdaq-100 price direction." }),
    metric(store, { id: "spx-momentum", label: "S&P 500 momentum", group: "Market", series: "SP500", track: yoySeries(store.SP500, 20), value: spx20, display: `${formatSigned(spx20, "%", 1)} / ${formatSigned(spx60, "%", 1)}`, change: spx20, changeDisplay: "20-session / 60-session return", frequency: "Daily", meaning: "Cross-index confirmation for the Nasdaq-100 directional read." }),
    metric(store, { id: "moving-average-structure", label: "20d / 60d trend structure", group: "Market", series: "NASDAQ100", value: nqAverageGap, display: `${formatSigned(nqAverageGap, "% NDX", 1)} / ${formatSigned(spxAverageGap, "% SPX", 1)}`, change: nqAverageGap, changeDisplay: "Moving-average separation", frequency: "Daily", meaning: "Positive separation means the faster average is above the slower average." }),
    metric(store, { id: "path-efficiency", label: "20d path efficiency", group: "Market", series: "NASDAQ100", track: rollingSeries(store.NASDAQ100, 20, (window) => pathEfficiency(window, 20)), value: nqEfficiency, display: `${formatNumber(nqEfficiency === null ? null : nqEfficiency * 100, 0)} / 100`, change: spxEfficiency, changeDisplay: `S&P 500: ${formatNumber(spxEfficiency === null ? null : spxEfficiency * 100, 0)} / 100`, frequency: "Daily", meaning: "Net displacement divided by total distance traveled; high values indicate a cleaner trend, while low values indicate a choppier path." }),
    metric(store, { id: "return-autocorrelation", label: "20d return persistence", group: "Market", series: "NASDAQ100", track: rollingSeries(store.NASDAQ100, 21, (window) => returnAutocorrelation(window, 20)), value: nqAutocorrelation, display: formatNumber(nqAutocorrelation, 2), change: spxAutocorrelation, changeDisplay: `S&P 500: ${formatNumber(spxAutocorrelation, 2)}`, frequency: "Daily", meaning: "Lag-one return autocorrelation; negative readings add evidence of short-horizon reversal, but are not sufficient alone." }),
    metric(store, { id: "realized-volatility", label: "Nasdaq-100 realized volatility", group: "Market", series: "NASDAQ100", track: rollingSeries(store.NASDAQ100, 20, (window) => realizedVolatility(window, 20)), value: nqRealizedVol, display: `${formatNumber(nqRealizedVol, 1)}%`, change: nqRealizedVol, changeDisplay: "20-session annualized", frequency: "Daily", meaning: "Annualized volatility calculated from the last 20 daily log returns." }),
    metric(store, { id: "drawdown", label: "Nasdaq-100 drawdown", group: "Market", series: "NASDAQ100", track: rollingSeries(store.NASDAQ100, 60, (window) => drawdownFromHigh(window, 61)), value: nqDrawdown, display: `${formatSigned(nqDrawdown, "%", 1)}`, change: nqDrawdown, changeDisplay: "From 60-session high", frequency: "Daily", meaning: "Distance from the highest Nasdaq-100 close in the last 60 sessions." }),

    ...(["DGS2", "DGS10", "DGS30"] as const).map((id) => metric(store, { id: id.toLowerCase(), label: `${id === "DGS2" ? "2y" : id === "DGS10" ? "10y" : "30y"} Treasury yield`, group: "Rates", series: id, value: latest(store[id])?.value ?? null, display: `${formatNumber(latest(store[id])?.value ?? null)}%`, change: change(store[id], 5), changeDisplay: `${formatSigned(change(store[id], 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "US Treasury constant-maturity yield." })),
    metric(store, { id: "curve-2s10s", label: "10y–2y yield spread", group: "Rates", series: "T10Y2Y", value: latest(store.T10Y2Y)?.value ?? null, display: `${formatNumber(latest(store.T10Y2Y)?.value ?? null)}%`, change: change(store.T10Y2Y, 5), changeDisplay: `${formatSigned(change(store.T10Y2Y, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "A common yield-curve slope measure." }),
    metric(store, { id: "curve-3m10y", label: "10y–3m yield spread", group: "Rates", series: "T10Y3M", value: latest(store.T10Y3M)?.value ?? null, display: `${formatNumber(latest(store.T10Y3M)?.value ?? null)}%`, change: change(store.T10Y3M, 5), changeDisplay: `${formatSigned(change(store.T10Y3M, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Long-rate minus short-rate slope." }),
    metric(store, { id: "real-yield", label: "10y real yield", group: "Rates", series: "DFII10", value: latest(store.DFII10)?.value ?? null, display: `${formatNumber(latest(store.DFII10)?.value ?? null)}%`, change: change(store.DFII10, 5), changeDisplay: `${formatSigned(change(store.DFII10, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Inflation-protected Treasury yield; important for long-duration equities." }),
    metric(store, { id: "term-premium", label: "10y term premium", group: "Rates", series: "THREEFYTP10", value: termPremiumLatest?.value ?? null, display: `${formatNumber(termPremiumLatest?.value ?? null)}%`, change: termPremiumChange, changeDisplay: `${formatSigned(termPremiumChange, " pp")} over 20 observations`, frequency: "Daily", meaning: "Kim-Wright estimate of the compensation demanded for holding ten-year duration rather than rolling short bills. Rising term premium means the long end is repricing risk, not policy." }),
    metric(store, { id: "rate-expectations", label: "10y expectations component", group: "Rates", series: "DGS10", observedAt: termPremiumLatest?.date ?? null, track: expectationsTrack, value: decomposition?.expectations ?? null, display: `${formatNumber(decomposition?.expectations ?? null)}%`, change: expectationsChange, changeDisplay: `${formatSigned(expectationsChange, " pp")} over 20 observations`, frequency: "Daily", meaning: "The ten-year yield less the term premium, both read at the term-premium observation date. It is the residual expected path of short rates, not an independently published series." }),
    ...(["SOFR", "EFFR", "IORB"] as const).map((id) => metric(store, { id: id.toLowerCase(), label: id, group: "Rates", series: id, value: latest(store[id])?.value ?? null, display: `${formatNumber(latest(store[id])?.value ?? null)}%`, change: change(store[id], 5), changeDisplay: `${formatSigned(change(store[id], 5), " pp")} over 5 observations`, frequency: "Daily", meaning: id === "SOFR" ? "Secured overnight funding rate." : id === "EFFR" ? "Effective federal funds rate." : "Interest paid on reserve balances." })),

    metric(store, { id: "fed-bs", label: "Fed balance sheet", group: "Liquidity", series: "WALCL", value: walcl, display: walcl === null ? "Unavailable" : `$${(walcl / 1_000_000).toFixed(2)}T`, change: change(store.WALCL, 13), changeDisplay: `${formatSigned(change(store.WALCL, 13), " million dollars", 0)} over 13 weeks`, frequency: "Weekly", meaning: "Total assets held by the Federal Reserve." }),
    metric(store, { id: "tga", label: "Treasury General Account", group: "Liquidity", series: "WTREGEN", value: tga, display: tga === null ? "Unavailable" : `$${(tga / 1000).toFixed(0)}B`, change: change(store.WTREGEN, 13), changeDisplay: `${formatSigned(change(store.WTREGEN, 13), " million dollars", 0)} over 13 weeks`, frequency: "Weekly", meaning: "The US Treasury's cash balance at the Fed." }),
    metric(store, { id: "rrp", label: "Reverse repo", group: "Liquidity", series: "RRPONTSYD", value: rrpBillions, display: rrpBillions === null ? "Unavailable" : `$${formatNumber(rrpBillions, 0)}B`, change: change(store.RRPONTSYD, 65), changeDisplay: `${formatSigned(change(store.RRPONTSYD, 65), "B", 0)} over roughly 13 weeks`, frequency: "Daily", meaning: "Cash placed overnight in the Fed's reverse-repo facility." }),
    metric(store, { id: "net-liquidity", label: "Net liquidity proxy", group: "Liquidity", series: "WALCL", track: netLiquidityTrack, value: currentNetLiquidity, display: currentNetLiquidity === null ? "Unavailable" : `$${(currentNetLiquidity / 1_000_000).toFixed(2)}T`, change: liquidityChange, changeDisplay: `${formatSigned(liquidityChange, "%", 1)} over roughly 13 weeks`, frequency: "Mixed", meaning: "Fed assets minus TGA minus overnight reverse repo; a proxy, not an official statistic." }),
    metric(store, { id: "reserves", label: "Reserve balances", group: "Liquidity", series: "WRESBAL", value: latest(store.WRESBAL)?.value ?? null, display: latest(store.WRESBAL) ? `$${(latest(store.WRESBAL)!.value / 1_000_000).toFixed(2)}T` : "Unavailable", change: change(store.WRESBAL, 13), changeDisplay: `${formatSigned(change(store.WRESBAL, 13), " million dollars", 0)} over 13 weeks`, frequency: "Weekly", meaning: "Depository-institution reserve balances at Federal Reserve Banks." }),
    metric(store, { id: "m2", label: "M2 money supply", group: "Liquidity", series: "M2SL", track: yoySeries(store.M2SL, 12), value: m2Yoy, display: `${formatSigned(m2Yoy, "% YoY", 1)}`, change: percentChange(store.M2SL, 3), changeDisplay: `${formatSigned(percentChange(store.M2SL, 3), "%", 1)} over 3 months`, frequency: "Monthly", meaning: "Broad money stock including deposits and retail money funds." }),

    metric(store, { id: "hy-spread", label: "High-yield credit spread", group: "Stress", series: "BAMLH0A0HYM2", value: latest(store.BAMLH0A0HYM2)?.value ?? null, display: `${formatNumber(latest(store.BAMLH0A0HYM2)?.value ?? null)}%`, change: change(store.BAMLH0A0HYM2, 5), changeDisplay: `${formatSigned(change(store.BAMLH0A0HYM2, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Option-adjusted spread on US high-yield corporate bonds." }),
    metric(store, { id: "ig-spread", label: "Investment-grade spread", group: "Stress", series: "BAMLC0A0CM", value: latest(store.BAMLC0A0CM)?.value ?? null, display: `${formatNumber(latest(store.BAMLC0A0CM)?.value ?? null)}%`, change: change(store.BAMLC0A0CM, 5), changeDisplay: `${formatSigned(change(store.BAMLC0A0CM, 5), " pp")} over 5 observations`, frequency: "Daily", meaning: "Option-adjusted spread on US investment-grade corporate bonds." }),
    metric(store, { id: "nfci", label: "Financial conditions", group: "Stress", series: "NFCI", value: latest(store.NFCI)?.value ?? null, display: formatNumber(latest(store.NFCI)?.value ?? null, 3), change: change(store.NFCI, 4), changeDisplay: `${formatSigned(change(store.NFCI, 4), "", 3)} over 4 weeks`, frequency: "Weekly", meaning: "Chicago Fed index; positive values indicate tighter-than-average conditions." }),
    metric(store, { id: "anfci", label: "Growth-adjusted conditions", group: "Stress", series: "ANFCI", value: latest(store.ANFCI)?.value ?? null, display: formatNumber(latest(store.ANFCI)?.value ?? null, 3), change: change(store.ANFCI, 4), changeDisplay: `${formatSigned(change(store.ANFCI, 4), "", 3)} over 4 weeks`, frequency: "Weekly", meaning: "Financial conditions after adjusting for prevailing economic conditions." }),
    metric(store, { id: "stlfsi", label: "St. Louis financial stress", group: "Stress", series: "STLFSI4", value: latest(store.STLFSI4)?.value ?? null, display: formatNumber(latest(store.STLFSI4)?.value ?? null, 3), change: change(store.STLFSI4, 4), changeDisplay: `${formatSigned(change(store.STLFSI4, 4), "", 3)} over 4 weeks`, frequency: "Weekly", meaning: "A broad market-stress composite where zero is normal and positive values indicate above-average stress." }),
    ...(["VIXCLS", "VXNCLS"] as const).map((id) => metric(store, { id: id.toLowerCase(), label: id === "VIXCLS" ? "VIX" : "VXN", group: "Stress", series: id, value: latest(store[id])?.value ?? null, display: formatNumber(latest(store[id])?.value ?? null, 1), change: change(store[id], 5), changeDisplay: `${formatSigned(change(store[id], 5), " points", 1)} over 5 observations`, frequency: "Daily", meaning: id === "VIXCLS" ? "S&P 500 option-implied volatility index." : "Nasdaq-100 option-implied volatility index." })),
    metric(store, { id: "lending-standards", label: "C&I lending standards", group: "Credit", series: "DRTSCILM", value: lendingStandards?.value ?? null, display: `${formatSigned(lendingStandards?.value ?? null, "% net tightening", 1)}`, change: change(store.DRTSCILM, 1), changeDisplay: `${formatSigned(change(store.DRTSCILM, 1), " pp", 1)} from the prior survey`, frequency: "Quarterly", meaning: "Net share of banks reporting tighter standards on commercial and industrial loans in the Fed's senior loan officer survey. Positive means credit is being rationed by quantity, which spreads alone cannot show." }),
    metric(store, { id: "bank-credit", label: "Bank credit growth", group: "Credit", series: "TOTBKCR", track: yoySeries(store.TOTBKCR, 52), value: bankCreditYoy, display: `${formatSigned(bankCreditYoy, "% YoY", 1)}`, change: percentChange(store.TOTBKCR, 13), changeDisplay: `${formatSigned(percentChange(store.TOTBKCR, 13), "%", 1)} over 13 weeks`, frequency: "Weekly", meaning: "Total credit on the books of US commercial banks. This is the quantity side of the transmission channel: whether tighter policy is actually reaching borrowers." }),
    metric(store, { id: "ci-loans", label: "Commercial & industrial loans", group: "Credit", series: "BUSLOANS", track: yoySeries(store.BUSLOANS, 12), value: ciLoansYoy, display: `${formatSigned(ciLoansYoy, "% YoY", 1)}`, change: percentChange(store.BUSLOANS, 3), changeDisplay: `${formatSigned(percentChange(store.BUSLOANS, 3), "%", 1)} over 3 months`, frequency: "Monthly", meaning: "Business borrowing outstanding. Contraction alongside tightening standards is the sequence that has preceded past investment slowdowns." }),
    metric(store, { id: "vix-curve", label: "VIX term structure", group: "Stress", series: "VIXCLS", track: ratioSeries(store.VIXCLS, store.VXVCLS), value: vixCurve, display: formatNumber(vixCurve, 3), change: vixCurve === null ? null : vixCurve - 1, changeDisplay: vixCurve === null ? "Unavailable" : vixCurve > 1 ? "Front volatility above 3-month" : "Front volatility below 3-month", frequency: "Daily", meaning: "VIX divided by the three-month volatility index; readings above one indicate an inverted volatility curve." }),
    metric(store, { id: "ovx", label: "Oil volatility (OVX)", group: "Stress", series: "OVXCLS", value: latest(store.OVXCLS)?.value ?? null, display: formatNumber(latest(store.OVXCLS)?.value ?? null, 1), change: change(store.OVXCLS, 5), changeDisplay: `${formatSigned(change(store.OVXCLS, 5), " points", 1)} over 5 observations`, frequency: "Daily", meaning: "Option-implied volatility for the US Oil Fund, useful for monitoring energy shock risk." }),
    metric(store, { id: "dollar", label: "Broad dollar index", group: "Transmission", series: "DTWEXBGS", value: latest(store.DTWEXBGS)?.value ?? null, display: formatNumber(latest(store.DTWEXBGS)?.value ?? null, 2), change: percentChange(store.DTWEXBGS, 5), changeDisplay: `${formatSigned(percentChange(store.DTWEXBGS, 5), "%", 1)} over 5 observations`, frequency: "Daily", meaning: "Trade-weighted value of the US dollar." }),
  ];

  const today = easternDate();
  const baseScores = scoreAt(store, today);
  const realYield = latest(store.DFII10)!.value;
  const policyScore = clamp(65 - realYield * 14 - (change(store.DFII10, 5) ?? 0) * 80);
  const liquidityScore = clamp(weightedAvailable([
    {
      value: liquidityChange === null ? null : clamp(50 + liquidityChange * 8),
      weight: 0.7,
    },
    {
      value: m2Yoy === null ? null : clamp(50 + m2Yoy * 2),
      weight: 0.3,
    },
  ]) ?? 50);
  const hySpread = latest(store.BAMLH0A0HYM2)!.value;
  const nfci = latest(store.NFCI)!.value;
  const vix = latest(store.VIXCLS)!.value;
  const stressScore = clamp(88 - hySpread * 10 - Math.max(nfci, -1) * 18 - Math.max(vix - 15, 0) * 1.3);
  const nqAssetNet = cotNet(nqCot[0], "asset");
  const nqLevNet = cotNet(nqCot[0], "leveraged");
  const positioningAvailable = nqAssetNet !== null && nqLevNet !== null;
  const positioningScore = clamp(50 + ((nqAssetNet ?? 0) + (nqLevNet ?? 0)) / 6000);
  // Labor breadth reads the parts of the labor market that move before
  // headline payrolls: hours worked, voluntary quits, temporary staffing, and
  // how many vacancies exist per job seeker.
  const quitsChange = change(store.JTSQUR, 6);
  const hoursChange = change(store.AWHAETP, 6);
  const openingsChange6m = change(openingsRatioSeries, 6);
  const laborScore = clamp(weightedAvailable([
    { value: tempHelpYoy === null ? null : clamp(50 + tempHelpYoy * 6), weight: 0.3 },
    { value: quitsChange === null ? null : clamp(50 + quitsChange * 100), weight: 0.25 },
    { value: hoursChange === null ? null : clamp(50 + hoursChange * 120), weight: 0.25 },
    { value: openingsChange6m === null ? null : clamp(50 + openingsChange6m * 90), weight: 0.2 },
  ]) ?? 50);
  const laborAvailable =
    tempHelpYoy !== null || quitsChange !== null || hoursChange !== null || openingsChange6m !== null;

  // Credit channel reads the quantity of credit rather than its price, which
  // is what the stress pillar already covers through spreads.
  const standardsValue = lendingStandards?.value ?? null;
  const creditScore = clamp(weightedAvailable([
    { value: standardsValue === null ? null : clamp(50 - standardsValue * 1.6), weight: 0.45 },
    { value: bankCreditYoy === null ? null : clamp(50 + (bankCreditYoy - 3) * 7), weight: 0.3 },
    { value: ciLoansYoy === null ? null : clamp(50 + (ciLoansYoy - 3) * 6), weight: 0.25 },
  ]) ?? 50);
  const creditAvailable = standardsValue !== null || bankCreditYoy !== null || ciLoansYoy !== null;

  const regime =
    baseScores.growth >= 50
      ? baseScores.inflation >= 50 ? "Disinflationary expansion" : "Reflation"
      : baseScores.inflation >= 50 ? "Disinflationary slowdown" : "Stagflation";
  const agreementInputs = [
    baseScores.growth,
    baseScores.inflation,
    policyScore,
    liquidityScore,
    stressScore,
    ...(laborAvailable ? [laborScore] : []),
    ...(creditAvailable ? [creditScore] : []),
    ...(positioningAvailable ? [positioningScore] : []),
  ];
  const agreementMean =
    agreementInputs.reduce((sum, value) => sum + value, 0) / agreementInputs.length;
  const agreementDispersion = Math.sqrt(
    agreementInputs.reduce((sum, value) => sum + (value - agreementMean) ** 2, 0) /
      agreementInputs.length,
  );
  const confidence = Math.round(clamp(100 - agreementDispersion * 2));
  // Index skew is a positioning read: the 25 delta risk reversal is the price
  // of downside protection relative to upside, and it moves on hedging demand
  // before that demand reaches the published data. One observation per
  // session at roughly one month to expiry, which is the conventional tenor
  // for a skew benchmark.
  const skewRows = loadSurfaceHistory("SPX", { dte: 30, dteTolerance: 7, limit: 400 });
  const skewBySession = new Map<string, number>();
  for (const row of skewRows) {
    if (row.riskReversal25 === null) continue;
    // Rows arrive newest first and sorted by proximity to the target tenor,
    // so the first entry seen for a session is the one to keep.
    if (!skewBySession.has(row.observationDate)) {
      skewBySession.set(row.observationDate, row.riskReversal25);
    }
  }
  const skewSessions = [...skewBySession.entries()].sort((left, right) =>
    right[0].localeCompare(left[0]),
  );
  const currentSkew = skewSessions[0] ?? null;
  const skewScore = currentSkew
    ? skewPercentile(currentSkew[1], skewSessions.slice(1).map(([, value]) => value))
    : null;
  const riskAppetite = clamp(weightedAvailable([
    { value: stressScore, weight: 0.4 },
    { value: policyScore, weight: 0.18 },
    { value: liquidityScore, weight: 0.18 },
    { value: baseScores.growth, weight: 0.14 },
    { value: creditAvailable ? creditScore : null, weight: 0.1 },
    // Excluded until enough sessions exist to rank against; the remaining
    // weights renormalize on their own until then.
    { value: skewScore, weight: 0.15 },
  ]) ?? 50);
  const creditImpulse = change(store.BAMLH0A0HYM2, 20);
  const vixImpulse = percentChange(store.VIXCLS, 20);
  const directionComponents = [
    { value: signedScale(nq20, 6), weight: 0.24 },
    { value: signedScale(nq60, 12), weight: 0.18 },
    { value: signedScale(spx20, 5), weight: 0.16 },
    { value: signedScale(spx60, 10), weight: 0.12 },
    { value: signedScale(nqAverageGap, 2.5), weight: 0.12 },
    { value: signedScale(spxAverageGap, 2.2), weight: 0.08 },
    { value: signedScale(creditImpulse === null ? null : -creditImpulse, 0.45), weight: 0.06 },
    { value: signedScale(vixImpulse === null ? null : -vixImpulse, 18), weight: 0.04 },
  ];
  const directionScore = directionComponents.reduce(
    (sum, component) => sum + component.value * component.weight,
    0,
  );
  const direction =
    directionScore >= 15 ? "Bullish" : directionScore <= -15 ? "Bearish" : "Neutral";
  const dominantDirection = directionScore >= 0 ? 1 : -1;
  const directionAgreement =
    directionComponents.filter((component) => Math.sign(component.value) === dominantDirection).length /
    directionComponents.length;
  const averageEfficiency = ((nqEfficiency ?? 0.25) + (spxEfficiency ?? 0.25)) / 2;
  const averagePersistence = ((nqPersistence ?? 0.5) + (spxPersistence ?? 0.5)) / 2;
  const averageSeparation = (Math.abs(nqAverageGap ?? 0) + Math.abs(spxAverageGap ?? 0)) / 2;
  const averageAutocorrelation = ((nqAutocorrelation ?? 0) + (spxAutocorrelation ?? 0)) / 2;
  const efficiencyScore = clamp(((averageEfficiency - 0.15) / 0.45) * 100);
  const persistenceScore = clamp(((averagePersistence - 0.5) / 0.2) * 100);
  const separationScore = clamp(averageSeparation * 20);
  const autocorrelationScore = clamp(50 + averageAutocorrelation * 200);
  const behaviorScore = clamp(
    efficiencyScore * 0.5 +
    persistenceScore * 0.2 +
    separationScore * 0.2 +
    autocorrelationScore * 0.1,
  );
  const behavior =
    behaviorScore >= 58 ? "Trending" : behaviorScore <= 42 ? "Mean-reverting" : "Transitional";
  const marketRegimeName =
    behavior === "Trending"
      ? direction === "Neutral" ? "Trend without a clear bias" : `${direction} trend`
      : behavior === "Mean-reverting"
        ? direction === "Neutral" ? "Range / mean-reverting" : `${direction} but mean-reverting`
        : `${direction} transition`;
  const marketConfidence = Math.round(clamp(
    38 +
    Math.abs(directionScore) * 0.25 +
    Math.abs(behaviorScore - 50) * 0.35 +
    directionAgreement * 18,
  ));
  const crossIndexConfirmed =
    nq20 !== null && spx20 !== null && Math.sign(nq20) === Math.sign(spx20);
  const marketTone: Tone =
    direction === "Bullish" ? "constructive" : direction === "Bearish" ? "stress" : "caution";
  const marketPlaybook =
    behavior === "Trending"
      ? direction === "Bullish"
        ? "Price has rewarded directional persistence. Pullbacks fit the prevailing path better than fading strength, but options levels still define where that read can fail."
        : direction === "Bearish"
          ? "Downside follow-through has been more efficient. Rallies deserve less benefit of the doubt until trend structure repairs."
          : "The path is efficient, but the major indexes do not provide a clean directional bias yet."
      : behavior === "Mean-reverting"
        ? "Follow-through has been inefficient. Extensions into major levels are more likely to rotate than continue until path efficiency improves."
        : "Direction and path quality are not aligned. Use smaller assumptions and wait for momentum, credit, and volatility to agree.";
  const marketFactors = [
    {
      label: "Index momentum",
      reading: direction,
      tone: marketTone,
      value: `NDX ${formatSigned(nq20, "%", 1)} · SPX ${formatSigned(spx20, "%", 1)} over 20 sessions`,
      note: crossIndexConfirmed ? "Both indexes point in the same direction." : "Nasdaq-100 and S&P 500 direction is not fully aligned.",
    },
    {
      label: "Path efficiency",
      reading: behaviorScore >= 58 ? "Persistent" : behaviorScore <= 42 ? "Choppy" : "Mixed",
      tone: behaviorScore >= 58 ? "constructive" as Tone : behaviorScore <= 42 ? "neutral" as Tone : "caution" as Tone,
      value: `NDX ${formatNumber(nqEfficiency === null ? null : nqEfficiency * 100, 0)} · SPX ${formatNumber(spxEfficiency === null ? null : spxEfficiency * 100, 0)}`,
      note: "Higher scores mean price covered more net distance with less backtracking.",
    },
    {
      label: "Trend structure",
      reading: (nqAverageGap ?? 0) >= 0 && (spxAverageGap ?? 0) >= 0 ? "Above" : (nqAverageGap ?? 0) < 0 && (spxAverageGap ?? 0) < 0 ? "Below" : "Split",
      tone: marketTone,
      value: `NDX ${formatSigned(nqAverageGap, "%", 1)} · SPX ${formatSigned(spxAverageGap, "%", 1)}`,
      note: "Separation between each index's 20- and 60-session moving averages.",
    },
    {
      label: "Volatility curve",
      reading: vixCurve === null ? "Unavailable" : vixCurve > 1 ? "Inverted" : "Normal",
      tone: vixCurve !== null && vixCurve > 1 ? "stress" as Tone : "constructive" as Tone,
      value: vixCurve === null ? "Unavailable" : `${vixCurve.toFixed(3)} VIX / 3-month VIX`,
      note: vixCurve !== null && vixCurve > 1 ? "Near-term implied stress exceeds the three-month horizon." : "Near-term volatility remains below the three-month horizon.",
    },
    {
      label: "Credit impulse",
      reading: (creditImpulse ?? 0) > 0.08 ? "Widening" : (creditImpulse ?? 0) < -0.08 ? "Tightening" : "Stable",
      tone: (creditImpulse ?? 0) > 0.08 ? "stress" as Tone : (creditImpulse ?? 0) < -0.08 ? "constructive" as Tone : "neutral" as Tone,
      value: `${formatSigned(creditImpulse, " pp")} over 20 observations`,
      note: "Wider high-yield spreads weaken confidence in equity risk appetite.",
    },
  ];

  const pillars = [
    { id: "growth", label: "Growth", score: Math.round(baseScores.growth), reading: label(baseScores.growth, "Improving", "Slowing"), tone: tone(baseScores.growth), note: "GDP, payrolls, claims, unemployment, and industrial production." },
    { id: "inflation", label: "Inflation", score: Math.round(baseScores.inflation), reading: label(baseScores.inflation, "Cooling", "Reaccelerating"), tone: tone(baseScores.inflation), note: "Three-month change in headline CPI, core CPI, and core PCE year-over-year rates." },
    { id: "policy", label: "Policy & rates", score: Math.round(policyScore), reading: label(policyScore, "Supportive", "Restrictive"), tone: tone(policyScore), note: "Level and recent direction of the 10-year real yield." },
    { id: "liquidity", label: "Liquidity", score: Math.round(liquidityScore), reading: label(liquidityScore, "Expanding", "Contracting"), tone: tone(liquidityScore), note: "13-week net-liquidity proxy impulse and M2 growth." },
    {
      id: "labor",
      label: "Labor breadth",
      score: Math.round(laborScore),
      reading: laborAvailable ? label(laborScore, "Firming", "Loosening") : "Unavailable",
      tone: laborAvailable ? tone(laborScore) : "neutral" as Tone,
      note: laborAvailable
        ? "Temporary-help payrolls, the quits rate, average weekly hours, and openings per unemployed person — the margins that move before headline payrolls."
        : "The leading labor series are unavailable and this pillar is excluded from pillar agreement.",
    },
    {
      id: "credit",
      label: "Credit channel",
      score: Math.round(creditScore),
      reading: creditAvailable ? label(creditScore, "Open", "Rationed") : "Unavailable",
      tone: creditAvailable ? tone(creditScore) : "neutral" as Tone,
      note: creditAvailable
        ? "Senior loan officer standards, bank credit growth, and commercial lending — the quantity of credit rather than its price."
        : "The bank-credit series are unavailable and this pillar is excluded from pillar agreement.",
    },
    { id: "stress", label: "Stress", score: Math.round(stressScore), reading: label(stressScore, "Calm", "Elevated"), tone: tone(stressScore), note: "High-yield spreads, financial conditions, and VIX." },
    {
      id: "positioning",
      label: "Positioning",
      score: Math.round(positioningScore),
      reading: positioningAvailable ? label(positioningScore, "Supportive", "Crowded short") : "Unavailable",
      tone: positioningAvailable ? tone(positioningScore) : "neutral" as Tone,
      note: positioningAvailable
        ? "NQ futures asset-manager and leveraged-fund net positions."
        : "The positioning report is unavailable and is excluded from pillar agreement.",
    },
  ];

  const drivers = [
    {
      label: "Credit",
      state: hySpread <= 3.5 ? "Calm" : hySpread >= 5 ? "Stressed" : "Mixed",
      tone: tone(stressScore),
      fact: `High-yield spreads are ${hySpread.toFixed(2)}% as of ${latest(store.BAMLH0A0HYM2)?.date ?? "unavailable"}.`,
      implication: hySpread <= 3.5 ? "Credit is not confirming broad market stress." : "Wider spreads reduce confidence in dip buying.",
    },
    {
      label: "Real yields",
      state: (change(store.DFII10, 5) ?? 0) > 0 ? "Rising" : "Falling",
      tone: tone(policyScore),
      fact: `The 10-year real yield is ${realYield.toFixed(2)}%, ${formatSigned(change(store.DFII10, 5), " pp")} over five observations.`,
      implication: (change(store.DFII10, 5) ?? 0) > 0 ? "Rising real yields can pressure long-duration technology." : "Falling real yields can ease the valuation headwind.",
    },
    {
      label: "Liquidity",
      state: (liquidityChange ?? 0) >= 0 ? "Expanding" : "Contracting",
      tone: tone(liquidityScore),
      fact: `The net-liquidity proxy changed ${formatSigned(liquidityChange, "%", 1)} over roughly 13 weeks.`,
      implication: (liquidityChange ?? 0) >= 0 ? "The broad liquidity impulse is supportive." : "A contracting impulse narrows the margin for risk.",
    },
    {
      label: "Long-rate composition",
      state:
        termPremiumChange === null
          ? "Unavailable"
          : Math.abs(termPremiumChange) < 0.05
            ? "Policy-led"
            : termPremiumChange > 0
              ? "Premium rising"
              : "Premium falling",
      tone:
        termPremiumChange === null
          ? "neutral" as Tone
          : termPremiumChange > 0.05
            ? "caution" as Tone
            : "constructive" as Tone,
      fact: decomposition
        ? `The 10-year yield of ${alignedTenYear?.toFixed(2)}% splits into ${decomposition.expectations.toFixed(2)}% expected policy and ${decomposition.termPremium.toFixed(2)}% term premium as of ${termPremiumLatest?.date}.`
        : "The term-premium decomposition is unavailable.",
      implication:
        termPremiumChange === null
          ? "Without the term-premium estimate the source of long-rate moves cannot be separated."
          : termPremiumChange > 0.05
            ? "The long end is moving on duration risk rather than the policy path, which usually pressures valuations more than a matching move in expectations."
            : "Long-rate moves are coming mainly from the expected policy path rather than duration risk.",
    },
    {
      label: "Recession risk",
      state:
        currentCurveRisk === null
          ? "Unavailable"
          : currentCurveRisk.probability >= 40
            ? "Elevated"
            : currentCurveRisk.probability >= 20
              ? "Moderate"
              : "Low",
      tone:
        currentCurveRisk === null
          ? "neutral" as Tone
          : currentCurveRisk.probability >= 40
            ? "stress" as Tone
            : currentCurveRisk.probability >= 20
              ? "caution" as Tone
              : "constructive" as Tone,
      fact: currentCurveRisk
        ? `The curve model puts twelve-month recession odds at ${currentCurveRisk.probability.toFixed(1)}% on a ${currentCurveRisk.spread.toFixed(2)} pp average spread, while the smoothed current-state estimate is ${smoothedRecession ? `${smoothedRecession.value.toFixed(2)}%` : "unavailable"}.`
        : "The yield-curve spread history is unavailable.",
      implication:
        "The curve reads twelve months ahead and the smoothed estimate reads the present, so a gap between them is normal and is itself the signal about timing.",
    },
    {
      label: "Volatility",
      state: vix < 18 ? "Calm" : vix > 25 ? "Elevated" : "Mixed",
      tone: tone(stressScore),
      fact: `VIX is ${vix.toFixed(1)} as of ${latest(store.VIXCLS)?.date ?? "unavailable"}.`,
      implication: vix < 18 ? "Option-implied stress is contained." : "Higher volatility makes structure less dependable.",
    },
  ];

  const nqSeries = store.NASDAQ100 ?? [];
  // The monthly panel runs back to 2000 so the transition counts have enough
  // observations of each regime to be worth reporting. The conditional return
  // distribution reads from the same rows.
  const monthEnds = (store.CPIAUCSL ?? []).filter((row) => row.date >= "2000-01-01" && row.date < today);
  const vintagePanel = loadVintagePanel();
  const history = monthEnds.slice(-320).map((row) => {
    // Scoring reads the data as it stood when that month's readings were
    // available, not as later revisions left them, whenever an as-published
    // copy has been collected for that date.
    const returnStartDate = conservativeMonthlyAvailabilityDate(row.date);
    const vintage = vintageStoreAt(vintagePanel, returnStartDate);
    const scores = vintage
      ? scoreAt(vintage.store as SeriesStore, row.date)
      : scoreAt(store, row.date);
    const historicalRegime =
      scores.growth >= 50
        ? scores.inflation >= 50 ? "Disinflationary expansion" : "Reflation"
        : scores.inflation >= 50 ? "Disinflationary slowdown" : "Stagflation";
    const startIndex = nqSeries.findIndex((point) => point.date >= returnStartDate);
    const start = startIndex >= 0 ? nqSeries[startIndex] : null;
    const end = startIndex >= 0 ? nqSeries[startIndex + 20] : null;
    const outcome = start && end ? (end.value / start.value - 1) * 100 : null;
    return {
      date: row.date,
      returnStart: start?.date ?? null,
      regime: historicalRegime,
      growth: Math.round(scores.growth),
      inflation: Math.round(scores.inflation),
      outcome,
      basis: vintage ? "point-in-time" : "revised",
      vintage: vintage?.vintage ?? null,
    };
  });
  const comparable = history.filter((row) => row.regime === regime && row.outcome !== null);
  const outcomes = comparable.map((row) => row.outcome as number);
  const quantiles = [0.1, 0.25, 0.5, 0.75, 0.9].map((probability) => percentile(outcomes, probability));

  // How the monthly classification has moved from one month to the next. This
  // is a frequency count over the reconstructed panel, not a fitted Markov
  // model, and the diagonal dominates because macro regimes are persistent.
  const regimeNames = ["Disinflationary expansion", "Reflation", "Disinflationary slowdown", "Stagflation"];
  const transitionCounts = new Map<string, Map<string, number>>(
    regimeNames.map((name) => [name, new Map(regimeNames.map((target) => [target, 0]))]),
  );
  for (let index = 1; index < history.length; index += 1) {
    const from = history[index - 1].regime;
    const to = history[index].regime;
    const row = transitionCounts.get(from);
    if (row) row.set(to, (row.get(to) ?? 0) + 1);
  }
  const transitions = regimeNames.map((from) => {
    const counts = transitionCounts.get(from)!;
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    return {
      from,
      observations: total,
      to: regimeNames.map((target) => ({
        regime: target,
        count: counts.get(target) ?? 0,
        probability: total ? ((counts.get(target) ?? 0) / total) * 100 : null,
      })),
    };
  });
  // Run length measures how long the current classification has already held,
  // which matters because the diagonal probability alone says nothing about
  // where in a run the present month sits.
  let currentRun = 0;
  for (let index = history.length - 1; index >= 0 && history[index].regime === regime; index -= 1) {
    currentRun += 1;
  }
  const runLengths: number[] = [];
  let activeRun = 0;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].regime === regime) {
      activeRun += 1;
      const isLast = index === history.length - 1;
      if (isLast || history[index + 1].regime !== regime) {
        // The run in progress is right-censored and would understate the
        // typical length, so it is excluded from the completed sample.
        if (!isLast) runLengths.push(activeRun);
        activeRun = 0;
      }
    } else {
      activeRun = 0;
    }
  }
  // Long enough to resample one-day changes from and to fit the recalibration
  // on forecasts that had already resolved. The chart shows the recent tail of
  // it; the rest exists so the outlook's confidence is measured rather than
  // asserted.
  const replaySessions = 90 + REGIME_OUTLOOK_SESSIONS;
  const dailyHistory = (store.NASDAQ100 ?? [])
    .slice(-replaySessions)
    .map((row) => marketStateAt(store, row.date))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const outlook = nextSessionOutlook(dailyHistory);
  const latestHistoricalState = dailyHistory.at(-1);
  if (
    latestHistoricalState &&
    (Math.abs(latestHistoricalState.directionScore - Math.round(directionScore)) > 1 ||
      Math.abs(latestHistoricalState.behaviorScore - Math.round(behaviorScore)) > 1)
  ) {
    throw new Error("Daily regime history diverged from the current market-state calculation.");
  }

  // How large a move the next session would need to shift the direction label.
  // Scored by appending a hypothetical session to both indices and running the
  // same replay, so it cannot drift from the model it describes. Both indices
  // move together: they are highly correlated but not identical, so this is the
  // size of a shared move rather than a forecast of either.
  const outlookDate = dailyHistory.at(-1)?.date ?? null;
  const nextSessionDate = outlookDate ? nextWeekday(outlookDate) : null;
  const scoreAfterReturn = (percent: number) => {
    if (!nextSessionDate) return directionScore;
    const extend = (series: Observation[] | undefined): Observation[] => {
      const last = series?.at(-1);
      if (!series || !last) return series ?? [];
      return [...series, { date: nextSessionDate, value: last.value * (1 + percent / 100) }];
    };
    const projected = marketStateAt(
      { ...store, NASDAQ100: extend(store.NASDAQ100), SP500: extend(store.SP500) },
      nextSessionDate,
    );
    return projected?.directionScore ?? directionScore;
  };
  const pivot = nextSessionDate ? pivotReturn(scoreAfterReturn) : null;

  const releaseDatesFor = (pattern: RegExp) =>
    publishedReleaseDates
      .filter((release) => pattern.test(release.title))
      .map((release) => release.date)
      .filter((date, index, all) => all.indexOf(date) === index);
  // Decision day is the final day of the meeting, which is when the statement
  // is released; a one-day meeting is its own decision day.
  const fomcDecisionDates = (fomcMeetings ?? [])
    .filter((meeting) => !meeting.unscheduled && meeting.end < todayEastern)
    .map((meeting) => meeting.end);
  const eventStudy = [
    eventWindowStudy(
      store.NASDAQ100,
      releaseDatesFor(/^consumer price index$/i),
      "CPI release",
      "Published at 8:30am Eastern, so the whole reaction lands inside the release-day close-to-close return.",
    ),
    eventWindowStudy(
      store.NASDAQ100,
      releaseDatesFor(/^employment situation$/i),
      "Employment Situation",
      "The monthly payrolls report, also published before the open.",
    ),
    eventWindowStudy(
      store.NASDAQ100,
      fomcDecisionDates,
      "FOMC decision day",
      "The final day of each scheduled meeting, when the statement and any projections are released in the afternoon.",
    ),
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const cotTrack = (rows: CotRow[], type: "asset" | "leveraged"): Observation[] =>
    rows
      .flatMap((row) => {
        const net = cotNet(row, type);
        const date = row.report_date_as_yyyy_mm_dd?.slice(0, 10);
        return net === null || !date ? [] : [{ date, value: net }];
      })
      .sort((left, right) => left.date.localeCompare(right.date));

  const cotMetrics: MacroMetric[] = [
    {
      context: metricContext(cotTrack(nqCot, "asset"), nqAssetNet),
      id: "nq-cot", label: "NQ asset-manager net", group: "Positioning",
      value: nqAssetNet, display: formatSigned(nqAssetNet, "", 0),
      change: nqAssetNet !== null && cotNet(nqCot[1], "asset") !== null ? nqAssetNet - Number(cotNet(nqCot[1], "asset")) : null,
      changeDisplay: `${formatSigned(nqAssetNet !== null && cotNet(nqCot[1], "asset") !== null ? nqAssetNet - Number(cotNet(nqCot[1], "asset")) : null, "", 0)} WoW`,
      date: nqCot[0]?.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? null, frequency: "Weekly", source: "Positioning report", series: "NASDAQ MINI", meaning: "Asset-manager longs minus shorts in Nasdaq-100 futures.",
    },
    {
      context: metricContext(cotTrack(esCot, "asset"), cotNet(esCot[0], "asset")),
      id: "es-cot", label: "ES asset-manager net", group: "Positioning",
      value: cotNet(esCot[0], "asset"), display: formatSigned(cotNet(esCot[0], "asset"), "", 0),
      change: cotNet(esCot[0], "asset") !== null && cotNet(esCot[1], "asset") !== null ? Number(cotNet(esCot[0], "asset")) - Number(cotNet(esCot[1], "asset")) : null,
      changeDisplay: `${formatSigned(cotNet(esCot[0], "asset") !== null && cotNet(esCot[1], "asset") !== null ? Number(cotNet(esCot[0], "asset")) - Number(cotNet(esCot[1], "asset")) : null, "", 0)} WoW`,
      date: esCot[0]?.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? null, frequency: "Weekly", source: "Positioning report", series: "E-MINI S&P 500", meaning: "Asset-manager longs minus shorts in E-mini S&P 500 futures.",
    },
  ];

  const calculatedNumbers = [
    baseScores.growth,
    baseScores.inflation,
    policyScore,
    liquidityScore,
    stressScore,
    positioningScore,
    riskAppetite,
    directionScore,
    behaviorScore,
    marketConfidence,
    confidence,
  ];
  if (calculatedNumbers.some((value) => !Number.isFinite(value))) {
    throw new Error("A macro model output was non-finite.");
  }
  const malformedMetric = [...metrics, ...cotMetrics].find(
    (row) =>
      (row.value !== null && !Number.isFinite(row.value)) ||
      (row.change !== null && !Number.isFinite(row.change)) ||
      /(?:NaN|Infinity|undefined|null)/.test(`${row.display} ${row.changeDisplay}`),
  );
  if (malformedMetric) {
    throw new Error(`Calculated metric ${malformedMetric.id} failed output validation.`);
  }

  return {
    source: "Published economic and positioning data",
    fetchedAt: new Date().toISOString(),
    methodologyVersion: METHODOLOGY_VERSION,
    marketRegime: {
      name: marketRegimeName,
      direction,
      behavior,
      directionScore: Math.round(directionScore),
      behaviorScore: Math.round(behaviorScore),
      confidence: marketConfidence,
      asOf: latest(store.NASDAQ100)?.date ?? null,
      // Sessions behind the last completed one. FRED publishes an equity close
      // on the next business day, so on a weekday evening this is 1 and the
      // data is as current as the source goes. Without it the date reads as a
      // failed fetch, and the regime reads as ignoring the session just traded.
      asOfSessionsBehind: sessionsBehind(latest(store.NASDAQ100)?.date ?? null),
      // Whether the newest session came from the exchange snapshot rather than
      // from FRED. Same session, ahead of the publication calendar, but it is a
      // different source and must not be presented as a published observation.
      provisionalSession: nowcast
        ? {
            date: nowcast.date,
            source: "Exchange close captured with the option chain, ahead of the FRED release",
          }
        : null,
      // The window the classification is measured over, and the single session
      // that just traded. A label built from twenty and sixty sessions answers a
      // different question from the one a reader asks after a large day, and
      // showing the two together is what stops the slow number reading as wrong.
      horizonSessions: 20,
      lastSessionReturn: percentChange(store.NASDAQ100, 1),
      windowReturn: percentChange(store.NASDAQ100, 20),
      // What the same classification says about the next session. Mostly it
      // says the label carries: both scores run on 20- and 60-session windows,
      // so one more observation moves them very little. The confidence is the
      // measured frequency of that holding, not an assertion.
      outlook: outlook
        ? {
            date: nextSessionDate,
            name: outlook.name,
            direction: outlook.direction,
            behavior: outlook.behavior,
            confidence: Math.round(outlook.probability * 100),
            rawConfidence: Math.round(outlook.rawProbability * 100),
            calibrated: outlook.calibrated,
            samples: outlook.samples,
            calibrationSamples: outlook.calibrationSamples,
            // The move that would change the direction label, which is a more
            // useful statement than a probability: it is exact.
            pivotPercent: pivot ? Math.round(pivot.percent * 100) / 100 : null,
            pivotTo: pivot?.to ?? null,
            basis: outlook.basis,
            caveat:
              "Persistence, not prediction. The scores are built from 20- and 60-session " +
              "windows, so tomorrow shares nineteen of twenty observations with today and the " +
              "label repeats about 73% of the time on its own. This states how strongly that " +
              "carries, and what size of move would break it. It is not a directional forecast, " +
              "and the daily direction model has no measured edge over its base rate.",
          }
        : null,
      summary:
        `${direction} direction with ${behavior.toLowerCase()} price behavior. ` +
        `${crossIndexConfirmed ? "Nasdaq-100 and S&P 500 agree on direction." : "Nasdaq-100 and S&P 500 are not fully aligned."}`,
      playbook: marketPlaybook,
      method: "Direction blends 20- and 60-session momentum, moving-average structure, credit, and volatility. Behavior blends path efficiency, directional persistence, moving-average separation, and return autocorrelation.",
      caveat: "This is an end-of-day classification from public observations, not a live trade signal. Mean-reverting means recent price paths have been inefficient; it does not guarantee the next move will reverse.",
      factors: marketFactors,
    },
    regime: {
      name: regime,
      confidence,
      growth: Math.round(baseScores.growth),
      inflation: Math.round(baseScores.inflation),
      posture: riskAppetite >= 60 ? "Selective risk-on" : riskAppetite <= 40 ? "Defensive" : "Balanced",
      riskAppetite: Math.round(riskAppetite),
      summary:
        `${baseScores.growth >= 50 ? "Growth is improving" : "Growth is slowing"} while inflation is ${baseScores.inflation >= 50 ? "cooling" : "reaccelerating"}.`,
      riskAppetiteMethod:
        "Risk Appetite weights stress 40%, policy 18%, liquidity 18%, growth 14%, credit channel 10%, and option skew 15% once enough sessions exist to rank it; weights renormalize over whatever is available.",
      caveat: "Current readings use the latest published revisions. Release vintages are preserved locally from this version forward; earlier history remains a reconstruction, not a point-in-time backtest.",
      method: "Eight visible pillars; each score is a bounded transformation of the listed observations. Pillar agreement is 100 minus twice the cross-pillar standard deviation, and any pillar whose inputs are unavailable is excluded from it. It is not a forecast probability.",
    },
    pillars,
    drivers,
    recessionRisk: {
      curve: {
        probability: currentCurveRisk?.probability ?? null,
        spread: currentCurveRisk?.spread ?? null,
        asOf: currentCurveRisk?.date ?? null,
        change3m: curveRiskChange3m,
        change12m:
          currentCurveRisk && curveRisk12mAgo
            ? currentCurveRisk.probability - curveRisk12mAgo.probability
            : null,
      },
      current: {
        probability: smoothedRecession?.value ?? null,
        asOf: smoothedRecession?.date ?? null,
        change3m: smoothedRecessionChange,
      },
      nowcast: {
        value: gdpNow?.value ?? null,
        asOf: gdpNow?.date ?? null,
        change: gdpNowChange,
        quarter: gdpNowQuarter,
        inProgress: gdpNowInProgress,
      },
      termStructure: {
        nominal: alignedTenYear,
        expectations: decomposition?.expectations ?? null,
        termPremium: decomposition?.termPremium ?? null,
        termPremiumChange,
        expectationsChange,
        asOf: termPremiumLatest?.date ?? null,
      },
      history: curveProbabilities.map((row) => ({
        date: row.date,
        spread: row.spread,
        curve: row.probability,
        current: smoothedByMonth.get(row.date.slice(0, 7)) ?? null,
      })),
      method:
        "Forward odds use the published probit on the monthly average 10y–3m spread. The current-state estimate is the Chauvet-Piger smoothed probability. The nowcast is the Atlanta Fed's GDPNow for the quarter in progress. None of the three feeds the pillar scores, so they add information rather than re-weighting it.",
      caveat:
        "The curve probability is recomputed here rather than read from the New York Fed's release, and the newest month averages only the sessions elapsed so far. GDPNow is revised with every input release and is not a forecast of data still unpublished.",
    },
    metrics: [...metrics, ...cotMetrics],
    history: {
      sampleSize: comparable.length,
      coverageStart: comparable[0]?.date ?? null,
      coverageEnd: comparable.at(-1)?.date ?? null,
      quantiles,
      rows: history.slice(-12).reverse(),
      daily: dailyHistory,
      panelStart: history[0]?.date ?? null,
      panelMonths: history.length,
      eventWindows: {
        rows: eventStudy,
        index: "Nasdaq-100",
        method:
          "Close-to-close index returns on each past release date, taken from the publishers' own historical schedules. The baseline is the median absolute move across every session in the same sample, so an event move is only notable when it exceeds it.",
        caveat:
          "This is what happened around past releases, not a prediction of the next one. Release-day moves also reflect everything else priced that session.",
      },
      transitions: {
        current: regime,
        rows: transitions,
        currentRun,
        medianRunMonths: percentile(runLengths, 0.5),
        completedRuns: runLengths.length,
        method:
          "Counts of how often each monthly classification was followed by each other classification across the reconstructed panel. Persistence is expected: these are slow-moving series, and the diagonal is not evidence the model is working.",
      },
      caveat: "Historical regimes before local vintage collection use today's revised series. Return windows begin no earlier than the end of the following month to reduce release look-ahead, but this remains a reconstruction—not a point-in-time backtest.",
    },
    availability: {
      dataQuality: {
        status: qualityIssues.length ? "warning" : "validated",
        issues: qualityIssues,
        methodologyVersion: METHODOLOGY_VERSION,
      },
      series: {
        status: unavailableSeries.length ? "partial" : "connected",
        unavailableSeries,
      },
      vintages: (() => {
        const target = vintageGrid().length * VINTAGE_SERIES.length;
        const collected = Object.values(vintagePanel.seriesCoverage).reduce(
          (sum, value) => sum + value,
          0,
        );
        const pointInTimeRows = history.filter((row) => row.basis === "point-in-time").length;
        return {
          status: collected === 0 ? "collecting" : collected >= target ? "complete" : "partial",
          collected,
          target,
          earliestVintage: vintagePanel.vintages[0] ?? null,
          latestVintage: vintagePanel.vintages.at(-1) ?? null,
          pointInTimeMonths: pointInTimeRows,
          panelMonths: history.length,
          reason:
            "As-published copies are pulled from the public archive a few at a time on each refresh, so the point-in-time share of the panel grows without a large burst of requests. Months without a copy fall back to revised data and are labelled that way.",
        };
      })(),
      events: {
        status: upcomingMeetings.length || upcomingReleases.length ? "connected" : "unavailable",
        reason: upcomingMeetings.length || upcomingReleases.length
          ? "Upcoming FOMC, BLS, and BEA dates come from their official public calendars."
          : "The economic-release calendars are unavailable, so no schedule is fabricated.",
        scheduled: upcomingMeetings,
        releases: upcomingReleases,
        published: recentReleases ?? [],
      },
      // Replaces the former news-sentiment slot. No official, no-account
      // sentiment feed exists, so positioning is measured from the option
      // market directly rather than inferred from headlines.
      positioningSkew: {
        status: skewScore !== null ? "scored" : currentSkew ? "collecting" : "unavailable",
        reason:
          skewScore !== null
            ? "The 25 delta risk reversal is ranked against its own recorded sessions and contributes to Risk Appetite."
            : currentSkew
              ? `Recording the 25 delta risk reversal. ${skewSessions.length} of 20 sessions collected before it is ranked and scored.`
              : "No option surface has been recorded yet. Open the options workspace once to begin collecting.",
        observedAt: currentSkew?.[0] ?? null,
        riskReversal25: currentSkew?.[1] ?? null,
        percentile: skewScore,
        sessions: skewSessions.length,
      },
      fearGreed: { status: "modeled", reason: "The displayed Risk Appetite score is GEXLab's transparent composite, not CNN's proprietary Fear & Greed Index." },
    },
  };
}

export async function GET() {
  const stored = getSnapshot<Awaited<ReturnType<typeof buildPayload>>>(
    "macro-output",
    OUTPUT_CACHE_KEY,
  );
  try {
    if (stored && snapshotIsFresh(stored)) return NextResponse.json(stored.payload);
    const payload = await buildPayload();
    // A few archive requests per refresh, started after the response is
    // assembled so the page never waits on the historical backfill. Failures
    // are recorded by the backfill itself and simply retried later.
    void backfillVintages(6).catch(() => undefined);
    putSnapshot({
      namespace: "macro-output",
      key: OUTPUT_CACHE_KEY,
      payload,
      sourceTime: payload.marketRegime.asOf,
      fetchedAt: payload.fetchedAt,
      refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
      methodologyVersion: METHODOLOGY_VERSION,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (stored) {
      return NextResponse.json({
        ...stored.payload,
        stale: true,
        staleReason: error instanceof Error ? error.message : "Refresh failed.",
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load macro data." },
      { status: 502 },
    );
  }
}
