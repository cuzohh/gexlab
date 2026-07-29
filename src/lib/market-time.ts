const EASTERN_ZONE = "America/New_York";

function partsAt(date: Date, timeZone = EASTERN_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
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
  return parseEasternTimestamp(`${expiry} 16:00:00`);
}

export function isRegularMarketOpen(date = new Date()) {
  const parts = partsAt(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 9 * 60 + 30 && minute < 16 * 60;
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
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
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
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";

  if (isWeekend || minute < 9 * 60 + 30) {
    const date = previousWeekday(candidate);
    return parseEasternTimestamp(`${date} 16:00:00`);
  }
  if (minute >= 16 * 60) {
    return parseEasternTimestamp(`${easternDate(candidate)} 16:00:00`);
  }
  return candidate.toISOString();
}

export function latestCompletedTradingDate(date = new Date()) {
  const parts = partsAt(date);
  const weekday = parts.weekday;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (weekday !== "Sat" && weekday !== "Sun" && minute >= 16 * 60 + 20) {
    return easternDate(date);
  }
  return previousWeekday(date);
}
