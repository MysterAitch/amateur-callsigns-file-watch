import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runReportSweep, mdCell } from './report-sweep.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { convertRawCsv } from '../sources/ofcom-amateur/normalise.ts';
import { renderStatsJson } from '../shared/stats.ts';
import { duckDbAvailable } from '../testing/duckdb.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The report sweep regenerates every committed standing report under reports/
// from the per-entry derived views (read through the archive/projection
// switch) and the claim-ledger folds, and reports per-entry coverage
// honestly. These fixtures stage entries in the FROZEN-BASELINE shape: raw +
// meta plus committed derivatives produced by the authored converter - the
// state every pre-freeze entry is in, and byte-identical (by the parity gate)
// to what a projection-fed run reads for a post-freeze entry.

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

// Stage one entry in the frozen-baseline shape: raw + meta AND the committed
// derivatives, produced by the same authored converter that wrote every
// pre-freeze entry's files. The sweep under test never derives - it reads.
function deriveEntry(root: string, key: string, rawContent: string, metaOverrides: Record<string, unknown> = {}): void {
  writeEntry(root, key, rawContent, metaOverrides);
  const dir = path.join(root, CONSTANTS.DIRS.archive, key);
  const result = convertRawCsv(rawContent, { referenceDateIso: key });
  fs.writeFileSync(path.join(dir, 'normalised.csv'), result.csv);
  fs.writeFileSync(path.join(dir, 'stats.json'), renderStatsJson(result.stats));
  fs.writeFileSync(path.join(dir, 'components.csv'), result.componentsCsv);
}

let tmpRoot: string;
let originalCwd: string;
let savedClaimsParquet: string | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-report-sweep-'));
  process.chdir(tmpRoot);
  // These cases sweep a FIXTURE archive (the temp cwd above), so the folds inside
  // runReportSweep must build from that fixture - not from the ambient shared
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

// runReportSweep folds the value catalogue and cross-dataset invariants via
// DuckDB, so every case here transitively needs the pinned CLI. Where it is
// absent - a fresh worktree that has not run `npm run setup:duckdb` - these
// cases skip rather than fail with a cryptic ENOENT. The pure mdCell cases
// below carry no such dependency and always run.
describe.skipIf(!duckDbAvailable())('runReportSweep', { tags: ['data-validity'] }, () => {
  it('Coverage_DerivedAndRawOnlyEntries_ReportedHonestlyWithoutFailure', () => {
    // The coverage table names every archive entry's derived-view state: a
    // fully derived entry with its record count, and a raw-only entry (no
    // authored converter binding - e.g. a foreign source) as honest coverage,
    // never a failure.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW, { sourceKey: 'some-other-source' });

    const report = runReportSweep();

    expect(report.failed).toEqual([]);
    expect(report.coverageMarkdown).toContain('| 2026-01-01 | ofcom-amateur-callsigns | derived | 2 records |');
    expect(report.coverageMarkdown).toMatch(/\| 2026-02-02 \| some-other-source \| raw-only \|/);
  });

  it('Coverage_LedgerCoveredSourceWithNoDerivedView_FailsLoudly', () => {
    // The ledger lane covers every open-data register entry, so one with NO
    // derived view at all is never honest raw-only coverage: either the
    // projection dropped an entry it should have folded, or this is an
    // archive-mode run over a corpus with a post-freeze publication - both
    // must turn the run red rather than regenerate reports silently missing
    // a publication.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    writeEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW); // default source key, no derived files

    const report = runReportSweep();

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-02-02');
    expect(report.failed[0].reason).toContain('ledger-covered source');
    expect(report.coverageMarkdown).toMatch(/\| 2026-02-02 \| ofcom-amateur-callsigns \| FAILED \|/);
  });

  it('Coverage_PartialDerivedView_FailsLoudlyNamingTheMissingFiles', () => {
    // Partial presence is never legitimate: an entry carrying one or two of
    // the three derived files means a botched write or deletion, and must
    // turn the run red naming what is missing - not be skipped as raw-only.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    fs.rmSync(path.join(tmpRoot, 'archive', '2026-01-01', 'stats.json'));

    const report = runReportSweep();

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].key).toBe('2026-01-01');
    expect(report.failed[0].reason).toContain('stats.json');
    expect(report.coverageMarkdown).toContain('FAILED');
  });

  it('Coverage_UnreadableStats_FailsLoudlyNotSilentlySkipped', () => {
    // A stats.json that exists but does not parse is corruption, not absence:
    // the run must go red rather than quietly generating reports without the
    // entry.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-01-01', 'stats.json'), 'not json');

    const report = runReportSweep();

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toContain('stats.json');
  });

  it('Coverage_MetaSuppliedTextWithMarkdownHostileCharacters_TableRowStaysWellFormed', () => {
    // Coverage cells carry meta-supplied text (the source key) and failure
    // notes; markdown-hostile characters in either must not break the table -
    // one well-formed row per entry, cell boundaries intact. (A meta.json
    // that does not PARSE crashes the ledger collection loudly before any
    // report is written - the whole-run fail-loud path, unchanged here.)
    writeEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW, { sourceKey: 'weird|source\\key' });

    const report = runReportSweep();

    // No derived view and a foreign source key: honest raw-only coverage.
    expect(report.failed).toEqual([]);
    const tableLines = report.coverageMarkdown.split('\n').filter(l => l.includes('2026-01-01'));
    expect(tableLines).toHaveLength(1);
    expect(tableLines[0].startsWith('|')).toBe(true);
    expect(tableLines[0].endsWith('|')).toBe(true);
    // The pipe arrived escaped, not as a phantom cell boundary.
    expect(tableLines[0]).toContain('weird\\|source');
  });

  it('Report_WhenEntryBetweenNeighbours_MatrixColumnsCoverBothDirections', () => {
    // Every entry with stats gets a committed reports/{key}.md; the pattern
    // matrix spans chronological neighbours on BOTH sides, so retrospectively
    // inserted entries are judged in both directions.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', withOddity);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW); // beyond quota - excluded
    deriveEntry(tmpRoot, '2026-01-02', SALESFORCE_RAW); // complete #3 - stop here
    deriveEntry(tmpRoot, '2026-01-03', SALESFORCE_RAW); // complete #2
    deriveEntry(tmpRoot, '2026-01-04', SALESFORCE_RAW); // complete #1
    deriveEntry(tmpRoot, '2026-01-05', SALESFORCE_RAW, incomplete); // kept in view
    deriveEntry(tmpRoot, '2026-01-06', SALESFORCE_RAW, incomplete); // kept in view
    deriveEntry(tmpRoot, '2026-01-07', SALESFORCE_RAW); // the entry under report
    runReportSweep();

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
      deriveEntry(tmpRoot, `2026-01-${String(day).padStart(2, '0')}`, SALESFORCE_RAW, incomplete);
    }
    deriveEntry(tmpRoot, '2026-01-12', SALESFORCE_RAW);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', fourRows); // 4 records
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW); // 2 records - the entry under report
    runReportSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-02-02.md'), 'utf8');
    expect(report).toContain('4<br><small>+2 (+100.0%)</small>');
  });

  it('Report_WhenCallsignsCarryWhitespace_RenderedAsVisibleCodepointMarkers', () => {
    // Whitespace (space, NBSP, ...) is unambiguously invalid in a callsign
    // and arrives in reports as printable {U+XXXX} markers straight from the
    // taxonomy - immediately visible, no detective work, and each codepoint
    // is a distinct row.
    const withAnomalies = SALESFORCE_RAW
      + 'M7 ODD,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M7NBS ,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-01-01', withAnomalies);
    runReportSweep();

    const report = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    expect(report).toContain('`AN{U+0020}AAA`'); // space and NBSP stay distinct rows
    expect(report).toContain('`ANAAA{U+00A0}`');
  });

  it('Report_WhenNothingChanges_FilesStayByteIdentical', () => {
    // Reports are derived golden masters like everything else: a re-run over
    // unchanged data must regenerate byte-identical files (no timestamps, no
    // ordering drift), or every scheduled run would churn the reports and the
    // golden-master drift gate would misfire.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    runReportSweep();
    const before = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    const seriesBefore = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');

    runReportSweep();

    expect(fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8')).toBe(seriesBefore);
  });

  it('PatternTimeSeries_SpansAllDatasetsWithoutDeltas', () => {
    // reports/callsign-patterns.md is the full pattern time-series: one
    // column per dataset (ALL of them, not a window), plain counts with no
    // baseline/delta annotations - how the distribution changed over time.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-03-03', SALESFORCE_RAW);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', mixed);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', withContest);
    runReportSweep();

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
    const withNbsp = SALESFORCE_RAW + 'M7 BBB,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-01-01', withSpace);
    deriveEntry(tmpRoot, '2026-02-02', withNbsp);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', withDefects);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', mixed);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-02-02', mixed);
    runReportSweep();

    const rsl = fs.readFileSync(path.join(tmpRoot, 'reports', 'regional-identifiers.md'), 'utf8');
    expect(rsl).toContain('| `MW` | 1 |');
    expect(rsl).toContain('| `20` _(bare)_ | 1 |');
    expect(rsl).toContain('| `2E` | 1 |');
    expect(rsl).toContain('_(G/M core, no RSL)_');
  });

  it('ReportsIndex_HeadlinesPerDataset_LinkToEntryReportsAndDrilldowns', () => {
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);
    runReportSweep();

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
    deriveEntry(tmpRoot, '2026-02-02', mixed);
    runReportSweep();

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
      + ' M7LED,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + ' NOPE,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-02-02', mixed);
    runReportSweep();

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

  it('PatternPartition_ExpectedFormatsExplainedFromReferenceData_UnexpectedListedSeparately', () => {
    // The patterns table splits into expected formats (curated explanations
    // from reference-data/pattern-formats.csv) and unexpected ones - the
    // unexpected list is the review target.
    const mixed = SALESFORCE_RAW
      + 'MW7ABC,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'M/PT2FM,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n'
      + 'NANAAA,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-02-02', mixed);
    runReportSweep();

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

  it('CoverageBody_NewestMatrixAndFlagTables_AlwaysIncluded', () => {
    // The coverage body is the does-this-look-right triage surface: the
    // newest dataset's RSL matrix and the flag/status trend tables ride every
    // run's body - when the reports changed because a publication landed, the
    // newest entry IS that publication.
    deriveEntry(tmpRoot, '2026-01-01', SALESFORCE_RAW);
    deriveEntry(tmpRoot, '2026-02-02', SALESFORCE_RAW);

    const report = runReportSweep();

    expect(report.coverageMarkdown).toContain('<summary>RSL matrix (current state): 2026-02-02</summary>');
    expect(report.coverageMarkdown).toContain('| **total** |');
    expect(report.coverageMarkdown).toContain('<summary>Data-quality flags per dataset</summary>');
    expect(report.coverageMarkdown).toContain('## Component-parse flags');
    expect(report.coverageMarkdown).toContain('## Parse statuses');
  });

  it('CoverageBody_NewestEntryWithUnexpectedLocators_AnomalyLineVisibleOutsideDetails', () => {
    // Unexpected locators surface OUTSIDE the details block, visible without
    // expanding anything - the triage signal must never be folded away.
    const mixed = SALESFORCE_RAW
      + 'M2ODD,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-02-02', mixed);

    const report = runReportSweep();

    expect(report.coverageMarkdown).toContain('⚠ 2026-02-02 contains locators absent from reference data: series `M2`.');
    expect(report.coverageMarkdown).toContain('<summary>RSL matrix (current state): 2026-02-02</summary>');
  });

  it('Reports_WhenSpecialCharactersPresent_CharacterKeyNamesThem', () => {
    // Requested in review: raw codepoints stay in the tables for precision;
    // a character-key section names invisibles AND visually-confusable
    // printables (hyphen vs dash variants) for legibility.
    const withDefects = SALESFORCE_RAW
      + 'M7 ODD,,Allocated,Call Sign - Amateur,21/01/2019,21/01/2019\n';
    deriveEntry(tmpRoot, '2026-01-01', withDefects);
    runReportSweep();

    const entryReport = fs.readFileSync(path.join(tmpRoot, 'reports', 'entries', '2026-01-01.md'), 'utf8');
    expect(entryReport).toContain('## Character key');
    expect(entryReport).toContain('| `{U+0020}` | U+0020 | space |');
    const series = fs.readFileSync(path.join(tmpRoot, 'reports', 'callsign-patterns.md'), 'utf8');
    expect(series).toContain('human-readable markers');
    expect(series).toContain('`AN{space}AAA`');
  });
});

// mdCell is a pure markdown table-cell sanitiser with no DuckDB dependency, so
// it runs regardless of whether the CLI is installed.
describe('mdCell', { tags: ['unit'] }, () => {
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
