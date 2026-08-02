/**
 * Versioned full-day and early-close calendar for the U.S. options session
 * used by the Cboe delayed-chain feed. The dates are copied from the exchange
 * schedules rather than generated from a holiday formula, because observed
 * dates and early closes are exchange policy, not calendar trivia.
 *
 * Sources:
 * - https://www.cboe.com/about/hours/us-options
 * - https://www.nyse.com/trade/hours-calendars
 *
 * Update this table when the exchange publishes the next schedule. Unknown
 * years deliberately fall back to a normal 9:30–16:00 weekday session; callers
 * can inspect the version to know which years are covered.
 */

export const MARKET_CALENDAR_VERSION = "cboe-us-options-2026-2028-v1";

type YearCalendar = {
  closed: readonly string[];
  earlyClose: readonly string[];
};

const CALENDAR: Record<number, YearCalendar> = {
  2026: {
    closed: [
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ],
    earlyClose: ["2026-11-27", "2026-12-24"],
  },
  2027: {
    closed: [
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-11-25",
      "2027-12-24",
    ],
    earlyClose: ["2027-11-26"],
  },
  2028: {
    closed: [
      "2028-01-17",
      "2028-02-21",
      "2028-04-14",
      "2028-05-29",
      "2028-06-19",
      "2028-07-04",
      "2028-09-04",
      "2028-11-23",
      "2028-12-25",
    ],
    earlyClose: ["2028-07-03", "2028-11-24"],
  },
};

const CLOSED = new Set(Object.values(CALENDAR).flatMap((year) => year.closed));
const EARLY_CLOSE = new Set(Object.values(CALENDAR).flatMap((year) => year.earlyClose));

export function isUsMarketHoliday(date: string) {
  return CLOSED.has(date);
}

export function isEarlyClose(date: string) {
  return EARLY_CLOSE.has(date);
}

export function marketCloseMinutes(date: string) {
  return isEarlyClose(date) ? 13 * 60 : 16 * 60;
}

export function marketCalendarCoverage() {
  return Object.keys(CALENDAR).map(Number);
}
