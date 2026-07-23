/**
 * Test-only worker fixture for report-sweep-pool.test.ts (issue #929).
 *
 * runTaskInWorker is generic over the worker script, so its lifecycle contract
 * (resolve-with-perf, reject-on-error, reject-on-non-zero-exit) can be exercised
 * against this trivial worker instead of the real report sweep, which needs the
 * DuckDB CLI and minutes of corpus folding. It mirrors the real worker's message
 * protocol: it reads workerData.reportTaskId and posts a { perf } snapshot, so
 * the pool's parsing is tested against the same shape the sweep produces.
 *
 * Not a *.test.ts file, so the vitest project globs never collect it as a suite;
 * it is loaded only as a worker entry point by the pool test.
 */

import { workerData, parentPort } from 'node:worker_threads';

const { reportTaskId } = workerData as { reportTaskId: string };

// 'boom' throws (→ the worker's 'error' event → the pool rejects); 'nonzero'
// exits non-zero without erroring (→ the pool rejects on the exit code); any
// other id posts a one-row perf snapshot labelled with the id and exits 0.
if (reportTaskId === 'boom') {
  throw new Error('fixture task exploded');
} else if (reportTaskId === 'nonzero') {
  process.exit(3);
} else {
  parentPort?.postMessage({ perf: [{ label: reportTaskId, calls: 1, totalMs: 1, size: 0 }] });
}
