/**
 * Value formatting for the equity workspace.
 *
 * One rule holds everywhere: a value that is not available renders as an em
 * dash, never as zero and never as a plausible-looking number. Every helper
 * here takes `number | null` and returns a string for that reason.
 */

const EM_DASH = "—";

const compactUsd = new Intl.NumberFormat("en-US", {
  notation: "compact",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

const compactPlain = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Large dollar figures: revenue, cash flow, notional. */
export function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? EM_DASH : compactUsd.format(value);
}

/**
 * A share price or per-share figure, always to the cent.
 *
 * The sign leads the currency symbol. Interpolating it as `$${value}` produced
 * "$-3.96" for a loss-making year.
 */
export function usd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

/** A signed percentage. The sign is the point, so it is always shown. */
export function pct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** An unsigned percentage, for magnitudes like a margin or a ratio of volume. */
export function rate(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? EM_DASH : `${value.toFixed(digits)}%`;
}

/** A multiple, as in 12.4× earnings. */
export function multiple(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? EM_DASH : `${value.toFixed(digits)}×`;
}

export function count(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? EM_DASH : compactPlain.format(value);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date, rendered as the day it actually names.
 *
 * A bare `YYYY-MM-DD` parses as UTC midnight, so west of Greenwich it formats
 * as the previous day — a fiscal year ending January 25 was displayed as
 * ending January 24. Filing dates and period ends are calendar dates with no
 * time of day, so they are built in local time instead of being converted.
 */
export function dateShort(value: string | null | undefined) {
  if (!value) return EM_DASH;
  const parts = DATE_ONLY.exec(value);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(Date.parse(value));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Fiscal year label from a period end date, e.g. "FY26". */
export function fiscalYear(periodEnd: string | null | undefined) {
  if (!periodEnd) return null;
  const year = Number(periodEnd.slice(0, 4));
  return Number.isFinite(year) ? `FY${String(year).slice(2)}` : null;
}

/** "1 name" rather than "1 names". */
export function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export type Tone = "up" | "down" | "flat";

/** Direction of a signed value, for colour only. Null stays neutral. */
export function tone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/**
 * A ratio of two reported figures, rejected when it is not credible.
 *
 * Mixing fiscal years used to produce a 466% free-cash-flow margin, and the
 * fix belongs upstream in fact selection — but a restatement or an unusual
 * filing can still yield a number no reader should act on. A margin outside
 * the bound is treated as unavailable rather than displayed, per the rule that
 * nothing plausible-looking is ever invented.
 */
export function guardedRatio(numerator: number | null | undefined, denominator: number | null | undefined, bound = 10) {
  if (numerator === null || numerator === undefined || !Number.isFinite(numerator)) return null;
  if (!denominator || !Number.isFinite(denominator)) return null;
  const value = numerator / denominator;
  return Math.abs(value) > bound ? null : value;
}

/** As above, expressed in percent. */
export function guardedPercent(numerator: number | null | undefined, denominator: number | null | undefined, bound = 10) {
  const value = guardedRatio(numerator, denominator, bound);
  return value === null ? null : value * 100;
}

/** Free cash flow from a cash-flow pair, with capex treated as an outflow either way it is signed. */
export function freeCashFlow(operatingCashFlow: number | null | undefined, capex: number | null | undefined) {
  if (operatingCashFlow === null || operatingCashFlow === undefined || !Number.isFinite(operatingCashFlow)) return null;
  return operatingCashFlow - Math.abs(capex ?? 0);
}
