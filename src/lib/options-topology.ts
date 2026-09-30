export type TopologyRow = {
  strike: number;
  value: number;
};

export type TopologyReading = {
  label: "Positive cluster" | "Negative cluster" | "Bifurcated" | "Balanced" | "Flat";
  detail: string;
  positiveShare: number;
  negativeShare: number;
  signChanges: number;
};

/**
 * Reads the shape of a signed options field, not its directional meaning.
 * The output is deliberately descriptive: a positive-gamma cluster is not
 * treated as a bullish signal, and a negative field is not treated as bearish.
 */
export function readTopology(rows: TopologyRow[]): TopologyReading {
  const finite = rows.filter((row) => Number.isFinite(row.value));
  if (!finite.length) {
    return {
      label: "Flat",
      detail: "No finite exposure values are available for this field.",
      positiveShare: 0,
      negativeShare: 0,
      signChanges: 0,
    };
  }

  const positive = finite.filter((row) => row.value > 0).length;
  const negative = finite.filter((row) => row.value < 0).length;
  const positiveShare = positive / finite.length;
  const negativeShare = negative / finite.length;
  const signChanges = finite.slice(1).reduce((count, row, index) => {
    const previous = finite[index].value;
    return previous !== 0 && row.value !== 0 && Math.sign(previous) !== Math.sign(row.value)
      ? count + 1
      : count;
  }, 0);

  let label: TopologyReading["label"] = "Balanced";
  if (positive === 0 && negative === 0) label = "Flat";
  else if (signChanges >= 2 && positiveShare >= 0.2 && negativeShare >= 0.2) label = "Bifurcated";
  else if (positiveShare >= 0.65) label = "Positive cluster";
  else if (negativeShare >= 0.65) label = "Negative cluster";

  const detail =
    label === "Bifurcated"
      ? `${signChanges} sign changes split the field into alternating pockets.`
      : label === "Positive cluster"
        ? `${Math.round(positiveShare * 100)}% of sampled strikes carry positive exposure.`
        : label === "Negative cluster"
          ? `${Math.round(negativeShare * 100)}% of sampled strikes carry negative exposure.`
          : label === "Flat"
            ? "The sampled field is effectively neutral."
            : "Positive and negative pockets are distributed across the sampled strikes.";

  return { label, detail, positiveShare, negativeShare, signChanges };
}

/** Preserve the shape while keeping the SVG readable on dense chains. */
export function sampleTopology(rows: TopologyRow[], maxPoints = 28): TopologyRow[] {
  const sorted = [...rows]
    .filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.value))
    .sort((left, right) => left.strike - right.strike);
  if (sorted.length <= maxPoints) return sorted;
  const stride = (sorted.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => sorted[Math.round(index * stride)]);
}
