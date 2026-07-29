import { parseEasternTimestamp } from "./market-time.ts";

export type FomcMeeting = {
  start: string;
  end: string;
  year: number;
  label: string;
  projections: boolean;
  unscheduled: boolean;
};

export type ReleaseItem = {
  source: string;
  title: string;
  publishedAt: string;
  link: string;
};

export type ScheduledRelease = {
  source: "BLS" | "BEA";
  title: string;
  startsAt: string;
  importance: "major" | "standard";
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function iso(year: number, month: number, day: number) {
  if (!month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function decode(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses the Federal Reserve's published FOMC calendar.
 *
 * This is the one genuinely forward-looking schedule available without an
 * account: the page carries the current and the following year's meeting
 * dates. A meeting can straddle a month boundary, in which case the page
 * prints "April/May" against "29-30", so the month list and the day list are
 * zipped rather than assumed to share a single month.
 */
export function parseFomcCalendar(html: string): FomcMeeting[] {
  const meetings: FomcMeeting[] = [];
  const panels = [
    ...html.matchAll(
      /<a id="\d+">(\d{4}) FOMC Meetings<\/a>([\s\S]*?)(?=<a id="\d+">\d{4} FOMC Meetings<\/a>|$)/g,
    ),
  ];
  for (const [, yearText, body] of panels) {
    const year = Number(yearText);
    if (!Number.isFinite(year)) continue;
    const rows = [
      ...body.matchAll(
        /fomc-meeting__month[^>]*>([\s\S]*?)<\/div>[\s\S]*?fomc-meeting__date[^>]*>([\s\S]*?)<\/div>/g,
      ),
    ];
    for (const [, monthCell, dateCell] of rows) {
      const monthText = decode(monthCell);
      const dateText = decode(dateCell);
      // A trailing asterisk marks a meeting with a Summary of Economic
      // Projections, which is the one that matters most for front-expiry
      // volatility. Unscheduled entries are kept but flagged.
      const projections = dateText.includes("*");
      const unscheduled = /unscheduled|notation|cancel/i.test(`${dateText} ${monthText}`);
      const months = monthText
        .split("/")
        .map((part) => MONTHS[part.trim().toLowerCase()])
        .filter((value): value is number => Boolean(value));
      const days = dateText
        .replace(/[*()]/g, "")
        .split("-")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 31);
      if (!months.length || !days.length) continue;
      const start = iso(year, months[0], days[0]);
      const end = iso(year, months.at(-1) ?? months[0], days.at(-1) ?? days[0]);
      if (!start || !end) continue;
      meetings.push({
        start,
        end,
        year,
        label: `${monthText} ${dateText}`.replace(/\s+/g, " ").trim(),
        projections,
        unscheduled,
      });
    }
  }
  return meetings.sort((left, right) => left.start.localeCompare(right.start));
}

export type PublishedRelease = {
  date: string;
  title: string;
  reference: string | null;
};

/**
 * Parses one year of the BLS release schedule as published at
 * bls.gov/schedule/<year>/home.htm.
 *
 * The forward-looking iCalendar feed only carries the current year, so this
 * page is the only account-free source of the dates on which past releases
 * actually landed. Those dates are what make it possible to measure how the
 * market behaved around a release instead of guessing the day from the
 * reference month.
 *
 * Holidays appear in the same table with an empty time cell and no reference
 * period; they are dropped because they are not releases.
 */
export function parseBlsAnnualSchedule(html: string): PublishedRelease[] {
  const releases: PublishedRelease[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1];
    const dateText = decode(/<td[^>]*class="date-cell"[^>]*>([\s\S]*?)<\/td>/i.exec(body)?.[1] ?? "");
    const timeText = decode(/<td[^>]*class="time-cell"[^>]*>([\s\S]*?)<\/td>/i.exec(body)?.[1] ?? "");
    const descCell = /<td[^>]*class="desc-cell"[^>]*>([\s\S]*?)<\/td>/i.exec(body)?.[1] ?? "";
    if (!dateText || !descCell) continue;
    if (!/^\d{1,2}:\d{2}\s*[AP]M$/i.test(timeText)) continue;

    const title = decode(/<strong>([\s\S]*?)<\/strong>/i.exec(descCell)?.[1] ?? "");
    const rest = decode(descCell.replace(/<strong>[\s\S]*?<\/strong>/i, ""));
    const parsed = /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(dateText);
    const month = parsed ? MONTHS[parsed[1].toLowerCase()] : null;
    if (!parsed || !month || !title) continue;
    const date = iso(Number(parsed[3]), month, Number(parsed[2]));
    if (!date) continue;
    releases.push({
      date,
      title,
      reference: /^for\s+(.+)$/i.exec(rest)?.[1]?.trim() ?? null,
    });
  }
  return releases.sort((left, right) => left.date.localeCompare(right.date));
}

export function parseRssItems(xml: string, source: string): ReleaseItem[] {
  // Feeds differ in the details: BEA opens items as <item name="...">, the
  // Federal Reserve wraps values in CDATA, and each publisher picks its own
  // date element. All three are handled rather than assuming one shape.
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)]
    .map((match) => {
      const body = match[1];
      const field = (name: string) =>
        new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(body)?.[1] ?? "";
      const title = decode(field("title"));
      const stamp =
        field("pubDate") || field("dc:date") || field("date") || field("published");
      const parsed = Date.parse(decode(stamp));
      if (!title || !Number.isFinite(parsed)) return null;
      const link = field("link");
      return {
        source,
        title,
        publishedAt: new Date(parsed).toISOString(),
        link: decode(link),
      };
    })
    .filter((item): item is ReleaseItem => item !== null);
}

const MAJOR_RELEASE =
  /consumer price index|employment situation|producer price index|job openings|employment cost index|gross domestic product|gdp\b|personal income and outlays|international trade in goods and services/i;

function releaseImportance(title: string): ScheduledRelease["importance"] {
  return MAJOR_RELEASE.test(title) ? "major" : "standard";
}

/**
 * Parses BLS's public iCalendar subscription. Times in the feed are explicitly
 * US Eastern; converting them here gives the client a real instant that it can
 * render in the user's local timezone.
 */
export function parseBlsCalendar(ics: string): ScheduledRelease[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)]
    .map((match) => {
      const body = match[1];
      const stamp =
        /DTSTART(?:;TZID=(?:US-Eastern|America\/New_York))?:(\d{8})T(\d{6})/i.exec(body);
      const title = decode(/(?:^|\r?\n)SUMMARY:(.*)/i.exec(body)?.[1] ?? "")
        .replace(/\\,/g, ",")
        .replace(/\\n/gi, " ");
      if (!stamp || !title) return null;
      const [, day, time] = stamp;
      const startsAt = parseEasternTimestamp(
        `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ` +
          `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
      );
      if (!startsAt) return null;
      return {
        source: "BLS" as const,
        title,
        startsAt,
        importance: releaseImportance(title),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

/**
 * Parses the table published at bea.gov/news/schedule. BEA exposes the
 * schedule as ordinary HTML rather than requiring an API account.
 */
export function parseBeaSchedule(html: string): ScheduledRelease[] {
  const year = Number(/<th[^>]*>\s*Year\s+(\d{4})\s*<\/th>/i.exec(html)?.[1]);
  if (!Number.isFinite(year)) return [];
  const events: ScheduledRelease[] = [];
  for (const match of html.matchAll(/<tr class="scheduled-releases-type-[^"]+">([\s\S]*?)<\/tr>/gi)) {
    const body = match[1];
    const dateText = decode(
      /<div class="release-date">([\s\S]*?)<\/div>/i.exec(body)?.[1] ?? "",
    );
    const timeText = decode(
      /<small class="text-muted">([\s\S]*?)<\/small>/i.exec(body)?.[1] ?? "",
    );
    const title = decode(
      /<td class="release-title[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(body)?.[1] ?? "",
    );
    const date = /^([A-Za-z]+)\s+(\d{1,2})$/.exec(dateText);
    const time = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(timeText);
    const month = date ? MONTHS[date[1].toLowerCase()] : null;
    if (!date || !time || !month || !title) continue;
    const hour12 = Number(time[1]);
    const hour = (hour12 % 12) + (time[3].toUpperCase() === "PM" ? 12 : 0);
    const startsAt = parseEasternTimestamp(
      `${iso(year, month, Number(date[2]))} ${String(hour).padStart(2, "0")}:${time[2]}:00`,
    );
    if (!startsAt) continue;
    events.push({
      source: "BEA",
      title,
      startsAt,
      importance: releaseImportance(title),
    });
  }
  return events.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
