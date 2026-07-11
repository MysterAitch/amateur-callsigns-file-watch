import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitClaims,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
} from './claim.ts';
import { buildLedger } from './build-ledger.ts';
import { parseClaimsJsonl } from './serialise.ts';
import {
  collectStatisticsSources,
  statisticsEntries,
  STATISTICS_AGGREGATE_CLASS,
} from './collectors/statistics.ts';
import { qualifyingRegisterEntries } from './collectors/foi-register.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the statistics-aggregate family (issue #361): a
// response-letter PDF transcribed to a committed markdown table discloses
// annual counts of licences ISSUED per financial year. The subject is the
// reporting PERIOD (a period is not a radio identity), so the ledger must emit
// the period existence and the count attributes as RAW claims only - verbatim,
// thousands separators intact - and NEVER attach a callsign normalisation edge
// or a licence-category tier.

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();

// The sole statistics-aggregate entry held today. Named by its ENTRY key only -
// the raw extract file and the column bindings are read from the authored
// converter binding, never hard-coded here.
const STATISTICS_ENTRY = 'wdtk-184767--annual-licence-counts';

// The period label and counts of the letter's first financial year, verbatim
// from the raw markdown extract - the en-dash and the thousands separators are
// the published form and must survive into the ledger unchanged.
const FIRST_PERIOD = '2003–2004';
const FIRST_AMATEUR_COUNT = '29,190';
const FIRST_BUSINESS_COUNT = '6,371';

const PERIOD_COLUMN = 'period';
const AMATEUR_PREDICATE = 'amateur_radio_licences_issued';
const BUSINESS_PREDICATE = 'business_radio_licences_issued';

function statisticsSource() {
  const sources = collectStatisticsSources(FOI_DIR).filter(source => source.entry === STATISTICS_ENTRY);
  expect(sources.length).toBe(1);
  return sources[0];
}

describe('statistics-aggregate family: raw period + count claims, verbatim, no callsign edges', () => {
  it('AggregateSource_WhenLoaded_CarriesPeriodSubjectAndVerbatimCountsUnderOutputNames', () => {
    const observationSet = statisticsSource().load();

    // The subject is the period; the count columns are relabelled to the
    // converter's OUTPUT names so the predicates are self-describing.
    expect(observationSet.subjectColumn).toBe(PERIOD_COLUMN);
    expect(observationSet.columns).toEqual([PERIOD_COLUMN, AMATEUR_PREDICATE, BUSINESS_PREDICATE]);
    expect(observationSet.sourceFile).toBe(`foi/${STATISTICS_ENTRY}/raw-extract-number-of-licences-coleman.md`);

    // One row per financial year (2003/04 to 2012/13), source order preserved.
    expect(observationSet.rows.length).toBe(10);

    // Values travel VERBATIM as the markdown-table parser returns them: the
    // en-dash in the period label and the thousands separators in the counts
    // are the published form, NOT the separator-stripped normalised CSV.
    const first = observationSet.rows[0];
    expect(first[PERIOD_COLUMN]).toBe(FIRST_PERIOD);
    expect(first[AMATEUR_PREDICATE]).toBe(FIRST_AMATEUR_COUNT);
    expect(first[BUSINESS_PREDICATE]).toBe(FIRST_BUSINESS_COUNT);
  });

  it('AggregateClaims_WhenEmitted_AreRawExistenceAndCountsWithNoDerivedEdges', () => {
    const observationSet = statisticsSource().load();
    const claims = emitClaims(observationSet);

    // Every claim is raw - the aggregate family never derives (no callsign
    // normalises_to edge, no licence_category tier): a period is not a callsign
    // and a count is not a licence class.
    expect(claims.every(claim => claim.layer === 'raw')).toBe(true);
    expect(claims.some(claim => claim.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
    expect(claims.some(claim => claim.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);

    // One @listed existence claim per period, carrying the period label
    // verbatim as its raw subject.
    const listed = claims.filter(claim => claim.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(10);
    expect(listed.map(claim => claim.rawSubject)).toContain(FIRST_PERIOD);

    // The two count columns emit one attribute claim each per period, keyed to
    // the period, carrying the figure verbatim (separators intact).
    const amateur = claims.filter(claim => claim.predicate === AMATEUR_PREDICATE);
    const business = claims.filter(claim => claim.predicate === BUSINESS_PREDICATE);
    expect(amateur.length).toBe(10);
    expect(business.length).toBe(10);

    const firstAmateur = amateur.find(claim => claim.rawSubject === FIRST_PERIOD);
    const firstBusiness = business.find(claim => claim.rawSubject === FIRST_PERIOD);
    expect(firstAmateur?.object).toBe(FIRST_AMATEUR_COUNT);
    expect(firstBusiness?.object).toBe(FIRST_BUSINESS_COUNT);

    // 10 rows x (1 existence + 2 counts) = 30 raw claims, nothing else.
    expect(claims.length).toBe(30);
  });

  it('AggregateEntry_WhenBuiltThroughBuildLedger_EmitsRawOnlyJsonlWithNoCallsignEdges', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-statistics-'));
    try {
      // Build ONLY this entry via the shared pipeline, proving the aggregate
      // subjectKind routes buildLedger through the raw-only emit path.
      const summary = buildLedger(outputDir, FOI_DIR, REF, entry => entry === STATISTICS_ENTRY);

      expect(summary.sourcesProcessed).toBe(1);
      const perSource = summary.perSource[0];
      expect(perSource.family).toBe('statistics-aggregate');
      expect(perSource.observations).toBe(10);
      expect(perSource.rawClaims).toBe(30);
      // The honesty guarantee: an aggregate source acquires NO derived claims.
      expect(perSource.derivedClaims).toBe(0);
      expect(summary.totalDerivedClaims).toBe(0);

      // The JSONL landed on disk and folds back to the same raw claims.
      const stem = statisticsSource().jsonlStem;
      const jsonl = fs.readFileSync(path.join(outputDir, 'ledger', `${stem}.jsonl`), 'utf8');
      const claims = parseClaimsJsonl(jsonl);
      expect(claims.length).toBe(30);
      expect(claims.every(claim => claim.layer === 'raw')).toBe(true);
      expect(claims.some(claim => claim.predicate === NORMALISES_TO_PREDICATE)).toBe(false);

      const firstAmateur = claims.find(claim => claim.predicate === AMATEUR_PREDICATE && claim.rawSubject === FIRST_PERIOD);
      expect(firstAmateur?.object).toBe(FIRST_AMATEUR_COUNT);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('StatisticsFamily_WhenDiscovered_IsDatasetClassDrivenAndDisjointFromRegister', () => {
    // The family is discovered from the archive's datasetClasses, not a
    // hard-coded list, so a newly-classed aggregate entry is covered
    // automatically. Every discovered entry carries the statistics-aggregate
    // class and resolves to at least one source.
    const entries = statisticsEntries(FOI_DIR);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const { meta } of entries) {
      expect(meta.datasetClasses).toContain(STATISTICS_AGGREGATE_CLASS);
    }

    const sources = collectStatisticsSources(FOI_DIR);
    expect(sources.length).toBeGreaterThanOrEqual(1);
    for (const source of sources) {
      expect(source.family).toBe('statistics-aggregate');
      expect(source.subjectKind).toBe('aggregate');
      expect(source.load().rows.length).toBeGreaterThan(0);
    }

    // Disjoint from the register family: no statistics-aggregate entry is also
    // a qualifying register entry (EXCLUDED_CLASSES guarantees it), so nothing
    // is emitted twice.
    const registerEntryKeys = new Set(qualifyingRegisterEntries(FOI_DIR).map(e => e.entry));
    for (const { entry } of entries) {
      expect(registerEntryKeys.has(entry)).toBe(false);
    }
  });
});
