export type ExposureMagnitude = {
  /** Largest absolute strike-level exposure in the measured scope. */
  peak: number;
  /** Sum of absolute strike-level exposure in the measured scope. */
  gross: number;
  /** Signed sum of strike-level exposure in the measured scope. */
  net: number;
  /** Net divided by gross, useful for polarity without becoming a signal. */
  balance: number | null;
};

function numericValue(row: object, metric: string) {
  const value = Number((row as Record<string, unknown>)[metric]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Summarize absolute exposure without changing the normalized profile used for
 * shape comparison. The scope is supplied by the caller so the readout can
 * match the chart's visible window rather than quietly mixing in tail strikes.
 */
export function summarizeExposure<T extends object>(
  rows: readonly T[],
  metric: string,
): ExposureMagnitude {
  let peak = 0;
  let gross = 0;
  let net = 0;

  for (const row of rows) {
    const value = numericValue(row, metric);
    if (value === null) continue;
    const magnitude = Math.abs(value);
    peak = Math.max(peak, magnitude);
    gross += magnitude;
    net += value;
  }

  return {
    peak,
    gross,
    net,
    balance: gross > 0 ? net / gross : null,
  };
}

export function summarizeExposureMetrics<T extends object>(
  rows: readonly T[],
  metrics: readonly string[],
) {
  return Object.fromEntries(metrics.map((metric) => [metric, summarizeExposure(rows, metric)]));
}
