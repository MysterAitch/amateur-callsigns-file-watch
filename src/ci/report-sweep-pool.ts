/**
 * Bounded worker-thread fan-out for the report sweep (issue #929).
 *
 * The sweep's report generators are independent producers over a shared input
 * (the ledger projection + the archive), each writing its own disjoint files
 * under reports/. Run sequentially in one Node process they sum to the whole
 * critical path, and every analytical wave lengthens it (the #929 audit put the
 * sweep at ~54 min on a cache miss). This module fans them across a fixed number
 * of worker threads so independent generators run at once, capped at the runner's
 * cores rather than oversubscribing it.
 *
 * Two pieces, split so the scheduling is testable without spawning threads:
 *  - runBounded: a pure bounded-concurrency async map (no worker specifics);
 *  - runTaskInWorker: one generator run in a fresh worker thread, its perf
 *    snapshot posted back, a non-zero exit surfaced as a rejection.
 */

import { Worker } from 'node:worker_threads';
import { errorMessage } from '../shared/utils.ts';
import type { PerfSnapshotRow } from '../shared/perf.ts';

// A bounded-concurrency async map: invoke `worker(item, index)` for every item
// with at most `concurrency` in flight, returning results in item order. The
// first rejection is surfaced and no further items are started (in-flight lanes
// settle, their results discarded) - a sweep failure is fatal and the caller
// re-throws. `concurrency` is clamped to [1, items.length], so an idle lane is
// never created and a zero/negative request still makes progress.
export async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let next = 0;
  let firstError: unknown;
  let failed = false;
  const runLane = async (): Promise<void> => {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  if (failed) throw firstError;
  return results;
}

// The message a worker posts back on success: the spans it timed, to be merged
// into the orchestrator's perf report (perfMerge) so the parallel run's
// breakdown still names every generator.
export interface ReportTaskResult {
  taskId: string;
  perf: PerfSnapshotRow[];
}

// Run one report-generator task in a fresh worker thread. `workerUrl` is the
// report-sweep module itself (self-as-worker: it detects the worker context and
// runs the single task named in workerData), so the byte-producing generator
// code lives in one place and stays inside the golden closure's traced import
// graph. The worker posts its perf snapshot and exits 0 on success; an 'error'
// event or a non-zero exit becomes a rejection naming the task, so a broken
// generator fails the sweep (and the golden gate) loudly rather than silently
// skipping a report.
export function runTaskInWorker(workerUrl: URL, taskId: string): Promise<ReportTaskResult> {
  return new Promise<ReportTaskResult>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { reportTaskId: taskId } });
    let perf: PerfSnapshotRow[] = [];
    let settled = false;
    worker.on('message', (message: { perf?: PerfSnapshotRow[] }) => {
      if (Array.isArray(message?.perf)) perf = message.perf;
    });
    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`report task '${taskId}' failed: ${errorMessage(err)}`));
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ taskId, perf });
      else reject(new Error(`report task '${taskId}' worker exited with code ${code}`));
    });
  });
}
