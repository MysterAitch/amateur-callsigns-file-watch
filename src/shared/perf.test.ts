import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  time,
  timeAsync,
  perfReport,
  perfReset,
  perfSnapshot,
  perfMerge,
  perfReportJson,
  PERF_REPORT_SCHEMA,
  type PerfReportJson,
} from './perf.ts';
import { parseJsonObject } from './json-shape.ts';

function readReport(dest: string): PerfReportJson {
  return parseJsonObject(fs.readFileSync(dest, 'utf8'), dest) as PerfReportJson;
}

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The perf harness (issue #354) is a flag-gated, permanent profiling aid: it
// must be a true pass-through when PERF is unset (no timestamp taken, no
// output, no change to what the wrapped function returns) and accumulate
// per-label call counts and total time when set. These tests pin both regimes.

const originalPerf = process.env.PERF;
const originalPerfJson = process.env.PERF_JSON;

beforeEach(() => {
  perfReset();
  delete process.env.PERF_JSON;
});

afterEach(() => {
  if (originalPerf === undefined) delete process.env.PERF;
  else process.env.PERF = originalPerf;
  if (originalPerfJson === undefined) delete process.env.PERF_JSON;
  else process.env.PERF_JSON = originalPerfJson;
  vi.restoreAllMocks();
});

describe('time', { tags: ['unit'] }, () => {
  it('Time_WhenDisabled_ReturnsValueUnchanged', () => {
    delete process.env.PERF;
    expect(time('label', () => 6 * 7)).toBe(42);
  });

  it('Time_WhenEnabled_ReturnsValueUnchanged', () => {
    process.env.PERF = '1';
    expect(time('label', () => 6 * 7)).toBe(42);
  });

  it('Time_WhenDisabled_TakesNoTimestamp', () => {
    delete process.env.PERF;
    const now = vi.spyOn(performance, 'now');
    time('label', () => 'result');
    expect(now).not.toHaveBeenCalled();
  });

  it('Time_WhenEnabled_TakesTimestamps', () => {
    process.env.PERF = '1';
    const now = vi.spyOn(performance, 'now');
    time('label', () => 'result');
    expect(now).toHaveBeenCalled();
  });

  it('Time_WhenDisabled_RecordsNothing', () => {
    delete process.env.PERF;
    time('label', () => 'result');
    expect(perfSnapshot()).toHaveLength(0);
  });

  it('Time_WhenEnabledAndEmptyString_TreatedAsDisabled', () => {
    // An explicitly empty PERF is "not set" — the flag is presence-of-value.
    process.env.PERF = '';
    time('label', () => 'result');
    expect(perfSnapshot()).toHaveLength(0);
  });

  it('Time_WhenCalledRepeatedly_AccumulatesCallsAndTotalPerLabel', () => {
    process.env.PERF = '1';
    time('parse', () => 'a');
    time('parse', () => 'b');
    time('gzip', () => 'c');
    const byLabel = new Map(perfSnapshot().map(r => [r.label, r]));
    expect(byLabel.get('parse')?.calls).toBe(2);
    expect(byLabel.get('gzip')?.calls).toBe(1);
    expect(byLabel.get('parse')?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('Time_WhenSizeHintSupplied_AccumulatesSizeAcrossCalls', () => {
    process.env.PERF = '1';
    time('parse:register', () => 'a', 100);
    time('parse:register', () => 'b', 58);
    expect(perfSnapshot().find(r => r.label === 'parse:register')?.size).toBe(158);
  });

  it('Time_WhenExceptionThrown_StillRecordsTheSpan', () => {
    process.env.PERF = '1';
    expect(() => time('boom', () => { throw new Error('boom'); })).toThrow('boom');
    expect(perfSnapshot().find(r => r.label === 'boom')?.calls).toBe(1);
  });
});

describe('timeAsync', { tags: ['unit'] }, () => {
  it('TimeAsync_WhenEnabled_ResolvesValueAndRecordsSpan', async () => {
    process.env.PERF = '1';
    const value = await timeAsync('async-op', () => Promise.resolve('done'));
    expect(value).toBe('done');
    expect(perfSnapshot().find(r => r.label === 'async-op')?.calls).toBe(1);
  });

  it('TimeAsync_WhenDisabled_ResolvesValueWithoutRecording', async () => {
    delete process.env.PERF;
    const value = await timeAsync('async-op', () => Promise.resolve('done'));
    expect(value).toBe('done');
    expect(perfSnapshot()).toHaveLength(0);
  });
});

describe('perfMerge', { tags: ['unit'] }, () => {
  it('WorkerRows_MergedIntoAFreshReport_AppearWithTheirCallsTotalsAndSizes', () => {
    // A build that fans work across worker threads collects each worker's
    // perfSnapshot() and folds it in; a label only a worker measured appears in
    // the merged report exactly as it was posted.
    perfMerge([{ label: 'reports:survival-cohort', calls: 1, totalMs: 446_000, size: 12 }]);
    const row = perfSnapshot().find(r => r.label === 'reports:survival-cohort');
    expect(row).toEqual({ label: 'reports:survival-cohort', calls: 1, totalMs: 446_000, size: 12 });
  });

  it('WorkerRows_SharingALabelWithInProcessSpans_Accumulate', () => {
    // The folding thread timed one span; a worker posts another under the same
    // label. The merged report adds them, exactly as two in-process time() calls
    // on that label would.
    process.env.PERF = '1';
    time('reports:shared', () => undefined);
    perfMerge([{ label: 'reports:shared', calls: 2, totalMs: 100, size: 5 }]);
    const row = perfSnapshot().find(r => r.label === 'reports:shared');
    expect(row?.calls).toBe(3);
    expect(row?.totalMs).toBeGreaterThanOrEqual(100);
    expect(row?.size).toBe(5);
  });

  it('EmptyRows_Merged_LeaveTheReportUnchanged', () => {
    // A worker that measured nothing (PERF off in the worker) posts an empty
    // snapshot; merging it is a no-op rather than an error.
    perfMerge([]);
    expect(perfSnapshot()).toHaveLength(0);
  });
});

describe('perfReport', { tags: ['unit'] }, () => {
  it('PerfReport_WhenDisabled_WritesNothingToStderr', () => {
    delete process.env.PERF;
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'result');
    perfReport();
    expect(write).not.toHaveBeenCalled();
  });

  it('PerfReport_WhenEnabledWithMeasurements_WritesSortedBreakdownToStderr', () => {
    process.env.PERF = '1';
    time('cheap', () => 'a');
    time('label-with-size', () => 'b', 158000);
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    perfReport();
    expect(write).toHaveBeenCalledTimes(1);
    const output = write.mock.calls[0][0] as string;
    expect(output).toContain('perf breakdown');
    expect(output).toContain('label-with-size');
    expect(output).toContain('cheap');
    expect(output).toContain('100.0%');
    // The size hint is rendered with thousands separators.
    expect(output).toContain('158,000');
  });

  it('PerfReport_WhenEnabledButNothingMeasured_WritesNothing', () => {
    process.env.PERF = '1';
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    perfReport();
    expect(write).not.toHaveBeenCalled();
  });

  it('PerfReport_WhenPerfIsGarbageValue_StillProfiles', () => {
    // The flag is presence-of-value, not a boolean: any non-empty PERF —
    // including a "falsy-looking" word — turns profiling on. This pins that
    // documented behaviour so a mistyped `PERF=false` is not silently a no-op.
    process.env.PERF = 'false';
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'result');
    perfReport();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

// The machine-readable JSON report (issue #354): a persistent, stable-shaped
// per-run record so profiling runs can be compared over time. File emission is
// doubly gated on PERF and PERF_JSON so the disabled path — and the
// PERF-on-without-PERF_JSON path — write nothing, leaving golden builds
// byte-identical.

describe('perfReportJson', { tags: ['unit'] }, () => {
  it('PerfReportJson_WhenMeasurementsTaken_ReturnsStableShapeSortedByTotal', () => {
    process.env.PERF = '1';
    time('cheap', () => 'a');
    time('parse:register', () => 'b', 158);
    const report = perfReportJson('build-sqlite');
    expect(report.schema).toBe(PERF_REPORT_SCHEMA);
    expect(report.entrypoint).toBe('build-sqlite');
    expect(report.node).toBe(process.version);
    expect(typeof report.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    // rows carry the same fields as the snapshot, sorted by total time desc.
    expect(report.rows.map(r => r.label).sort()).toEqual(['cheap', 'parse:register']);
    const totals = report.rows.map(r => r.totalMs);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(report.totalMs).toBeCloseTo(report.rows.reduce((s, r) => s + r.totalMs, 0));
    expect(report.rows.find(r => r.label === 'parse:register')?.size).toBe(158);
  });

  it('PerfReportJson_WhenNoEntrypointGiven_RecordsNull', () => {
    process.env.PERF = '1';
    time('label', () => 'a');
    expect(perfReportJson().entrypoint).toBeNull();
  });
});

describe('perfReport JSON emission', { tags: ['unit'] }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PerfReport_WhenPerfJsonSet_WritesReportFileWithStableFields', () => {
    process.env.PERF = '1';
    const dest = path.join(tmpDir, 'run.json');
    process.env.PERF_JSON = dest;
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('parse:register', () => 'a', 158);
    perfReport({ entrypoint: 'build-sqlite' });
    expect(fs.existsSync(dest)).toBe(true);
    const parsed = readReport(dest);
    expect(parsed.schema).toBe(PERF_REPORT_SCHEMA);
    expect(parsed.entrypoint).toBe('build-sqlite');
    expect(parsed.rows.find(r => r.label === 'parse:register')?.size).toBe(158);
  });

  it('PerfReport_WhenPerfOffButPerfJsonSet_WritesNoFile', () => {
    // The off path is provably inert: no report even if a destination is set.
    delete process.env.PERF;
    const dest = path.join(tmpDir, 'run.json');
    process.env.PERF_JSON = dest;
    time('label', () => 'a');
    perfReport({ entrypoint: 'build-sqlite' });
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('PerfReport_WhenPerfOnButNoPerfJson_WritesNoFileAndKeepsStderrBreakdown', () => {
    // The original stderr-only behaviour is preserved when PERF_JSON is unset,
    // so no build gains a new artefact and every golden stays byte-identical.
    process.env.PERF = '1';
    delete process.env.PERF_JSON;
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'a');
    perfReport({ entrypoint: 'build-sqlite' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('PerfReport_WhenPerfJsonEmptyString_WritesNoFile', () => {
    process.env.PERF = '1';
    process.env.PERF_JSON = '';
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'a');
    perfReport();
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('PerfReport_WhenWrittenTwice_OverwritesWithLatestRun', () => {
    process.env.PERF = '1';
    const dest = path.join(tmpDir, 'run.json');
    process.env.PERF_JSON = dest;
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('first', () => 'a');
    perfReport();
    perfReset();
    time('second', () => 'b');
    perfReport();
    const parsed = readReport(dest);
    expect(parsed.rows.map(r => r.label)).toEqual(['second']);
  });

  it('PerfReport_WhenSuccessful_LeavesNoTempFile', () => {
    process.env.PERF = '1';
    const dest = path.join(tmpDir, 'run.json');
    process.env.PERF_JSON = dest;
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'a');
    perfReport();
    expect(fs.readdirSync(tmpDir)).toEqual(['run.json']);
  });

  it('PerfReport_WhenDestinationUnwritable_ThrowsAfterStderrBreakdown', () => {
    // A blocking regular file where a directory is expected makes the write
    // fail on every platform. The failure is loud (a requested measurement is
    // never silently dropped) but only after the human breakdown is on screen.
    process.env.PERF = '1';
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    process.env.PERF_JSON = path.join(blocker, 'run.json');
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    time('label', () => 'a');
    expect(() => perfReport()).toThrow(/could not write the PERF_JSON report/);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
