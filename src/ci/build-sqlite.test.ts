import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fillObservations, openDataEntryCsvNames, openDataEntryCsvPath } from './build-sqlite.ts';
import { BUILDER_PROJECTION_DIR_ENV } from '../shared/derived-entries.ts';
import { type FoiObservationRow } from '../shared/foi-observations.ts';

// Issue #171: FOI observations are run through the same component parser and
// flag machinery as the open-data lane, so anomaly flags and the component
// decomposition span both lanes. Test names follow Subject_Scenario_Outcome.

function obs(callsign: string, values: Record<string, string | null> = {}, entry = 'e1'): FoiObservationRow {
  return { callsign, entry, sourceFile: 'snapshot.csv', datasetClasses: 'register-snapshot', vintage: '2019-08-12', values };
}

describe('FOI observations component enrichment', { tags: ['unit'] }, () => {
  const db = new DatabaseSync(':memory:');
  fillObservations(db, [
    obs('M7TEE', { licence_class: 'Amateur Foundation Radio Licence' }),
    obs('M6ABC', { licence_class: 'Amateur Full Radio Licence' }), // prefix says Foundation, class says Full
    obs('G0TQK '),                                            // trailing non-breaking space (U+00A0)
    obs('M/PT2FM', { licence_class: 'Amateur Temporary Reciprocal Radio Licence' }),
  ]);
  const get = (callsign: string): Record<string, string> =>
    db.prepare('SELECT prefix_series, rsl, placeholder_form, implied_class, parse_status, flags FROM observations WHERE callsign = ?').get(callsign) as Record<string, string>;

  it('Observations_RegisterSnapshotCallsign_GainsParsedComponents', () => {
    expect(get('M7TEE')).toMatchObject({ prefix_series: 'M7', implied_class: 'Foundation', parse_status: 'parsed', placeholder_form: 'M#7TEE' });
  });

  it('Observations_DisclosedClassDisagreesWithPrefix_FlagsMismatchViaLicenceClass', () => {
    // licence_class stands in for the open-data product column: M6 is
    // Foundation by prefix, but the disclosed class is Full.
    expect(get('M6ABC').flags.split(';')).toContain('class-product-mismatch');
  });

  it('Observations_WhitespaceDamagedCallsign_Flagged', () => {
    expect(get('G0TQK ').flags.split(';')).toContain('whitespace');
  });

  it('Observations_NoDisclosedClass_CannotFireMismatch', () => {
    // Per-schema: without a licence_class the class-product-mismatch flag
    // simply does not apply (never assumed universal).
    expect(get('G0TQK ').flags.split(';')).not.toContain('class-product-mismatch');
  });

  it('Observations_VisitorCallsign_ParsedAsVisitorWithPlaceholder', () => {
    expect(get('M/PT2FM')).toMatchObject({ parse_status: 'visitor', placeholder_form: 'M#/PT2FM' });
  });

  it('Observations_DisclosedClass_GainsNormalisedLicenceCategory', () => {
    // The disclosed licence_class collapses to a canonical category, queryable
    // beside the verbatim class; the reciprocals stay distinct; no disclosed
    // class yields NULL (not a forced category).
    const cat = (callsign: string): string | null =>
      (db.prepare('SELECT normalised_licence_category AS c FROM observations WHERE callsign = ?').get(callsign) as { c: string | null }).c;
    expect(cat('M7TEE')).toBe('Foundation');
    expect(cat('M6ABC')).toBe('Full');
    expect(cat('M/PT2FM')).toBe('Temporary Reciprocal');
    // The observation with no disclosed licence_class maps to NULL, not a forced category.
    const noClass = db.prepare('SELECT normalised_licence_category AS c FROM observations WHERE licence_class IS NULL').get() as { c: string | null };
    expect(noClass.c).toBeNull();
  });
});

// The download tiers' per-entry CSV enumeration (issue #629 phase 3): the
// archive listing unioned with the derived names present through the
// archive/projection switch, and per-name byte-source resolution. Exercised
// against a scratch corpus in both modes, so the seam build-sqlite.ts folds
// its download databases through is pinned without a whole-corpus build.
describe('Download-tier entry CSV enumeration', { tags: ['unit'] }, () => {
  let scratch: string;
  let archiveDir: string;
  let projectionDir: string;
  const KEY = '2099-01-01';
  const savedEnv = process.env[BUILDER_PROJECTION_DIR_ENV];

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tiers-enumeration-test-'));
    archiveDir = path.join(scratch, 'archive');
    projectionDir = path.join(scratch, 'projection');
    // The archive entry: a freshly landed publication - raw + meta only, no
    // committed derivatives - plus a non-CSV file that must never enumerate.
    fs.mkdirSync(path.join(archiveDir, KEY), { recursive: true });
    fs.writeFileSync(path.join(archiveDir, KEY, 'raw.csv'), 'Callsign\nM7TEE\n');
    fs.writeFileSync(path.join(archiveDir, KEY, 'meta.json'), '{}');
    // The projection: all three derived files for the entry.
    fs.mkdirSync(path.join(projectionDir, KEY), { recursive: true });
    fs.writeFileSync(path.join(projectionDir, KEY, 'normalised.csv'), 'callsign\nM7TEE\n');
    fs.writeFileSync(path.join(projectionDir, KEY, 'components.csv'), 'callsign\nM7TEE\n');
    fs.writeFileSync(path.join(projectionDir, KEY, 'stats.json'), '{}');
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[BUILDER_PROJECTION_DIR_ENV];
    else process.env[BUILDER_PROJECTION_DIR_ENV] = savedEnv;
  });

  it('TiersEnumeration_ArchiveModeFreshEntry_ListsCommittedCsvsOnly', () => {
    delete process.env[BUILDER_PROJECTION_DIR_ENV];
    expect(openDataEntryCsvNames(KEY, archiveDir)).toEqual(['raw.csv']);
    expect(openDataEntryCsvPath(KEY, 'raw.csv', archiveDir)).toBe(path.join(archiveDir, KEY, 'raw.csv'));
  });

  it('TiersEnumeration_ProjectionModeFreshEntry_UnionsInTheProjectedDerivedCsvs', () => {
    process.env[BUILDER_PROJECTION_DIR_ENV] = projectionDir;
    // stats.json is derived but not CSV, so the union adds the two CSVs only.
    expect(openDataEntryCsvNames(KEY, archiveDir)).toEqual(['components.csv', 'normalised.csv', 'raw.csv']);
    // Derived bytes come from the projection; raw stays the committed archive.
    expect(openDataEntryCsvPath(KEY, 'normalised.csv', archiveDir)).toBe(path.join(projectionDir, KEY, 'normalised.csv'));
    expect(openDataEntryCsvPath(KEY, 'raw.csv', archiveDir)).toBe(path.join(archiveDir, KEY, 'raw.csv'));
  });

  it('TiersEnumeration_ProjectionModeEntryAbsentFromProjection_ListsCommittedCsvsOnly', () => {
    // A raw-only source with no authored binding folds nothing: absence of a
    // projected entry is an answer here (the tiers ship what exists), not a
    // wiring failure - that distinction belongs to derivedEntryFile reads.
    process.env[BUILDER_PROJECTION_DIR_ENV] = projectionDir;
    fs.mkdirSync(path.join(archiveDir, '2099-06-01'), { recursive: true });
    fs.writeFileSync(path.join(archiveDir, '2099-06-01', 'raw.csv'), 'Callsign\nM7TEE\n');
    expect(openDataEntryCsvNames('2099-06-01', archiveDir)).toEqual(['raw.csv']);
  });
});
