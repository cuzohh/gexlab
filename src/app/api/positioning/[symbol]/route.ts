import { NextRequest, NextResponse } from "next/server";
import { loadIntradayObservations } from "@/lib/server/snapshot-store";

export const runtime = "nodejs";

const SYMBOLS = ["NDX", "SPX", "QQQ", "SPY"] as const;
type Symbol = (typeof SYMBOLS)[number];

const METHODOLOGY_VERSION = "positioning-history-v1.0.0";

/**
 * The features worth plotting, in the order they are read.
 *
 * The log carries sixteen; most are inputs to the forecast models rather than
 * things to look at. These four describe where the book sits relative to price,
 * which is the question the chart exists to answer over time.
 */
const SERIES = [
  "netGamma",
  "flipDistancePercent",
  "callWallDistancePercent",
  "putWallDistancePercent",
] as const;

export type PositioningObservation = {
  time: string;
  sessionDate: string;
  spot: number | null;
  netGamma: number | null;
  flipDistancePercent: number | null;
  callWallDistancePercent: number | null;
  putWallDistancePercent: number | null;
  frontAtmIv: number | null;
};

function value(values: Record<string, number>, key: string) {
  const found = values[key];
  return Number.isFinite(found) ? found : null;
}

/**
 * The recorded positioning history for one book.
 *
 * This is a separate route rather than another field on the option-chain
 * response because it answers a different question on a different clock: the
 * chain describes the book now and runs to about a megabyte, while this is a
 * few hundred numbers describing how the book got here. Bundling them would
 * make every chain request carry the history and every history request
 * recompute the chain.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol: requested } = await context.params;
  const symbol = requested.toUpperCase() as Symbol;
  if (!SYMBOLS.includes(symbol)) {
    return NextResponse.json(
      { error: `Supported books are ${SYMBOLS.join(", ")}.` },
      { status: 404 },
    );
  }

  try {
    const limitParameter = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParameter) && limitParameter > 0
      ? Math.min(limitParameter, 2000)
      : 400;

    // Oldest first, which is the order the chart draws in.
    const recorded = loadIntradayObservations(symbol);
    const observations: PositioningObservation[] = recorded
      .slice(-limit)
      .map((row) => ({
        time: row.sourceTime,
        sessionDate: row.observationDate,
        spot: value(row.values, "spot"),
        netGamma: value(row.values, "netGamma"),
        flipDistancePercent: value(row.values, "flipDistancePercent"),
        callWallDistancePercent: value(row.values, "callWallDistancePercent"),
        putWallDistancePercent: value(row.values, "putWallDistancePercent"),
        frontAtmIv: value(row.values, "frontAtmIv"),
      }));

    const sessions = new Set(observations.map((row) => row.sessionDate));
    // Whether any single session holds more than one reading. Until the chain
    // is polled during market hours every session contributes exactly one
    // end-of-day row, and calling that an intraday tape would misdescribe it.
    const perSession = new Map<string, number>();
    for (const row of observations) {
      perSession.set(row.sessionDate, (perSession.get(row.sessionDate) ?? 0) + 1);
    }
    const deepestSession = Math.max(0, ...perSession.values());

    return NextResponse.json({
      source: "Recorded option positioning",
      symbol,
      methodologyVersion: METHODOLOGY_VERSION,
      series: SERIES,
      observations,
      sessions: sessions.size,
      observationCount: observations.length,
      /** More than one reading inside a single session anywhere in the record. */
      intraday: deepestSession > 1,
      deepestSession,
      note:
        "Recorded from this installation's own snapshots. No public archive carries a past " +
        "option chain, so this history cannot be backfilled: it covers the sessions that were " +
        "actually captured, and grows denser when the chain is polled during market hours.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to read the positioning history.",
        source: "Recorded option positioning",
      },
      { status: 502 },
    );
  }
}
