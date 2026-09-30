import "server-only";

import { dedupeRequest } from "@/lib/server/request-deduper";
import { secRequestHeaders } from "@/lib/server/sec-request";
import { getSnapshot, putSnapshot, snapshotIsFresh } from "@/lib/server/snapshot-store";
import { loadStockFundamentals } from "@/lib/server/sec-companyfacts";
import { findIssuer } from "@/lib/server/sec-tickers";
import { inflateRawSync } from "node:zlib";

// v5 added per-holder percent of company and stopped persisting a filings scope
// whose insider fetch failed. v8 restricts the 13F archive to the quarter it
// actually reports and to one filing per manager, excludes principal-amount
// rows from share totals, and detects the value scale per filer. Every
// institutional figure changes as a result, so older snapshots must not be read.
const SOURCE_VERSION = "sec-ownership-finra-v8";
const CACHE_MS = 12 * 60 * 60 * 1000;

type Submissions = { name?: string; filings?: { recent?: Record<string, Array<string | null>> } };
type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };
// The parser knows shares but not shares outstanding, so per-holder percentages
// are attached later, alongside the aggregate ownership percentage.
type ParsedInstitutional = Omit<InstitutionalSnapshot, "ownershipPercent" | "previousReportedValue" | "changePercent" | "topHolders"> & {
  datasetUrl: string;
  topHolders: { manager: string; value: number; shares: number }[];
};

export type InsiderTransaction = {
  date: string | null;
  filed: string;
  owner: string;
  title: string | null;
  code: string | null;
  side: "buy" | "sell" | "other";
  shares: number | null;
  price: number | null;
  value: number | null;
  sharesAfter: number | null;
  url: string;
};

export type InstitutionalSnapshot = {
  asOf: string | null;
  filed: string | null;
  managers: number;
  reportedValue: number | null;
  reportedShares: number | null;
  ownershipPercent: number | null;
  previousReportedValue: number | null;
  changePercent: number | null;
  /** `percent` is the holder's shares as a share of the company, null when
      shares outstanding is unavailable. */
  topHolders: { manager: string; value: number; shares: number; percent: number | null }[];
  source: string;
  sourceUrl: string;
};

export type ShortInterest = {
  settlementDate: string | null;
  symbol: string;
  current: number | null;
  previous: number | null;
  changePercent: number | null;
  averageDailyVolume: number | null;
  daysToCover: number | null;
  source: string;
  sourceUrl: string;
};

export type ShortSaleVolume = {
  tradeDate: string | null;
  shortVolume: number | null;
  shortExemptVolume: number | null;
  totalVolume: number | null;
  ratio: number | null;
  source: string;
  sourceUrl: string;
};

export type StockOwnershipData = {
  symbol: string;
  insiders: InsiderTransaction[];
  institutional: InstitutionalSnapshot | null;
  shortInterest: ShortInterest | null;
  shortSaleVolume: ShortSaleVolume | null;
  checkedAt: string;
  stale: boolean;
  error?: string;
};

async function fetchText(url: string, timeout = 35_000) {
  const response = await fetch(url, { headers: secRequestHeaders("application/json, text/plain, */*"), cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Request returned ${response.status}`);
  return response.text();
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, { headers: secRequestHeaders("application/json, text/plain, */*"), cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Request returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The most recently downloaded 13F quarterly archive, held briefly in process.
 *
 * The dataset is one file covering every issuer, and it was being downloaded
 * again for each ticker and again for each of the two quarters compared — four
 * transfers of a very large archive to answer two questions about one company.
 * Only two entries are retained, which is exactly the current and prior quarter
 * a single request needs, and they expire so a long-lived process does not pin
 * the memory indefinitely.
 */
const DATASET_TTL_MS = 10 * 60 * 1000;
const datasetCache = new Map<string, { buffer: Buffer; at: number }>();

async function fetchDataset(url: string) {
  const cached = datasetCache.get(url);
  if (cached && Date.now() - cached.at < DATASET_TTL_MS) return cached.buffer;
  // Concurrent callers wanting the same archive share one transfer.
  const buffer = await dedupeRequest(`13f-dataset:${url}`, () => fetchBuffer(url));
  datasetCache.set(url, { buffer, at: Date.now() });
  for (const [key, value] of datasetCache) {
    if (Date.now() - value.at >= DATASET_TTL_MS || datasetCache.size > 2) datasetCache.delete(key);
    if (datasetCache.size <= 2) break;
  }
  return buffer;
}

/** Runs tasks concurrently, keeping at most `limit` in flight. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit: number) {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await tasks[index]();
        } catch {
          results[index] = null;
        }
      }
    }),
  );
  return results;
}

/** Resolves to null if the work has not finished within `ms`. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => {
      // The timer must not hold the process open once the answer is sent.
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => resolve(null), ms);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }),
  ]);
}

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1].replace(/<[^>]+>/g, "").trim()) : null;
}

function number(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function recentIndices(recent: Record<string, Array<string | null>>) {
  const keys = Object.keys(recent);
  const length = Math.max(...keys.map((key) => recent[key]?.length ?? 0), 0);
  return Array.from({ length }, (_, index) => Object.fromEntries(keys.map((key) => [key, recent[key]?.[index] ?? null])));
}

function normalizeIssuer(value: string) {
  return value.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|PLC|HOLDINGS|HOLDING|CLASS|CL|COM|COMMON|NEW|NEWCO)\b/g, " ").replace(/\s+/g, " ").trim();
}

const issuerAliases: Record<string, string[]> = {
  AAPL: ["APPLE"], MSFT: ["MICROSOFT"], NVDA: ["NVIDIA"], AMZN: ["AMAZON"], META: ["META PLATFORMS", "META"], GOOGL: ["ALPHABET"], TSLA: ["TESLA"],
};

function issuerMatches(symbol: string, issuer: string, company: string | null) {
  const normalized = normalizeIssuer(issuer);
  const aliases = issuerAliases[symbol] ?? [];
  const companyWords = normalizeIssuer(company ?? "").split(" ").filter(Boolean).slice(0, 2).join(" ");
  return [...aliases, companyWords].filter(Boolean).some((candidate) => normalized === candidate || normalized.startsWith(`${candidate} `) || candidate.startsWith(`${normalized} `));
}

/**
 * Normalise 13F position values to dollars.
 *
 * The information table's VALUE column is reported in thousands in the archives
 * this reads, so summing it raw put Corning's disclosed institutional holdings
 * at ninety-two trillion dollars and credited Vanguard with more in one stock
 * than it manages in total.
 *
 * The scale is detected rather than assumed, because the SEC changed this
 * convention once already and may again: value divided by shares is a price,
 * and the median across filers is either a believable share price or a
 * thousand times one. Anything above the threshold is treated as thousands.
 * A share priced above it in reality — Berkshire's A shares are the only US
 * listing that comes close — would be misread, which is why the check uses the
 * median rather than any single filer.
 */
const PLAUSIBLE_SHARE_PRICE_CEILING = 5_000;

/**
 * True when a 13F row counts principal rather than shares.
 *
 * SSHPRNAMT is a share count only when its type column says SH. On a PRN row it
 * is the face amount of a convertible or note, denominated in dollars, and
 * adding it to a share total inflates the count without limit: Barclays' Tesla
 * position came out thirty-five per cent larger than it is, which put its
 * implied share price a hundred dollars below every other filer's and made the
 * percentage of the company it owns wrong in the same direction.
 *
 * The SEC has published this column as both SSHPRNAMTTYPE and SSHPRNTYPE, so
 * both spellings are read. Only an explicit PRN is excluded — a row with the
 * column absent or empty is kept, so an unexpected schema drops nothing.
 */
function isPrincipalAmount(row: Record<string, string>) {
  const type = (row.SSHPRNAMTTYPE || row.SSHPRNTYPE || "").trim().toUpperCase();
  return type === "PRN";
}

/** Divides by a thousand until the figure could be a share price. */
function canonicalPrice(price: number) {
  let scaled = price;
  while (scaled > PLAUSIBLE_SHARE_PRICE_CEILING) scaled /= 1000;
  return scaled;
}

function scaleHoldingsToDollars(holdings: Map<string, { manager: string; value: number; shares: number }>) {
  const judgeable = [...holdings.values()].filter((row) => row.shares > 0 && row.value > 0);
  if (!judgeable.length) return;

  // Every filer here holds the same security for the same quarter, so they are
  // all describing one share price. The median of the canonicalised readings is
  // that price, and it is the yardstick each row is then measured against.
  const prices = judgeable.map((row) => canonicalPrice(row.value / row.shares)).sort((left, right) => left - right);
  const consensus = prices[Math.floor(prices.length / 2)];

  // The scale used to be decided once for the whole dataset, so a filer still
  // reporting on the old convention was left a thousand times out of step with
  // the rest and simply sorted to the wrong end of the list. Each row now picks
  // the factor that puts its own implied price closest to the consensus.
  const factors = [1, 1 / 1_000, 1 / 1_000_000];
  const chosen = new Map<string, number>();
  for (const row of judgeable) {
    const price = row.value / row.shares;
    let best = 1;
    let bestError = Infinity;
    for (const factor of factors) {
      const error = Math.abs(Math.log((price * factor) / consensus));
      if (error < bestError) {
        bestError = error;
        best = factor;
      }
    }
    chosen.set(row.manager, best);
    row.value *= best;
  }

  // A row with no share count cannot be judged on its own, so it takes the
  // factor the judgeable rows most agreed on.
  const tally = new Map<number, number>();
  for (const factor of chosen.values()) tally.set(factor, (tally.get(factor) ?? 0) + 1);
  const majority = [...tally.entries()].sort((left, right) => right[1] - left[1])[0][0];
  for (const row of holdings.values()) if (!chosen.has(row.manager)) row.value *= majority;
}

function entries(buffer: Buffer) {
  const end = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= end; index -= 1) if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  if (eocd < 0) throw new Error("SEC dataset is not a ZIP archive");
  const centralOffset = buffer.readUInt32LE(eocd + 16); const centralSize = buffer.readUInt32LE(eocd + 12); const result: ZipEntry[] = [];
  let cursor = centralOffset; const finish = centralOffset + centralSize;
  while (cursor < finish && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const method = buffer.readUInt16LE(cursor + 10); const compressedSize = buffer.readUInt32LE(cursor + 20); const uncompressedSize = buffer.readUInt32LE(cursor + 24); const nameLength = buffer.readUInt16LE(cursor + 28); const extraLength = buffer.readUInt16LE(cursor + 30); const commentLength = buffer.readUInt16LE(cursor + 32); const localOffset = buffer.readUInt32LE(cursor + 42);
    result.push({ name: buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength), method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function extract(buffer: Buffer, entry: ZipEntry) {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26); const extraLength = buffer.readUInt16LE(entry.localOffset + 28); const start = entry.localOffset + 30 + nameLength + extraLength; const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression for ${entry.name}`);
}

function tsvRows(data: Buffer, onRow: (headers: string[], values: string[]) => void) {
  let start = 0; let headers: string[] | null = null;
  for (let index = 0; index <= data.length; index += 1) {
    if (index !== data.length && data[index] !== 10) continue;
    const line = data.toString("utf8", start, index).replace(/\r$/, ""); start = index + 1; if (!line) continue;
    const values = line.split("\t"); if (!headers) { headers = values.map((item) => item.trim().toUpperCase()); continue; }
    onRow(headers, values);
  }
}

function datasetUrl(date: Date) {
  const year = date.getUTCFullYear(); const month = date.getUTCMonth() + 1;
  if (month <= 2) return `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01dec${year - 1}-28feb${year}_form13f.zip`;
  if (month <= 5) return `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar${year}-31may${year}_form13f.zip`;
  if (month <= 8) return `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jun${year}-31aug${year}_form13f.zip`;
  if (month <= 11) return `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01sep${year}-30nov${year}_form13f.zip`;
  return `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01dec${year}-28feb${year + 1}_form13f.zip`;
}

async function findDataset(offset: number, excludeUrl?: string) {
  const now = new Date(); const candidates = [0, 1, 2, 3, 4].map((quarterOffset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - quarterOffset * 3, 1)); return datasetUrl(date);
  });
  for (const url of candidates.slice(offset, offset + 4)) { if (url === excludeUrl) continue; try { return { url, buffer: await fetchDataset(url) }; } catch { /* dataset may not be published yet */ } }
  return null;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "31-MAR-2026" as a sortable timestamp, or null if unparseable. */
function periodValue(period: string) {
  const match = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(period.trim().toUpperCase());
  if (!match) return null;
  const month = MONTHS[match[2]];
  if (month === undefined) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

type FilingMeta = { accession: string; manager: string; cik: string; period: string; periodAt: number; filed: string | null; isAmendment: boolean; amendmentNo: number; restates: boolean };

/**
 * Picks the one filing per manager that states its holdings for a quarter.
 *
 * A quarterly archive is not a quarter of holdings. It contains every 13F filed
 * during that window, which includes late amendments for quarters going years
 * back, and a manager's original report alongside its own restatement of the
 * same period. Summing the information table by manager name therefore added a
 * filer's history to its present: Barclays' Tesla position came out fourteen
 * times its real size from twelve amendments reaching back to 2022, and
 * Vanguard's came out exactly doubled because its restatement repeated the
 * original row verbatim. Every holder disagreed with every other about the
 * share price as a result, which is the symptom that exposed this.
 *
 * So: keep only the newest reporting period in the archive, group by the filer's
 * CIK rather than its name, and within a filer take the highest-numbered
 * restatement if one exists — a restatement replaces the report rather than
 * adding to it — otherwise the original plus any additive amendments.
 */
function authoritativeFilings(all: FilingMeta[]) {
  // The quarter the archive is actually about is the one most of its filings
  // report, not the newest one present: a single mis-keyed period dated into the
  // future would otherwise select itself and discard everything else. Ties go to
  // the later quarter.
  const counts = new Map<number, number>();
  for (const filing of all) counts.set(filing.periodAt, (counts.get(filing.periodAt) ?? 0) + 1);
  if (!counts.size) return { accessions: new Set<string>(), period: null as string | null, filed: null as string | null };
  const [target] = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];

  const current = all.filter((filing) => filing.periodAt === target);
  const byFiler = new Map<string, FilingMeta[]>();
  for (const filing of current) {
    const key = filing.cik || filing.manager;
    const group = byFiler.get(key) ?? [];
    group.push(filing);
    byFiler.set(key, group);
  }

  const accessions = new Set<string>();
  for (const group of byFiler.values()) {
    const restatements = group.filter((filing) => filing.restates);
    if (restatements.length) {
      const newest = restatements.reduce((best, filing) => (filing.amendmentNo >= best.amendmentNo ? filing : best));
      accessions.add(newest.accession);
      continue;
    }
    for (const filing of group) accessions.add(filing.accession);
  }

  // Filing dates are DD-MON-YYYY, which does not sort as text.
  const filedDates = current
    .filter((filing) => accessions.has(filing.accession) && filing.filed)
    .map((filing) => ({ label: filing.filed as string, at: periodValue(filing.filed as string) }))
    .filter((entry) => entry.at !== null)
    .sort((left, right) => (left.at as number) - (right.at as number));
  return { accessions, period: current[0]?.period ?? null, filed: filedDates[filedDates.length - 1]?.label ?? null };
}

async function parseInstitutional(symbol: string, company: string | null, offset: number, excludeUrl?: string): Promise<ParsedInstitutional | null> {
  const dataset = await findDataset(offset, excludeUrl); if (!dataset) return null;
  const names = entries(dataset.buffer);
  const cover = names.find((entry) => /COVERPAGE\.TSV$/i.test(entry.name));
  const info = names.find((entry) => /INFOTABLE\.TSV$/i.test(entry.name));
  const submission = names.find((entry) => /SUBMISSION\.TSV$/i.test(entry.name));
  if (!cover || !info) throw new Error("SEC 13F tables were not found");

  // SUBMISSION carries the filer's CIK and the period the report covers; the
  // cover page carries the manager's name and whether it is an amendment.
  const submissions = new Map<string, { cik: string; period: string; filed: string }>();
  if (submission) {
    tsvRows(extract(dataset.buffer, submission), (headers, values) => {
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      if (row.ACCESSION_NUMBER) submissions.set(row.ACCESSION_NUMBER, { cik: row.CIK ?? "", period: row.PERIODOFREPORT ?? "", filed: row.FILING_DATE ?? "" });
    });
  }

  const filings: FilingMeta[] = [];
  const managerNames = new Map<string, string>();
  tsvRows(extract(dataset.buffer, cover), (headers, values) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const accession = row.ACCESSION_NUMBER;
    if (!accession) return;
    const manager = row.FILINGMANAGER_NAME || row.NAME || "Institutional manager";
    managerNames.set(accession, manager);
    const period = submissions.get(accession)?.period || row.REPORTCALENDARORQUARTER || "";
    const periodAt = periodValue(period);
    if (periodAt === null) return;
    filings.push({
      accession,
      manager,
      cik: submissions.get(accession)?.cik ?? "",
      period,
      periodAt,
      // The filing date lives on the submission record, not the cover page.
      filed: submissions.get(accession)?.filed || null,
      isAmendment: (row.ISAMENDMENT || "").trim().toUpperCase().startsWith("Y"),
      amendmentNo: number(row.AMENDMENTNO) ?? 0,
      restates: (row.AMENDMENTTYPE || "").trim().toUpperCase() === "RESTATEMENT",
    });
  });

  const { accessions, period, filed } = authoritativeFilings(filings);

  const holdings = new Map<string, { manager: string; value: number; shares: number }>();
  tsvRows(extract(dataset.buffer, info), (headers, values) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (!accessions.has(row.ACCESSION_NUMBER)) return;
    const manager = managerNames.get(row.ACCESSION_NUMBER);
    if (!manager || !issuerMatches(symbol, row.NAMEOFISSUER ?? "", company) || row.PUTCALL || isPrincipalAmount(row)) return;
    const value = (number(row.VALUE) ?? 0) * 1000;
    const shares = number(row.SSHPRNAMT) ?? 0;
    const current = holdings.get(manager) ?? { manager, value: 0, shares: 0 };
    current.value += value;
    current.shares += shares;
    holdings.set(manager, current);
  });

  scaleHoldingsToDollars(holdings);
  const rows = [...holdings.values()].sort((a, b) => b.value - a.value);
  const reportedValue = rows.reduce((sum, row) => sum + row.value, 0);
  const reportedShares = rows.reduce((sum, row) => sum + row.shares, 0);
  return { asOf: period, filed, managers: rows.length, reportedValue: reportedValue || null, reportedShares: reportedShares || null, topHolders: rows.slice(0, 8), source: "SEC Form 13F dataset", sourceUrl: "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets", datasetUrl: dataset.url };
}

async function loadCik(symbol: string) {
  const issuer = await findIssuer(symbol);
  if (!issuer) throw new Error("Ticker is not an SEC reporting issuer.");
  return { cik: issuer.cik, title: issuer.title };
}

async function parseInsiders(symbol: string, cik: string) {
  const submissions = await fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`).then((value) => JSON.parse(value) as Submissions);
  const recent = submissions.filings?.recent;
  if (!recent) return [];
  const rows = recentIndices(recent).filter((row) => row.form === "4").slice(0, 10);
  const results: InsiderTransaction[] = [];
  // Ten independent documents were fetched one after another, so the panel
  // waited for the sum of ten round trips to EDGAR rather than the slowest one.
  // Four at a time stays well inside the SEC's rate guidance.
  const perFiling = rows.map((row) => async () => {
    const found: InsiderTransaction[] = [];
    const accessionNumber = row.accessionNumber;
    const primaryDocument = row.primaryDocument;
    const filingDate = row.filingDate;
    if (!accessionNumber || !primaryDocument || !filingDate) return found;
    try {
      const accession = accessionNumber.replace(/-/g, "");
      // EDGAR reports primaryDocument as a stylesheet path such as
      // "xslF345X06/form4.xml", which serves an HTML rendering. The transaction
      // elements only exist in the raw document beside it, so every filing
      // parsed to zero transactions until the prefix was dropped.
      const document = primaryDocument.replace(/^xsl[^/]*\//, "");
      const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${document}`;
      const xml = await fetchText(url);
      const owner = tag(xml, "rptOwnerName") ?? "Reporting owner";
      const title = tag(xml, "officerTitle");
      const blocks = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map((match) => match[1]);
      for (const block of blocks.slice(0, 12)) {
        const code = tag(block, "transactionCode");
        const shares = number(tag(block, "transactionShares"));
        const price = number(tag(block, "transactionPricePerShare"));
        const sharesAfter = number(tag(block, "sharesOwnedFollowingTransaction"));
        const acquired = tag(block, "transactionAcquiredDisposedCode");
        const side: InsiderTransaction["side"] = code === "P" || (acquired === "A" && code === "A") ? "buy" : code === "S" || acquired === "D" ? "sell" : "other";
        found.push({ date: tag(block, "transactionDate"), filed: filingDate, owner, title, code, side, shares, price, value: shares !== null && price !== null ? shares * price : null, sharesAfter, url });
      }
    } catch {
      /* one malformed filing should not hide the rest */
    }
    return found;
  });
  for (const batch of await pooled(perFiling, 4)) if (batch) results.push(...batch);
  return results.sort((a, b) => `${b.date ?? ""}${b.filed}`.localeCompare(`${a.date ?? ""}${a.filed}`)).slice(0, 24);
}

async function parseShortInterest(symbol: string) {
  const now = new Date();
  const candidates: Date[] = [];
  for (let monthOffset = 0; monthOffset < 4; monthOffset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 15));
    candidates.push(date);
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset + 1, 0));
    while ([0, 6].includes(end.getUTCDay())) end.setUTCDate(end.getUTCDate() - 1);
    candidates.push(end);
  }
  // Settlement dates are probed together rather than one after another. Only
  // some are published, so the sequential version paid a full round trip for
  // every date it had to skip before reaching one that exists.
  const probes = candidates.slice(0, 6).map((candidate) => async () => {
    const stamp = candidate.toISOString().slice(0, 10).replace(/-/g, "");
    const text = await fetchText(`https://cdn.finra.org/equity/otcmarket/biweekly/shrt${stamp}.csv`, 15_000);
    const lines = text.split(/\r?\n/);
    const headers = lines.shift()?.split("|") ?? [];
    const index = Object.fromEntries(headers.map((header, i) => [header, i]));
    const line = lines.find((item) => item.split("|")[index.symbolCode] === symbol);
    if (!line) return null;
    const values = line.split("|");
    const read = (name: string) => values[index[name]] ?? "";
    return { settlementDate: read("settlementDate") || null, symbol, current: number(read("currentShortPositionQuantity")), previous: number(read("previousShortPositionQuantity")), changePercent: number(read("changePercent")), averageDailyVolume: number(read("averageDailyVolumeQuantity")), daysToCover: number(read("daysToCoverQuantity")), source: "FINRA short-interest file", sourceUrl: "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/files" } satisfies ShortInterest;
  });
  // Candidates run newest first, so the first hit is the latest published file.
  for (const result of await pooled(probes, 3)) if (result) return result;
  return null;
}

async function parseShortSaleVolume(symbol: string) {
  const now = new Date(); const days: Date[] = [];
  for (let offset = 0; offset < 8 && days.length < 5; offset += 1) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - offset);
    if ([0, 6].includes(date.getUTCDay())) continue;
    days.push(date);
  }
  const probes = days.map((date) => async () => {
    const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
    const text = await fetchText(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${stamp}.txt`, 15_000);
    const lines = text.split(/\r?\n/); lines.shift();
    const line = lines.find((item) => item.split("|")[1] === symbol);
    if (!line) return null;
    const values = line.split("|");
    const shortVolume = number(values[2]); const shortExemptVolume = number(values[3]); const totalVolume = number(values[4]);
    return { tradeDate: values[0] ? `${values[0].slice(0, 4)}-${values[0].slice(4, 6)}-${values[0].slice(6, 8)}` : null, shortVolume, shortExemptVolume, totalVolume, ratio: shortVolume !== null && totalVolume ? shortVolume / totalVolume * 100 : null, source: "FINRA Daily Reg SHO volume", sourceUrl: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data" } satisfies ShortSaleVolume;
  });
  // Most recent session first, so the first hit is the latest published file.
  for (const result of await pooled(probes, 3)) if (result) return result;
  return null;
}

/**
 * How long each scope may run before it returns whatever it has.
 *
 * The filings half feeds the visible panel, so it is held to a few seconds. The
 * institutional half is fetched separately and fills in behind the rendered
 * page, so it can afford the time a very large quarterly archive needs; it
 * still has an upper bound, which is what the original code lacked entirely.
 */
const BUDGET_MS: Record<string, number> = { filings: 12_000, institutional: 90_000, all: 45_000 };

/**
 * Every ownership source, gathered concurrently and under a deadline.
 *
 * This used to await six steps in sequence — the issuer lookup, the fact set,
 * ten insider filings one at a time, then two separate downloads of a very
 * large quarterly 13F archive, then the FINRA files — so the response took the
 * sum of all of them and had no upper bound at all. Opening the panel on GLW
 * simply never finished.
 *
 * The parts do not depend on each other beyond the issuer identity, so they now
 * run together and each is allowed to fail or time out on its own. A source
 * that does not arrive in time comes back null and renders as a missing state,
 * which is the same thing the interface already shows when a publisher has
 * nothing for the ticker.
 */
/** `incomplete` marks a run whose own scope failed; it is never persisted. */
type CollectResult = Omit<StockOwnershipData, "stale"> & { incomplete: boolean };

async function collect(symbol: string, scope: OwnershipScope): Promise<CollectResult> {
  const started = Date.now();
  const budget = BUDGET_MS[scope] ?? BUDGET_MS.all;
  const remaining = () => Math.max(1_000, budget - (Date.now() - started));

  // Only the issuer identity gates the rest, and the ticker map is cached.
  const issuer = await loadCik(symbol);

  const wantsFilings = scope !== "institutional";
  const wantsInstitutional = scope !== "filings";

  const fundamentalsTask = wantsInstitutional ? withDeadline(loadStockFundamentals(symbol).catch(() => null), remaining()) : Promise.resolve(null);
  // Null, not an empty array, when the fetch fails or runs out of time. An
  // issuer with genuinely no Form 4s and an issuer whose filings EDGAR refused
  // to serve both produced `[]`, and the empty one was then cached for twelve
  // hours as though it were the answer.
  const insidersTask = wantsFilings ? withDeadline(parseInsiders(symbol, issuer.cik).catch(() => null), remaining()) : Promise.resolve([]);
  const shortInterestTask = wantsFilings ? withDeadline(parseShortInterest(symbol).catch(() => null), remaining()) : Promise.resolve(null);
  const shortVolumeTask = wantsFilings ? withDeadline(parseShortSaleVolume(symbol).catch(() => null), remaining()) : Promise.resolve(null);

  // The company name only refines issuer matching inside the 13F tables, so the
  // filing title is a good enough starting point and this no longer waits on
  // the fact set before starting the largest download of the five.
  const name = issuer.title;
  const institutionalTask = !wantsInstitutional ? Promise.resolve(null) : withDeadline(
    (async () => {
      const current = await parseInstitutional(symbol, name, 0).catch(() => null);
      // The prior quarter reuses the cached archive when it is the same file.
      const prior = await parseInstitutional(symbol, name, 1, current?.datasetUrl).catch(() => null);
      return { current, prior };
    })(),
    remaining(),
  );

  const [fundamentals, insiders, shortInterest, shortSaleVolume, institutionalPair] = await Promise.all([
    fundamentalsTask,
    insidersTask,
    shortInterestTask,
    shortVolumeTask,
    institutionalTask,
  ]);

  const institutional = institutionalPair?.current ?? null;
  const previousValue = institutionalPair?.prior?.reportedValue ?? null;
  const currentValue = institutional?.reportedValue ?? null;
  const sharesOutstanding = fundamentals?.annual.shares ?? null;

  return {
    symbol,
    incomplete: wantsFilings && insiders === null,
    insiders: insiders ?? [],
    institutional: institutional
      ? {
          ...institutional,
          topHolders: institutional.topHolders.map((holder) => ({
            ...holder,
            percent: sharesOutstanding ? (holder.shares / sharesOutstanding) * 100 : null,
          })),
          ownershipPercent:
            institutional.reportedShares !== null && sharesOutstanding
              ? (institutional.reportedShares / sharesOutstanding) * 100
              : null,
          previousReportedValue: previousValue,
          changePercent: currentValue !== null && previousValue ? (currentValue / previousValue - 1) * 100 : null,
        }
      : null,
    shortInterest: shortInterest ?? null,
    shortSaleVolume: shortSaleVolume ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export type OwnershipScope = "all" | "filings" | "institutional";

/**
 * Ownership for one ticker.
 *
 * The 13F archive is a very large download and is by far the slowest of the
 * sources here, so it can be asked for separately: the interface requests the
 * insider and FINRA parts first, renders them, and lets the institutional
 * holdings arrive on their own. Each scope caches under its own key.
 */
export async function loadStockOwnership(symbol: string, scope: OwnershipScope = "all"): Promise<StockOwnershipData> {
  const key = scope === "all" ? symbol.toUpperCase() : `${symbol.toUpperCase()}:${scope}`;
  const stored = getSnapshot<Omit<StockOwnershipData, "stale">>("stock-ownership", key);
  if (stored?.methodologyVersion === SOURCE_VERSION && snapshotIsFresh(stored)) return { ...stored.payload, stale: false };
  return dedupeRequest(`stock-ownership:${key}`, async () => {
    try {
      const { incomplete, ...payload } = await collect(symbol.toUpperCase(), scope);
      // A scope that ran out of time produced nothing to remember. Saving it
      // would serve the empty result for the whole cache window and the panel
      // would never recover without the version being bumped.
      if (incomplete) return { ...payload, stale: false };
      if (scope === "institutional" && !payload.institutional) return { ...payload, stale: false };
      putSnapshot({
        namespace: "stock-ownership",
        key,
        payload,
        sourceTime: payload.institutional?.asOf ?? payload.shortInterest?.settlementDate ?? payload.checkedAt,
        fetchedAt: new Date().toISOString(),
        refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
        methodologyVersion: SOURCE_VERSION,
      });
      return { ...payload, stale: false };
    } catch (error) {
      if (stored) return { ...stored.payload, stale: true };
      return { symbol: symbol.toUpperCase(), insiders: [], institutional: null, shortInterest: null, shortSaleVolume: null, checkedAt: new Date().toISOString(), stale: true, error: error instanceof Error ? error.message : "Ownership data unavailable." };
    }
  });
}
