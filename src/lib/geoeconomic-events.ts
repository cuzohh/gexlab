export type GeoeconomicChannel = "trade" | "technology" | "energy" | "fx" | "credit";
export type GeoeconomicStatus = "proposed" | "announced" | "effective" | "update";

export type OfficialGeoeconomicEvent = {
  id: string;
  source: "USTR" | "OFAC" | "BIS";
  sourceUrl: string;
  title: string;
  publishedAt: string | null;
  status: GeoeconomicStatus;
  channels: GeoeconomicChannel[];
  tags: string[];
};

const entities = new Map([
  ["china", "China"], ["russia", "Russia"], ["iran", "Iran"], ["ukraine", "Ukraine"],
  ["taiwan", "Taiwan"], ["mexico", "Mexico"], ["canada", "Canada"], ["european union", "EU"],
  ["europe", "Europe"], ["middle east", "Middle East"], ["venezuela", "Venezuela"],
]);

function clean(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|quot|#39|nbsp);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateFromText(value: string) {
  const matched = value.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i);
  if (!matched) return null;
  const date = new Date(`${matched[0]} 12:00:00 UTC`);
  return Number.isFinite(date.valueOf()) ? date.toISOString().slice(0, 10) : null;
}

/**
 * Uses the issuer's own listing pages rather than a third-party headline feed.
 * The pages are intentionally parsed conservatively: an uncertain date stays
 * null and a changed layout returns fewer events instead of invented metadata.
 */
export function parseOfficialEventListing(
  html: string,
  source: OfficialGeoeconomicEvent["source"],
  baseUrl: string,
): OfficialGeoeconomicEvent[] {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const unique = new Map<string, OfficialGeoeconomicEvent>();
  for (const match of links) {
    const href = match[1];
    const title = clean(match[2]);
    if (title.length < 20 || title.length > 260) continue;
    const lower = title.toLowerCase();
    const relevant = /tariff|trade|sanction|export|entity list|technology|semiconductor|supply chain|critical mineral|shipping|energy|oil|license/i.test(title);
    if (!relevant) continue;
    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const channels = new Set<GeoeconomicChannel>();
    if (/tariff|trade|shipping|supply chain|critical mineral/i.test(title)) channels.add("trade");
    if (/export|entity list|technology|semiconductor|license/i.test(title)) channels.add("technology");
    if (/energy|oil|petroleum|gas/i.test(title)) channels.add("energy");
    // A sanction can reach FX and funding, but this is an exposure flag—not an
    // assertion that either market has moved.
    if (/sanction|currency|capital/i.test(title)) { channels.add("fx"); channels.add("credit"); }
    const tags = [...entities.entries()]
      .filter(([needle]) => lower.includes(needle))
      .map(([, label]) => label);
    if (/semiconductor|technology|ai\b/i.test(lower)) tags.push("Technology");
    if (/critical mineral/i.test(lower)) tags.push("Critical minerals");
    const status: GeoeconomicStatus = /effective|impos(?:e|es|ed|ing)|final action|takes action/i.test(lower)
      ? "effective"
      : /proposed|seeks comment|hearing|investigation|review/i.test(lower)
        ? "proposed"
        : /announc|launch|initiat|new rule/i.test(lower) ? "announced" : "update";
    const nearby = html.slice(Math.max(0, match.index! - 220), Math.min(html.length, match.index! + match[0].length + 220));
    const event: OfficialGeoeconomicEvent = {
      id: `${source}:${sourceUrl}`,
      source,
      sourceUrl,
      title,
      publishedAt: dateFromText(nearby) ?? dateFromText(title),
      status,
      channels: channels.size ? [...channels] : ["trade"],
      tags: [...new Set(tags)].slice(0, 3),
    };
    unique.set(sourceUrl, event);
  }
  return [...unique.values()]
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""))
    .slice(0, 14);
}

export function summarizeChannels(events: OfficialGeoeconomicEvent[]) {
  return (["trade", "technology", "energy", "fx", "credit"] as GeoeconomicChannel[]).map((channel) => ({
    channel,
    events: events.filter((event) => event.channels.includes(channel)).length,
  }));
}
