import "server-only";

import { getSnapshot, loadSnapshotSeries, putSnapshot } from "@/lib/server/snapshot-store";

/**
 * The dated record of what the street expected, and how that expectation moved.
 *
 * The level of a price target says almost nothing on its own: targets are
 * anchored to the price and revised slowly, so the gap between target and price
 * widens mechanically whenever a stock falls. A name that has just broken is
 * therefore guaranteed to screen as having enormous upside, whether the
 * business is intact or not.
 *
 * What separates the two is the direction the estimates are moving. Price
 * falling while the earnings estimate holds is the market repricing a business
 * it still believes in; price falling while the estimate is cut is the market
 * marking down the business itself, and the target has not caught up yet.
 *
 * Only five numbers are kept per ticker per day — roughly a hundred bytes,
 * against the tens of kilobytes the whole consensus payload occupies — because
 * this series is only useful if it is allowed to run for months.
 */
export type EstimateObservation = {
  /** Average 12-month price target. */
  target: number | null;
  /** Contributing analysts. A count that collapses is its own warning. */
  analysts: number | null;
  /** Consensus earnings per share for the nearest forecast year. */
  eps: number | null;
  /** Consensus revenue for the same year. */
  revenue: number | null;
  /** Which fiscal year the two figures above belong to. */
  year: string | null;
};

const NAMESPACE = "estimate-history";
const VERSION = "estimate-history-v1";
/** Roughly six months of sessions: enough for a quarterly comparison to exist. */
const RETAIN = 130;

/** The Eastern calendar day an observation belongs to. */
function sessionDay(when: string) {
  return when.slice(0, 10);
}

/**
 * Record today's observation, once.
 *
 * Keyed to the calendar day rather than the request: a revision is a change in
 * a published estimate, not the difference between two reads a minute apart, so
 * a second call on the same day must not create a second point.
 */
export function recordEstimateObservation(symbol: string, observation: EstimateObservation) {
  const observedAt = new Date().toISOString();
  putSnapshot({
    namespace: NAMESPACE,
    key: symbol.toUpperCase(),
    payload: observation,
    sourceTime: `${sessionDay(observedAt)}T00:00:00.000Z`,
    fetchedAt: observedAt,
    refreshAfter: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    methodologyVersion: VERSION,
  });
}

export type EstimateTrend = {
  /** Observations held for this ticker, newest first. */
  points: { date: string; observation: EstimateObservation }[];
  /** Change over each window, or null while the history is too short to say. */
  windows: {
    label: string;
    days: number;
    comparedTo: string | null;
    targetChange: number | null;
    targetPercent: number | null;
    epsChange: number | null;
    epsPercent: number | null;
    analystChange: number | null;
  }[];
  /** The oldest observation held, so the interface can say how long it has been watching. */
  since: string | null;
};

const WINDOWS = [
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
];

/** Percentage change, guarding the zero and negative denominators. */
function percentChange(now: number | null, then: number | null) {
  if (now === null || then === null || !(Math.abs(then) > 0)) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/**
 * How the published estimates have moved over each window.
 *
 * The comparison point is the newest observation at least `days` old, not the
 * observation nearest that date: an estimate revised three days ago and then
 * left alone should read as revised, and interpolating toward the closest point
 * would blur exactly the step this series exists to catch.
 */
export function loadEstimateTrend(symbol: string): EstimateTrend {
  const rows = loadSnapshotSeries<EstimateObservation>(NAMESPACE, symbol.toUpperCase(), 260, 0);
  const points = rows
    .map((row) => ({ date: sessionDay(row.sourceTime ?? row.fetchedAt), observation: row.payload }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const latest = points[0] ?? null;

  const windows = WINDOWS.map(({ label, days }) => {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const prior = points.find((point) => point.date <= cutoff) ?? null;
    if (!latest || !prior) {
      return { label, days, comparedTo: null, targetChange: null, targetPercent: null, epsChange: null, epsPercent: null, analystChange: null };
    }
    const now = latest.observation;
    const then = prior.observation;
    return {
      label,
      days,
      comparedTo: prior.date,
      targetChange: now.target !== null && then.target !== null ? now.target - then.target : null,
      targetPercent: percentChange(now.target, then.target),
      // Only comparable when both readings describe the same fiscal year: a
      // rolled-forward consensus is a different number, not a revision.
      epsChange: now.year && now.year === then.year && now.eps !== null && then.eps !== null ? now.eps - then.eps : null,
      epsPercent: now.year && now.year === then.year ? percentChange(now.eps, then.eps) : null,
      analystChange: now.analysts !== null && then.analysts !== null ? now.analysts - then.analysts : null,
    };
  });

  return { points, windows, since: points.at(-1)?.date ?? null };
}

/** The newest stored observation without touching the network, for the watchlist table. */
export function peekEstimateObservation(symbol: string) {
  const stored = getSnapshot<EstimateObservation>(NAMESPACE, symbol.toUpperCase());
  return stored?.methodologyVersion === VERSION ? stored.payload : null;
}

export const ESTIMATE_HISTORY_NAMESPACE = NAMESPACE;
export const ESTIMATE_HISTORY_RETAIN_SESSIONS = RETAIN;
