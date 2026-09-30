export type NewsTimelinePoint = {
  timestamp: string;
  value: number;
};

export type NewsWindow = {
  value: number | null;
  samples: number;
};

export type NewsTimelineSummary = {
  windows: {
    day: NewsWindow;
    threeDay: NewsWindow;
    week: NewsWindow;
  };
  baseline: number | null;
  change20: number | null;
  percentile: number | null;
  asOf: string | null;
};

function parseGdeltTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

/** Accepts GDELT's nested timeline response and discards malformed points. */
export function parseGdeltTimeline(payload: unknown): NewsTimelinePoint[] {
  if (!payload || typeof payload !== "object") return [];
  const timeline = (payload as { timeline?: unknown }).timeline;
  if (!Array.isArray(timeline)) return [];
  const series = timeline.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Array.isArray((entry as { data?: unknown }).data);
  }) as { data?: unknown[] } | undefined;
  if (!series?.data) return [];
  return series.data
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as { date?: unknown; value?: unknown };
      const timestamp = parseGdeltTimestamp(row.date);
      const value = Number(row.value);
      return timestamp && Number.isFinite(value) ? [{ timestamp, value }] : [];
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function meanValues(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function mean(points: NewsTimelinePoint[]) {
  return meanValues(points.map((point) => point.value));
}

function windowMean(points: NewsTimelinePoint[], end: number, hours: number): NewsWindow {
  const start = end - hours * 60 * 60 * 1000;
  const selected = points.filter((point) => {
    const time = Date.parse(point.timestamp);
    return time > start && time <= end;
  });
  return { value: mean(selected), samples: selected.length };
}

/**
 * Summarizes a timeline without pretending that article tone is a market
 * forecast. The baseline is the twenty daily observations before the current
 * three-day window, which keeps attention and tone changes interpretable.
 */
export function summarizeNewsTimeline(points: NewsTimelinePoint[]): NewsTimelineSummary {
  if (!points.length) {
    const empty = { value: null, samples: 0 };
    return {
      windows: { day: empty, threeDay: empty, week: empty },
      baseline: null,
      change20: null,
      percentile: null,
      asOf: null,
    };
  }

  const end = Date.parse(points.at(-1)!.timestamp);
  const day = windowMean(points, end, 24);
  const threeDay = windowMean(points, end, 72);
  const week = windowMean(points, end, 168);
  const baselineEnd = end - 72 * 60 * 60 * 1000;
  const daily = new Map<string, number[]>();
  for (const point of points) {
    const date = point.timestamp.slice(0, 10);
    const time = Date.parse(point.timestamp);
    if (time <= baselineEnd) daily.set(date, [...(daily.get(date) ?? []), point.value]);
  }
  const baselineValues = [...daily.values()].map((values) => meanValues(values)).filter((value): value is number => value !== null).slice(-20);
  const baseline = meanValues(baselineValues);
  const currentThreeDay = threeDay.value;
  const percentile =
    baselineValues.length && currentThreeDay !== null
      ? Math.round((baselineValues.filter((value) => value < currentThreeDay).length / baselineValues.length) * 100)
      : null;

  return {
    windows: { day, threeDay, week },
    baseline,
    change20: threeDay.value !== null && baseline !== null ? threeDay.value - baseline : null,
    percentile,
    asOf: points.at(-1)?.timestamp ?? null,
  };
}
