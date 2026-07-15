import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqlite, fillObservations } from './build-sqlite.ts';
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

// The published lookup database (callsigns.sqlite.png) is a range-queried
// artefact: the in-browser lookup opens it directly, so every table it ships
// costs download bytes and every table the site queries must be present. This
// guard locks the shipped table set to exactly what the site consumes -
// site/app.js joins normalised/components and reads build_info, itu_series,
// flag_registry and the ref_* meanings; site/explore.js additionally queries
// the precomputed rsl_matrix. A drift either way (a query with no table, or a
// dead table nobody reads) fails here rather than silently on the deploy.
describe('published lookup database', { tags: ['unit'] }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-sqlite-guard-'));
  const dbPath = path.join(dir, 'callsigns.sqlite');
  buildSqlite(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map(r => r.name);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  it('LookupDatabase_WhenBuilt_ShipsExactlyTheTablesTheSiteQueries', () => {
    // The union of the tables site/app.js and site/explore.js query against
    // callsigns.sqlite.png; nothing more (dead weight) and nothing less.
    expect(tables).toEqual([
      'build_info',
      'components',
      'flag_registry',
      'itu_series',
      'normalised',
      'ref_forbidden_suffixes',
      'ref_prefix_formats',
      'ref_rsl',
      'rsl_matrix',
    ]);
  });

  it('LookupDatabase_WhenBuilt_OmitsTablesRetiredToTheLedgerFold', () => {
    // The per-publication statistics pivot now folds from stats.json, and the
    // matrix elaborations / special-format reference had no site consumer, so
    // these no longer ship (issue #445).
    for (const retired of ['datasets', 'stats_flags', 'stats_statuses', 'stats_patterns', 'ref_special_formats', 'matrix_excluded', 'excluded_examples', 'rsl_bearing']) {
      expect(tables).not.toContain(retired);
    }
  });
});
