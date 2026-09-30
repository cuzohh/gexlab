import assert from "node:assert/strict";
import test from "node:test";
import { parseGdeltTimeline, summarizeNewsTimeline } from "../src/lib/news-sentiment.ts";

test("parses and sorts GDELT timeline points", () => {
  const points = parseGdeltTimeline({
    timeline: [
      {
        series: "Average Tone",
        data: [
          { date: "20260801T120000Z", value: -1.2 },
          { date: "20260801T020000Z", value: 0.8 },
          { date: "bad", value: "ignored" },
        ],
      },
    ],
  });

  assert.deepEqual(points, [
    { timestamp: "2026-08-01T02:00:00.000Z", value: 0.8 },
    { timestamp: "2026-08-01T12:00:00.000Z", value: -1.2 },
  ]);
});

test("summarizes current windows against the prior daily baseline", () => {
  const points = Array.from({ length: 27 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString(),
    value: index < 24 ? 0 : 2,
  }));

  const summary = summarizeNewsTimeline(points);

  assert.equal(summary.windows.day.value, 2);
  assert.equal(summary.windows.threeDay.value, 2);
  assert.equal(summary.baseline, 0);
  assert.equal(summary.change20, 2);
  assert.equal(summary.percentile, 100);
  assert.equal(summary.windows.threeDay.samples, 3);
});
