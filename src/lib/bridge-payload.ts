// Builder for the "GX2" chart-bridge payload consumed by the Pine indicator.
//
// Format
// ------
//   GX2#H~<space>~<instrument>~<refSpot>~<epochSec>~<warnAfterSec>|<block>|<block>…
//
//   header  H~<space>~<instrument>~<refSpot>~<epochSec>~<warnAfterSec>
//     space       N = native index points, F = already futures-converted
//     instrument  NQ | ES | STOCK (the chart price space the payload targets)
//     refSpot     the reference price every block has been rescaled onto
//     epochSec    snapshot time, so the chart can show payload age
//     warnAfterSec earliest instant at which an age warning is meaningful
//
//   block   <name>~<role>~<spot>~<step>~<agg>~<gamma>~<delta>~<expiries>
//                 ~<profile>~<volume>~<move>
//     name        NDX | SPX | QQQ | SPY
//     role        P = primary book, C = confirmation book
//     spot        that book's spot, rescaled onto refSpot (so ≈ refSpot)
//     step        that book's strike increment, rescaled onto refSpot
//     agg         call,put,flip,pain,vanna       (0 = absent)
//     gamma       strike,weight,sign;…           weight 0-100, sign ±1
//     delta       strike,weight,sign;…
//     expiries    label,call,put,flip,dte,settlesEpoch;…   settles 0 = unknown
//     profile     strike,exposure;…              exposure -100…100 of the peak
//     volume      callVolumeWall,putVolumeWall
//     move        oneSigmaBps,frontSettlesEpoch  bps of spot, already √-scaled
//
// Settlement travels because a payload outlives its own contracts. Exported at
// 15:55 it is four hours old at 20:00 — fresh by any age test — while its 0DTE
// walls describe options that ceased to exist at the close. Days to expiry
// cannot express that, and an overnight session's real exposure belongs to the
// next expiry, not the one that just settled.
//
// Fields past the eighth are additive: a reader that only understands the first
// eight still parses a newer payload correctly.
//
// Every price in a block is expressed in the payload's price space, which is
// why `step` travels with it: a QQQ level rescaled onto NDX carries a $1 strike
// increment that has become ~41 index points, and the indicator must draw its
// zone that wide rather than reusing the index's own grid. That grid is measured,
// never assumed — NDX quotes a modal 10 points across its near expiries and 25
// further out, and strikeIncrement reads whichever the selected expiries list.
//
// Delimiters are fixed and non-overlapping so Pine can split with str.split:
//   "|" blocks, "~" fields, ";" records, "," subfields.

export const BRIDGE_VERSION = "GX2";

export type BridgePart =
  | "expiryWalls"
  | "flips"
  | "aggregateWalls"
  | "maxPain"
  | "vanna"
  | "gamma"
  | "delta"
  | "profile"
  | "volumeWalls"
  | "expectedMove"
  // Acted on by the caller rather than the builder: it decides whether the
  // confirmation book is handed over as a source at all.
  | "confirmation";

export const DEFAULT_BRIDGE_PARTS: Record<BridgePart, boolean> = {
  expiryWalls: true,
  flips: true,
  aggregateWalls: true,
  maxPain: true,
  vanna: false,
  gamma: true,
  delta: false,
  confirmation: true,
  profile: true,
  volumeWalls: true,
  expectedMove: true,
};

/**
 * Reads the saved bridge contents, keyed against what this build knows about.
 *
 * Only current keys survive, so a part added since the preference was written
 * picks up its default instead of arriving undefined, and one that has been
 * removed does not linger in the payload builder as a stale switch.
 */
export function readBridgeParts(raw: string | null): Record<BridgePart, boolean> {
  if (!raw) return DEFAULT_BRIDGE_PARTS;
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(DEFAULT_BRIDGE_PARTS).map(([part, fallback]) => [
        part,
        typeof stored[part] === "boolean" ? stored[part] : fallback,
      ]),
    ) as Record<BridgePart, boolean>;
  } catch {
    return DEFAULT_BRIDGE_PARTS;
  }
}

export type BridgeStrikeRow = {
  strike: number;
  gamma: number;
  delta: number;
  callVolume?: number;
  putVolume?: number;
};

export type BridgeLevelSet = {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  maxPain: number | null;
  vannaMagnet: number | null;
};

export type BridgeSource = {
  name: string;
  role: "P" | "C";
  spot: number;
  strikes: BridgeStrikeRow[];
  levels: BridgeLevelSet;
  expiries: {
    label: string;
    dte?: number;
    levels: BridgeLevelSet;
    /**
     * When this expiry settles, as an ISO instant. A payload is a snapshot that
     * outlives its own contracts: exported at 15:55 it is four hours old at
     * 20:00 by any staleness measure, while its 0DTE walls describe options that
     * stopped existing at the close. The reader needs the settlement instant to
     * tell those apart, because days to expiry cannot.
     */
    settlesAt?: string | null;
  }[];
  /** ATM implied volatility of the front selected expiry, as a decimal. */
  frontAtmIv?: number | null;
  /** Year fraction to that expiry, so a 0DTE move is not rounded up to a day. */
  frontYears?: number | null;
  /** When the front expiry settles. An expected-move band outlives it. */
  frontSettlesAt?: string | null;
};

export type BridgeOptions = {
  space: "N" | "F";
  instrument: "NQ" | "ES" | "STOCK" | "MIXED";
  /** Price every source is rescaled onto: index spot for N, futures for F. */
  referenceSpot: number;
  generatedAt?: Date | number;
  /** Earliest market-calendar-aware instant at which snapshot age can warn. */
  warnAfter?: Date | number;
  parts: Record<BridgePart, boolean>;
  gammaCount?: number;
  deltaCount?: number;
  maxExpiries?: number;
  /** Keep every source in its own native price space for a multi-chart payload. */
  preserveNative?: boolean;
};

export type Concentration = {
  strike: number;
  weight: number;
  sign: 1 | -1;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function field(value: number | null) {
  return value === null || !Number.isFinite(value) || value === 0 ? "0" : String(round2(value));
}

/**
 * Modal gap between consecutive strikes. The mode rather than the mean or the
 * minimum, because chains routinely mix a dense near-the-money grid with a
 * sparse wing grid and a single missing strike would otherwise double the
 * estimate.
 */
export function strikeIncrement(strikes: number[]) {
  const sorted = [...new Set(strikes.filter((value) => Number.isFinite(value)))].sort(
    (left, right) => left - right,
  );
  if (sorted.length < 2) return 0;
  const counts = new Map<number, number>();
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = round2(sorted[index] - sorted[index - 1]);
    if (gap <= 0) continue;
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [gap, count] of counts) {
    // Ties resolve to the tighter grid: that is the increment actually listed.
    if (count > bestCount || (count === bestCount && gap < best)) {
      best = gap;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pick `count` distinct exposure clusters of one sign.
 *
 * Ranking raw strikes by |exposure| — what this used to do — returns the same
 * wall five times, because the four strikes bracketing a peak are almost always
 * the next four largest prints. Instead each strike is scored by the exposure
 * summed across its neighbourhood, peaks are taken greedily with a minimum
 * separation (non-maximum suppression), and the cluster's exposure-weighted
 * centre picks which strike to name — steadier between snapshots than simply
 * taking the tallest print, and closer to where the hedging actually sits.
 *
 * The price returned is snapped back to a listed strike. The centre itself
 * falls between strikes, which put every reported level in the gap between two
 * bars of the exposure histogram and made the two look unrelated.
 */
export function concentrationClusters(
  rows: BridgeStrikeRow[],
  metric: "gamma" | "delta",
  positive: boolean,
  count: number,
  step: number,
  minSeparation: number,
): Concentration[] {
  if (count <= 0) return [];
  const sign: 1 | -1 = positive ? 1 : -1;
  const candidates = rows
    .filter((row) => Number.isFinite(row.strike) && (positive ? row[metric] > 0 : row[metric] < 0))
    .map((row) => ({ strike: row.strike, magnitude: Math.abs(row[metric]) }))
    .sort((left, right) => left.strike - right.strike);
  if (!candidates.length) return [];

  const window = Math.max(step, minSeparation / 2);
  const scored = candidates.map((row) => {
    let mass = 0;
    for (const other of candidates) {
      if (Math.abs(other.strike - row.strike) <= window) mass += other.magnitude;
    }
    return { ...row, mass };
  });

  const accepted: Array<Concentration & { peak: number }> = [];
  for (const peak of [...scored].sort((left, right) => right.mass - left.mass)) {
    if (accepted.length >= count) break;
    // Suppression compares peaks rather than reported prices, so rounding the
    // reported price to a strike cannot pull two clusters closer than the
    // separation they were selected to respect.
    if (accepted.some((level) => Math.abs(level.peak - peak.strike) < minSeparation)) continue;
    let weighted = 0;
    let mass = 0;
    for (const other of candidates) {
      if (Math.abs(other.strike - peak.strike) > window) continue;
      weighted += other.strike * other.magnitude;
      mass += other.magnitude;
    }
    const centre = mass > 0 ? weighted / mass : peak.strike;
    // Report a strike that is actually listed. The weighted centre decides
    // which one, so selection keeps the steadiness of the centroid, but the
    // price named is one that can be traded and one the exposure histogram
    // draws a bar at. A level floating between two bars reads as a bug.
    const listed = candidates.reduce((best, row) =>
      Math.abs(row.strike - centre) < Math.abs(best.strike - centre) ? row : best,
    ).strike;
    accepted.push({ strike: round2(listed), weight: peak.mass, sign, peak: peak.strike });
  }

  const heaviest = Math.max(...accepted.map((level) => level.weight), 0);
  return accepted
    .map((level) => ({
      strike: level.strike,
      sign: level.sign,
      weight: heaviest > 0 ? Math.round((level.weight / heaviest) * 100) : 0,
    }))
    .sort((left, right) => right.weight - left.weight);
}

/**
 * Separation below which two levels describe the same wall. Two strike
 * increments on a coarse grid, a quarter of a percent on a fine one — an SPX
 * 5-point grid needs the percentage floor or five "distinct" levels still land
 * inside a 25-point band.
 */
export function minimumSeparation(step: number, spot: number) {
  return Math.max(step * 2, spot * 0.0025);
}

/**
 * The strike-by-strike exposure profile, trimmed to the strikes near spot and
 * normalized to ±100 of the largest print. The chart draws this as a histogram,
 * so only the shape matters and the absolute notional would just cost payload.
 */
export function exposureProfile(
  rows: BridgeStrikeRow[],
  spot: number,
  count = 48,
  spanPercent = 0.035,
) {
  const span = spot * spanPercent;
  const near = rows
    .filter((row) => Number.isFinite(row.strike) && Math.abs(row.strike - spot) <= span)
    .sort((left, right) => Math.abs(left.strike - spot) - Math.abs(right.strike - spot))
    .slice(0, count)
    .sort((left, right) => left.strike - right.strike);
  const peak = Math.max(...near.map((row) => Math.abs(row.gamma)), 0);
  if (!near.length || peak <= 0) return [];
  return near.map((row) => ({
    strike: row.strike,
    exposure: Math.round((row.gamma / peak) * 100),
  }));
}

/**
 * Walls by traded volume rather than open interest. For a same-day expiry the
 * contracts that changed hands this morning describe current hedging better
 * than a position built over weeks.
 */
export function volumeWalls(rows: BridgeStrikeRow[], spot: number) {
  const heaviest = (side: "callVolume" | "putVolume", above: boolean) => {
    const candidates = rows.filter(
      (row) =>
        Number.isFinite(row.strike) &&
        (above ? row.strike >= spot : row.strike <= spot) &&
        (row[side] ?? 0) > 0,
    );
    if (!candidates.length) return null;
    return candidates.reduce((best, row) => ((row[side] ?? 0) > (best[side] ?? 0) ? row : best))
      .strike;
  };
  return { call: heaviest("callVolume", true), put: heaviest("putVolume", false) };
}

/**
 * One standard deviation of the front expiry in basis points of spot. Scaling
 * by the year fraction here rather than in the indicator keeps a 0DTE move from
 * being rounded up to a whole session.
 */
/** Epoch seconds, or 0 when the instant is absent or unparseable. */
function epochSeconds(iso: string | null | undefined) {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : 0;
}

export function oneSigmaBps(atmIv: number | null | undefined, years: number | null | undefined) {
  if (!atmIv || !years || atmIv <= 0 || years <= 0) return null;
  return Math.round(atmIv * Math.sqrt(years) * 10_000);
}

function encodeConcentrations(levels: Concentration[], factor: number) {
  return levels
    .map((level) => `${field(level.strike * factor)},${level.weight},${level.sign}`)
    .join(";");
}

function encodeAggregate(levels: BridgeLevelSet, factor: number, parts: Record<BridgePart, boolean>) {
  const scale = (value: number | null) => (value === null ? null : value * factor);
  return [
    parts.aggregateWalls ? scale(levels.callWall) : null,
    parts.aggregateWalls ? scale(levels.putWall) : null,
    parts.flips ? scale(levels.gammaFlip) : null,
    parts.maxPain ? scale(levels.maxPain) : null,
    parts.vanna ? scale(levels.vannaMagnet) : null,
  ]
    .map(field)
    .join(",");
}

export function buildBridgeBlock(source: BridgeSource, options: BridgeOptions) {
  const { parts } = options;
  // Every source is rescaled onto the reference price so one chart-space
  // conversion in the indicator serves index, ETF and futures alike.
  const factor = options.preserveNative ? 1 : source.spot > 0 ? options.referenceSpot / source.spot : 1;
  const step = strikeIncrement(source.strikes.map((row) => row.strike));
  const separation = minimumSeparation(step, source.spot);
  const gamma = parts.gamma
    ? [
        ...concentrationClusters(source.strikes, "gamma", true, options.gammaCount ?? 5, step, separation),
        ...concentrationClusters(source.strikes, "gamma", false, options.gammaCount ?? 5, step, separation),
      ]
    : [];
  const delta = parts.delta
    ? [
        ...concentrationClusters(source.strikes, "delta", true, options.deltaCount ?? 3, step, separation),
        ...concentrationClusters(source.strikes, "delta", false, options.deltaCount ?? 3, step, separation),
      ]
    : [];
  const expiries = source.expiries
    .slice(0, options.maxExpiries ?? 12)
    .map((slice) =>
      [
        slice.label,
        field(parts.expiryWalls && slice.levels.callWall !== null ? slice.levels.callWall * factor : null),
        field(parts.expiryWalls && slice.levels.putWall !== null ? slice.levels.putWall * factor : null),
        field(parts.flips && slice.levels.gammaFlip !== null ? slice.levels.gammaFlip * factor : null),
        // Days to expiry travels as its own subfield rather than being scraped
        // back out of the label, which may carry a book prefix.
        String(Math.max(0, Math.round(slice.dte ?? 0))),
        // Settlement, in epoch seconds to match the header. Zero when unknown,
        // which the reader treats as "cannot tell" and leaves drawn rather than
        // silently hiding a level it has no evidence against.
        String(epochSeconds(slice.settlesAt)),
      ].join(","),
    )
    .join(";");

  // Both books ship a profile. Overlaying them would read as one distribution
  // and is not one, so the indicator draws a single book at a time and this
  // only decides which ones it can offer.
  const profile =
    parts.profile
      ? exposureProfile(source.strikes, source.spot)
          .map((point) => `${field(point.strike * factor)},${point.exposure}`)
          .join(";")
      : "";
  const volume = parts.volumeWalls
    ? (() => {
        const walls = volumeWalls(source.strikes, source.spot);
        return [
          field(walls.call === null ? null : walls.call * factor),
          field(walls.put === null ? null : walls.put * factor),
        ].join(",");
      })()
    : "";
  const sigma = parts.expectedMove ? oneSigmaBps(source.frontAtmIv, source.frontYears) : null;
  // The second subfield used to be the front expiry's days to expiry, which no
  // reader ever parsed. It carries the front settlement instead, so a band
  // scaled to an expiry that has since settled can be withdrawn.
  const move = sigma === null ? "" : `${sigma},${epochSeconds(source.frontSettlesAt)}`;
  return [
    source.name,
    source.role,
    field(source.spot * factor),
    field(step * factor),
    encodeAggregate(source.levels, factor, parts),
    encodeConcentrations(gamma, factor),
    encodeConcentrations(delta, factor),
    expiries,
    profile,
    volume,
    move,
  ].join("~");
}

export function buildBridgePayload(sources: BridgeSource[], options: BridgeOptions) {
  const epoch = Math.round(
    (options.generatedAt instanceof Date
      ? options.generatedAt.valueOf()
      : (options.generatedAt ?? Date.now())) / 1000,
  );
  const warnAfter = Math.round(
    (options.warnAfter instanceof Date
      ? options.warnAfter.valueOf()
      : (options.warnAfter ?? 0)) / 1000,
  );
  const header = [
    "H",
    options.space,
    options.instrument,
    field(options.referenceSpot),
    String(epoch),
    String(Number.isFinite(warnAfter) && warnAfter > 0 ? warnAfter : 0),
  ].join("~");
  const blocks = sources
    .filter((source) => source.spot > 0)
    .map((source) => buildBridgeBlock(source, options));
  return `${BRIDGE_VERSION}#${[header, ...blocks].join("|")}`;
}
