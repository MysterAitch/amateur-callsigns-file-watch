import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ARCHIVE_SCOPE_ENV, FROZEN_BASELINE_SCOPE } from '../shared/derived-entries.ts';
import { withFrozenBaselineArchive, withWholeArchive } from './frozen-baseline-archive.ts';

// The helpers every real-corpus test leans on to say which archive it reads.
// A helper that left the scope behind after a failure, or let pending work run
// under the wrong scope, would change another test's figures with no sign of
// why. Test names follow Subject_Scenario_Outcome.

describe('archive-scope test helpers', { tags: ['unit'] }, () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ARCHIVE_SCOPE_ENV];
    delete process.env[ARCHIVE_SCOPE_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ARCHIVE_SCOPE_ENV];
    else process.env[ARCHIVE_SCOPE_ENV] = saved;
  });

  it('FrozenBaselineHelper_DuringTheCallback_SetsTheScopeAndReturnsTheResult', () => {
    expect(withFrozenBaselineArchive(() => process.env[ARCHIVE_SCOPE_ENV])).toBe(FROZEN_BASELINE_SCOPE);
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBeUndefined();
  });

  it('FrozenBaselineHelper_WhenTheCallbackThrows_StillRestoresTheUnscopedState', () => {
    expect(() => withFrozenBaselineArchive(() => { throw new Error('fold failed'); })).toThrow('fold failed');
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBeUndefined();
  });

  it('WholeArchiveHelper_InsideAScopedRun_LiftsTheScopeThenRestoresIt', () => {
    process.env[ARCHIVE_SCOPE_ENV] = FROZEN_BASELINE_SCOPE;
    expect(withWholeArchive(() => process.env[ARCHIVE_SCOPE_ENV])).toBeUndefined();
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBe(FROZEN_BASELINE_SCOPE);
  });

  it('WholeArchiveHelper_WhenTheCallbackThrows_StillRestoresTheScope', () => {
    process.env[ARCHIVE_SCOPE_ENV] = FROZEN_BASELINE_SCOPE;
    expect(() => withWholeArchive(() => { throw new Error('fold failed'); })).toThrow('fold failed');
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBe(FROZEN_BASELINE_SCOPE);
  });

  it('FrozenBaselineHelper_GivenAsynchronousWork_RefusesRatherThanRestoreTooEarly', () => {
    expect(() => withFrozenBaselineArchive(() => Promise.resolve(1))).toThrow(/asynchronous work/);
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBeUndefined();
  });

  it('WholeArchiveHelper_GivenAsynchronousWork_RefusesRatherThanRestoreTooEarly', () => {
    process.env[ARCHIVE_SCOPE_ENV] = FROZEN_BASELINE_SCOPE;
    expect(() => withWholeArchive(() => Promise.resolve(1))).toThrow(/asynchronous work/);
    expect(process.env[ARCHIVE_SCOPE_ENV]).toBe(FROZEN_BASELINE_SCOPE);
  });
});
