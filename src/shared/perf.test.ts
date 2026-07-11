import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { time, timeAsync, perfReport, perfReset, perfSnapshot } from './perf.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The perf harness (issue #354) is a flag-gated, permanent profiling aid: it
// must be a true pass-through when PERF is unset (no timestamp taken, no
// output, no change to what the wrapped function returns) and accumulate
// per-label call counts and total time when set. These tests pin both regimes.

const originalPerf = process.env.PERF;

beforeEach(() => {
  perfReset();
});

afterEach(() => {
  if (originalPerf === undefined) delete process.env.PERF;
  else process.env.PERF = originalPerf;
  vi.restoreAllMocks();
});

describe('time', () => {
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

describe('timeAsync', () => {
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

describe('perfReport', () => {
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
});
