/**
 * Implied moves at a chosen horizon, read off the listed volatility surface.
 *
 * The market prices volatility at the expiries it lists and nowhere else. A
 * horizon that falls between two of them is interpolated in *total variance*
 * (σ²T), which is the quantity that accumulates linearly in time — averaging
 * the two implied volatilities directly would misprice the gap, badly when the
 * term structure is steep.
 *
 * A horizon outside the listed range is not priced at all. Flat-extrapolating
 * a one-year volatility from a six-month book, or a one-day volatility from a
 * one-week one, produces a number that looks like a quote and is not one; short
 * maturities in particular carry the steepest part of the curve. Callers get
 * null and a reason instead.
 */

export type SurfaceSlice = { expiry: string; atmIv: number | null; years: number | null };

export type VolQuote = {
  iv: number;
  years: number;
  /** "listed" when an expiry sits on the horizon, "interpolated" when between two. */
  basis: "listed" | "interpolated";
  /** The expiry or expiries the number came from. */
  expiries: string[];
};

export type ImpliedMove = {
  horizon: string;
  years: number;
  iv: number;
  dollars: number;
  percent: number;
  lower: number;
  upper: number;
  basis: VolQuote["basis"];
  expiries: string[];
};

/** Slices that carry a usable at-the-money quote, in maturity order. */
export function usableSlices(surface: SurfaceSlice[]) {
  return surface
    .filter((slice): slice is { expiry: string; atmIv: number; years: number } =>
      typeof slice.atmIv === "number" && Number.isFinite(slice.atmIv) && slice.atmIv > 0 &&
      typeof slice.years === "number" && Number.isFinite(slice.years) && slice.years > 0)
    .sort((left, right) => left.years - right.years);
}

/**
 * At-the-money volatility for an arbitrary maturity.
 *
 * Returns null when the horizon sits outside the listed expiries rather than
 * extending the curve past what the market quoted.
 */
export function impliedVolAt(surface: SurfaceSlice[], years: number): VolQuote | null {
  if (!Number.isFinite(years) || years <= 0) return null;
  const slices = usableSlices(surface);
  if (!slices.length) return null;

  const first = slices[0];
  const last = slices[slices.length - 1];
  // A day either side of an endpoint is the same quote for this purpose; the
  // surface is only published to the day.
  const tolerance = 1 / 365;
  if (years < first.years - tolerance || years > last.years + tolerance) return null;

  for (const slice of slices) {
    if (Math.abs(slice.years - years) <= tolerance) {
      return { iv: slice.atmIv, years: slice.years, basis: "listed", expiries: [slice.expiry] };
    }
  }

  for (let index = 0; index < slices.length - 1; index += 1) {
    const left = slices[index];
    const right = slices[index + 1];
    if (years < left.years || years > right.years) continue;
    // Total variance is what is additive in time, so the interpolation happens
    // there and the volatility is recovered afterwards.
    const leftVariance = left.atmIv ** 2 * left.years;
    const rightVariance = right.atmIv ** 2 * right.years;
    const weight = (years - left.years) / (right.years - left.years);
    const variance = leftVariance + (rightVariance - leftVariance) * weight;
    if (!(variance > 0)) return null;
    return {
      iv: Math.sqrt(variance / years),
      years,
      basis: "interpolated",
      expiries: [left.expiry, right.expiry],
    };
  }

  // Inside the range but past the last bracket: the endpoint itself.
  return { iv: last.atmIv, years: last.years, basis: "listed", expiries: [last.expiry] };
}

/**
 * A one-standard-deviation move over `years`.
 *
 * `spot × σ × √T` is the lognormal approximation the straddle prices. It is a
 * magnitude, not a direction, and it describes roughly a two-in-three chance of
 * landing inside the band — not a bound.
 */
export function impliedMove(spot: number, quote: VolQuote, horizon: string): ImpliedMove | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const dollars = spot * quote.iv * Math.sqrt(quote.years);
  if (!Number.isFinite(dollars)) return null;
  return {
    horizon,
    years: quote.years,
    iv: quote.iv,
    dollars,
    percent: (dollars / spot) * 100,
    lower: spot - dollars,
    upper: spot + dollars,
    basis: quote.basis,
    expiries: quote.expiries,
  };
}

export type HorizonRequest = { label: string; years: number };

/** Year fractions matching the surface's own convention: calendar time over 365 days. */
export function yearsBetween(fromMs: number, toMs: number) {
  return (toMs - fromMs) / (365 * 24 * 60 * 60 * 1000);
}

/**
 * Implied moves for a set of horizons.
 *
 * Each horizon resolves independently, so a name whose book stops at six months
 * still reports its next-session and one-month moves and simply omits the year.
 */
export function impliedMoves(
  surface: SurfaceSlice[],
  spot: number,
  horizons: HorizonRequest[],
): { requested: HorizonRequest; move: ImpliedMove | null }[] {
  return horizons.map((requested) => {
    const quote = impliedVolAt(surface, requested.years);
    return { requested, move: quote ? impliedMove(spot, quote, requested.label) : null };
  });
}
