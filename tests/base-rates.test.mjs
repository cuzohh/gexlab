import assert from "node:assert/strict";
import test from "node:test";

import { baseRates, drawdownSeries, rsiSeries } from "../src/lib/base-rates.ts";

/** A deterministic price path: a long rise, a sharp fall, then a recovery. */
function syntheticBars(count = 900) {
  const bars = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const cycle = index % 300;
    // Rise for 200 sessions, fall hard for 50, recover over 50.
    const drift = cycle < 200 ? 0.0015 : cycle < 250 ? -0.006 : 0.004;
    // A fixed wobble keeps the series from being monotone without randomness.
    close *= 1 + drift + Math.sin(index / 7) * 0.002;
    const date = new Date(Date.UTC(2018, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
    bars.push({ date, close });
  }
  return bars;
}

test("relative strength stays inside its bounds and reacts to direction", () => {
  const rising = Array.from({ length: 60 }, (_, index) => ({ date: `d${index}`, close: 100 + index }));
  const falling = Array.from({ length: 60 }, (_, index) => ({ date: `d${index}`, close: 200 - index }));
  const up = rsiSeries(rising).at(-1);
  const down = rsiSeries(falling).at(-1);
  assert.ok(up !== null && down !== null);
  assert.ok(up > 95, `unbroken advance should read overbought, got ${up}`);
  assert.ok(down < 5, `unbroken decline should read oversold, got ${down}`);
  for (const value of rsiSeries(syntheticBars(400))) {
    if (value === null) continue;
    assert.ok(value >= 0 && value <= 100);
  }
});

test("relative strength is null until enough closes exist", () => {
  const short = Array.from({ length: 10 }, (_, index) => ({ date: `d${index}`, close: 100 + index }));
  assert.deepEqual(new Set(rsiSeries(short)), new Set([null]));
});

test("drawdown is zero at a new high and positive below one", () => {
  const bars = Array.from({ length: 60 }, (_, index) => ({ date: `d${index}`, close: 100 + index }));
  assert.equal(drawdownSeries(bars).at(-1), 0);
  const fallen = [...bars, { date: "d60", close: 80 }];
  const last = drawdownSeries(fallen).at(-1);
  assert.ok(last !== null && last > 45 && last < 50, `expected roughly 50% below the high, got ${last}`);
});

test("the rolling-window drawdown matches a naive rescan exactly", () => {
  // The optimised version carries the window maximum forward in a monotonic
  // queue. It has to agree with the obvious implementation on every bar,
  // including the flat stretches and the ties the queue prunes.
  const naive = (bars, window = 252) => bars.map((bar, index) => {
    if (index < 20) return null;
    let high = 0;
    for (let back = Math.max(0, index - window + 1); back <= index; back += 1) {
      if (bars[back].close > high) high = bars[back].close;
    }
    return high > 0 ? ((high - bar.close) / high) * 100 : null;
  });

  for (const bars of [
    syntheticBars(900),
    // A flat series is all ties, which is what prunes the queue most.
    Array.from({ length: 400 }, (_, index) => ({ date: `d${index}`, close: 50 })),
    // A monotone decline never prunes; a monotone rise always does.
    Array.from({ length: 400 }, (_, index) => ({ date: `d${index}`, close: 500 - index })),
    Array.from({ length: 400 }, (_, index) => ({ date: `d${index}`, close: 100 + index })),
  ]) {
    assert.deepEqual(drawdownSeries(bars), naive(bars));
    // Also across a window shorter than the series, where the queue must evict.
    assert.deepEqual(drawdownSeries(bars, 40), naive(bars, 40));
  }
});

test("base rates need a decade of bars and report nothing on a short series", () => {
  assert.equal(baseRates(syntheticBars(200)), null);
});

test("base rates describe a distribution, ordered and internally consistent", () => {
  const rates = baseRates(syntheticBars());
  assert.ok(rates, "a long synthetic series should produce a result");
  assert.ok(rates.setup.rsi !== null && rates.setup.drawdown !== null);
  assert.ok(rates.setup.drawdown >= 0);
  for (const outcome of rates.outcomes) {
    assert.ok(outcome.samples >= 20, "an outcome is only reported with enough matches");
    assert.ok(outcome.worst <= outcome.p10, "worst case cannot exceed the tenth percentile");
    assert.ok(outcome.p10 <= outcome.median);
    assert.ok(outcome.median <= outcome.p90);
    assert.ok(outcome.p90 <= outcome.best);
    assert.ok(outcome.positiveShare >= 0 && outcome.positiveShare <= 100);
  }
  // Episodes count runs, so they can never exceed the days that formed them.
  assert.ok(rates.episodes <= rates.matches);
});

test("matches are only counted where a full forward window exists", () => {
  const rates = baseRates(syntheticBars());
  assert.ok(rates);
  // Every reported outcome draws from days old enough to have resolved, so no
  // outcome may claim more samples than there were matching days.
  for (const outcome of rates.outcomes) assert.ok(outcome.samples <= rates.matches);
});
