import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runNormaliseSweep, mdCell } from './normalise-sweep.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { type EntryStats } from '../shared/stats.ts';
import { duckDbAvailable } from '../testing/duckdb.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The normalise sweep walks every archive entry, dispatches to the source's
// converter by meta.sourceKey, and closes the gap between intended and
// achieved schema versions - with per-entry independence (one failing entry
// never blocks the rest) and honest reporting of the coverage state.

const SALESFORCE_RAW =
  'Value__c,Product__c,Status__c,Type__c,CreatedDate,LastModifiedDate\n' +
  'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,20/01/2019,21/04/2024\n' +
  'G5ABC,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeEntry(root: string, key: string, rawContent: string, metaOverrides: Record<string, unknown> = {}): void {
  const dir = path.join(root, CONSTANTS.DIRS.archive, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw.csv'), rawContent);
  const meta = {
    schemaVersion: 1,
    sourceKey: CONSTANTS.SOURCES.OFCOM_AMATEUR,
    provenance: 'live',
    fetchedAt: '2026-07-06T18:00:00.000Z',
    ofcomReportedUpdateIso: key,
    files: {
      'raw.csv': { size: Buffer.byteLength(rawContent), sha256: sha256(rawContent), format: 'csv' },
    },
    ...metaOverrides,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

// The subset of meta.json shape these tests assert on.
interface TestMeta {
  normalised?: { schemaVersion: number; headerVariant: string; statsSchemaVersion?: number; componentsSchemaVersion?: number };
  files: Record<string, { size?: number; sha256?: string; recordCount?: number }>;
}

function readMeta(root: string, key: string): TestMeta {
  return JSON.parse(fs.readFileSync(path.join(root, CONSTANTS.DIRS.archive, key, 'meta.json'), 'utf8')) as TestMeta;
}

let tmpRoot: string;
let originalCwd: string;
let savedClaimsParquet: string | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-norm-sweep-'));
  process.chdir(tmpRoot);
  // These cases sweep a FIXTURE archive (the temp cwd above), so the folds inside
  // runNormaliseSweep must build from that fixture - not from the ambient shared
  // claims Parquet (#478), which is built once from the REAL archive and exposed
  // to every suite via CLAIMS_PARQUET. Without this, deployClaimsSource() would
  // hand the folds real-archive claims and the fixture assertions would read
  // real dates/patterns. Save + restore (not just delete) so this never leaks
  // out to the real-archive fold suites that legitimately consume the Parquet.
  savedClaimsParquet = process.env.CLAIMS_PARQUET;
  delete process.env.CLAIMS_PARQUET;
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (savedClaimsParquet === undefined) delete process.env.CLAIMS_PARQUET;
  else process.env.CLAIMS_PARQUET = savedClaimsParquet;
});

// runNormaliseSweep now folds the value catalogue and cross-dataset invariants
// via DuckDB, so every case here transitively needs the pinned CLI. Where it is
// absent - a fresh worktree that has not run `npm run setup:duckdb` - these
// cases skip rather than fail with a cryptic ENOENT. The pure mdCell cases below
// carry no such dependency and always run.
describe.skipIf(!duckDbAvailable())('runNormaliseSweep', () => {
  it('Sweep_WhenEntryHasNoNormalisedFile_CreatesItAndDeclaresInMeta', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toEqual([]);
    const normalised = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv'), 'utf8');
    expect(normalised.startsWith('callsign,product,status,type,')).toBe(true);
    const meta = readMeta(tmpRoot, '2026-01-01');
    expect(meta.normalised).toEqual({ schemaVersion: 1, headerVariant: 'v2025-salesforce', statsSchemaVersion: 6, componentsSchemaVersion: 5 });
    expect(meta.files['normalised.csv'].sha256).toBe(sha256(normalised));
    expect(meta.files['normalised.csv'].recordCount).toBe(2);
    // The value catalogue is written UNDER the sweep's working root, not the
    // real repo - so running the sweep against a fixture never clobbers the
    // committed reports/value-catalogue.md.
    expect(fs.existsSync(path.join(tmpRoot, 'reports', 'value-catalogue.md'))).toBe(true);
  });

  it('Sweep_WhenOutputAlreadyCurrent_MakesNoChanges', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    runNormaliseSweep();
    const metaBefore = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8');

    const second = runNormaliseSweep();

    expect(second.changed).toEqual([]);
    expect(second.upToDate).toEqual(['2026-01-01']);
    // Meta is byte-identical too - re-runs must be true no-ops or the
    // golden-master property (no diff => no PR) breaks.
    expect(fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8')).toBe(metaBefore);
  });

  it('Sweep_WhenOneEntryFails_OthersStillNormalise', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', 'Unknown,Columns\nx,y\n');
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-02-02');
    expect(report.failed[0].reason).toMatch(/unknown raw header/i);
  });

  it('Sweep_WhenSourceHasNoConverter_ReportsEntryAsUnsupported', () => {
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW, { sourceKey: 'some-future-source' });
    const report = runNormaliseSweep();

    expect(report.unsupported).toEqual(['2026-03-03']);
    expect(report.changed).toEqual([]);
    expect(fs.existsSync(path.join(tmpRoot, 'archive', '2026-03-03', 'normalised.csv'))).toBe(false);
  });

  it('Sweep_WhenConverterOutputChanges_RewritesFileAndMeta', () => {
    // Simulates a converter/schema evolution: an existing normalised.csv
    // whose bytes no longer match what the current converter produces.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    runNormaliseSweep();
    const file = path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv');
    fs.writeFileSync(file, 'stale,output\n');
    // Meta must also be stale-consistent for the scenario: sweep compares
    // bytes, not meta, so no meta edit needed here.

    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    const normalised = fs.readFileSync(file, 'utf8');
    expect(normalised.startsWith('callsign,')).toBe(true);
    expect(readMeta(tmpRoot, '2026-01-01').files['normalised.csv'].sha256).toBe(sha256(normalised));
  });

  it('Sweep_WhenMixedEntryOutcomes_ReportIncludesCoverageSummaryForRollingIssue', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', 'Unknown,Columns\nx,y\n');
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW, { sourceKey: 'some-future-source' });

    const report = runNormaliseSweep();
    const summary = report.coverageMarkdown;

    expect(summary).toContain('2026-01-01');
    expect(summary).toContain('2026-02-02');
    expect(summary).toContain('2026-03-03');
    expect(summary).toMatch(/v1|schemaVersion/i);
    expect(summary).toMatch(/unknown raw header/i);
    expect(summary).toMatch(/no converter/i);
  });

  it('Sweep_WhenEntryNormalised_StatsJsonWrittenAndDeclaredInMeta', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    const statsRaw = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'stats.json'), 'utf8');
    const stats = JSON.parse(statsRaw) as EntryStats;
    expect(stats.statsSchemaVersion).toBe(6);
    expect(stats.recordCount).toBe(2);
    expect(stats.callsignPatterns).toEqual({ ANAAA: 2 }); // M7TEE, G5ABC
    expect((stats.columns.callsign as { distinct: number }).distinct).toBe(2);
    const meta = readMeta(tmpRoot, '2026-01-01');
    expect(meta.files['stats.json'].sha256).toBe(sha256(statsRaw));
    expect(meta.normalised?.statsSchemaVersion).toBe(6);
  });

  it('Sweep_WhenEntryNormalised_ComponentsCsvWrittenAndDeclaredInMeta', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    const components = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'components.csv'), 'utf8');
    const lines = components.trimEnd().split('\n');
    expect(lines[0]).toBe('callsign,cleaned,parse_status,prefix_series,rsl,suffix,placeholder_form,home_callsign,implied_class,flags');
    // Rows join to normalised.csv by callsign, same sort order.
    expect(lines[1]).toBe('G5ABC,G5ABC,parsed,G5,,ABC,G#5ABC,,Full,');
    expect(lines[2]).toBe('M7TEE,M7TEE,parsed,M7,,TEE,M#7TEE,,Foundation,');
    const meta = readMeta(tmpRoot, '2026-01-01');
    expect(meta.files['components.csv'].sha256).toBe(sha256(components));
    expect(meta.files['components.csv'].recordCount).toBe(2);
    expect(meta.normalised?.componentsSchemaVersion).toBe(5);
  });

  it('Report_WhenEntryBetweenNeighbours_MatrixColumnsCoverBothDirections', () => {
    // Every entry with stats gets a committed reports/{key}.md; the pattern
    // matrix spans chronological neighbours on BOTH sides, so retrospectively
    // inserted entries are judged in both directions.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    const matrixSection = report.slice(report.indexOf('## Pattern counts across window'));
    const matrixHeader = matrixSection.split('\n').find(l => l.includes('pattern |'));
    expect(matrixHeader).toContain('2026-01-01');
    expect(matrixHeader).toContain('2026-02-02 (this)');
    expect(matrixHeader).toContain('2026-03-03');
    // Records row and a pattern row with per-dataset counts, current bolded.
    expect(report).toMatch(/_records_ \| 2 \| \*\*2\*\* \| 2/);
    expect(report).toMatch(/`ANAAA` \| 2 \| \*\*2\*\* \| 2/);
    // The entry's own full pattern table and pairwise sections are present.
    expect(report).toContain('## Callsign patterns');
    expect(report).toContain('## Pairwise comparison');
  });

  it('Report_WhenPatternAbsentFromNeighbour_MatrixShowsDashNotZero', () => {
    // Absence of a pattern is different from a zero count - the matrix must
    // distinguish them for the reviewer.
    const withOddity = SALESFORCE_RAW + 'm7odd,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', withOddity);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    expect(report).toMatch(/`aNaaa` \| — \| \*\*1\*\*/);
  });

  it('Report_WindowExtendsUntilThreeCompleteDatasets_KeepingIncompleteOnesInView', () => {
    // Anomalous publications cluster (the truncated dataset published twice
    // in a fortnight crowded a fixed look-back), so each side extends until
    // it holds three complete datasets - and every incomplete entry passed
    // over on the way STAYS in the window; the quota decides when to stop
    // extending, never what to drop.
    const incomplete = { intendedCoverage: { complete: false, scopeNotes: 'truncated publication' } };
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW); // beyond quota - excluded
    writeEntry(tmpRoot, '2026-01-02', SALESFORCE_RAW); // complete #3 - stop here
    writeEntry(tmpRoot, '2026-01-03', SALESFORCE_RAW); // complete #2
    writeEntry(tmpRoot, '2026-01-04', SALESFORCE_RAW); // complete #1
    writeEntry(tmpRoot, '2026-01-05', SALESFORCE_RAW, incomplete); // kept in view
    writeEntry(tmpRoot, '2026-01-06', SALESFORCE_RAW, incomplete); // kept in view
    writeEntry(tmpRoot, '2026-01-07', SALESFORCE_RAW); // the entry under report
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-07.md'), 'utf8');
    const matrixSection = report.slice(report.indexOf('## Pattern counts across window'));
    const matrixHeader = matrixSection.split('\n').find(l => l.includes('pattern |')) ?? '';
    expect(matrixHeader).toContain('2026-01-06'); // incomplete, retained
    expect(matrixHeader).toContain('2026-01-05'); // incomplete, retained
    expect(matrixHeader).toContain('2026-01-02'); // third complete baseline
    expect(matrixHeader).not.toContain('2026-01-01'); // beyond the quota
  });

  it('Report_WindowStopsAtHardCapWhenCompletenessScarce', () => {
    const incomplete = { intendedCoverage: { complete: false, scopeNotes: 'truncated publication' } };
    // Eleven incomplete entries precede the current one: the cap (10) binds
    // before the completeness quota can ever be met.
    for (let day = 1; day <= 11; day++) {
      writeEntry(tmpRoot, `2026-01-${String(day).padStart(2, '0')}`, SALESFORCE_RAW, incomplete);
    }
    writeEntry(tmpRoot, '2026-01-12', SALESFORCE_RAW);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-12.md'), 'utf8');
    const matrixSection = report.slice(report.indexOf('## Pattern counts across window'));
    const matrixHeader = matrixSection.split('\n').find(l => l.includes('pattern |')) ?? '';
    expect(matrixHeader).toContain('2026-01-02'); // 10th before - at the cap
    expect(matrixHeader).not.toContain('2026-01-01'); // 11th before - beyond the cap
  });

  it('Report_MatrixRecordsRow_AnnotatesNeighboursWithDeltaFromCurrentEntry', () => {
    // "this" is the baseline: each neighbour's records cell carries its
    // difference from the current entry, signed, with a percentage over the
    // current entry's count - the arithmetic reviewers would otherwise do by
    // hand.
    const fourRows = SALESFORCE_RAW
      + 'M0AAA,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,20/01/2019,21/04/2024\n'
      + 'M0BBB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,20/01/2019,21/04/2024\n';
    writeEntry(tmpRoot, '2026-01-01', fourRows); // 4 records
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW); // 2 records - the entry under report
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    expect(report).toContain('4<br><small>+2 (+100.0%)</small>');
  });

  it('Report_WhenCallsignsCarryWhitespace_RenderedAsVisibleCodepointMarkers', () => {
    // Whitespace (space, NBSP, ...) is unambiguously invalid in a callsign
    // and arrives in reports as printable {U+XXXX} markers straight from the
    // taxonomy - immediately visible, no detective work, and each codepoint
    // is a distinct row. An EMPTY callsign, by contrast, fails the
    // row-validity predicate and never reaches the report at all - it is
    // enumerated in meta.json's ignoredLines instead (see the next test).
    const withAnomalies = SALESFORCE_RAW
      + 'M7 ODD,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M7NBS\u00A0,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', withAnomalies);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    expect(report).toContain('`AN{U+0020}AAA`'); // space and NBSP stay distinct rows
    expect(report).toContain('`ANAAA{U+00A0}`');
  });

  it('Sweep_WhenRawCarriesNonDataLines_EnumeratesThemInMetaAndExcludesFromDerivatives', () => {
    // The line-accounting contract (ratified 2026-07-08, syntactic-vs-
    // semantic revision): row validity is SYNTACTIC (correct column count),
    // so empty and no-callsign rows are records; blank LINES are
    // auto-enumerated; syntactically valid furniture leaves the table only
    // via CURATED ignoredLines in meta.json, which the sweep treats as
    // input and preserves across re-runs.
    const footer = '"Generated By:  Someone  21/01/2019 09:24",,,,,';
    const withFurniture = SALESFORCE_RAW
      + ',,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n' // no callsign: a row, stays
      + '20-Apr,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n' // damaged callsign: a row, stays
      + '\n' // blank LINE: auto-ignored
      + footer + '\n';
    writeEntry(tmpRoot, '2026-01-01', withFurniture, {
      ignoredLines: [{ line: 7, content: footer, reason: 'export footer furniture (curated)' }],
    });
    const report = runNormaliseSweep();
    expect(report.failed).toEqual([]);

    const meta = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8')) as {
      headerLines?: { line: number; content: string }[];
      ignoredLines?: { line: number; content: string; reason: string }[];
      files: Record<string, { recordCount?: number }>;
    };
    expect(meta.headerLines).toEqual([{ line: 1, content: 'Value__c,Product__c,Status__c,Type__c,CreatedDate,LastModifiedDate' }]);
    expect(meta.ignoredLines).toEqual([
      { line: 6, content: '', reason: 'blank' },
      { line: 7, content: footer, reason: 'export footer furniture (curated)' },
    ]);

    // Count invariant: raw physical lines = header + rows + ignored lines,
    // and records = rows (the conversion is a bijection).
    expect(meta.files['normalised.csv'].recordCount).toBe(4); // 2 base + no-callsign + 20-Apr
    const rawLines = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'raw.csv'), 'utf8').split('\n');
    if (rawLines[rawLines.length - 1] === '') rawLines.pop();
    expect(rawLines.length).toBe(1 + 4 + 2);

    // Semantic judgements stay downstream: both odd rows are in the table;
    // only the curated footer never reaches the derivatives.
    const normalised = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv'), 'utf8');
    expect(normalised).toContain('20-Apr');
    expect(normalised).toContain(',,Available,Call Sign - Amateur');
    expect(normalised).not.toContain('Generated By');

    // Re-runs preserve the curation: byte-identical meta, nothing re-flagged.
    const metaBefore = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8');
    const second = runNormaliseSweep();
    expect(second.upToDate).toEqual(['2026-01-01']);
    expect(fs.readFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'meta.json'), 'utf8')).toBe(metaBefore);
  });

  it('Report_WhenNothingChanges_FilesStayByteIdentical', () => {
    // Reports are derived golden masters like everything else: a re-run over
    // unchanged data must regenerate byte-identical files (no timestamps, no
    // ordering drift), or every scheduled run would churn the reports.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    runNormaliseSweep();
    const before = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    const seriesBefore = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');

    runNormaliseSweep();

    expect(fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8')).toBe(seriesBefore);
  });

  it('PatternTimeSeries_SpansAllDatasetsWithoutDeltas', () => {
    // reports/callsign-patterns.md is the full pattern time-series: one
    // column per dataset (ALL of them, not a window), plain counts with no
    // baseline/delta annotations - how the distribution changed over time.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW);
    runNormaliseSweep();

    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    const header = series.split('\n').find(l => l.startsWith('| pattern |')) ?? '';
    // The grouped section leads with a descriptor column; newest dataset
    // leftmost, history receding rightwards.
    expect(header).toContain('| pattern | descriptor | 2026-03-03 | 2026-02-02 | 2026-01-01 |');
    expect(series).toContain('| _records_ | 2 | 2 | 2 |');
    // The ungrouped companion table keeps the plain per-codepoint counts.
    expect(series).toContain('| `ANAAA` | 2 | 2 | 2 |');
    expect(series).not.toContain('<small>');
  });

  it('PatternTimeSeries_GroupsPatternsByClassWithDescriptors', () => {
    // #244: the standing report groups patterns into UK / visitor /
    // unknown-unexpected and gives each a descriptor, reusing the per-entry
    // drill-downs' source of truth (reference-data/pattern-formats.csv).
    const mixed = SALESFORCE_RAW
      + 'F/M0ABC,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n' // visitor A/ANAAA
      + 'WXYZ,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';    // unknown AAAA
    writeEntry(tmpRoot, '2026-01-01', mixed);
    runNormaliseSweep();

    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    expect(series).toContain('### UK patterns (1)');
    expect(series).toContain('### Visitor patterns (1)');
    expect(series).toContain('### Unknown / unexpected patterns (1)');
    // UK core shape carries its sourced descriptor.
    expect(series).toMatch(/\| `ANAAA` \| single-letter prefix \+ digit \+ three-letter suffix[^|]*\| 2 \|/);
    // Visitor shape carries the visitor-family descriptor.
    expect(series).toMatch(/\| `A\/ANAAA` \| visitor \/ temporary-reciprocal format[^|]*\| 1 \|/);
    // The unknown shape is surfaced with counts but no asserted descriptor.
    const unknownSection = series.slice(series.indexOf('### Unknown / unexpected patterns'));
    expect(unknownSection).toContain('| `AAAA` | 1 |');
  });

  it('PatternTimeSeries_UnverifiableShape_TaggedUnverifiedNotAsserted', () => {
    // Descriptors that cannot be grounded in an Ofcom/RSGB citation (the
    // contest/special shapes) are hedged, never asserted as fact.
    const withContest = SALESFORCE_RAW
      + 'G9Z,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'; // pattern ANA
    writeEntry(tmpRoot, '2026-01-01', withContest);
    runNormaliseSweep();

    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    expect(series).toMatch(/\| `ANA` \|[^|]*believed a contest \/ special-call shape[^|]*_\(unverified\)_ \|/);
  });

  it('PatternTimeSeries_FoldedTable_MergesWhitespaceVariantsIntoU', () => {
    // The folded companion table collapses every {U+XXXX} marker to a single
    // U class, so the same shape contaminated by DIFFERENT whitespace
    // codepoints (space in one dataset, NBSP in another) merges into one row
    // - the phenomenon's continuity over time, complementing the raw table's
    // per-codepoint precision.
    const withSpace = SALESFORCE_RAW + 'M7 AAA,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    const withNbsp = SALESFORCE_RAW + 'M7\u00A0BBB,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', withSpace);
    writeEntry(tmpRoot, '2026-02-02', withNbsp);
    runNormaliseSweep();

    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    const folded = series.slice(series.indexOf('Folded'));
    // Raw table keeps the codepoints distinct...
    expect(series).toContain('`AN{U+0020}AAA`');
    expect(series).toContain('`AN{U+00A0}AAA`');
    // ...the folded table merges them into one U-class row present in both.
    expect(folded).toContain('| `ANUAAA` | 1 | 1 |');
  });

  it('QualityRollup_DetectorCountsPerDataset_NewestLeftWithExamples', () => {
    // reports/data-quality.md: one row per defect detector, one column per
    // dataset (newest leftmost), with per-detector example values behind
    // details blocks using human-readable markers.
    const withDefects = SALESFORCE_RAW
      + '20-Apr,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M7 ODD,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'g0jrk,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', withDefects);
    runNormaliseSweep();

    const rollup = fs.readFileSync(path.join(tmpRoot, 'reports', 'data-quality.md'), 'utf8');
    const header = rollup.split('\n').find(l => l.startsWith('| detector |')) ?? '';
    expect(header).toBe('| detector | 2026-02-02 | 2026-01-01 |');
    expect(rollup).toContain('| Excel-date-shaped callsigns | 1 | 0 |');
    expect(rollup).toContain('| whitespace/invisible-bearing | 1 | 0 |');
    // 2: g0jrk AND 20-Apr (month abbreviations carry lowercase) - detectors
    // are independent, a row can trip several.
    expect(rollup).toContain('| lowercase-bearing | 2 | 0 |');
    // Examples in human-readable marker form, behind details.
    expect(rollup).toContain('`M7{space}ODD`');
    expect(rollup).toContain('<summary>Examples: Excel-date-shaped callsigns</summary>');
  });

  it('Distributions_PrefixSeriesCountsPerDataset_NonParsedLandInStatusRows', () => {
    // reports/prefixes.md: one row per prefix series (or parse status for
    // non-parsed records) per dataset, newest leftmost - every record lands
    // in exactly one row.
    const mixed = SALESFORCE_RAW
      + 'MW7ABC,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M/PT2FM,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', mixed);
    runNormaliseSweep();

    const prefixes = fs.readFileSync(path.join(tmpRoot, 'reports', 'prefixes.md'), 'utf8');
    expect(prefixes).toContain('| prefix series | 2026-02-02 | 2026-01-01 |');
    expect(prefixes).toContain('| `M7` | ');
    expect(prefixes).toContain('| _(visitor)_ | 1 | 0 |');
  });

  it('Distributions_RegionalIdentifiers_RenderedCombosBareIntermediatesAndCoreAggregate', () => {
    // reports/regional-identifiers.md: rendered prefix+RSL combos (MW),
    // bare 20/21 intermediates, and the RSL-less G/M core aggregate.
    const mixed = SALESFORCE_RAW
      + 'MW7ABC,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + '20DLQ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + '2E0XYZ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-02-02', mixed);
    runNormaliseSweep();

    const rsl = fs.readFileSync(path.join(tmpRoot, 'reports', 'regional-identifiers.md'), 'utf8');
    expect(rsl).toContain('| `MW` | 1 |');
    expect(rsl).toContain('| `20` _(bare)_ | 1 |');
    expect(rsl).toContain('| `2E` | 1 |');
    expect(rsl).toContain('_(G/M core, no RSL)_');
  });

  it('ReportsIndex_HeadlinesPerDataset_LinkToEntryReportsAndDrilldowns', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    runNormaliseSweep();

    const index = fs.readFileSync(path.join(tmpRoot, 'reports', 'README.md'), 'utf8');
    expect(index).toContain('[2026-02-02](entries/2026-02-02.md)');
    expect(index).toContain('[Prefix-series distributions](prefixes.md)');
    expect(index).toContain('[Regional-identifier distributions](regional-identifiers.md)');
    const headline = index.split('\n').find(l => l.startsWith('| [2026-02-02]')) ?? '';
    expect(headline).toMatch(/\| \d+ \| \d+ \| \d+ \|$/);
  });

  it('RslMatrix_SeriesByRslCounts_AllReferenceLettersShownAndExclusionsCaptioned', () => {
    // Entry reports gain a primary-by-secondary locator matrix: prefix
    // series rows, EVERY reference RSL letter as a column (zero columns are
    // the sparsity signal), parsed counts at intersections; non-parsed rows
    // excluded and accounted for in the caption.
    const mixed = SALESFORCE_RAW
      + 'MW7ABC,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + '2E0XYZ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + '20DLQ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M2ODD,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'MQ1ABC,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M/PT2FM,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'NANAAA,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-02-02', mixed);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    expect(report).toContain('## RSL matrix');
    // Locators absent from reference data are highlighted, not silently
    // mixed in: M2 is not in prefix-formats.csv (unexpected ROW), and an
    // unknown RSL letter (Q, e.g. the 2022 temporary RSL) gains an
    // unexpected COLUMN - both named in the caption.
    expect(report).toContain('| `M2` ⚠ |');
    expect(report).toContain('⚠ locators observed in the data but absent from reference data: series `M2`; RSL Q.');
    const header = report.split('\n').find(l => l.startsWith('| series |')) ?? '';
    expect(header).toContain(' Q ⚠ |');
    // All 14 reference RSL letters present as columns even when unused.
    for (const letter of ['C', 'D', 'E', 'H', 'I', 'J', 'M', 'N', 'P', 'S', 'T', 'U', 'W', 'X']) {
      expect(header).toContain(` ${letter} |`);
    }
    expect(header).toContain('(none)');
    expect(header.trimEnd().endsWith('| total |')).toBe(true);
    // MW7ABC: M7 row, W column; M7TEE: M7 row, (none) column; total 2.
    const m7 = report.split('\n').find(l => l.startsWith('| `M7` |')) ?? '';
    const cells = m7.split('|').map(c => c.trim());
    const headerCells = header.split('|').map(c => c.trim());
    expect(cells[headerCells.indexOf('W')]).toBe('1');
    expect(cells[headerCells.indexOf('(none)')]).toBe('1');
    expect(cells[headerCells.indexOf('total')]).toBe('2');
    // Zero cells render as a quiet dot, not the digit 0.
    expect(cells[headerCells.indexOf('C')]).toBe('·');
    // Totals row: column totals and the grand total (7 parsed records).
    const totalRow = report.split('\n').find(l => l.startsWith('| **total** |')) ?? '';
    const totalCells = totalRow.split('|').map(c => c.trim());
    expect(totalCells[headerCells.indexOf('W')]).toBe('1');
    expect(totalCells[headerCells.indexOf('total')]).toBe('7');
    // Every reference primary locator shows even with no register presence
    // in this fixture (all-dot row) - absence is the signal.
    expect(report.split('\n').some(l => l.startsWith('| `G8` |'))).toBe(true);
    // The transposed orientation was dropped in review - single table only.
    expect(report).not.toContain('RSL × series');
    // Exclusions captioned as a bullet list, not silently dropped.
    expect(report).toContain('Excluded from this table:');
    expect(report).toContain('- 1 unparseable');
    expect(report).toContain('- 1 visitor');
    // Small populations are enumerated in details blocks: the RSL-bearing
    // rows (the interesting finds) and each excluded status, with values in
    // exploded marker form so invisibles are visible.
    expect(report).toContain('<summary>RSL-bearing records (3)</summary>');
    expect(report).toContain('| `MW7ABC` | `M7` | W |');
    expect(report).toContain('<summary>Excluded: unparseable (1)</summary>');
    expect(report).toContain('- `NANAAA`');
  });

  it('RslMatrix_LeadingInvisibleCharacter_ParsedIntoMatrixAndEnumerationExplodesMarker', () => {
    // Invisibles are stripped wherever they sit - including position 0 -
    // so a leading-NBSP callsign still parses into the matrix, and any
    // enumerated appearance renders the exploded {U+00A0} marker.
    const mixed = SALESFORCE_RAW
      + '\u00A0M7LED,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + '\u00A0NOPE,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-02-02', mixed);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    const header = report.split('\n').find(l => l.startsWith('| series |')) ?? '';
    const m7 = report.split('\n').find(l => l.startsWith('| `M7` |')) ?? '';
    const headerCells = header.split('|').map(c => c.trim());
    // Leading-NBSP M7LED joins M7TEE in the M7 row's (none) column.
    expect(m7.split('|').map(c => c.trim())[headerCells.indexOf('(none)')]).toBe('2');
    // The unparseable leading-NBSP value is enumerated with the marker
    // exploded at its true (leading) position.
    expect(report).toContain('- `{nbsp}NOPE`');
  });

  it('SweepPrBody_ChangedEntry_IncludesRslMatrixWithVisibleAnomalyLine', () => {
    // The PR body is the does-this-publication-look-right triage surface:
    // the RSL matrix rides behind a details block per changed entry, and
    // unexpected locators surface OUTSIDE the details, visible unexpanded.
    const mixed = SALESFORCE_RAW
      + 'M2ODD,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-02-02', mixed);
    const report = runNormaliseSweep();

    expect(report.coverageMarkdown).toContain('<summary>RSL matrix: 2026-02-02</summary>');
    expect(report.coverageMarkdown).toContain('⚠ 2026-02-02 contains locators absent from reference data: series `M2`.');
    expect(report.coverageMarkdown).toContain('| **total** |');
  });

  it('PatternPartition_ExpectedFormatsExplainedFromReferenceData_UnexpectedListedSeparately', () => {
    // The patterns table splits into expected formats (curated explanations
    // from reference-data/pattern-formats.csv) and unexpected ones - the
    // unexpected list is the review target.
    const mixed = SALESFORCE_RAW
      + 'MW7ABC,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M/PT2FM,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'NANAAA,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-02-02', mixed);
    runNormaliseSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    expect(report).toContain('### Expected formats (2)');
    expect(report).toContain('| `ANAAA` | 2 | single-letter prefix + digit + three-letter suffix - the standard core callsign shape (G/M series) |');
    expect(report).toContain('| `AANAAA` | 1 | standard core with a Regional Secondary Locator inserted (MW7... / GM0...) |');
    // Visitor patterns are numerous - contained in their own table.
    expect(report).toContain('### Visitor formats (1)');
    expect(report).toMatch(/\| `A\/AANAA` \| 1 \| visitor \/ temporary-reciprocal format/);
    // The literal value NANAAA maps to pattern AAAAAA - no curated
    // explanation, so it lands in the unexpected list.
    expect(report).toContain('### Unexpected formats (1)');
    expect(report).toContain('| `AAAAAA` | 1 |');
  });

  it('SweepPrBody_WhenNoArchiveEntryChanged_NewestMatrixStillIncluded', () => {
    // A reports-only derivation (no archive bytes changed) still needs the
    // current-state matrix on its PR body - observed live on PR #99, whose
    // body carried no quality notes at all.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    runNormaliseSweep();

    const second = runNormaliseSweep();

    expect(second.changed).toEqual([]);
    expect(second.coverageMarkdown).toContain('<summary>RSL matrix (current state): 2026-02-02</summary>');
    expect(second.coverageMarkdown).toContain('| **total** |');
    // The flag/status trend tables ride every sweep PR body (restored after
    // review noted their absence).
    expect(second.coverageMarkdown).toContain('<summary>Data-quality flags per dataset</summary>');
    expect(second.coverageMarkdown).toContain('## Component-parse flags');
    expect(second.coverageMarkdown).toContain('## Parse statuses');
  });

  it('Reports_WhenSpecialCharactersPresent_CharacterKeyNamesThem', () => {
    // Requested in review: raw codepoints stay in the tables for precision;
    // a character-key section names invisibles AND visually-confusable
    // printables (hyphen vs dash variants) for legibility.
    const withDefects = SALESFORCE_RAW
      + 'M7 ODD,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    writeEntry(tmpRoot, '2026-01-01', withDefects);
    runNormaliseSweep();

    const entryReport = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    expect(entryReport).toContain('## Character key');
    expect(entryReport).toContain('| `{U+0020}` | U+0020 | space |');
    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    expect(series).toContain('human-readable markers');
    expect(series).toContain('`AN{space}AAA`');
  });

  it('Sweep_WhenNewestEntryMetaUpdated_LatestMetaMirrorRefreshedByteIdentically', () => {
    // validateLatestPointers hash-compares latest-meta.json against the
    // newest entry's meta.json; a sweep that rewrites the newest entry's meta
    // without refreshing the mirror produces an unmergeable PR (observed live
    // on the maiden derivation PR).
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    fs.copyFileSync(
      path.join(tmpRoot, 'archive', '2026-02-02', 'meta.json'),
      path.join(tmpRoot, CONSTANTS.FILES.latestMeta),
    );

    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01', '2026-02-02']);
    const newestMeta = fs.readFileSync(path.join(tmpRoot, 'archive', '2026-02-02', 'meta.json'));
    const latestMeta = fs.readFileSync(path.join(tmpRoot, CONSTANTS.FILES.latestMeta));
    expect(latestMeta.equals(newestMeta)).toBe(true);
  });

  it('Sweep_WhenOnlyOlderEntryChanges_LatestMetaMirrorUntouched', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    fs.copyFileSync(
      path.join(tmpRoot, 'archive', '2026-02-02', 'meta.json'),
      path.join(tmpRoot, CONSTANTS.FILES.latestMeta),
    );
    runNormaliseSweep();
    const latestAfterFirst = fs.readFileSync(path.join(tmpRoot, CONSTANTS.FILES.latestMeta), 'utf8');
    // Invalidate only the OLDER entry's derivation.
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'normalised.csv'), 'stale\n');

    const second = runNormaliseSweep();

    expect(second.changed).toEqual(['2026-01-01']);
    expect(fs.readFileSync(path.join(tmpRoot, CONSTANTS.FILES.latestMeta), 'utf8')).toBe(latestAfterFirst);
  });

  it('Sweep_WhenEntryMetaLacksAnyReferenceDate_ReportedAsFailureWhileOthersNormalise', () => {
    // Per-entry independence must survive malformed metadata, not just
    // converter failures: an entry with neither ofcomReportedUpdateIso nor
    // fetchedAt cannot supply a plausibility reference date.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW, { fetchedAt: undefined, ofcomReportedUpdateIso: undefined });

    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-02-02');
  });

  it('Sweep_WhenEntryMetaLacksFilesMap_ReportedAsFailureWhileOthersNormalise', () => {
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW, { files: undefined });

    const report = runNormaliseSweep();

    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-02-02');
  });

  it('Sweep_WhenFailureReasonContainsMarkdownHostileCharacters_TableRowStaysWellFormed', () => {
    // Error messages can contain pipes, backslashes, and newlines (CSV parse
    // errors quote raw content); the coverage table must stay one row per
    // entry with cell boundaries intact.
    writeEntry(tmpRoot, '2026-02-02', 'Weird\\|Header,Two\nx,y\n');
    const report = runNormaliseSweep();

    expect(report.failed).toHaveLength(1);
    const tableLines = report.coverageMarkdown.split('\n').filter(l => l.includes('2026-02-02'));
    expect(tableLines).toHaveLength(1);
    // Well-formed row: starts and ends with a pipe (single line implies no
    // raw newline survived).
    expect(tableLines[0].startsWith('|')).toBe(true);
    expect(tableLines[0].endsWith('|')).toBe(true);
  });

  it('Sweep_WhenEntryDeclaredPartialCoverage_FlaggedInSummary', () => {
    // A truncated/scoped raw record still normalises, but the dashboard must
    // mark it so nobody reads its row count as the full population.
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW, {
      intendedCoverage: { complete: false, scopeNotes: 'truncated publication' },
    });
    const report = runNormaliseSweep();
    expect(report.changed).toEqual(['2026-01-01']);
    expect(report.coverageMarkdown).toContain('PARTIAL raw coverage');
  });
});

// mdCell is a pure markdown table-cell sanitiser with no DuckDB dependency, so
// it runs regardless of whether the CLI is installed.
describe('mdCell', () => {
  it('MdCell_WhenTextExceedsLimit_TruncatedWithoutDanglingEscapeArtefacts', () => {
    // Truncation must happen BEFORE escaping: slicing escaped output can
    // bisect a two-character escape and leave a lone trailing backslash that
    // escapes the closing cell delimiter.
    const hostile = 'x'.repeat(159) + '\\'.repeat(50);
    const cell = mdCell(hostile);
    const trailingBackslashes = cell.match(/\\+$/)?.[0].length ?? 0;
    expect(trailingBackslashes % 2).toBe(0);
    expect(cell.length).toBeLessThanOrEqual(2 * 160);
  });

  it('MdCell_WhenTextShort_UnchangedApartFromEscaping', () => {
    expect(mdCell('plain text')).toBe('plain text');
    expect(mdCell('a|b')).toBe('a\\|b');
  });
});
