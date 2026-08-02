import type { DailyOhlc } from "@/lib/server/yahoo-daily";

type DailyPoint = DailyOhlc & {
  implied: number | null;
  event: boolean;
  vix: number | null;
  vxn: number | null;
  vxv: number | null;
};

export type MoveMap = {
  reference: number;
  asOf: string;
  source: "Yahoo daily OHLC + implied volatility";
  sourceStatus: "Live" | "Saved" | "Unavailable";
  upper: { p50: number; p68: number; p90: number };
  lower: { p50: number; p68: number; p90: number };
  upperPrices: { p50: number; p68: number; p90: number };
  lowerPrices: { p50: number; p68: number; p90: number };
  impliedMove: number | null;
  statisticalMove: number;
  blend: { impliedWeight: number; historicalWeight: number; selection: "Adaptive" | "Historical only" };
  regimeMatch: { samples: number; label: "Matched" | "Recent-only" };
  evaluation: { samples: number; upperMae: number; lowerMae: number; p68Coverage: number; p90Coverage: number };
  reaction: { label: "GEX reaction candidate" | "Acceleration overlap" | "Statistical reach only"; price: number | null; distancePercent: number | null; reason: string };
  caveat: string;
};

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * probability)));
  return sorted[index];
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function realizedDailyVol(points: DailyPoint[], index: number) {
  const returns = Array.from({ length: 20 }, (_, offset) => index - offset)
    .filter((position) => position > 0 && points[position - 1].close > 0)
    .map((position) => (points[position].close / points[position - 1].close - 1) * 100);
  return standardDeviation(returns);
}

function matchedExcursion(points: DailyPoint[], index: number, event: boolean) {
  const current = points[index];
  const currentRealized = realizedDailyVol(points, index);
  const currentCurve = finite(current.vix) && finite(current.vxv) && current.vxv > 0 ? current.vix / current.vxv : null;
  const candidates = Array.from({ length: Math.min(1_260, index - 20) }, (_, offset) => index - 1 - offset)
    .filter((position) => position >= 20 && position + 1 < points.length)
    .map((position) => {
      const candidate = points[position];
      const candidateCurve = finite(candidate.vix) && finite(candidate.vxv) && candidate.vxv > 0 ? candidate.vix / candidate.vxv : null;
      const candidateRealized = realizedDailyVol(points, position);
      let distance = 0;
      let dimensions = 0;
      if (finite(current.vxn) && finite(candidate.vxn)) { distance += Math.abs(current.vxn - candidate.vxn) / 4; dimensions += 1; }
      if (currentCurve !== null && candidateCurve !== null) { distance += Math.abs(currentCurve - candidateCurve) / 0.08; dimensions += 1; }
      if (currentRealized !== null && candidateRealized !== null) { distance += Math.abs(currentRealized - candidateRealized) / 0.35; dimensions += 1; }
      if (!dimensions) return null;
      distance /= dimensions;
      if (candidate.event !== event) distance += 0.8;
      const next = points[position + 1];
      if (!(candidate.close > 0)) return null;
      return {
        distance,
        upper: Math.max(0, (next.high / candidate.close - 1) * 100),
        lower: Math.max(0, (1 - next.low / candidate.close) * 100),
      };
    })
    .filter((candidate): candidate is { distance: number; upper: number; lower: number } => candidate !== null)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 40);
  if (candidates.length < 24) return null;
  const weighted = (side: "upper" | "lower") => {
    const weights = candidates.map((candidate) => 1 / Math.max(0.2, candidate.distance));
    return candidates.reduce((sum, candidate, candidateIndex) => sum + candidate[side] * weights[candidateIndex], 0) / weights.reduce((sum, value) => sum + value, 0);
  };
  return { upper: weighted("upper"), lower: weighted("lower"), samples: candidates.length };
}

function eventMultiplier(points: DailyPoint[], index: number, event: boolean) {
  if (!event || index < 80) return 1;
  const history = Array.from({ length: Math.min(504, index) }, (_, offset) => index - 1 - offset)
    .filter((position) => position >= 0 && position + 1 < points.length);
  const excursion = (position: number) => {
    const reference = points[position].close;
    const next = points[position + 1];
    return ((next.high / reference - 1) + (1 - next.low / reference)) * 50;
  };
  const all = history.map(excursion).filter(Number.isFinite);
  const eventOnly = history.filter((position) => points[position].event).map(excursion).filter(Number.isFinite);
  if (eventOnly.length < 12 || !all.length) return 1.1;
  return Math.max(0.9, Math.min(1.45, mean(eventOnly) / mean(all)));
}

function baseForecastAt(points: DailyPoint[], index: number, eventOverride?: boolean, useRegimeMatch = false) {
  const history = Array.from({ length: 22 }, (_, offset) => index - 1 - offset)
    .filter((position) => position >= 0 && position + 1 < points.length);
  if (history.length < 20) return null;
  const upside = history.map((position) => Math.max(0, (points[position + 1].high / points[position].close - 1) * 100));
  const downside = history.map((position) => Math.max(0, (1 - points[position + 1].low / points[position].close) * 100));
  const match = useRegimeMatch ? matchedExcursion(points, index, eventOverride ?? points[index].event) : null;
  const recentUp = match ? mean(upside) * 0.35 + match.upper * 0.65 : mean(upside);
  const recentDown = match ? mean(downside) * 0.35 + match.lower * 0.65 : mean(downside);
  const multiplier = eventMultiplier(points, index, eventOverride ?? points[index].event);
  return {
    historicalUpper: recentUp * multiplier,
    historicalLower: recentDown * multiplier,
    implied: points[index].implied === null ? null : points[index].implied * multiplier,
    multiplier,
    regimeSamples: match?.samples ?? 0,
  };
}

function forecastAt(points: DailyPoint[], index: number, eventOverride?: boolean, useRegimeMatch = false) {
  const base = baseForecastAt(points, index, eventOverride, useRegimeMatch);
  if (!base) return null;
  const { implied } = base;
  let impliedWeight = 0;
  if (implied !== null) {
    const candidates = Array.from({ length: Math.min(126, index - 22) }, (_, offset) => index - 1 - offset)
      .map((position) => {
        const prior = baseForecastAt(points, position);
        const next = points[position + 1];
        if (!prior || points[position].implied === null || !(points[position].close > 0)) return null;
        const actual = (
          Math.max(0, (next.high / points[position].close - 1) * 100) +
          Math.max(0, (1 - next.low / points[position].close) * 100)
        ) / 2;
        const historical = (prior.historicalUpper + prior.historicalLower) / 2;
        return { actual, historical, implied: prior.implied! };
      })
      .filter((candidate): candidate is { actual: number; historical: number; implied: number } => candidate !== null);
    if (candidates.length >= 40) {
      const historicalError = mean(candidates.map((candidate) => Math.abs(candidate.actual - candidate.historical)));
      const impliedError = mean(candidates.map((candidate) => Math.abs(candidate.actual - candidate.implied)));
      impliedWeight = Math.max(0.25, Math.min(0.75, historicalError / Math.max(historicalError + impliedError, 0.001)));
    } else {
      impliedWeight = 0.55;
    }
  }
  const blended = (historical: number) => implied === null ? historical : historical * (1 - impliedWeight) + implied * impliedWeight;
  return {
    upper: Math.max(0.05, blended(base.historicalUpper)),
    lower: Math.max(0.05, blended(base.historicalLower)),
    historicalUpper: base.historicalUpper,
    historicalLower: base.historicalLower,
    multiplier: base.multiplier,
    impliedWeight,
    regimeSamples: base.regimeSamples,
  };
}

export function buildMoveMap(input: {
  bars: DailyOhlc[];
  sourceStatus?: "Live" | "Saved" | "Unavailable";
  reference: number;
  impliedMove: number | null;
  impliedByDate: Map<string, number>;
  eventDates: Set<string>;
  nextSessionIsEvent?: boolean;
  volatilityByDate?: Map<string, { vix: number | null; vxn: number | null; vxv: number | null }>;
  gamma: { regime: string; callWallDistancePercent: number | null; putWallDistancePercent: number | null };
}): MoveMap | null {
  const points: DailyPoint[] = input.bars.map((bar) => ({
    ...bar,
    implied: input.impliedByDate.get(bar.date) ?? null,
    event: input.eventDates.has(bar.date),
    vix: input.volatilityByDate?.get(bar.date)?.vix ?? null,
    vxn: input.volatilityByDate?.get(bar.date)?.vxn ?? null,
    vxv: input.volatilityByDate?.get(bar.date)?.vxv ?? null,
  }));
  if (points.length < 280 || !(input.reference > 0)) return null;
  const predictions: Array<{ upper: number; lower: number; actualUpper: number; actualLower: number }> = [];
  for (let index = 22; index < points.length - 1; index += 1) {
    const forecast = forecastAt(points, index);
    const next = points[index + 1];
    if (!forecast || !(points[index].close > 0)) continue;
    predictions.push({
      ...forecast,
      actualUpper: Math.max(0, (next.high / points[index].close - 1) * 100),
      actualLower: Math.max(0, (1 - next.low / points[index].close) * 100),
    });
  }
  const recent = predictions.slice(-504);
  if (recent.length < 200) return null;
  const last = points.at(-1)!;
  const forecast = forecastAt(points, points.length - 1, input.nextSessionIsEvent, true);
  if (!forecast) return null;
  const jointRatios = recent
    .map((row) => Math.max(row.actualUpper / row.upper, row.actualLower / row.lower))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const makeBand = (value: number, samples: number[]) => ({
    p50: value * (quantile(samples, 0.5) ?? 1),
    p68: value * (quantile(samples, 0.68) ?? 1.25),
    p90: value * (quantile(samples, 0.9) ?? 1.75),
  });
  const upper = makeBand(forecast.upper, jointRatios);
  const lower = makeBand(forecast.lower, jointRatios);
  const coverage = (probability: "p68" | "p90") => {
    const probabilityValue = probability === "p68" ? 0.68 : 0.9;
    const scored = recent.map((row, index) => {
      const calibration = jointRatios.slice(Math.max(0, index - 252), index);
      const multiplier = quantile(calibration, probabilityValue);
      if (multiplier === null || calibration.length < 100) return null;
      return row.actualUpper <= row.upper * multiplier && row.actualLower <= row.lower * multiplier;
    }).filter((value): value is boolean => value !== null);
    return mean(scored.map((value) => value ? 1 : 0)) * 100;
  };
  const upperPrices = { p50: input.reference * (1 + upper.p50 / 100), p68: input.reference * (1 + upper.p68 / 100), p90: input.reference * (1 + upper.p90 / 100) };
  const lowerPrices = { p50: input.reference * (1 - lower.p50 / 100), p68: input.reference * (1 - lower.p68 / 100), p90: input.reference * (1 - lower.p90 / 100) };
  const levels = [
    { price: finite(input.gamma.callWallDistancePercent) ? input.reference * (1 + input.gamma.callWallDistancePercent / 100) : null, name: "Call wall" },
    { price: finite(input.gamma.putWallDistancePercent) ? input.reference * (1 + input.gamma.putWallDistancePercent / 100) : null, name: "Put wall" },
  ].filter((level): level is { price: number; name: string } => level.price !== null);
  const reaches = [upperPrices.p68, lowerPrices.p68, upperPrices.p90, lowerPrices.p90];
  const overlap = levels.map((level) => ({ ...level, distance: Math.min(...reaches.map((reach) => Math.abs(reach / level.price - 1) * 100)) })).sort((left, right) => left.distance - right.distance)[0] ?? null;
  const reaction = overlap && overlap.distance <= 0.18
    ? input.gamma.regime === "Positive"
      ? { label: "GEX reaction candidate" as const, price: overlap.price, distancePercent: overlap.distance, reason: `${overlap.name} overlaps a calibrated reach band in a positive-gamma regime.` }
      : { label: "Acceleration overlap" as const, price: overlap.price, distancePercent: overlap.distance, reason: `${overlap.name} overlaps a reach band, but the gamma regime does not support a fade.` }
    : { label: "Statistical reach only" as const, price: null, distancePercent: null, reason: "No major recorded options level is close enough to a calibrated reach band." };
  return {
    reference: input.reference,
    asOf: last.date,
    source: "Yahoo daily OHLC + implied volatility",
    sourceStatus: input.sourceStatus ?? (input.bars.length ? "Live" : "Unavailable"),
    upper,
    lower,
    upperPrices,
    lowerPrices,
    impliedMove: input.impliedMove,
    statisticalMove: (upper.p50 + lower.p50) / 2,
    blend: {
      impliedWeight: input.impliedMove === null ? 0 : forecast.impliedWeight,
      historicalWeight: input.impliedMove === null ? 1 : 1 - forecast.impliedWeight,
      selection: input.impliedMove === null ? "Historical only" : "Adaptive",
    },
    regimeMatch: { samples: forecast.regimeSamples, label: forecast.regimeSamples ? "Matched" : "Recent-only" },
    evaluation: {
      samples: recent.length,
      upperMae: mean(recent.map((row) => Math.abs(row.actualUpper - row.upper))),
      lowerMae: mean(recent.map((row) => Math.abs(row.actualLower - row.lower))),
      p68Coverage: coverage("p68"),
      p90Coverage: coverage("p90"),
    },
    reaction,
    caveat: "Reach bands estimate the day’s high/low excursion from the reference close. A GEX overlap is a reaction candidate, not a standalone reversal entry.",
  };
}
