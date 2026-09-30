/**
 * Relative strength index, smoothed the way Wilder defined it.
 *
 * This is Wilder's RSI, not the equal-weighted Cutler variant. Its familiar
 * overbought/oversold scale only applies to this smoothing convention.
 */
export function relativeStrengthIndex(rows: { close: number }[], periods = 14) {
  if (rows.length < periods + 1) return null;
  const closes = rows.map((row) => row.close);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= periods; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= periods;
  loss /= periods;
  for (let index = periods + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gain = (gain * (periods - 1) + Math.max(0, change)) / periods;
    loss = (loss * (periods - 1) + Math.max(0, -change)) / periods;
  }
  // A completely flat window has neither gains nor losses. Treating its
  // zero-loss denominator as overbought is misleading; RSI is neutral until
  // there is a directional move to measure.
  if (loss === 0 && gain === 0) return 50;
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
