import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describeShape, isPlainObject, parseJsonObject } from '../shared/json-shape.ts';
import { SWEEP_TRACE_FILE_ENV, traceSweepEvent, traceSweepTask } from './sweep-trace.ts';

// The streaming diagnostic trace (issue #991). Its whole reason to exist is
// surviving a run that DIES, so the properties under test are: every event is
// on disk the moment it happens (not buffered to the end), a failing task still
// records what it was doing, and nothing here can itself break the run being
// diagnosed. Test names follow Subject_Scenario_Outcome.

const created: string[] = [];

function traceFile(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-trace-')), 'trace.jsonl');
  created.push(file);
  process.env[SWEEP_TRACE_FILE_ENV] = file;
  return file;
}

function linesOf(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trimEnd().split('\n').filter(l => l !== '')
    .map((line, index) => {
      const parsed: unknown = parseJsonObject(line, `${file}#${index}`);
      if (!isPlainObject(parsed)) throw new Error(`trace line ${index} is not an object: ${describeShape(parsed)}`);
      return parsed as Record<string, unknown>;
    });
}

afterEach(() => {
  delete process.env[SWEEP_TRACE_FILE_ENV];
  for (const file of created.splice(0)) fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

describe('sweep trace — a run that dies still explains itself', { tags: ['unit'] }, () => {
  it('TraceSweepEvent_AfterEachEvent_TheLineIsAlreadyOnDiskRatherThanBuffered', () => {
    // The property the whole design rests on: a killed process cannot flush, so
    // anything still in a buffer is lost. Reading the file BETWEEN events is
    // what proves the write already happened.
    const file = traceFile();
    traceSweepEvent('first');
    expect(linesOf(file).map(l => l.event)).toEqual(['first']);
    traceSweepEvent('second');
    expect(linesOf(file).map(l => l.event)).toEqual(['first', 'second']);
  });

  it('TraceSweepEvent_EveryEvent_CarriesTheMemoryAndLoadSnapshotNeededToReconstructTheRun', () => {
    // Recorded per event, not only at failure: a steady squeeze and a sudden
    // spike need different fixes, and only the trajectory tells them apart.
    const file = traceFile();
    traceSweepEvent('sample', { id: 'x' });
    const [line] = linesOf(file);
    for (const field of ['at', 'event', 'id', 'pid', 'thread', 'rssMb', 'heapUsedMb', 'sysFreeMb', 'sysTotalMb', 'loadAvg']) {
      expect(line, `missing ${field}`).toHaveProperty(field);
    }
  });

  it('TraceSweepTask_WhenTheTaskThrows_TheFailureIsRecordedAndTheErrorStillPropagates', async () => {
    // A diagnostic that swallows the failure it records would be worse than none.
    const file = traceFile();
    await expect(traceSweepTask('doomed', () => Promise.reject(new Error('fold exploded'))))
      .rejects.toThrow('fold exploded');
    const events = linesOf(file);
    expect(events.map(l => l.event)).toEqual(['task-start', 'task-end']);
    expect(events[1].outcome).toBe('failed');
    expect(events[1].error).toContain('fold exploded');
    expect(events[1].id).toBe('doomed');
  });

  it('TraceSweepTask_WhenTheTaskSucceeds_TheEndEventCarriesItsDuration', async () => {
    const file = traceFile();
    await expect(traceSweepTask('fine', () => Promise.resolve('value'))).resolves.toBe('value');
    const events = linesOf(file);
    expect(events[1].outcome).toBe('ok');
    expect(typeof events[1].ms).toBe('number');
  });

  it('TraceSweepEvent_WhenTheTraceFileIsUnwritable_TheRunIsUnaffected', () => {
    // Diagnostics must never become the reason a build fails.
    process.env[SWEEP_TRACE_FILE_ENV] = path.join(os.tmpdir(), 'no-such-dir-991', 'nested', 'trace.jsonl');
    expect(() => traceSweepEvent('into-the-void')).not.toThrow();
  });

  it('TraceSweepEvent_WhenNoTraceFileIsConfigured_NothingIsWrittenAnywhere', () => {
    // Inert by default: the sweep runs unchanged outside CI.
    delete process.env[SWEEP_TRACE_FILE_ENV];
    expect(() => traceSweepEvent('ignored')).not.toThrow();
  });

  it('TraceSweepEvent_WhenAValueCannotBeSerialised_TheRunIsStillUnaffected', () => {
    // Field values come from call sites and error objects, so a circular or
    // exotic value must not turn a diagnostic into a second failure.
    const file = traceFile();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => traceSweepEvent('circular', { circular })).not.toThrow();
    // The bad line is dropped rather than corrupting the file for later events.
    traceSweepEvent('after');
    expect(linesOf(file).map(l => l.event)).toEqual(['after']);
  });
});
