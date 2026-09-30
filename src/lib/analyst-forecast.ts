/**
 * Parsing for the published analyst consensus and financial forecast.
 *
 * Pure functions over the flattened page text so they can be tested without a
 * network call. The page is rendered to text with tags replaced by a delimiter,
 * which keeps table cells apart — collapsing tags to spaces instead runs a
 * cell's value into the next cell's label.
 */

/** A dollar amount that stops before sentence punctuation. */
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)`;

export function flattenHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, "|")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\|+/g, "|")
    .replace(/[ \t\r\n]+/g, " ");
}

/** The same text with delimiters as spaces, for prose that spans tags. */
export function proseOf(flat: string) {
  return flat.replace(/\|/g, " ").replace(/\s+/g, " ");
}

function amount(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A table cell, scaled by its magnitude suffix.
 *
 * Cells the publisher withholds read "Upgrade" or "Pro", and a year the issuer
 * has not reported reads "-". All three are absent values, not zeroes.
 */
export function parseCell(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || text === "-" || /^(upgrade|pro|n\/a)$/i.test(text)) return null;
  const match = /^(-?[\d,]*\.?\d+)\s*([TBMK])?%?$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  const scale = { t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[(match[2] ?? "").toLowerCase()] ?? 1;
  return value * scale;
}

/** Cells of one labelled row of the fiscal table, in column order. */
export function rowCells(flat: string, label: string, columns: number) {
  const start = flat.indexOf(`|${label}|`);
  if (start < 0) return [];
  const segment = flat.slice(start + label.length + 2, start + label.length + 2 + 400);
  const cells = segment
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return cells.slice(0, columns);
}

export type FiscalYear = {
  label: string;
  periodEnding: string | null;
  revenue: number | null;
  revenueGrowth: number | null;
  eps: number | null;
  epsGrowth: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  analysts: number | null;
  forecast: boolean;
};

/**
 * The fiscal-year table: reported years followed by the consensus forecast.
 *
 * A year is a forecast when the publisher attributes an analyst count to it,
 * which is the only marker on the page that separates the two and does not
 * depend on today's date.
 */
export function parseFiscalYears(flat: string): FiscalYear[] {
  const header = flat.indexOf("|Fiscal Year|");
  if (header < 0) return [];
  const labels = flat
    .slice(header + "|Fiscal Year|".length, header + 240)
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => /^FY\s*\d{4}$/i.test(cell));
  if (!labels.length) return [];

  const columns = labels.length;
  const endings = rowCells(flat, "Period Ending", columns);
  const revenue = rowCells(flat, "Revenue", columns);
  const revenueGrowth = rowCells(flat, "Revenue Growth", columns);
  const eps = rowCells(flat, "EPS", columns);
  const epsGrowth = rowCells(flat, "EPS Growth", columns);
  const netIncome = rowCells(flat, "Net Income", columns);
  const freeCashFlow = rowCells(flat, "Free Cash Flow", columns);
  const analysts = rowCells(flat, "No. Analysts", columns);

  return labels.map((label, index) => ({
    label: label.replace(/\s+/g, " "),
    periodEnding: endings[index] && endings[index] !== "-" ? endings[index] : null,
    revenue: parseCell(revenue[index]),
    revenueGrowth: parseCell(revenueGrowth[index]),
    eps: parseCell(eps[index]),
    epsGrowth: parseCell(epsGrowth[index]),
    netIncome: parseCell(netIncome[index]),
    freeCashFlow: parseCell(freeCashFlow[index]),
    analysts: parseCell(analysts[index]),
    forecast: parseCell(analysts[index]) !== null,
  }));
}

export type ForecastRange = { year: string; high: number | null; average: number | null; low: number | null };

/**
 * The high/average/low band for one forecast metric.
 *
 * Only the nearest year is published without a subscription; the remaining
 * columns read "Pro" and resolve to null rather than being dropped silently.
 */
export function parseForecastRange(flat: string, heading: string): ForecastRange | null {
  const start = flat.indexOf(`|${heading} Forecast|`);
  if (start < 0) return null;
  const block = flat.slice(start, start + 420);
  const years = block.split("|").map((cell) => cell.trim()).filter((cell) => /^\d{4}$/.test(cell));
  if (!years.length) return null;
  const pick = (label: string) => {
    const at = block.indexOf(`|${label}|`);
    if (at < 0) return null;
    const cells = block.slice(at + label.length + 2, at + label.length + 2 + 120).split("|").map((cell) => cell.trim()).filter(Boolean);
    return parseCell(cells[0]);
  };
  return { year: years[0], high: pick("High"), average: pick("Avg"), low: pick("Low") };
}

export type ConsensusTargets = {
  count: number | null;
  consensus: string | null;
  average: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
  updated: string | null;
};

/**
 * Price targets and the rating.
 *
 * Each field is read on its own. One expression spanning the whole sentence
 * meant a single unmatched group discarded all five values, and the average
 * target — written at the end of a clause — lost its match to the full stop
 * that `[\d,.]+` happily consumed.
 */
export function parseConsensus(prose: string): ConsensusTargets {
  const match = (pattern: string) => prose.match(new RegExp(pattern, "i"));
  const headline = match(String.raw`According to (\d+) analysts`);
  const rating = match(String.raw`consensus rating of\s+"([^"]+)"`);
  // The summary table repeats all four figures in a fixed order and is steadier
  // than the prose, which is kept as the fallback.
  const table = match(String.raw`Target\s+Low\s+Average\s+Median\s+High\s+Price\s+\$${AMOUNT}\s+\$${AMOUNT}\s+\$${AMOUNT}\s+\$${AMOUNT}`);

  return {
    count: headline ? Number(headline[1]) : null,
    consensus: rating?.[1] ?? null,
    low: amount(table?.[1]) ?? amount(match(String.raw`lowest is \$${AMOUNT}`)?.[1]),
    average:
      amount(table?.[2]) ??
      amount(match(String.raw`average price target of \$${AMOUNT}`)?.[1]) ??
      amount(match(String.raw`Price Target:\s*\$${AMOUNT}`)?.[1]),
    median: amount(table?.[3]),
    high: amount(table?.[4]) ?? amount(match(String.raw`highest is \$${AMOUNT}`)?.[1]),
    updated: match(String.raw`Last updated:\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})`)?.[1] ?? null,
  };
}
