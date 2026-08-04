/**
 * Walk-forward evaluation of the forecast models.
 *
 * Lifted out of the engine route so a worker thread can load it as well as the
 * route itself. Nine classifiers and one volatility model are pure CPU over the
 * same feature rows, and run on the request thread they left the whole server
 * unresponsive for the thirteen seconds a rebuild took.
 *
 * Nothing here reads the network, the database, or the clock: given the same
 * rows and labels it returns the same numbers wherever it runs, which is what
 * makes it safe to move off the main thread.
 */
import {
  accuracy,
  applyPlattScaling,
  applyStandardizer,
  brierScore,
  dieboldMariano,
  type ForecastComparison,
  fitPlattScaling,
  fitStandardizer,
  harFeatures,
  logLoss,
  logisticFit,
  logisticPredict,
  pinballLoss,
  pointwiseLogLoss,
  reliabilityByQuantile,
  ridgeFit,
  rocAuc,
  smearingFactor,
  walkForward,
  withIntercept,
} from "../forecast.ts";
import { FEATURE_INDEX, FEATURE_NAMES, type FeatureRow } from "../engine-features.ts";
import type { DailyOhlc } from "./yahoo-daily.ts";

// Five years of sessions before the first prediction, refitted twice a year on
// a rolling ten-year window. The embargo drops the sessions between the end of
// training and the first prediction so a feature that looks back twenty days
// cannot overlap the block being scored.
export const WALK_FORWARD = {
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

export function selectPenalty(features: number[][], labels: number[]) {
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

export function fitCalibratedFold(design: number[][], labels: number[], penalty: number) {
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

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function quantile(values: number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}


export type ClassifierEvaluation = {
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
export function evaluateClassifier(
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
 * and monthly averages, then augmented with OHLC true range, Wilder ATR
 * expansion, and implied-vol term structure. The extra state is only admitted
 * through walk-forward scoring, so it can be removed if it fails to beat the
 * simpler HAR baseline.
 */
export function trueRangeByDate(bars: DailyOhlc[]) {
  const sorted = [...bars].sort((left, right) => left.date.localeCompare(right.date));
  const ranges = new Map<string, number>();
  let previousClose: number | null = null;
  for (const bar of sorted) {
    const reference = previousClose !== null && previousClose > 0 ? previousClose : bar.close;
    const range = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - reference),
      Math.abs(bar.low - reference),
    );
    if (reference > 0 && Number.isFinite(range)) ranges.set(bar.date, (range / reference) * 100);
    previousClose = bar.close;
  }
  return ranges;
}

export function wilderAtrByDate(bars: DailyOhlc[], period: number) {
  const sorted = [...bars].sort((left, right) => left.date.localeCompare(right.date));
  const atrs = new Map<string, number>();
  const trueRanges: number[] = [];
  let previousClose: number | null = null;
  let atr: number | null = null;
  for (const bar of sorted) {
    const reference = previousClose !== null && previousClose > 0 ? previousClose : bar.close;
    const trueRange = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - reference),
      Math.abs(bar.low - reference),
    );
    if (Number.isFinite(trueRange) && reference > 0) {
      trueRanges.push(trueRange / reference * 100);
      if (trueRanges.length === period) {
        atr = mean(trueRanges);
      } else if (trueRanges.length > period && atr !== null) {
        atr = ((atr * (period - 1)) + trueRanges.at(-1)!) / period;
      }
      if (atr !== null && Number.isFinite(atr)) atrs.set(bar.date, atr);
    }
    previousClose = bar.close;
  }
  return atrs;
}

export function evaluateVolatility(
  rows: FeatureRow[],
  rangeByDate?: Map<string, number>,
  atr14ByDate?: Map<string, number>,
  atr50ByDate?: Map<string, number>,
) {
  const usable = rows.filter((row) => row.forwardAbsolute !== null);
  if (usable.length < WALK_FORWARD.initialTrain + WALK_FORWARD.refitEvery) return null;
  const absolute = usable.map((row) => Math.abs(row.currentReturn));
  // The implied index is quoted as an annualized percentage; dividing by the
  // square root of the trading year puts it in the same units as one session's
  // absolute return.
  const impliedDaily = usable.map(
    (row) => row.features[FEATURE_INDEX["implied volatility level"]] / Math.sqrt(252),
  );
  const trueRange = rangeByDate && rangeByDate.size >= 400
    ? usable.map((row) => rangeByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const impliedCurve = usable.map((row) => row.features[FEATURE_INDEX["implied volatility curve"]]);
  const atr14 = atr14ByDate && atr50ByDate && atr14ByDate.size >= 400 && atr50ByDate.size >= 400
    ? usable.map((row) => atr14ByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const atr50 = atr14ByDate && atr50ByDate && atr14ByDate.size >= 400 && atr50ByDate.size >= 400
    ? usable.map((row) => atr50ByDate.get(row.date) ?? Number.NaN)
    : undefined;
  const targets = usable.map((row) => Math.log(Math.max(row.forwardAbsolute!, 0.01)));

  const predictions = walkForward<number>(usable.length, WALK_FORWARD, (train, predict) => {
    const design: number[][] = [];
    const response: number[] = [];
    for (let index = train[0]; index < train[1]; index += 1) {
      const features = harFeatures(absolute, index, impliedDaily, trueRange, impliedCurve, atr14, atr50);
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
      const features = harFeatures(absolute, index, impliedDaily, trueRange, impliedCurve, atr14, atr50);
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
