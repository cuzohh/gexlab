import "server-only";

import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { EngineJob, EngineJobResult } from "./engine-worker.ts";
import { runJob } from "./engine-worker.ts";

/**
 * Runs the forecast evaluations across worker threads.
 *
 * The ten targets are independent fits over the same feature rows, so the only
 * reason they ever ran one after another on the request thread was that nobody
 * had moved them. Doing so buys two things: the wall clock drops by roughly the
 * number of threads, and — the reason this exists — the thread that answers
 * requests stops being the thread that fits models. A rebuild used to make the
 * whole server unresponsive for thirteen seconds.
 *
 * If a worker cannot be started the jobs are run in this thread instead. That
 * path is slower and it blocks, but it is the behaviour the route had before,
 * so a packaging problem degrades the server rather than breaking it.
 */

const WORKER_SOURCE = path.join(process.cwd(), "src", "lib", "server", "engine-worker.ts");

/** Leave a core for the thread serving requests, and do not exceed the work. */
function workerCount(jobs: number) {
  const cores = (() => {
    try {
      return availableParallelism();
    } catch {
      return 4;
    }
  })();
  return Math.max(1, Math.min(jobs, cores - 1));
}

/**
 * The fallback path, on this thread.
 *
 * It yields between jobs so that even here a rebuild cannot hold the event loop
 * for its whole duration — the longest anything else waits is one fit rather
 * than all ten.
 */
async function runInProcess(jobs: EngineJob[]) {
  const results = new Map<string, unknown>();
  for (const job of jobs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    results.set(job.id, runJob(job));
  }
  return results;
}

export function engineWorkersAvailable() {
  return existsSync(WORKER_SOURCE);
}

export async function runEngineJobs(jobs: EngineJob[]): Promise<Map<string, unknown>> {
  if (!jobs.length) return new Map();
  if (!engineWorkersAvailable()) return runInProcess(jobs);

  const results = new Map<string, unknown>();
  const queue = [...jobs];
  const size = workerCount(jobs.length);

  try {
    await Promise.all(
      Array.from({ length: size }, async () => {
        // One worker per lane, reused across the jobs that lane picks up: the
        // feature rows are the only large payload and starting a thread costs
        // more than the message does.
        const worker = new Worker(WORKER_SOURCE);
        worker.unref();
        try {
          for (;;) {
            const job = queue.shift();
            if (!job) return;
            const result = await new Promise<EngineJobResult>((resolve, reject) => {
              const onMessage = (message: EngineJobResult) => {
                cleanup();
                resolve(message);
              };
              const onError = (error: Error) => {
                cleanup();
                reject(error);
              };
              const onExit = (code: number) => {
                cleanup();
                reject(new Error(`The evaluation worker stopped with code ${code}.`));
              };
              const cleanup = () => {
                worker.off("message", onMessage);
                worker.off("error", onError);
                worker.off("exit", onExit);
              };
              worker.on("message", onMessage);
              worker.on("error", onError);
              worker.on("exit", onExit);
              worker.postMessage(job);
            });
            if ("error" in result) throw new Error(result.error);
            results.set(result.id, result.value);
          }
        } finally {
          await worker.terminate();
        }
      }),
    );
  } catch (error) {
    // Any worker failing takes the whole set with it rather than leaving a
    // payload with some targets evaluated and others silently missing.
    console.warn(
      "[engine] worker evaluation failed, falling back to this thread:",
      error instanceof Error ? error.message : error,
    );
    return runInProcess(jobs);
  }

  return results;
}
