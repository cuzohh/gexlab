/**
 * What happened last time this stock looked like this.
 *
 * "Oversold" is a description of the present, not evidence about the future. A
 * ticker sitting at an RSI of 26 and a quarter off its high may be a bargain or
 * may be early in a decline, and the reading itself does not distinguish them.
 * What can distinguish them, at least partly, is the stock's own record: across
 * ten years of its bars, how often did a comparable setup resolve upward, and
 * by how much?
 *
 * The output is a distribution, deliberately, not a forecast. A median forward
 * return of +3% with a worst case of −28% is a different proposition from the
 * same median with a worst case of −6%, and a single expected value hides that.
 *
 * Two limits are worth stating plainly, and the interface repeats them:
 *   - Analogues from one ticker's history overlap heavily. Sixty matches drawn
 *     from four separate declines are closer to four independent observations
 *     than to sixty, so the sample count flatters itself.
 *   - A decade covers one broad regime. Nothing here has seen a 2008.
 */

export type Bar = { date: string; close: number };

export type BaseRateSetup = {
  /** Relative strength at the observation, 0–100. */
  rsi: number | null;
  /** How far below the trailing 52-week high, as a positive percentage. */
  drawdown: number | null;
};

export type BaseRateOutcome = {
  horizonDays: number;
  samples: number;
  positiveShare: number;
  median: number;
  p10: number;
  p90: number;
  worst: number;
  best: number;
};

export type BaseRates = {
  setup: BaseRateSetup;
  /** The band of past days counted as comparable to today. */
  match: { rsiLow: number; rsiHigh: number; drawdownLow: number; drawdownHigh: number } | null;
  outcomes: BaseRateOutcome[];
  /** Total comparable days found, before the forward window trims the recent ones. */
  matches: number;
  /** Independent episodes those days belong to: runs separated by a month or more. */
  episodes: number;
};

const HORIZONS = [20, 60];
const RSI_PERIODS = 14;

/** Wilder's relative strength index at every bar, null until enough closes exist. */
export function rsiSeries(bars: Bar[], periods = RSI_PERIODS): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  if (bars.length <= periods) return out;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= periods; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= periods;
  loss /= periods;
  out[periods] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = periods + 1; index < bars.length; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    gain = (gain * (periods - 1) + Math.max(change, 0)) / periods;
    loss = (loss * (periods - 1) + Math.max(-change, 0)) / periods;
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/**
 * Percentage below the trailing 252-session high at every bar.
 *
 * The window maximum is carried forward in a monotonic queue rather than
 * rescanned at every bar. Rescanning made this quadratic in the window — a
 * quarter of a million comparisons for ten years of daily bars, which is most
 * of what computing the base rates cost.
 */
export function drawdownSeries(bars: Bar[], window = 252): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  // Indices of candidate maxima, closes descending. The front is the window's
  // highest close; anything smaller arriving later can never be the maximum
  // while an earlier larger value is still in range, so it is discarded.
  const candidates: number[] = [];
  for (let index = 0; index < bars.length; index += 1) {
    while (candidates.length && bars[candidates[candidates.length - 1]].close <= bars[index].close) candidates.pop();
    candidates.push(index);
    if (candidates[0] <= index - window) candidates.shift();
    if (index < 20) continue;
    const high = bars[candidates[0]].close;
    out[index] = high > 0 ? ((high - bars[index].close) / high) * 100 : null;
  }
  return out;
}

function quantile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * Forward-return distributions for days that resembled the most recent one.
 *
 * The comparison bands widen only if they have to: a tight band around today's
 * reading is the honest comparison, but a ticker that has never been this
 * oversold would return nothing at all, and reporting nothing where a looser
 * analogue exists is less useful than reporting the looser analogue and saying
 * so through the sample count.
 */
export function baseRates(bars: Bar[]): BaseRates | null {
  if (bars.length < 400) return null;
  const rsi = rsiSeries(bars);
  const drawdown = drawdownSeries(bars);
  const last = bars.length - 1;
  const setup: BaseRateSetup = { rsi: rsi[last], drawdown: drawdown[last] };
  if (setup.rsi === null || setup.drawdown === null) return null;

  for (const [rsiBand, drawdownBand] of [[5, 5], [8, 10], [12, 18]] as const) {
    const match = {
      rsiLow: setup.rsi - rsiBand,
      rsiHigh: setup.rsi + rsiBand,
      drawdownLow: Math.max(0, setup.drawdown - drawdownBand),
      drawdownHigh: setup.drawdown + drawdownBand,
    };
    const days: number[] = [];
    // The final year is excluded from the search rather than the outcome: a day
    // whose forward window has not finished cannot contribute an outcome, and
    // including it as a match would inflate the sample the reader is judging.
    for (let index = 0; index < last - Math.max(...HORIZONS); index += 1) {
      const readingRsi = rsi[index];
      const readingDrawdown = drawdown[index];
      if (readingRsi === null || readingDrawdown === null) continue;
      if (readingRsi < match.rsiLow || readingRsi > match.rsiHigh) continue;
      if (readingDrawdown < match.drawdownLow || readingDrawdown > match.drawdownHigh) continue;
      days.push(index);
    }
    if (days.length < 20) continue;

    const episodes = days.reduce((count, index, position) => (position === 0 || index - days[position - 1] > 21 ? count + 1 : count), 0);
    const outcomes = HORIZONS.map((horizonDays) => {
      const returns = days
        .filter((index) => index + horizonDays <= last)
        .map((index) => (bars[index + horizonDays].close / bars[index].close - 1) * 100)
        .sort((left, right) => left - right);
      return {
        horizonDays,
        samples: returns.length,
        positiveShare: returns.length ? (returns.filter((value) => value > 0).length / returns.length) * 100 : 0,
        median: quantile(returns, 0.5),
        p10: quantile(returns, 0.1),
        p90: quantile(returns, 0.9),
        worst: returns[0] ?? 0,
        best: returns.at(-1) ?? 0,
      };
    }).filter((outcome) => outcome.samples >= 20);

    if (outcomes.length) return { setup, match, outcomes, matches: days.length, episodes };
  }

  return { setup, match: null, outcomes: [], matches: 0, episodes: 0 };
}
