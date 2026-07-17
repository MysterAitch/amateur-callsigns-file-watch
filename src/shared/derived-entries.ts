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
import { CONSTANTS } from './utils.ts';

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
export function derivedEntryDir(key: string, archiveDir: string = CONSTANTS.DIRS.archive): string {
  return derivedEntriesMode() === 'projection'
    ? path.join(projectionRoot(), key)
    : path.join(archiveDir, key);
}

// The path a derived file is read from. Projection mode verifies the file
// exists and fails loudly when it does not (see the module comment); archive
// mode returns the committed path unchecked, preserving each consumer's
// existing absent-file handling (deliberate presence checks, or a plain
// ENOENT at read time).
export function derivedEntryFile(key: string, name: DerivedEntryFileName, archiveDir: string = CONSTANTS.DIRS.archive): string {
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
export function derivedEntryFileExists(key: string, name: DerivedEntryFileName, archiveDir: string = CONSTANTS.DIRS.archive): boolean {
  return fs.existsSync(path.join(derivedEntryDir(key, archiveDir), name));
}
