import { easternCloseIso, parseEasternTimestamp } from "./market-time.ts";

export type OptionType = "call" | "put";

export function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function modelGamma(input: {
  spot: number;
  strike: number;
  years: number;
  iv: number;
  riskFreeRate: number;
  dividendYield: number;
}) {
  const { spot, strike, riskFreeRate, dividendYield } = input;
  if (!(spot > 0) || !(strike > 0)) throw new RangeError("Spot and strike must be positive.");
  const sigma = Math.max(input.iv, 0.01);
  const time = Math.max(input.years, 1 / (365 * 24));
  const sqrtT = Math.sqrt(time);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate - dividendYield + 0.5 * sigma * sigma) * time) /
    (sigma * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return (Math.exp(-dividendYield * time) * pdf) / (spot * sigma * sqrtT);
}

export function modelGreeks(input: {
  spot: number;
  strike: number;
  years: number;
  iv: number;
  type: OptionType;
  riskFreeRate: number;
  dividendYield: number;
}) {
  const { spot, strike, type, riskFreeRate, dividendYield } = input;
  if (!(spot > 0) || !(strike > 0)) throw new RangeError("Spot and strike must be positive.");
  const sigma = Math.max(input.iv, 0.01);
  const time = Math.max(input.years, 1 / (365 * 24));
  const sqrtT = Math.sqrt(time);
  const expQt = Math.exp(-dividendYield * time);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate - dividendYield + 0.5 * sigma * sigma) * time) /
    (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const gamma = (expQt * pdf) / (spot * sigma * sqrtT);
  const delta =
    type === "call"
      ? expQt * normalCdf(d1)
      : expQt * (normalCdf(d1) - 1);
  const vega = spot * expQt * pdf * sqrtT;
  const vanna = (-expQt * pdf * d2) / sigma;
  const charmCommon =
    expQt *
    pdf *
    (d2 / (2 * time) - (riskFreeRate - dividendYield) / (sigma * sqrtT));
  const charm =
    type === "call"
      ? dividendYield * expQt * normalCdf(d1) + charmCommon
      : -dividendYield * expQt * normalCdf(-d1) + charmCommon;
  const speed = -(gamma / spot) * (d1 / (sigma * sqrtT) + 1);
  const zomma = (gamma * (d1 * d2 - 1)) / sigma;
  const vomma = (vega * d1 * d2) / sigma;
  return { delta, gamma, vega, vanna, charm, speed, zomma, vomma, d1, d2 };
}

export function expirationIso(expiry: string, root = "") {
  // Standard NDX/SPX index options are AM-settled. Their PM-settled families
  // (NDXP/SPXW) and ETF options trade through the regular close.
  const isAmSettled = root === "NDX" || root === "SPX";
  return isAmSettled
    ? parseEasternTimestamp(`${expiry} 09:30:00`)
    : easternCloseIso(expiry);
}

export function yearsToExpiry(expiry: string, valuationTime: number, root = "") {
  const close = Date.parse(expirationIso(expiry, root) ?? `${expiry}T21:00:00Z`);
  if (!Number.isFinite(close) || !Number.isFinite(valuationTime)) {
    throw new RangeError("Expiry and valuation time must be valid.");
  }
  return Math.max((close - valuationTime) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24));
}

export function interpolateZero(
  leftStrike: number,
  leftValue: number,
  rightStrike: number,
  rightValue: number,
) {
  if (leftValue === rightValue || Math.sign(leftValue) === Math.sign(rightValue)) return null;
  return leftStrike + ((0 - leftValue) * (rightStrike - leftStrike)) / (rightValue - leftValue);
}

export type SmileContract = {
  strike: number;
  type: OptionType;
  iv: number | null;
  oi: number;
};

export type SmilePoint = {
  strike: number;
  iv: number;
  /** log(K / F). Zero at the forward, negative below it. */
  moneyness: number;
  /** log(K / F) / (atm IV * sqrt(T)), comparable across expiries. */
  standardized: number;
  /** Absolute delta of the quoted (out-of-the-money) side. */
  delta: number;
  oi: number;
  source: OptionType;
};

export type Smile = {
  forward: number;
  atmIv: number;
  points: SmilePoint[];
  /** IV at 25 delta on each wing, and the standard shape summaries. */
  putIv25: number | null;
  callIv25: number | null;
  riskReversal25: number | null;
  butterfly25: number | null;
};

/**
 * Linear interpolation of ys at the requested x. Expects xs sorted ascending
 * and returns null when the target is outside the observed range, so a missing
 * wing is reported rather than extrapolated into a fabricated quote.
 */
export function interpolateAt(xs: number[], ys: number[], target: number) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  if (target < xs[0] || target > xs[xs.length - 1]) return null;
  for (let index = 1; index < xs.length; index += 1) {
    const left = xs[index - 1];
    const right = xs[index];
    if (target > right) continue;
    if (right === left) return ys[index];
    const weight = (target - left) / (right - left);
    return ys[index - 1] + weight * (ys[index] - ys[index - 1]);
  }
  return null;
}

/**
 * Drops isolated implied-volatility spikes.
 *
 * Far out-of-the-money strikes routinely carry stale prints and spreads wide
 * enough that the implied volatility is meaningless. Those show up as single
 * points far off an otherwise smooth curve, so each point is compared against
 * the median of its neighbours rather than against a global threshold, which
 * would also discard the genuinely steep downside wing.
 */
export function despike(points: SmilePoint[], tolerance = 0.2, radius = 2) {
  if (points.length < 3) return points;
  const median = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  };
  return points.filter((point, index) => {
    // Interior points are compared against the median of their neighbourhood.
    // A median is used rather than a mean so that one stale print cannot drag
    // the reference far enough to condemn the healthy points beside it.
    // The two endpoints have no neighbourhood, so they are compared against a
    // straight-line extrapolation of the two points inside them, which lets a
    // steep but well-behaved wing survive.
    let expected: number;
    if (index === 0) expected = 2 * points[1].iv - points[2].iv;
    else if (index === points.length - 1) {
      expected = 2 * points[index - 1].iv - points[index - 2].iv;
    }
    else {
      expected = median(
        points
          .slice(Math.max(0, index - radius), Math.min(points.length, index + radius + 1))
          .map((neighbour) => neighbour.iv),
      );
    }
    if (!(expected > 0)) return true;
    return Math.abs(point.iv - expected) / expected <= tolerance;
  });
}

/**
 * Builds one expiry's volatility smile from a snapshot's contracts.
 *
 * Only the out-of-the-money side of each strike is used: puts below the
 * forward, calls at or above it. In-the-money quotes carry the same
 * information through put-call parity but with far wider spreads, so mixing
 * them in is what produces the spurious kink at the forward.
 */
export function buildSmile(input: {
  contracts: SmileContract[];
  spot: number;
  years: number;
  riskFreeRate: number;
  dividendYield: number;
  minOpenInterest?: number;
  maxMoneyness?: number;
  minDelta?: number;
}): Smile | null {
  const { spot, years, riskFreeRate, dividendYield } = input;
  if (!(spot > 0) || !(years > 0)) return null;

  // Open interest deliberately does not gate the smile. It measures
  // positioning, which is what the exposure calculation weights by, but a
  // newly listed expiry carries good quotes and no open interest at all.
  // Filtering on it silently deletes the near-the-money wing of thin
  // expiries; quote quality is enforced by the delta band and the despike
  // pass instead.
  const minOpenInterest = input.minOpenInterest ?? 0;
  const maxMoneyness = input.maxMoneyness ?? 0.35;
  // Below roughly two delta the quoted increment is a large fraction of the
  // option's value, so the implied volatility carries more rounding than
  // information. Those strikes are excluded rather than smoothed, since no
  // filter can recover a number that was never meaningful.
  const minDelta = input.minDelta ?? 0.02;
  const forward = spot * Math.exp((riskFreeRate - dividendYield) * years);
  if (!Number.isFinite(forward) || forward <= 0) return null;

  const byStrike = new Map<number, { call?: SmileContract; put?: SmileContract }>();
  for (const contract of input.contracts) {
    if (!(contract.strike > 0)) continue;
    const entry = byStrike.get(contract.strike) ?? {};
    entry[contract.type] = contract;
    byStrike.set(contract.strike, entry);
  }

  const points: SmilePoint[] = [];
  for (const [strike, sides] of byStrike) {
    const moneyness = Math.log(strike / forward);
    if (Math.abs(moneyness) > maxMoneyness) continue;
    // Out-of-the-money side only.
    const chosen = strike < forward ? sides.put : sides.call;
    if (!chosen || chosen.iv === null || !(chosen.iv > 0)) continue;
    if (chosen.oi < minOpenInterest) continue;
    const greeks = modelGreeks({
      spot,
      strike,
      years,
      iv: chosen.iv,
      type: chosen.type,
      riskFreeRate,
      dividendYield,
    });
    const delta = Math.abs(greeks.delta);
    if (!(delta >= minDelta)) continue;
    points.push({
      strike,
      iv: chosen.iv,
      moneyness,
      standardized: 0,
      delta,
      oi: chosen.oi,
      source: chosen.type,
    });
  }

  if (points.length < 2) return null;
  points.sort((left, right) => left.strike - right.strike);

  const cleaned = despike(points);
  if (cleaned.length < 2) return null;
  points.length = 0;
  points.push(...cleaned);

  const strikes = points.map((point) => point.strike);
  const ivs = points.map((point) => point.iv);
  const atmIv = interpolateAt(strikes, ivs, forward);
  if (atmIv === null || !(atmIv > 0)) return null;

  const scale = atmIv * Math.sqrt(years);
  for (const point of points) {
    point.standardized = scale > 0 ? point.moneyness / scale : 0;
  }

  // Each wing is interpolated separately: delta is not monotonic across the
  // full strike range once both sides are present.
  const wing = (side: OptionType) => {
    const selected = points
      .filter((point) => point.source === side)
      .sort((left, right) => left.delta - right.delta);
    return interpolateAt(
      selected.map((point) => point.delta),
      selected.map((point) => point.iv),
      0.25,
    );
  };

  const putIv25 = wing("put");
  const callIv25 = wing("call");
  const riskReversal25 =
    putIv25 !== null && callIv25 !== null ? callIv25 - putIv25 : null;
  const butterfly25 =
    putIv25 !== null && callIv25 !== null ? (putIv25 + callIv25) / 2 - atmIv : null;

  return { forward, atmIv, points, putIv25, callIv25, riskReversal25, butterfly25 };
}

export function calculateMaxPain(
  contracts: Array<{ strike: number; oi: number; type: OptionType }>,
) {
  const strikes = [...new Set(contracts.filter((row) => row.oi > 0).map((row) => row.strike))];
  if (!strikes.length) return null;
  let bestStrike = strikes[0];
  let bestPain = Number.POSITIVE_INFINITY;
  for (const settlement of strikes) {
    let pain = 0;
    for (const contract of contracts) {
      pain +=
        contract.type === "call"
          ? Math.max(0, settlement - contract.strike) * contract.oi
          : Math.max(0, contract.strike - settlement) * contract.oi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settlement;
    }
  }
  return bestStrike;
}
