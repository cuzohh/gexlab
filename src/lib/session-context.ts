export type DailyObservation = { date: string; value: number };

export type PositioningReading = {
  date: string;
  feature: string;
  value: number;
};

import { emptyOvernightContext, type OvernightContext } from "./overnight-context.ts";

export type SessionContext = {
  asOf: string;
  nextSession: string;
  relativeStrength: {
    oneDay: number | null;
    fiveDay: number | null;
    label: "NQ leading" | "ES leading" | "Aligned" | "Unavailable";
    source: "NDX vs SPX index proxy";
  };
  impliedMove: {
    percent: number | null;
    points: number | null;
    source: "front ATM IV" | "VIX fallback" | "Unavailable";
    horizonDays: number | null;
  };
  gamma: {
    regime: "Positive" | "Negative" | "Flat" | "Unavailable";
    netGamma: number | null;
    flipDistancePercent: number | null;
    callWallDistancePercent: number | null;
    putWallDistancePercent: number | null;
    nearestLevel: "Call wall" | "Put wall" | "Gamma flip" | "Unavailable";
    nearestLevelDistancePercent: number | null;
  };
  volatility: {
    atmIvChange: number | null;
    riskReversalChange: number | null;
    butterflyChange: number | null;
  };
  event: {
    today: string[];
    nextSession: string[];
    isEventDay: boolean;
    isNextSessionEvent: boolean;
  };
  overnight: OvernightContext;
  unavailable: string[];
};

function latestAtOrBefore(series: DailyObservation[] | undefined, date: string) {
  if (!series?.length) return null;
  let result: DailyObservation | null = null;
  for (const row of series) {
    if (row.date > date) break;
    result = row;
  }
  return result;
}

function changeAtOrBefore(series: DailyObservation[] | undefined, date: string, periods: number) {
  if (!series?.length) return null;
  const rows = series.filter((row) => row.date <= date);
  if (rows.length <= periods) return null;
  const current = rows.at(-1)!.value;
  const prior = rows.at(-1 - periods)!.value;
  return prior === 0 ? null : (current / prior - 1) * 100;
}

function latestPositioning(readings: PositioningReading[], date: string) {
  const dates = [...new Set(readings.filter((row) => row.date <= date).map((row) => row.date))].sort();
  const currentDate = dates.at(-1);
  const previousDate = dates.at(-2);
  const current = new Map(
    readings.filter((row) => row.date === currentDate).map((row) => [row.feature, row.value]),
  );
  const previous = new Map(
    readings.filter((row) => row.date === previousDate).map((row) => [row.feature, row.value]),
  );
  const delta = (feature: string) => {
    const value = current.get(feature);
    const prior = previous.get(feature);
    return value !== undefined && prior !== undefined ? value - prior : null;
  };
  return { current, delta };
}

function nearestLevel(
  flipDistancePercent: number | null,
  callWallDistancePercent: number | null,
  putWallDistancePercent: number | null,
) {
  const levels = [
    { name: "Gamma flip" as const, value: flipDistancePercent },
    { name: "Call wall" as const, value: callWallDistancePercent },
    { name: "Put wall" as const, value: putWallDistancePercent },
  ].filter((row): row is { name: "Gamma flip" | "Call wall" | "Put wall"; value: number } =>
    row.value !== null && Number.isFinite(row.value),
  );
  if (!levels.length) return { name: "Unavailable" as const, value: null };
  return levels.reduce((best, row) =>
    Math.abs(row.value) < Math.abs(best.value) ? row : best,
  );
}

export function buildSessionContext(input: {
  asOf: string;
  nextSession: string;
  ndx: DailyObservation[];
  spx: DailyObservation[];
  vix?: DailyObservation[];
  positioning?: PositioningReading[];
  eventNames?: Map<string, string[]>;
  overnight?: OvernightContext;
}): SessionContext {
  const ndx = latestAtOrBefore(input.ndx, input.asOf);
  const ndxOneDay = changeAtOrBefore(input.ndx, input.asOf, 1);
  const spxOneDay = changeAtOrBefore(input.spx, input.asOf, 1);
  const ndxFiveDay = changeAtOrBefore(input.ndx, input.asOf, 5);
  const spxFiveDay = changeAtOrBefore(input.spx, input.asOf, 5);
  const relativeOneDay = ndxOneDay !== null && spxOneDay !== null ? ndxOneDay - spxOneDay : null;
  const relativeFiveDay = ndxFiveDay !== null && spxFiveDay !== null ? ndxFiveDay - spxFiveDay : null;
  const relativeLabel =
    relativeFiveDay === null
      ? "Unavailable"
      : relativeFiveDay > 0.15
        ? "NQ leading"
        : relativeFiveDay < -0.15
          ? "ES leading"
          : "Aligned";

  const { current, delta } = latestPositioning(input.positioning ?? [], input.asOf);
  const spot = current.get("spot") ?? ndx?.value ?? null;
  const frontIv = current.get("frontAtmIv") ?? null;
  const frontDte = current.get("frontDte") ?? null;
  const vix = latestAtOrBefore(input.vix, input.asOf)?.value ?? null;
  const impliedMovePercent =
    frontIv !== null && frontDte !== null && frontIv > 0
      ? frontIv * Math.sqrt(Math.max(frontDte, 1) / 365) * 100
      : vix !== null && vix > 0
        ? vix / Math.sqrt(252)
        : null;
  const impliedMoveSource =
    frontIv !== null && frontDte !== null && frontIv > 0
      ? "front ATM IV" as const
      : vix !== null && vix > 0
        ? "VIX fallback" as const
        : "Unavailable" as const;
  const flipDistancePercent = current.get("flipDistancePercent") ?? null;
  const callWallDistancePercent = current.get("callWallDistancePercent") ?? null;
  const putWallDistancePercent = current.get("putWallDistancePercent") ?? null;
  const nearest = nearestLevel(flipDistancePercent, callWallDistancePercent, putWallDistancePercent);
  const netGamma = current.get("netGamma") ?? null;
  const gammaRegime =
    netGamma === null ? "Unavailable" : netGamma > 0 ? "Positive" : netGamma < 0 ? "Negative" : "Flat";
  const todayEvents = input.eventNames?.get(input.asOf) ?? [];
  const nextEvents = input.eventNames?.get(input.nextSession) ?? [];
  const overnight = input.overnight ?? emptyOvernightContext(input.nextSession);

  return {
    asOf: input.asOf,
    nextSession: input.nextSession,
    relativeStrength: {
      oneDay: relativeOneDay,
      fiveDay: relativeFiveDay,
      label: relativeLabel,
      source: "NDX vs SPX index proxy",
    },
    impliedMove: {
      percent: impliedMovePercent,
      points: impliedMovePercent !== null && spot !== null ? spot * impliedMovePercent / 100 : null,
      source: impliedMoveSource,
      horizonDays: frontDte ?? (vix !== null ? 1 : null),
    },
    gamma: {
      regime: gammaRegime,
      netGamma,
      flipDistancePercent,
      callWallDistancePercent,
      putWallDistancePercent,
      nearestLevel: nearest.name,
      nearestLevelDistancePercent: nearest.value,
    },
    volatility: {
      atmIvChange: delta("frontAtmIv"),
      riskReversalChange: delta("frontRiskReversal25"),
      butterflyChange: delta("frontButterfly25"),
    },
    event: {
      today: todayEvents,
      nextSession: nextEvents,
      isEventDay: todayEvents.length > 0,
      isNextSessionEvent: nextEvents.length > 0,
    },
    overnight,
    unavailable: [
      ...(overnight.status === "unavailable" ? [overnight.note ?? "Overnight futures bars are unavailable."] : []),
      "First 15-minute range requires intraday bars; it is intentionally not collected yet.",
    ],
  };
}
