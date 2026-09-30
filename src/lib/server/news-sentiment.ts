import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";
import {
  parseGdeltTimeline,
  summarizeNewsTimeline,
  type NewsTimelineSummary,
} from "@/lib/news-sentiment";

const SOURCE_VERSION = "news-gdelt-v1.0.0";
const CACHE_MS = 6 * 60 * 60 * 1000;
const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const USER_AGENT = "GEXLab/3.0 (self-hosted macro research; low-volume cached fetch)";

const TOPICS = [
  { id: "rates", label: "Rates & policy", query: '("Federal Reserve" OR inflation OR "Treasury yield" OR "interest rates")' },
  { id: "growth", label: "Growth & earnings", query: '(earnings OR recession OR employment OR "economic growth")' },
  { id: "geopolitics", label: "Geopolitics", query: '(war OR sanctions OR tariff OR "trade war" OR conflict OR geopolitics)' },
  { id: "technology", label: "Technology", query: '(AI OR semiconductor OR "big tech" OR technology)' },
] as const;

const GLOBAL_QUERY = '("stock market" OR Nasdaq OR "Federal Reserve" OR inflation OR recession OR rates OR tariffs OR geopolitics)';

export type NewsSentimentTopic = {
  id: string;
  label: string;
  tone: NewsTimelineSummary;
};

export type NewsSentiment = {
  source: "GDELT DOC 2.0";
  retrievedAt: string;
  asOf: string | null;
  stale: boolean;
  tone: NewsTimelineSummary;
  attention: NewsTimelineSummary;
  topics: NewsSentimentTopic[];
  query: string;
  method: string;
  caveat: string;
};

async function fetchTimeline(query: string, mode: "timelinetone" | "timelinevolinfo") {
  const params = new URLSearchParams({
    query,
    mode,
    format: "json",
    timespan: "30d",
    timelinesmooth: "3",
  });
  const response = await fetch(`${GDELT_URL}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GDELT ${mode} returned ${response.status}`);
  return parseGdeltTimeline(await response.json());
}

async function collectNewsSentiment(): Promise<Omit<NewsSentiment, "stale">> {
  const [tonePoints, attentionPoints, ...topicPoints] = await Promise.all([
    fetchTimeline(GLOBAL_QUERY, "timelinetone").catch(() => []),
    fetchTimeline(GLOBAL_QUERY, "timelinevolinfo").catch(() => []),
    ...TOPICS.map((topic) => fetchTimeline(topic.query, "timelinetone").catch(() => [])),
  ]);
  if (!tonePoints.length && !attentionPoints.length) throw new Error("GDELT returned no usable global news timeline.");
  const topics = TOPICS.map((topic, index) => ({
    id: topic.id,
    label: topic.label,
    tone: summarizeNewsTimeline(topicPoints[index] ?? []),
  })).filter((topic) => topic.tone.asOf !== null);
  const tone = summarizeNewsTimeline(tonePoints);
  const attention = summarizeNewsTimeline(attentionPoints);
  return {
    source: "GDELT DOC 2.0",
    retrievedAt: new Date().toISOString(),
    asOf: tone.asOf ?? attention.asOf,
    tone,
    attention,
    topics,
    query: GLOBAL_QUERY,
    method:
      "GDELT's global document timeline, using average article tone and matched-coverage share over a rolling 30-day window. Current windows are 24 hours, 72 hours, and 7 days; the baseline is the prior twenty daily observations.",
    caveat:
      "News tone is general article language, not a finance-trained return forecast. Coverage can repeat the same story across outlets, and attention reflects what is being written about as well as what is happening. It is contextual until validated against future market outcomes.",
  };
}

export async function loadNewsSentiment(): Promise<NewsSentiment> {
  const stored = getSnapshot<Omit<NewsSentiment, "stale">>("news", "gdelt-global");
  if (stored && stored.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) {
    return { ...stored.payload, stale: false };
  }
  return dedupeRequest("news:gdelt-global", async () => {
    try {
      const payload = await collectNewsSentiment();
      putSnapshot({
        namespace: "news",
        key: "gdelt-global",
        payload,
        sourceTime: payload.asOf,
        fetchedAt: payload.retrievedAt,
        refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return { ...payload, stale: false };
    } catch (error) {
      if (stored) return { ...stored.payload, stale: true };
      throw error;
    }
  });
}
