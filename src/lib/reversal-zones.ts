export type ReversalMetricRow = {
  strike: number;
  gamma: number;
  delta: number;
  vanna: number;
  charm: number;
  vega: number;
  speed: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
};

export type ReversalLevels = {
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  maxPain: number | null;
  vannaMagnet: number | null;
};

export type ReversalSnapshot = {
  symbol: string;
  spot: number;
  timestamp: string | null;
  stale?: boolean;
  strikes: ReversalMetricRow[];
  levels: ReversalLevels;
};

export type ReversalZone = {
  center: number;
  low: number;
  high: number;
  side: "Support" | "Resistance";
  kind: "Reversal candidate" | "Acceleration zone" | "Pin / magnet";
  score: number;
  confidence: "High" | "Medium" | "Low";
  distancePercent: number;
  confluence: number;
  levelNames: string[];
  reasons: string[];
};

export type ReversalScenarioPoint = {
  price: number;
  gamma: number;
  speed: number;
  vanna: number;
  charm: number;
  stabilizing: number;
  amplifying: number;
};

export type ReversalAnalysis = {
  zones: ReversalZone[];
  scenario: ReversalScenarioPoint[];
  dataQuality: "High" | "Medium" | "Low";
  note: string;
};

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
  return Math.max(sorted[index], 1e-9);
}

function normalize(value: number, scale: number) {
  return Math.max(-1, Math.min(1, value / scale));
}

function medianStep(rows: ReversalMetricRow[]) {
  const gaps = rows
    .map((row, index) => index ? row.strike - rows[index - 1].strike : null)
    .filter((value): value is number => value !== null && value > 0);
  return percentile(gaps, 0.5);
}

function interpolate(rows: ReversalMetricRow[], price: number, key: keyof ReversalMetricRow) {
  if (!rows.length) return 0;
  let nearest = rows[0];
  for (const row of rows) {
    if (Math.abs(row.strike - price) < Math.abs(nearest.strike - price)) nearest = row;
  }
  return Number(nearest[key]) || 0;
}

function levelName(levels: ReversalLevels, price: number, tolerance: number) {
  const entries: Array<[string, number | null]> = [
    ["Call wall", levels.callWall],
    ["Put wall", levels.putWall],
    ["Gamma flip", levels.gammaFlip],
    ["Max pain", levels.maxPain],
    ["Vanna magnet", levels.vannaMagnet],
  ];
  return entries
    .filter(([, value]) => finite(value) && Math.abs(value - price) <= tolerance)
    .map(([name]) => name);
}

export function buildReversalAnalysis(snapshot: ReversalSnapshot): ReversalAnalysis {
  const usable = snapshot.strikes
    .filter((row) => finite(row.strike) && row.strike > 0 && Math.abs(row.strike / snapshot.spot - 1) <= 0.06)
    .sort((left, right) => left.strike - right.strike);
  if (!usable.length || !(snapshot.spot > 0)) {
    return {
      zones: [],
      scenario: [],
      dataQuality: "Low",
      note: "The option book does not have enough nearby strike data to build a confluence map.",
    };
  }

  const scales = {
    gamma: percentile(usable.map((row) => Math.abs(row.gamma)), 0.9),
    delta: percentile(usable.map((row) => Math.abs(row.delta)), 0.9),
    vanna: percentile(usable.map((row) => Math.abs(row.vanna)), 0.9),
    charm: percentile(usable.map((row) => Math.abs(row.charm)), 0.9),
    speed: percentile(usable.map((row) => Math.abs(row.speed)), 0.9),
  };
  const step = medianStep(usable);
  const clusterWidth = Math.max(step * 1.5, snapshot.spot * 0.0015);
  const candidateRows = usable.filter((row) => {
    const activity = Math.max(
      Math.abs(normalize(row.gamma, scales.gamma)),
      Math.abs(normalize(row.vanna, scales.vanna)),
      Math.abs(normalize(row.charm, scales.charm)),
      Math.abs(normalize(row.speed, scales.speed)),
    );
    return activity >= 0.55;
  });
  const namedLevels = Object.values(snapshot.levels).filter(finite);
  const seedPrices = [...candidateRows.map((row) => row.strike), ...namedLevels]
    .filter((value) => Math.abs(value / snapshot.spot - 1) <= 0.06)
    .sort((left, right) => left - right);
  const clusters: number[][] = [];
  for (const price of seedPrices) {
    const existing = clusters.find((cluster) => Math.abs(cluster[0] - price) <= clusterWidth);
    if (existing) existing.push(price);
    else clusters.push([price]);
  }

  const zones = clusters.map((seed) => {
    const center = seed.reduce((sum, value) => sum + value, 0) / seed.length;
    const rows = usable.filter((row) => Math.abs(row.strike - center) <= clusterWidth);
    const representative = rows.reduce((best, row) =>
      Math.abs(row.gamma) > Math.abs(best.gamma) ? row : best,
    );
    const gamma = normalize(representative.gamma, scales.gamma);
    const speed = Math.abs(normalize(representative.speed, scales.speed));
    const delta = Math.abs(normalize(representative.delta, scales.delta));
    const vanna = Math.abs(normalize(representative.vanna, scales.vanna));
    const charm = Math.abs(normalize(representative.charm, scales.charm));
    const oi = rows.reduce((sum, row) => sum + row.callOi + row.putOi, 0);
    const volume = rows.reduce((sum, row) => sum + row.callVolume + row.putVolume, 0);
    const activity = oi > 0 ? Math.min(1, oi / Math.max(...usable.map((row) => row.callOi + row.putOi), 1)) : 0;
    const names = levelName(snapshot.levels, center, clusterWidth);
    const confluence = [
      Math.abs(gamma) >= 0.55,
      speed >= 0.55,
      vanna >= 0.55,
      charm >= 0.55,
      activity >= 0.55,
      names.length > 0,
    ].filter(Boolean).length;
    const score = Math.round(Math.min(100, 35 * Math.max(gamma, 0) + 15 * speed + 12 * delta + 12 * vanna + 10 * charm + 10 * activity + 6 * Math.min(names.length, 1)));
    const side = center < snapshot.spot ? "Support" as const : "Resistance" as const;
    const kind = gamma > 0.35
      ? names.includes("Max pain") && Math.abs(center / snapshot.spot - 1) < 0.01
        ? "Pin / magnet" as const
        : "Reversal candidate" as const
      : "Acceleration zone" as const;
    const reasons = [
      gamma > 0.35 ? "stabilizing gamma" : gamma < -0.35 ? "negative gamma can amplify a break" : "mixed gamma",
      speed >= 0.55 ? "sharp gamma transition" : null,
      vanna >= 0.55 ? "vanna concentration" : null,
      charm >= 0.55 ? "charm concentration" : null,
      names.length ? names.join(" + ") : null,
      volume > 0 ? "OI/volume activity" : null,
    ].filter((reason): reason is string => reason !== null);
    return {
      center,
      low: Math.min(...rows.map((row) => row.strike), center - clusterWidth),
      high: Math.max(...rows.map((row) => row.strike), center + clusterWidth),
      side,
      kind,
      score,
      confidence: score >= 75 && confluence >= 4 ? "High" : score >= 50 && confluence >= 3 ? "Medium" : "Low",
      distancePercent: (center / snapshot.spot - 1) * 100,
      confluence,
      levelNames: names,
      reasons,
    } satisfies ReversalZone;
  });

  const uniqueZones = zones
    .sort((left, right) => right.score - left.score)
    .filter((zone, index, all) => all.findIndex((candidate) => Math.abs(candidate.center - zone.center) <= clusterWidth) === index)
    .slice(0, 6);
  const scenario: ReversalScenarioPoint[] = [];
  const low = snapshot.spot * 0.96;
  const high = snapshot.spot * 1.04;
  for (let index = 0; index <= 48; index += 1) {
    const price = low + ((high - low) * index) / 48;
    const gamma = normalize(interpolate(usable, price, "gamma"), scales.gamma);
    const speed = normalize(interpolate(usable, price, "speed"), scales.speed);
    const vanna = normalize(interpolate(usable, price, "vanna"), scales.vanna);
    const charm = normalize(interpolate(usable, price, "charm"), scales.charm);
    scenario.push({
      price,
      gamma,
      speed,
      vanna,
      charm,
      stabilizing: Math.max(0, gamma) * 0.65 + Math.max(0, speed) * 0.15 + Math.abs(vanna) * 0.1 + Math.abs(charm) * 0.1,
      amplifying: Math.max(0, -gamma) * 0.7 + Math.max(0, -speed) * 0.2 + Math.abs(vanna) * 0.05 + Math.abs(charm) * 0.05,
    });
  }

  return {
    zones: uniqueZones,
    scenario,
    dataQuality: usable.length >= 30 ? "High" : usable.length >= 15 ? "Medium" : "Low",
    note: "Confluence score is a structural ranking, not a calibrated probability. Positive gamma supports reversal; negative gamma marks acceleration risk.",
  };
}
