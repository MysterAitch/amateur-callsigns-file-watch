// STREAMING DIAGNOSTIC TRACE for the report sweep (issue #991).
//
// The sweep's existing perf breakdown is assembled in memory and written when
// the run FINISHES, so a run that dies mid-regeneration produces nothing at all
// — which is exactly what happened on the failures this exists to explain: the
// artifact step reported "No files were found". A record that only survives
// success cannot describe a crash.
//
// So this appends one self-contained JSON line per event, flushed at the moment
// it happens. A killed process loses at most the line it was writing, and the
// lines already on disk still say which tasks were in flight, how much memory
// the box had left, and how far each had got. The file is opened in append mode
// per write: several worker threads and the main thread all trace into the same
// file, and each line is far below the atomic-append size, so interleaving is
// safe without a lock.
//
// Deliberately verbose. The cost of a missing field is another ~40-minute run
// that still cannot answer the question; the cost of a redundant field is a few
// bytes. When in doubt this records it.
//
// Entirely inert unless SWEEP_TRACE_FILE names a path, and every failure inside
// the tracer is swallowed: diagnostics must never be the reason a build fails.

import * as fs from 'fs';
import * as os from 'os';
import { threadId } from 'worker_threads';

export const SWEEP_TRACE_FILE_ENV = 'SWEEP_TRACE_FILE';

// A snapshot of everything cheap enough to sample on every event. Memory is the
// leading hypothesis for #991, so it is recorded per event rather than only at
// the point of failure: the trajectory across a run is what distinguishes a
// steady squeeze from a sudden spike, and only one of those is fixed by lowering
// concurrency.
function snapshot(): Record<string, unknown> {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    thread: threadId,
    rssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
    heapTotalMb: Math.round(mem.heapTotal / 1048576),
    externalMb: Math.round(mem.external / 1048576),
    arrayBuffersMb: Math.round((mem.arrayBuffers ?? 0) / 1048576),
    sysFreeMb: Math.round(os.freemem() / 1048576),
    sysTotalMb: Math.round(os.totalmem() / 1048576),
    loadAvg: os.loadavg().map(n => Math.round(n * 100) / 100),
    uptimeS: Math.round(process.uptime()),
  };
}

/**
 * Record one event. `fields` carries whatever the call site knows — a task id, a
 * duration, an error — and is merged into the sampled snapshot.
 */
export function traceSweepEvent(event: string, fields: Record<string, unknown> = {}): void {
  const file = process.env[SWEEP_TRACE_FILE_ENV];
  if (file === undefined || file === '') return;
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields, ...snapshot() });
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // A diagnostic that breaks the run it is diagnosing is worse than no
    // diagnostic. Losing a trace line is always preferable to losing the run.
  }
}

/**
 * Trace the start and end of a unit of work, including the failure path — the
 * one that matters here, since a task that never reports an end is the task the
 * process died inside.
 */
export async function traceSweepTask<T>(id: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  traceSweepEvent('task-start', { id });
  try {
    const result = await run();
    traceSweepEvent('task-end', { id, ms: Date.now() - startedAt, outcome: 'ok' });
    return result;
  } catch (err) {
    traceSweepEvent('task-end', {
      id,
      ms: Date.now() - startedAt,
      outcome: 'failed',
      error: err instanceof Error ? err.message.slice(0, 4000) : String(err).slice(0, 4000),
    });
    throw err;
  }
}
