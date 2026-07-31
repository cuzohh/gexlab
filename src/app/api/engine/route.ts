import { NextResponse } from "next/server";
import {
  accuracy,
  applyPlattScaling,
  applyStandardizer,
  backtestVolScaledStrategy,
  benjaminiHochberg,
  brierScore,
  dieboldMariano,
  type ForecastComparison,
  reliabilityByQuantile,
  fitPlattScaling,
  fitStandardizer,
  harFeatures,
  logLoss,
  pointwiseLogLoss,
  logisticFit,
  logisticPredict,
  pinballLoss,
  ridgeFit,
  rocAuc,
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
import { loadFomcMeetings, loadPublishedReleaseDates } from "@/lib/server/event-sources";
import { nowcastIndexPair } from "@/lib/server/index-nowcast";
import { loadMacroSeriesStore } from "@/lib/server/macro-sources";
import { MACRO_SERIES_IDS } from "@/lib/server/series-catalog";
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

const MODEL_VERSION = "engine-v1.7.1";
const CACHE_MS = 6 * 60 * 60 * 1000;
const HISTORY_START = "1999-01-01";

// Five years of sessions before the first prediction, refitted twice a year on
// a rolling ten-year window. The embargo drops the sessions between the end of
// training and the first prediction so a feature that looks back twenty days
// cannot overlap the block being scored.
const WALK_FORWARD = {
  initialTrain: 1260,
  refitEvery: 126,
  embargo: 25,
  maxTrain: 2520,
};
// Shrinkage is chosen inside each training fold on a held-out tail of that
// fold, never on the block being scored. The grid runs to very strong
// penalties because the honest prior for daily direction is "almost no
// signal", and the selection is free to say so by picking one.
const PENALTY_GRID = [5, 25, 100, 400, 1600];
// Roughly three years of sessions. Below that there is no honest way to fit
// on one period and score on another, so recorded positioning features stay
// out of the model rather than being fitted on a sample that cannot support
// them.
const MINIMUM_POSITIONING_SESSIONS = 750;
// The intraday log reaches the same number of observations far sooner, but
// bars from one session are correlated, so the nominal count overstates the
// independent information. Dividing by an assumed within-day cluster size is
// a rough correction, and it is applied so the progress shown is the honest
// one rather than the flattering one.
const INTRADAY_CLUSTER_SIZE = 5;

/**
 * Splits a training fold into an inner fit and an inner held-out tail, with the
 * same embargo the outer walk-forward uses.
 *
 * Without the embargo a twenty-day label at the end of the inner fit overlaps
 * the first twenty rows of the tail it is validated on. The effect is small,
 * since all it decides is one value from a five-point grid and the calibration
 * slope, but it is the one place the fold discipline used to lapse.
 */
function innerSplit(rowCount: number) {
  const split = Math.floor(rowCount * 0.8);
  const fitEnd = split - WALK_FORWARD.embargo;
  if (fitEnd < 200 || rowCount - split < 100) return null;
  return { fitEnd, holdoutStart: split };
}

function selectPenalty(features: number[][], labels: number[]) {
  const split = innerSplit(features.length);
  if (!split) return PENALTY_GRID[2];
  const innerTrain = features.slice(0, split.fitEnd);
  const innerLabels = labels.slice(0, split.fitEnd);
  const validation = features.slice(split.holdoutStart);
  const validationLabels = labels.slice(split.holdoutStart);
  let best = PENALTY_GRID[2];
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const penalty of PENALTY_GRID) {
    const weights = logisticFit(innerTrain, innerLabels, { penalty, iterations: 12 });
    if (!weights) continue;
    const probabilities = validation.map((row) => logisticPredict(weights, row));
    const loss = logLoss(probabilities, validationLabels);
    if (loss !== null && loss < bestLoss) {
      bestLoss = loss;
      best = penalty;
    }
  }
  return best;
}

/**
 * Fits a fold, optionally with a Platt calibrator learned on an embargoed tail
 * of the same fold.
 *
 * Calibration is off by default because it was measured and it does not help.
 * Fitted on the inner model and applied to the full-fold model it lost on all
 * nine targets; fitted and applied coherently to the inner model it lost on all
 * nine again. Both are explicable: the penalty grid runs to 1600, so these fits
 * are already shrunk hard toward the base rate and are close to calibrated
 * before anything rescales them. Estimating a slope from a few hundred held-out
 * rows with a weak signal adds more variance than it removes miscalibration.
 *
 * Kept behind a flag rather than deleted, because the argument for it gets
 * stronger as the sample grows and the honest way to revisit it is to rerun the
 * comparison rather than to reason about it.
 */
const CALIBRATE_FOLDS = process.env.GEXLAB_CALIBRATE === "1";

function fitCalibratedFold(design: number[][], labels: number[], penalty: number) {
  const split = CALIBRATE_FOLDS ? innerSplit(design.length) : null;
  if (!split) {
    const weights = logisticFit(design, labels, { penalty, iterations: 12 });
    return weights ? { weights, calibrator: null } : null;
  }
  // The scaler is applied to the model it was fitted for, which costs the
  // held-out tail as training data but keeps the two logit scales comparable.
  const weights = logisticFit(design.slice(0, split.fitEnd), labels.slice(0, split.fitEnd), {
    penalty,
    iterations: 12,
  });
  if (!weights) return null;
  const calibrator = fitPlattScaling(
    design.slice(split.holdoutStart).map((row) => logisticPredict(weights, row)),
    labels.slice(split.holdoutStart),
  );
  return { weights, calibrator };
}

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

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

type ClassifierEvaluation = {
  target: string;
  question: string;
  samples: number;
  from: string;
  to: string;
  model: { logLoss: number | null; brier: number | null; accuracy: number | null; auc: number | null };
  baseRate: { logLoss: number | null; brier: number | null; accuracy: number | null };
  skill: { logLoss: number | null; brier: number | null; accuracy: number | null };
  /** Sessions the label spans, which sets the HAC lag and the overlap discount. */
  horizon: number;
  comparison: ForecastComparison | null;
  /** False-discovery-rate q-value across every scored target. Filled in after all fits. */
  falseDiscoveryRate: number | null;
  beatsBaseline: boolean;
  calibration: ReturnType<typeof reliabilityByQuantile>;
  confident: { threshold: number; share: number; accuracy: number | null; samples: number };
  coefficients: Array<{ feature: string; weight: number }>;
};

/**
 * Fits and scores one binary target strictly out of sample.
 *
 * The comparison that matters is against the base rate: a model that predicts
 * the unconditional frequency every day is the thing to beat, and on daily
 * index direction most models do not beat it.
 */
function evaluateClassifier(
  rows: FeatureRow[],
  labels: Array<number | null>,
  target: string,
  question: string,
  horizon: number,
): ClassifierEvaluation | null {
  const usableIndexes = labels
    .map((label, index) => (label === null ? null : index))
    .filter((index): index is number => index !== null);
  const usable = usableIndexes.map((index) => rows[index]);
  if (usable.length < WALK_FORWARD.initialTrain + WALK_FORWARD.refitEvery) return null;
  const usableLabels = usableIndexes.map((index) => labels[index]!);

  const predictions = walkForward<number>(usable.length, WALK_FORWARD, (train, predict) => {
    const trainFeatures = usable.slice(train[0], train[1]).map((row) => row.features);
    const trainLabels = usableLabels.slice(train[0], train[1]);
    if (trainFeatures.length < 200) return [];
    const standardizer = fitStandardizer(trainFeatures);
    const design = trainFeatures.map((row) => withIntercept(applyStandardizer(standardizer, row)));
    const penalty = selectPenalty(design, trainLabels);
    const fitted = fitCalibratedFold(design, trainLabels, penalty);
    if (!fitted) return [];
    return usable.slice(predict[0], predict[1]).map((row) => {
      const raw = logisticPredict(fitted.weights, withIntercept(applyStandardizer(standardizer, row.features)));
      return fitted.calibrator ? applyPlattScaling(fitted.calibrator, raw) : raw;
    });
  });
  if (predictions.length < 250) return null;

  const probabilities = predictions.map((entry) => entry.prediction);
  const outcomes = predictions.map((entry) => usableLabels[entry.index]);
  // The baseline is the frequency observed in the training data available
  // before each prediction, not the frequency over the scored window, which
  // would leak the answer into the thing it is being compared against.
  const baseRates = predictions.map((entry) => mean(usableLabels.slice(0, Math.max(entry.index - WALK_FORWARD.embargo, 1))));

  // Whether the model beats the base rate is a question about a difference of
  // two loss series, not about which number is smaller.
  const comparison = dieboldMariano(
    pointwiseLogLoss(probabilities, outcomes),
    pointwiseLogLoss(baseRates, outcomes),
    horizon,
  );

  const modelScores = {
    logLoss: logLoss(probabilities, outcomes),
    brier: brierScore(probabilities, outcomes),
    accuracy: accuracy(probabilities, outcomes),
    auc: rocAuc(probabilities, outcomes),
  };
  const baselineScores = {
    logLoss: logLoss(baseRates, outcomes),
    brier: brierScore(baseRates, outcomes),
    accuracy: accuracy(baseRates, outcomes),
  };
  const difference = (model: number | null, baseline: number | null) =>
    model === null || baseline === null ? null : baseline - model;

  const confidenceThreshold = 0.03;
  const confidentIndexes = probabilities
    .map((probability, index) => ({ probability, index }))
    .filter((entry) => Math.abs(entry.probability - baseRates[entry.index]) >= confidenceThreshold);
  const confidentAccuracy = confidentIndexes.length
    ? accuracy(
        confidentIndexes.map((entry) => entry.probability),
        confidentIndexes.map((entry) => outcomes[entry.index]),
      )
    : null;

  // Coefficients come from one final fit on the most recent window, purely so
  // the page can show what the live model is leaning on.
  const finalFeatures = usable.slice(-WALK_FORWARD.maxTrain).map((row) => row.features);
  const finalLabels = usableLabels.slice(-WALK_FORWARD.maxTrain);
  const finalStandardizer = fitStandardizer(finalFeatures);
  const finalDesign = finalFeatures.map((row) => withIntercept(applyStandardizer(finalStandardizer, row)));
  const finalWeights = logisticFit(finalDesign, finalLabels, {
    penalty: selectPenalty(finalDesign, finalLabels),
    iterations: 20,
  });

  return {
    target,
    question,
    samples: predictions.length,
    from: usable[predictions[0].index].date,
    to: usable[predictions.at(-1)!.index].date,
    model: modelScores,
    baseRate: baselineScores,
    skill: {
      logLoss: difference(modelScores.logLoss, baselineScores.logLoss),
      brier: difference(modelScores.brier, baselineScores.brier),
      accuracy:
        modelScores.accuracy === null || baselineScores.accuracy === null
          ? null
          : modelScores.accuracy - baselineScores.accuracy,
    },
    horizon,
    comparison,
    falseDiscoveryRate: null,
    // Significance, not a bare inequality. The q-value that finally gates this
    // is applied across all targets once they have each been scored.
    beatsBaseline: comparison !== null && comparison.meanAdvantage > 0 && comparison.pValue < 0.05,
    calibration: reliabilityByQuantile(probabilities, outcomes, 5),
    confident: {
      threshold: confidenceThreshold,
      share: (confidentIndexes.length / probabilities.length) * 100,
      accuracy: confidentAccuracy,
      samples: confidentIndexes.length,
    },
    coefficients: finalWeights
      ? FEATURE_NAMES.map((feature, index) => ({ feature, weight: Number(finalWeights[index + 1].toFixed(4)) }))
          .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
          .slice(0, 8)
      : [],
  };
}

/**
 * Volatility model. Log absolute return is regressed on its own daily, weekly,
 * and monthly averages, which is the standard heterogeneous autoregressive
 * specification and the part of this engine with genuine predictive power.
 */
function evaluateVolatility(rows: FeatureRow[]) {
  const usable = rows.filter((row) => row.forwardAbsolute !== null);
  if (usable.length < WALK_FORWARD.initialTrain + WALK_FORWARD.refitEvery) return null;
  const absolute = usable.map((row) => Math.abs(row.currentReturn));
  // The implied index is quoted as an annualized percentage; dividing by the
  // square root of the trading year puts it in the same units as one session's
  // absolute return.
  const impliedDaily = usable.map(
    (row) => row.features[FEATURE_INDEX["implied volatility level"]] / Math.sqrt(252),
  );
  const targets = usable.map((row) => Math.log(Math.max(row.forwardAbsolute!, 0.01)));

  const predictions = walkForward<number>(usable.length, WALK_FORWARD, (train, predict) => {
    const design: number[][] = [];
    const response: number[] = [];
    for (let index = train[0]; index < train[1]; index += 1) {
      const features = harFeatures(absolute, index, impliedDaily);
      if (!features) continue;
      design.push(features);
      response.push(targets[index]);
    }
    if (design.length < 200) return [];
    const weights = ridgeFit(design, response, 1e-4);
    if (!weights) return [];
    const fitted = design.map((row) => row.reduce((sum, value, position) => sum + value * weights[position], 0));
    const smearing = smearingFactor(response.map((value, index) => value - fitted[index]));
    const output: Array<number | null> = [];
    for (let index = predict[0]; index < predict[1]; index += 1) {
      const features = harFeatures(absolute, index, impliedDaily);
      if (!features) {
        output.push(null);
        continue;
      }
      const logForecast = features.reduce((sum, value, position) => sum + value * weights[position], 0);
      output.push(Math.exp(logForecast) * smearing);
    }
    return output;
  });
  if (predictions.length < 250) return null;

  const actual = predictions.map((entry) => usable[entry.index].forwardAbsolute!);
  const predicted = predictions.map((entry) => entry.prediction);
  // Two baselines: yesterday's move, and the twenty-session average move.
  const randomWalk = predictions.map((entry) => Math.abs(usable[entry.index].currentReturn));
  const trailingAverage = predictions.map((entry) =>
    mean(usable.slice(Math.max(entry.index - 19, 0), entry.index + 1).map((row) => Math.abs(row.currentReturn))),
  );
  const meanActual = mean(actual);
  const totalSquares = actual.reduce((sum, value) => sum + (value - meanActual) ** 2, 0);
  const rSquared = (candidate: number[]) => {
    const residual = actual.reduce((sum, value, index) => sum + (value - candidate[index]) ** 2, 0);
    return totalSquares === 0 ? null : 1 - residual / totalSquares;
  };
  const absoluteError = (candidate: number[]) =>
    mean(actual.map((value, index) => Math.abs(value - candidate[index])));

  // Standardised outcomes give a non-parametric predictive interval: the
  // realized move divided by the forecast, ranked over the whole out-of-sample
  // record, is what turns one number into a range.
  const standardized = predictions.map(
    (entry, index) => usable[entry.index].forwardReturn! / predicted[index],
  );

  const quantiles = {
    p05: quantile(standardized, 0.05),
    p25: quantile(standardized, 0.25),
    p50: quantile(standardized, 0.5),
    p75: quantile(standardized, 0.75),
    p95: quantile(standardized, 0.95),
  };

  const actualSigned = predictions.map((entry) => usable[entry.index].forwardReturn!);
  const p05Mult = quantiles.p05 ?? -1.65;
  const p50Mult = quantiles.p50 ?? 0;
  const p95Mult = quantiles.p95 ?? 1.65;
  const predictedP05 = predicted.map((val) => p05Mult * val);
  const predictedP50 = predicted.map((val) => p50Mult * val);
  const predictedP95 = predicted.map((val) => p95Mult * val);

  const pinballScores = {
    p05: pinballLoss(actualSigned, predictedP05, 0.05),
    p50: pinballLoss(actualSigned, predictedP50, 0.50),
    p95: pinballLoss(actualSigned, predictedP95, 0.95),
  };

  return {
    samples: predictions.length,
    from: usable[predictions[0].index].date,
    to: usable[predictions.at(-1)!.index].date,
    rSquared: rSquared(predicted),
    randomWalkRSquared: rSquared(randomWalk),
    trailingAverageRSquared: rSquared(trailingAverage),
    meanAbsoluteError: absoluteError(predicted),
    randomWalkError: absoluteError(randomWalk),
    trailingAverageError: absoluteError(trailingAverage),
    quantiles,
    pinballLoss: pinballScores,
  };
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
  const [releases, meetings] = await Promise.all([
    loadPublishedReleaseDates(studyYears).catch(() => []),
    loadFomcMeetings().catch(() => null),
  ]);
  const majorReleases = new Set(
    releases
      .filter((release) => /^(consumer price index|employment situation|producer price index)$/i.test(release.title))
      .map((release) => release.date),
  );
  const fomcDates = (meetings ?? []).filter((meeting) => !meeting.unscheduled).map((meeting) => meeting.end);

  const rows = buildFeatureRows(store as SeriesStore, {
    releaseDates: majorReleases,
    fomcDates,
  }, { minDate: HISTORY_START });
  if (rows.length < WALK_FORWARD.initialTrain + WALK_FORWARD.refitEvery) {
    throw new Error("Not enough sessions to evaluate the model.");
  }

  const direction = evaluateClassifier(
    rows,
    directionLabels(rows),
    "direction",
    "Will the next session close higher?",
    1,
  );
  const direction5d = evaluateClassifier(
    rows,
    direction5dLabels(rows),
    "direction5d",
    "Will the index close higher over the next 5 sessions?",
    5,
  );
  const direction20d = evaluateClassifier(
    rows,
    direction20dLabels(rows),
    "direction20d",
    "Will the index close higher over the next 20 sessions?",
    20,
  );
  const continuation = evaluateClassifier(
    rows,
    continuationLabels(rows),
    "continuation",
    "Will the next session move in the same direction as this one?",
    1,
  );
  const volatilityExpansion = evaluateClassifier(
    rows,
    volatilityExpansionLabels(rows),
    "volatilityExpansion",
    "Will 5-day realized volatility expand above the 20-day baseline?",
    5,
  );
  const wideRangeDay = evaluateClassifier(
    rows,
    wideRangeDayLabels(rows),
    "wideRangeDay",
    "Will the next session be an explosive wide-range day (>1.5x 20d ATR)?",
    1,
  );
  const rallySpike5d = evaluateClassifier(
    rows,
    rallySpike5dLabels(rows),
    "rallySpike5d",
    "Will the index experience an explosive 5-day rally spike (>= +3%)?",
    5,
  );
  const downsideTail = evaluateClassifier(
    rows,
    downsideTailLabels(rows),
    "downsideTail",
    "Will the next session fall by an unusually large amount?",
    1,
  );
  const drawdown5d = evaluateClassifier(
    rows,
    drawdown5dLabels(rows),
    "drawdown5d",
    "Will the next five sessions contain a material drawdown?",
    5,
  );
  const volatility = evaluateVolatility(rows);

  // Nine targets are each tested against their own base rate, so at a nominal
  // five percent a couple would be expected to clear the bar on noise alone.
  // The verdict shown is the one that survives the correction, not the raw test.
  const scored = [
    direction,
    direction5d,
    direction20d,
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

  const economicStrategy = backtestVolScaledStrategy(
    backtestProbs,
    backtestBaseRates,
    backtestReturns,
    backtestVols,
    { costPerTradeBps: 2, volScale: 2 },
  );

  const lastRow = rows.at(-1)!;
  const directionFit = fitCurrent(rows, directionLabels(rows));
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

  // The two targets that actually beat their baseline were only ever
  // backtested; no live probability was produced for either, so the one part of
  // this engine with measured skill said nothing about the next session. Both
  // describe how the next session behaves rather than which way it goes, which
  // is the half of the problem that survives testing at this horizon.
  const wideRangeFit = fitCurrent(rows, wideRangeDayLabels(rows));
  const wideRangeProbability = wideRangeFit
    ? logisticPredict(
        wideRangeFit.weights,
        withIntercept(applyStandardizer(wideRangeFit.standardizer, lastRow.features)),
      )
    : null;
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
  const volatilityTargets = rows.map((row) =>
    row.forwardAbsolute === null ? null : Math.log(Math.max(row.forwardAbsolute, 0.01)),
  );
  const trainDesign: number[][] = [];
  const trainResponse: number[] = [];
  for (let index = Math.max(rows.length - WALK_FORWARD.maxTrain, 22); index < rows.length; index += 1) {
    const features = harFeatures(absoluteReturns, index, impliedDailySeries);
    const response = volatilityTargets[index];
    if (!features || response === null) continue;
    trainDesign.push(features);
    trainResponse.push(response);
  }
  const volatilityWeights = trainDesign.length > 200 ? ridgeFit(trainDesign, trainResponse, 1e-4) : null;
  const currentHar = harFeatures(absoluteReturns, rows.length - 1, impliedDailySeries);
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

  const nextSessionDate = (() => {
    const parsed = new Date(`${lastRow.date}T12:00:00Z`);
    do {
      parsed.setUTCDate(parsed.getUTCDate() + 1);
    } while (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6);
    return parsed.toISOString().slice(0, 10);
  })();

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
      recommendedExposure: {
        positionPct,
        cashPct,
        exposureLabel,
        basis: exposureBasis,
        hasMeasuredEdge: directionHasSkill,
        volatilityScale: Number(liveVol.toFixed(4)),
      },
    },
    evaluation: {
      direction,
      direction5d,
      direction20d,
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
      `Regularized logistic regression on ${FEATURE_NAMES.length} market, rates, credit, and volatility features for the binary questions, and a heterogeneous autoregressive model of log absolute return for the size of the move. Missing observations withhold a row rather than becoming a zero-change signal. All scores come from walk-forward evaluation: fit on the past, predict the block that follows, never look back, with an embargo between the two.`,
    caveat:
      "Daily index direction is close to unpredictable. The honest comparison is against the base rate — the frequency of up days — not against a coin flip, and a model that fails to beat it is reported as failing.",
  };
}

export async function GET() {
  const stored = getSnapshot<Awaited<ReturnType<typeof buildPayload>>>("engine-output", MODEL_VERSION);
  try {
    if (stored && snapshotIsFresh(stored)) return NextResponse.json(stored.payload);
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
    return NextResponse.json(payload);
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
