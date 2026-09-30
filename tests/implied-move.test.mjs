import assert from "node:assert/strict";
import test from "node:test";

import { impliedMove, impliedMoves, impliedVolAt, usableSlices, yearsBetween } from "../src/lib/implied-move.ts";

/** A term structure shaped like a real one: steep at the front, flat at the back. */
const SURFACE = [
  { expiry: "2026-08-10", years: 3 / 365, atmIv: 0.2395 },
  { expiry: "2026-08-21", years: 14 / 365, atmIv: 0.3393 },
  { expiry: "2026-09-04", years: 28 / 365, atmIv: 0.4026 },
  { expiry: "2026-09-11", years: 35 / 365, atmIv: 0.3922 },
  { expiry: "2027-06-17", years: 314 / 365, atmIv: 0.4161 },
  { expiry: "2027-09-17", years: 406 / 365, atmIv: 0.4156 },
];

test("slices without a usable quote are dropped, and the rest sorted by maturity", () => {
  const messy = [
    { expiry: "c", years: 0.5, atmIv: 0.3 },
    { expiry: "x", years: 0.1, atmIv: null },
    { expiry: "y", years: null, atmIv: 0.4 },
    { expiry: "z", years: 0.2, atmIv: 0 },
    { expiry: "a", years: 0.05, atmIv: 0.6 },
  ];
  assert.deepEqual(usableSlices(messy).map((s) => s.expiry), ["a", "c"]);
});

test("a horizon sitting on a listed expiry uses that expiry's quote", () => {
  const quote = impliedVolAt(SURFACE, 28 / 365);
  assert.equal(quote.basis, "listed");
  assert.equal(quote.iv, 0.4026);
  assert.deepEqual(quote.expiries, ["2026-09-04"]);
});

test("a horizon between expiries interpolates in total variance, not in volatility", () => {
  // Midpoint in time between 28d (0.4026) and 35d (0.3922).
  const years = 31.5 / 365;
  const quote = impliedVolAt(SURFACE, years);
  assert.equal(quote.basis, "interpolated");
  assert.deepEqual(quote.expiries, ["2026-09-04", "2026-09-11"]);

  const left = 0.4026 ** 2 * (28 / 365);
  const right = 0.3922 ** 2 * (35 / 365);
  const expected = Math.sqrt(((left + right) / 2) / years);
  assert.ok(Math.abs(quote.iv - expected) < 1e-12);

  // Averaging the volatilities directly would give a different, wrong answer.
  const naive = (0.4026 + 0.3922) / 2;
  assert.ok(Math.abs(quote.iv - naive) > 1e-6);
});

test("a horizon outside the listed range is refused rather than extrapolated", () => {
  // One day, when the nearest listed expiry is three days out.
  assert.equal(impliedVolAt(SURFACE, 1 / 365), null);
  // Two years, when the book stops near thirteen months.
  assert.equal(impliedVolAt(SURFACE, 2), null);
  assert.equal(impliedVolAt(SURFACE, 0), null);
  assert.equal(impliedVolAt([], 0.1), null);
});

test("the move is spot times volatility times the root of time", () => {
  const quote = impliedVolAt(SURFACE, 3 / 365);
  const move = impliedMove(223.8, quote, "Next session");
  assert.ok(Math.abs(move.dollars - 223.8 * 0.2395 * Math.sqrt(3 / 365)) < 1e-9);
  assert.ok(Math.abs(move.percent - (move.dollars / 223.8) * 100) < 1e-9);
  assert.ok(Math.abs(move.lower - (223.8 - move.dollars)) < 1e-9);
  assert.ok(Math.abs(move.upper - (223.8 + move.dollars)) < 1e-9);
});

test("a longer horizon implies a larger move on a flat term structure", () => {
  const flat = [
    { expiry: "near", years: 30 / 365, atmIv: 0.4 },
    { expiry: "far", years: 365 / 365, atmIv: 0.4 },
  ];
  const month = impliedMove(100, impliedVolAt(flat, 30 / 365), "1 month");
  const year = impliedMove(100, impliedVolAt(flat, 1), "1 year");
  assert.ok(year.dollars > month.dollars);
  // √12 times the horizon is √12 times the move when volatility does not change.
  assert.ok(Math.abs(year.dollars / month.dollars - Math.sqrt(365 / 30)) < 1e-9);
});

test("each horizon resolves on its own, so one gap does not remove the rest", () => {
  const results = impliedMoves(SURFACE, 223.8, [
    { label: "Next session", years: 3 / 365 },
    { label: "1 month", years: 30 / 365 },
    { label: "1 year", years: 1 },
    { label: "5 years", years: 5 },
  ]);
  assert.equal(results.length, 4);
  assert.ok(results[0].move);
  assert.ok(results[1].move);
  assert.ok(results[2].move);
  // Beyond the listed book, so absent rather than invented.
  assert.equal(results[3].move, null);
});

test("year fractions use the surface's own calendar-time convention", () => {
  const from = Date.parse("2026-08-07T20:00:00Z");
  const to = Date.parse("2026-08-10T20:00:00Z");
  assert.ok(Math.abs(yearsBetween(from, to) - 3 / 365) < 1e-12);
});

test("a spot that is not a positive price yields no move", () => {
  const quote = impliedVolAt(SURFACE, 30 / 365);
  assert.equal(impliedMove(0, quote, "1 month"), null);
  assert.equal(impliedMove(Number.NaN, quote, "1 month"), null);
});
