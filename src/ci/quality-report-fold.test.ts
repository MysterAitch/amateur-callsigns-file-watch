import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  foldPrefixDistribution,
  foldClassProductMismatches,
  buildQualityReportFold,
} from './quality-report-fold.ts';
import {
  legacyPrefixDistribution,
  renderPrefixDistributions,
  legacyMismatchSections,
  renderMismatchReport,
} from './normalise-sweep.ts';
import { emitLedger, type SourceObservationSet } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';

// Issue #361 (migration-map step 5): the prefix-series distribution
// (reports/prefixes.md) and the class-product-mismatch table
// (reports/class-product-mismatches.md) fold from the raw-keyed claim ledger's
// T1 parse-attribute tier (quality-report-fold.ts) via DuckDB (report-fold.ts)
// rather than the legacy components.csv/normalised.csv. This is the durable
// equivalence oracle — the retirement gate. Test names follow Subject_Scenario_Outcome.

const REF = loadReferenceData();
const PREFIXES_PATH = 'reports/prefixes.md';
const MISMATCHES_PATH = 'reports/class-product-mismatches.md';

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

describe.skipIf(!duckDbAvailable())('prefix-series distribution fold — fixture ledger', () => {
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

describe.skipIf(!duckDbAvailable())('class-product-mismatch fold — fixture ledger', () => {
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

// --- The durable equivalence oracle -----------------------------------------
//
// The retirement gate for these two reports (issue #361): the ledger fold is
// SEMANTICALLY equivalent to the legacy computation, and the classification
// resolves to ZERO residual difference. The ofcom-amateur normaliser copies the
// callsign VERBATIM and is row-preserving (normalise.ts), so components.csv
// parses the SAME raw token the ledger stores; the reports are open-data-only and
// count records, so the fold reads the identical parse over the identical rows
// and reproduces the committed golden exactly.
//
// The one place they COULD differ — and the fold's one non-trivial move — is the
// `_(empty)_` bucket: the T1 tier emits no parse_status for a blank token, so the
// fold recovers it from the @listed anchor (parse_status is emitted iff the token
// is non-empty — the tier's contract), rather than dropping the blank-callsign
// finding. No value is invented and no finding is dropped, which the always-on
// checks below pin so a NEW divergence trips CI rather than being noticed by eye.

// The dated open-data column keys, newest-first — mirroring the sweep
// (keysWithStats reversed), the columns both committed reports carry.
function openDataColumns(): string[] {
  return listArchiveKeys()
    .sort()
    .filter(key => fs.existsSync(path.join(CONSTANTS.DIRS.archive, key, 'stats.json')))
    .reverse();
}

// Parse the committed prefix table (the FOLDED side) into label -> date -> count.
function parseCommittedPrefixes(): { dates: string[]; rows: Map<string, Map<string, number>> } {
  const lines = fs.readFileSync(path.resolve(process.cwd(), PREFIXES_PATH), 'utf8').split('\n');
  const header = lines.find(l => l.startsWith('| prefix series |'));
  expect(header, 'prefix table header').toBeDefined();
  const dates = (header ?? '').split('|').slice(2, -1).map(c => c.trim());
  const rows = new Map<string, Map<string, number>>();
  const rowRe = /^\| (`[^`]+`|_\([^)]*\)_) \| (.+) \|$/;
  for (const line of lines) {
    const m = rowRe.exec(line);
    if (m === null) continue;
    const counts = m[2].split('|').map(c => Number(c.trim()));
    const byDate = new Map<string, number>();
    dates.forEach((date, i) => byDate.set(date, counts[i]));
    rows.set(m[1], byDate);
  }
  return { dates, rows };
}

// Parse the committed mismatch report (the FOLDED side) into date -> callsigns.
function parseCommittedMismatches(): Map<string, string[]> {
  const lines = fs.readFileSync(path.resolve(process.cwd(), MISMATCHES_PATH), 'utf8').split('\n');
  const byDate = new Map<string, string[]>();
  let current: string[] | undefined;
  const sectionRe = /^## (\S+) \(\d+\)$/;
  const rowRe = /^\| `([^`]+)` \| /;
  for (const line of lines) {
    const s = sectionRe.exec(line);
    if (s !== null) { current = []; byDate.set(s[1], current); continue; }
    const r = rowRe.exec(line);
    if (r !== null && current !== undefined) current.push(r[1]);
  }
  return byDate;
}

describe('quality reports — ledger vs legacy equivalence oracle', () => {
  // Always-on: recompute the legacy figures live over the real archive (no
  // DuckDB) and read the committed folded goldens. Any drift in either path —
  // beyond a regenerated golden — trips here.
  let columns: string[];
  beforeAll(() => {
    columns = openDataColumns();
  }, 600_000);

  it('PrefixDistribution_CommittedGolden_ReproducesTheLiveLegacyComputation', () => {
    // The load-bearing equivalence assertion: the committed report (the fold's
    // output) is byte-identical to rendering the live legacy computation.
    const legacy = legacyPrefixDistribution(columns);
    expect(renderPrefixDistributions(legacy.dates, legacy.rows))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), PREFIXES_PATH), 'utf8'));
  });

  it('ClassProductMismatches_CommittedGolden_ReproducesTheLiveLegacyComputation', () => {
    expect(renderMismatchReport(legacyMismatchSections(columns)))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), MISMATCHES_PATH), 'utf8'));
  });

  it('PrefixDistribution_FoldedNeverInvents_LabelsSubsetOfLegacyAndCountsNeverExceed', () => {
    // The never-invents direction: every folded row label is one the legacy path
    // also carries (including the recovered `_(empty)_` bucket), and no folded
    // count exceeds the legacy count for that (label, date). Equal here (zero
    // divergence); an inversion would mean the fold gained records legacy lacks.
    const legacy = legacyPrefixDistribution(columns);
    const folded = parseCommittedPrefixes();
    for (const [label, byDate] of folded.rows) {
      expect(legacy.rows.has(label), `folded prefix label absent from legacy: ${label}`).toBe(true);
      for (const [date, count] of byDate) {
        expect(count, `${label}/${date}`).toBeLessThanOrEqual(legacy.rows.get(label)?.get(date) ?? 0);
      }
    }
    // The empty bucket, when the legacy carries it, is RECOVERED by the fold —
    // the blank-callsign finding is never silently dropped.
    if (legacy.rows.has('_(empty)_')) {
      expect(folded.rows.has('_(empty)_'), 'fold dropped the recovered _(empty)_ bucket').toBe(true);
    }
  });

  it('ClassProductMismatches_FoldedNeverInvents_CallsignsSubsetOfLegacyPerDataset', () => {
    const legacyByDate = new Map(legacyMismatchSections(columns).map(s => [s.key, s.rows.map(r => r.callsign)]));
    const folded = parseCommittedMismatches();
    for (const [date, callsigns] of folded) {
      const legacy = new Set(legacyByDate.get(date) ?? []);
      for (const callsign of callsigns) {
        expect(legacy.has(callsign), `folded mismatch ${callsign} (${date}) absent from legacy`).toBe(true);
      }
      expect(callsigns.length, `${date} folded row count`).toBeLessThanOrEqual((legacyByDate.get(date) ?? []).length);
    }
  });
});

// The real-archive fold retirement gate: with the pinned DuckDB CLI present (CI
// always; a bare local checkout skips), materialising the ledger and folding it
// must reproduce the committed goldens byte-for-byte — the proof the FOLD (not a
// legacy recompute) produces the numbers, so the reports can retire the legacy
// path.
describe.skipIf(!duckDbAvailable())('quality reports — real-archive fold retirement gate', () => {
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
});
