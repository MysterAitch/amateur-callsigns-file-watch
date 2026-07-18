import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitClaims,
  isFileLevelClaim,
  columnPredicate,
  SUBJECT_PREDICATE,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
} from './claim.ts';
import { buildLedger } from './build-ledger.ts';
import { parseClaimsJsonl } from './serialise.ts';
import {
  collectStatisticsSources,
  loadStatisticsSource,
  statisticsEntries,
  statisticsSourcesFor,
  STATISTICS_AGGREGATE_CLASS,
} from './collectors/statistics.ts';
import { loadFoiMarkdownTableSource } from './collectors/foi-markdown-table.ts';
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
// or a licence-category tier. Since issue #813 Stage C1 the raw predicates are
// the table's own VERBATIM headers (the layer documented as published bytes
// must present published bytes, never our authored output names).

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

// The table's own VERBATIM headers (issue #813 Stage C1): the ledger predicates
// and the manifest @column/@subject claims present the published header bytes -
// including the period header's '(1 April – 31 March)' boundary qualifier,
// which the old authored output names silently dropped.
const PERIOD_COLUMN = 'period (1 April – 31 March)';
const AMATEUR_PREDICATE = 'Amateur Radio';
const BUSINESS_PREDICATE = 'Business Radio';

function statisticsSource() {
  const sources = collectStatisticsSources(FOI_DIR).filter(source => source.entry === STATISTICS_ENTRY);
  expect(sources.length).toBe(1);
  return sources[0];
}

describe('statistics-aggregate family: raw period + count claims, verbatim, no callsign edges', { tags: ['unit', 'data-validity'] }, () => {
  it('AggregateSource_WhenLoaded_CarriesPeriodSubjectAndVerbatimCountsUnderVerbatimHeaders', () => {
    const observationSet = statisticsSource().load();

    // The subject is the period under its VERBATIM header (boundary qualifier
    // intact); the count columns keep the table's own header spellings.
    expect(observationSet.subjectColumn).toBe(PERIOD_COLUMN);
    expect(observationSet.columns).toEqual([PERIOD_COLUMN, AMATEUR_PREDICATE, BUSINESS_PREDICATE]);
    expect(observationSet.sourceFile).toBe(`foi/${STATISTICS_ENTRY}/raw-extract-number-of-licences-coleman.md`);

    // The reconstruction routing (issue #813 Stage C1): the source attests its
    // repo path and encoding, so reconstructionResultFor can locate the real
    // archived extract and route it through the markdown serialiser.
    expect(observationSet.repoPath).toBe(`archive/foi/${STATISTICS_ENTRY}/raw-extract-number-of-licences-coleman.md`);
    expect(observationSet.encoding).toBe('utf8');

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

  it('AggregateFamily_WhenLoadingTheExtractTheMirrorOnceCovered_AgreesWithTheMirrorLoaderCellForCell', () => {
    // The transition proof (issue #813 Stage C1): the family's verbatim emit is
    // pinned equal to the markdown mirror's structure-preserving load - cell
    // for cell, and claim for claim - so reconstruction ownership moved from
    // the mirror to the REGISTERED family without a single observation
    // changing. The equality stays executable after the mirror's coverage of
    // this file is retired, because it compares the LOADERS directly (the
    // mirror loader survives - resolving to nothing since Stage C2 - until
    // Stage D deletes the module).
    const entry = statisticsEntries(FOI_DIR).find(e => e.entry === STATISTICS_ENTRY);
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const conversions = statisticsSourcesFor(entry.meta);
    expect(conversions.length).toBe(1);

    const family = loadStatisticsSource(FOI_DIR, STATISTICS_ENTRY, entry.meta, conversions[0]);
    const mirror = loadFoiMarkdownTableSource(FOI_DIR, STATISTICS_ENTRY, entry.meta, conversions[0]);

    // The observation sets are identical: same verbatim columns in source
    // order, same subject placement, same rows cell-for-cell, same repo
    // path/encoding - the mirror's fidelity posture, now the family's own.
    expect(family).toEqual(mirror);

    // And therefore the emitted claim streams agree claim-for-claim (a
    // stronger statement than multiset equality: same order, same provenance).
    expect(emitClaims(family)).toEqual(emitClaims(mirror));
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
      // 10 rows x (1 existence + 2 counts) = 30 observation claims, plus the
      // file-level manifest the canonical emit now carries (issue #455): one
      // @column per header column + one @subject. The manifest is raw, so it
      // lands in rawClaims but derives nothing.
      const manifestClaims = statisticsSource().load().columns.length + 1;
      expect(perSource.rawClaims).toBe(30 + manifestClaims);
      // The honesty guarantee: an aggregate source acquires NO derived claims.
      expect(perSource.derivedClaims).toBe(0);
      expect(summary.totalDerivedClaims).toBe(0);

      // The JSONL landed on disk and folds back to the same raw claims + manifest.
      const stem = statisticsSource().jsonlStem;
      const jsonl = fs.readFileSync(path.join(outputDir, 'ledger', `${stem}.jsonl`), 'utf8');
      const claims = parseClaimsJsonl(jsonl);
      expect(claims.length).toBe(30 + manifestClaims);
      expect(claims.every(claim => claim.layer === 'raw')).toBe(true);
      expect(claims.some(claim => claim.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
      // The manifest rode the persisted ledger: the aggregate's @subject column
      // is on disk, so the source structure reconstructs from the ledger alone.
      // Its claims present the table's VERBATIM headers (issue #813 Stage C1) -
      // the published bytes, boundary qualifier intact, never our authored
      // output names.
      const subjectClaim = claims.find(claim => isFileLevelClaim(claim) && claim.predicate === SUBJECT_PREDICATE);
      expect(subjectClaim?.object).toBe(PERIOD_COLUMN);
      const columnObjects = [0, 1, 2].map(index =>
        claims.find(claim => isFileLevelClaim(claim) && claim.predicate === columnPredicate(index))?.object);
      expect(columnObjects).toEqual([PERIOD_COLUMN, AMATEUR_PREDICATE, BUSINESS_PREDICATE]);

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
