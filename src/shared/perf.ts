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
 * Spans may nest (a wrapped operation calling another wrapped operation), so a
 * parent's total includes its children's; `perfReport()` says so and the
 * per-label totals still rank the hotspots correctly. Prefer wrapping sibling
 * operations at one granularity to keep the percentages easy to read.
 */

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

// Print the sorted breakdown to stderr — one line per label with its call
// count, total ms, share of the total measured time, and (where supplied) the
// accumulated size hint. A no-op when PERF is off or nothing was measured.
export function perfReport(): void {
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
}
