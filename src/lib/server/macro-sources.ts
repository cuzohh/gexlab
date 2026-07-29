import "server-only";

import { parseObservationCsv } from "@/lib/macro-math";
import { isZip, readZipEntries } from "@/lib/zip";
import { dedupeRequest } from "@/lib/server/request-deduper";
import {
  getSnapshot,
  loadLatestMacroObservations,
  putSnapshot,
  saveMacroObservations,
  snapshotIsFresh,
  type MacroObservation,
} from "@/lib/server/snapshot-store";

type SeriesStore = Record<string, MacroObservation[]>;

const BLS_SERIES = {
  CPIAUCSL: "CUSR0000SA0",
  CPILFESL: "CUSR0000SA0L1E",
  UNRATE: "LNS14000000",
  PAYEMS: "CES0000000001",
} as const;

const CHICAGO_SERIES = new Set(["NFCI", "ANFCI", "CFNAIMA3"]);
const NEW_YORK_FED_SERIES = new Set(["SOFR", "EFFR"]);
const SOURCE_VERSION = "macro-ingestion-v3.4.0";
const SERIES_REFRESH_MS = 20 * 60 * 60 * 1000;
// The mirror serves at most twelve series per request and answers with a ZIP
// of one CSV per frequency when a batch mixes them. Batching to that limit is
// the single largest reduction in outbound requests available here.
const BATCH_LIMIT = 12;

function monthDate(year: string, period: string) {
  const month = Number(period.slice(1));
  return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}-01` : null;
}

async function fetchBlsGroup(): Promise<SeriesStore> {
  const cached = getSnapshot<SeriesStore>("macro-provider", "bls-core");
  if (
    cached &&
    cached.methodologyVersion === SOURCE_VERSION &&
    snapshotIsFresh(cached)
  ) return cached.payload;

  return dedupeRequest("macro:bls-core", async () => {
    const currentYear = new Date().getUTCFullYear();
    try {
      type BlsPayload = {
        status?: string;
        Results?: {
          series?: Array<{
            seriesID?: string;
            data?: Array<{ year?: string; period?: string; value?: string }>;
          }>;
        };
      };
      const ranges = [
        [currentYear - 10, currentYear - 1],
        [currentYear, currentYear],
      ];
      const payloads: BlsPayload[] = [];
      for (const [startyear, endyear] of ranges) {
        const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seriesid: Object.values(BLS_SERIES),
            startyear: String(startyear),
            endyear: String(endyear),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Labor-data request returned ${response.status}`);
        const payload = (await response.json()) as BlsPayload;
        if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("Labor-data request failed.");
        payloads.push(payload);
      }
      const reverseIds = Object.fromEntries(
        Object.entries(BLS_SERIES).map(([target, source]) => [source, target]),
      );
      const result: SeriesStore = {};
      for (const payload of payloads) {
        for (const series of payload.Results?.series ?? []) {
          const target = reverseIds[String(series.seriesID)];
          if (!target) continue;
          result[target] ??= [];
          result[target].push(
            ...(series.data ?? []).flatMap((row) => {
              const date = row.year && row.period ? monthDate(row.year, row.period) : null;
              const value = Number(row.value);
              return date && Number.isFinite(value) ? [{ date, value }] : [];
            }),
          );
        }
      }
      for (const [target, observations] of Object.entries(result)) {
        result[target] = observations.sort((left, right) => left.date.localeCompare(right.date));
        saveMacroObservations(target, result[target], "BLS");
      }
      if (Object.keys(result).length !== Object.keys(BLS_SERIES).length) {
        throw new Error("One or more labor series were missing.");
      }
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-provider",
        key: "bls-core",
        payload: result,
        fetchedAt,
        sourceTime: fetchedAt,
        refreshAfter: new Date(Date.now() + SERIES_REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return result;
    } catch (error) {
      if (cached?.methodologyVersion === SOURCE_VERSION) return cached.payload;
      throw error;
    }
  });
}

function parseUsDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

async function fetchChicagoGroup(): Promise<SeriesStore> {
  const cached = getSnapshot<SeriesStore>("macro-provider", "chicago-indexes");
  if (cached?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) {
    return cached.payload;
  }

  return dedupeRequest("macro:chicago-indexes", async () => {
    try {
      const [nfciResponse, cfnaiResponse] = await Promise.all([
        fetch("https://www.chicagofed.org/~/media/publications/nfci/nfci-data-series-csv.csv", {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }),
        fetch("https://www.chicagofed.org/~/media/publications/cfnai/cfnai-data-series-csv.csv", {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }),
      ]);
      if (!nfciResponse.ok || !cfnaiResponse.ok) throw new Error("Financial-conditions data failed.");
      const nfciLines = (await nfciResponse.text()).trim().split(/\r?\n/);
      const cfnaiLines = (await cfnaiResponse.text()).trim().split(/\r?\n/);
      const result: SeriesStore = { NFCI: [], ANFCI: [], CFNAIMA3: [] };

      for (const line of nfciLines.slice(1)) {
        const [rawDate, nfci, anfci] = line.split(",");
        const date = parseUsDate(rawDate);
        if (!date) continue;
        const nfciValue = Number(nfci);
        const anfciValue = Number(anfci);
        if (Number.isFinite(nfciValue)) result.NFCI.push({ date, value: nfciValue });
        if (Number.isFinite(anfciValue)) result.ANFCI.push({ date, value: anfciValue });
      }
      for (const line of cfnaiLines.slice(1)) {
        const cells = line.split(",");
        const date = cells[0]?.match(/^(\d{4})\/(\d{2})$/);
        const value = Number(cells[6]);
        if (date && Number.isFinite(value)) {
          result.CFNAIMA3.push({ date: `${date[1]}-${date[2]}-01`, value });
        }
      }
      for (const [seriesId, observations] of Object.entries(result)) {
        saveMacroObservations(seriesId, observations, "Chicago Fed");
      }
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-provider",
        key: "chicago-indexes",
        payload: result,
        sourceTime: fetchedAt,
        fetchedAt,
        refreshAfter: new Date(Date.now() + SERIES_REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return result;
    } catch (error) {
      if (cached?.methodologyVersion === SOURCE_VERSION) return cached.payload;
      throw error;
    }
  });
}

async function fetchReferenceRates(): Promise<SeriesStore> {
  const cached = getSnapshot<SeriesStore>("macro-provider", "reference-rates");
  if (cached?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) {
    return cached.payload;
  }

  return dedupeRequest("macro:reference-rates", async () => {
    try {
      const startDate = `${new Date().getUTCFullYear() - 10}-01-01`;
      const endDate = new Date().toISOString().slice(0, 10);
      const urls = {
        SOFR: `https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate=${startDate}&endDate=${endDate}&type=rate`,
        EFFR: `https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=${startDate}&endDate=${endDate}&type=rate`,
      };
      const result: SeriesStore = {};
      for (const [seriesId, url] of Object.entries(urls)) {
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`${seriesId} request returned ${response.status}`);
        const payload = (await response.json()) as {
          refRates?: Array<{ effectiveDate?: string; percentRate?: number }>;
        };
        result[seriesId] = (payload.refRates ?? [])
          .flatMap((row) =>
            row.effectiveDate && Number.isFinite(row.percentRate)
              ? [{ date: row.effectiveDate, value: Number(row.percentRate) }]
              : [],
          )
          .sort((left, right) => left.date.localeCompare(right.date));
        if (!result[seriesId].length) throw new Error(`${seriesId} returned no observations.`);
        saveMacroObservations(seriesId, result[seriesId], "New York Fed");
      }
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-provider",
        key: "reference-rates",
        payload: result,
        sourceTime: result.SOFR.at(-1)?.date ?? null,
        fetchedAt,
        refreshAfter: new Date(Date.now() + SERIES_REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return result;
    } catch (error) {
      if (cached?.methodologyVersion === SOURCE_VERSION) return cached.payload;
      throw error;
    }
  });
}

async function fetchFallbackSeries(seriesId: string): Promise<MacroObservation[]> {
  const cached = getSnapshot<MacroObservation[]>("macro-series", seriesId);
  if (cached?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) {
    return cached.payload;
  }

  return dedupeRequest(`macro:series:${seriesId}`, async () => {
    try {
      const response = await fetch(
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) throw new Error(`${seriesId} request returned ${response.status}`);
      const observations = parseObservationCsv(await response.text(), seriesId);
      if (!observations.length) throw new Error(`${seriesId} returned no observations.`);
      saveMacroObservations(seriesId, observations, "Economic release mirror");
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-series",
        key: seriesId,
        payload: observations,
        sourceTime: observations.at(-1)?.date ?? null,
        fetchedAt,
        refreshAfter: new Date(Date.now() + SERIES_REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return observations;
    } catch (error) {
      if (cached?.methodologyVersion === SOURCE_VERSION) return cached.payload;
      const persisted = loadLatestMacroObservations(seriesId);
      if (persisted.length) return persisted;
      throw error;
    }
  });
}

/**
 * Merges two copies of one series, keeping the preferred copy wherever both
 * carry the same observation date.
 */
function mergePreferring(base: MacroObservation[], preferred: MacroObservation[]) {
  const merged = new Map(base.map((row) => [row.date, row.value]));
  for (const row of preferred) merged.set(row.date, row.value);
  return [...merged.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function chunk<T>(values: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Fetches one batch of series in a single request and splits the response
 * back out per series. A batch whose members share a frequency arrives as one
 * CSV; a mixed batch arrives as a ZIP holding one CSV per frequency, so every
 * returned table is searched for each requested column.
 */
async function fetchFredBatch(ids: readonly string[]): Promise<SeriesStore> {
  const key = `fred-batch:${ids.join(",")}`;
  const cached = getSnapshot<SeriesStore>("macro-provider", key);
  if (cached?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(cached)) {
    return cached.payload;
  }

  return dedupeRequest(`macro:${key}`, async () => {
    try {
      const response = await fetch(
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.map(encodeURIComponent).join(",")}`,
        { cache: "no-store", signal: AbortSignal.timeout(45_000) },
      );
      if (!response.ok) throw new Error(`Economic-series batch returned ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const tables = isZip(buffer)
        ? readZipEntries(buffer)
            .filter((entry) => entry.name.toLowerCase().endsWith(".csv"))
            .map((entry) => entry.text)
        : [buffer.toString("utf8")];

      const result: SeriesStore = {};
      for (const seriesId of ids) {
        for (const table of tables) {
          let observations: MacroObservation[] = [];
          try {
            observations = parseObservationCsv(table, seriesId);
          } catch {
            // The column belongs to one of the other tables in the archive.
            continue;
          }
          if (observations.length) {
            result[seriesId] = observations;
            saveMacroObservations(seriesId, observations, "Economic release mirror");
            break;
          }
        }
      }
      if (!Object.keys(result).length) throw new Error("The series batch returned no observations.");
      const fetchedAt = new Date().toISOString();
      putSnapshot({
        namespace: "macro-provider",
        key,
        payload: result,
        sourceTime: fetchedAt,
        fetchedAt,
        refreshAfter: new Date(Date.now() + SERIES_REFRESH_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return result;
    } catch (error) {
      if (cached?.methodologyVersion === SOURCE_VERSION) return cached.payload;
      throw error;
    }
  });
}

/**
 * Loads every series the dashboard needs, preferring each publisher's own
 * endpoint where one exists and batching the rest.
 */
export async function loadMacroSeriesStore(ids: readonly string[]) {
  const blsIds = ids.filter((id) => id in BLS_SERIES);
  const newYorkIds = ids.filter((id) => NEW_YORK_FED_SERIES.has(id));
  // Every series is requested from the mirror, including the ones a publisher
  // serves directly, because the mirror carries the deep history the panel
  // needs and the publisher copy is layered on top of it below.
  const batches = chunk(ids, BATCH_LIMIT);

  const [blsGroup, newYorkGroup, chicagoGroup, ...batchResults] = await Promise.allSettled([
    blsIds.length ? fetchBlsGroup() : Promise.resolve({} as SeriesStore),
    newYorkIds.length ? fetchReferenceRates() : Promise.resolve({} as SeriesStore),
    ids.some((id) => CHICAGO_SERIES.has(id)) ? fetchChicagoGroup() : Promise.resolve({} as SeriesStore),
    ...batches.map((batch) => fetchFredBatch(batch)),
  ]);

  const store: SeriesStore = {};
  const settled = (result: PromiseSettledResult<SeriesStore>) =>
    result.status === "fulfilled" ? result.value : {};
  Object.assign(store, ...batchResults.map(settled));

  // The Chicago Fed publishes its own indexes days before the mirror carries
  // them, so a fresh direct copy wins and a stale one defers to the batch.
  const chicago = settled(chicagoGroup);
  for (const [seriesId, observations] of Object.entries(chicago)) {
    if (!observations.length) continue;
    const allowedLagDays = seriesId === "CFNAIMA3" ? 60 : 14;
    const ageDays = (Date.now() - Date.parse(`${observations.at(-1)!.date}T12:00:00Z`)) / 86_400_000;
    const mirrored = store[seriesId];
    if (ageDays <= allowedLagDays || !mirrored?.length) store[seriesId] = observations;
  }
  // The publisher APIs only serve the last ten years. Their observations are
  // authoritative where they overlap, but the mirror's older rows are kept so
  // the monthly panel can reach further back than a decade.
  for (const group of [settled(blsGroup), settled(newYorkGroup)]) {
    for (const [seriesId, observations] of Object.entries(group)) {
      if (!observations.length) continue;
      store[seriesId] = mergePreferring(store[seriesId] ?? [], observations);
    }
  }

  const unavailable = ids.filter((id) => !store[id]?.length);
  return { store, unavailable };
}

export async function loadMacroSeries(seriesId: string): Promise<MacroObservation[]> {
  if (seriesId in BLS_SERIES) return (await fetchBlsGroup())[seriesId] ?? [];
  if (NEW_YORK_FED_SERIES.has(seriesId)) return (await fetchReferenceRates())[seriesId] ?? [];
  if (CHICAGO_SERIES.has(seriesId)) {
    const direct = (await fetchChicagoGroup())[seriesId] ?? [];
    const latestDate = direct.at(-1)?.date;
    const allowedLag = seriesId === "CFNAIMA3" ? 60 : 14;
    const age = latestDate
      ? (Date.now() - Date.parse(`${latestDate}T12:00:00Z`)) / 86_400_000
      : Number.POSITIVE_INFINITY;
    return age <= allowedLag ? direct : fetchFallbackSeries(seriesId);
  }
  return fetchFallbackSeries(seriesId);
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await task(values[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
