import "server-only";

import {
  parseOfficialEventListing,
  summarizeChannels,
  type OfficialGeoeconomicEvent,
} from "@/lib/geoeconomic-events";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

const SOURCE_VERSION = "geoeconomic-events-v1.0.0";
const CACHE_MS = 6 * 60 * 60 * 1000;
const USER_AGENT = "GEXLab/3.0 (self-hosted market research; low-volume cached fetch)";

const SOURCES: Array<{ source: OfficialGeoeconomicEvent["source"]; url: string }> = [
  { source: "USTR", url: "https://ustr.gov/about-us/policy-offices/press-office/press-releases" },
  { source: "OFAC", url: "https://ofac.treasury.gov/recent-actions" },
  { source: "BIS", url: "https://www.bis.gov/news-updates/all-press-releases" },
];

export type GeoeconomicEventFeed = {
  events: OfficialGeoeconomicEvent[];
  channels: ReturnType<typeof summarizeChannels>;
  retrievedAt: string;
  stale: boolean;
  sources: { source: OfficialGeoeconomicEvent["source"]; available: boolean }[];
  method: string;
  caveat: string;
};

async function fetchListing(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function collect(): Promise<Omit<GeoeconomicEventFeed, "stale">> {
  const events: OfficialGeoeconomicEvent[] = [];
  const sources: GeoeconomicEventFeed["sources"] = [];
  // Do not burst three government sites at once. This path runs only on a
  // cold/expired cache, and the one-second spacing is respectful while still
  // making a manual refresh usable.
  for (const entry of SOURCES) {
    try {
      events.push(...parseOfficialEventListing(await fetchListing(entry.url), entry.source, entry.url));
      sources.push({ source: entry.source, available: true });
    } catch {
      sources.push({ source: entry.source, available: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const deduped = [...new Map(events.map((event) => [event.id, event])).values()]
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""))
    .slice(0, 18);
  if (!deduped.length) throw new Error("No official geoeconomic listings produced usable events.");
  return {
    events: deduped,
    channels: summarizeChannels(deduped),
    retrievedAt: new Date().toISOString(),
    sources,
    method: "Recent items are collected from the USTR, OFAC, and BIS official listing pages. Channel tags are deterministic title-based classifications used to organize review, not estimates of market impact.",
    caveat: "A listing can omit legal effective dates or implementation detail. Open the primary source before acting, and use the transmission checks to distinguish a policy event from an observed market shock.",
  };
}

export async function loadGeoeconomicEvents(): Promise<GeoeconomicEventFeed> {
  const stored = getSnapshot<Omit<GeoeconomicEventFeed, "stale">>("geoeconomic", "official-event-ledger");
  if (stored && stored.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) {
    return { ...stored.payload, stale: false };
  }
  return dedupeRequest("geoeconomic:official-event-ledger", async () => {
    try {
      const payload = await collect();
      putSnapshot({
        namespace: "geoeconomic",
        key: "official-event-ledger",
        payload,
        sourceTime: payload.events.find((event) => event.publishedAt)?.publishedAt ?? null,
        fetchedAt: payload.retrievedAt,
        refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return { ...payload, stale: false };
    } catch {
      if (stored) return { ...stored.payload, stale: true };
      throw new Error("Official geoeconomic event sources are unavailable.");
    }
  });
}
