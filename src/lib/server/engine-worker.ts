/**
 * Worker entry for the forecast evaluation.
 *
 * Loaded by engine-pool.ts through worker_threads, by absolute path from the
 * project root rather than through the bundler: Node reads this file itself,
 * which is why it and everything it imports must stay free of anything Next
 * supplies at build time.
 *
 * One job per message, one result back. The pool decides how many of these
 * exist and which target each one gets.
 */
import { parentPort } from "node:worker_threads";
import type { FeatureRow } from "../engine-features.ts";
import {
  evaluateClassifier,
  evaluateVolatility,
  trueRangeByDate,
  wilderAtrByDate,
} from "./engine-evaluation.ts";
import type { DailyOhlc } from "./yahoo-daily.ts";

export type ClassifierJob = {
  id: string;
  kind: "classifier";
  rows: FeatureRow[];
  labels: Array<number | null>;
  target: string;
  question: string;
  horizon: number;
};

export type VolatilityJob = {
  id: string;
  kind: "volatility";
  rows: FeatureRow[];
  /** Daily bars, from which the range and ATR maps are rebuilt in the worker. */
  bars: DailyOhlc[];
};

export type EngineJob = ClassifierJob | VolatilityJob;
export type EngineJobResult = { id: string; value: unknown } | { id: string; error: string };

export function runJob(job: EngineJob) {
  if (job.kind === "classifier") {
    return evaluateClassifier(job.rows, job.labels, job.target, job.question, job.horizon);
  }
  // Maps do not survive the structured clone in a useful shape for this, and
  // rebuilding them from the bars costs a few milliseconds against a fit that
  // takes over a second.
  return evaluateVolatility(
    job.rows,
    trueRangeByDate(job.bars),
    wilderAtrByDate(job.bars, 14),
    wilderAtrByDate(job.bars, 50),
  );
}

if (parentPort) {
  parentPort.on("message", (job: EngineJob) => {
    try {
      parentPort!.postMessage({ id: job.id, value: runJob(job) } satisfies EngineJobResult);
    } catch (error) {
      parentPort!.postMessage({
        id: job.id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies EngineJobResult);
    }
  });
}
