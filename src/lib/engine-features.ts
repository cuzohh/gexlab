export type Observation = { date: string; value: number };
export type SeriesStore = Record<string, Observation[]>;

export type FeatureRow = {
  date: string;
  features: number[];
  /** Close-to-close return of the session being predicted, in percent. */
  forwardReturn: number | null;
  /** Cumulative close-to-close return over next 5 sessions (1 week), in percent. */
  forward5dReturn: number | null;
  /** Cumulative close-to-close return over next 20 sessions (1 month), in percent. */
  forward20dReturn: number | null;
  /** Worst close-to-close excursion over the following five sessions, in percent. */
  forward5dDrawdown: number | null;
  /** Return of the session the features end on, in percent. */
  currentReturn: number;
  /** Realized volatility over the following session, annualized percent. */
  forwardAbsolute: number | null;
  logVolatility: number;
};

export const FEATURE_NAMES = [
  "return 1d",
  "return 5d",
  "return 20d",
  "realized vol 5d",
  "realized vol 20d",
  "vol ratio 5d/20d",
  "distance to 20d average",
  "distance to 60d average",
  "drawdown from 60d high",
  "path efficiency 20d",
  "return autocorrelation 20d",
  "implied volatility level",
  "implied volatility change 5d",
  "implied volatility curve",
  "10y yield change 5d",
  "curve slope change 5d",
  "dollar change 5d",
  "oil change 5d",
  "day of week",
  "turn of month",
  "expiry week",
  "event tomorrow",
  "days to FOMC",
  "vix term structure spread",
  "vxn spvix ratio",
  "regime stress x dip",
  "backwardation x drawdown",
  "calm regime x return 1d",
  "fomc proximity x vol 5d",
  "2y yield change 5 observations",
  "10y real yield change 5 observations",
  "5y inflation breakeven change 5 observations",
  "5y5y forward inflation change 5 observations",
  "10y term premium change 20 observations",
  "oil volatility change 5 observations",
] as const;

/** Named positions prevent target code from silently drifting when features change. */
export const FEATURE_INDEX = Object.fromEntries(
  FEATURE_NAMES.map((name, index) => [name, index]),
) as Record<(typeof FEATURE_NAMES)[number], number>;

function toReturns(series: Observation[]) {
  return series.slice(1).map((row, index) => ({
    date: row.date,
    value: Math.log(row.value / series[index].value) * 100,
  }));
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function valueAtOrBefore(series: Observation[] | undefined, date: string) {
  if (!series?.length) return null;
  let low = 0;
  let high = series.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].date <= date) {
      found = series[middle].value;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function changeOver(series: Observation[] | undefined, date: string, sessions: number) {
  if (!series?.length) return null;
  let index = -1;
  for (let position = series.length - 1; position >= 0; position -= 1) {
    if (series[position].date <= date) {
      index = position;
      break;
    }
  }
  if (index < sessions) return null;
  const current = series[index].value;
  const prior = series[index - sessions].value;
  return Number.isFinite(current) && Number.isFinite(prior) ? current - prior : null;
}

function percentChangeOver(series: Observation[] | undefined, date: string, sessions: number) {
  if (!series?.length) return null;
  let index = -1;
  for (let position = series.length - 1; position >= 0; position -= 1) {
    if (series[position].date <= date) {
      index = position;
      break;
    }
  }
  if (index < sessions) return null;
  const current = series[index].value;
  const prior = series[index - sessions].value;
  return prior ? (current / prior - 1) * 100 : null;
}

function pathEfficiency(prices: number[]) {
  const displacement = Math.abs(prices.at(-1)! - prices[0]);
  const distance = prices
    .slice(1)
    .reduce((sum, price, index) => sum + Math.abs(price - prices[index]), 0);
  return distance === 0 ? 0 : displacement / distance;
}

function autocorrelation(returns: number[]) {
  if (returns.length < 4) return 0;
  const left = returns.slice(0, -1);
  const right = returns.slice(1);
  const meanLeft = average(left);
  const meanRight = average(right);
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    covariance += (left[index] - meanLeft) * (right[index] - meanRight);
    varianceLeft += (left[index] - meanLeft) ** 2;
    varianceRight += (right[index] - meanRight) ** 2;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? 0 : covariance / denominator;
}

/**
 * The third Friday of a month is the monthly option expiry. The week that
 * contains it carries a distinct hedging pattern, so it is flagged rather than
 * left for the model to discover from a date it cannot see.
 */
function isExpiryWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offsetToFriday = (5 - first.getUTCDay() + 7) % 7;
  const thirdFriday = 1 + offsetToFriday + 14;
  return Math.abs(day - thirdFriday) <= 3 ? 1 : 0;
}

function isTurnOfMonth(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= daysInMonth - 2 || day <= 3 ? 1 : 0;
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export type CalendarInput = {
  /** Dates of major scheduled economic releases. */
  releaseDates: Set<string>;
  /** Dates on which an FOMC decision was or will be published. */
  fomcDates: string[];
};

/**
 * Builds one feature row per session.
 *
 * Every feature is computed only from observations dated at or before the row
 * date, and the label is the session that follows. Calendar features are the
 * one exception by design: whether tomorrow is a scheduled release is known
 * today, which is exactly why it is useful.
 */
export function buildFeatureRows(
  store: SeriesStore,
  calendar: CalendarInput,
  options: { minDate?: string } = {},
): FeatureRow[] {
  const prices = (store.NASDAQ100 ?? []).filter(
    (row) => !options.minDate || row.date >= options.minDate,
  );
  if (prices.length < 80) return [];
  const returns = toReturns(prices);
  const rows: FeatureRow[] = [];
  const sortedFomc = [...calendar.fomcDates].sort();

  for (let index = 61; index < prices.length; index += 1) {
    const date = prices[index].date;
    // Returns are offset by one because the first price has no return.
    const returnIndex = index - 1;
    const window = (length: number) => returns.slice(returnIndex - length + 1, returnIndex + 1);
    const last5 = window(5).map((row) => row.value);
    const last20 = window(20).map((row) => row.value);
    const priceWindow20 = prices.slice(index - 20, index + 1).map((row) => row.value);
    const priceWindow60 = prices.slice(index - 60, index + 1).map((row) => row.value);
    const volatility5 = standardDeviation(last5) * Math.sqrt(252);
    const volatility20 = standardDeviation(last20) * Math.sqrt(252);
    if (!Number.isFinite(volatility20) || volatility20 <= 0) continue;

    const average20 = average(priceWindow20);
    const average60 = average(priceWindow60);
    const high60 = Math.max(...priceWindow60);
    const current = prices[index].value;
    const impliedLevel = valueAtOrBefore(store.VIXCLS, date);
    const impliedThreeMonth = valueAtOrBefore(store.VXVCLS, date);
    const impliedVxn = valueAtOrBefore(store.VXNCLS, date);
    const vixChange = changeOver(store.VIXCLS, date, 5);
    const tenYearChange = changeOver(store.DGS10, date, 5);
    const curveChange = changeOver(store.T10Y2Y, date, 5);
    const dollarChange = percentChangeOver(store.DTWEXBGS, date, 5);
    const oilChange = percentChangeOver(store.DCOILWTICO, date, 5);
    const twoYearChange = changeOver(store.DGS2, date, 5);
    const realYieldChange = changeOver(store.DFII10, date, 5);
    const breakevenChange = changeOver(store.T5YIE, date, 5);
    const forwardInflationChange = changeOver(store.T5YIFR, date, 5);
    const termPremiumChange = changeOver(store.THREEFYTP10, date, 20);
    const oilVolatilityChange = changeOver(store.OVXCLS, date, 5);

    const nextDate = addDays(date, 1);
    const nextSession = prices[index + 1] ?? null;
    const session5Ahead = prices[index + 5] ?? null;
    const session20Ahead = prices[index + 20] ?? null;
    // A release on the calendar day after this session, or on the session that
    // actually follows it, both count as "tomorrow" for a Friday close.
    const eventTomorrow =
      calendar.releaseDates.has(nextDate) ||
      (nextSession ? calendar.releaseDates.has(nextSession.date) : false)
        ? 1
        : 0;
    const nextFomc = sortedFomc.find((meeting) => meeting >= date);
    const daysToFomc = nextFomc
      ? Math.min(
          30,
          Math.round(
            (Date.parse(`${nextFomc}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000,
          ),
        )
      : 30;

    const return5d = last5.reduce((sum, value) => sum + value, 0);
    const return20d = last20.reduce((sum, value) => sum + value, 0);
    const drawdown60d = (current / high60 - 1) * 100;
    const currentReturnVal = returns[returnIndex].value;

    // Missing data is not a neutral market observation. Rows without a complete
    // feature set are withheld, which is stricter than silently turning a gap
    // into a zero-change signal.
    if (
      [
        impliedLevel,
        impliedThreeMonth,
        impliedVxn,
        vixChange,
        tenYearChange,
        curveChange,
        dollarChange,
        oilChange,
        twoYearChange,
        realYieldChange,
        breakevenChange,
        forwardInflationChange,
        termPremiumChange,
        oilVolatilityChange,
      ].some((value) => value === null || !Number.isFinite(value))
    ) {
      continue;
    }

    const features = [
      currentReturnVal,
      return5d,
      return20d,
      volatility5,
      volatility20,
      volatility20 === 0 ? 1 : volatility5 / volatility20,
      (current / average20 - 1) * 100,
      (current / average60 - 1) * 100,
      drawdown60d,
      pathEfficiency(priceWindow20),
      autocorrelation(last20),
      impliedLevel!,
      vixChange!,
      impliedLevel! / impliedThreeMonth!,
      tenYearChange!,
      curveChange!,
      dollarChange!,
      oilChange!,
      dayOfWeek(date),
      isTurnOfMonth(date),
      isExpiryWeek(date),
      eventTomorrow,
      daysToFomc,
      impliedLevel! - impliedThreeMonth!,
      impliedVxn! / impliedLevel!,
      (volatility20 > 25 ? 1 : 0) * return5d,
      (impliedThreeMonth! > 0 && impliedLevel! > impliedThreeMonth! ? 1 : 0) * drawdown60d,
      (volatility20 < 18 ? 1 : 0) * currentReturnVal,
      (daysToFomc <= 2 ? 1 : 0) * volatility5,
      twoYearChange!,
      realYieldChange!,
      breakevenChange!,
      forwardInflationChange!,
      termPremiumChange!,
      oilVolatilityChange!,
    ];
    if (!features.every((value) => Number.isFinite(value))) continue;

    const forwardReturn = nextSession
      ? Math.log(nextSession.value / current) * 100
      : null;
    const forward5dReturn = session5Ahead
      ? Math.log(session5Ahead.value / current) * 100
      : null;
    const forward20dReturn = session20Ahead
      ? Math.log(session20Ahead.value / current) * 100
      : null;
    const forward5dPrices = prices.slice(index + 1, index + 6);
    const forward5dDrawdown =
      forward5dPrices.length === 5
        ? Math.min(...forward5dPrices.map((row) => Math.log(row.value / current) * 100))
        : null;

    rows.push({
      date,
      features,
      forwardReturn,
      forward5dReturn,
      forward20dReturn,
      forward5dDrawdown,
      currentReturn: returns[returnIndex].value,
      forwardAbsolute: forwardReturn === null ? null : Math.abs(forwardReturn),
      // Absolute daily return is a noisy but unbiased proxy for that session's
      // realized volatility; the floor keeps the log finite on flat sessions.
      logVolatility: Math.log(Math.max(Math.abs(returns[returnIndex].value), 0.01)),
    });
  }
  return rows;
}
