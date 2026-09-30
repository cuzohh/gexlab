/**
 * Where one strike is priced away from the volatility curve around it.
 *
 * There is a popular claim that a strike whose implied volatility spikes above
 * its neighbours marks a level defended by dealers — an "IV wall" — and that
 * this is a sharper version of gamma exposure. Two parts of that are wrong and
 * one part is worth keeping.
 *
 * Wrong, first: open interest does not raise implied volatility at a strike.
 * Volatility moves with net demand, and open interest records neither side's
 * intent. Overwriting flow builds enormous open interest by *selling* calls,
 * which leaves dealers long those options and quoting that strike cheaper. The
 * same open interest, built the other way, would push the strike richer. Size
 * alone cannot tell you the sign.
 *
 * Wrong, second: dealer hedging pressure lives in gamma, not in volatility.
 * Gamma is what forces a dealer to buy and sell the underlying as spot moves,
 * which is why this codebase already computes a call wall, a put wall, and a
 * gamma flip. A strike can carry rich volatility and almost no gamma.
 *
 * Worth keeping: a strike priced away from the smile fitted through its
 * neighbours is genuine evidence of one-sided demand for that specific
 * contract. That is what this module measures — and only that. It says
 * somebody paid up for optionality at a level. It does not say which way the
 * underlying goes next, and it is not a support-and-resistance indicator.
 *
 * The filtering is not incidental. Illiquidity manufactures exactly the
 * signature the claim describes: a wide market read at its midpoint prints an
 * implied volatility that looks like a spike and is really an absence of
 * quotes. Anything thin, unquoted or crossed is reported as unreadable rather
 * than as a finding.
 */

export type SmileQuote = {
  strike: number;
  /** Implied volatility as a decimal, e.g. 0.32 for 32 vol. */
  iv: number | null;
  openInterest: number;
  volume: number;
  bid: number;
  ask: number;
  /** Price change per one point of volatility. The precision of the quote. */
  vega: number | null;
};

export type SmilePoint = {
  strike: number;
  iv: number;
  fitted: number;
  /** Actual less fitted, in volatility points. Positive means richer than the curve. */
  residual: number;
  openInterest: number;
  volume: number;
  /** Bid-ask width as a share of the mid. Reported, but not what screens the quote. */
  relativeSpread: number;
  /** Volatility points of ambiguity the bid-ask leaves, via vega. */
  ivUncertainty: number;
};

export type SmileFit = {
  points: SmilePoint[];
  /** Points priced away from the curve by more than the noise around it. */
  dislocations: SmilePoint[];
  /** Standard deviation of the residuals, in volatility points. */
  noise: number;
  /** Quotes dropped before fitting, and why. */
  rejected: { illiquid: number; unquoted: number; total: number };
};

/**
 * How much volatility ambiguity a quote may carry and still be worth reading.
 *
 * The obvious screen — bid-ask as a share of the midpoint — is wrong for cheap
 * options, and wrong in the direction that matters. A three-day Apple call
 * quoted 0.01 at 0.02 is one tick wide, the tightest market that can exist, and
 * carries twenty thousand contracts of open interest against eighty thousand
 * traded; by relative spread it reads as sixty-seven per cent and gets thrown
 * away. Vega converts the same spread into the units of the question actually
 * being asked: half the width, divided by the price change per volatility
 * point, is how far the implied volatility could move without the quote
 * changing at all. Anything vaguer than that cannot be compared to a fitted
 * curve, whatever its price happens to be.
 */
const MAX_IV_UNCERTAINTY = 1.5;
const MIN_OPEN_INTEREST = 25;
/**
 * Contracts traded today that stand in for open interest.
 *
 * A strike with no open interest is not automatically unreadable — a position
 * opened this session has none yet, and that is exactly the demand worth
 * seeing. One lot is not that. This is the floor at which today's tape counts
 * as evidence in its own right.
 */
const MIN_VOLUME_WITHOUT_OI = 10;
/** Fewer usable strikes than this and a fitted curve is drawing through noise. */
const MIN_POINTS = 8;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * A weighted quadratic through a set of points, by normal equations.
 *
 * Three unknowns over a dozen points does not need anything iterative. Returns
 * null when the neighbourhood is degenerate — every strike at one moneyness,
 * which happens at a boundary — rather than a curve fitted to nothing.
 */
function weightedQuadratic(xs: number[], ys: number[], ws: number[]) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index];
    const w = ws[index];
    const x2 = x * x;
    s0 += w; s1 += w * x; s2 += w * x2; s3 += w * x2 * x; s4 += w * x2 * x2;
    t0 += w * ys[index]; t1 += w * x * ys[index]; t2 += w * x2 * ys[index];
  }
  const m = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row;
    if (Math.abs(m[pivot][column]) < 1e-14) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = m[row][column] / m[column][column];
      for (let col = column; col < 4; col += 1) m[row][col] -= factor * m[column][col];
    }
  }
  const c = m[0][3] / m[0][0];
  const b = m[1][3] / m[1][1];
  const a = m[2][3] / m[2][2];
  return (x: number) => c + b * x + a * x * x;
}

/** Neighbours used to predict each strike, either side where they exist. */
const NEIGHBOURS = 14;
/**
 * Strikes at each end that get no verdict.
 *
 * A curve through neighbours needs neighbours on both sides. The outermost
 * strikes have them on one side only, so any distance from the fitted value
 * there is extrapolation error rather than a finding — which is precisely
 * where a single global curve produced its most confident nonsense.
 */
const EDGE_MARGIN = 2;

/**
 * Fit the smile for one expiry and return each strike's distance from it.
 *
 * The threshold is the residual spread itself rather than a fixed number of
 * volatility points: a quiet name whose strikes sit within half a vol of the
 * curve and a meme stock whose strikes scatter by five are different
 * measurement problems, and one constant cannot serve both.
 */
export function fitSmile(quotes: SmileQuote[], spot: number, { sigmas = 2.5 }: { sigmas?: number } = {}): SmileFit | null {
  if (!(spot > 0)) return null;
  let unquoted = 0;
  let illiquid = 0;
  const usable: SmilePoint[] = [];

  for (const quote of quotes) {
    if (quote.iv === null || !(quote.iv > 0) || !(quote.strike > 0)) {
      unquoted += 1;
      continue;
    }
    const mid = (quote.bid + quote.ask) / 2;
    // A zero or crossed market has no midpoint to read a volatility from.
    if (!(mid > 0) || quote.ask < quote.bid) {
      unquoted += 1;
      continue;
    }
    const relativeSpread = (quote.ask - quote.bid) / mid;
    // Vega is quoted per volatility point, so half the spread divided by it is
    // the volatility the quote cannot resolve.
    const ivUncertainty = quote.vega && quote.vega > 0
      ? ((quote.ask - quote.bid) / 2) / quote.vega
      : Number.POSITIVE_INFINITY;
    if (ivUncertainty > MAX_IV_UNCERTAINTY || (quote.openInterest < MIN_OPEN_INTEREST && quote.volume < MIN_VOLUME_WITHOUT_OI)) {
      illiquid += 1;
      continue;
    }
    usable.push({
      strike: quote.strike,
      iv: quote.iv,
      fitted: 0,
      residual: 0,
      openInterest: quote.openInterest,
      volume: quote.volume,
      relativeSpread,
      ivUncertainty,
    });
  }

  const rejected = { illiquid, unquoted, total: illiquid + unquoted };
  if (usable.length < MIN_POINTS) return { points: [], dislocations: [], noise: 0, rejected };

  // Sorted by moneyness so a neighbourhood is a contiguous run.
  usable.sort((left, right) => left.strike - right.strike);
  const xs = usable.map((point) => Math.log(point.strike / spot));

  /**
   * Each strike predicted from the strikes around it, never from itself.
   *
   * A single curve fitted across the whole chain cannot follow real index
   * skew: on the S&P it left at-the-money volatility reading two and a half
   * points cheap and both wings rich, a signature of the model failing rather
   * than of anything the market did, and it then reported those artefacts as
   * findings. A local fit follows whatever shape the smile actually has.
   *
   * Leaving the point out of its own prediction is what makes the residual
   * mean anything. Included, a strike priced away from its neighbours would
   * drag the curve toward itself and hide exactly the distance being measured.
   */
  const neighboursOf = usable.map((_, index) =>
    usable
      .map((__, other) => other)
      .filter((other) => other !== index)
      .sort((left, right) => Math.abs(xs[left] - xs[index]) - Math.abs(xs[right] - xs[index]))
      .slice(0, NEIGHBOURS));

  /** One pass of the local fit, with each neighbour's influence scaled by `trust`. */
  const pass = (trust: number[]) => {
    const fitted: (number | null)[] = usable.map(() => null);
    for (let index = 0; index < usable.length; index += 1) {
      const others = neighboursOf[index];
      if (others.length < 6) continue;
      // Both sides, or no verdict. A local quadratic asked to predict a point
      // that sits outside its own neighbourhood is extrapolating, and on the
      // Nasdaq boundary that produced a fitted volatility 220 points away from
      // the quote. That is the model leaving the data, not a dislocation.
      const before = others.filter((other) => xs[other] < xs[index]).length;
      if (before < 2 || others.length - before < 2) continue;
      const span = Math.abs(xs[others[others.length - 1]] - xs[index]) || 1;
      const nx = others.map((other) => xs[other]);
      const ny = others.map((other) => usable[other].iv);
      // Tricube weights: near neighbours decide the local shape, far ones barely
      // participate, and nothing changes abruptly as the window slides.
      const nw = others.map((other) => {
        const distance = Math.min(Math.abs(xs[other] - xs[index]) / span, 1);
        return ((1 - distance ** 3) ** 3 + 1e-6) * trust[other];
      });
      const curve = weightedQuadratic(nx, ny, nw);
      if (!curve) continue;
      const value = curve(xs[index]);
      if (Number.isFinite(value)) fitted[index] = value;
    }
    return fitted;
  };

  /**
   * Robustness iterations, in Cleveland's sense.
   *
   * Leaving a strike out of its own prediction stops it hiding its own
   * distance from the curve — but it still sits in its neighbours' windows and
   * drags their fitted values toward it. On a clean surface with one strike
   * bid away, that alone reported six findings where there was one: the real
   * dislocation, and five neighbours pulled off the curve by it. Refitting with
   * each point's influence scaled down by how far it fell last time confines a
   * dislocation to the strike that actually has it.
   */
  let trust = usable.map(() => 1);
  let fitted = pass(trust);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const sizes = fitted.map((value, index) => (value === null ? 0 : Math.abs(usable[index].iv - value)));
    // Only the worst tenth of the surface may be discounted, and the scale is
    // read from that boundary rather than from the median.
    //
    // Cleveland's rule — six times the median absolute residual — assumes the
    // residuals have a scale. On a clean chain with one strike bid away they do
    // not: the median is nearly zero, six times nearly zero is nearly zero, and
    // every point with any contamination at all falls outside it. The refit was
    // then dominated by whichever few strikes happened to survive, which left a
    // neighbour reading 1.35 volatility points off a curve it sits exactly on.
    // Capping the proportion that can be downweighted makes the step do what it
    // was meant to do — set aside the outliers — and nothing more.
    const ranked = [...sizes].sort((left, right) => left - right);
    const cut = ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * 0.9))];
    if (!(cut > 0)) break;
    trust = sizes.map((size) => {
      if (size <= cut) return 1;
      const ratio = Math.min(size / (3 * cut), 1);
      return (1 - ratio ** 2) ** 2 + 1e-6;
    });
    fitted = pass(trust);
  }

  const points: SmilePoint[] = [];
  for (let index = 0; index < usable.length; index += 1) {
    const value = fitted[index];
    if (value === null) continue;
    points.push({ ...usable[index], fitted: value, residual: usable[index].iv - value });
  }

  if (points.length < MIN_POINTS) return { points: [], dislocations: [], noise: 0, rejected };

  // Spread of the residuals about zero, which is where a leave-one-out fit
  // puts them by construction. Measuring the deviation about their median
  // instead breaks on a surface that scatters evenly either side of the curve:
  // the median lands on one of the two arms, half the points read as zero
  // deviation, and a thoroughly noisy chain reports a noise of almost nothing
  // and then flags most of itself. Scaled to a standard deviation so the
  // multiplier below means what it usually means.
  const noise = median(points.map((point) => Math.abs(point.residual))) * 1.4826;
  const threshold = Math.max(noise * sigmas, 0.01);

  const dislocations = points
    .slice(EDGE_MARGIN, Math.max(EDGE_MARGIN, points.length - EDGE_MARGIN))
    // Two bars to clear: unusual against the surface's own scatter, and larger
    // than the volatility the strike's bid-ask leaves undetermined. A local fit
    // tracks a liquid index smile to a few hundredths of a point, so without
    // the second test a strike could be flagged for a deviation smaller than
    // the distance between its own bid and its own ask.
    .filter((point) => Math.abs(point.residual) >= Math.max(threshold, point.ivUncertainty / 100))
    .sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual));

  return { points: points.sort((left, right) => left.strike - right.strike), dislocations, noise, rejected };
}
