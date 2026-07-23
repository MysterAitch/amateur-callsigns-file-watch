/**
 * Flag-gated profiling harness (issue #354). Enabled only when the `PERF`
 * environment variable is set (to any non-empty value, e.g. `PERF=1`); when
 * off, every helper is a straight pass-through — a single branch, no timestamp
 * taken and nothing allocated — so it can live in the production build paths
 * permanently and profiling is repeatable later with just `PERF=1 npm run …`.
 *
 * It never changes program output: timings accumulate in a module-level map
 * and are printed, sorted, to stderr only when `perfReport()` is called and
 * only under `PERF`. Nothing here touches stdout or the files a build emits.
 *
 * Persistent machine-readable report. Passing a destination path in the
 * `PERF_JSON` environment variable (honoured only while `PERF` is on) makes
 * `perfReport()` additionally write a per-run JSON report to that path, so
 * successive runs can be compared over time. File emission is doubly gated —
 * off unless both `PERF` and `PERF_JSON` are set — so the disabled path writes
 * nothing and the `PERF`-on-without-`PERF_JSON` path keeps the original
 * stderr-only behaviour, leaving every golden build byte-identical. The JSON
 * shape is a stable contract (see {@link PerfReportJson}); the `schema` field
 * carries its version so consumers can evolve safely:
 *
 *   {
 *     "schema": "perf-report/v1",
 *     "entrypoint": "build-sqlite" | null,   // which build produced this run
 *     "generatedAt": "2026-07-17T12:34:56.789Z",  // ISO-8601 UTC, per run
 *     "node": "v25.0.0",
 *     "totalMs": 12345.6,                    // grand total across all labels
 *     "rows": [ { "label", "calls", "totalMs", "size" }, … ]  // sorted desc
 *   }
 *
 * The report is written atomically (temp file + rename) so a reader never sees
 * a half-written file, and a write failure (e.g. an unwritable path) throws
 * loudly rather than silently dropping the requested measurements — this only
 * ever runs under `PERF` + `PERF_JSON`, never on the golden build path.
 *
 * Spans may nest (a wrapped operation calling another wrapped operation), so a
 * parent's total includes its children's; `perfReport()` says so and the
 * per-label totals still rank the hotspots correctly. Prefer wrapping sibling
 * operations at one granularity to keep the percentages easy to read.
 */

import fs from 'node:fs';
import path from 'node:path';

interface PerfEntry {
  calls: number;
  totalMs: number;
  // Sum of the optional size hints (e.g. row counts) supplied at call sites;
  // stays 0 when a label never carries one.
  size: number;
}

const entries = new Map<string, PerfEntry>();

// Read the flag afresh on every call: a single property read and comparison,
// no allocation, so the disabled path stays a true pass-through while a test
// (or a late-configured process) can still toggle it cleanly.
function perfEnabled(): boolean {
  const value = process.env.PERF;
  return value !== undefined && value !== '';
}

function record(label: string, elapsedMs: number, size?: number): void {
  const entry = entries.get(label) ?? { calls: 0, totalMs: 0, size: 0 };
  entry.calls += 1;
  entry.totalMs += elapsedMs;
  if (size !== undefined) entry.size += size;
  entries.set(label, entry);
}

// Time a synchronous operation. When PERF is off this is exactly `fn()` with a
// single guard branch in front — no timestamp, no map touch.
export function time<T>(label: string, fn: () => T, size?: number): T {
  if (!perfEnabled()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, performance.now() - start, size);
  }
}

// Time an asynchronous operation. Off: returns the promise directly with one
// guard branch; on: awaits so the recorded span covers the full settle time.
export async function timeAsync<T>(label: string, fn: () => Promise<T>, size?: number): Promise<T> {
  if (!perfEnabled()) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start, size);
  }
}

export interface PerfSnapshotRow {
  label: string;
  calls: number;
  totalMs: number;
  size: number;
}

// The accumulated timings, sorted by total time descending — for tests and any
// programmatic consumer. A copy, so callers cannot mutate the internal state.
export function perfSnapshot(): PerfSnapshotRow[] {
  return [...entries.entries()]
    .map(([label, e]) => ({ label, calls: e.calls, totalMs: e.totalMs, size: e.size }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

// Clear all accumulated timings. Exposed for test isolation; a build never
// needs it (one process, one report at the end).
export function perfReset(): void {
  entries.clear();
}

// Fold spans measured in another isolate into this process's report. A build
// that fans work across worker threads (each with its own module-level map)
// collects every worker's perfSnapshot() and merges it here, so the single
// PERF / PERF_JSON breakdown still accounts for every span wherever it ran.
// Same-label rows accumulate exactly as repeated in-process time() calls would.
export function perfMerge(rows: readonly PerfSnapshotRow[]): void {
  for (const row of rows) {
    const entry = entries.get(row.label) ?? { calls: 0, totalMs: 0, size: 0 };
    entry.calls += row.calls;
    entry.totalMs += row.totalMs;
    entry.size += row.size;
    entries.set(row.label, entry);
  }
}

// The current on-disk report schema. Bump the version suffix on any
// breaking change to the field shape so consumers can branch on it.
export const PERF_REPORT_SCHEMA = 'perf-report/v1';

// The machine-readable per-run report. Field names are a stable contract so
// runs stored over weeks/months/years stay comparable; `generatedAt` is the
// only per-run-varying field and is what makes each report a distinct record.
export interface PerfReportJson {
  schema: typeof PERF_REPORT_SCHEMA;
  entrypoint: string | null;
  generatedAt: string;
  node: string;
  totalMs: number;
  rows: PerfSnapshotRow[];
}

// Build the report object from the current snapshot. Pure — no file IO, no
// flag check — so consumers and tests can inspect the exact bytes that would
// be persisted. `entrypoint` names the build being profiled (or null).
export function perfReportJson(entrypoint?: string): PerfReportJson {
  const rows = perfSnapshot();
  return {
    schema: PERF_REPORT_SCHEMA,
    entrypoint: entrypoint ?? null,
    generatedAt: new Date().toISOString(),
    node: process.version,
    totalMs: rows.reduce((sum, r) => sum + r.totalMs, 0),
    rows,
  };
}

// Write the report to `destination` atomically (temp file + rename), creating
// any missing parent directories. Throws with a helpful message if the path
// cannot be written, so a requested profiling record is never silently lost.
// Callers are responsible for the flag gating; this always writes.
function writeReportJson(destination: string, entrypoint?: string): void {
  const target = path.resolve(destination);
  const report = perfReportJson(entrypoint);
  const body = JSON.stringify(report, null, 2) + '\n';
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  } catch (cause) {
    // Best-effort cleanup: `force` suppresses only ENOENT, and an unwritable
    // destination can fail the removal itself in platform-dependent ways
    // (e.g. ENOTDIR when a path component is a file) — the contextual error
    // below must win over any cleanup failure.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // The temp file cannot exist if its path was never creatable.
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`perf: could not write the PERF_JSON report to ${target}: ${reason}`);
  }
}

// Print the sorted breakdown to stderr — one line per label with its call
// count, total ms, share of the total measured time, and (where supplied) the
// accumulated size hint. A no-op when PERF is off or nothing was measured.
//
// When PERF is on and `PERF_JSON` names a path, a machine-readable per-run
// report is additionally written there (see the module header). `entrypoint`
// labels which build produced the run so same-entrypoint runs can be compared.
export function perfReport(options?: { entrypoint?: string }): void {
  if (!perfEnabled()) return;
  const rows = perfSnapshot();
  if (rows.length === 0) return;
  const grandTotalMs = rows.reduce((sum, r) => sum + r.totalMs, 0);
  const labelWidth = Math.max(5, ...rows.map(r => r.label.length));
  const lines: string[] = [];
  lines.push('');
  lines.push('=== perf breakdown (PERF set) — spans may nest; parent totals include children ===');
  lines.push(`${'label'.padEnd(labelWidth)}  ${'calls'.padStart(7)}  ${'total ms'.padStart(11)}  ${'%'.padStart(6)}  size`);
  for (const r of rows) {
    const pct = grandTotalMs > 0 ? (r.totalMs / grandTotalMs) * 100 : 0;
    lines.push(
      `${r.label.padEnd(labelWidth)}  ${String(r.calls).padStart(7)}  ${r.totalMs.toFixed(1).padStart(11)}  ${`${pct.toFixed(1)}%`.padStart(6)}  ${r.size > 0 ? r.size.toLocaleString('en-GB') : ''}`,
    );
  }
  lines.push(`${'total'.padEnd(labelWidth)}  ${''.padStart(7)}  ${grandTotalMs.toFixed(1).padStart(11)}  ${'100.0%'.padStart(6)}`);
  lines.push('');
  process.stderr.write(lines.join('\n') + '\n');
  // The persistent record is written last, after the human breakdown is on
  // screen, so an unwritable PERF_JSON path still leaves the operator the
  // stderr view before this throws.
  const jsonPath = process.env.PERF_JSON;
  if (jsonPath !== undefined && jsonPath !== '') {
    writeReportJson(jsonPath, options?.entrypoint);
  }
}
