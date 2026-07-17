import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BUILDER_PROJECTION_DIR_ENV,
  DERIVED_ENTRY_FILES,
  derivedEntriesMode,
  derivedEntryDir,
  derivedEntryFile,
  derivedEntryFileExists,
  isDerivedEntryFile,
} from './derived-entries.ts';
import { DIRS } from './constants.ts';

// The derived-entry switch (issue #629 phase 2): with BUILDER_PROJECTION_DIR
// unset every read resolves to the committed archive exactly as before the
// switch existed; with it set, reads resolve into the projection and a missing
// projection (or a missing file within it) fails loudly - the mode is always
// explicit and never silently wrong.

const KEY = '2026-01-01';

let scratch: string;
let savedEnv: string | undefined;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'derived-entries-'));
  savedEnv = process.env[BUILDER_PROJECTION_DIR_ENV];
  delete process.env[BUILDER_PROJECTION_DIR_ENV];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[BUILDER_PROJECTION_DIR_ENV];
  else process.env[BUILDER_PROJECTION_DIR_ENV] = savedEnv;
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeProjectionEntry(root: string, key: string, names: readonly string[] = DERIVED_ENTRY_FILES): void {
  fs.mkdirSync(path.join(root, key), { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(root, key, name), `${name} content\n`);
}

describe('derived-entries switch', { tags: ['unit'] }, () => {
  it('Mode_WhenEnvUnset_IsArchive_AndPathsResolveToTheCommittedArchive', () => {
    expect(derivedEntriesMode()).toBe('archive');
    expect(derivedEntryDir(KEY)).toBe(path.join(DIRS.archive, KEY));
    expect(derivedEntryFile(KEY, 'normalised.csv')).toBe(path.join(DIRS.archive, KEY, 'normalised.csv'));
  });

  it('Mode_WhenEnvSetToBlank_IsArchive_NotAHalfConfiguredProjection', () => {
    process.env[BUILDER_PROJECTION_DIR_ENV] = '   ';
    expect(derivedEntriesMode()).toBe('archive');
    expect(derivedEntryDir(KEY)).toBe(path.join(DIRS.archive, KEY));
  });

  it('ArchiveMode_WithCustomArchiveDir_ResolvesUnderThatBase', () => {
    const base = path.join(scratch, 'my-archive');
    expect(derivedEntryFile(KEY, 'stats.json', base)).toBe(path.join(base, KEY, 'stats.json'));
  });

  it('ArchiveMode_FileAbsent_ReturnsThePathWithoutThrowing_PreservingConsumerAbsenceHandling', () => {
    // Consumers own absent-file handling in archive mode (deliberate presence
    // checks, or ENOENT at read time) - the resolver itself never throws there.
    const base = path.join(scratch, 'empty-archive');
    expect(() => derivedEntryFile(KEY, 'normalised.csv', base)).not.toThrow();
    expect(derivedEntryFileExists(KEY, 'normalised.csv', base)).toBe(false);
  });

  it('ProjectionMode_EntryProjected_ResolvesIntoTheProjection_IgnoringAnyArchiveBase', () => {
    const root = path.join(scratch, 'projection');
    writeProjectionEntry(root, KEY);
    process.env[BUILDER_PROJECTION_DIR_ENV] = root;
    expect(derivedEntriesMode()).toBe('projection');
    for (const name of DERIVED_ENTRY_FILES) {
      // The archiveDir argument customises archive mode only - one projection
      // serves every caller convention.
      expect(derivedEntryFile(KEY, name, path.join(scratch, 'unused-archive'))).toBe(path.join(root, KEY, name));
      expect(derivedEntryFileExists(KEY, name)).toBe(true);
    }
  });

  it('ProjectionMode_RootMissing_FailsLoud_NeverSilentlyFallsBackToTheArchive', () => {
    process.env[BUILDER_PROJECTION_DIR_ENV] = path.join(scratch, 'never-built');
    expect(() => derivedEntryDir(KEY)).toThrow(/does not name an existing directory/);
    expect(() => derivedEntryFile(KEY, 'normalised.csv')).toThrow(/does not name an existing directory/);
    // Even the presence check refuses to answer over a missing projection - a
    // wiring error must not read as "nothing is derived".
    expect(() => derivedEntryFileExists(KEY, 'normalised.csv')).toThrow(/does not name an existing directory/);
  });

  it('ProjectionMode_FileMissingFromAProjectedEntry_FailsLoudAsAnIntegrityFailure', () => {
    const root = path.join(scratch, 'projection');
    writeProjectionEntry(root, KEY, ['normalised.csv', 'components.csv']); // stats.json deliberately absent
    process.env[BUILDER_PROJECTION_DIR_ENV] = root;
    expect(() => derivedEntryFile(KEY, 'stats.json')).toThrow(/integrity failure/);
    // The presence check stays a question, not an assertion - the data-status
    // grid reports honestly on what the projection materialised.
    expect(derivedEntryFileExists(KEY, 'stats.json')).toBe(false);
  });

  it('DerivedFileNames_CoverExactlyTheThreeProjectedFiles', () => {
    expect([...DERIVED_ENTRY_FILES]).toEqual(['normalised.csv', 'components.csv', 'stats.json']);
    for (const name of DERIVED_ENTRY_FILES) expect(isDerivedEntryFile(name)).toBe(true);
    for (const name of ['meta.json', 'raw.csv', 'raw.xlsx', 'raw-extract.csv', 'normalised--sheet-1.csv']) {
      expect(isDerivedEntryFile(name), `${name} must stay an archive read`).toBe(false);
    }
  });
});
