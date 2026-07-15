import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  foldPrefixDistribution,
  foldClassProductMismatches,
  foldRegionalIdentifiers,
  foldCallsignPatternSeries,
  buildQualityReportFold,
} from './quality-report-fold.ts';
import {
  renderPrefixDistributions,
  renderMismatchReport,
  renderRegionalIdentifiers,
  renderCallsignPatternSeries,
} from './normalise-sweep.ts';
import { emitLedger, type SourceObservationSet } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// Issue #361 (migration-map step 5 + Phase B): the prefix-series distribution
// (reports/prefixes.md), the class-product-mismatch table
// (reports/class-product-mismatches.md), the regional-identifier distribution
// (reports/regional-identifiers.md, folding the #422/#424 `rsl` claim) and the
// callsign-pattern time-series (reports/callsign-patterns.md, folding the
// #422/#424 `callsign-pattern` claim) all fold from the raw-keyed claim ledger's
// derived tiers (quality-report-fold.ts) via DuckDB (report-fold.ts). The legacy
// components.csv/normalised.csv/stats.json generators these replaced were retired
// in #444; the durable retirement gate below folds the real archive and asserts
// the committed golden byte-for-byte. Test names follow Subject_Scenario_Outcome.

const REF = loadReferenceData();
const PREFIXES_PATH = 'reports/prefixes.md';
const MISMATCHES_PATH = 'reports/class-product-mismatches.md';
const REGIONAL_PATH = 'reports/regional-identifiers.md';
const PATTERNS_PATH = 'reports/callsign-patterns.md';

// --- Fold logic on a controlled ledger --------------------------------------
//
// Hand-built one-source ledgers, emitted through the REAL emit path (emitLedger
// over a SourceObservationSet), then folded — exercising the behaviours the real
// report depends on without the whole corpus: the parsed-series row, the
// visitor status row, and the crucial `_(empty)_` recovery for a blank token the
// T1 tier emits no parse_status for.

function openDataSource(date: string, rows: Record<string, string>[]): SourceObservationSet {
  return {
    sourceFile: `opendata/${date}/raw.csv`,
    vintage: date,
    columns: ['Call Sign', 'Product'],
    subjectColumn: 'Call Sign',
    categoryColumn: 'Product',
    rows,
  };
}

function writeLedger(sources: SourceObservationSet[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-report-fold-fixture-'));
  sources.forEach((source, i) => {
    fs.writeFileSync(path.join(dir, `source-${i}.jsonl`), serialiseClaimsJsonl(emitLedger(source, REF)));
  });
  return dir;
}

describe.skipIf(!duckDbAvailable())('prefix-series distribution fold — fixture ledger', { tags: ['unit'] }, () => {
  it('PrefixFold_ParsedVisitorAndBlankRows_LandEachRecordInExactlyOneRowRecoveringTheEmptyBucket', () => {
    // A Foundation M7 (parsed series), a visitor token (a status, no series), and
    // a BLANK callsign (the T1 tier emits no parse_status for it). Every record
    // must land in exactly one row — the parsed series under its backtick label,
    // the visitor under `_(visitor)_`, and the blank recovered as `_(empty)_`
    // from its @listed anchor (no finding dropped).
    const dir = writeLedger([openDataSource('2025-01-01', [
      { 'Call Sign': 'M7ABC', Product: 'Amateur Foundation Radio Licence' },
      { 'Call Sign': 'M/F1ABC', Product: '' },
      { 'Call Sign': '', Product: '' },
    ])]);
    try {
      const fold = foldPrefixDistribution(dir);
      expect(fold.dates).toEqual(['2025-01-01']);
      expect(fold.rows.get('`M7`')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('_(visitor)_')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('_(empty)_')?.get('2025-01-01')).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('PrefixFold_TwoPublications_ColumnsAreNewestFirstAndCountsPerDate', () => {
    const dir = writeLedger([
      openDataSource('2025-01-01', [{ 'Call Sign': 'M7ABC', Product: '' }]),
      openDataSource('2025-02-02', [{ 'Call Sign': 'M7ABC', Product: '' }, { 'Call Sign': 'G0XYZ', Product: '' }]),
    ]);
    try {
      const fold = foldPrefixDistribution(dir);
      expect(fold.dates).toEqual(['2025-02-02', '2025-01-01']);
      expect(fold.rows.get('`M7`')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('`M7`')?.get('2025-02-02')).toBe(1);
      expect(fold.rows.get('`G0`')?.get('2025-02-02')).toBe(1);
      expect(fold.rows.get('`G0`')?.get('2025-01-01')).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!duckDbAvailable())('class-product-mismatch fold — fixture ledger', { tags: ['unit'] }, () => {
  it('MismatchFold_FlaggedRow_CarriesCallsignSeriesImpliedClassAndRawProduct', () => {
    // A Foundation M7 sold under a Full product raises class-product-mismatch;
    // the fold surfaces the callsign, its resolved series/class and the RAW
    // product string, exactly as the standing table shows.
    const dir = writeLedger([openDataSource('2025-01-01', [
      { 'Call Sign': 'M7GHI', Product: 'Amateur Full Radio Licence' },
      { 'Call Sign': 'M7ABC', Product: 'Amateur Foundation Radio Licence' },
    ])]);
    try {
      const fold = foldClassProductMismatches(dir);
      expect(fold.dates).toEqual(['2025-01-01']);
      const rows = fold.byDate.get('2025-01-01') ?? [];
      expect(rows).toEqual([
        { callsign: 'M7GHI', prefixSeries: 'M7', impliedClass: 'Foundation', product: 'Amateur Full Radio Licence' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MismatchFold_DatasetWithNoMismatch_StillAppearsAsAnEmptySection', () => {
    // The report shows a per-dataset section even where none are affected
    // (rendered `(none)`), so a clean publication keeps its column.
    const dir = writeLedger([
      openDataSource('2025-01-01', [{ 'Call Sign': 'M7GHI', Product: 'Amateur Full Radio Licence' }]),
      openDataSource('2025-02-02', [{ 'Call Sign': 'M7ABC', Product: 'Amateur Foundation Radio Licence' }]),
    ]);
    try {
      const fold = foldClassProductMismatches(dir);
      expect(fold.dates).toEqual(['2025-02-02', '2025-01-01']);
      expect(fold.byDate.get('2025-02-02')).toEqual([]);
      expect((fold.byDate.get('2025-01-01') ?? []).map(r => r.callsign)).toEqual(['M7GHI']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!duckDbAvailable())('regional-identifier distribution fold — fixture ledger', { tags: ['unit'] }, () => {
  it('RegionalFold_CoreIntermediateAndVisitorRows_RenderCombosBareAndCoreAggregateExcludingNonParsed', () => {
    // MW7ABC → first-letter+RSL combo `MW`; 20DLQ → bare `20` (RSL-less
    // intermediate); 2E0XYZ → digit-led `2E`; M7TEE → RSL-less G/M core
    // aggregate; the visitor token M/PT2FM is NON-parsed and excluded entirely
    // (the table counts parsed records only — no invented bucket for it).
    const dir = writeLedger([openDataSource('2025-01-01', [
      { 'Call Sign': 'MW7ABC', Product: '' },
      { 'Call Sign': '20DLQ', Product: '' },
      { 'Call Sign': '2E0XYZ', Product: '' },
      { 'Call Sign': 'M7TEE', Product: '' },
      { 'Call Sign': 'M/PT2FM', Product: '' },
    ])]);
    try {
      const fold = foldRegionalIdentifiers(dir);
      expect(fold.dates).toEqual(['2025-01-01']);
      expect(fold.rows.get('`MW`')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('`20` _(bare)_')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('`2E`')?.get('2025-01-01')).toBe(1);
      expect(fold.rows.get('_(G/M core, no RSL)_')?.get('2025-01-01')).toBe(1);
      // The non-parsed visitor contributes no row at all.
      expect([...fold.rows.keys()].some(label => label.includes('PT'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RegionalFold_DatasetWithOnlyNonParsedRecords_StillAppearsAsAColumn', () => {
    // The column set is every open-data date (from the @listed anchors), so a
    // publication whose only record is a non-parsed visitor keeps its column —
    // rendered all-zero — rather than vanishing.
    const dir = writeLedger([
      openDataSource('2025-01-01', [{ 'Call Sign': 'M7TEE', Product: '' }]),
      openDataSource('2025-02-02', [{ 'Call Sign': 'M/PT2FM', Product: '' }]),
    ]);
    try {
      const fold = foldRegionalIdentifiers(dir);
      expect(fold.dates).toEqual(['2025-02-02', '2025-01-01']);
      // 2025-02-02 is visitor-only: it keeps its column but contributes no row.
      expect([...fold.rows.values()].some(byDate => byDate.has('2025-02-02'))).toBe(false);
      expect(fold.rows.get('_(G/M core, no RSL)_')?.get('2025-01-01')).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!duckDbAvailable())('callsign-pattern series fold — fixture ledger', { tags: ['unit'] }, () => {
  it('PatternSeriesFold_NonEmptyAndBlankRows_CountShapesRecoveringTheEmptyBucket', () => {
    // Two ANAAA cores, one visitor A/ANAAA, and a BLANK callsign (the tier emits
    // no callsign-pattern claim for it). Each shape is counted, and the blank is
    // recovered as the empty-string pattern from its @listed anchor — the record
    // count is the full four, no finding dropped.
    const dir = writeLedger([openDataSource('2025-01-01', [
      { 'Call Sign': 'M7ABC', Product: '' },
      { 'Call Sign': 'G0XYZ', Product: '' },
      { 'Call Sign': 'F/M0ABC', Product: '' },
      { 'Call Sign': '', Product: '' },
    ])]);
    try {
      const fold = foldCallsignPatternSeries(dir);
      expect(fold.keys).toEqual(['2025-01-01']);
      expect(fold.patterns.get('2025-01-01')?.get('ANAAA')).toBe(2);
      expect(fold.patterns.get('2025-01-01')?.get('A/ANAAA')).toBe(1);
      expect(fold.patterns.get('2025-01-01')?.get('')).toBe(1); // empty recovered
      expect(fold.recordCounts.get('2025-01-01')).toBe(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('PatternSeriesFold_TwoPublications_KeysChronologicalAndWhitespaceMarkersPreserved', () => {
    // Keys are chronological (oldest-first; the renderer reverses to newest-
    // first), and a whitespace-bearing token keeps its exploded {U+XXXX} marker
    // in the pattern — the phenomenon the character-shape taxonomy exists to show.
    const dir = writeLedger([
      openDataSource('2025-01-01', [{ 'Call Sign': 'M7ABC', Product: '' }]),
      openDataSource('2025-02-02', [{ 'Call Sign': 'M7ABC', Product: '' }, { 'Call Sign': 'M7 XY', Product: '' }]),
    ]);
    try {
      const fold = foldCallsignPatternSeries(dir);
      expect(fold.keys).toEqual(['2025-01-01', '2025-02-02']);
      expect(fold.patterns.get('2025-01-01')?.get('ANAAA')).toBe(1);
      expect(fold.patterns.get('2025-02-02')?.get('ANAAA')).toBe(1);
      expect(fold.patterns.get('2025-02-02')?.get('AN{U+0020}AA')).toBe(1);
      expect(fold.recordCounts.get('2025-02-02')).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The real-archive fold retirement gate: with the pinned DuckDB CLI present (CI
// always; a bare local checkout skips), materialising the ledger and folding it
// must reproduce the committed goldens byte-for-byte — the proof the FOLD (not a
// legacy recompute) produces the numbers, so the reports can retire the legacy
// path.
describe.skipIf(!duckDbAvailable())('quality reports — real-archive fold retirement gate', { tags: ['data-validity'] }, () => {
  let fold: ReturnType<typeof buildQualityReportFold>;
  beforeAll(() => {
    fold = buildQualityReportFold();
  }, 600_000);

  it('PrefixDistributionFold_RealArchive_ReproducesCommittedGolden', () => {
    expect(renderPrefixDistributions(fold.prefixes.dates, fold.prefixes.rows))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), PREFIXES_PATH), 'utf8'));
  });

  it('ClassProductMismatchesFold_RealArchive_ReproducesCommittedGolden', () => {
    const sections = fold.mismatches.dates.map(date => ({ key: date, rows: fold.mismatches.byDate.get(date) ?? [] }));
    expect(renderMismatchReport(sections))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), MISMATCHES_PATH), 'utf8'));
  });

  it('RegionalIdentifiersFold_RealArchive_ReproducesCommittedGolden', () => {
    expect(renderRegionalIdentifiers(fold.regionalIdentifiers.dates, fold.regionalIdentifiers.rows))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), REGIONAL_PATH), 'utf8'));
  });

  it('CallsignPatternSeriesFold_RealArchive_ReproducesCommittedGolden', () => {
    expect(renderCallsignPatternSeries(fold.callsignPatterns))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), PATTERNS_PATH), 'utf8'));
  });
});
