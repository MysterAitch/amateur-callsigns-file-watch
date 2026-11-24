/**
 * Where an open-data entry's DERIVED files are read from (issue #629 phase 2).
 *
 * Every deploy-time builder and the validator read three derived files per
 * open-data publication - normalised.csv, components.csv, stats.json. Those
 * files exist in two byte-identical places:
 *
 *  - the committed archive (archive/<key>/...), written by the normalise
 *    sweep - the historical home, still the source of record until the
 *    #446 -> #447 -> #448 retirement chain lands;
 *  - the builder-facing ledger projection (build-builder-projection.ts),
 *    folded from the claim ledger at build time and proven byte-identical
 *    to the committed files by the full-corpus parity gate
 *    (builder-projection-parity.test.ts).
 *
 * This module is the single switch between them. The mode is EXPLICIT, never
 * guessed: setting BUILDER_PROJECTION_DIR selects the projection and makes a
 * missing projection file a loud integrity failure (the projection
 * materialises all three files for every entry it folds, so absence there
 * means the projection was not built, points at the wrong directory, or
 * dropped an entry - never a state to silently paper over by falling back to
 * the archive). Leaving it unset selects the committed archive with exactly
 * the pre-existing read semantics, so local runs and the test estate behave
 * as before the switch existed.
 *
 * Deliberately NOT routed through here: meta.json, raw.* and extract files
 * (curated inputs, not derivations - always archive reads), and the FOI
 * lane's normalised--*.csv (needs the FOI reconstruction tiers; the
 * #445/#447 chain).
 */

import * as fs from 'fs';
import * as path from 'path';
import { DIRS } from './constants.ts';

// The derived per-entry files the projection materialises and the consumers
// read - identical names in both homes, so the switch is a directory change.
export const DERIVED_ENTRY_FILES = ['normalised.csv', 'components.csv', 'stats.json'] as const;
export type DerivedEntryFileName = (typeof DERIVED_ENTRY_FILES)[number];

export function isDerivedEntryFile(name: string): name is DerivedEntryFileName {
  return (DERIVED_ENTRY_FILES as readonly string[]).includes(name);
}

// The environment switch. Set by the deploy (cicd.yaml) to the directory
// build-builder-projection.ts wrote; never set by the scheduled sweep lane or
// the default test environment.
export const BUILDER_PROJECTION_DIR_ENV = 'BUILDER_PROJECTION_DIR';

export type DerivedEntriesMode = 'projection' | 'archive';

export function derivedEntriesMode(): DerivedEntriesMode {
  const dir = process.env[BUILDER_PROJECTION_DIR_ENV];
  return dir !== undefined && dir.trim() !== '' ? 'projection' : 'archive';
}

// The frozen committed baseline (ADR 0021), pinned entry by entry: every dated
// publication whose derived files were committed before the derivation lane
// retired. A publication landing after the freeze never joins this list.
export const FROZEN_BASELINE_KEYS = [
  '2022-05-30',
  '2023-02-20',
  '2025-04-08',
  '2025-05-27',
  '2025-06-04',
  '2025-06-08',
  '2025-11-11',
  '2026-01-14',
  '2026-06-23',
] as const;

// An explicit narrowing of which archive entries a run enumerates.
// It exists for tests that read derived files from the committed archive:
// those files stop at the frozen baseline, so such a test must say that the
// baseline is what it is asserting over, rather than take "every entry" and
// break on the first publication after the freeze.
// That is what happened on 22 September 2026, when 17 fast tests and several
// corpus tests read derived files for an entry that by design has none.
// Unset means every entry. It is never set by a build or a deploy.
export const ARCHIVE_SCOPE_ENV = 'ARCHIVE_SCOPE';
export const FROZEN_BASELINE_SCOPE = 'frozen-baseline';

// The variable the test runner sets in every process it starts.
const TEST_RUN_MARKER_ENV = 'VITEST';

// Applies the scope to a list of archive keys, preserving order.
// Refuses an unrecognised value, so a typo cannot read as "no scope".
// Refuses any scope outside a test run: a scoped fetch would not recognise a
// publication it already holds, and a scoped build would publish a site with
// its newest publication silently missing. Every entry point loads .env from
// the working directory, so the variable can arrive by a route no scan of the
// workflows sees; the refusal is here, where the scope is read.
export function scopeArchiveKeys(keys: readonly string[]): string[] {
  const scope = process.env[ARCHIVE_SCOPE_ENV];
  if (scope === undefined || scope === '') return [...keys];
  if (scope !== FROZEN_BASELINE_SCOPE) {
    throw new Error(`${ARCHIVE_SCOPE_ENV}=${JSON.stringify(scope)} is not a recognised scope - the only one is "${FROZEN_BASELINE_SCOPE}"`);
  }
  const testRun = process.env[TEST_RUN_MARKER_ENV];
  if (testRun === undefined || testRun === '') {
    throw new Error(`${ARCHIVE_SCOPE_ENV} is set, and it is honoured only inside a test run - unset it (check the shell and any .env file) so that every publication is seen`);
  }
  const baseline: ReadonlySet<string> = new Set(FROZEN_BASELINE_KEYS);
  return keys.filter(key => baseline.has(key));
}

// The projection root, validated to exist: an env var pointing at nothing is
// a wiring error (projection never built, or built elsewhere) and must fail
// the build loudly rather than let every entry read as absent.
function projectionRoot(): string {
  const dir = process.env[BUILDER_PROJECTION_DIR_ENV];
  if (dir === undefined || dir.trim() === '') {
    throw new Error(`${BUILDER_PROJECTION_DIR_ENV} is not set - projectionRoot() must only be called in projection mode`);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${BUILDER_PROJECTION_DIR_ENV}=${dir} does not name an existing directory - build it first (node src/v2/build-builder-projection.ts) or unset the variable to read the committed archive`);
  }
  return dir;
}

// The directory an entry's derived files are read from in the current mode.
// archiveDir customises the ARCHIVE-mode base only (some consumers resolve
// the archive absolutely, others relative to the working directory); in
// projection mode there is exactly one projection, wherever the caller's
// archive lives.
export function derivedEntryDir(key: string, archiveDir: string = DIRS.archive): string {
  return derivedEntriesMode() === 'projection'
    ? path.join(projectionRoot(), key)
    : path.join(archiveDir, key);
}

// The path a derived file is read from. Projection mode verifies the file
// exists and fails loudly when it does not (see the module comment); archive
// mode returns the committed path unchecked, preserving each consumer's
// existing absent-file handling (deliberate presence checks, or a plain
// ENOENT at read time).
export function derivedEntryFile(key: string, name: DerivedEntryFileName, archiveDir: string = DIRS.archive): string {
  const filePath = path.join(derivedEntryDir(key, archiveDir), name);
  if (derivedEntriesMode() === 'projection' && !fs.existsSync(filePath)) {
    throw new Error(`${filePath} is missing from the builder projection (${BUILDER_PROJECTION_DIR_ENV}) - the projection materialises all of ${DERIVED_ENTRY_FILES.join(', ')} for every entry it folds, so this is an integrity failure, not a fall-back-to-archive condition`);
  }
  return filePath;
}

// Whether a derived file exists in the current mode - for the consumers whose
// job is to REPORT presence (the data-status coverage grid) or to skip
// legitimately underived entries, where absence is an answer rather than an
// error. Projection mode still validates the projection root itself, so a
// missing projection reads as a loud wiring failure, never as "nothing is
// derived".
export function derivedEntryFileExists(key: string, name: DerivedEntryFileName, archiveDir: string = DIRS.archive): boolean {
  return fs.existsSync(path.join(derivedEntryDir(key, archiveDir), name));
}

// The derived file names one entry carries in the current mode - the single
// source of the "union the archive listing with what the switch resolves"
// rule the enumerating consumers (the download tiers, the published per-entry
// copies and zips) share. In archive mode these ARE committed names, so a
// union with a directory listing is a no-op; in projection mode they surface
// derived files an entry carries only in the projection (a publication newer
// than the frozen committed baseline).
export function derivedEntryFileNamesPresent(key: string, archiveDir: string = DIRS.archive): DerivedEntryFileName[] {
  return DERIVED_ENTRY_FILES.filter(name => derivedEntryFileExists(key, name, archiveDir));
}
