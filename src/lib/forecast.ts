/**
 * Model fitting and honest scoring for the next-session forecast.
 *
 * Everything here is deliberately small and closed-form. With roughly two
 * hundred and fifty observations a year there is no sample to support a large
 * model, and a regularized linear fit that can be inspected, tested, and
 * exported as a handful of coefficients is easier to trust than a black box
 * that would overfit the same data.
 */

export type Matrix = number[][];

/** Solves a symmetric positive-definite system by Gaussian elimination. */
export function solveSymmetric(matrix: Matrix, vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][column]) < 1e-12) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / pivot;
      if (factor === 0) continue;
      for (let target = column; target <= size; target += 1) {
        augmented[row][target] -= factor * augmented[column][target];
      }
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let total = augmented[row][size];
    for (let column = row + 1; column < size; column += 1) {
      total -= augmented[row][column] * solution[column];
    }
    solution[row] = total / augmented[row][row];
  }
  return solution.every((value) => Number.isFinite(value)) ? solution : null;
}

/**
 * Ridge regression. The intercept is expected as an explicit leading column of
 * ones and is left unpenalized, so shrinking the coefficients never drags the
 * fitted level away from the mean of the target.
 */
export function ridgeFit(features: Matrix, target: number[], penalty = 1e-4): number[] | null {
  const rows = features.length;
  if (!rows || !features[0]?.length || target.length !== rows) return null;
  const width = features[0].length;
  if (
    features.some(
      (row) => row.length !== width || row.some((value) => !Number.isFinite(value)),
    ) ||
    target.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const normal: Matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const moment = new Array<number>(width).fill(0);
  for (let row = 0; row < rows; row += 1) {
    const observation = features[row];
    for (let left = 0; left < width; left += 1) {
      moment[left] += observation[left] * target[row];
      for (let right = left; right < width; right += 1) {
        normal[left][right] += observation[left] * observation[right];
      }
    }
  }
  for (let left = 0; left < width; left += 1) {
    for (let right = 0; right < left; right += 1) normal[left][right] = normal[right][left];
    if (left > 0) normal[left][left] += penalty * rows;
  }
  return solveSymmetric(normal, moment);
}

export function sigmoid(value: number) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

/**
 * Logistic regression by iteratively reweighted least squares with an L2
 * penalty. Newton steps converge in a handful of passes, which matters because
 * the walk-forward evaluation refits the model dozens of times.
 */
export function logisticFit(
  features: Matrix,
  labels: number[],
  options: { penalty?: number; iterations?: number; tolerance?: number } = {},
): number[] | null {
  const penalty = options.penalty ?? 1;
  const iterations = options.iterations ?? 25;
  const tolerance = options.tolerance ?? 1e-7;
  const rows = features.length;
  if (rows < 2) return null;
  const width = features[0].length;
  const weights = new Array<number>(width).fill(0);

  for (let pass = 0; pass < iterations; pass += 1) {
    const hessian: Matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
    const gradient = new Array<number>(width).fill(0);
    for (let row = 0; row < rows; row += 1) {
      const observation = features[row];
      let score = 0;
      for (let index = 0; index < width; index += 1) score += observation[index] * weights[index];
      const probability = sigmoid(score);
      // A floor on the curvature keeps a fully separated batch from producing
      // an unusable Hessian and weights that run off to infinity.
      const curvature = Math.max(probability * (1 - probability), 1e-6);
      const residual = labels[row] - probability;
      for (let left = 0; left < width; left += 1) {
        gradient[left] += observation[left] * residual;
        for (let right = left; right < width; right += 1) {
          hessian[left][right] += curvature * observation[left] * observation[right];
        }
      }
    }
    for (let left = 0; left < width; left += 1) {
      for (let right = 0; right < left; right += 1) hessian[left][right] = hessian[right][left];
      // The intercept sits in column zero and stays unpenalized so the model
      // can still express the unconditional base rate.
      if (left > 0) {
        hessian[left][left] += penalty;
        gradient[left] -= penalty * weights[left];
      }
    }
    const step = solveSymmetric(hessian, gradient);
    if (!step) return null;
    let movement = 0;
    for (let index = 0; index < width; index += 1) {
      weights[index] += step[index];
      movement += Math.abs(step[index]);
    }
    if (!weights.every((value) => Number.isFinite(value))) return null;
    if (movement < tolerance) break;
  }
  return weights;
}

export function logisticPredict(weights: number[], observation: number[]) {
  let score = 0;
  for (let index = 0; index < weights.length; index += 1) score += weights[index] * observation[index];
  return sigmoid(score);
}

export type Standardizer = { mean: number[]; deviation: number[] };

/**
 * Centres and scales the feature columns using only the rows it is given, so a
 * walk-forward fold never learns the scale of data that comes after it.
 */
export function fitStandardizer(features: Matrix): Standardizer {
  const width = features[0]?.length ?? 0;
  const mean = new Array<number>(width).fill(0);
  const deviation = new Array<number>(width).fill(1);
  if (!features.length) return { mean, deviation };
  for (const row of features) {
    for (let index = 0; index < width; index += 1) mean[index] += row[index] / features.length;
  }
  for (let index = 0; index < width; index += 1) {
    let variance = 0;
    for (const row of features) variance += (row[index] - mean[index]) ** 2;
    variance /= Math.max(features.length - 1, 1);
    const spread = Math.sqrt(variance);
    deviation[index] = spread > 1e-9 ? spread : 1;
  }
  return { mean, deviation };
}

export function applyStandardizer(standardizer: Standardizer, observation: number[]) {
  return observation.map(
    (value, index) => (value - standardizer.mean[index]) / standardizer.deviation[index],
  );
}

export function withIntercept(observation: number[]) {
  return [1, ...observation];
}

export function logLoss(probabilities: number[], labels: number[]) {
  if (!probabilities.length) return null;
  let total = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    const clipped = Math.min(Math.max(probabilities[index], 1e-9), 1 - 1e-9);
    total += labels[index] * Math.log(clipped) + (1 - labels[index]) * Math.log(1 - clipped);
  }
  return -total / probabilities.length;
}

export function brierScore(probabilities: number[], labels: number[]) {
  if (!probabilities.length) return null;
  let total = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    total += (probabilities[index] - labels[index]) ** 2;
  }
  return total / probabilities.length;
}

export function accuracy(probabilities: number[], labels: number[], threshold = 0.5) {
  if (!probabilities.length) return null;
  let correct = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    if ((probabilities[index] >= threshold ? 1 : 0) === labels[index]) correct += 1;
  }
  return correct / probabilities.length;
}

/**
 * Area under the ROC curve, computed from rank sums so ties are handled
 * without sweeping thresholds. Below 0.5 means the model is worse than random.
 */
export function rocAuc(probabilities: number[], labels: number[]) {
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  if (!positives || !negatives) return null;
  const order = probabilities
    .map((probability, index) => ({ probability, label: labels[index] }))
    .sort((left, right) => left.probability - right.probability);
  let rank = 1;
  let positiveRankSum = 0;
  let index = 0;
  while (index < order.length) {
    let last = index;
    while (last + 1 < order.length && order[last + 1].probability === order[index].probability) last += 1;
    const averageRank = (rank + (rank + (last - index))) / 2;
    for (let inner = index; inner <= last; inner += 1) {
      if (order[inner].label === 1) positiveRankSum += averageRank;
    }
    rank += last - index + 1;
    index = last + 1;
  }
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export type CalibrationBin = {
  lower: number;
  upper: number;
  count: number;
  predicted: number | null;
  observed: number | null;
};

/**
 * Reliability by quantile of the forecast.
 *
 * Fixed-width buckets are useless for a target this weak: almost every
 * prediction lands in one bucket around the base rate and the chart says
 * nothing. Splitting on the ranks instead puts an equal number of sessions in
 * each group and answers the question that matters — when the model leaned
 * furthest one way, did the outcome follow?
 */
export function reliabilityByQuantile(
  probabilities: number[],
  labels: number[],
  groups = 5,
): CalibrationBin[] {
  if (!probabilities.length) return [];
  const order = probabilities
    .map((probability, index) => ({ probability, label: labels[index] }))
    .sort((left, right) => left.probability - right.probability);
  const size = Math.floor(order.length / groups);
  if (size < 1) return [];
  return Array.from({ length: groups }, (_, index) => {
    const start = index * size;
    const end = index === groups - 1 ? order.length : start + size;
    const slice = order.slice(start, end);
    return {
      lower: slice[0].probability,
      upper: slice.at(-1)!.probability,
      count: slice.length,
      predicted: slice.reduce((sum, row) => sum + row.probability, 0) / slice.length,
      observed: slice.reduce((sum, row) => sum + row.label, 0) / slice.length,
    };
  });
}

export function calibrationBins(
  probabilities: number[],
  labels: number[],
  bins = 5,
): CalibrationBin[] {
  return Array.from({ length: bins }, (_, index) => {
    const lower = index / bins;
    const upper = (index + 1) / bins;
    const selected = probabilities
      .map((probability, position) => ({ probability, label: labels[position] }))
      .filter(
        (row) =>
          row.probability >= lower && (index === bins - 1 ? row.probability <= upper : row.probability < upper),
      );
    const count = selected.length;
    return {
      lower,
      upper,
      count,
      predicted: count ? selected.reduce((sum, row) => sum + row.probability, 0) / count : null,
      observed: count ? selected.reduce((sum, row) => sum + row.label, 0) / count : null,
    };
  });
}

export type WalkForwardOptions = {
  /** Rows required before the first prediction is made. */
  initialTrain: number;
  /** How many rows are predicted before the model is refitted. */
  refitEvery: number;
  /** Rows dropped between the end of training and the first prediction. */
  embargo: number;
  /** Cap on training rows, so the fit tracks the recent regime. */
  maxTrain?: number;
};

export type WalkForwardResult<T> = {
  index: number;
  prediction: T;
};

/**
 * Runs a strictly forward evaluation: fit on the past, predict the block that
 * follows, never look back. The embargo drops the rows between training and
 * prediction, which matters whenever a feature or a label spans more than one
 * session and would otherwise leak across the boundary.
 */
export function walkForward<T>(
  rowCount: number,
  options: WalkForwardOptions,
  fitAndPredict: (trainRange: [number, number], predictRange: [number, number]) => Array<T | null>,
): Array<WalkForwardResult<T>> {
  const results: Array<WalkForwardResult<T>> = [];
  const maxTrain = options.maxTrain ?? Number.POSITIVE_INFINITY;
  for (let start = options.initialTrain; start < rowCount; start += options.refitEvery) {
    const trainEnd = start - options.embargo;
    if (trainEnd <= 0) continue;
    const trainStart = Math.max(0, trainEnd - maxTrain);
    const predictEnd = Math.min(start + options.refitEvery, rowCount);
    const predictions = fitAndPredict([trainStart, trainEnd], [start, predictEnd]);
    predictions.forEach((prediction, offset) => {
      if (prediction !== null) results.push({ index: start + offset, prediction });
    });
  }
  return results;
}

/**
 * Heterogeneous autoregressive model of realized volatility.
 *
 * Volatility is persistent at several horizons at once, so the daily, weekly,
 * and monthly averages of log realized volatility each get their own
 * coefficient. It is a linear model with three predictors and it is difficult
 * to beat on daily equity data.
 */
/**
 * Duan's smearing factor for a model fitted in logs.
 *
 * Exponentiating a least-squares fit of log y returns the conditional median,
 * not the mean, and the gap is large when the residuals are wide — which they
 * always are for daily absolute returns. The mean of the exponentiated
 * residuals is the non-parametric correction, and without it the forecast is
 * biased low by a third and scores worse than a trailing average.
 */
export function smearingFactor(residuals: number[]) {
  if (!residuals.length) return 1;
  const factor = residuals.reduce((sum, value) => sum + Math.exp(value), 0) / residuals.length;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function harFeatures(
  absoluteReturns: number[],
  index: number,
  impliedDaily?: number[],
) {
  if (index < 22) return null;
  const floor = 0.01;
  const windowMean = (length: number) => {
    const slice = absoluteReturns.slice(index - length + 1, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  };
  // The average is taken before the logarithm, not after. Averaging logs
  // discounts the spikes that dominate a volatility burst, which is precisely
  // the part the forecast needs to carry.
  const daily = Math.log(Math.max(absoluteReturns[index], floor));
  const weekly = Math.log(Math.max(windowMean(5), floor));
  const monthly = Math.log(Math.max(windowMean(22), floor));
  const features = [1, daily, weekly, monthly];
  if (impliedDaily) {
    // Implied volatility is the market's own forecast for the same horizon and
    // carries information the price history does not, notably scheduled events
    // that have not happened yet.
    features.push(Math.log(Math.max(impliedDaily[index], floor)));
  }
  if (!features.every(Number.isFinite)) return null;
  return features;
}

/**
 * Pinball (quantile) loss for evaluating quantile forecasts.
 * L_tau(y, y_hat) = max(tau * (y - y_hat), (tau - 1) * (y - y_hat))
 */
export function pinballLoss(actuals: number[], predictedQuantiles: number[], tau: number): number | null {
  if (!actuals.length || actuals.length !== predictedQuantiles.length) return null;
  let total = 0;
  for (let index = 0; index < actuals.length; index += 1) {
    const error = actuals[index] - predictedQuantiles[index];
    total += error >= 0 ? tau * error : (tau - 1) * error;
  }
  return total / actuals.length;
}

export type BacktestResult = {
  sharpeRatio: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  totalTurnover: number;
  trades: number;
  cumulativeReturn: number;
  benchmarkReturn: number;
};

/**
 * Evaluates the economic value of converting probability signals into a vol-scaled position.
 * Deducts transaction costs per turnover (default 2 bps).
 */
export function backtestVolScaledStrategy(
  probabilities: number[],
  baseRates: number[],
  realizedReturns: number[],
  realizedVolatilities: number[],
  options: { costPerTradeBps?: number; volScale?: number } = {},
): BacktestResult {
  const costBps = (options.costPerTradeBps ?? 2) / 10000;
  const volScale = options.volScale ?? 10;
  const count = Math.min(probabilities.length, realizedReturns.length);
  if (count < 2) {
    return {
      sharpeRatio: null,
      cagr: null,
      maxDrawdown: null,
      winRate: null,
      totalTurnover: 0,
      trades: 0,
      cumulativeReturn: 0,
      benchmarkReturn: 0,
    };
  }

  let strategyValue = 1.0;
  let benchmarkValue = 1.0;
  let peakStrategy = 1.0;
  let maxDrawdown = 0;
  let prevPosition = 0;
  let winningTrades = 0;
  let totalTurnover = 0;
  let tradeCount = 0;
  const dailyStrategyReturns: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const prob = probabilities[index];
    const base = baseRates[index];
    const rawReturn = realizedReturns[index] / 100;
    const vol = Math.max(realizedVolatilities[index], 0.005);

    const rawSignal = (prob - base) / (vol * volScale);
    const position = Math.min(Math.max(rawSignal, -1), 1);

    const turnover = Math.abs(position - prevPosition);
    if (turnover > 0.01) tradeCount += 1;
    totalTurnover += turnover;
    const cost = turnover * costBps;

    const netReturn = position * rawReturn - cost;
    dailyStrategyReturns.push(netReturn);

    strategyValue *= 1 + netReturn;
    benchmarkValue *= 1 + rawReturn;

    if (netReturn > 0) winningTrades += 1;
    if (strategyValue > peakStrategy) {
      peakStrategy = strategyValue;
    }
    const drawdown = (peakStrategy - strategyValue) / peakStrategy;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    prevPosition = position;
  }

  const meanReturn = dailyStrategyReturns.reduce((sum, r) => sum + r, 0) / count;
  const varReturn =
    dailyStrategyReturns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / Math.max(count - 1, 1);
  const stdReturn = Math.sqrt(varReturn);

  const sharpeRatio = stdReturn > 1e-9 ? (meanReturn / stdReturn) * Math.sqrt(252) : null;
  const years = count / 252;
  const cagr = years > 0 && strategyValue > 0 ? (Math.pow(strategyValue, 1 / years) - 1) * 100 : null;

  return {
    sharpeRatio,
    cagr,
    maxDrawdown: maxDrawdown * 100,
    winRate: count > 0 ? (winningTrades / count) * 100 : null,
    totalTurnover: Number(totalTurnover.toFixed(2)),
    trades: tradeCount,
    cumulativeReturn: (strategyValue - 1) * 100,
    benchmarkReturn: (benchmarkValue - 1) * 100,
  };
}
