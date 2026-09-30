import "server-only";

import { loadStockFundamentals, peekStockFundamentals, type StockFundamentals } from "@/lib/server/sec-companyfacts";
import { loadYahooDailyOhlc, peekYahooDailyOhlc } from "@/lib/server/yahoo-daily";
import { easternDate, isRegularMarketOpen } from "@/lib/market-time";
import { baseRates } from "@/lib/base-rates";
import { NASDAQ_100 } from "@/lib/indices";
import { loadEstimateTrend } from "@/lib/server/estimate-revisions";
import { relativeStrengthIndex } from "@/lib/technicals";

/**
 * The equity research payload, shared by the API route and the server render.
 *
 * This was inside the route handler, which meant a server component had no way
 * to produce it without issuing an HTTP request to itself. The detail page now
 * renders from the saved snapshot when one is fresh, so the browser paints real
 * figures instead of fetching them after hydration.
 */

type Bar = { date: string; open: number; high: number; low: number; close: number };

const SECTOR_BENCHMARK: Record<string, string> = {
  NVDA: "SOXX", AMD: "SOXX", AVGO: "SOXX", MSFT: "XLK", AAPL: "XLK", META: "XLC", GOOGL: "XLC", AMZN: "XLY", TSLA: "XLY", JPM: "XLF", XOM: "XLE", LLY: "XLV",
};


export function benchmarkFor(symbol: string) {
  // A mixed watchlist should not silently treat one index as its neutral
  // yardstick for everything. The order is most specific first: a name with a
  // sector ETF is measured against its sector, a Nasdaq-100 member against the
  // index it actually moves with, and only what is neither falls back to the
  // broad market. Defaulting every unmapped ticker to SPY compared a growth
  // name against five hundred companies it has nothing to do with.
  return SECTOR_BENCHMARK[symbol] ?? (NASDAQ_100.has(symbol) ? "QQQ" : "SPY");
}

function returns(rows: { close: number }[], periods: number) {
  const latest = rows.at(-1)?.close;
  const prior = rows.at(-1 - periods)?.close;
  return latest && prior ? (latest / prior - 1) * 100 : null;
}

/**
 * Average true range, smoothed the way Wilder defined it.
 *
 * This was a plain mean of the last fourteen true ranges, which is a different
 * indicator and reads materially higher after a volatile fortnight — MSFT came
 * out at 17.50 against Wilder's 15.82. Every chart the reader is likely to
 * compare against plots the smoothed version, and the figure feeds the stop
 * distance in the position-sizing panel, so the two must agree.
 */
function atr(rows: Bar[], periods = 14) {
  if (rows.length < periods + 1) return null;
  const trueRanges: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    trueRanges.push(
      Math.max(
        rows[index].high - rows[index].low,
        Math.abs(rows[index].high - rows[index - 1].close),
        Math.abs(rows[index].low - rows[index - 1].close),
      ),
    );
  }
  let value = trueRanges.slice(0, periods).reduce((sum, range) => sum + range, 0) / periods;
  for (let index = periods; index < trueRanges.length; index += 1) {
    value = (value * (periods - 1) + trueRanges[index]) / periods;
  }
  return value;
}

/**
 * Beta of the stock against its benchmark, over daily returns.
 *
 * The two series are joined on trade date. They were previously paired by
 * position within the last sixty-one rows of each, which silently assumes both
 * symbols traded on exactly the same days: one halt, one late listing, or one
 * gap in either history shifts every subsequent pair by a day and compares
 * unrelated returns. That produced a 0.35 beta for NVDA against SOXX, well
 * under the value the same window gives once the dates are matched.
 *
 * Returns are computed within each series before the join, so a missing day
 * removes one observation rather than fabricating a two-day return.
 */
function beta(stock: Bar[], benchmark: Bar[], periods = 60) {
  const dailyReturns = (rows: Bar[]) => {
    const out = new Map<string, number>();
    for (let index = 1; index < rows.length; index += 1) {
      const prior = rows[index - 1].close;
      if (prior > 0) out.set(rows[index].date, rows[index].close / prior - 1);
    }
    return out;
  };

  const stockReturns = dailyReturns(stock);
  const benchmarkReturns = dailyReturns(benchmark);

  const paired: { stock: number; benchmark: number }[] = [];
  for (const [date, value] of stockReturns) {
    const other = benchmarkReturns.get(date);
    if (other !== undefined) paired.push({ stock: value, benchmark: other });
  }

  const window = paired.slice(-periods);
  // Below about two-thirds of the window the estimate is not worth reporting.
  if (window.length < Math.ceil(periods * 0.66)) return { beta: null, correlation: null, observations: window.length };

  const stockMean = window.reduce((sum, row) => sum + row.stock, 0) / window.length;
  const benchmarkMean = window.reduce((sum, row) => sum + row.benchmark, 0) / window.length;
  const covariance = window.reduce((sum, row) => sum + (row.stock - stockMean) * (row.benchmark - benchmarkMean), 0);
  const variance = window.reduce((sum, row) => sum + (row.benchmark - benchmarkMean) ** 2, 0);
  const stockVariance = window.reduce((sum, row) => sum + (row.stock - stockMean) ** 2, 0);
  if (variance <= 0) return { beta: null, correlation: null, observations: window.length };

  // Beta alone cannot be read. A value near zero means either that the stock
  // does not move with its benchmark or that the relationship is too weak to
  // measure, and those call for different responses — the second says the
  // number should not be used as a cost-of-equity input at all. Reporting the
  // correlation beside it makes the difference visible.
  const correlation = stockVariance > 0 ? covariance / Math.sqrt(variance * stockVariance) : null;
  return { beta: covariance / variance, correlation, observations: window.length };
}

/**
 * Beta suitable for a cost-of-equity input.
 *
 * The sixty-day sector beta reported beside it is a description of recent
 * co-movement and is far too unstable to discount five years of cash flow with:
 * across a handful of large caps it produced 3.95 for Corning, −0.71 for
 * Coca-Cola and −0.01 for Apple, which drove the valuation model to $19 against
 * a $166 price in one case and refused to run at all in two others because the
 * implied discount rate fell below the terminal growth rate.
 *
 * Three changes make it usable:
 *   - weekly returns over about two years rather than sixty daily ones, which
 *     is the conventional estimation window and far less sensitive to a single
 *     session;
 *   - measured against the broad market, since that is what a cost of equity
 *     is defined against, not against a sector ETF;
 *   - shrunk toward one (Blume) and clamped, because raw estimates are
 *     well known to regress toward the market over time.
 *
 * A weak relationship falls back to the market beta of one rather than
 * pretending the regression means something.
 */
function valuationBeta(stock: Bar[], market: Bar[]) {
  const weekly = (rows: Bar[]) => {
    const sampled: { date: string; close: number }[] = [];
    // Every fifth session, most recent last, is a weekly series.
    for (let index = rows.length - 1; index >= 0 && sampled.length < 105; index -= 5) {
      sampled.unshift({ date: rows[index].date, close: rows[index].close });
    }
    const out = new Map<string, number>();
    for (let index = 1; index < sampled.length; index += 1) {
      const prior = sampled[index - 1].close;
      if (prior > 0) out.set(sampled[index].date, sampled[index].close / prior - 1);
    }
    return out;
  };

  const stockReturns = weekly(stock);
  const marketReturns = weekly(market);
  const paired: { stock: number; market: number }[] = [];
  for (const [date, value] of stockReturns) {
    const other = marketReturns.get(date);
    if (other !== undefined) paired.push({ stock: value, market: other });
  }
  if (paired.length < 52) return { beta: null, correlation: null, observations: paired.length };

  const stockMean = paired.reduce((sum, row) => sum + row.stock, 0) / paired.length;
  const marketMean = paired.reduce((sum, row) => sum + row.market, 0) / paired.length;
  const covariance = paired.reduce((sum, row) => sum + (row.stock - stockMean) * (row.market - marketMean), 0);
  const marketVariance = paired.reduce((sum, row) => sum + (row.market - marketMean) ** 2, 0);
  const stockVariance = paired.reduce((sum, row) => sum + (row.stock - stockMean) ** 2, 0);
  if (marketVariance <= 0 || stockVariance <= 0) return { beta: null, correlation: null, observations: paired.length };

  const raw = covariance / marketVariance;
  const correlation = covariance / Math.sqrt(marketVariance * stockVariance);
  // Below this the regression explains too little to be worth carrying into a
  // discount rate, so the market beta is the honest default.
  if (Math.abs(correlation) < 0.2) return { beta: 1, correlation, observations: paired.length, adjusted: true };

  const blume = 0.67 * raw + 0.33;
  return {
    beta: Math.min(2.5, Math.max(0.4, blume)),
    correlation,
    observations: paired.length,
    adjusted: true,
  };
}

function gapRisk(rows: { open: number; close: number }[], periods = 60) {
  const window = rows.slice(-(periods + 1));
  if (window.length < 2) return { average: null, p90: null, gapsOverTwoPercent: null };
  const gaps = window.slice(1).map((row, index) => Math.abs(row.open / window[index].close - 1) * 100).sort((left, right) => left - right);
  return {
    average: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
    p90: gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))] ?? null,
    gapsOverTwoPercent: gaps.filter((gap) => gap >= 2).length,
  };
}

function average(rows: number[]) {
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

/**
 * Relative strength index, smoothed the way Wilder defined it.
 *
 * The previous version averaged the last fourteen changes with equal weight,
 * which is a distinct indicator sometimes called Cutler's RSI. It disagreed
 * with the standard by nearly seven points on AAPL — 40.8 against 47.6 — and
 * the panel labels the figure "RSI (14)" beside an oversold/overbought scale
 * that only means anything under the usual definition.
 */
/**
 * Annualized realized volatility of log returns.
 *
 * Uses the sample variance. Dividing by n rather than n − 1 understates a
 * twenty-observation estimate by around two percent, and realized volatility is
 * quoted against implied volatility elsewhere on the page, where the difference
 * is not noise.
 */
function annualizedVol(rows: { close: number }[], periods = 20) {
  const window = rows.slice(-(periods + 1));
  if (window.length < periods + 1) return null;
  const changes = window.slice(1).map((row, index) => Math.log(row.close / window[index].close));
  if (changes.length < 2) return null;
  const mean = average(changes) ?? 0;
  const variance = changes.reduce((sum, change) => sum + (change - mean) ** 2, 0) / (changes.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function technicals(rows: Bar[]) {
  const sma = (periods: number) => (rows.length >= periods ? average(rows.slice(-periods).map((row) => row.close)) : null);
  const year = rows.slice(-252);
  return {
    rsi14: relativeStrengthIndex(rows),
    sma20: sma(20),
    sma50: sma(50),
    sma200: sma(200),
    // The traded extremes of the year, not the highest and lowest closes. A
    // close-only range is narrower than the one every chart and screener
    // quotes, and it is what the 52-week position percentage is measured
    // against, so the two disagreed with the reader's other tools.
    high52w: year.length ? Math.max(...year.map((row) => row.high)) : null,
    low52w: year.length ? Math.min(...year.map((row) => row.low)) : null,
    volatility20: annualizedVol(rows),
  };
}

function assemble(
  symbol: string,
  benchmark: string,
  stock: { rows: Bar[]; stale: boolean },
  qqq: { rows: Bar[]; stale: boolean },
  sector: { rows: Bar[]; stale: boolean },
  market: { rows: Bar[]; stale: boolean },
  { summary = false }: { summary?: boolean } = {},
) {
  const sectorBeta = beta(stock.rows, sector.rows);
  const costOfEquityBeta = valuationBeta(stock.rows, market.rows);
  const window = (periods: number) => {
    const stockReturn = returns(stock.rows, periods);
    const qqqReturn = returns(qqq.rows, periods);
    const sectorReturn = returns(sector.rows, periods);
    return {
      periods,
      stockReturn,
      qqqReturn,
      sectorReturn,
      versusQqq: stockReturn === null || qqqReturn === null ? null : stockReturn - qqqReturn,
      versusSector: stockReturn === null || sectorReturn === null ? null : stockReturn - sectorReturn,
    };
  };
  return {
    symbol,
    price: stock.rows.at(-1)?.close ?? null,
    asOf: stock.rows.at(-1)?.date ?? null,
    // True while the last bar is the session in progress: the price beside it is
    // the last trade, not a close, and the interface must not call it one.
    intraday: isRegularMarketOpen() && stock.rows.at(-1)?.date === easternDate(),
    benchmark,
    stale: stock.stale || qqq.stale || sector.stale,
    dayReturn: returns(stock.rows, 1),
    benchmarkDayReturn: returns(sector.rows, 1),
    atr14: atr(stock.rows),
    beta60: sectorBeta.beta,
    beta60Correlation: sectorBeta.correlation,
    beta60Observations: sectorBeta.observations,
    // The figure the valuation model should discount with, against the broad
    // market over a long window. Deliberately separate from the sector beta
    // above, which describes recent co-movement and nothing more.
    valuationBeta: costOfEquityBeta.beta,
    valuationBetaCorrelation: costOfEquityBeta.correlation,
    valuationBetaWeeks: costOfEquityBeta.observations,
    gapRisk60: gapRisk(stock.rows),
    technicals: technicals(stock.rows),
    swingLow20: stock.rows.length ? Math.min(...stock.rows.slice(-20).map((row) => row.low)) : null,
    swingHigh20: stock.rows.length ? Math.max(...stock.rows.slice(-20).map((row) => row.high)) : null,
    relativeStrength: [window(5), window(20), window(60)],
    priceHistory: stock.rows.slice(-90).map((row) => ({ date: row.date, close: row.close })),
    // Computed from the whole ten-year series held here and sent as a summary:
    // the bars themselves never leave the server, and nothing is stored. The
    // watchlist does not draw them, so a thirty-name list does not scan thirty
    // ten-year histories to fill a table that has no column for the result.
    baseRates: summary ? null : baseRates(stock.rows.map((row) => ({ date: row.date, close: row.close }))),
    // Read from what this workstation has already recorded, never from the
    // network: the watchlist shows thirty tickers and must not scrape thirty
    // pages to colour a column.
    estimateDrift: (() => {
      const month = loadEstimateTrend(symbol).windows.find((window) => window.days === 30) ?? null;
      return month?.comparedTo ? { since: month.comparedTo, epsPercent: month.epsPercent, targetPercent: month.targetPercent } : null;
    })(),
    caveat:
      "Relative strength compares closing-price returns, not total return. SEC fundamentals use the latest available annual filing and are not valuation or analyst-estimate data.",
  };
}

export type StockPayload = ReturnType<typeof assemble> & { fundamentals?: StockFundamentals | null };

/** Fetches whatever is missing. Used by the API route. */
export async function buildStockPayload(
  symbol: string,
  { summary, force = false }: { summary: boolean; force?: boolean },
): Promise<StockPayload> {
  const benchmark = benchmarkFor(symbol);
  const [stock, qqq, sector, market] = await Promise.all([
    // Only the ticker being looked at is forced. The three benchmarks are
    // shared by every ticker and carry their own five-minute window, so forcing
    // them too would multiply one refresh into four upstream reads to move a
    // relative-strength figure by a rounding error.
    loadYahooDailyOhlc(symbol, { force }),
    loadYahooDailyOhlc("QQQ"),
    loadYahooDailyOhlc(benchmark),
    // The broad market, which is what a cost of equity is defined against.
    loadYahooDailyOhlc("SPY"),
  ]);
  const payload = assemble(symbol, benchmark, stock, qqq, sector, market, { summary });
  if (summary) return payload;
  let fundamentals: StockFundamentals | null = null;
  try {
    fundamentals = await loadStockFundamentals(symbol);
  } catch {
    // Price and relative-strength research stays usable when SEC XBRL is
    // unavailable; the valuation panels already render a missing state.
    fundamentals = null;
  }
  return { ...payload, fundamentals };
}

/**
 * The same payload, but only if every source is already saved and fresh.
 *
 * Returns null on any miss so that a cold render falls through to the client
 * rather than holding the response open while ten years of bars download.
 */
export function peekStockPayload(symbol: string): StockPayload | null {
  const benchmark = benchmarkFor(symbol);
  const stock = peekYahooDailyOhlc(symbol);
  const qqq = peekYahooDailyOhlc("QQQ");
  const sector = peekYahooDailyOhlc(benchmark);
  const market = peekYahooDailyOhlc("SPY");
  if (!stock?.length || !qqq?.length || !sector?.length || !market?.length) return null;
  const fundamentals = peekStockFundamentals(symbol);
  if (!fundamentals) return null;
  const payload = assemble(
    symbol,
    benchmark,
    { rows: stock, stale: false },
    { rows: qqq, stale: false },
    { rows: sector, stale: false },
    { rows: market, stale: false },
  );
  return { ...payload, fundamentals };
}
