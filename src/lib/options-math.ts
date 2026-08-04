import { easternCloseIso, parseEasternTimestamp } from "./market-time.ts";
import { normalCdf } from "./normal.ts";

export type OptionType = "call" | "put";

// Re-exported because the pricing module is where callers expect to find it.
export { normalCdf };

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

/**
 * Settlement instants are cached by (expiry, root).
 *
 * A chain has tens of thousands of contracts and a few dozen distinct expiry
 * dates, so this is called once per contract and answers one of about eighty
 * distinct questions. The callers are per-contract by necessity — two roots
 * sharing an expiry date settle at different times — but the answer is not.
 * The market calendar is a static table, so a result never becomes wrong.
 */
const expirationCache = new Map<string, string | null>();

export function expirationIso(expiry: string, root = "") {
  const key = `${expiry}|${root}`;
  const cached = expirationCache.get(key);
  if (cached !== undefined) return cached;
  // Standard NDX/SPX index options are AM-settled. Their PM-settled families
  // (NDXP/SPXW) and ETF options trade through the regular close.
  const isAmSettled = root === "NDX" || root === "SPX";
  const settles = isAmSettled
    ? parseEasternTimestamp(`${expiry} 09:30:00`)
    : easternCloseIso(expiry);
  expirationCache.set(key, settles);
  return settles;
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

/** One leg of a chain, as much of it as the exposure calculation reads. */
export type ExposureContract = {
  root: string;
  expiry: string;
  strike: number;
  type: OptionType;
  oi: number;
  volume: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
};

/** The parity-invariant greeks of a strike, plus the inputs they came from. */
export type PricedStrike = {
  iv: number;
  years: number;
  gamma: number;
  vegaPerVolPoint: number;
  vanna: number;
  speed: number;
  zomma: number;
  vomma: number;
};

export type ExposureRow = {
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
  callIv: number | null;
  putIv: number | null;
};

type ExposureInput = {
  spot: number;
  dividendYield: number;
  valuationTime: number;
  riskFreeRate: number;
};

export function strikeKey(contract: Pick<ExposureContract, "root" | "expiry" | "strike">) {
  return `${contract.root}|${contract.expiry}|${contract.strike}`;
}

/**
 * Prices each strike once, rather than each leg of it.
 *
 * Gamma, vega, vanna, speed, zomma and vomma do not depend on whether a
 * contract is a call or a put — put-call parity fixes them equal at a shared
 * strike, and modelGreeks is tested on exactly that. The chain does not always
 * agree, because the feed quotes the two legs separately: the same strike
 * arrives with two implied volatilities, and sometimes with a gamma on one leg
 * and nothing usable on the other.
 *
 * Pricing each leg on its own terms and then subtracting one from the other
 * turns that disagreement into exposure nobody holds. It is how a strike whose
 * call open interest was twelve against one put came out net short gamma. So
 * the volatility is chosen once per strike and every parity-invariant greek is
 * computed from it; only delta and charm, which genuinely differ by type, are
 * still evaluated per leg.
 *
 * The volatility comes from the out-of-the-money leg for the reason buildSmile
 * gives: the in-the-money quote carries the same information across a far wider
 * spread. A supplied greek is taken from that leg first for the same reason.
 */
export function priceStrikes(contracts: ExposureContract[], input: ExposureInput) {
  const { spot, dividendYield, valuationTime, riskFreeRate } = input;
  const sides = new Map<string, { call?: ExposureContract; put?: ExposureContract }>();
  for (const contract of contracts) {
    const key = strikeKey(contract);
    const entry = sides.get(key) ?? {};
    entry[contract.type] = contract;
    sides.set(key, entry);
  }

  const priced = new Map<string, PricedStrike>();

  for (const [key, entry] of sides) {
    const either = entry.call ?? entry.put;
    if (!either) continue;
    const years = yearsToExpiry(either.expiry, valuationTime, either.root);
    const forward = spot * Math.exp((riskFreeRate - dividendYield) * years);
    const outOfTheMoney = either.strike < forward ? entry.put : entry.call;
    const inTheMoney = either.strike < forward ? entry.call : entry.put;
    const preferOtm = <T,>(read: (contract: ExposureContract) => T | null) => {
      for (const leg of [outOfTheMoney, inTheMoney]) {
        if (!leg) continue;
        const value = read(leg);
        if (value !== null) return value;
      }
      return null;
    };

    const iv = preferOtm((contract) => (contract.iv !== null && contract.iv > 0 ? contract.iv : null)) ?? 0.2;
    // The type is immaterial to everything read off this: the six greeks taken
    // from it are the parity-invariant ones.
    const modeled = modelGreeks({
      spot,
      strike: either.strike,
      years,
      iv,
      type: "call",
      riskFreeRate,
      dividendYield,
    });

    priced.set(key, {
      iv,
      years,
      gamma:
        preferOtm((contract) => (contract.gamma !== null && contract.gamma > 0 ? contract.gamma : null)) ??
        modeled.gamma,
      vegaPerVolPoint: preferOtm((contract) => contract.vega) ?? modeled.vega / 100,
      vanna: modeled.vanna,
      speed: modeled.speed,
      zomma: modeled.zomma,
      vomma: modeled.vomma,
    });
  }

  return priced;
}

type ExposureAccumulator = Omit<ExposureRow, "callIv" | "putIv"> & {
  callIvWeighted: number;
  putIvWeighted: number;
  callIvWeight: number;
  putIvWeight: number;
};

/**
 * Sums a chain into one row per strike, on the dealer sign convention: calls
 * positive, puts negative.
 *
 * Delta is the exception and is deliberately unsigned. It is presented as a
 * call-versus-put tilt rather than a dealer position, so it keeps the natural
 * signs the two legs already carry.
 */
export function aggregateExposure(contracts: ExposureContract[], input: ExposureInput): ExposureRow[] {
  const { spot, dividendYield, riskFreeRate } = input;
  const rows = new Map<number, ExposureAccumulator>();
  const inBand = contracts.filter(
    (contract) => contract.strike >= spot * 0.72 && contract.strike <= spot * 1.28,
  );
  const priced = priceStrikes(inBand, input);

  for (const contract of inBand) {
    const strike = priced.get(strikeKey(contract));
    if (!strike) continue;
    const sign = contract.type === "call" ? 1 : -1;
    const weight = contract.oi;
    // Delta and charm are the two that depend on the type, so they are the two
    // still evaluated per leg — off the strike's volatility, not the leg's.
    const modeled = modelGreeks({
      spot,
      strike: contract.strike,
      years: strike.years,
      iv: strike.iv,
      type: contract.type,
      riskFreeRate,
      dividendYield,
    });
    const delta = contract.delta ?? modeled.delta;
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

    row.gamma += sign * weight * strike.gamma * 100 * spot * spot * 0.01;
    row.delta += weight * delta * 100 * spot;
    row.vanna += sign * weight * strike.vanna * 100 * spot;
    row.charm += sign * weight * modeled.charm * 100 * spot;
    row.vega += sign * weight * strike.vegaPerVolPoint * 100;
    row.speed += sign * weight * strike.speed * 100 * spot * spot * 0.01;
    row.zomma += sign * weight * strike.zomma * 100 * spot * spot * 0.01;
    row.vomma += sign * weight * strike.vomma * 100;

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
