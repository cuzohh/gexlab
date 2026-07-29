import "server-only";

import {
  parseBeaSchedule,
  parseBlsAnnualSchedule,
  parseBlsCalendar,
  parseFomcCalendar,
  parseRssItems,
  type FomcMeeting,
  type PublishedRelease,
  type ReleaseItem,
  type ScheduledRelease,
} from "@/lib/event-parsing";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

const SOURCE_VERSION = "event-ingestion-v3.8.0";
// Identify the client honestly. These hosts serve the pages below to any user
// agent, so there is no reason to impersonate a browser.
const USER_AGENT = "GEXLab/3.0 (self-hosted market analytics; low-volume daily fetch)";

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "application/rss+xml, text/calendar;q=0.95, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.7",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function cached<T>(
  key: string,
  refreshHours: number,
  load: () => Promise<T>,
): Promise<T | null> {
  const stored = getSnapshot<T>("events", key);
  if (stored && stored.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) {
    return stored.payload;
  }
  return dedupeRequest(`events:${key}`, async () => {
    try {
      const payload = await load();
      putSnapshot({
        namespace: "events",
        key,
        payload,
        sourceTime: new Date().toISOString(),
        refreshAfter: new Date(Date.now() + refreshHours * 60 * 60 * 1000).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return payload;
    } catch {
      // A failed refresh falls back to the last good copy. When there is none,
      // null is returned and the caller reports the calendar as unavailable
      // rather than inventing a schedule.
      return stored ? stored.payload : null;
    }
  });
}

export async function loadFomcMeetings() {
  return cached<FomcMeeting[]>("fomc-calendar", 24, async () => {
    const html = await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
    const meetings = parseFomcCalendar(html);
    if (!meetings.length) throw new Error("The FOMC calendar page produced no meetings.");
    return meetings;
  });
}

export async function loadRecentReleases() {
  return cached<ReleaseItem[]>("official-releases", 6, async () => {
    // BEA links this RSS endpoint from its official developer resources. Keep
    // retrieval infrequent and identifiable rather than impersonating a
    // browser; the shared cache below limits it to one refresh per six hours.
    const feeds: Array<[string, string]> = [
      ["Bureau of Economic Analysis", "https://apps.bea.gov/rss/rss.xml"],
      ["Census Bureau", "https://www.census.gov/economic-indicators/indicator.xml"],
      ["Federal Reserve", "https://www.federalreserve.gov/feeds/press_monetary.xml"],
    ];
    // Fetch one at a time rather than creating a burst.
    const items: ReleaseItem[] = [];
    for (const [source, url] of feeds) {
      try {
        items.push(...parseRssItems(await fetchText(url), source));
      } catch {
        // A single unreachable feed must not discard the others.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!items.length) throw new Error("No official release feed responded.");
    return items
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, 40);
  });
}

/**
 * Collects the dates on which past BLS releases were published, one year per
 * request. These pages do not change once the year is over, so they are
 * cached for a month and only the current year is refetched with any
 * regularity.
 */
export async function loadPublishedReleaseDates(years: number[]) {
  const collected: PublishedRelease[] = [];
  const currentYear = new Date().getUTCFullYear();
  let fetched = 0;
  for (const year of years) {
    const key = `bls-schedule-${year}`;
    const stored = getSnapshot<PublishedRelease[]>("events", key);
    const isFresh =
      stored && stored.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored);
    if (isFresh) {
      collected.push(...stored.payload);
      continue;
    }
    // A completed year is immutable, so it is only ever fetched once; the
    // current year is refreshed weekly. At most two years are pulled per
    // request so a cold start spreads across refreshes instead of hitting the
    // publisher eleven times at once.
    if (fetched >= 2) {
      if (stored?.payload.length) collected.push(...stored.payload);
      continue;
    }
    fetched += 1;
    const rows = await cached<PublishedRelease[]>(
      key,
      year < currentYear ? 24 * 365 : 24 * 7,
      async () => {
        const html = await fetchText(`https://www.bls.gov/schedule/${year}/home.htm`);
        const parsed = parseBlsAnnualSchedule(html);
        if (!parsed.length) throw new Error(`The ${year} release schedule produced no entries.`);
        return parsed;
      },
    );
    if (rows?.length) collected.push(...rows);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return collected.sort((left, right) => left.date.localeCompare(right.date));
}

export async function loadScheduledReleases() {
  return cached<ScheduledRelease[]>("economic-calendar", 12, async () => {
    const sources = [
      {
        url: "https://www.bls.gov/schedule/news_release/bls.ics",
        parse: parseBlsCalendar,
      },
      {
        url: "https://www.bea.gov/news/schedule",
        parse: parseBeaSchedule,
      },
    ];
    const events: ScheduledRelease[] = [];
    for (const source of sources) {
      try {
        events.push(...source.parse(await fetchText(source.url)));
      } catch {
        // The other official calendar remains useful if one publisher is down.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!events.length) throw new Error("No official economic calendar responded.");
    return events.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  });
}
