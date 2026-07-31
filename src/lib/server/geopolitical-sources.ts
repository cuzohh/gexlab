/**
 * Geopolitical risk, from Caldara and Iacoviello's published indices.
 *
 * These count the share of newspaper articles discussing adverse geopolitical
 * events, against the same papers' total output, which is why the level is
 * comparable across decades rather than tracking how much news there is. The
 * daily series is the reason to carry them: almost nothing else describing this
 * kind of stress updates faster than monthly, and a monthly reading is a
 * postmortem rather than an input.
 *
 * Two properties make them worth more than a headline count. The index splits
 * into threats and acts, and those behave differently — markets price
 * anticipation, so a threat series rising while acts stay flat is a different
 * environment from the reverse. And the monthly file resolves the index into 44
 * countries, which answers what a single number cannot: where the risk is.
 *
 * Published only as legacy Excel workbooks. There is no CSV or JSON, which is
 * checked rather than assumed — the .xlsx and .csv paths both 404. That is the
 * whole reason this project carries a spreadsheet parser.
 *
 * Source: https://www.matteoiacoviello.com/gpr.htm
 */

import * as XLSX from "xlsx";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "./snapshot-store.ts";

const DAILY_URL = "https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls";
const MONTHLY_URL = "https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls";
const METHODOLOGY_VERSION = "geopolitical-v1.0.0";
// The daily file gains one row a day and the monthly one gains a row a month,
// so a refresh either side of a session is generous. These are multi-megabyte
// workbooks served off a personal academic site; asking for them more often
// than the data can change would be rude and would buy nothing.
const DAILY_CACHE_MS = 12 * 60 * 60 * 1000;
const MONTHLY_CACHE_MS = 24 * 60 * 60 * 1000;

export type GeopoliticalObservation = { date: string; value: number };

export type GeopoliticalRisk = {
  /** Headline daily index. */
  daily: GeopoliticalObservation[];
  /** Realized adverse events. */
  acts: GeopoliticalObservation[];
  /** Anticipated ones, which is the half markets tend to price. */
  threats: GeopoliticalObservation[];
  /** The publisher's own 30-day average, carried rather than recomputed. */
  average30: GeopoliticalObservation[];
  asOf: string | null;
  /** Monthly index resolved by country, most elevated first. */
  countries: { code: string; value: number; date: string }[];
  countriesAsOf: string | null;
};

/** Excel stores a date as days since 1899-12-30. */
function fromExcelSerial(serial: number) {
  if (!Number.isFinite(serial)) return null;
  const parsed = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString().slice(0, 10) : null;
}

/** The daily sheet keys its rows as YYYYMMDD, held as a string. */
function fromCompactDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

async function fetchWorkbook(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": "GEXLab/3 (macro research; contact via site)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Geopolitical risk request failed: ${response.status}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  // Guard the parser rather than trusting the content type: an error page
  // served with a 200 would otherwise reach the spreadsheet reader.
  if (buffer.length < 1024) throw new Error("Geopolitical risk workbook was too small to be data.");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Geopolitical risk workbook held no sheet.");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
}

function columnIndex(header: unknown[], name: string) {
  return header.findIndex((cell) => String(cell ?? "").trim().toUpperCase() === name);
}

function readSeries(rows: unknown[][], header: unknown[], name: string): GeopoliticalObservation[] {
  const dayColumn = columnIndex(header, "DAY");
  const column = columnIndex(header, name);
  if (dayColumn < 0 || column < 0) return [];
  const series: GeopoliticalObservation[] = [];
  for (const row of rows) {
    const date = fromCompactDate(row[dayColumn]);
    const value = Number(row[column]);
    if (date && Number.isFinite(value)) series.push({ date, value });
  }
  return series;
}

async function loadDaily() {
  const rows = await fetchWorkbook(DAILY_URL);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return {
    daily: readSeries(body, header, "GPRD"),
    acts: readSeries(body, header, "GPRD_ACT"),
    threats: readSeries(body, header, "GPRD_THREAT"),
    average30: readSeries(body, header, "GPRD_MA30"),
  };
}

async function loadCountries() {
  const rows = await fetchWorkbook(MONTHLY_URL);
  const header = rows[0] ?? [];
  const monthColumn = columnIndex(header, "MONTH");
  const last = rows.at(-1);
  if (monthColumn < 0 || !last) return { countries: [], countriesAsOf: null };
  const date = fromExcelSerial(Number(last[monthColumn]));
  const countries: { code: string; value: number; date: string }[] = [];
  header.forEach((cell, index) => {
    const name = String(cell ?? "").trim().toUpperCase();
    if (!name.startsWith("GPRC_")) return;
    const value = Number(last[index]);
    if (!date || !Number.isFinite(value)) return;
    countries.push({ code: name.slice(5), value, date });
  });
  countries.sort((left, right) => right.value - left.value);
  return { countries, countriesAsOf: date };
}

/**
 * Cached read of both workbooks.
 *
 * They are cached and served independently, so a monthly file that fails to
 * parse cannot cost the daily index that the regime work actually reads. On a
 * failed refresh the stored copy is returned rather than nothing: a slightly
 * old geopolitical index is worth more than a blank panel, and its own asOf
 * date states how old it is.
 */
export async function loadGeopoliticalRisk(): Promise<GeopoliticalRisk> {
  const storedDaily = getSnapshot<Awaited<ReturnType<typeof loadDaily>>>("geopolitical", "gpr-daily");
  let daily = storedDaily && snapshotIsFresh(storedDaily) ? storedDaily.payload : null;
  if (!daily) {
    try {
      daily = await loadDaily();
      putSnapshot({
        namespace: "geopolitical",
        key: "gpr-daily",
        payload: daily,
        sourceTime: daily.daily.at(-1)?.date ?? null,
        fetchedAt: new Date().toISOString(),
        refreshAfter: new Date(Date.now() + DAILY_CACHE_MS).toISOString(),
        methodologyVersion: METHODOLOGY_VERSION,
      });
    } catch (error) {
      if (!storedDaily) throw error;
      daily = storedDaily.payload;
    }
  }

  const storedMonthly = getSnapshot<Awaited<ReturnType<typeof loadCountries>>>(
    "geopolitical",
    "gpr-countries",
  );
  let monthly = storedMonthly && snapshotIsFresh(storedMonthly) ? storedMonthly.payload : null;
  if (!monthly) {
    try {
      monthly = await loadCountries();
      putSnapshot({
        namespace: "geopolitical",
        key: "gpr-countries",
        payload: monthly,
        sourceTime: monthly.countriesAsOf,
        fetchedAt: new Date().toISOString(),
        refreshAfter: new Date(Date.now() + MONTHLY_CACHE_MS).toISOString(),
        methodologyVersion: METHODOLOGY_VERSION,
      });
    } catch {
      // The country breakdown is detail. Losing it must not cost the index.
      monthly = storedMonthly?.payload ?? { countries: [], countriesAsOf: null };
    }
  }

  return {
    ...daily,
    asOf: daily.daily.at(-1)?.date ?? null,
    countries: monthly.countries,
    countriesAsOf: monthly.countriesAsOf,
  };
}
