import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";

export type CboeObservation = {
  date: string;
  pcRatio: number;
  skew?: number;
};

const METHODOLOGY_VERSION = "cboe-v1.0.0";
const CACHE_MS = 12 * 60 * 60 * 1000;

export function parseCboePcRatioCsv(csvText: string): CboeObservation[] {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results: CboeObservation[] = [];

  for (const line of lines) {
    if (/^date/i.test(line) || /^cboe/i.test(line)) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;

    const rawDate = parts[0].trim();
    const rawRatio = parts.length >= 5 ? parts[4].trim() : parts[1].trim();

    let date = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split("/");
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    } else continue;

    const pcRatio = Number(rawRatio);
    if (!Number.isFinite(pcRatio) || pcRatio <= 0) continue;

    results.push({ date, pcRatio });
  }

  return results.sort((left, right) => left.date.localeCompare(right.date));
}

export function parseCboeSkewCsv(csvText: string): Record<string, number> {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const skewMap: Record<string, number> = {};

  for (const line of lines) {
    if (/^date/i.test(line) || /^cboe/i.test(line)) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;

    const rawDate = parts[0].trim();
    const rawSkew = parts[1].trim();

    let date = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      date = rawDate;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawDate)) {
      const [m, d, y] = rawDate.split("/");
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    } else continue;

    const skew = Number(rawSkew);
    if (!Number.isFinite(skew) || skew <= 0) continue;

    skewMap[date] = skew;
  }

  return skewMap;
}

export async function loadCboeData(): Promise<CboeObservation[]> {
  const stored = getSnapshot<CboeObservation[]>("cboe-data", "daily-pc-skew");
  if (stored && snapshotIsFresh(stored)) {
    return stored.payload;
  }

  return dedupeRequest("cboe:daily", async () => {
    try {
      const pcRes = await fetch(
        "https://www.cboe.com/publish/scheduled_task/mktdata/data/total_pc.csv",
        { headers: { "User-Agent": "GEXLab-V3/1.0 (Research Engine; open-source)" } },
      );
      if (!pcRes.ok) throw new Error(`CBOE PC fetch failed with status ${pcRes.status}`);
      const pcText = await pcRes.text();
      const observations = parseCboePcRatioCsv(pcText);

      if (observations.length > 0) {
        putSnapshot({
          namespace: "cboe-data",
          key: "daily-pc-skew",
          payload: observations,
          sourceTime: observations.at(-1)?.date ?? null,
          fetchedAt: new Date().toISOString(),
          refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
          methodologyVersion: METHODOLOGY_VERSION,
        });
        return observations;
      }
    } catch {
      if (stored) return stored.payload;
    }
    return stored?.payload ?? [];
  });
}
