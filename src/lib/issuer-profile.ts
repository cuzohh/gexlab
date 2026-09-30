/**
 * Parsing for the issuer profile: the next earnings date, the dividend, and the
 * one-paragraph description of what the company does.
 *
 * These are the plain facts a retail quote page leads with and this workstation
 * had nowhere: the risk workbench asked the reader to type the earnings date in
 * by hand, and a dividend paid quarterly for fourteen years appeared nowhere at
 * all. Pure functions over flattened page text, as with the analyst consensus,
 * so they can be exercised against saved markup without a network call.
 */

/**
 * A numeric cell, scaled by its magnitude suffix: "4.57T" is 4.57 trillion.
 *
 * The same rule as the forecast parser applies, and it is restated here rather
 * than imported. These parsers are exercised by the bare Node test runner,
 * which resolves no path aliases, so a lib module under test carries no imports.
 */
function scaledCell(raw: string | null): number | null {
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

/**
 * The cells of the flattened document, in order.
 *
 * The publisher lays its quote statistics out as a table, so a label and its
 * value are adjacent cells. Empty cells sit between them often enough that they
 * have to be skipped rather than treated as the value.
 */
export function cellsOf(flat: string) {
  return flat.split("|").map((cell) => cell.trim());
}

/**
 * The value stated against `label`, or null when the page does not carry it.
 *
 * Matching is exact on the trimmed cell. A loose match reads the "Dividends"
 * navigation link as the "Dividend" statistic and returns the word "History".
 */
export function labelledValue(cells: string[], label: string) {
  const target = label.toLowerCase();
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index].toLowerCase() !== target) continue;
    for (let ahead = index + 1; ahead < Math.min(cells.length, index + 4); ahead += 1) {
      if (cells[ahead]) return cells[ahead];
    }
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "Jul 30, 2026" as a calendar date.
 *
 * Returned as `YYYY-MM-DD` rather than a Date so it crosses the wire and the
 * timezone boundary unchanged — the formatting helpers already treat a bare
 * calendar date as the day it names.
 */
export function parseUsDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  const day = Number(match[2]);
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A percentage cell such as "12.39%" or "-3.9%". The sign is kept. */
export function parsePercentCell(value: string | null): number | null {
  if (!value) return null;
  const match = /^(-?[\d,]*\.?\d+)\s*%$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A dollar cell such as "$1.08". */
export function parseMoneyCell(value: string | null): number | null {
  if (!value) return null;
  const match = /^\$?(-?[\d,]*\.?\d+)$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The dividend as the quote page states it: "$1.08 (0.34%)".
 *
 * An issuer that pays nothing renders "n/a", which is an absent dividend and
 * not a zero one — a zero would be a claim that the board declared nothing,
 * which is a different statement from the page having no figure.
 */
export function parseDividendCell(value: string | null) {
  if (!value) return { amount: null, yield: null };
  const match = /\$?([\d,]*\.?\d+)\s*\(([\d,]*\.?\d+)\s*%\)/.exec(value);
  if (!match) return { amount: parseMoneyCell(value), yield: null };
  return { amount: Number(match[1].replaceAll(",", "")), yield: Number(match[2].replaceAll(",", "")) };
}

export type IssuerProfile = {
  earningsDate: string | null;
  exDividendDate: string | null;
  dividend: number | null;
  dividendYield: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  beta: number | null;
  sharesOut: number | null;
  marketCap: number | null;
  weekRange: { low: number; high: number } | null;
  description: string | null;
};

/** "216.58 - 344.57" as an ordered pair. */
export function parseRange(value: string | null) {
  if (!value) return null;
  const match = /^([\d,]*\.?\d+)\s*[-–]\s*([\d,]*\.?\d+)$/.exec(value.trim());
  if (!match) return null;
  const low = Number(match[1].replaceAll(",", ""));
  const high = Number(match[2].replaceAll(",", ""));
  return Number.isFinite(low) && Number.isFinite(high) ? { low: Math.min(low, high), high: Math.max(low, high) } : null;
}

/**
 * The business description, which follows an "About TICKER" heading.
 *
 * Cut at the first sentence boundary past 320 characters: the full text runs to
 * several hundred words of corporate history, and a panel that has to be
 * scrolled to reach the next statistic is worse than one that summarises.
 */
export function parseDescription(prose: string, symbol: string) {
  const heading = prose.search(new RegExp(`About\\s+${symbol}\\b`, "i"));
  if (heading < 0) return null;
  const body = prose.slice(heading).replace(new RegExp(`^About\\s+${symbol}\\s*`, "i"), "").trim();
  if (body.length < 40) return null;
  const cut = body.indexOf(". ", 320);
  return (cut > 0 ? body.slice(0, cut + 1) : body.slice(0, 480)).trim();
}

export function parseIssuerProfile(flat: string, prose: string, symbol: string): IssuerProfile {
  const cells = cellsOf(flat);
  const value = (label: string) => labelledValue(cells, label);
  const number = (label: string) => scaledCell(value(label));
  const dividend = parseDividendCell(value("Dividend"));
  return {
    earningsDate: parseUsDate(value("Earnings Date")),
    exDividendDate: parseUsDate(value("Ex-Dividend Date")),
    dividend: dividend.amount,
    dividendYield: dividend.yield,
    peRatio: number("PE Ratio"),
    forwardPe: number("Forward PE"),
    beta: number("Beta"),
    sharesOut: number("Shares Out"),
    marketCap: number("Market Cap"),
    weekRange: parseRange(value("52-Week Range")),
    description: parseDescription(prose, symbol),
  };
}

export type DividendDetail = {
  dividendYield: number | null;
  annualDividend: number | null;
  exDividendDate: string | null;
  payoutFrequency: string | null;
  payoutRatio: number | null;
  growth1Y: number | null;
  growthYears: number | null;
  buybackYield: number | null;
  shareholderYield: number | null;
};

/**
 * The dividend page.
 *
 * Buyback yield sits beside the dividend deliberately. A company returning
 * capital by retiring stock is doing the same thing as one paying a cheque, and
 * reading only the dividend line makes the second look like it returns nothing.
 */
export function parseDividendDetail(flat: string): DividendDetail {
  const cells = cellsOf(flat);
  const value = (label: string) => labelledValue(cells, label);
  const number = (label: string) => scaledCell(value(label));
  return {
    dividendYield: parsePercentCell(value("Dividend Yield")),
    annualDividend: parseMoneyCell(value("Annual Dividend")),
    exDividendDate: parseUsDate(value("Ex-Dividend Date")),
    payoutFrequency: value("Payout Frequency"),
    payoutRatio: parsePercentCell(value("Payout Ratio")),
    // The label is split across cells as "Dividend Growth" then "(1Y)", so the
    // percentage is the first cell after the parenthetical rather than the label.
    growth1Y: parsePercentCell(value("(1Y)")) ?? parsePercentCell(value("Dividend Growth")),
    growthYears: number("Growth Years"),
    buybackYield: parsePercentCell(value("Buyback Yield")),
    shareholderYield: parsePercentCell(value("Shareholder Yield")),
  };
}
