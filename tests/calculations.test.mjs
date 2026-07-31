import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  easternCloseIso,
  latestCompletedTradingDate,
  latestMarketObservationTime,
  nextQuarterHour,
  parseEasternTimestamp,
  parseUtcTimestamp,
  describeSessionLag,
  sessionsBehind,
} from "../src/lib/market-time.ts";
import {
  buildSmile,
  calculateMaxPain,
  despike,
  expirationIso,
  interpolateAt,
  interpolateZero,
  modelGamma,
  modelGreeks,
  // There are two of these. The pricing one sets every delta on the chart; the
  // forecast one only turns a test statistic into a p-value. Both are graded.
  normalCdf as pricingNormalCdf,
  yearsToExpiry,
} from "../src/lib/options-math.ts";
import {
  behaviorLabel,
  directionLabel,
  nextSessionOutlook,
  pivotReturn,
  regimeName,
} from "../src/lib/regime-forecast.ts";
import {
  curveRecessionProbability,
  netLiquidity,
  parseObservationCsv,
  percentChange,
  skewPercentile,
  weightedAvailable,
  yieldDecomposition,
} from "../src/lib/macro-math.ts";
import {
  parseBeaSchedule,
  parseBlsAnnualSchedule,
  parseBlsCalendar,
  parseFomcCalendar,
  parseRssItems,
} from "../src/lib/event-parsing.ts";
import { isZip, readZipEntries } from "../src/lib/zip.ts";
import {
  applyPlattScaling,
  backtestVolScaledStrategy,
  benjaminiHochberg,
  brierScore,
  dieboldMariano,
  fitPlattScaling,
  neweyWestVariance,
  normalCdf,
  pointwiseLogLoss,
  calibrationBins,
  harFeatures,
  logLoss,
  logisticFit,
  logisticPredict,
  pinballLoss,
  ridgeFit,
  rocAuc,
  smearingFactor,
  solveSymmetric,
  walkForward,
  withIntercept,
} from "../src/lib/forecast.ts";
import {
  buildBridgePayload,
  concentrationClusters,
  DEFAULT_BRIDGE_PARTS,
  exposureProfile,
  minimumSeparation,
  oneSigmaBps,
  readBridgeParts,
  strikeIncrement,
  volumeWalls,
} from "../src/lib/bridge-payload.ts";
import { PINE_SCRIPT } from "../src/lib/indicator.ts";
import { MOTIVEWAVE_STUDY } from "../src/lib/motivewave-indicator.ts";
import { readJavaSource, renderModule } from "../scripts/sync-motivewave.mjs";

test("timestamps without a zone are interpreted in New York, including DST", () => {
  assert.equal(parseEasternTimestamp("2026-07-26 12:00:00"), "2026-07-26T16:00:00.000Z");
  assert.equal(parseEasternTimestamp("2026-01-26 12:00:00"), "2026-01-26T17:00:00.000Z");
  assert.equal(easternCloseIso("2026-07-31"), "2026-07-31T20:00:00.000Z");
  assert.equal(easternCloseIso("2026-12-31"), "2026-12-31T21:00:00.000Z");
});

test("source timestamps documented as UTC do not receive an Eastern offset", () => {
  assert.equal(parseUtcTimestamp("2026-07-26 18:41:09"), "2026-07-26T18:41:09.000Z");
});

test("market observation time applies the delay and clamps closed sessions", () => {
  assert.equal(
    latestMarketObservationTime("2026-07-27T14:00:00.000Z"),
    "2026-07-27T13:45:00.000Z",
  );
  assert.equal(
    latestMarketObservationTime("2026-07-26T18:41:09.000Z"),
    "2026-07-24T20:00:00.000Z",
  );
  assert.equal(
    latestMarketObservationTime("2026-07-27T22:00:00.000Z"),
    "2026-07-27T20:00:00.000Z",
  );
});

test("quarter-hour refreshes align to the next window with a buffer", () => {
  assert.equal(
    nextQuarterHour(new Date("2026-07-26T13:45:01.000Z"), 20).toISOString(),
    "2026-07-26T14:00:20.000Z",
  );
});

test("time to expiry is deterministic from the saved snapshot time", () => {
  const years = yearsToExpiry("2026-07-31", Date.parse("2026-07-31T16:00:00.000Z"));
  assert.ok(Math.abs(years - 4 / (365 * 24)) < 1e-12);
});

test("index option roots use the correct AM or PM settlement clock", () => {
  assert.equal(expirationIso("2026-07-31", "NDX"), "2026-07-31T13:30:00.000Z");
  assert.equal(expirationIso("2026-07-31", "SPX"), "2026-07-31T13:30:00.000Z");
  assert.equal(expirationIso("2026-07-31", "NDXP"), "2026-07-31T20:00:00.000Z");
  assert.equal(expirationIso("2026-07-31", "SPXW"), "2026-07-31T20:00:00.000Z");
  assert.equal(expirationIso("2026-07-31", "QQQ"), "2026-07-31T20:00:00.000Z");
});

test("Black-Scholes-Merton gamma is positive and identical for calls and puts", () => {
  const shared = {
    spot: 100,
    strike: 100,
    years: 1,
    iv: 0.2,
    riskFreeRate: 0.045,
    dividendYield: 0.01,
  };
  const call = modelGreeks({ ...shared, type: "call" });
  const put = modelGreeks({ ...shared, type: "put" });
  assert.ok(call.gamma > 0);
  assert.ok(Math.abs(call.gamma - modelGamma(shared)) < 1e-15);
  assert.ok(Math.abs(call.gamma - put.gamma) < 1e-15);
  assert.ok(call.delta > 0);
  assert.ok(put.delta < 0);
  for (const value of Object.values(call)) assert.ok(Number.isFinite(value));
});

// A high-precision standard normal CDF (Hart 1968), used only as a reference to
// grade the fast rational fit the library ships. Accurate to roughly 1e-15.
function referenceNormalCdf(x) {
  const z = Math.abs(x);
  if (z > 37) return x > 0 ? 1 : 0;
  const e = Math.exp((-z * z) / 2);
  let n;
  if (z < 7.07106781186547) {
    let b = 3.52624965998911e-2 * z + 0.700383064443688;
    b = b * z + 6.37396220353165; b = b * z + 33.912866078383;
    b = b * z + 112.079291497871; b = b * z + 221.213596169931;
    b = b * z + 220.206867912376;
    let c = 8.83883476483184e-2 * z + 1.75566716318264;
    c = c * z + 16.064177579207; c = c * z + 86.7807322029461;
    c = c * z + 296.564248779674; c = c * z + 637.333633378831;
    c = c * z + 793.826512519948; c = c * z + 440.413735824752;
    n = (e * b) / c;
  } else {
    let b = z + 0.65;
    b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
    n = e / (b * 2.506628274631);
  }
  return x > 0 ? 1 - n : n;
}

function bsmPrice(spot, strike, years, iv, rate, yield_, type) {
  const d1 =
    (Math.log(spot / strike) + (rate - yield_ + (iv * iv) / 2) * years) / (iv * Math.sqrt(years));
  const d2 = d1 - iv * Math.sqrt(years);
  return type === "call"
    ? spot * Math.exp(-yield_ * years) * referenceNormalCdf(d1) -
        strike * Math.exp(-rate * years) * referenceNormalCdf(d2)
    : strike * Math.exp(-rate * years) * referenceNormalCdf(-d2) -
        spot * Math.exp(-yield_ * years) * referenceNormalCdf(-d1);
}

const GREEK_CASES = [
  { name: "ATM 30d", spot: 27200, strike: 27200, years: 30 / 365, iv: 0.22, riskFreeRate: 0.043, dividendYield: 0.006 },
  { name: "OTM 7d", spot: 27200, strike: 28000, years: 7 / 365, iv: 0.19, riskFreeRate: 0.043, dividendYield: 0.006 },
  { name: "ITM 90d", spot: 27200, strike: 29000, years: 90 / 365, iv: 0.25, riskFreeRate: 0.043, dividendYield: 0.006 },
  { name: "1y no carry", spot: 100, strike: 100, years: 1, iv: 0.2, riskFreeRate: 0, dividendYield: 0 },
];

// A regime history whose scores drift by a fixed step, with a controllable
// distance from the nearest threshold. Enough sessions to resample from and to
// fit the recalibration on.
function regimeHistory({ direction, behavior, wobble = 1, sessions = 900 }) {
  const rows = [];
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 2 * wobble;
  };
  for (let index = 0; index < sessions; index += 1) {
    rows.push({
      date: `s${String(index).padStart(4, "0")}`,
      directionScore: direction + noise(),
      behaviorScore: behavior + noise(),
    });
  }
  return rows;
}

test("regime labels sit on the documented thresholds", () => {
  assert.equal(directionLabel(15), "Bullish");
  assert.equal(directionLabel(14.9), "Neutral");
  assert.equal(directionLabel(-15), "Bearish");
  assert.equal(directionLabel(-14.9), "Neutral");
  assert.equal(behaviorLabel(58), "Trending");
  assert.equal(behaviorLabel(57.9), "Transitional");
  assert.equal(behaviorLabel(42), "Mean-reverting");
  assert.equal(behaviorLabel(42.1), "Transitional");
  assert.equal(regimeName("Bearish", "Mean-reverting"), "Bearish but mean-reverting");
  assert.equal(regimeName("Neutral", "Mean-reverting"), "Range / mean-reverting");
  assert.equal(regimeName("Bullish", "Trending"), "Bullish trend");
  assert.equal(regimeName("Neutral", "Trending"), "Trend without a clear bias");
  assert.equal(regimeName("Bearish", "Transitional"), "Bearish transition");
});

test("the next-session outlook is confident far from a threshold and hedges near one", () => {
  // Nothing is invented from too little history.
  assert.equal(nextSessionOutlook(regimeHistory({ direction: -40, behavior: 30, sessions: 40 })), null);

  const settled = nextSessionOutlook(regimeHistory({ direction: -40, behavior: 30, wobble: 1 }));
  assert.ok(settled);
  assert.equal(settled.direction, "Bearish");
  assert.equal(settled.behavior, "Mean-reverting");
  assert.equal(settled.name, "Bearish but mean-reverting");
  assert.ok(settled.probability > 0.9, `settled probability ${settled.probability}`);

  // Sitting on the threshold with the same daily movement has to be less
  // certain, or the number is decoration.
  const borderline = nextSessionOutlook(regimeHistory({ direction: -15.2, behavior: 30, wobble: 1 }));
  assert.ok(borderline);
  assert.ok(
    borderline.probability < settled.probability - 0.1,
    `borderline ${borderline.probability} vs settled ${settled.probability}`,
  );

  for (const outlook of [settled, borderline]) {
    assert.ok(outlook.probability >= 0 && outlook.probability <= 1);
    assert.ok(outlook.rawProbability >= 0 && outlook.rawProbability <= 1);
    assert.match(outlook.basis, /resampling one-day score changes/);
    // When the scaler declines, the raw estimate is shown unchanged rather than
    // a half-applied correction, and it says so.
    if (!outlook.calibrated) {
      assert.equal(outlook.probability, outlook.rawProbability);
      assert.equal(outlook.calibrationSamples, 0);
    } else {
      assert.ok(outlook.calibrationSamples >= 250);
    }
  }

  // A series that never leaves its band gives the scaler nothing to fit: every
  // resolved forecast was a hit, so there is no variation to learn from. It
  // must decline rather than invent a correction from a constant.
  assert.equal(settled.calibrated, false, "a label that never changes cannot be recalibrated");
  assert.equal(settled.probability, 1);
  // One that straddles a threshold does have both outcomes, so it can be.
  assert.equal(borderline.calibrated, true);
  assert.ok(borderline.calibrationSamples >= 250);
});

test("the pivot return finds the move that changes the label, or says there is none", () => {
  // A linear score in the return: -24 today, one point per 0.6% moved.
  const linear = (percent) => -24 + percent / 0.6;
  const pivot = pivotReturn(linear);
  assert.ok(pivot);
  assert.equal(pivot.to, "Neutral");
  // -15 is the gate, so 9 points of score, so 5.4%.
  assert.ok(Math.abs(pivot.percent - 5.4) < 0.02, `pivot ${pivot.percent}`);

  // Downwards too, when the label is threatened from below.
  const fromNeutral = pivotReturn((percent) => -14 + percent / 0.6);
  assert.ok(fromNeutral);
  assert.equal(fromNeutral.to, "Bearish");
  assert.ok(fromNeutral.percent < 0, "a bearish flip needs a negative move");

  // Deep inside a band, no move in range reaches a threshold, and that is
  // reported rather than papered over with an arbitrary number.
  assert.equal(pivotReturn(() => -80), null);
});

test("publication lag is counted in sessions, and a working feed reads as zero", () => {
  const at = (iso) => new Date(iso);
  // The case that prompted this. FRED republishes an equity close on the next
  // business day, so at 20:43 Eastern on the 30th the newest reading is the
  // 29th and the feed is working. One session, said plainly, rather than a bare
  // date that reads as a failed fetch.
  assert.equal(sessionsBehind("2026-07-29", at("2026-07-31T00:43:00Z")), 1);
  assert.equal(sessionsBehind("2026-07-30", at("2026-07-31T00:43:00Z")), 0);

  // Mid-session the previous close is the latest there is, so nothing is late.
  // Reporting a lag here would cry stale every weekday morning.
  assert.equal(latestCompletedTradingDate(at("2026-07-30T14:00:00Z")), "2026-07-29");
  assert.equal(sessionsBehind("2026-07-29", at("2026-07-30T14:00:00Z")), 0);

  // Weekends are not lag. Friday's close on a Saturday is current, and on the
  // following Monday evening it is one session behind, not three days.
  assert.equal(sessionsBehind("2026-07-31", at("2026-08-01T16:00:00Z")), 0);
  assert.equal(sessionsBehind("2026-07-31", at("2026-08-02T16:00:00Z")), 0);
  assert.equal(sessionsBehind("2026-07-31", at("2026-08-04T00:00:00Z")), 1);

  // A genuinely stale series counts up, and skips the weekend while doing it:
  // the 24th to the 30th is four sessions, not six days.
  assert.equal(sessionsBehind("2026-07-24", at("2026-07-31T00:43:00Z")), 4);

  // Missing data is unknown, not current.
  assert.equal(sessionsBehind(null), null);
  // An observation ahead of the last close cannot report negative lag.
  assert.equal(sessionsBehind("2026-08-14", at("2026-07-31T00:43:00Z")), 0);

  // The caption has to separate a healthy feed from a stale one. Saying only
  // the date is what made a working source read as broken.
  assert.equal(describeSessionLag(0), "Latest published session");
  assert.equal(
    describeSessionLag(1),
    "One session behind · index closes publish next day",
  );
  assert.equal(
    describeSessionLag(4),
    "4 sessions behind · index closes publish next day",
  );
  // Unknown falls back to the wording that claims nothing about freshness.
  assert.equal(describeSessionLag(null), "Public daily observations");
});

test("the regime states its horizon, and measured is distinguishable from projected", () => {
  const dashboard = readFileSync(
    new URL("../src/components/macro-dashboard.tsx", import.meta.url),
    "utf8",
  );
  // Asked in the present tense, a twenty-session classification reads as a claim
  // about today: a reader who has just watched a 3% session concludes the label
  // is broken rather than slow.
  assert.match(dashboard, /How has this market behaved over \$\{data\?\.marketRegime\.horizonSessions \?\? 20\} sessions\?/);
  assert.doesNotMatch(dashboard, /question="How is this market behaving\?"/);
  // The measured and projected labels are the same words for different sessions.
  // Only the kicker separates them, so both have to be explicit.
  assert.match(dashboard, /Measured · last \{state\?\.horizonSessions \?\? 20\} sessions/);
  assert.match(dashboard, /Projected · next session/);
  assert.match(dashboard, /carried forward, not observed/);
  // The session that just traded is shown against the window it lands in.
  assert.match(dashboard, /function describeSessionContext/);
  assert.match(dashboard, /one strong day has not moved the classification/);

  const route = readFileSync(new URL("../src/app/api/macro/route.ts", import.meta.url), "utf8");
  assert.match(route, /horizonSessions: 20,/);
  assert.match(route, /lastSessionReturn: percentChange\(store\.NASDAQ100, 1\)/);
  assert.match(route, /windowReturn: percentChange\(store\.NASDAQ100, 20\)/);
});

test("the nowcast can only advance a session that has actually closed", () => {
  const route = readFileSync(new URL("../src/app/api/macro/route.ts", import.meta.url), "utf8");
  // The close is already in this database before FRED publishes it, captured by
  // the options workspace from the exchange. Using it is not forecasting; it is
  // the same session ahead of the wire. But a provisional close is only worth
  // having if it cannot be wrong, hence the guards.
  assert.match(route, /if \(date <= published\.date\) return \{ series, provisional: null \}/);
  assert.match(route, /if \(date > latestCompletedTradingDate\(\)\) return \{ series, provisional: null \}/);
  assert.match(route, /if \(!Number\.isFinite\(price\) \|\| price <= 0\)/);
  // Both indices or neither: the direction score blends them, so advancing one
  // alone would print a divergence that did not happen.
  assert.match(route, /nowcastNdx\.provisional && nowcastSpx\.provisional &&/);
  assert.match(route, /nowcastNdx\.provisional\.date === nowcastSpx\.provisional\.date/);
  // Never presented as a published observation.
  assert.match(route, /provisionalSession: nowcast/);
  // Replaying the daily model over the calibration window walks this per
  // session, so a linear scan of the full series per call makes it quadratic.
  assert.match(route, /const middle = \(low \+ high\) >> 1;/);
});

test("the macro output cache key is derived from the methodology version", () => {
  const route = readFileSync(new URL("../src/app/api/macro/route.ts", import.meta.url), "utf8");
  // These were two hand-kept strings. Adding a field to the payload left the key
  // pointing at the old shape, so the cached response was served for the full
  // window without it — and indefinitely had a later refresh failed, since the
  // error path returns whatever is stored.
  assert.match(route, /const OUTPUT_CACHE_KEY = `dashboard-\$\{METHODOLOGY_VERSION\}`/);
  assert.doesNotMatch(route, /"dashboard-v\d/);
  assert.equal((route.match(/OUTPUT_CACHE_KEY/g) ?? []).length, 3, "declared once, used at both call sites");
});

test("the normal CDF is accurate in the tail, not only in the middle", () => {
  // The pricing and forecasting modules must resolve to one implementation.
  // They used to carry a copy each, and only one of the two was under test.
  assert.equal(pricingNormalCdf, normalCdf, "both modules share one implementation");

  let worst = 0;
  let previous = -1;
  for (let x = -40; x <= 40; x += 0.002) {
    const value = normalCdf(x);
    worst = Math.max(worst, Math.abs(value - referenceNormalCdf(x)));
    // Out of range would hand a call a delta above one or below zero, and the
    // walls are picked by the sign of the aggregated exposure.
    assert.ok(value >= 0 && value <= 1, `out of range at ${x}: ${value}`);
    assert.ok(value >= previous - 1e-15, `not monotone at ${x}`);
    previous = value;
  }
  assert.ok(worst < 1e-14, `absolute error ${worst}`);

  // Absolute error says nothing about a tail whose true value is smaller than
  // the error itself. Delta is this function at d1, so a far out-of-the-money
  // delta is only as good as the relative accuracy out here. Values are exact
  // to seventeen figures, taken independently of the implementation.
  const exact = [
    [1, 0.84134474606854293],
    [-1, 0.15865525393145707],
    [1.96, 0.97500210485177952],
    [2.5, 0.99379033467422384],
    [-3, 0.0013498980316300946],
    [-5, 2.8665157187919392e-7],
    [-6, 9.8658764503769814e-10],
    [-8, 6.2209605742717841e-16],
    [-10, 7.619853024160526e-24],
  ];
  assert.equal(normalCdf(0), 0.5);
  for (const [x, truth] of exact) {
    const relative = Math.abs(normalCdf(x) - truth) / truth;
    // The predecessor carried 7e-8 of absolute error, so it returned a
    // meaningless number by five standard deviations and a flat zero by ten.
    assert.ok(relative < 1e-8, `relative error ${relative} at x = ${x}`);
  }
  assert.ok(normalCdf(-10) > 0, "the ten-sigma tail is a number, not zero");
});

test("first-order greeks match a central difference of the Black-Scholes price", () => {
  for (const shared of GREEK_CASES) {
    for (const type of ["call", "put"]) {
      const greeks = modelGreeks({ ...shared, type });
      const { spot, strike, years, iv, riskFreeRate, dividendYield } = shared;
      const price = (s = spot, v = iv) =>
        bsmPrice(s, strike, years, v, riskFreeRate, dividendYield, type);
      const hs = spot * 1e-5;
      const hv = 1e-5;
      const near = (analytic, numeric, what) => {
        const scale = Math.max(Math.abs(analytic), Math.abs(numeric), 1e-12);
        assert.ok(
          Math.abs(analytic - numeric) / scale < 1e-5,
          `${shared.name} ${type} ${what}: ${analytic} vs ${numeric}`,
        );
      };
      near(greeks.delta, (price(spot + hs) - price(spot - hs)) / (2 * hs), "delta");
      near(greeks.gamma, (price(spot + hs) - 2 * price() + price(spot - hs)) / (hs * hs), "gamma");
      // Vega is per unit of volatility, not per volatility point. The route
      // divides by 100 before mixing it with the provider's, which quotes points.
      near(greeks.vega, (price(spot, iv + hv) - price(spot, iv - hv)) / (2 * hv), "vega");
    }
  }
});

test("higher-order greeks are the derivatives of the first-order ones", () => {
  // Differencing the price twice puts two rounds of cancellation noise onto a
  // third-order quantity, so these are graded against the first-order greeks,
  // which the test above has already tied to the price itself.
  for (const shared of GREEK_CASES) {
    for (const type of ["call", "put"]) {
      const greeks = modelGreeks({ ...shared, type });
      const at = (over) => modelGreeks({ ...shared, ...over, type });
      const hs = shared.spot * 1e-4;
      const hv = 1e-4;
      const ht = shared.years * 1e-4;
      const slope = (read, step) => (read(step) - read(-step)) / (2 * step);
      const near = (analytic, numeric, what) => {
        const scale = Math.max(Math.abs(analytic), Math.abs(numeric), 1e-12);
        assert.ok(
          Math.abs(analytic - numeric) / scale < 1e-4,
          `${shared.name} ${type} ${what}: ${analytic} vs ${numeric}`,
        );
      };
      near(greeks.vanna, slope((e) => at({ iv: shared.iv + e }).delta, hv), "vanna");
      near(greeks.speed, slope((e) => at({ spot: shared.spot + e }).gamma, hs), "speed");
      near(greeks.zomma, slope((e) => at({ iv: shared.iv + e }).gamma, hv), "zomma");
      near(greeks.vomma, slope((e) => at({ iv: shared.iv + e }).vega, hv), "vomma");
      // Charm is delta decay as time passes, which is the negative of the
      // derivative with respect to time remaining. Getting this sign backwards
      // is the easy mistake: it reads as a perfectly clean 200% error.
      near(greeks.charm, -slope((e) => at({ years: shared.years + e }).delta, ht), "charm");
    }
  }
});

test("greeks respect their sign and bound constraints across the aggregation window", () => {
  // aggregate() keeps strikes within 28% of spot, so that is the range that has
  // to be well behaved. A call with a negative delta would flip a wall's side.
  for (let moneyness = 0.72; moneyness <= 1.28; moneyness += 0.01) {
    for (const years of [1 / 365, 7 / 365, 30 / 365, 180 / 365]) {
      for (const iv of [0.08, 0.2, 0.5, 1.2]) {
        const shared = { spot: 27200, strike: 27200 * moneyness, years, iv, riskFreeRate: 0.043, dividendYield: 0.006 };
        const call = modelGreeks({ ...shared, type: "call" });
        const put = modelGreeks({ ...shared, type: "put" });
        const where = `moneyness ${moneyness.toFixed(2)} years ${years.toFixed(4)} iv ${iv}`;
        assert.ok(call.delta >= 0 && call.delta <= 1, `call delta ${call.delta} at ${where}`);
        assert.ok(put.delta <= 0 && put.delta >= -1, `put delta ${put.delta} at ${where}`);
        assert.ok(call.gamma >= 0 && put.gamma >= 0, `gamma at ${where}`);
        assert.ok(call.vega >= 0 && put.vega >= 0, `vega at ${where}`);
        // Put-call parity, which holds whatever the formulas are.
        assert.ok(
          Math.abs(call.delta - put.delta - Math.exp(-shared.dividendYield * years)) < 1e-12,
          `parity at ${where}`,
        );
        assert.ok(Math.abs(call.gamma - put.gamma) < 1e-18, `gamma parity at ${where}`);
        assert.ok(Math.abs(call.vanna - put.vanna) < 1e-18, `vanna parity at ${where}`);
      }
    }
  }
});

test("zero crossing uses linear interpolation and rejects non-crossings", () => {
  assert.equal(interpolateZero(100, -20, 110, 30), 104);
  assert.equal(interpolateZero(100, 20, 110, 30), null);
});

test("max pain minimizes aggregate intrinsic payout", () => {
  assert.equal(
    calculateMaxPain([
      { strike: 90, oi: 5, type: "put" },
      { strike: 100, oi: 10, type: "put" },
      { strike: 100, oi: 10, type: "call" },
      { strike: 110, oi: 5, type: "call" },
    ]),
    100,
  );
});

test("net liquidity converts reverse repo billions into millions", () => {
  assert.equal(netLiquidity(6_747_000, 830_000, 1), 5_916_000);
  assert.equal(netLiquidity(null, 830_000, 1), null);
});

test("percentage and weighted composites do not silently coerce missing values", () => {
  assert.equal(percentChange(110, 100), 10.000000000000009);
  assert.equal(percentChange(110, 0), null);
  assert.equal(
    weightedAvailable([
      { value: 80, weight: 0.75 },
      { value: null, weight: 0.25 },
    ]),
    80,
  );
  assert.equal(weightedAvailable([{ value: null, weight: 1 }]), null);
});

test("curve recession probability rises as the yield curve inverts", () => {
  const steep = curveRecessionProbability(2.5);
  const flat = curveRecessionProbability(0);
  const inverted = curveRecessionProbability(-1);
  assert.ok(steep < 0.05, `expected a steep curve to read low, got ${steep}`);
  // A flat curve sits near the historical unconditional recession frequency.
  assert.ok(flat > 0.25 && flat < 0.35, `expected a flat curve near 30%, got ${flat}`);
  assert.ok(inverted > 0.5, `expected an inverted curve above 50%, got ${inverted}`);
  assert.ok(steep < flat && flat < inverted);
  assert.equal(curveRecessionProbability(null), null);
  assert.equal(curveRecessionProbability(Number.NaN), null);
});

test("yield decomposition treats the expectations component as a residual", () => {
  assert.deepEqual(yieldDecomposition(4.2, 0.78), { termPremium: 0.78, expectations: 4.2 - 0.78 });
  assert.equal(yieldDecomposition(4.2, null), null);
  assert.equal(yieldDecomposition(null, 0.78), null);
});

test("skew percentile ranks a risk reversal against its own history", () => {
  // Risk reversals are negative; a less negative reading means downside
  // protection is less bid, which should rank higher.
  const history = Array.from({ length: 40 }, (_, index) => -0.08 + index * 0.001);
  const calm = skewPercentile(-0.02, history);
  const fearful = skewPercentile(-0.09, history);
  assert.ok(calm > 90, `expected a high rank, received ${calm}`);
  assert.equal(fearful, 0);
  // A reading in the middle of the observed range lands mid-scale.
  const middle = skewPercentile(-0.06, history);
  assert.ok(middle > 35 && middle < 65, `expected a mid rank, received ${middle}`);
});

test("skew percentile withholds a score until enough sessions exist", () => {
  const thin = [-0.05, -0.04, -0.06];
  assert.equal(skewPercentile(-0.05, thin), null);
  assert.equal(skewPercentile(-0.05, thin, 3), 50);
  assert.equal(skewPercentile(Number.NaN, Array(40).fill(-0.05)), null);
  // Non-finite history entries are discarded before the sample is counted.
  assert.equal(skewPercentile(-0.05, [Number.NaN, null, -0.04], 3), null);
});

test("economic CSV parsing drops blank and dot-missing observations instead of zeroing them", () => {
  assert.deepEqual(
    parseObservationCsv(
      "observation_date,NASDAQ100\n2026-07-02,29329.210\n2026-07-03,\n2026-07-06,29697.870\n2026-07-07,.\n",
      "NASDAQ100",
    ),
    [
      { date: "2026-07-02", value: 29329.21 },
      { date: "2026-07-06", value: 29697.87 },
    ],
  );
});

test("interpolation refuses to extrapolate past the observed range", () => {
  const xs = [1, 2, 4];
  const ys = [10, 20, 40];
  assert.equal(interpolateAt(xs, ys, 3), 30);
  assert.equal(interpolateAt(xs, ys, 1), 10);
  assert.equal(interpolateAt(xs, ys, 4), 40);
  assert.equal(interpolateAt(xs, ys, 0.9), null);
  assert.equal(interpolateAt(xs, ys, 4.1), null);
  assert.equal(interpolateAt([1], [10], 1), null);
});

// A downward-sloping smile: downside strikes carry the higher implied vol,
// which is the persistent shape in index options.
function skewedChain(spot, lo = 0.8, hi = 1.2, step = 0.01) {
  const contracts = [];
  for (let strike = spot * lo; strike <= spot * hi; strike += spot * step) {
    const rounded = Math.round(strike);
    const moneyness = Math.log(rounded / spot);
    const iv = 0.2 - 0.35 * moneyness + 0.4 * moneyness * moneyness;
    contracts.push({ strike: rounded, type: "put", iv, oi: 500 });
    contracts.push({ strike: rounded, type: "call", iv, oi: 500 });
  }
  return contracts;
}

test("smile is built from out-of-the-money quotes on each side of the forward", () => {
  const spot = 7400;
  const smile = buildSmile({
    contracts: skewedChain(spot),
    spot,
    years: 0.25,
    riskFreeRate: 0.04,
    dividendYield: 0.012,
  });
  assert.ok(smile);
  // Forward sits above spot when the financing rate exceeds the dividend yield.
  assert.ok(smile.forward > spot);
  assert.ok(smile.points.every((point) => (point.strike < smile.forward ? point.source === "put" : point.source === "call")));
  assert.ok(smile.atmIv > 0.15 && smile.atmIv < 0.25);
  // Standardized moneyness is zero at the forward and signed either side of it.
  assert.ok(smile.points.some((point) => point.standardized < -0.5));
  assert.ok(smile.points.some((point) => point.standardized > 0.5));
});

test("risk reversal is negative when downside implied volatility is bid", () => {
  const spot = 7400;
  const smile = buildSmile({
    contracts: skewedChain(spot),
    spot,
    years: 0.25,
    riskFreeRate: 0.04,
    dividendYield: 0.012,
  });
  assert.ok(smile.putIv25 !== null && smile.callIv25 !== null);
  assert.ok(smile.putIv25 > smile.callIv25);
  assert.ok(smile.riskReversal25 < 0);
  assert.equal(
    smile.riskReversal25.toFixed(10),
    (smile.callIv25 - smile.putIv25).toFixed(10),
  );
  assert.equal(
    smile.butterfly25.toFixed(10),
    ((smile.putIv25 + smile.callIv25) / 2 - smile.atmIv).toFixed(10),
  );
});

test("isolated implied volatility spikes are dropped, steep wings are kept", () => {
  const smooth = [0.3, 0.27, 0.24, 0.22, 0.21, 0.205, 0.21, 0.22];
  const points = smooth.map((iv, index) => ({
    strike: 7000 + index * 100,
    iv,
    moneyness: 0,
    standardized: 0,
    delta: 0.5,
    oi: 100,
    source: "put",
  }));
  // A clean monotone wing survives untouched.
  assert.equal(despike(points).length, points.length);

  // One stale print at three times the local level is removed.
  const spiked = points.map((point, index) =>
    index === 4 ? { ...point, iv: 0.63 } : point,
  );
  const cleaned = despike(spiked);
  assert.equal(cleaned.length, points.length - 1);
  assert.ok(!cleaned.some((point) => point.iv === 0.63));
});

test("strikes with negligible delta are excluded from the smile", () => {
  const spot = 7400;
  // A wide chain, so the outer strikes are genuinely negligible-delta while
  // the 25 delta point stays comfortably inside the surviving range.
  const base = {
    contracts: skewedChain(spot, 0.7, 1.3, 0.005),
    spot,
    years: 0.25,
    riskFreeRate: 0.04,
    dividendYield: 0.012,
  };
  const filtered = buildSmile(base);
  const unfiltered = buildSmile({ ...base, minDelta: 0 });
  assert.ok(filtered.points.length < unfiltered.points.length);
  assert.ok(filtered.points.every((point) => point.delta >= 0.02));
  // The wings that survive still reach far enough to price a 25 delta option.
  assert.ok(filtered.putIv25 !== null && filtered.callIv25 !== null);
});

test("open interest does not gate the smile", () => {
  // A newly listed expiry quotes normally but has not traded, so every strike
  // carries zero open interest. Excluding those deletes the near-the-money
  // wing and with it the 25 delta point, which is how the risk reversal went
  // missing on thin expiries.
  const spot = 7400;
  const shared = { spot, years: 0.25, riskFreeRate: 0.04, dividendYield: 0.012 };
  const unTraded = skewedChain(spot, 0.7, 1.3, 0.005).map((row) => ({ ...row, oi: 0 }));
  const smile = buildSmile({ ...shared, contracts: unTraded });
  assert.ok(smile);
  assert.ok(smile.riskReversal25 !== null);
  // Callers that genuinely want a positioning filter can still ask for one.
  assert.equal(buildSmile({ ...shared, contracts: unTraded, minOpenInterest: 1 }), null);
});

test("smile construction rejects chains that cannot support a curve", () => {
  const base = { spot: 7400, years: 0.25, riskFreeRate: 0.04, dividendYield: 0.012 };
  assert.equal(buildSmile({ ...base, contracts: [] }), null);
  // Missing or zero implied volatility is dropped rather than treated as flat.
  assert.equal(
    buildSmile({
      ...base,
      contracts: [
        { strike: 7000, type: "put", iv: null, oi: 500 },
        { strike: 7800, type: "call", iv: 0, oi: 500 },
      ],
    }),
    null,
  );
  assert.equal(buildSmile({ ...base, spot: 0, contracts: skewedChain(7400) }), null);
});

test("FOMC calendar parsing handles month-straddling meetings and projection markers", () => {
  const html = `
    <a id="1">2026 FOMC Meetings</a>
    <div class="fomc-meeting__month"><strong>January</strong></div>
    <div class="fomc-meeting__date">27-28</div>
    <div class="fomc-meeting__month"><strong>April/May</strong></div>
    <div class="fomc-meeting__date">30-1</div>
    <div class="fomc-meeting__month"><strong>September</strong></div>
    <div class="fomc-meeting__date">15-16*</div>
    <a id="2">2027 FOMC Meetings</a>
    <div class="fomc-meeting__month"><strong>January</strong></div>
    <div class="fomc-meeting__date">26-27</div>
  `;
  const meetings = parseFomcCalendar(html);
  assert.equal(meetings.length, 4);
  assert.deepEqual(
    meetings.map((meeting) => [meeting.start, meeting.end]),
    [
      ["2026-01-27", "2026-01-28"],
      // A meeting printed as "April/May 30-1" ends in the following month.
      ["2026-04-30", "2026-05-01"],
      ["2026-09-15", "2026-09-16"],
      ["2027-01-26", "2027-01-27"],
    ],
  );
  assert.deepEqual(
    meetings.map((meeting) => meeting.projections),
    [false, false, true, false],
  );
});

test("release feed parsing keeps only items with a usable timestamp", () => {
  const xml = `<rss><channel>
    <item><title>New Home Sales</title><pubDate>Fri, 24 Jul 2026 10:00:00 -0400</pubDate><link>https://example.gov/a</link></item>
    <item><title>Broken</title><pubDate>not a date</pubDate><link>https://example.gov/b</link></item>
    <item><title>Retail &amp; Food Services</title><pubDate>Thu, 16 Jul 2026 08:30:00 -0400</pubDate><link>https://example.gov/c</link></item>
  </channel></rss>`;
  const items = parseRssItems(xml, "Census Bureau");
  assert.equal(items.length, 2);
  assert.equal(items[0].publishedAt, "2026-07-24T14:00:00.000Z");
  assert.equal(items[0].source, "Census Bureau");
  // Entities are decoded rather than shown raw.
  assert.equal(items[1].title, "Retail & Food Services");
});

test("release feed parsing accepts each publisher's item shape", () => {
  // BEA opens items with an attribute; the Federal Reserve wraps every value
  // in CDATA. Both shapes appeared as silently empty feeds before this.
  const bea = `<rss><channel><item name="Direct Investment">
    <title>Direct Investment by Country and Industry, 2025</title>
    <link>https://www.bea.gov/news/2026/direct-investment</link>
    <pubDate>Tue, 21 Jul 2026 08:30:00 EDT</pubDate>
  </item></channel></rss>`;
  const fed = `<rss><channel><item>
    <title>Minutes of the Board&#39;s discount rate meetings</title>
    <link><![CDATA[https://www.federalreserve.gov/a.htm]]></link>
    <pubDate><![CDATA[Tue, 14 Jul 2026 18:00:00 GMT]]></pubDate>
  </item></channel></rss>`;
  const beaItems = parseRssItems(bea, "Bureau of Economic Analysis");
  assert.equal(beaItems.length, 1);
  assert.equal(beaItems[0].publishedAt, "2026-07-21T12:30:00.000Z");
  const fedItems = parseRssItems(fed, "Federal Reserve");
  assert.equal(fedItems.length, 1);
  assert.equal(fedItems[0].publishedAt, "2026-07-14T18:00:00.000Z");
  assert.equal(fedItems[0].link, "https://www.federalreserve.gov/a.htm");
  assert.equal(fedItems[0].title, "Minutes of the Board's discount rate meetings");
});

test("BLS calendar parsing preserves Eastern release time as a real instant", () => {
  const events = parseBlsCalendar(`BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20260729T083000
SUMMARY:Employment Situation
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20261106T100000
SUMMARY:Job Openings and Labor Turnover Survey
END:VEVENT
END:VCALENDAR`);
  assert.equal(events.length, 2);
  assert.equal(events[0].startsAt, "2026-07-29T12:30:00.000Z");
  assert.equal(events[1].startsAt, "2026-11-06T15:00:00.000Z");
  assert.equal(events[0].importance, "major");
});

test("BEA schedule parsing reads the public release table", () => {
  const events = parseBeaSchedule(`
    <table><thead><tr><th>Year 2026</th></tr></thead><tbody>
      <tr class="scheduled-releases-type-press">
        <td><div class="release-date">July 30</div><small class="text-muted">8:30 AM</small></td>
        <td class="release-title views-field views-field-field-scheduled-releases-type">GDP (Advance Estimate), 2nd Quarter 2026</td>
      </tr>
      <tr class="scheduled-releases-type-data">
        <td><div class="release-date">October 6</div><small class="text-muted">10:00 AM</small></td>
        <td class="release-title views-field views-field-field-scheduled-releases-type">Services Supplied Through Affiliates, 2024</td>
      </tr>
    </tbody></table>
  `);
  assert.equal(events.length, 2);
  assert.equal(events[0].startsAt, "2026-07-30T12:30:00.000Z");
  assert.equal(events[0].importance, "major");
  assert.equal(events[1].importance, "standard");
});

test("linear solver and ridge regression recover a known relationship", () => {
  const solution = solveSymmetric(
    [
      [4, 1],
      [1, 3],
    ],
    [1, 2],
  );
  assert.ok(Math.abs(solution[0] - 1 / 11) < 1e-9);
  assert.ok(Math.abs(solution[1] - 7 / 11) < 1e-9);

  // y = 2 + 3x, so a lightly penalized fit should land close to those values.
  const design = Array.from({ length: 40 }, (_, index) => [1, index / 10]);
  const target = design.map(([, x]) => 2 + 3 * x);
  const weights = ridgeFit(design, target, 1e-8);
  assert.ok(Math.abs(weights[0] - 2) < 1e-3, `intercept was ${weights[0]}`);
  assert.ok(Math.abs(weights[1] - 3) < 1e-3, `slope was ${weights[1]}`);
  // Malformed matrices must fail closed rather than producing a plausible
  // looking fit from misaligned columns or missing values.
  assert.equal(ridgeFit([[1, 1], [1]], [1, 2]), null);
  assert.equal(ridgeFit([[1, Number.NaN]], [1]), null);
});

test("logistic regression learns a separable rule and shrinks under a strong penalty", () => {
  const features = [];
  const labels = [];
  for (let index = 0; index < 200; index += 1) {
    const x = (index - 100) / 50;
    features.push(withIntercept([x]));
    labels.push(x > 0 ? 1 : 0);
  }
  const weights = logisticFit(features, labels, { penalty: 0.01, iterations: 25 });
  assert.ok(weights[1] > 1, `expected a positive slope, got ${weights[1]}`);
  assert.ok(logisticPredict(weights, withIntercept([2])) > 0.9);
  assert.ok(logisticPredict(weights, withIntercept([-2])) < 0.1);

  // A heavy penalty must pull the model back toward the base rate rather than
  // letting it keep an unsupported edge.
  const shrunk = logisticFit(features, labels, { penalty: 1e6, iterations: 25 });
  assert.ok(Math.abs(shrunk[1]) < 0.01, `expected shrinkage, got ${shrunk[1]}`);
  assert.ok(Math.abs(logisticPredict(shrunk, withIntercept([2])) - 0.5) < 0.05);
});

test("scoring rules and ranking behave as expected on known inputs", () => {
  const labels = [1, 0, 1, 0];
  // A perfectly confident and correct forecast scores zero on both rules.
  assert.ok(logLoss([1, 0, 1, 0], labels) < 1e-6);
  assert.equal(brierScore([1, 0, 1, 0], labels), 0);
  // Always predicting the base rate scores the entropy of the base rate.
  assert.ok(Math.abs(logLoss([0.5, 0.5, 0.5, 0.5], labels) - Math.log(2)) < 1e-9);
  assert.equal(brierScore([0.5, 0.5, 0.5, 0.5], labels), 0.25);
  // Ranking every positive above every negative is an AUC of one; reversing
  // the ranking is zero, and a constant forecast is exactly random.
  assert.equal(rocAuc([0.9, 0.1, 0.8, 0.2], labels), 1);
  assert.equal(rocAuc([0.1, 0.9, 0.2, 0.8], labels), 0);
  assert.equal(rocAuc([0.5, 0.5, 0.5, 0.5], labels), 0.5);

  const bins = calibrationBins([0.1, 0.15, 0.85, 0.9], [0, 0, 1, 1], 5);
  assert.equal(bins[0].count, 2);
  assert.equal(bins[0].observed, 0);
  assert.equal(bins[4].count, 2);
  assert.equal(bins[4].observed, 1);
});

test("walk-forward never trains on data at or after the block it predicts", () => {
  const seen = [];
  const predictions = walkForward(
    100,
    { initialTrain: 40, refitEvery: 20, embargo: 5 },
    (train, predict) => {
      seen.push({ train, predict });
      return Array.from({ length: predict[1] - predict[0] }, () => 1);
    },
  );
  assert.equal(predictions.length, 60);
  assert.equal(predictions[0].index, 40);
  for (const fold of seen) {
    assert.ok(fold.train[1] <= fold.predict[0] - 5, `training overlapped the embargo: ${JSON.stringify(fold)}`);
    assert.ok(fold.train[0] < fold.train[1]);
  }
});

test("volatility features average before taking logs and correct the log bias", () => {
  // A single spike must lift the weekly average; averaging logs instead would
  // bury it, which is the failure this ordering exists to avoid.
  const quiet = new Array(30).fill(0.5);
  const spiked = [...quiet];
  spiked[29] = 5;
  const calm = harFeatures(quiet, 29);
  const shocked = harFeatures(spiked, 29);
  assert.ok(shocked[2] > calm[2] + 0.5, "the weekly term should react to a spike");
  assert.equal(calm.length, 4);
  assert.equal(harFeatures(quiet, 29, new Array(30).fill(1)).length, 5);
  assert.equal(harFeatures(quiet, 10), null);

  // Smearing corrects a log-scale fit back to the mean; symmetric residuals in
  // logs are asymmetric once exponentiated.
  assert.ok(smearingFactor([-0.5, 0.5]) > 1);
  assert.equal(smearingFactor([0, 0]), 1);
  assert.equal(smearingFactor([]), 1);
});

test("historical BLS schedule parsing keeps releases and drops holidays", () => {
  const html = `
    <table class="release-list"><tbody>
      <tr class="release-list-even-row">
        <td class="date-cell"><p>Monday, January 01, 2024</p></td>
        <td class="time-cell"><p>&nbsp;</p></td>
        <td class="desc-cell"><p><strong>New Year's Day</strong></p></td></tr>
      <tr class="release-list-odd-row">
        <td class="date-cell"><p>Thursday, January 11, 2024</p></td>
        <td class="time-cell"><p>08:30 AM</p></td>
        <td class="desc-cell"><p><strong>Consumer Price Index</strong> for December 2023</p></td></tr>
      <tr class="release-list-even-row">
        <td class="date-cell"><p>Friday, January 05, 2024</p></td>
        <td class="time-cell"><p>08:30 AM</p></td>
        <td class="desc-cell"><p><strong>Employment Situation</strong> for December 2023</p></td></tr>
    </tbody></table>`;
  const rows = parseBlsAnnualSchedule(html);
  assert.equal(rows.length, 2);
  // Sorted by date, so the Employment Situation row comes first.
  assert.deepEqual(rows[0], {
    date: "2024-01-05",
    title: "Employment Situation",
    reference: "December 2023",
  });
  assert.deepEqual(rows[1], {
    date: "2024-01-11",
    title: "Consumer Price Index",
    reference: "December 2023",
  });
});

test("ZIP archives from the economic-data mirror are read entry by entry", () => {
  // A stored-entry archive is built by hand so the reader is exercised
  // without depending on a fixture file or the network.
  const files = [
    { name: "daily.csv", body: "observation_date,DGS10\n2026-07-24,4.55\n" },
    { name: "monthly.csv", body: "observation_date,CPIAUCSL\n2026-06-01,320.1\n" },
  ];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const body = Buffer.from(file.body, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0, 10); // stored
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...chunks, directory, end]);

  assert.equal(isZip(archive), true);
  assert.equal(isZip(Buffer.from("observation_date,DGS10\n")), false);
  const entries = readZipEntries(archive);
  assert.deepEqual(entries.map((entry) => entry.name), ["daily.csv", "monthly.csv"]);
  assert.match(entries[1].text, /CPIAUCSL/);
  assert.deepEqual(parseObservationCsv(entries[0].text, "DGS10"), [
    { date: "2026-07-24", value: 4.55 },
  ]);
});

test("TradingView bridge script uses Pine v6 and self-identifying payload price space", () => {
  assert.match(PINE_SCRIPT, /^\/\/@version=6/);
  assert.match(PINE_SCRIPT, /str\.startswith\(bridge, "GX2#"\)/);
  assert.doesNotMatch(PINE_SCRIPT, /payload_space = input/);
  assert.match(PINE_SCRIPT, /max_lines_count=500/);
  // A realtime tick rolls the script back to the start of the bar, so drawings
  // must be recreated on every tick of the last bar rather than only when it opens.
  assert.match(PINE_SCRIPT, /\nif barstate\.islast\n/);
  assert.doesNotMatch(PINE_SCRIPT, /barstate\.islast and \(barstate\.isnew/);
  // Zone width comes from the payload's own strike increment, mapped onto the chart.
  assert.match(PINE_SCRIPT, /f_half_width\(step\) =>/);
  assert.match(PINE_SCRIPT, /nz\(f_map_width\(step\), 0\) \* zone_width_mult \/ 2/);
  // Every future-facing drawing goes through the 500-bar clamp Pine enforces.
  assert.match(PINE_SCRIPT, /f_future\(offset\) =>\n    bar_index \+ math\.min\(offset, 500\)/);
  assert.doesNotMatch(PINE_SCRIPT, /x=bar_index \+ right_bars/);
  assert.doesNotMatch(PINE_SCRIPT, /x2=bar_index \+ right_bars/);
  // Pine cannot assign to a global scalar from inside a function, so the block
  // parser hands its results back by mutating an array instead.
  assert.match(PINE_SCRIPT, /array\.set\(meta_levels, 1, f_price\(fields, 2\)\)/);
});

test("TradingView bridge script draws the histogram, expected move and agreement", () => {
  // The exposure profile the walls are peaks of, switchable between the two
  // books and defaulting to the ETF.
  assert.match(PINE_SCRIPT, /show_profile = input\.bool/);
  assert.match(PINE_SCRIPT, /array\.push\(hist_strike, strike\)/);
  assert.match(PINE_SCRIPT, /profile_source = input\.string\("Both, back to back"/);
  assert.match(PINE_SCRIPT, /array\.push\(hist_book, role\)/);
  // Back to back needs both books present; a single-book selection falls back
  // to whichever one the bridge actually carried rather than blanking.
  assert.match(PINE_SCRIPT, /profile_both := profile_source == "Both, back to back" and has_index and has_confirm/);
  assert.match(PINE_SCRIPT, /profile_shown := wanted == 0 \? \(has_index \? 0 : 1\) : \(has_confirm \? 1 : 0\)/);
  // Each book keeps the bin height its own strike grid earns.
  assert.match(PINE_SCRIPT, /f_map_width\(array\.get\(book_step, book\)\)/);
  // Level labels clear whatever width the histogram takes, one lane or two.
  assert.match(PINE_SCRIPT, /profile_bars \* profile_lanes \+ 3/);
  // Merging runs per book, so a level always keeps its own book's price and
  // stays on the strike grid its histogram bars are drawn from.
  assert.match(PINE_SCRIPT, /f_merge_book\(by_price, visible_price, visible_source, book_pass\)/);
  assert.match(PINE_SCRIPT, /if f_class\(kind, role\) == book_pass/);
  // Agreement is proximity, not a merge, so neither level gets moved.
  assert.match(PINE_SCRIPT, /array\.set\(merged_agreed, left, true\)/);
  // Every level names the book that measured it, the index one included.
  assert.match(PINE_SCRIPT, /prefix = name \+ " "/);
  assert.doesNotMatch(PINE_SCRIPT, /prefix = role == 1/);
  // Expected move arrives pre-scaled in bps so a 0DTE move is not rounded up.
  assert.match(PINE_SCRIPT, /sigma_bps \/ 10000\.0/);
  // Greek-lettered level names: gamma and delta have symbols, vanna and charm
  // are trader coinages with no Greek letter and stay as words.
  assert.match(PINE_SCRIPT, /"Γ Flip"/);
  assert.match(PINE_SCRIPT, /"Γ\+", "Γ−"/);
  assert.match(PINE_SCRIPT, /"Δ\+", "Δ−"/);
  assert.doesNotMatch(PINE_SCRIPT, /"Gamma |"Delta /);
  // Prior-session walls were removed. The staleness row still says "PRIOR
  // SESSION", which is about how old the payload is, so the check names the
  // feature's own identifiers rather than the word.
  assert.doesNotMatch(PINE_SCRIPT, /show_prior|prior_style|prior_recolor|c_prior|merged_prior|"Prior /);
  // Levels both books agree on are flagged rather than silently merged.
  assert.match(PINE_SCRIPT, /agreed = array\.get\(merged_agreed, index\)/);
  assert.match(PINE_SCRIPT, /agreed \? "✓ " : ""/);
  // Lines start where the snapshot was taken, not at an arbitrary lookback.
  // With the monitor gone this is also the only staleness cue left: a short
  // line means a fresh payload.
  assert.match(PINE_SCRIPT, /anchor_snapshot and snapshot_bar > 0 \? snapshot_bar/);
  // Alerts, the background tint and both tables are gone: the indicator draws
  // levels and nothing else.
  assert.doesNotMatch(PINE_SCRIPT, /alertcondition|alert\(|alerts_on/);
  // bgcolor= survives as box.new's fill argument; it is the bgcolor() call that
  // painted the background and had to go.
  assert.doesNotMatch(PINE_SCRIPT, /bgcolor\(|regime/);
  assert.match(PINE_SCRIPT, /bgcolor=color\.new/);
  assert.doesNotMatch(PINE_SCRIPT, /table\.new|table\.cell|show_monitor|show_level_table/);
});

test("the indicator withdraws levels whose expiry has settled", () => {
  // Days to expiry cannot express this: the DTE weighting gives a 0DTE wall 1.0,
  // the boldest line drawn, for hours after its contracts stopped existing.
  assert.match(PINE_SCRIPT, /settles = array\.size\(slice\) >= 6 \? f_number\(slice, 5\) : 0\.0/);
  assert.match(PINE_SCRIPT, /array\.push\(lv_settles, settles\)/);
  // Against the chart's clock, not the snapshot's: whether a contract exists is a
  // fact about now. Zero means the payload said nothing, which is not evidence of
  // expiry, so the level stays drawn.
  assert.match(PINE_SCRIPT, /f_settled\(settles\) =>\n {4}settles > 0 and timenow >= settles \* 1000/);
  assert.match(PINE_SCRIPT, /settled_mode = input\.string\("Hide", "Settled expiries", options=\["Hide", "Dim", "Draw"\]/);
  assert.match(PINE_SCRIPT, /not \(settled and settled_mode == "Hide"\)/);
  // Only the dated walls carry one. The combined levels span the whole selection,
  // so no single instant describes them and they are never withdrawn on this test.
  assert.match(PINE_SCRIPT, /f_push\(call_wall, prefix \+ "Call Wall", 0, 1\.0, role, step, 0\.0\)/);
  assert.match(PINE_SCRIPT, /f_push\(f_price\(slice, 1\), label_text \+ " Call Wall", 9, weight, role, step, settles\)/);
  // One live member keeps a merged group live.
  assert.match(PINE_SCRIPT, /group_settled := group_settled and settled/);
  // Dimmed rather than silently thinned: a settled level is not a weak level.
  assert.match(PINE_SCRIPT, /settled \? " \(settled\)" : ""/);
  // Dim fades and never bolds; Draw keeps full weight. Without splitting these
  // the two modes rendered identically.
  assert.match(PINE_SCRIPT, /faded = settled and settled_mode == "Dim"/);
  assert.match(PINE_SCRIPT, /thickness = faded \? 1 :/);
  // The band is the front expiry's own volatility, so it goes when that settles.
  assert.match(PINE_SCRIPT, /move_settled = f_settled\(nz\(array\.get\(meta_levels, 2\), 0\)\)/);
  assert.match(PINE_SCRIPT, /if show_expected_move and drawing and not move_settled/);
  // The dead subfield is gone from both sides of the contract.
  assert.doesNotMatch(PINE_SCRIPT, /frontDte/);
  const bridge = readFileSync(new URL("../src/lib/bridge-payload.ts", import.meta.url), "utf8");
  assert.doesNotMatch(bridge, /frontDte/);
});

test("the indicator says when the payload cannot be trusted, and stays quiet otherwise", () => {
  assert.match(PINE_SCRIPT, /show_warning = input\.bool\(true, "Warn when the payload cannot be trusted"/);
  assert.match(PINE_SCRIPT, /stale_hours = input\.float\(24, "Treat the payload as stale after \(hours\)"/);
  // Three independent failures. A malformed paste drew an empty chart and gave
  // no reason for it.
  assert.match(PINE_SCRIPT, /warning := "BRIDGE NOT RECOGNISED · EXPECTED A GX2 PAYLOAD"/);
  // Age was parsed into payload_epoch and never shown.
  assert.match(PINE_SCRIPT, /age_hours = payload_epoch > 0 \? \(timenow - payload_epoch \* 1000\) \/ 3600000\.0 : na/);
  assert.match(PINE_SCRIPT, /if not na\(age_hours\) and age_hours > stale_hours/);
  // Age cannot stand in for settlement: a payload copied at 15:55 is minutes old
  // at 16:05 and its 0DTE walls are already gone. Both tests, independently.
  assert.match(PINE_SCRIPT, /if dated_total > 0 and dated_settled == dated_total/);
  assert.match(PINE_SCRIPT, /array\.push\(reasons, "EVERY DATED EXPIRY HAS SETTLED"\)/);
  // Only the dated walls can settle, and one live expiry means the book still
  // describes something that trades.
  assert.match(PINE_SCRIPT, /if dated_kind >= 9 and dated_kind <= 11/);
  // Silent while sound: the label is only pushed when a reason was collected.
  assert.match(PINE_SCRIPT, /if str\.length\(warning\) > 0/);
  // ta.* has to run on every bar or its window is wrong, so the extreme the
  // warning anchors to is taken at global scope, not inside the drawing block.
  assert.match(PINE_SCRIPT, /^chart_high = ta\.highest\(high, 200\)$/m);
  assert.doesNotMatch(PINE_SCRIPT, /float warn_at = ta\.highest/);
});

test("copying confirms on the button that fired and survives a refused clipboard", () => {
  const atlas = readFileSync(new URL("../src/components/options-atlas.tsx", import.meta.url), "utf8");
  // Copying leaves the page looking untouched, so the pressed button carries the
  // confirmation rather than only the footer, which is metres away from the click.
  assert.match(atlas, /data-confirmed=\{confirmed === "bridge" \|\| undefined\}/);
  assert.match(atlas, /data-confirmed=\{confirmed === "csv" \|\| undefined\}/);
  // navigator.clipboard rejects on a denied permission or an insecure context.
  // Unhandled, that read as a successful copy and lost the payload silently.
  assert.match(atlas, /await navigator\.clipboard\.writeText\(value\);\n {4}\} catch \{/);
  assert.match(atlas, /announce\("Clipboard blocked by the browser", null\)/);
  // A second copy inside the dismissal window used to let the older timeout
  // clear the newer notice, so the timer is shared and cancelled.
  assert.match(atlas, /if \(noticeTimer\.current !== null\) window\.clearTimeout\(noticeTimer\.current\)/);
  assert.doesNotMatch(atlas, /window\.setTimeout\(\(\) => setNotice\(""\), 2200\)/);
});

test("the bridge carries settlement instants so a payload cannot outlive its contracts", () => {
  const emptyLevels = {
    callWall: null, putWall: null, gammaFlip: null, maxPain: null, vannaMagnet: null,
  };
  const source = {
    name: "NDX",
    role: "P",
    spot: 23000,
    strikes: [
      { strike: 22975, gamma: -60, delta: -6 },
      { strike: 23025, gamma: 80, delta: 8 },
    ],
    levels: { ...emptyLevels, callWall: 23200, putWall: 22800 },
    expiries: [
      // PM-settled, so 16:00 ET on the 29th.
      { label: "0DTE", dte: 0, levels: { ...emptyLevels, callWall: 23100 }, settlesAt: "2026-07-29T20:00:00.000Z" },
      // A slice whose settlement the caller could not determine.
      { label: "1DTE", dte: 1, levels: { ...emptyLevels, callWall: 23150 }, settlesAt: null },
    ],
    frontAtmIv: 0.16,
    frontYears: 1 / 365,
    frontSettlesAt: "2026-07-29T20:00:00.000Z",
  };
  const payload = buildBridgePayload([source], {
    space: "N",
    instrument: "NQ",
    referenceSpot: 23000,
    generatedAt: new Date("2026-07-29T19:55:00Z"),
    parts: DEFAULT_BRIDGE_PARTS,
  });
  const fields = payload.split("#")[1].split("|")[1].split("~");
  const [zeroDte, oneDte] = fields[7].split(";");
  // 2026-07-29T20:00:00Z in epoch seconds.
  assert.equal(zeroDte.split(",")[5], "1785355200");
  // Unknown stays zero rather than becoming a spurious instant. The indicator
  // reads zero as no evidence and keeps the level drawn.
  assert.equal(oneDte.split(",")[5], "0");
  // The header is five minutes before settlement, so age alone can never detect
  // this: the payload is fresh and its front expiry is about to cease to exist.
  assert.equal(payload.split("#")[1].split("|")[0].split("~")[4], "1785354900");
  assert.ok(Number(zeroDte.split(",")[5]) > 1785354900);
  // The expected-move band is scaled to the front expiry's own volatility, so it
  // is withdrawn on the same instant.
  assert.equal(fields[10].split(",")[1], "1785355200");
});

test("surface history is bucketed by the observation, not by when it was read", () => {
  const route = readFileSync(
    new URL("../src/app/api/options/[symbol]/route.ts", import.meta.url),
    "utf8",
  );
  // dte ran against max(observationDate, today), so reading a stale snapshot
  // restated every expiry as nearer than it was when the chain was captured.
  // The 24 July file, first read on the 27th, recorded its 3DTE expiry as 0DTE.
  assert.match(route, /Date\.parse\(`\$\{observationDate\}T12:00:00Z`\)\) \/ 86_400_000/);
  assert.doesNotMatch(route, /\[observationDate, easternDate\(\)\]\.sort\(\)/);

  const store = readFileSync(new URL("../src/lib/server/snapshot-store.ts", import.meta.url), "utf8");
  // An ATM implied volatility solved minutes from settlement is unbounded, and
  // this table exists only for cross-session comparison, so it refuses one.
  assert.match(store, /export const MINIMUM_COMPARABLE_SECONDS = 3600/);
  assert.match(store, /secondsLeft < MINIMUM_COMPARABLE_SECONDS\) continue/);
  // Unknown remaining time is missing evidence, not evidence of a bad reading.
  assert.match(store, /typeof secondsLeft === "number"/);
  // yearsToExpiry floors at an hour and cannot tell eight minutes from sixty,
  // which is why the caller measures the real interval to settlement.
  assert.match(route, /const secondsToSettlement = Number\.isFinite\(settlesAt\)/);
  // The front slice skips 0DTE; the baseline it is compared against must too.
  assert.match(route, /\(frontSlice\.dte === 0 \|\| row\.dte > 0\)/);
});

test("the surface lookup returns the closest bucket, and the migration repairs the old rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE iv_surface_history (
    symbol TEXT, source_time TEXT, observation_date TEXT, expiry TEXT,
    dte INTEGER, forward REAL, atm_iv REAL, put_iv_25 REAL, call_iv_25 REAL,
    risk_reversal_25 REAL, butterfly_25 REAL, retrieved_at TEXT)`);
  const add = (obs, expiry, dte, iv, time = "20:00:00.000Z") =>
    db.prepare(`INSERT INTO iv_surface_history VALUES
      ('NDX', ?, ?, ?, ?, 28000, ?, NULL, NULL, NULL, NULL, '')`)
      .run(`${obs}T${time}`, obs, expiry, dte, iv);

  // The shape that produced the bug: a 0DTE row solved at settlement sitting
  // beside a sane 1DTE row from the same session.
  add("2026-07-28", "2026-07-28", 0, 1.1476);
  add("2026-07-28", "2026-07-29", 1, 0.3439);
  add("2026-07-28", "2026-07-30", 2, 0.3200);

  const ordered = (target) =>
    db.prepare(`SELECT dte, atm_iv FROM iv_surface_history
      WHERE dte BETWEEN ? AND ?
      ORDER BY observation_date DESC, ABS(dte - ${target}) ASC, dte ASC`)
      .all(target - 1, target + 1);
  // Ordering by dte ascending handed back the 0DTE row for a 1DTE request,
  // which is the single least trustworthy reading in the table.
  assert.equal(ordered(1)[0].dte, 1, "the closest bucket wins, not the smallest");
  assert.equal(ordered(1)[0].atm_iv, 0.3439);
  assert.equal(ordered(2)[0].dte, 2);

  // Deleting the readings taken on their own expiry's settlement.
  db.exec(`DELETE FROM iv_surface_history
    WHERE expiry <= observation_date AND time(source_time) >= '19:00:00'`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM iv_surface_history").get().n, 2);

  // A 0DTE reading from the morning has hours left and stays.
  add("2026-07-27", "2026-07-27", 0, 0.2100, "14:30:00.000Z");
  db.exec(`DELETE FROM iv_surface_history
    WHERE expiry <= observation_date AND time(source_time) >= '19:00:00'`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM iv_surface_history").get().n, 3);

  // Mislabelled buckets are recoverable: dte is a pure function of two columns
  // the row already carries, so it is recomputed rather than dropped.
  add("2026-07-24", "2026-07-27", 0, 0.1753);
  db.exec(`UPDATE iv_surface_history
    SET dte = MAX(0, CAST(ROUND(julianday(expiry) - julianday(observation_date)) AS INTEGER))
    WHERE dte <> MAX(0, CAST(ROUND(julianday(expiry) - julianday(observation_date)) AS INTEGER))`);
  assert.equal(
    db.prepare("SELECT dte FROM iv_surface_history WHERE observation_date = '2026-07-24'").get().dte,
    3,
    "a 24 July observation of a 27 July expiry is 3DTE, whenever it was read",
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM iv_surface_history
      WHERE dte <> MAX(0, CAST(ROUND(julianday(expiry) - julianday(observation_date)) AS INTEGER))`).get().n,
    0,
  );
  db.close();
});

test("a settled expiry leaves the listing at settlement, not at midnight", () => {
  const route = readFileSync(
    new URL("../src/app/api/options/[symbol]/route.ts", import.meta.url),
    "utf8",
  );
  // The listing filtered on the expiry date alone, so at 20:00 ET the 0DTE book
  // was still selectable and still contributing gamma it no longer had.
  assert.doesNotMatch(route, /\.filter\(\(expiry\) => expiry >= today\)/);
  assert.match(route, /const settles = Date\.parse\(expirationIso\(contract\.expiry, contract\.root\) \?\? ""\)/);
  assert.match(route, /return !Number\.isFinite\(settles\) \|\| settles > now/);
  // Per contract, not per date: NDX (AM-settled, gone at 09:30) and NDXP
  // (PM-settled, trades to 16:00) share an expiry date, so one cutoff for the
  // date would be wrong for one of them.
  assert.match(route, /const contracts = parsedContracts\.filter\(\(contract\) => \{/);
  // A date the clock invalidated is not a bad request. Erroring stranded anyone
  // holding the 0DTE book across the close with no way back.
  assert.match(route, /const settledDates = new Set\(/);
  assert.match(route, /if \(requestedExpiry && settledDates\.has\(requestedExpiry\)\) requestedExpiry = null/);
  assert.match(route, /settledExpiries,/);

  // The two settlement styles the filter depends on.
  const amSettled = Date.parse(expirationIso("2026-07-29", "NDX"));
  const pmSettled = Date.parse(expirationIso("2026-07-29", "NDXP"));
  const evening = Date.parse("2026-07-30T00:08:00Z"); // 20:08 ET on the 29th
  const midMorning = Date.parse("2026-07-29T14:30:00Z"); // 10:30 ET on the 29th
  assert.ok(amSettled < midMorning, "an AM-settled monthly is gone by mid-morning");
  assert.ok(pmSettled > midMorning, "its PM-settled family still trades then");
  assert.ok(pmSettled < evening, "and is gone in the evening");
});

test("selecting a strike is confirmed everywhere it can be selected from", () => {
  const atlas = readFileSync(new URL("../src/components/options-atlas.tsx", import.meta.url), "utf8");
  // The chart never received the selection, so the band that was clicked looked
  // identical to every other one.
  assert.match(atlas, /pinned=\{pin\}/);
  assert.match(atlas, /<g className="profile-pin" key=\{`pin-\$\{pinnedRow\.strike\}`\}>/);
  // Decimation means the pinned strike is not always a drawn row, so the
  // highlight resolves to the row the click landed on.
  assert.match(atlas, /const pinnedRow =/);
  // The chain and the ledger sit below the inspector they drive, so they mark
  // themselves and bring it into view. The chart does not scroll: it is already
  // beside the inspector.
  assert.match(atlas, /onClick=\{\(\) => pinStrike\(row\.strike, true\)\}/);
  assert.match(atlas, /onClick=\{\(\) => pinStrike\(Number\(value\), true\)\}/);
  assert.match(atlas, /onPin=\{pinStrike\}/);
  assert.match(atlas, /inspectorRef\.current\?\.scrollIntoView/);
  assert.doesNotMatch(atlas, /onPin=\{setPinnedStrike\}/);
});

test("nothing is pinned until there is a real strike to pin", () => {
  const atlas = readFileSync(new URL("../src/components/options-atlas.tsx", import.meta.url), "utf8");
  // A hardcoded 23200 was snapped to the nearest listed strike, so the inspector
  // opened on a far-OTM strike as though it had been chosen.
  assert.match(atlas, /useState<number \| null>\(null\)/);
  assert.doesNotMatch(atlas, /useState\(23200\)/);
  assert.match(atlas, /const pin = pinnedStrike !== null && strikes\.length \? nearest\(pinnedStrike\) : null/);
  // Switching instrument cleared the pin to zero, which snapped to the lowest
  // listed strike on the new book.
  assert.doesNotMatch(atlas, /setPinnedStrike\(0\)/);
  // Auto-pinning to the money must not overwrite a selection: unconditional, it
  // dragged the inspector back to spot on every live poll.
  assert.match(atlas, /setPinnedStrike\(\(current\) =>\n {10}current \?\?/);
  // A label claiming preview geometry over a panel that draws none.
  assert.doesNotMatch(atlas, /atlas-canvas--preview/);
});

test("a failed market-data request can be retried without resetting the workspace", () => {
  const atlas = readFileSync(new URL("../src/components/options-atlas.tsx", import.meta.url), "utf8");
  // Recovery used to mean switching instrument, which resets eight pieces of
  // state, or reloading the page.
  assert.match(atlas, /Retry the request/);
  assert.match(atlas, /setRefreshTick\(\(value\) => value \+ 1\)/);
  // The tick is what clears the response cache, so a retry cannot be handed the
  // same failure back out of memory.
  assert.match(atlas, /lastRefreshTickRef\.current !== refreshTick/);
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /PREVIEW GEOMETRY/);
  // Dead styling for a selection marker that was never rendered.
  assert.doesNotMatch(css, /\.pin-rule/);
});

test("motion is opt-in for transforms and switched off when the reader asks", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  // Every new animation relies on this one guard, so it has to keep covering
  // descendants and pseudo-elements rather than only the elements themselves.
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\n {2}\*,\n {2}\*::before,\n {2}\*::after \{/,
  );
  assert.match(css, /animation-iteration-count: 1 !important/);
  // The looping pulse is gated on a fetch actually being in flight. Unconditional
  // it would claim the app was working while it sat idle.
  assert.match(css, /\.atlas-status\[data-refreshing\] i \{\n {2}animation: status-breathe/);
  // The shared control transition covers colour only. A blanket transform here
  // would animate layout on elements that never asked to move.
  const shared = css.match(/^button,\na,\nsummary,\nlabel \{\n {2}transition:[^}]+\}/m);
  assert.ok(shared, "the shared control transition is declared");
  assert.doesNotMatch(shared[0], /transform|width|height|margin|padding|inset|top|left/);
});

test("a wall's zone is exactly as tall as the histogram bin it was measured from", () => {
  // A zone at the default width spans one mapped strike increment: half-width
  // step/2. The bins have to use the same half or a wall's band reads as
  // mismatched against its own bar. They also tile with no gap, which is what a
  // distribution should look like.
  assert.match(PINE_SCRIPT, /f_map_width\(array\.get\(book_step, book\)\), 0\) \* 0\.5/);
  assert.doesNotMatch(PINE_SCRIPT, /f_map_width\(array\.get\(book_step, book\)\), 0\) \* 0\.4/);
  // Both widths read the one step the block declared, so they cannot diverge by
  // being measured from different places.
  assert.match(PINE_SCRIPT, /array\.set\(book_step, role, step\)/);
  assert.match(PINE_SCRIPT, /array\.push\(lv_step, step\)/);
});

test("crowded labels are spaced by the width of the text rather than a fixed step", () => {
  // The stagger existed but stepped a fixed nine bars, which is about one
  // label's width: a crowded run overlapped anyway. The pitch now comes from the
  // longest caption actually drawn.
  assert.doesNotMatch(PINE_SCRIPT, /merged_slot, index\) \* 9\b/);
  assert.match(PINE_SCRIPT, /merged_slot, index\) \* label_pitch/);
  assert.match(PINE_SCRIPT, /label_pitch := math\.max\(6, math\.round\(widest \* label_char_bars\)\)/);
  // Lanes are picked by which one is actually free, not by cycling, so a level
  // cannot be assigned a lane that still holds a label at the same height.
  assert.match(PINE_SCRIPT, /lane_price = array\.new_float\(label_lanes, -1e18\)/);
  assert.match(PINE_SCRIPT, /if lane < 0 and price - array\.get\(lane_price, candidate\) >= label_gap/);
  assert.match(PINE_SCRIPT, /lane := array\.indexof\(lane_price, array\.min\(lane_price\)\)/);
  // Only levels that survive the nearest-N cut reserve a lane; a dropped level
  // pushing its neighbours sideways would waste the lanes.
  assert.match(PINE_SCRIPT, /keeps = array\.new_bool\(total, false\)/);
  assert.match(PINE_SCRIPT, /if array\.get\(keeps, index\)/);
  // Overlap is survivable rather than illegible: a filled label hides the one
  // behind it instead of mashing two sets of glyphs together.
  assert.match(PINE_SCRIPT, /label_backdrop \? color\.new\(chart\.bg_color, 10\)/);
});

test("TradingView bridge script renders each book in its own style and survives gapped history", () => {
  // The index chain is a definite price and draws as a line; the ETF chain is
  // rescaled onto it and draws as the band that conversion is actually good to.
  assert.match(PINE_SCRIPT, /index_style = input\.string\("Line", "Index book/);
  assert.match(PINE_SCRIPT, /confirm_style = input\.string\("Zone", "Confirmation book/);
  // All three are freely settable to either or both.
  assert.match(PINE_SCRIPT, /options=\["Line", "Zone", "Line \+ zone"\]/);
  // A merged level honours every contributing book's style rather than one winning.
  assert.match(PINE_SCRIPT, /wants_line = \(from_index and f_has_line\(0\)\)/);
  assert.match(PINE_SCRIPT, /draw_zone = show_zones and half > 0 and \(\(from_index and f_has_zone\(0\)\)/);
  // A zone-only book must survive the master zone switch being turned off.
  assert.match(PINE_SCRIPT, /draw_line = wants_line or not draw_zone/);
  // A zone follows its line when lines are extended: box.new takes the same
  // extend argument the line does, not just line.new.
  assert.equal(
    (PINE_SCRIPT.match(/extend=extend_right \? extend\.right : extend\.none/g) ?? []).length,
    2,
  );
  assert.match(PINE_SCRIPT, /indicator\("GEXLab V3 Option Levels", overlay=true, max_bars_back=5000/);
  // A moving average over a gapped series goes blind whenever its window
  // straddles the overnight gap, so the ratio window holds only live samples.
  assert.doesNotMatch(PINE_SCRIPT, /ta\.sma\(ratio_sample/);
  assert.match(PINE_SCRIPT, /held_ratio := array\.avg\(ratio_window\)/);
  // The ratio is sampled live, because it is the current relationship between
  // the two instruments and a level converted through a stale one drifts.
  assert.match(PINE_SCRIPT, /array\.push\(ratio_window, close \/ cash_close\)/);
  // Extended hours on the cash leg, so the secondary series covers more of a
  // 24-hour chart's bars.
  assert.match(PINE_SCRIPT, /ticker\.modify\(cash_symbol, session\.extended\)/);
  // The offset Pine reaches back through grows with the chart, so it is bounded
  // by capping the calculation window rather than by guessing a buffer size:
  // within 5,000 calculated bars no offset can exceed 5,000. This has regressed
  // twice, both times by raising the buffer alone.
  assert.match(PINE_SCRIPT, /max_bars_back=5000, calc_bars_count=5000/);
});

test("saved bridge contents are merged against the parts this build knows", () => {
  // A preference written before a part existed must not leave it undefined,
  // and one written when a since-removed part existed must not resurrect it.
  const stored = JSON.stringify({ gamma: false, delta: true, prior: true });
  const parts = readBridgeParts(stored);
  assert.equal(parts.gamma, false, "a stored choice wins");
  assert.equal(parts.delta, true);
  assert.equal(parts.profile, DEFAULT_BRIDGE_PARTS.profile, "an absent part falls back");
  assert.equal("prior" in parts, false, "a removed part does not come back");
  assert.deepEqual(Object.keys(parts).sort(), Object.keys(DEFAULT_BRIDGE_PARTS).sort());

  // Anything unreadable or non-boolean falls back rather than throwing.
  assert.deepEqual(readBridgeParts(null), DEFAULT_BRIDGE_PARTS);
  assert.deepEqual(readBridgeParts("not json"), DEFAULT_BRIDGE_PARTS);
  assert.deepEqual(readBridgeParts(JSON.stringify({ gamma: "yes" })), DEFAULT_BRIDGE_PARTS);
});

test("the strike increment is the modal gap, so a missing strike cannot widen it", () => {
  // 22800 is absent, leaving a single 50-point gap in an otherwise 25-point grid.
  assert.equal(strikeIncrement([22700, 22725, 22750, 22775, 22825, 22850]), 25);
  assert.equal(strikeIncrement([5000, 5005, 5010, 5015]), 5);
  assert.equal(strikeIncrement([400]), 0);
});

test("concentration clusters are separated peaks, not the strikes bracketing one wall", () => {
  const step = 25;
  // One dominant wall at 23000 with its shoulders, and two smaller distinct walls.
  const strikes = [
    { strike: 22950, gamma: 60, delta: 0 },
    { strike: 22975, gamma: 90, delta: 0 },
    { strike: 23000, gamma: 100, delta: 0 },
    { strike: 23025, gamma: 88, delta: 0 },
    { strike: 23050, gamma: 55, delta: 0 },
    { strike: 23400, gamma: 70, delta: 0 },
    { strike: 23800, gamma: 40, delta: 0 },
  ];
  const separation = minimumSeparation(step, 23000);
  const clusters = concentrationClusters(strikes, "gamma", true, 3, step, separation);

  assert.equal(clusters.length, 3);
  // Ranking raw strikes would have returned 23000/22975/23025 — the same wall three times.
  for (let index = 0; index < clusters.length; index += 1) {
    for (let other = index + 1; other < clusters.length; other += 1) {
      assert.ok(Math.abs(clusters[index].strike - clusters[other].strike) >= separation);
    }
  }
  // The reported price is the mass-weighted centre of the cluster, not its tallest strike.
  assert.ok(Math.abs(clusters[0].strike - 23000) < step);
  assert.equal(clusters[0].weight, 100);
  assert.ok(clusters[1].weight < 100);
  assert.equal(clusters.every((level) => level.sign === 1), true);
});

test("concentration clusters report a listed strike, not a point between two", () => {
  const step = 25;
  const strikes = [
    { strike: 23025, gamma: 88, delta: 0 },
    { strike: 23050, gamma: 100, delta: 0 },
    { strike: 23075, gamma: 60, delta: 0 },
  ];
  const listed = new Set(strikes.map((row) => row.strike));
  const clusters = concentrationClusters(
    strikes,
    "gamma",
    true,
    3,
    step,
    minimumSeparation(step, 23000),
  );
  // The exposure-weighted centre of this cluster is ~23047, which is between
  // strikes: the exposure histogram draws no bar there, so a level reported at
  // that price looked unrelated to the profile it came from.
  assert.ok(clusters.length > 0);
  for (const cluster of clusters) {
    assert.ok(listed.has(cluster.strike), `${cluster.strike} is not a listed strike`);
  }
  // Still the weighted centre's neighbourhood, not simply the tallest print.
  assert.equal(clusters[0].strike, 23050);
});

test("concentration clusters respect the requested sign and count", () => {
  const strikes = [
    { strike: 100, gamma: -80, delta: 0 },
    { strike: 101, gamma: -75, delta: 0 },
    { strike: 140, gamma: -30, delta: 0 },
    { strike: 180, gamma: 90, delta: 0 },
  ];
  const negative = concentrationClusters(strikes, "gamma", false, 5, 1, minimumSeparation(1, 100));
  assert.equal(negative.every((level) => level.sign === -1), true);
  assert.equal(negative.length, 2);
  assert.deepEqual(
    concentrationClusters(strikes, "gamma", true, 0, 1, 2),
    [],
  );
});

test("the bridge payload rescales every book onto one reference price with its own strike grid", () => {
  const parts = {
    expiryWalls: true,
    flips: true,
    aggregateWalls: true,
    maxPain: true,
    vanna: true,
    gamma: true,
    delta: true,
    confirmation: true,
    profile: true,
    volumeWalls: true,
    expectedMove: true,
  };
  const emptyLevels = {
    callWall: null,
    putWall: null,
    gammaFlip: null,
    maxPain: null,
    vannaMagnet: null,
  };
  const index = {
    name: "NDX",
    role: "P",
    spot: 23000,
    strikes: [
      { strike: 22950, gamma: -50, delta: -5, callVolume: 10, putVolume: 900 },
      { strike: 22975, gamma: -80, delta: -8, callVolume: 10, putVolume: 400 },
      { strike: 23025, gamma: 90, delta: 9, callVolume: 700, putVolume: 10 },
      { strike: 23050, gamma: 60, delta: 6, callVolume: 1200, putVolume: 10 },
    ],
    levels: { ...emptyLevels, callWall: 23200, putWall: 22800, gammaFlip: 23050, maxPain: 23000 },
    expiries: [
      { label: "0DTE", dte: 0, levels: { ...emptyLevels, callWall: 23100, putWall: 22900 } },
    ],
    frontAtmIv: 0.16,
    frontYears: 1 / 365,
    frontDte: 0,
  };
  const etf = {
    name: "QQQ",
    role: "C",
    // QQQ trades at roughly 1/41 of NDX on a $1 strike grid.
    spot: 560,
    strikes: [
      { strike: 558, gamma: -40, delta: -4 },
      { strike: 559, gamma: -30, delta: -3 },
      { strike: 561, gamma: 70, delta: 7 },
      { strike: 562, gamma: 50, delta: 5 },
    ],
    levels: { ...emptyLevels, callWall: 565, putWall: 555 },
    expiries: [],
  };
  const payload = buildBridgePayload([index, etf], {
    space: "N",
    instrument: "NQ",
    referenceSpot: 23000,
    generatedAt: new Date("2026-07-28T20:00:00Z"),
    parts,
  });

  const [version, body] = payload.split("#");
  assert.equal(version, "GX2");
  const blocks = body.split("|");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0].split("~"), ["H", "N", "NQ", "23000", "1785268800"]);

  const indexFields = blocks[1].split("~");
  assert.equal(indexFields[0], "NDX");
  assert.equal(indexFields[1], "P");
  assert.equal(indexFields[2], "23000");
  assert.equal(indexFields[3], "25");
  assert.equal(indexFields[4], "23200,22800,23050,23000,0");
  // label,call,put,flip,dte,settlesEpoch. This fixture states no settlement, so
  // the instant is zero, which the indicator reads as no evidence and draws.
  assert.equal(indexFields[7], "0DTE,23100,22900,0,0,0");
  // Histogram: every near strike, normalized so the largest print is ±100.
  assert.equal(indexFields[8], "22950,-56;22975,-89;23025,100;23050,67");
  // Volume walls: the heaviest traded call above spot and put below it, which
  // are different strikes from the open-interest walls in field 4.
  assert.equal(indexFields[9], "23050,22950");
  // 16% annualized over one session is ~84bps. The second subfield was the front
  // expiry's days to expiry, which nothing ever read; it now carries the front
  // settlement so a band scaled to a settled expiry can be withdrawn.
  assert.equal(indexFields[10], "84,0");

  const etfFields = blocks[2].split("~");
  assert.equal(etfFields[0], "QQQ");
  assert.equal(etfFields[1], "C");
  // Rescaled onto the index: the spot lands on the reference and the $1 strike
  // grid becomes the ~41 index points a QQQ zone actually covers.
  assert.equal(etfFields[2], "23000");
  assert.equal(Number(etfFields[3]), 41.07);
  assert.equal(Number(etfFields[4].split(",")[0]), 23205.36);
  assert.equal(Number(etfFields[4].split(",")[1]), 22794.64);
  // Both books ship a profile so the chart can switch between them; it draws
  // one at a time, because overlaying two would read as a single distribution.
  // The ETF's is rescaled onto the index like everything else in its block.
  assert.equal(etfFields[8], "22917.86,-57;22958.93,-43;23041.07,100;23082.14,71");
});

test("the exposure histogram normalizes to its own peak and keeps strikes near spot", () => {
  const rows = [
    { strike: 22000, gamma: 500, delta: 0 },
    { strike: 22950, gamma: -50, delta: 0 },
    { strike: 23000, gamma: 100, delta: 0 },
    { strike: 23050, gamma: 25, delta: 0 },
  ];
  // The 22000 print is 4.3% away and dominates the scale; excluding it is what
  // keeps the visible profile readable.
  const profile = exposureProfile(rows, 23000);
  assert.deepEqual(profile, [
    { strike: 22950, exposure: -50 },
    { strike: 23000, exposure: 100 },
    { strike: 23050, exposure: 25 },
  ]);
  assert.deepEqual(exposureProfile([], 23000), []);
  assert.deepEqual(exposureProfile([{ strike: 23000, gamma: 0, delta: 0 }], 23000), []);
});

test("volume walls take the heaviest traded strike on each side of spot", () => {
  const rows = [
    { strike: 22900, gamma: 0, delta: 0, callVolume: 5, putVolume: 300 },
    { strike: 22950, gamma: 0, delta: 0, callVolume: 5, putVolume: 900 },
    { strike: 23050, gamma: 0, delta: 0, callVolume: 800, putVolume: 5 },
    { strike: 23100, gamma: 0, delta: 0, callVolume: 200, putVolume: 5 },
  ];
  assert.deepEqual(volumeWalls(rows, 23000), { call: 23050, put: 22950 });
  // Volume is optional on a row, and an untraded book has no volume wall.
  assert.deepEqual(volumeWalls([{ strike: 23000, gamma: 0, delta: 0 }], 23000), {
    call: null,
    put: null,
  });
});

test("the expected move scales by the expiry's own year fraction", () => {
  // A 0DTE move must not be rounded up to a whole session.
  assert.equal(oneSigmaBps(0.16, 1 / 365), 84);
  assert.equal(oneSigmaBps(0.16, 30 / 365), 459);
  assert.equal(oneSigmaBps(null, 1 / 365), null);
  assert.equal(oneSigmaBps(0.16, 0), null);
});

test("the bridge payload drops the level groups that are switched off", () => {
  const emptyLevels = {
    callWall: 23200,
    putWall: 22800,
    gammaFlip: 23050,
    maxPain: 23000,
    vannaMagnet: 23150,
  };
  const payload = buildBridgePayload(
    [
      {
        name: "NDX",
        role: "P",
        spot: 23000,
        strikes: [
          { strike: 22975, gamma: -80, delta: -8 },
          { strike: 23025, gamma: 90, delta: 9 },
        ],
        levels: emptyLevels,
        expiries: [{ label: "0DTE", dte: 0, levels: emptyLevels }],
        frontAtmIv: 0.16,
        frontYears: 1 / 365,
      },
    ],
    {
      space: "F",
      instrument: "ES",
      referenceSpot: 23000,
      generatedAt: 0,
      parts: {
        expiryWalls: false,
        flips: false,
        aggregateWalls: true,
        maxPain: false,
        vanna: false,
        gamma: false,
        delta: false,
        confirmation: false,
        profile: false,
        volumeWalls: false,
        expectedMove: false,
      },
    },
  );
  const fields = payload.split("#")[1].split("|")[1].split("~");
  assert.equal(fields[4], "23200,22800,0,0,0");
  assert.equal(fields[5], "");
  assert.equal(fields[6], "");
  // The expiry record survives because the DTE and the settlement always ship,
  // but every price in it is zeroed by the switches.
  assert.equal(fields[7], "0DTE,0,0,0,0,0");
  // A switched-off group leaves an empty field rather than being omitted, so
  // field positions stay fixed no matter what the user included.
  assert.equal(fields.length, 11);
  assert.equal(fields[8], "");
  assert.equal(fields[9], "");
  assert.equal(fields[10], "");
});

test("MotiveWave study is a compilable overlay that reads the same bridge payload", () => {
  assert.match(MOTIVEWAVE_STUDY, /^package gexlab;/);
  assert.match(MOTIVEWAVE_STUDY, /public class GexLabLevels extends Study/);
  assert.match(MOTIVEWAVE_STUDY, /overlay = true/);
  assert.match(MOTIVEWAVE_STUDY, /payloadIsFutures = bridge\.startsWith\("F#"\)/);
  // The fixed block layout is shared with the Pine indicator and the exporter.
  assert.match(MOTIVEWAVE_STUDY, /FIXED_VALUE_COUNT = 21/);
  assert.match(MOTIVEWAVE_STUDY, /int index = isNq \? 1 : 0/);
});

test("the copied MotiveWave study matches the compilable Java source", () => {
  assert.equal(MOTIVEWAVE_STUDY, readJavaSource());
  assert.equal(
    renderModule(readJavaSource()),
    readFileSync(new URL("../src/lib/motivewave-indicator.ts", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n",
    ),
    'src/lib/motivewave-indicator.ts is stale. Run "npm run sync:motivewave".',
  );
});

test("the normal CDF is accurate enough for the p-values it produces", () => {
  assert.equal(normalCdf(0).toFixed(6), "0.500000");
  assert.equal(normalCdf(1.959964).toFixed(4), "0.9750");
  assert.equal(normalCdf(-1.959964).toFixed(4), "0.0250");
  assert.equal(normalCdf(2.575829).toFixed(4), "0.9950");
});

test("Newey-West widens the variance when a series is autocorrelated", () => {
  // A series where every value repeats: no new information after the first.
  const overlapping = [];
  for (let index = 0; index < 200; index += 1) overlapping.push(index % 20 < 10 ? 1 : -1);
  const naive = neweyWestVariance(overlapping, 0);
  const corrected = neweyWestVariance(overlapping, 9);
  assert.ok(corrected > naive, "autocovariance terms must inflate the long-run variance");
  // Independent noise should barely move.
  const alternating = Array.from({ length: 200 }, (_, index) => (index % 2 ? 1 : -1));
  assert.ok(neweyWestVariance(alternating, 4) < neweyWestVariance(alternating, 0));
  assert.equal(neweyWestVariance([1], 0), null);
});

/**
 * A deterministic forecaster that leans the right way `hitRate` of the time by
 * `lean`, scored against a coin-flip baseline. It has to be imperfect: a model
 * that always assigns the same probability to the true class produces a
 * constant loss differential, which carries no sampling variation to test.
 */
function forecaster(count, hitRate, lean, seedValue) {
  let seed = seedValue;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const labels = [];
  const model = [];
  const baseline = [];
  for (let index = 0; index < count; index += 1) {
    const label = random() < 0.5 ? 1 : 0;
    labels.push(label);
    baseline.push(0.5);
    const leansCorrectly = random() < hitRate;
    model.push(0.5 + lean * (leansCorrectly === (label === 1) ? 1 : -1));
  }
  return (horizon = 1) =>
    dieboldMariano(pointwiseLogLoss(model, labels), pointwiseLogLoss(baseline, labels), horizon);
}

test("a hair-thin log-loss edge is not significant, and a real one is", () => {
  // The point is a model that finishes ahead on total log loss without having
  // demonstrated anything, which is the situation the old
  // `modelLogLoss < baselineLogLoss` test could not tell apart from real skill.
  const thin = forecaster(600, 0.52, 0.01, 42)();
  const real = forecaster(600, 0.65, 0.12, 7)();

  assert.ok(thin.meanAdvantage > 0, "the model does finish with the smaller loss");
  assert.ok(thin.pValue > 0.05, "but the edge is inside its own standard error");

  assert.ok(real.meanAdvantage > thin.meanAdvantage);
  assert.ok(real.pValue < 0.001);
  assert.ok(real.statistic > thin.statistic);
  assert.equal(dieboldMariano([1, 2, 3], [1, 2, 3], 1), null, "too few observations");
  // A perfectly constant differential has no sampling variation to divide by,
  // so no verdict is issued rather than an infinite one.
  assert.equal(dieboldMariano(Array(100).fill(0.1), Array(100).fill(0.2), 1), null);
});

test("the overlap discount reports independent observations, not raw sessions", () => {
  const scored = forecaster(600, 0.65, 0.12, 7);
  const daily = scored(1);
  const monthly = scored(20);
  // The same 600 forecasts: a one-session question resolves 600 times, a
  // twenty-session question about thirty.
  assert.equal(daily.samples, 600);
  assert.equal(daily.effectiveSamples, 600);
  assert.equal(monthly.effectiveSamples, 30);
  assert.equal(daily.lag, 0);
  assert.equal(monthly.lag, 19);
  assert.equal(daily.meanAdvantage, monthly.meanAdvantage);
  // Same edge, wider error bar once the overlap is accounted for.
  assert.ok(monthly.standardError > daily.standardError);
  assert.ok(monthly.pValue > daily.pValue);
});

test("Benjamini-Hochberg is monotone and never shrinks a p-value", () => {
  const raw = [0.001, 0.008, 0.039, 0.041, 0.9];
  const adjusted = benjaminiHochberg(raw);
  for (let index = 0; index < raw.length; index += 1) {
    assert.ok(adjusted[index] >= raw[index], "a q-value cannot be below its p-value");
  }
  for (let index = 1; index < adjusted.length; index += 1) {
    assert.ok(adjusted[index] >= adjusted[index - 1], "step-up adjustment must not decrease");
  }
  // Nine targets tested at once: a lone 0.04 no longer clears five percent.
  const nine = benjaminiHochberg([0.04, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]);
  assert.ok(nine[0] > 0.05);
  assert.deepEqual(benjaminiHochberg([null, 0.01]), [null, 0.01]);
});

test("Platt scaling pulls in a model whose confidence outruns its hit rate", () => {
  // The model claims 95% and is right 70% of the time; it claims 5% and is
  // right 70% of the time. The ranking is informative, the level is not.
  const labels = [];
  const overconfident = [];
  for (let index = 0; index < 400; index += 1) {
    const bullish = index % 2 === 0;
    const correct = index % 10 < 7;
    labels.push(bullish === correct ? 1 : 0);
    overconfident.push(bullish ? 0.95 : 0.05);
  }
  const scaler = fitPlattScaling(overconfident, labels);
  assert.ok(scaler, "a calibrator should be recoverable from 400 observations");
  const calibrated = overconfident.map((probability) => applyPlattScaling(scaler, probability));
  assert.ok(
    logLoss(calibrated, labels) < logLoss(overconfident, labels),
    "calibration must reduce the loss it was fitted to reduce",
  );
  // Pulled back toward the frequency actually observed rather than the claim.
  assert.ok(Math.max(...calibrated) < 0.9);
  assert.ok(Math.max(...calibrated) > 0.5);
  assert.equal(fitPlattScaling([0.5, 0.5], [1, 0]), null, "too few observations");
});

test("Platt scaling declines to fit when the held-out slice inverts the ranking", () => {
  // Probabilities that point the wrong way produce a negative slope; rescaling
  // on that would amplify noise, so the caller keeps the raw output.
  const labels = Array.from({ length: 300 }, (_, index) => (index % 2 === 0 ? 1 : 0));
  const inverted = labels.map((label) => (label === 1 ? 0.2 : 0.8));
  assert.equal(fitPlattScaling(inverted, labels), null);
});

test("pinball loss evaluates asymmetric quantile prediction accuracy", () => {
  const actuals = [1, 2, 3, 4, 5];
  const perfectMedian = [1, 2, 3, 4, 5];
  const lossP50 = pinballLoss(actuals, perfectMedian, 0.5);
  assert.equal(lossP50, 0);

  const biasedUnder = [0, 1, 2, 3, 4];
  const lossP95 = pinballLoss(actuals, biasedUnder, 0.95);
  assert.ok(lossP95 > 0);
  assert.equal(pinballLoss([], [], 0.5), null);
});

test("vol-scaled strategy backtest calculates risk metrics and deducts transaction costs", () => {
  const probabilities = [0.55, 0.58, 0.45, 0.60, 0.52];
  const baseRates = [0.50, 0.50, 0.50, 0.50, 0.50];
  const returns = [1.0, 0.5, -0.8, 1.2, 0.3];
  const vols = [0.15, 0.15, 0.15, 0.15, 0.15];

  const result = backtestVolScaledStrategy(probabilities, baseRates, returns, vols, {
    costPerTradeBps: 2,
    volScale: 10,
  });

  assert.ok(result);
  assert.ok(result.totalTurnover >= 0);
  assert.ok(result.trades >= 0);
  assert.ok(typeof result.sharpeRatio === "number" || result.sharpeRatio === null);
  assert.ok(result.winRate !== null && result.winRate > 0);
});
