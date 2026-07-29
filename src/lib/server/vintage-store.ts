import "server-only";

import { parseObservationCsv } from "@/lib/macro-math";
import { dedupeRequest } from "@/lib/server/request-deduper";
import {
  getSnapshot,
  loadVintageObservations,
  putSnapshot,
  saveVintageObservations,
  type MacroObservation,
} from "@/lib/server/snapshot-store";

/**
 * Series the monthly growth-and-inflation classification reads. Only these
 * need an as-published copy: the other pillars are current-read only and are
 * never replayed against history.
 */
export const VINTAGE_SERIES = [
  "CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS",
  "ICSA", "INDPRO", "GDPC1", "CORESTICKM159SFRBATL", "PCETRIM12M159SFRBDAL",
] as const;

export const VINTAGE_SOURCE = "ALFRED point-in-time";
const VINTAGE_START_YEAR = 2012;
// One vintage per quarter. Scoring a month reads the newest vintage at or
// before it, so a coarser grid only ever makes a reading more stale — never
// forward-looking — while cutting the backfill to a few hundred requests.
const VINTAGE_MONTHS = [2, 5, 8, 11];
const HISTORY_YEARS = 3;
const REQUEST_SPACING_MS = 700;

export type VintageProgress = {
  completed: string[];
  failed: string[];
  updatedAt: string;
};

function progressKey(seriesId: string) {
  return `coverage:${seriesId}`;
}

function readProgress(seriesId: string): VintageProgress {
  const stored = getSnapshot<VintageProgress>("macro-vintage", progressKey(seriesId));
  return stored?.payload ?? { completed: [], failed: [], updatedAt: new Date(0).toISOString() };
}

function writeProgress(seriesId: string, progress: VintageProgress) {
  putSnapshot({
    namespace: "macro-vintage",
    key: progressKey(seriesId),
    payload: progress,
    sourceTime: progress.updatedAt,
    // Progress is a ledger rather than a cache, so it never expires on its own.
    refreshAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    methodologyVersion: VINTAGE_SOURCE,
  });
}

export function vintageGrid(today = new Date().toISOString().slice(0, 10)): string[] {
  const dates: string[] = [];
  const finalYear = Number(today.slice(0, 4));
  for (let year = VINTAGE_START_YEAR; year <= finalYear; year += 1) {
    for (const month of VINTAGE_MONTHS) {
      const date = `${year}-${String(month).padStart(2, "0")}-15`;
      if (date < today) dates.push(date);
    }
  }
  return dates;
}

async function fetchVintage(seriesId: string, vintage: string): Promise<MacroObservation[]> {
  const start = `${Number(vintage.slice(0, 4)) - HISTORY_YEARS}${vintage.slice(4)}`;
  const url =
    `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${encodeURIComponent(seriesId)}` +
    `&vintage_date=${vintage}&cosd=${start}&coed=${vintage}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "GEXLab/3.0 (self-hosted market analytics; slow historical backfill)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${seriesId} vintage ${vintage} returned ${response.status}`);
  const csv = await response.text();
  // The archive names the column with the vintage appended to the series id.
  const header = csv.split(/\r?\n/, 1)[0] ?? "";
  const column = header
    .split(",")
    .map((cell) => cell.trim())
    .find((cell) => cell === seriesId || cell.startsWith(`${seriesId}_`));
  if (!column) throw new Error(`${seriesId} vintage ${vintage} had no data column.`);
  return parseObservationCsv(csv, column);
}

/**
 * Fills in a small number of missing as-published copies per call.
 *
 * The archive only serves one vintage per request, so a complete backfill is
 * several hundred requests. Spreading them a handful at a time across normal
 * refreshes keeps the load negligible and lets the point-in-time panel
 * improve on its own instead of demanding one large burst.
 */
export async function backfillVintages(limit = 6) {
  return dedupeRequest("macro:vintage-backfill", async () => {
    const grid = vintageGrid();
    const pending: Array<{ seriesId: string; vintage: string }> = [];
    const progressBySeries = new Map<string, VintageProgress>();

    for (const seriesId of VINTAGE_SERIES) {
      const progress = readProgress(seriesId);
      progressBySeries.set(seriesId, progress);
      const done = new Set([...progress.completed, ...progress.failed]);
      for (const vintage of grid) {
        if (!done.has(vintage)) pending.push({ seriesId, vintage });
      }
    }
    // Newest first: recent vintages affect the months a reader is most likely
    // to look at, and they arrive before the deep history fills in.
    pending.sort((left, right) => right.vintage.localeCompare(left.vintage));

    let written = 0;
    let attempted = 0;
    for (const task of pending.slice(0, limit)) {
      const progress = progressBySeries.get(task.seriesId)!;
      attempted += 1;
      try {
        const observations = await fetchVintage(task.seriesId, task.vintage);
        if (observations.length) {
          written += saveVintageObservations(
            task.seriesId,
            observations,
            VINTAGE_SOURCE,
            task.vintage,
          );
          progress.completed.push(task.vintage);
        } else {
          // A series that did not exist yet at that vintage is recorded as
          // attempted so the backfill does not retry it forever.
          progress.failed.push(task.vintage);
        }
      } catch {
        progress.failed.push(task.vintage);
      }
      progress.updatedAt = new Date().toISOString();
      writeProgress(task.seriesId, progress);
      await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
    }

    return { attempted, written, remaining: Math.max(pending.length - attempted, 0) };
  });
}

export type VintagePanel = {
  /** Vintage date to the series store known at that date. */
  byVintage: Map<string, Record<string, MacroObservation[]>>;
  vintages: string[];
  seriesCoverage: Record<string, number>;
};

/** Groups every stored as-published observation into one store per vintage. */
export function loadVintagePanel(): VintagePanel {
  const rows = loadVintageObservations([...VINTAGE_SERIES], VINTAGE_SOURCE);
  const byVintage = new Map<string, Record<string, MacroObservation[]>>();
  const seriesCoverage: Record<string, number> = {};
  const seenVintages = new Map<string, Set<string>>();

  for (const row of rows) {
    const store = byVintage.get(row.vintage) ?? {};
    (store[row.seriesId] ??= []).push({ date: row.date, value: row.value });
    byVintage.set(row.vintage, store);
    const seen = seenVintages.get(row.seriesId) ?? new Set<string>();
    seen.add(row.vintage);
    seenVintages.set(row.seriesId, seen);
  }
  for (const [seriesId, vintages] of seenVintages) seriesCoverage[seriesId] = vintages.size;

  return {
    byVintage,
    vintages: [...byVintage.keys()].sort(),
    seriesCoverage,
  };
}

/**
 * The store as it stood at a date: the newest vintage at or before it, with
 * every series it covers. Returns null when the panel does not reach back
 * that far, so the caller can fall back to revised data and say so.
 */
export function vintageStoreAt(panel: VintagePanel, date: string) {
  let chosen: string | null = null;
  for (const vintage of panel.vintages) {
    if (vintage <= date) chosen = vintage;
    else break;
  }
  if (!chosen) return null;
  const store = panel.byVintage.get(chosen);
  if (!store) return null;
  // A vintage that is missing most series would quietly score against
  // defaults, which is worse than admitting the gap.
  const covered = VINTAGE_SERIES.filter((seriesId) => store[seriesId]?.length).length;
  if (covered < VINTAGE_SERIES.length - 2) return null;
  return { vintage: chosen, store };
}
