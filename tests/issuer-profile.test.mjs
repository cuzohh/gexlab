import assert from "node:assert/strict";
import test from "node:test";

import { flattenHtml, proseOf } from "../src/lib/analyst-forecast.ts";
import {
  cellsOf,
  labelledValue,
  parseDividendCell,
  parseDividendDetail,
  parseIssuerProfile,
  parseMoneyCell,
  parsePercentCell,
  parseRange,
  parseUsDate,
} from "../src/lib/issuer-profile.ts";

/**
 * A cut of the published quote page, reduced to the structures the parser
 * reads. The shapes here are the ones that matter in practice: a statistics
 * table whose label and value are separated by empty cells, a "Dividends"
 * navigation link sitting above the "Dividend" statistic, and a description
 * introduced by an "About TICKER" heading.
 */
const QUOTE_PAGE = `
<nav><a>Dividends</a><a>History</a><a>Profile</a></nav>
<table>
<tr><td>Market Cap</td><td>4.57T</td><td>+44.5%</td></tr>
<tr><td>Revenue (ttm)</td><td>466.82B</td></tr>
<tr><td>Shares Out</td><td></td><td></td><td>14.59B</td></tr>
<tr><td>PE Ratio</td><td>35.94</td></tr>
<tr><td>Forward PE</td><td>34.26</td></tr>
<tr><td>Dividend</td><td>$1.08 (0.34%)</td></tr>
<tr><td>Ex-Dividend Date </td><td>Aug 10, 2026</td></tr>
<tr><td>52-Week Range</td><td>216.58 - 344.57</td></tr>
<tr><td>Beta</td><td>1.09</td></tr>
<tr><td>Earnings Date</td><td>Jul 30, 2026</td></tr>
</table>
<h2>About AAPL</h2>
<p>Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets,
wearables, and accessories worldwide. The company offers iPhone, a line of smartphones; Mac, a line
of personal computers; and iPad, a line of multi-purpose tablets. It also provides services.
It was incorporated in 1977 and is headquartered in Cupertino, California.</p>
`;

const DIVIDEND_PAGE = `
<table>
<tr><td>Dividend Yield </td><td>0.34%</td></tr>
<tr><td>Annual Dividend</td><td></td><td>$1.08</td></tr>
<tr><td>Ex-Dividend Date </td><td>Aug 10, 2026</td></tr>
<tr><td>Payout Frequency </td><td>Quarterly</td></tr>
<tr><td>Payout Ratio </td><td>12.39%</td></tr>
<tr><td>Dividend Growth</td><td>(1Y)</td><td>3.92%</td></tr>
<tr><td>Growth Years </td><td>14</td></tr>
<tr><td>Buyback Yield </td><td>2.13%</td></tr>
<tr><td>Shareholder Yield </td><td>2.47%</td></tr>
</table>
`;

test("a statistic is read from the cell after its label, across empty cells", () => {
  const cells = cellsOf(flattenHtml(QUOTE_PAGE));
  assert.equal(labelledValue(cells, "Market Cap"), "4.57T");
  assert.equal(labelledValue(cells, "Shares Out"), "14.59B");
});

test("the label match is exact, so the navigation link is not read as the statistic", () => {
  const cells = cellsOf(flattenHtml(QUOTE_PAGE));
  // "Dividends" precedes "Dividend" in the document and is followed by "History".
  assert.equal(labelledValue(cells, "Dividend"), "$1.08 (0.34%)");
});

test("an absent label is absent rather than the next value on the page", () => {
  const cells = cellsOf(flattenHtml(QUOTE_PAGE));
  assert.equal(labelledValue(cells, "Short Interest"), null);
});

test("US dates parse to calendar dates and reject anything else", () => {
  assert.equal(parseUsDate("Jul 30, 2026"), "2026-07-30");
  assert.equal(parseUsDate("Aug 4, 2026"), "2026-08-04");
  assert.equal(parseUsDate("September 12, 2026"), "2026-09-12");
  assert.equal(parseUsDate("n/a"), null);
  assert.equal(parseUsDate(null), null);
  // A month that does not exist is not a date.
  assert.equal(parseUsDate("Foo 3, 2026"), null);
});

test("percent, money and range cells parse, and a withheld cell stays null", () => {
  assert.equal(parsePercentCell("12.39%"), 12.39);
  assert.equal(parsePercentCell("-3.92%"), -3.92);
  assert.equal(parsePercentCell("n/a"), null);
  assert.equal(parseMoneyCell("$1.08"), 1.08);
  assert.equal(parseMoneyCell("-"), null);
  assert.deepEqual(parseRange("216.58 - 344.57"), { low: 216.58, high: 344.57 });
  assert.equal(parseRange("216.58"), null);
});

test("the dividend cell yields the amount and the yield separately", () => {
  assert.deepEqual(parseDividendCell("$1.08 (0.34%)"), { amount: 1.08, yield: 0.34 });
  // An issuer that pays nothing has no dividend, which is not a dividend of zero.
  assert.deepEqual(parseDividendCell("n/a"), { amount: null, yield: null });
  assert.deepEqual(parseDividendCell(null), { amount: null, yield: null });
});

test("the quote page yields the earnings date, the dividend and the description", () => {
  const flat = flattenHtml(QUOTE_PAGE);
  const profile = parseIssuerProfile(flat, proseOf(flat), "AAPL");
  assert.equal(profile.earningsDate, "2026-07-30");
  assert.equal(profile.exDividendDate, "2026-08-10");
  assert.equal(profile.dividend, 1.08);
  assert.equal(profile.dividendYield, 0.34);
  assert.equal(profile.peRatio, 35.94);
  assert.equal(profile.forwardPe, 34.26);
  assert.equal(profile.beta, 1.09);
  assert.equal(profile.marketCap, 4.57e12);
  assert.equal(profile.sharesOut, 14.59e9);
  assert.deepEqual(profile.weekRange, { low: 216.58, high: 344.57 });
  assert.ok(profile.description?.startsWith("Apple Inc. designs"));
  // Cut at a sentence boundary rather than mid-word.
  assert.ok(profile.description?.endsWith("."));
  assert.ok(profile.description.length < 520);
});

test("the dividend page yields the payout record including the buyback", () => {
  const detail = parseDividendDetail(flattenHtml(DIVIDEND_PAGE));
  assert.deepEqual(detail, {
    dividendYield: 0.34,
    annualDividend: 1.08,
    exDividendDate: "2026-08-10",
    payoutFrequency: "Quarterly",
    payoutRatio: 12.39,
    growth1Y: 3.92,
    growthYears: 14,
    buybackYield: 2.13,
    shareholderYield: 2.47,
  });
});

test("a page carrying none of the statistics resolves to nulls, not to zeroes", () => {
  const flat = flattenHtml("<p>This ticker is not covered.</p>");
  const profile = parseIssuerProfile(flat, proseOf(flat), "ZZZZ");
  assert.equal(profile.earningsDate, null);
  assert.equal(profile.dividend, null);
  assert.equal(profile.marketCap, null);
  assert.equal(profile.description, null);
});
