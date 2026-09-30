import { NextResponse } from "next/server";
import {
  applyStandardizer,
  backtestVolScaledStrategy,
  benjaminiHochberg,
  fitStandardizer,
  harFeatures,
  logisticFit,
  logisticPredict,
  ridgeFit,
  smearingFactor,
  walkForward,
  withIntercept,
} from "@/lib/forecast";
import {
  buildFeatureRows,
  FEATURE_INDEX,
  FEATURE_NAMES,
  type FeatureRow,
  type SeriesStore,
} from "@/lib/engine-features";
import {
  evaluateVolatility,
  type ClassifierEvaluation,
  mean,
  selectPenalty,
  trueRangeByDate,
  WALK_FORWARD,
  wilderAtrByDate,
} from "@/lib/server/engine-evaluation";
import { runEngineJobs } from "@/lib/server/engine-pool";
import type { ClassifierJob } from "@/lib/server/engine-worker";
import { buildSessionContext } from "@/lib/session-context";
import type { SessionContext } from "@/lib/session-context";
import { loadFomcMeetings, loadPublishedReleaseDates } from "@/lib/server/event-sources";
import { loadGeoeconomicEvents } from "@/lib/server/geoeconomic-event-sources";
import { nowcastIndexPair } from "@/lib/server/index-nowcast";
import { loadMacroSeriesStore } from "@/lib/server/macro-sources";
import { loadYahooOvernightContext } from "@/lib/server/yahoo-futures";
import { dedupeRequest } from "@/lib/server/request-deduper";
import { loadYahooDailyOhlc } from "@/lib/server/yahoo-daily";
import { buildMoveMap } from "@/lib/move-map";
import { MACRO_SERIES_IDS } from "@/lib/server/series-catalog";
import { MARKET_CALENDAR_VERSION, nextWeekday } from "@/lib/market-time";
import {
  getSnapshot,
  loadEngineFeatureCoverage,
  loadEngineFeatures,
  loadIntradayCoverage,
  loadEnginePredictions,
  putSnapshot,
  saveEnginePrediction,
  snapshotIsFresh,
} from "@/lib/server/snapshot-store";

export const runtime = "nodejs";

const MODEL_VERSION = "engine-v1.12.0";
const CACHE_MS = 6 * 60 * 60 * 1000;
const HISTORY_START = "1999-01-01";

const MINIMUM_POSITIONING_SESSIONS = 750;
// The intraday log reaches the same number of observations far sooner, but
// bars from one session are correlated, so the nominal count overstates the
// independent information. Dividing by an assumed within-day cluster size is
// a rough correction, and it is applied so the progress shown is the honest
// one rather than the flattering one.
const INTRADAY_CLUSTER_SIZE = 5;


/**
 * Conditional base rates.
 *
 * Direction is close to unpredictable on an average day, but it is not
 * uniformly unpredictable: the frequency of up sessions differs across states.
 * This table reports those differences directly from history with a binomial
 * standard error attached, so a difference can be compared against the noise
 * it would show even if nothing were there.
 *
 * These are descriptive in-sample frequencies over the whole record, not model
 * output, and several states are examined at once — a couple of two-sigma
 * readings are expected by chance alone.
 */
function conditionalStates(rows: FeatureRow[]) {
  const usable = rows.filter((row) => row.forwardReturn !== null);
  const overall = usable.filter((row) => row.forwardReturn! > 0).length / usable.length;
  const definitions: Array<{ label: string; note: string; test: (row: FeatureRow) => boolean }> = [
    {
      label: "After a 2%+ down session",
      note: "Large one-day declines, all volatility regimes pooled.",
      test: (row) => row.currentReturn <= -2,
    },
    {
      label: "After a 2%+ down session, calm regime",
      note: "The same shock when 20-session realized volatility is below its median.",
      test: (row) => row.currentReturn <= -2 && row.features[FEATURE_INDEX["realized vol 20d"]] < 18,
    },
    {
      label: "After a 2%+ down session, stressed regime",
      note: "The same shock when realized volatility is already elevated.",
      test: (row) => row.currentReturn <= -2 && row.features[FEATURE_INDEX["realized vol 20d"]] >= 30,
    },
    {
      label: "Turn of month",
      note: "Last three and first three sessions of a calendar month.",
      test: (row) => row.features[FEATURE_INDEX["turn of month"]] === 1,
    },
    {
      label: "Monthly expiry week",
      note: "Sessions within three days of the third Friday.",
      test: (row) => row.features[FEATURE_INDEX["expiry week"]] === 1,
    },
    {
      label: "Day before a major release",
      note: "CPI, payrolls, or PPI published the following session.",
      test: (row) => row.features[FEATURE_INDEX["event tomorrow"]] === 1,
    },
    {
      label: "Within 2 days of an FOMC decision",
      note: "The run-up window into a scheduled decision.",
      test: (row) => row.features[FEATURE_INDEX["days to FOMC"]] <= 2,
    },
    {
      label: "Inverted volatility curve",
      note: "Front implied volatility above the three-month, a stress signature.",
      test: (row) => row.features[FEATURE_INDEX["implied volatility curve"]] > 1,
    },
    {
      label: "Deep drawdown",
      note: "More than 10% below the 60-session high.",
      test: (row) => row.features[FEATURE_INDEX["drawdown from 60d high"]] <= -10,
    },
  ];

  return {
    overall: overall * 100,
    samples: usable.length,
    rows: definitions
      .map((definition) => {
        const selected = usable.filter(definition.test);
        if (selected.length < 40) return null;
        const upRate = selected.filter((row) => row.forwardReturn! > 0).length / selected.length;
        const standardError = Math.sqrt((overall * (1 - overall)) / selected.length);
        const zScore = standardError === 0 ? 0 : (upRate - overall) / standardError;
        return {
          label: definition.label,
          note: definition.note,
          samples: selected.length,
          upRate: upRate * 100,
          edge: (upRate - overall) * 100,
          meanReturn: mean(selected.map((row) => row.forwardReturn!)),
          zScore: Number(zScore.toFixed(2)),
          notable: Math.abs(zScore) >= 2,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => Math.abs(right.zScore) - Math.abs(left.zScore)),
    caveat:
      "In-sample frequencies across the whole record, shown with the standard error a coin flip would produce at the same sample size. Nine states are examined at once, so one or two readings beyond two standard errors are expected even if none of them are real.",
  };
}

function directionLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forwardReturn === null ? null : row.forwardReturn > 0 ? 1 : 0,
  );
}

function direction5dLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forward5dReturn === null ? null : row.forward5dReturn > 0 ? 1 : 0,
  );
}

function direction20dLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forward20dReturn === null ? null : row.forward20dReturn > 0 ? 1 : 0,
  );
}

function direction60dLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forward60dReturn === null ? null : row.forward60dReturn > 0 ? 1 : 0,
  );
}

/**
 * Continuation is the daily analogue of trending behaviour: the next session
 * closing in the same direction as the one just finished. It is the label a
 * mean-reversion or trend-following decision actually depends on.
 */
function continuationLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forwardReturn === null
      ? null
      : Math.sign(row.forwardReturn) === Math.sign(row.currentReturn)
        ? 1
        : 0,
  );
}

function volatilityExpansionLabels(rows: FeatureRow[]) {
  return rows.map((row, index) => {
    const pastVol20 = row.features[FEATURE_INDEX["realized vol 20d"]];
    if (index + 5 >= rows.length) return null;
    // The label begins after the feature date. Including today's return here
    // would make the target partially observable at prediction time.
    const f5Returns = rows.slice(index + 1, index + 6).map((r) => r.currentReturn);
    const meanF5 = f5Returns.reduce((a, b) => a + b, 0) / 5;
    const varianceF5 = f5Returns.reduce((sum, val) => sum + (val - meanF5) ** 2, 0) / 5;
    const forwardVol5 = Math.sqrt(varianceF5) * Math.sqrt(252);
    return forwardVol5 > pastVol20 ? 1 : 0;
  });
}

function wideRangeDayLabels(rows: FeatureRow[]) {
  return rows.map((row, index) => {
    if (index < 20 || index + 1 >= rows.length) return null;
    const nextRet = Math.abs(rows[index + 1].currentReturn);
    const avgRet20 = rows
      .slice(index - 20, index)
      .reduce((sum, r) => sum + Math.abs(r.currentReturn), 0) / 20;
    return nextRet > 1.5 * avgRet20 ? 1 : 0;
  });
}

function rallySpike5dLabels(rows: FeatureRow[]) {
  return rows.map((row) =>
    row.forward5dReturn === null ? null : row.forward5dReturn >= 3 ? 1 : 0,
  );
}

function downsideTailLabels(rows: FeatureRow[]) {
  return rows.map((row) => {
    if (row.forwardReturn === null) return null;
    const dailyVol = row.features[FEATURE_INDEX["realized vol 20d"]] / Math.sqrt(252);
    const threshold = Math.max(1, dailyVol * 1.5);
    return row.forwardReturn <= -threshold ? 1 : 0;
  });
}

function drawdown5dLabels(rows: FeatureRow[]) {
  return rows.map((row) => {
    if (row.forward5dDrawdown === null) return null;
    const dailyVol = row.features[FEATURE_INDEX["realized vol 20d"]] / Math.sqrt(252);
    const threshold = Math.max(2, dailyVol * 2.5);
    return row.forward5dDrawdown <= -threshold ? 1 : 0;
  });
}


function fitCurrent(rows: FeatureRow[], labels: Array<number | null>) {
  const usableIndexes = labels
    .map((label, index) => (label === null ? null : index))
    .filter((index): index is number => index !== null);
  const usable = usableIndexes.map((index) => rows[index]);
  const usableLabels = usableIndexes.map((index) => labels[index]!);
  const window = usable.slice(-WALK_FORWARD.maxTrain);
  const windowLabels = usableLabels.slice(-WALK_FORWARD.maxTrain);
  if (window.length < 400) return null;
  const standardizer = fitStandardizer(window.map((row) => row.features));
  const design = window.map((row) => withIntercept(applyStandardizer(standardizer, row.features)));
  const penalty = selectPenalty(design, windowLabels);
  const weights = logisticFit(design, windowLabels, { penalty, iterations: 20 });
  if (!weights) return null;
  return { standardizer, weights, penalty, baseRate: mean(windowLabels) };
}

/**
 * Hands the event loop back.
 *
 * The classifiers run on worker threads now, but the phases around them —
 * building the feature rows, the four current-model fits, the strategy
 * backtest — are still CPU on the request thread. Yielding between them caps
 * how long another request can be stuck behind a rebuild at one phase rather
 * than all of them; measured, it is the difference between an occasional
 * two-and-a-half second wait and a shorter one.
 */
function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function buildPayload() {
  const { store: publishedStore } = await loadMacroSeriesStore(MACRO_SERIES_IDS);
  // Advance past the publication calendar before anything is fitted. Without
  // this the engine spends the whole overnight window — the one time a
  // next-session read is worth having — forecasting a session that has already
  // traded, because FRED will not republish the close until the next morning.
  const advanced = nowcastIndexPair(publishedStore);
  const store = advanced.store;
  const provisionalSession = advanced.provisional;
  const prices = (store as SeriesStore).NASDAQ100 ?? [];
  if (prices.length < 500) throw new Error("The index price series is unavailable.");

  const studyYears = Array.from({ length: 11 }, (_, index) => new Date().getUTCFullYear() - 10 + index);
  const [releases, meetings, geoeconomicEvents] = await Promise.all([
    loadPublishedReleaseDates(studyYears).catch(() => []),
    loadFomcMeetings().catch(() => null),
    loadGeoeconomicEvents().catch(() => null),
  ]);
  const majorReleases = new Set(
    releases
      .filter((release) => /^(consumer price index|employment situation|producer price index)$/i.test(release.title))
      .map((release) => release.date),
  );
  const fomcDates = (meetings ?? []).filter((meeting) => !meeting.unscheduled).map((meeting) => meeting.end);
  const eventNames = new Map<string, string[]>();
  for (const release of releases.filter((item) =>
    /^(consumer price index|employment situation|producer price index)$/i.test(item.title),
  )) {
    const labels = eventNames.get(release.date) ?? [];
    labels.push(release.title === "Employment Situation" ? "Payrolls" : release.title.replace(" Index", ""));
    eventNames.set(release.date, labels);
  }
  for (const meeting of (meetings ?? []).filter((item) => !item.unscheduled)) {
    const labels = eventNames.get(meeting.end) ?? [];
    labels.push(meeting.projections ? "FOMC + projections" : "FOMC decision");
    eventNames.set(meeting.end, labels);
  }

  await yieldToEventLoop();
  const rows = buildFeatureRows(store as SeriesStore, {
    releaseDates: majorReleases,
    fomcDates,
  }, { minDate: HISTORY_START });
  if (rows.length < WALK_FORWARD.initialTrain + WALK_FORWARD.refitEvery) {
    throw new Error("Not enough sessions to evaluate the model.");
  }

  // The ten targets are independent fits over the same rows, dispatched
  // together so they run on worker threads instead of one after another on the
  // thread serving requests. The daily bars travel with the volatility job
  // because it is the only one that needs them.
  const yahooDaily = await loadYahooDailyOhlc("NDX");
  const dailyOhlc = yahooDaily.rows.filter((bar) => bar.date <= rows.at(-1)!.date);
  const rangeByDate = trueRangeByDate(dailyOhlc);
  const atr14ByDate = wilderAtrByDate(dailyOhlc, 14);
  const atr50ByDate = wilderAtrByDate(dailyOhlc, 50);

  const classifierJobs: ClassifierJob[] = [
    { id: "direction", kind: "classifier", rows, labels: directionLabels(rows), target: "direction", question: "Will the next session close higher?", horizon: 1 },
    { id: "direction5d", kind: "classifier", rows, labels: direction5dLabels(rows), target: "direction5d", question: "Will the index close higher over the next 5 sessions?", horizon: 5 },
    { id: "direction20d", kind: "classifier", rows, labels: direction20dLabels(rows), target: "direction20d", question: "Will the index close higher over the next 20 sessions?", horizon: 20 },
    { id: "direction60d", kind: "classifier", rows, labels: direction60dLabels(rows), target: "direction60d", question: "Will the index close higher over the next 60 sessions?", horizon: 60 },
    { id: "continuation", kind: "classifier", rows, labels: continuationLabels(rows), target: "continuation", question: "Will the next session move in the same direction as this one?", horizon: 1 },
    { id: "volatilityExpansion", kind: "classifier", rows, labels: volatilityExpansionLabels(rows), target: "volatilityExpansion", question: "Will 5-day realized volatility expand above the 20-day baseline?", horizon: 5 },
    { id: "wideRangeDay", kind: "classifier", rows, labels: wideRangeDayLabels(rows), target: "wideRangeDay", question: "Will the next session be an explosive wide-range day (>1.5x 20d ATR)?", horizon: 1 },
    { id: "rallySpike5d", kind: "classifier", rows, labels: rallySpike5dLabels(rows), target: "rallySpike5d", question: "Will the index experience an explosive 5-day rally spike (>= +3%)?", horizon: 5 },
    { id: "downsideTail", kind: "classifier", rows, labels: downsideTailLabels(rows), target: "downsideTail", question: "Will the next session fall by an unusually large amount?", horizon: 1 },
    { id: "drawdown5d", kind: "classifier", rows, labels: drawdown5dLabels(rows), target: "drawdown5d", question: "Will the next five sessions contain a material drawdown?", horizon: 5 },
  ];

  const evaluated = await runEngineJobs([
    ...classifierJobs,
    { id: "volatility", kind: "volatility", rows, bars: dailyOhlc },
  ]);
  const classifier = (id: string) => (evaluated.get(id) ?? null) as ClassifierEvaluation | null;

  const direction = classifier("direction");
  const direction5d = classifier("direction5d");
  const direction20d = classifier("direction20d");
  const direction60d = classifier("direction60d");
  const continuation = classifier("continuation");
  const volatilityExpansion = classifier("volatilityExpansion");
  const wideRangeDay = classifier("wideRangeDay");
  const rallySpike5d = classifier("rallySpike5d");
  const downsideTail = classifier("downsideTail");
  const drawdown5d = classifier("drawdown5d");
  const volatility = (evaluated.get("volatility") ?? null) as ReturnType<typeof evaluateVolatility>;

  // Ten targets are each tested against their own base rate, so at a nominal
  // five percent a couple would be expected to clear the bar on noise alone.
  // The verdict shown is the one that survives the correction, not the raw test.
  const scored = [
    direction,
    direction5d,
    direction20d,
    direction60d,
    continuation,
    volatilityExpansion,
    wideRangeDay,
    rallySpike5d,
    downsideTail,
    drawdown5d,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const qValues = benjaminiHochberg(scored.map((entry) => entry.comparison?.pValue ?? null));
  scored.forEach((entry, index) => {
    entry.falseDiscoveryRate = qValues[index];
    entry.beatsBaseline =
      entry.comparison !== null &&
      entry.comparison.meanAdvantage > 0 &&
      qValues[index] !== null &&
      qValues[index]! < 0.05;
  });

  const dailyLabels = directionLabels(rows);
  const evalIndexes = dailyLabels
    .map((label, index) => (label === null ? null : index))
    .filter((index): index is number => index !== null);
  const evalUsable = evalIndexes.map((index) => rows[index]);
  const evalLabels = evalIndexes.map((index) => dailyLabels[index]!);
  const backtestProbs: number[] = [];
  const backtestBaseRates: number[] = [];
  const backtestReturns: number[] = [];
  const backtestVols: number[] = [];

  // The strategy trades and realizes daily, so it must use the daily target.
  // Applying a 20-session probability to a one-session return overstated what
  // the backtest actually tested.
  const predictionsDailyBacktest = walkForward<number>(evalUsable.length, WALK_FORWARD, (train, predict) => {
    const trainFeatures = evalUsable.slice(train[0], train[1]).map((row) => row.features);
    const trainLabels = evalLabels.slice(train[0], train[1]);
    if (trainFeatures.length < 200) return [];
    const standardizer = fitStandardizer(trainFeatures);
    const design = trainFeatures.map((row) => withIntercept(applyStandardizer(standardizer, row)));
    const penalty = selectPenalty(design, trainLabels);
    const weights = logisticFit(design, trainLabels, { penalty, iterations: 12 });
    if (!weights) return [];
    return evalUsable
      .slice(predict[0], predict[1])
      .map((row) => logisticPredict(weights, withIntercept(applyStandardizer(standardizer, row.features))));
  });

  for (const item of predictionsDailyBacktest) {
    const row = evalUsable[item.index];
    const baseRate = mean(evalLabels.slice(0, Math.max(item.index - WALK_FORWARD.embargo, 1)));
    backtestProbs.push(item.prediction);
    backtestBaseRates.push(baseRate);
    backtestReturns.push(row.forwardReturn!);
    backtestVols.push(row.features[FEATURE_INDEX["realized vol 20d"]] / 100);
  }

  await yieldToEventLoop();
  const economicStrategy = backtestVolScaledStrategy(
    backtestProbs,
    backtestBaseRates,
    backtestReturns,
    backtestVols,
    { costPerTradeBps: 2, volScale: 2 },
  );

  const lastRow = rows.at(-1)!;
  const nextSessionDate = nextWeekday(lastRow.date);
  const overnight = await loadYahooOvernightContext({
    sessionDate: nextSessionDate,
    priorSessionDate: lastRow.date,
  });
  const moveReference = prices.at(-1)?.value ?? 0;
  const sessionContext = buildSessionContext({
    asOf: lastRow.date,
    nextSession: nextSessionDate,
    ndx: store.NASDAQ100 ?? [],
    spx: store.SP500 ?? [],
    vix: store.VIXCLS ?? [],
    positioning: loadEngineFeatures("NDX", 256),
    eventNames,
    overnight,
  });
  // Yahoo can expose the in-progress daily bar before the Engine has a
  // completed daily observation. Keep the move target aligned to the same
  // completed close that anchors its reference price and next-session date.
  const eventForecastDates = new Set(
    rows
      .filter((row) => majorReleases.has(nextWeekday(row.date)) || fomcDates.includes(nextWeekday(row.date)))
      .map((row) => row.date),
  );
  const impliedByDate = new Map(
    (store.VIXCLS ?? [])
      .filter((row) => Number.isFinite(row.value) && row.value > 0)
      .map((row) => [row.date, row.value / Math.sqrt(252)]),
  );
  const seriesByDate = (series: typeof store.VIXCLS | undefined) => new Map(
    (series ?? []).filter((row) => Number.isFinite(row.value)).map((row) => [row.date, row.value]),
  );
  const vixByDate = seriesByDate(store.VIXCLS);
  const vxnByDate = seriesByDate(store.VXNCLS);
  const vxvByDate = seriesByDate(store.VXVCLS);
  const volatilityByDate = new Map([...vixByDate.keys()].map((date) => [date, {
    vix: vixByDate.get(date) ?? null,
    vxn: vxnByDate.get(date) ?? null,
    vxv: vxvByDate.get(date) ?? null,
  }]));
  const moveMap = buildMoveMap({
    bars: dailyOhlc,
    sourceStatus: yahooDaily.stale ? "Saved" : dailyOhlc.length ? "Live" : "Unavailable",
    reference: moveReference > 0 ? moveReference : dailyOhlc.at(-1)?.close ?? 0,
    impliedMove: sessionContext.impliedMove.percent === null
      ? null
      : sessionContext.impliedMove.percent / Math.sqrt(Math.max(sessionContext.impliedMove.horizonDays ?? 1, 1)),
    impliedByDate,
    eventDates: eventForecastDates,
    nextSessionIsEvent: sessionContext.event.isNextSessionEvent,
    volatilityByDate,
    gamma: sessionContext.gamma,
  });
  await yieldToEventLoop();
  const directionFit = fitCurrent(rows, directionLabels(rows));
  await yieldToEventLoop();
  const direction20dFit = fitCurrent(rows, direction20dLabels(rows));
  await yieldToEventLoop();
  const direction60dFit = fitCurrent(rows, direction60dLabels(rows));
  await yieldToEventLoop();
  const continuationFit = fitCurrent(rows, continuationLabels(rows));
  const directionProbability = directionFit
    ? logisticPredict(
        directionFit.weights,
        withIntercept(applyStandardizer(directionFit.standardizer, lastRow.features)),
      )
    : null;
  const continuationProbability = continuationFit
    ? logisticPredict(
        continuationFit.weights,
        withIntercept(applyStandardizer(continuationFit.standardizer, lastRow.features)),
      )
    : null;
  const horizonProbability = (fit: ReturnType<typeof fitCurrent>) =>
    fit
      ? logisticPredict(fit.weights, withIntercept(applyStandardizer(fit.standardizer, lastRow.features)))
      : null;
  const direction20dProbability = horizonProbability(direction20dFit);
  const direction60dProbability = horizonProbability(direction60dFit);

  // The two targets that actually beat their baseline were only ever
  // backtested; no live probability was produced for either, so the one part of
  // this engine with measured skill said nothing about the next session. Both
  // describe how the next session behaves rather than which way it goes, which
  // is the half of the problem that survives testing at this horizon.
  await yieldToEventLoop();
  const wideRangeFit = fitCurrent(rows, wideRangeDayLabels(rows));
  const wideRangeProbability = wideRangeFit
    ? logisticPredict(
        wideRangeFit.weights,
        withIntercept(applyStandardizer(wideRangeFit.standardizer, lastRow.features)),
      )
    : null;
  await yieldToEventLoop();
  const volatilityExpansionFit = fitCurrent(rows, volatilityExpansionLabels(rows));
  const volatilityExpansionProbability = volatilityExpansionFit
    ? logisticPredict(
        volatilityExpansionFit.weights,
        withIntercept(applyStandardizer(volatilityExpansionFit.standardizer, lastRow.features)),
      )
    : null;

  const absoluteReturns = rows.map((row) => Math.abs(row.currentReturn));
  const impliedDailySeries = rows.map(
    (row) => row.features[FEATURE_INDEX["implied volatility level"]] / Math.sqrt(252),
  );
  const trueRangeSeries = rangeByDate.size >= 400
    ? rows.map((row) => rangeByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const atr14Series = atr14ByDate.size >= 400
    ? rows.map((row) => atr14ByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const atr50Series = atr50ByDate.size >= 400
    ? rows.map((row) => atr50ByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const impliedCurveSeries = rows.map(
    (row) => row.features[FEATURE_INDEX["implied volatility curve"]],
  );
  const volatilityTargets = rows.map((row) =>
    row.forwardAbsolute === null ? null : Math.log(Math.max(row.forwardAbsolute, 0.01)),
  );
  const trainDesign: number[][] = [];
  const trainResponse: number[] = [];
  for (let index = Math.max(rows.length - WALK_FORWARD.maxTrain, 22); index < rows.length; index += 1) {
    const features = harFeatures(
      absoluteReturns,
      index,
      impliedDailySeries,
      trueRangeSeries,
      impliedCurveSeries,
      atr14Series,
      atr50Series,
    );
    const response = volatilityTargets[index];
    if (!features || response === null) continue;
    trainDesign.push(features);
    trainResponse.push(response);
  }
  const volatilityWeights = trainDesign.length > 200 ? ridgeFit(trainDesign, trainResponse, 1e-4) : null;
  const currentHar = harFeatures(
    absoluteReturns,
    rows.length - 1,
    impliedDailySeries,
    trueRangeSeries,
    impliedCurveSeries,
    atr14Series,
    atr50Series,
  );
  const volatilitySmearing = volatilityWeights
    ? smearingFactor(
        trainResponse.map(
          (value, index) =>
            value -
            trainDesign[index].reduce((sum, entry, position) => sum + entry * volatilityWeights[position], 0),
        ),
      )
    : 1;
  const expectedMove =
    volatilityWeights && currentHar
      ? Math.exp(currentHar.reduce((sum, value, index) => sum + value * volatilityWeights[index], 0)) *
        volatilitySmearing
      : null;

  const quantiles = volatility?.quantiles ?? null;
  const range =
    expectedMove !== null && quantiles
      ? {
          low95: quantiles.p05 === null ? null : quantiles.p05 * expectedMove,
          low50: quantiles.p25 === null ? null : quantiles.p25 * expectedMove,
          median: quantiles.p50 === null ? null : quantiles.p50 * expectedMove,
          high50: quantiles.p75 === null ? null : quantiles.p75 * expectedMove,
          high95: quantiles.p95 === null ? null : quantiles.p95 * expectedMove,
        }
      : null;

  // The forecast is written before the session it describes so the live record
  // is built from predictions that existed in advance.
  if (directionProbability !== null) {
    saveEnginePrediction({
      targetDate: nextSessionDate,
      target: "direction",
      probability: directionProbability,
      expectedMove,
      modelVersion: MODEL_VERSION,
      predictedAt: new Date().toISOString(),
    });
  }
  if (continuationProbability !== null) {
    saveEnginePrediction({
      targetDate: nextSessionDate,
      target: "continuation",
      probability: continuationProbability,
      expectedMove: null,
      modelVersion: MODEL_VERSION,
      predictedAt: new Date().toISOString(),
    });
  }

  // Scoring the live log uses the same price series as everything else, so a
  // prediction is only marked once the session it named has actually printed.
  const priceByDate = new Map(prices.map((row, index) => [row.date, index]));
  const liveRecords = loadEnginePredictions(200)
    .map((prediction) => {
      const index = priceByDate.get(prediction.targetDate);
      if (index === undefined || index < 1) {
        return { ...prediction, realized: null, correct: null };
      }
      const realized = Math.log(prices[index].value / prices[index - 1].value) * 100;
      const previous = index >= 2 ? Math.log(prices[index - 1].value / prices[index - 2].value) * 100 : null;
      const outcome =
        prediction.target === "direction"
          ? realized > 0
          : previous === null
            ? null
            : Math.sign(realized) === Math.sign(previous);
      const correct =
        outcome === null || prediction.probability === null
          ? null
          : (prediction.probability >= 0.5) === outcome;
      return { ...prediction, realized, correct };
    })
    .filter((record) => record.probability !== null);
  const settled = liveRecords.filter((record) => record.correct !== null);

  const lastPrice = prices.at(-1)?.value ?? 0;
  const dollarRange =
    range && lastPrice > 0
      ? {
          low95Price: range.low95 !== null ? Number((lastPrice * (1 + range.low95 / 100)).toFixed(2)) : null,
          low50Price: range.low50 !== null ? Number((lastPrice * (1 + range.low50 / 100)).toFixed(2)) : null,
          medianPrice: range.median !== null ? Number((lastPrice * (1 + range.median / 100)).toFixed(2)) : null,
          high50Price: range.high50 !== null ? Number((lastPrice * (1 + range.high50 / 100)).toFixed(2)) : null,
          high95Price: range.high95 !== null ? Number((lastPrice * (1 + range.high95 / 100)).toFixed(2)) : null,
        }
      : null;

  const liveVol = Math.max(lastRow.features[FEATURE_INDEX["realized vol 20d"]] / 100, 0.005);
  const dirProb = directionProbability ?? 0.55;
  const dirBase = directionFit?.baseRate ?? 0.55;
  // Sizing is gated on the daily direction model having measurably beaten its
  // own base rate out of sample. It has not: the evaluation puts its ROC-AUC at
  // roughly a half. Scaling a position by the gap between two numbers that are
  // statistically the same number is how a chart of noise becomes an
  // instruction, so the gap is only allowed to move the position once the test
  // says the gap is real. If the model ever earns it, this turns itself on.
  const directionHasSkill = direction?.beatsBaseline ?? false;
  const rawSizingSignal = directionHasSkill ? (dirProb - dirBase) / (liveVol * 2) : 0;
  const currentPositionScale = Math.min(Math.max(rawSizingSignal, -1.0), 1.0);
  const positionPct = Math.round(currentPositionScale * 100);
  const cashPct = Math.max(0, 100 - Math.abs(positionPct));
  const exposureLabel = !directionHasSkill
    ? "No measured edge — cash"
    : positionPct > 50
      ? "Strong Long"
      : positionPct > 15
        ? "Moderate Long"
        : positionPct < -15
          ? "Defensive Short / Cash"
          : "Neutral / Cash";
  const exposureBasis = directionHasSkill
    ? "Sized from the daily direction model's edge over its base rate, scaled by realized volatility."
    : "The daily direction model has not beaten its base rate out of sample, so no position is recommended.";

  return {
    modelVersion: MODEL_VERSION,
    marketCalendarVersion: MARKET_CALENDAR_VERSION,
    fetchedAt: new Date().toISOString(),
    asOf: lastRow.date,
    nextSession: nextSessionDate,
    // Whether the newest close came from the exchange snapshot rather than
    // FRED. Same session, ahead of the publication calendar, but a different
    // source, and it decides which session the forecast is actually about.
    provisionalSession: provisionalSession
      ? {
          date: provisionalSession.date,
          source: "Exchange close captured with the option chain, ahead of the FRED release",
        }
      : null,
    index: "Nasdaq-100",
    lastPrice,
    // Policy events are delivered to the engine so the pre-session briefing
    // and macro page see the same evidence. They remain outside the fitted
    // probability until an event feature has an honest walk-forward record.
    geoeconomicEvents,
    forecast: {
      direction: {
        probability: directionProbability,
        baseRate: directionFit?.baseRate ?? null,
        edge:
          directionProbability === null || !directionFit
            ? null
            : (directionProbability - directionFit.baseRate) * 100,
      },
      continuation: {
        probability: continuationProbability,
        baseRate: continuationFit?.baseRate ?? null,
        edge:
          continuationProbability === null || !continuationFit
            ? null
            : (continuationProbability - continuationFit.baseRate) * 100,
      },
      longHorizon: {
        twentySessions: {
          horizon: 20,
          probability: direction20d?.beatsBaseline ? direction20dProbability : null,
          baseRate: direction20dFit?.baseRate ?? null,
          hasMeasuredEdge: direction20d?.beatsBaseline ?? false,
          falseDiscoveryRate: direction20d?.falseDiscoveryRate ?? null,
        },
        sixtySessions: {
          horizon: 60,
          probability: direction60d?.beatsBaseline ? direction60dProbability : null,
          baseRate: direction60dFit?.baseRate ?? null,
          hasMeasuredEdge: direction60d?.beatsBaseline ?? false,
          falseDiscoveryRate: direction60d?.falseDiscoveryRate ?? null,
        },
        caveat:
          "A bullish or bearish outlook is shown only after its own horizon beats the unconditional base rate out of sample and survives the multiple-testing correction. An unavailable probability means the model has not earned a directional claim, not that the market is bearish.",
      },
      // How the next session behaves, as opposed to which way it goes. This is
      // the part that survives testing: direction has no measured edge at this
      // horizon and is reported as such, while both of these beat their
      // baseline after correcting for multiple testing. Every input is known at
      // the prior close, so the read is available before the opening bell.
      sessionCharacter: {
        wideRange: {
          probability: wideRangeProbability,
          baseRate: wideRangeFit?.baseRate ?? null,
          hasMeasuredEdge: wideRangeDay?.beatsBaseline ?? false,
          falseDiscoveryRate: wideRangeDay?.falseDiscoveryRate ?? null,
          question: "Will the next session's move exceed 1.5x its recent average?",
        },
        volatilityExpansion: {
          probability: volatilityExpansionProbability,
          baseRate: volatilityExpansionFit?.baseRate ?? null,
          hasMeasuredEdge: volatilityExpansion?.beatsBaseline ?? false,
          falseDiscoveryRate: volatilityExpansion?.falseDiscoveryRate ?? null,
          question: "Will realized volatility over the next five sessions exceed the last twenty?",
        },
        caveat:
          "Range and volatility, not direction. Both targets beat their base rate on a " +
          "walk-forward test after a Benjamini-Hochberg correction; the daily direction " +
          "model did not, and is reported separately as having no measured edge. A wide " +
          "session can go either way.",
      },
      expectedMove,
      typicalMove: mean(rows.slice(-252).map((row) => Math.abs(row.currentReturn))),
      range,
      dollarRange,
      moveMap,
      recommendedExposure: {
        positionPct,
        cashPct,
        exposureLabel,
        basis: exposureBasis,
        hasMeasuredEdge: directionHasSkill,
        volatilityScale: Number(liveVol.toFixed(4)),
      },
      sessionContext,
    },
    evaluation: {
      direction,
      direction5d,
      direction20d,
      direction60d,
      continuation,
      volatilityExpansion,
      wideRangeDay,
      rallySpike5d,
      downsideTail,
      drawdown5d,
      volatility,
      economicStrategy,
      states: conditionalStates(rows),
      window: WALK_FORWARD,
      featureCount: FEATURE_NAMES.length,
      sessions: rows.length,
      trainingStart: rows[0].date,
    },
    positioning: (() => {
      const coverage = loadEngineFeatureCoverage();
      const intraday = loadIntradayCoverage();
      const intradayPrimary = intraday.find((entry) => entry.symbol === "NDX") ?? intraday[0] ?? null;
      const effectiveObservations = intradayPrimary
        ? Math.round(intradayPrimary.observations / INTRADAY_CLUSTER_SIZE)
        : 0;
      const observationsPerSession =
        intradayPrimary && intradayPrimary.sessions
          ? intradayPrimary.observations / intradayPrimary.sessions
          : 0;
      const primary = coverage.find((entry) => entry.symbol === "NDX") ?? coverage[0] ?? null;
      const latest = primary ? loadEngineFeatures(primary.symbol, 60) : [];
      const latestDate = latest[0]?.date ?? null;
      const readings = latest
        .filter((row) => row.date === latestDate)
        .map((row) => ({ feature: row.feature, value: row.value }))
        .sort((left, right) => left.feature.localeCompare(right.feature));
      return {
        // The model needs enough sessions for a walk-forward fold before these
        // can be used at all; until then the recorder simply accumulates.
        required: MINIMUM_POSITIONING_SESSIONS,
        intraday: {
          coverage: intraday,
          symbol: intradayPrimary?.symbol ?? null,
          observations: intradayPrimary?.observations ?? 0,
          sessions: intradayPrimary?.sessions ?? 0,
          observationsPerSession: Number(observationsPerSession.toFixed(1)),
          clusterSize: INTRADAY_CLUSTER_SIZE,
          effectiveObservations,
          firstDate: intradayPrimary?.firstDate ?? null,
          lastDate: intradayPrimary?.lastDate ?? null,
          // Sessions still needed at the rate observations are actually
          // arriving, rather than at one per day.
          // Extrapolating from a session that recorded one or two snapshots
          // would produce a meaningless number, so no estimate is offered
          // until a session has been sampled at something like the intended
          // rate.
          sessionsRemaining:
            observationsPerSession >= 6
              ? Math.max(
                  0,
                  Math.ceil(
                    ((MINIMUM_POSITIONING_SESSIONS - effectiveObservations) * INTRADAY_CLUSTER_SIZE) /
                      observationsPerSession,
                  ),
                )
              : null,
          reason:
            "The option chain already refreshes every quarter hour and each snapshot carries its own source time, so intraday rows accumulate at the rate the data arrives. Bars inside one session are correlated, so the effective count divides the raw one by an assumed cluster size — the progress shown is deliberately the conservative reading.",
        },
        coverage,
        sessions: primary?.sessions ?? 0,
        symbol: primary?.symbol ?? null,
        firstDate: primary?.firstDate ?? null,
        lastDate: primary?.lastDate ?? null,
        latestReadings: readings,
        status: !primary && !intradayPrimary
          ? "waiting"
          : Math.max(primary?.sessions ?? 0, effectiveObservations) >= MINIMUM_POSITIONING_SESSIONS
            ? "ready"
            : "collecting",
        reason:
          "Dealer positioning cannot be backfilled: no public archive carries a past option chain, so the only way to have history is to have recorded it. One row is written per settled session from the option workspace's own snapshot, and these features enter the model once enough sessions exist to fit and score a fold honestly.",
      };
    })(),
    live: {
      records: liveRecords.slice(0, 30),
      settled: settled.length,
      accuracy: settled.length
        ? (settled.filter((record) => record.correct).length / settled.length) * 100
        : null,
      reason:
        "Every forecast is written to the database before the session it describes and scored afterwards from the same price series. A short record proves nothing yet; it is shown so the model cannot be quietly re-tuned after a bad run.",
    },
    method:
      `Regularized logistic regression on ${FEATURE_NAMES.length} market, rates, credit, and volatility features for the binary questions, and a walk-forward augmented HAR model of log absolute return for the size of the move. The size model uses close-return persistence, Yahoo OHLC true range, Wilder ATR(14)/ATR(50) expansion, implied-volatility level, and VIX/VXV term structure. Missing observations withhold a row rather than becoming a zero-change signal. All scores come from walk-forward evaluation: fit on the past, predict the block that follows, never look back, with an embargo between the two.`,
    caveat:
      "Daily index direction is close to unpredictable. The honest comparison is against the base rate — the frequency of up days — not against a coin flip, and a model that fails to beat it is reported as failing.",
  };
}

async function attachFreshOvernight<T extends {
  asOf: string;
  nextSession: string;
  forecast: { sessionContext: SessionContext };
}>(payload: T) {
  const overnight = await loadYahooOvernightContext({
    sessionDate: payload.nextSession,
    priorSessionDate: payload.asOf,
    staleWhileRevalidate: true,
  });
  return {
    ...payload,
    forecast: {
      ...payload.forecast,
      sessionContext: { ...payload.forecast.sessionContext, overnight },
    },
  };
}

async function refreshEngineOutput() {
  const payload = await buildPayload();
  putSnapshot({
    namespace: "engine-output",
    key: MODEL_VERSION,
    payload,
    sourceTime: payload.asOf,
    fetchedAt: payload.fetchedAt,
    refreshAfter: new Date(Date.now() + CACHE_MS).toISOString(),
    methodologyVersion: MODEL_VERSION,
  });
  return payload;
}

export async function GET() {
  const stored = getSnapshot<Awaited<ReturnType<typeof buildPayload>>>("engine-output", MODEL_VERSION);
  try {
    if (stored && snapshotIsFresh(stored)) {
      return NextResponse.json(await attachFreshOvernight(stored.payload));
    }
    if (stored) {
      // Started after this response has been handed back, not before it.
      // Calling it here ran the rebuild's first model fit during the await
      // below, so the request that exists precisely to answer immediately from
      // cache took 2.7 seconds to do it.
      setImmediate(() => {
        void dedupeRequest(`engine-output:${MODEL_VERSION}`, refreshEngineOutput).catch(() => undefined);
      });
      return NextResponse.json({
        ...(await attachFreshOvernight(stored.payload)),
        stale: true,
        staleReason: "Refreshing the saved model output in the background.",
      });
    }
    return NextResponse.json(await refreshEngineOutput());
  } catch (error) {
    if (stored) {
      return NextResponse.json({
        ...stored.payload,
        stale: true,
        staleReason: error instanceof Error ? error.message : "Refresh failed.",
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build the forecast." },
      { status: 502 },
    );
  }
}
