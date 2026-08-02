import "server-only";

import { buildOvernightContext, parseYahooChartPayload, type OvernightContext } from "@/lib/overnight-context";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, loadOvernightCoverage, putSnapshot, saveOvernightSession, snapshotIsFresh } from "@/lib/server/snapshot-store";

const SOURCE_VERSION = "yahoo-overnight-v1";
const REFRESH_MS = 5 * 60 * 1000;

async function fetchBars(symbol: "NQ=F" | "ES=F") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&events=history`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Yahoo futures request returned ${response.status}`);
  return parseYahooChartPayload(await response.json());
}

export async function loadYahooOvernightContext(input: {
  sessionDate: string;
  priorSessionDate: string;
}): Promise<OvernightContext> {
  const key = `${input.priorSessionDate}:${input.sessionDate}`;
  const cached = getSnapshot<OvernightContext>("futures-overnight", key);
  if (cached && cached.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) return cached.payload;

  return dedupeRequest(`futures-overnight:${key}`, async () => {
    const refreshed = getSnapshot<OvernightContext>("futures-overnight", key);
    if (refreshed && refreshed.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(refreshed)) return refreshed.payload;

    try {
      const [nq, es] = await Promise.all([fetchBars("NQ=F"), fetchBars("ES=F")]);
      const basePayload = buildOvernightContext({
        sessionDate: input.sessionDate,
        priorSessionDate: input.priorSessionDate,
        nq,
        es,
      });
      if (basePayload.status !== "unavailable") {
        saveOvernightSession({
          sessionDate: basePayload.sessionDate,
          payload: basePayload,
          sourceTime: basePayload.observedThrough,
        });
      }
      const coverage = loadOvernightCoverage();
      const payload = {
        ...basePayload,
        history: { ...coverage, required: 30 },
      };
      putSnapshot({
        namespace: "futures-overnight",
        key,
        payload,
        sourceTime: payload.observedThrough,
        refreshAfter: new Date(Date.now() + REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return payload;
    } catch (error) {
      const basePayload = buildOvernightContext({
        sessionDate: input.sessionDate,
        priorSessionDate: input.priorSessionDate,
        nq: [],
        es: [],
        note: error instanceof Error ? `Yahoo futures unavailable: ${error.message}` : "Yahoo futures unavailable.",
      });
      const coverage = loadOvernightCoverage();
      const payload = {
        ...basePayload,
        history: { ...coverage, required: 30 },
      };
      putSnapshot({
        namespace: "futures-overnight",
        key,
        payload,
        refreshAfter: new Date(Date.now() + REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return payload;
    }
  });
}
