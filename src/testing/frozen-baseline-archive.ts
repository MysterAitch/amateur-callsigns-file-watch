/**
 * Scopes a test file to the frozen committed baseline (ADR 0021).
 *
 * A test that runs a builder over the real archive WITHOUT a projection reads
 * derived files from the committed archive, which stop at the freeze.
 * Such a test calls this once, at the top of the file, and from then on
 * asserts over the baseline entries by name rather than over "whatever the
 * archive holds today" - so a new publication cannot change its answer.
 *
 * Under the scope a figure covers the frozen-baseline open-data entries plus
 * the whole FOI lane, which is not narrowed. A comparison with a committed
 * report is the exception: reports cover everything held, so that one fold
 * is made unscoped.
 *
 * What the scope does and refuses is stated where it is enforced:
 * scopeArchiveKeys in src/shared/derived-entries.ts.
 */

import { afterAll } from 'vitest';
import { ARCHIVE_SCOPE_ENV, FROZEN_BASELINE_KEYS, FROZEN_BASELINE_SCOPE } from '../shared/derived-entries.ts';

// The newest baseline entry - what "the newest publication" means to a test
// scoped by pinArchiveToFrozenBaseline.
export const FROZEN_BASELINE_NEWEST_KEY = FROZEN_BASELINE_KEYS[FROZEN_BASELINE_KEYS.length - 1];

// The scope is restored the moment the callback returns, so work that is
// still pending then would run under the wrong one without any sign of it.
function refusingAPromise<T>(result: T): T {
  if (result instanceof Promise) {
    throw new Error('an archive-scope helper was given asynchronous work - the scope is restored before it would settle; do the scoped read synchronously');
  }
  return result;
}

// Runs one synchronous computation under the scope and restores what was
// there before - for a file that needs both views: its ground-truth figures
// over the baseline, and its committed-report comparison over everything.
export function withFrozenBaselineArchive<T>(run: () => T): T {
  const previous = process.env[ARCHIVE_SCOPE_ENV];
  process.env[ARCHIVE_SCOPE_ENV] = FROZEN_BASELINE_SCOPE;
  try {
    return refusingAPromise(run());
  } finally {
    if (previous === undefined) delete process.env[ARCHIVE_SCOPE_ENV];
    else process.env[ARCHIVE_SCOPE_ENV] = previous;
  }
}

// The inverse, for a file pinned to the baseline as a whole: runs one
// synchronous computation over everything held (its committed-report
// comparison), then restores the pin.
export function withWholeArchive<T>(run: () => T): T {
  const previous = process.env[ARCHIVE_SCOPE_ENV];
  delete process.env[ARCHIVE_SCOPE_ENV];
  try {
    return refusingAPromise(run());
  } finally {
    if (previous !== undefined) process.env[ARCHIVE_SCOPE_ENV] = previous;
  }
}

// Call at module top level, before any builder runs: several real-archive
// tests invoke their builder while the file is still being collected.
export function pinArchiveToFrozenBaseline(): void {
  const previous = process.env[ARCHIVE_SCOPE_ENV];
  process.env[ARCHIVE_SCOPE_ENV] = FROZEN_BASELINE_SCOPE;
  afterAll(() => {
    if (previous === undefined) delete process.env[ARCHIVE_SCOPE_ENV];
    else process.env[ARCHIVE_SCOPE_ENV] = previous;
  });
}
