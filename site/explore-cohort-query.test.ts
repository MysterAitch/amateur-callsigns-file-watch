import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';

// Test names follow Subject_Scenario_Outcome.
//
// The Explore page offers a cohort query over "the current register". It once
// named the register by date, so when the next publication landed the example
// went on reading the previous one while still calling it current. These tests
// take the query out of the page as a reader would copy it, run it over a
// small database built in the published schema's shape, and check that it
// follows the newest complete publication - complete in the site's own sense
// (site/app.js and site/compare.js: declared complete and no coverage-affecting
// observation) - as publications are added.

function pageDocument(): Document {
  return new JSDOM(fs.readFileSync(path.join('site', 'explore.html'), 'utf8')).window.document;
}

function cohortQueryFromPage(): string {
  const blocks = [...pageDocument().querySelectorAll('pre code')].map((el) => el.textContent ?? '');
  const cohort = blocks.filter((sql) => sql.includes('ref_forbidden_suffixes') && sql.includes('register_history'));
  expect(cohort, 'the forbidden-suffix cohort example on explore.html').toHaveLength(1);
  return cohort[0];
}

interface Publication {
  dataset: string;
  intendedComplete: 'true' | 'false' | '';
  coverageAffecting?: string;
  callsigns: string[];
}

// The columns the query reads, in the published combined database's tables.
function databaseHolding(publications: Publication[], inTheAugust2019Snapshot: string[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE history_datasets (dataset TEXT, record_count TEXT, intended_complete TEXT, scope_notes TEXT, coverage_affecting TEXT)');
  db.exec('CREATE TABLE register_history (dataset TEXT, callsign TEXT, cleaned TEXT, suffix TEXT, status TEXT, licence_version_original_start_date TEXT)');
  db.exec('CREATE TABLE ref_forbidden_suffixes (suffix TEXT)');
  db.exec('CREATE TABLE observations (entry TEXT, cleaned TEXT)');
  db.prepare('INSERT INTO ref_forbidden_suffixes VALUES (?)').run('QNF');
  for (const p of publications) {
    db.prepare('INSERT INTO history_datasets VALUES (?, ?, ?, ?, ?)').run(p.dataset, String(p.callsigns.length), p.intendedComplete, '', p.coverageAffecting ?? '');
    for (const callsign of p.callsigns) {
      db.prepare('INSERT INTO register_history VALUES (?, ?, ?, ?, ?, ?)').run(p.dataset, callsign, callsign, callsign.slice(-3), 'Allocated', '2020-01-01');
    }
  }
  for (const cleaned of inTheAugust2019Snapshot) {
    db.prepare('INSERT INTO observations VALUES (?, ?)').run('wdtk-596532--allocated-reserved-forbidden', cleaned);
  }
  return db;
}

function cohort(db: DatabaseSync): { dataset: string; callsign: string }[] {
  return db.prepare(cohortQueryFromPage()).all().map((row) => ({ dataset: String(row.dataset), callsign: String(row.callsign) }));
}

const JUNE: Publication = { dataset: '2026-06-23', intendedComplete: 'true', callsigns: ['G0QNF', 'G4ABC'] };
const SEPTEMBER: Publication = { dataset: '2026-09-22', intendedComplete: 'true', callsigns: ['M7QNF', 'G4ABC'] };

describe('Explore page - the current-register cohort example', { tags: ['unit'] }, () => {
  it('CohortExample_WhenSeptemberIsTheNewestPublication_ReadsSeptemberNotJune', () => {
    expect(cohort(databaseHolding([JUNE, SEPTEMBER], []))).toEqual([{ dataset: '2026-09-22', callsign: 'M7QNF' }]);
  });

  it('CohortExample_WhenALaterPublicationLands_FollowsItWithoutAnEdit', () => {
    const december: Publication = { dataset: '2026-12-15', intendedComplete: 'true', callsigns: ['2E0QNF'] };
    expect(cohort(databaseHolding([JUNE, SEPTEMBER, december], []))).toEqual([{ dataset: '2026-12-15', callsign: '2E0QNF' }]);
  });

  it('CohortExample_WhenTheNewestPublicationIsADeclaredTruncation_KeepsTheNewestCompleteOne', () => {
    // Ofcom has published 1,074-row truncations of a ~150k register; one of
    // those is not "the current register" even when it is the newest held.
    const truncated: Publication = { dataset: '2026-12-15', intendedComplete: 'false', callsigns: ['2E0QNF'] };
    expect(cohort(databaseHolding([JUNE, SEPTEMBER, truncated], []))).toEqual([{ dataset: '2026-09-22', callsign: 'M7QNF' }]);
  });

  it('CohortExample_WhenTheNewestPublicationCarriesACoverageAffectingObservation_KeepsTheNewestCompleteOne', () => {
    // 2025-06-04 declared itself complete but silently omitted ~45k records;
    // the site does not treat such a publication as complete, and nor does the
    // example.
    const filtered: Publication = { dataset: '2026-12-15', intendedComplete: 'true', coverageAffecting: 'blank-product rows omitted', callsigns: ['2E0QNF'] };
    expect(cohort(databaseHolding([JUNE, SEPTEMBER, filtered], []))).toEqual([{ dataset: '2026-09-22', callsign: 'M7QNF' }]);
  });

  it('CohortExample_WhenTheNewestPublicationDeclaresNoCoverage_KeepsTheNewestCompleteOne', () => {
    // Undeclared scope is not complete in the site's sense, so an undeclared
    // newest publication is passed over, as the timeline passes over its absences.
    const undeclared: Publication = { dataset: '2026-12-15', intendedComplete: '', callsigns: ['2E0QNF'] };
    expect(cohort(databaseHolding([JUNE, SEPTEMBER, undeclared], []))).toEqual([{ dataset: '2026-09-22', callsign: 'M7QNF' }]);
  });

  it('CohortExample_WhenNoPublicationIsComplete_ReturnsNoRowsAndThePageSaysWhatThatMeans', () => {
    const partial: Publication = { dataset: '2026-12-15', intendedComplete: 'false', callsigns: ['2E0QNF'] };
    expect(cohort(databaseHolding([partial], []))).toEqual([]);
    const prose = [...pageDocument().querySelectorAll('p')].map((p) => p.textContent ?? '').join(' ').replace(/\s+/g, ' ');
    expect(prose).toContain('An empty result means either that no held publication is complete in this sense, or that no forbidden-suffix callsign in it is missing from the August 2019 snapshot');
  });

  it('CohortExample_WhenTheCallsignWasAlreadyInTheAugust2019Snapshot_LeavesItOut', () => {
    expect(cohort(databaseHolding([JUNE, SEPTEMBER], ['M7QNF']))).toEqual([]);
  });

  it('CohortExample_OnThePage_NamesNoPublicationByDate', () => {
    expect(cohortQueryFromPage()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
