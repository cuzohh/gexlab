/**
 * Advances the index series past the publication calendar.
 *
 * FRED republishes an equity index close on the next business day. The close
 * itself is already in this database well before that, captured from the
 * exchange by the options workspace at snapshot time, so anything scored off
 * FRED alone runs a session behind for no reason but the wire. Reading the
 * snapshot is not forecasting and not a second opinion on a published number:
 * it is the same session, earlier.
 *
 * This matters most before the opening bell, which is exactly when a
 * next-session read is worth having. Without it the engine spends the entire
 * overnight window forecasting a session that has already traded.
 *
 * Shared by the macro and engine routes rather than copied into each. Two
 * versions of a rule this load-bearing would drift, and the last time this
 * codebase kept two copies of one function only one of them was ever tested.
 */

import { easternDate, latestCompletedTradingDate } from "../market-time.ts";
import { getSnapshot } from "./snapshot-store.ts";

export type IndexObservation = { date: string; value: number };

export type NowcastResult = {
  series: IndexObservation[];
  provisional: IndexObservation | null;
};

/**
 * Three guards, because a provisional close is only worth having if it cannot
 * be wrong: the snapshot must be for a date after the last published one, that
 * date's session must have finished, and the price must be a positive number.
 * A partial intraday print can never enter as a close.
 */
export function nowcastIndexSession(
  series: IndexObservation[] | undefined,
  symbol: "NDX" | "SPX",
): NowcastResult {
  const published = series?.at(-1);
  if (!series || !published) return { series: series ?? [], provisional: null };
  const stored = getSnapshot<{ data?: { current_price?: unknown } }>(
    "options-raw",
    `${symbol}:eod:market-asof`,
  );
  if (!stored?.sourceTime) return { series, provisional: null };
  const date = easternDate(new Date(stored.sourceTime));
  if (date <= published.date) return { series, provisional: null };
  if (date > latestCompletedTradingDate()) return { series, provisional: null };
  const price = Number(stored.payload?.data?.current_price);
  if (!Number.isFinite(price) || price <= 0) return { series, provisional: null };
  return {
    series: [...series, { date, value: price }],
    provisional: { date, value: price },
  };
}

/**
 * Advances both index series together, or neither.
 *
 * The direction score and most of the engine's features blend the two, so
 * moving one without the other would print a divergence that did not happen.
 */
export function nowcastIndexPair<T extends { NASDAQ100?: IndexObservation[]; SP500?: IndexObservation[] }>(
  store: T,
): { store: T; provisional: { date: string; ndx: number; spx: number } | null } {
  const ndx = nowcastIndexSession(store.NASDAQ100, "NDX");
  const spx = nowcastIndexSession(store.SP500, "SPX");
  if (!ndx.provisional || !spx.provisional || ndx.provisional.date !== spx.provisional.date) {
    return { store, provisional: null };
  }
  return {
    store: { ...store, NASDAQ100: ndx.series, SP500: spx.series },
    provisional: {
      date: ndx.provisional.date,
      ndx: ndx.provisional.value,
      spx: spx.provisional.value,
    },
  };
}
