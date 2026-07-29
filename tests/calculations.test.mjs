import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  easternCloseIso,
  latestMarketObservationTime,
  nextQuarterHour,
  parseEasternTimestamp,
  parseUtcTimestamp,
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
  yearsToExpiry,
} from "../src/lib/options-math.ts";
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
  exposureProfile,
  minimumSeparation,
  oneSigmaBps,
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
  // parser hands its results back by mutating arrays instead.
  assert.match(PINE_SCRIPT, /array\.set\(meta_levels, 0, call_wall\)/);
  assert.match(PINE_SCRIPT, /array\.set\(meta_names, role, name\)/);
});

test("TradingView bridge script draws the histogram, regime, expected move and agreement", () => {
  // The exposure profile the walls are peaks of.
  assert.match(PINE_SCRIPT, /show_profile = input\.bool/);
  assert.match(PINE_SCRIPT, /array\.push\(hist_strike, strike\)/);
  // Regime shading has to be global scope: bgcolor cannot be called in a block.
  assert.match(PINE_SCRIPT, /\nbgcolor\(regime_active \?/);
  // Expected move arrives pre-scaled in bps so a 0DTE move is not rounded up.
  assert.match(PINE_SCRIPT, /sigma_bps \/ 10000\.0/);
  // Levels both books agree on are flagged rather than silently merged.
  assert.match(PINE_SCRIPT, /agreed = from_index and from_confirm/);
  assert.match(PINE_SCRIPT, /agreed \? "✓ " : ""/);
  // Lines start where the snapshot was taken, not at an arbitrary lookback.
  assert.match(PINE_SCRIPT, /anchor_snapshot and snapshot_bar > 0 \? snapshot_bar/);
  assert.match(PINE_SCRIPT, /payload_epoch \* 1000 < time_tradingday/);
  // One alert stream that names whichever level was reached.
  assert.match(PINE_SCRIPT, /alert\("GEXLab " \+ syminfo\.ticker/);
});

test("TradingView bridge script renders each book in its own style and survives gapped history", () => {
  // The index chain is a definite price and draws as a line; the ETF chain is
  // rescaled onto it and draws as the band that conversion is actually good to.
  assert.match(PINE_SCRIPT, /index_style = input\.string\("Line", "Index book/);
  assert.match(PINE_SCRIPT, /confirm_style = input\.string\("Zone", "Confirmation book/);
  assert.match(PINE_SCRIPT, /prior_style = input\.string\("Line", "Prior-session walls"/);
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
  // alert() throttles by call site, so every level touched in a bar is gathered
  // into one message rather than the loop firing once and being suppressed.
  assert.match(PINE_SCRIPT, /if touched != ""/);
  assert.match(PINE_SCRIPT, /alert\("GEXLab " \+ syminfo\.ticker \+ ": " \+ touched/);
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
    prior: true,
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
    priorLevels: { ...emptyLevels, callWall: 23150, putWall: 22750, gammaFlip: 23010 },
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
    priorLevels: { ...emptyLevels, callWall: 566 },
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
  assert.equal(indexFields[7], "0DTE,23100,22900,0,0");
  // Histogram: every near strike, normalized so the largest print is ±100.
  assert.equal(indexFields[8], "22950,-56;22975,-89;23025,100;23050,67");
  // Volume walls: the heaviest traded call above spot and put below it, which
  // are different strikes from the open-interest walls in field 4.
  assert.equal(indexFields[9], "23050,22950");
  // 16% annualized over one session is ~84bps, and the DTE rides along.
  assert.equal(indexFields[10], "84,0");
  assert.equal(indexFields[11], "23150,22750,23010");

  const etfFields = blocks[2].split("~");
  assert.equal(etfFields[0], "QQQ");
  assert.equal(etfFields[1], "C");
  // Rescaled onto the index: the spot lands on the reference and the $1 strike
  // grid becomes the ~41 index points a QQQ zone actually covers.
  assert.equal(etfFields[2], "23000");
  assert.equal(Number(etfFields[3]), 41.07);
  assert.equal(Number(etfFields[4].split(",")[0]), 23205.36);
  assert.equal(Number(etfFields[4].split(",")[1]), 22794.64);
  // The histogram and the prior-session walls stay on the primary book: a second
  // profile on the same axis would read as one distribution, and a second book's
  // migration doubles the faded lines for no added answer.
  assert.equal(etfFields[8], "");
  assert.equal(etfFields[11], "");
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
        priorLevels: emptyLevels,
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
        prior: false,
      },
    },
  );
  const fields = payload.split("#")[1].split("|")[1].split("~");
  assert.equal(fields[4], "23200,22800,0,0,0");
  assert.equal(fields[5], "");
  assert.equal(fields[6], "");
  // The expiry record survives because the DTE always ships, but every price in
  // it is zeroed by the switches.
  assert.equal(fields[7], "0DTE,0,0,0,0");
  // A switched-off group leaves an empty field rather than being omitted, so
  // field positions stay fixed no matter what the user included.
  assert.equal(fields.length, 12);
  assert.equal(fields[8], "");
  assert.equal(fields[9], "");
  assert.equal(fields[10], "");
  assert.equal(fields[11], "");
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
