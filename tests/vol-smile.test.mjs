import assert from "node:assert/strict";
import test from "node:test";

import { fitSmile } from "../src/lib/vol-smile.ts";

const SPOT = 100;

/** A well-quoted smile: volatility rises smoothly into both wings. */
function smileQuotes({ strikes = 25, spread = 0.02 } = {}) {
  return Array.from({ length: strikes }, (_, index) => {
    // Rounded first: the volatility has to belong to the strike that is
    // actually fitted, or the curve is chasing a rounding error.
    const strike = Number((SPOT * (0.8 + (index * 0.4) / (strikes - 1))).toFixed(2));
    const moneyness = Math.log(strike / SPOT);
    const iv = 0.3 + 0.6 * moneyness * moneyness - 0.15 * moneyness;
    const mid = 2 + Math.abs(moneyness) * 3;
    return {
      strike,
      iv,
      openInterest: 500,
      volume: 100,
      bid: mid * (1 - spread / 2),
      ask: mid * (1 + spread / 2),
      // Enough vega that the tight spread above resolves the volatility well.
      vega: 0.2,
    };
  });
}

test("a clean smile has no dislocations against its own curve", () => {
  const fit = fitSmile(smileQuotes(), SPOT);
  assert.ok(fit);
  assert.equal(fit.dislocations.length, 0, "a smooth smile should not flag itself");
  assert.ok(fit.points.length >= 20);
  // Residuals against a quadratic that generated the data are numerical dust.
  for (const point of fit.points) assert.ok(Math.abs(point.residual) < 1e-6);
});

test("one strike bid away from the curve is found, with the right sign and size", () => {
  const quotes = smileQuotes();
  const target = quotes[18];
  target.iv += 0.08; // eight volatility points richer than its neighbours
  const fit = fitSmile(quotes, SPOT);
  assert.ok(fit);
  assert.equal(fit.dislocations.length, 1);
  assert.equal(fit.dislocations[0].strike, target.strike);
  assert.ok(fit.dislocations[0].residual > 0, "a richer strike must read positive");
  // The fit is dragged slightly by the outlier, so the residual is a little
  // under the eight points injected — but it must be unmistakably large.
  assert.ok(fit.dislocations[0].residual > 0.05, `expected a large residual, got ${fit.dislocations[0].residual}`);
});

test("a strike priced below the curve reads negative, not merely 'dislocated'", () => {
  const quotes = smileQuotes();
  quotes[8].iv -= 0.07;
  const fit = fitSmile(quotes, SPOT);
  assert.ok(fit);
  assert.equal(fit.dislocations.length, 1);
  assert.ok(fit.dislocations[0].residual < 0, "a cheap strike must read negative");
});

test("wide markets are rejected rather than reported as volatility spikes", () => {
  // The failure mode the whole module exists to avoid: an untraded strike whose
  // mid is meaningless prints an implied volatility that looks like structure.
  const quotes = smileQuotes();
  quotes[12].bid = 0.05;
  quotes[12].ask = 4;
  quotes[12].vega = 0.2; // a wide market, not a small one
  quotes[12].iv += 0.5;
  const fit = fitSmile(quotes, SPOT);
  assert.ok(fit);
  assert.equal(fit.rejected.illiquid, 1);
  assert.ok(!fit.points.some((point) => point.strike === quotes[12].strike), "a wide market must not reach the fit");
  assert.equal(fit.dislocations.length, 0);
});

test("unquoted, crossed and volatility-less strikes are counted separately", () => {
  const quotes = smileQuotes();
  quotes[3].iv = null;
  quotes[4].bid = 0;
  quotes[4].ask = 0;
  quotes[5].bid = 3;
  quotes[5].ask = 1; // crossed
  const fit = fitSmile(quotes, SPOT);
  assert.ok(fit);
  assert.equal(fit.rejected.unquoted, 3);
  assert.equal(fit.rejected.illiquid, 0);
});

test("a strike with no open interest and no volume is not read", () => {
  const quotes = smileQuotes();
  quotes[10].openInterest = 0;
  quotes[10].volume = 0;
  const fit = fitSmile(quotes, SPOT);
  assert.ok(fit);
  assert.equal(fit.rejected.illiquid, 1);
  // Traded today is enough on its own, even with no open interest yet.
  const traded = smileQuotes();
  traded[10].openInterest = 0;
  traded[10].volume = 40;
  assert.equal(fitSmile(traded, SPOT).rejected.illiquid, 0);
  // But a single lot is not a position worth reading a volatility from.
  const oneLot = smileQuotes();
  oneLot[10].openInterest = 0;
  oneLot[10].volume = 1;
  assert.equal(fitSmile(oneLot, SPOT).rejected.illiquid, 1);
});

test("too few usable strikes yields no curve rather than a confident wrong one", () => {
  const fit = fitSmile(smileQuotes().slice(0, 5), SPOT);
  assert.ok(fit);
  assert.deepEqual(fit.points, []);
  assert.deepEqual(fit.dislocations, []);
});

test("a nonsensical spot has no smile at all", () => {
  assert.equal(fitSmile(smileQuotes(), 0), null);
  assert.equal(fitSmile(smileQuotes(), -5), null);
});

test("the threshold scales with how noisy the surface already is", () => {
  // A scattered surface must not flag every strike; the same absolute
  // deviation that is an outlier on a clean name is ordinary noise here.
  const noisy = smileQuotes().map((quote, index) => ({
    ...quote,
    iv: quote.iv + (index % 2 ? 0.03 : -0.03),
  }));
  const fit = fitSmile(noisy, SPOT);
  assert.ok(fit);
  assert.ok(fit.noise > 0.01, "the noise estimate should reflect the scatter");
  assert.ok(fit.dislocations.length <= 2, `a uniformly scattered surface should not all be findings, got ${fit.dislocations.length}`);
});

test("a dislocated strike does not drag its neighbours into being findings", () => {
  // Leaving a strike out of its own prediction is not enough on its own: it
  // still sits in its neighbours' windows. Without the robustness step this
  // reported the dislocation plus two innocent strikes beside it.
  const quotes = smileQuotes();
  quotes[18].iv += 0.08;
  const fit = fitSmile(quotes, SPOT);
  assert.equal(fit.dislocations.length, 1, "only the strike that moved should be a finding");
  const neighbours = fit.points.filter((point) => Math.abs(point.strike - quotes[18].strike) < 2.5 && point.strike !== quotes[18].strike);
  assert.ok(neighbours.length >= 2);
  for (const neighbour of neighbours) {
    assert.ok(Math.abs(neighbour.residual) < 0.002, `neighbour at ${neighbour.strike} should sit on the curve, read ${neighbour.residual}`);
  }
});

test("an evenly scattered surface reports its scatter, not a page of findings", () => {
  // Residuals either side of the curve in equal measure put the median on one
  // arm, which made the deviation about the median read as almost nothing and
  // flagged most of the chain.
  const noisy = smileQuotes().map((quote, index) => ({ ...quote, iv: quote.iv + (index % 2 ? 0.03 : -0.03) }));
  const fit = fitSmile(noisy, SPOT);
  assert.ok(fit.noise > 0.02, `noise should reflect the scatter, read ${fit.noise}`);
  assert.equal(fit.dislocations.length, 0);
});

test("a strike is never a finding for less than its own quote can resolve", () => {
  // A local fit tracks a liquid smile to hundredths of a point, so without this
  // a strike could be flagged for a deviation smaller than its bid-ask.
  const quotes = smileQuotes();
  // Vega small enough that the tick-wide market leaves two volatility points
  // undetermined, then move the strike by less than that.
  quotes[14].vega = 0.004;
  quotes[14].bid = 1.99;
  quotes[14].ask = 2.01;
  quotes[14].iv += 0.015;
  const fit = fitSmile(quotes, SPOT);
  const flagged = fit.dislocations.some((point) => point.strike === quotes[14].strike);
  assert.equal(flagged, false, "a move inside the spread's own ambiguity is not a finding");
});

test("the outermost strikes get no verdict, because they have one-sided neighbours", () => {
  const quotes = smileQuotes();
  quotes[0].iv += 0.4;
  quotes[quotes.length - 1].iv += 0.4;
  const fit = fitSmile(quotes, SPOT);
  for (const point of fit.dislocations) {
    assert.ok(point.strike !== quotes[0].strike && point.strike !== quotes.at(-1).strike,
      "an edge strike cannot be judged against a curve that only exists on one side of it");
  }
});
