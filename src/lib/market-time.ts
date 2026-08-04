import {
  isEarlyClose,
  isUsMarketHoliday,
  marketCalendarCoverage,
  marketCloseMinutes,
  MARKET_CALENDAR_VERSION,
} from "./market-calendar.ts";

const EASTERN_ZONE = "America/New_York";

/**
 * Formatters are cached per zone because constructing one is expensive and this
 * module builds them in the hottest loop the server has.
 *
 * Every option contract's settlement instant goes through parseEasternTimestamp,
 * which calls this three times to converge on the right side of a daylight
 * saving boundary. At one formatter per call that was three constructions per
 * contract: on a 15,800-contract NDX chain, roughly 47,000 of them, and it
 * measured at 4.6 seconds of a 5.2 second request. A formatter is immutable
 * and depends only on its zone, so one per zone is all that is ever needed.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

function partsAt(date: Date, timeZone = EASTERN_ZONE) {
  const parts = formatterFor(timeZone).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function easternDate(date = new Date()) {
  const parts = partsAt(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseEasternTimestamp(value: string | undefined) {
  if (!value) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const desiredUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  // Iterate because Eastern's UTC offset changes with daylight saving time.
  let candidate = desiredUtc;
  for (let index = 0; index < 3; index += 1) {
    const rendered = partsAt(new Date(candidate));
    const renderedUtc = Date.UTC(
      Number(rendered.year),
      Number(rendered.month) - 1,
      Number(rendered.day),
      Number(rendered.hour),
      Number(rendered.minute),
      Number(rendered.second),
    );
    candidate += desiredUtc - renderedUtc;
  }
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function parseUtcTimestamp(value: string | undefined) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const timezoneDeclared = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(timezoneDeclared ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function easternCloseIso(expiry: string) {
  const minutes = marketCloseMinutes(expiry);
  return parseEasternTimestamp(
    `${expiry} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`,
  );
}

export function isRegularMarketOpen(date = new Date()) {
  const parts = partsAt(date);
  const day = easternDate(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun" || isUsMarketHoliday(day)) return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 9 * 60 + 30 && minute < marketCloseMinutes(day);
}

export function nextQuarterHour(date = new Date(), bufferSeconds = 20) {
  const next = new Date(date);
  next.setUTCSeconds(bufferSeconds, 0);
  const minute = next.getUTCMinutes();
  next.setUTCMinutes(minute - (minute % 15) + 15);
  return next;
}

export function previousWeekday(date = new Date()) {
  const cursor = new Date(`${easternDate(date)}T12:00:00Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6 || isUsMarketHoliday(cursor.toISOString().slice(0, 10)));
  return cursor.toISOString().slice(0, 10);
}

/** The next full trading session after a date, skipping weekends and holidays. */
export function nextWeekday(date: string) {
  const cursor = new Date(`${date}T12:00:00Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (
    cursor.getUTCDay() === 0 ||
    cursor.getUTCDay() === 6 ||
    isUsMarketHoliday(cursor.toISOString().slice(0, 10))
  );
  return cursor.toISOString().slice(0, 10);
}

export function latestMarketObservationTime(
  generatedAt: string,
  delayMinutes = 15,
) {
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(generated)) return null;
  const candidate = new Date(generated - delayMinutes * 60 * 1000);
  const parts = partsAt(candidate);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const candidateDate = easternDate(candidate);
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";

  if (isWeekend || isUsMarketHoliday(candidateDate) || minute < 9 * 60 + 30) {
    const date = previousWeekday(candidate);
    return easternCloseIso(date);
  }
  if (minute >= marketCloseMinutes(candidateDate)) {
    return easternCloseIso(candidateDate);
  }
  return candidate.toISOString();
}

/**
 * How many sessions an observation is behind the most recent completed one.
 *
 * FRED republishes an equity index close on the next business day, so on any
 * weekday evening the freshest reading available is the previous session. That
 * reads as a stale fetch unless it is stated, which is what this is for: zero
 * means the data is as current as the source can be, not that it is live.
 *
 * Counted in trading sessions, including the full-day US market holidays this
 * module uses to identify the next cash session.
 */
export function sessionsBehind(observationDate: string | null, date = new Date()) {
  if (!observationDate) return null;
  const latest = latestCompletedTradingDate(date);
  if (observationDate >= latest) return 0;
  const cursor = new Date(`${observationDate}T12:00:00Z`);
  const target = Date.parse(`${latest}T12:00:00Z`);
  if (!Number.isFinite(cursor.valueOf()) || !Number.isFinite(target)) return null;
  let sessions = 0;
  while (cursor.valueOf() < target && sessions < 400) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    const candidate = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !isUsMarketHoliday(candidate)) sessions += 1;
  }
  return sessions;
}

/**
 * The caption for a lag. One session behind is this source working correctly,
 * not failing, and the wording has to separate the two: a bare date invites
 * reading a healthy feed as broken. Anything further behind is said plainly,
 * because by then the reading really does describe an older market.
 */
export function describeSessionLag(sessions: number | null) {
  if (sessions === null) return "Public daily observations";
  if (sessions === 0) return "Latest published session";
  if (sessions === 1) return "One session behind · index closes publish next day";
  return `${sessions} sessions behind · index closes publish next day`;
}

export function latestCompletedTradingDate(date = new Date()) {
  const parts = partsAt(date);
  const currentDate = easternDate(date);
  const weekday = parts.weekday;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (
    weekday !== "Sat" &&
    weekday !== "Sun" &&
    !isUsMarketHoliday(currentDate) &&
    minute >= marketCloseMinutes(currentDate) + 20
  ) {
    return currentDate;
  }
  return previousWeekday(date);
}

export {
  isEarlyClose,
  isUsMarketHoliday,
  MARKET_CALENDAR_VERSION,
  marketCalendarCoverage,
  marketCloseMinutes,
};
