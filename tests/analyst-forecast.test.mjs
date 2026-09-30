import assert from "node:assert/strict";
import test from "node:test";

import {
  flattenHtml,
  parseCell,
  parseConsensus,
  parseFiscalYears,
  parseForecastRange,
  proseOf,
} from "../src/lib/analyst-forecast.ts";

/**
 * A cut of the published forecast page, reduced to the structures the parser
 * reads. The shapes here are the ones that broke it in practice: an average
 * price target closing a sentence, a fiscal table whose leading cells are
 * empty, withheld columns reading "Upgrade", and years the issuer never
 * reported reading "-".
 */
const PAGE = `
<p>According to 61 analysts polled by S&amp;P Global, NVIDIA stock has a consensus rating of
"Strong Buy" and an average price target of $302.83. The average 1-year stock price forecast is
35.22% higher than the current stock price, while the lowest is $180 (-19.63%) and the highest is
$500 (+123.25%).</p>
<table><tr><td>Target</td><td>Low</td><td>Average</td><td>Median</td><td>High</td></tr>
<tr><td>Price</td><td>$180</td><td>$302.83</td><td>$300</td><td>$500</td></tr></table>
<table>
<tr><td>Fiscal Year</td><td>FY 2025</td><td>FY 2026</td><td>FY 2027</td><td>FY 2028</td></tr>
<tr><td>Period Ending</td><td>Jan 26, 2025</td><td>Jan 25, 2026</td><td>Jan 31, 2027</td><td>Jan 31, 2028</td></tr>
<tr><td>Revenue</td><td></td><td>130.50B</td><td>215.94B</td><td>393.85B</td><td>Upgrade</td></tr>
<tr><td>Revenue Growth</td><td></td><td>114.20%</td><td>65.47%</td><td>82.39%</td><td>Upgrade</td></tr>
<tr><td>EPS</td><td></td><td>-</td><td>4.77</td><td>9.00</td><td>Upgrade</td></tr>
<tr><td>Net Income</td><td></td><td>72.88B</td><td>120.07B</td><td>229.61B</td><td>Upgrade</td></tr>
<tr><td>Free Cash Flow</td><td></td><td>44.46B</td><td>58.13B</td><td>212.88B</td><td>Upgrade</td></tr>
<tr><td>No. Analysts</td><td></td><td>-</td><td>-</td><td>53</td><td>Upgrade</td></tr>
</table>
<div>Revenue Forecast</div>
<table><tr><td>Revenue</td><td>2027</td><td>2028</td></tr>
<tr><td>High</td><td>415.5B</td><td>Pro</td></tr>
<tr><td>Avg</td><td>393.9B</td><td>Pro</td></tr>
<tr><td>Low</td><td>358.4B</td><td>Pro</td></tr></table>
<div>EPS Forecast</div>
<table><tr><td>EPS</td><td>2027</td><td>2028</td></tr>
<tr><td>High</td><td>9.85</td><td>Pro</td></tr>
<tr><td>Avg</td><td>9.00</td><td>Pro</td></tr>
<tr><td>Low</td><td>8.20</td><td>Pro</td></tr></table>
<p>Last updated: Aug 3, 2026</p>
`;

const flat = flattenHtml(PAGE);

test("a price target closing a sentence is not swallowed with the full stop", () => {
  const targets = parseConsensus(proseOf(flat));
  // `[\d,.]+` matched "302.83." here and parsed to NaN, which reported that no
  // consensus existed while the rating and analyst count were on screen.
  assert.equal(targets.average, 302.83);
  assert.equal(targets.count, 61);
  assert.equal(targets.consensus, "Strong Buy");
  assert.equal(targets.low, 180);
  assert.equal(targets.high, 500);
  assert.equal(targets.median, 300);
  assert.equal(targets.updated, "Aug 3, 2026");
});

test("one unreadable field does not discard the rest", () => {
  const withoutTable = proseOf(flattenHtml(PAGE.replace(/<table><tr><td>Target[\s\S]*?<\/table>/, "")))
    .replace("average price target of $302.83", "average price target of $unreadable");
  const targets = parseConsensus(withoutTable);
  assert.equal(targets.average, null);
  assert.equal(targets.low, 180);
  assert.equal(targets.high, 500);
  assert.equal(targets.consensus, "Strong Buy");
});

test("withheld and unreported cells are absent, never zero", () => {
  assert.equal(parseCell("Upgrade"), null);
  assert.equal(parseCell("Pro"), null);
  assert.equal(parseCell("-"), null);
  assert.equal(parseCell(""), null);
  assert.equal(parseCell(undefined), null);
  assert.equal(parseCell("215.94B"), 215.94e9);
  assert.equal(parseCell("1,234"), 1234);
  assert.equal(parseCell("82.39%"), 82.39);
  assert.equal(parseCell("4.77"), 4.77);
});

test("the fiscal table aligns each metric to its own year", () => {
  const years = parseFiscalYears(flat);
  assert.equal(years.length, 4);
  assert.deepEqual(years.map((row) => row.label), ["FY 2025", "FY 2026", "FY 2027", "FY 2028"]);

  const fy2026 = years[1];
  assert.equal(fy2026.revenue, 215.94e9);
  assert.equal(fy2026.eps, 4.77);
  assert.equal(fy2026.forecast, false);

  // A year the publisher withholds keeps its column rather than shifting the
  // series left, which is what put one year's revenue beside another's EPS.
  assert.equal(years[3].revenue, null);
});

test("the forecast year is the one carrying an analyst count", () => {
  const years = parseFiscalYears(flat);
  const forecast = years.filter((row) => row.forecast);
  assert.equal(forecast.length, 1);
  assert.equal(forecast[0].label, "FY 2027");
  assert.equal(forecast[0].analysts, 53);
  assert.equal(forecast[0].revenue, 393.85e9);
  assert.equal(forecast[0].eps, 9);
});

test("forecast ranges read the nearest published year", () => {
  const revenue = parseForecastRange(flat, "Revenue");
  assert.deepEqual(revenue, { year: "2027", high: 415.5e9, average: 393.9e9, low: 358.4e9 });

  const eps = parseForecastRange(flat, "EPS");
  assert.deepEqual(eps, { year: "2027", high: 9.85, average: 9, low: 8.2 });
});

test("a page without a forecast section yields nothing rather than throwing", () => {
  const empty = flattenHtml("<p>No coverage for this issuer.</p>");
  assert.deepEqual(parseFiscalYears(empty), []);
  assert.equal(parseForecastRange(empty, "Revenue"), null);
  const targets = parseConsensus(proseOf(empty));
  assert.equal(targets.count, null);
  assert.equal(targets.average, null);
});
