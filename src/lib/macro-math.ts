import { normalCdf } from "./options-math.ts";

/**
 * Twelve-month-ahead recession probability implied by the yield curve.
 *
 * This is the Estrella-Mishkin probit specification the New York Fed
 * publishes its curve-based probability from: a single probit on the average
 * monthly spread between the ten-year Treasury yield and the three-month bill.
 * The coefficients below are the published ones, so the output tracks that
 * model closely, but it is recomputed here from the daily spread rather than
 * read from the Fed's own spreadsheet — it is not their released number and
 * small differences from it are expected.
 *
 * The input is the spread in percentage points; the output is a probability
 * between 0 and 1 that a recession begins within the next twelve months.
 */
export function curveRecessionProbability(spread: number | null) {
  if (spread === null || !Number.isFinite(spread)) return null;
  return normalCdf(-0.5333 - 0.633 * spread);
}

/**
 * Splits a nominal Treasury yield into the part explained by the expected
 * path of short rates and the term premium investors demand for holding
 * duration. The term premium comes from the Fed Board's Kim-Wright model, so
 * the expectations component is a residual, not an independently measured
 * series.
 */
export function yieldDecomposition(nominal: number | null, termPremium: number | null) {
  if (nominal === null || termPremium === null) return null;
  if (!Number.isFinite(nominal) || !Number.isFinite(termPremium)) return null;
  return { termPremium, expectations: nominal - termPremium };
}

export function percentChange(current: number | null, prior: number | null) {
  if (current === null || prior === null || prior === 0) return null;
  return (current / prior - 1) * 100;
}

export function netLiquidity(
  fedAssetsMillions: number | null,
  treasuryCashMillions: number | null,
  reverseRepoBillions: number | null,
) {
  if (
    fedAssetsMillions === null ||
    treasuryCashMillions === null ||
    reverseRepoBillions === null
  ) {
    return null;
  }
  return fedAssetsMillions - treasuryCashMillions - reverseRepoBillions * 1_000;
}

/**
 * Scores the 25 delta risk reversal as a percentile of its own recent history.
 *
 * Index risk reversals are persistently negative, and how negative is
 * "normal" moves with the volatility regime and the tenor being measured, so
 * there is no defensible fixed threshold. Ranking against the instrument's own
 * observations avoids inventing one. A less negative reading than usual ranks
 * high, which corresponds to a weaker bid for downside protection.
 *
 * Returns null until enough sessions have been recorded, so the composite
 * simply excludes the component rather than scoring against a handful of
 * points.
 */
export function skewPercentile(
  current: number,
  history: number[],
  minimumSessions = 20,
) {
  const usable = history.filter((value) => Number.isFinite(value));
  if (!Number.isFinite(current) || usable.length < minimumSessions) return null;
  const below = usable.filter((value) => value < current).length;
  const equal = usable.filter((value) => value === current).length;
  // Midpoint ranking, so a value sitting exactly on observed readings is not
  // pushed to whichever end of the range the comparison happens to favour.
  return ((below + equal / 2) / usable.length) * 100;
}

export function weightedAvailable(
  components: Array<{ value: number | null; weight: number }>,
) {
  const available = components.filter(
    (component): component is { value: number; weight: number } =>
      component.value !== null && Number.isFinite(component.value) && component.weight > 0,
  );
  const weight = available.reduce((total, component) => total + component.weight, 0);
  if (!weight) return null;
  return available.reduce(
    (total, component) => total + component.value * (component.weight / weight),
    0,
  );
}

export function parseObservationCsv(csv: string, seriesId: string) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0]?.split(",") ?? [];
  const valueIndex = headers.findIndex((header) => header.trim() === seriesId);
  if (valueIndex < 1) throw new Error(`${seriesId} was missing from the economic-data response.`);
  return lines.slice(1).flatMap((line) => {
    const cells = line.split(",");
    const rawValue = cells[valueIndex]?.trim();
    if (!rawValue || rawValue === ".") return [];
    const value = Number(rawValue);
    return /^\d{4}-\d{2}-\d{2}$/.test(cells[0]) && Number.isFinite(value)
      ? [{ date: cells[0], value }]
      : [];
  });
}
