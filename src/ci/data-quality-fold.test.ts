import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  foldDataQuality,
  buildDataQualityFold,
  DETECTOR_KEYS,
  EMPTY_DETECTOR_KEY,
  type DataQualityFold,
  type DetectorResult,
} from './data-quality-fold.ts';
import { legacyDataQuality, renderDataQualityRollup } from './normalise-sweep.ts';
import { emitLedger, type SourceObservationSet } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { type EntryStats } from '../shared/stats.ts';

// Issue #361 (migration-map: the LAST Phase-B report to gain a ledger fold): the
// data-quality rollup (reports/data-quality.md) folds from the raw-keyed claim
// ledger's T1 flag/parse-status claims (data-quality-fold.ts) via DuckDB
// (report-fold.ts) rather than the legacy stats.json callsignQuality/callsignFlags/
// parseStatuses. This is the durable equivalence oracle — the retirement gate.
// Test names follow Subject_Scenario_Outcome.

const REF = loadReferenceData();
const DATA_QUALITY_PATH = 'reports/data-quality.md';

// --- Fold logic on a controlled ledger --------------------------------------
//
// A hand-built one-source open-data ledger, emitted through the REAL emit path
// (emitLedger over a SourceObservationSet), then folded — exercising the four
// parts the real rollup depends on without the whole corpus: the defect-detector
// matrix relabelling the flag/status claims, the flag and parse-status
// registries, the recovered `empty` bucket for a blank token the T1 tier emits no
// parse_status for, and the per-detector example tokens with their unprintables
// exploded to {U+XXXX} markers.

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

// One publication exercising every detector: a clean Foundation core (no flags);
// an Excel-date-shaped token (which is ALSO lowercase-bearing, as the real 20-Apr
// tokens are); an encoding-failure token; a whitespace-bearing token whose
// junk-stripped twin coexists as its own row (a stripped collision); that twin;
// a lowercase core; and a blank callsign (the recovered empty bucket).
function fixtureLedgerDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-quality-fold-fixture-'));
  const source = openDataSource('2025-01-01', [
    { 'Call Sign': 'M7ABC', Product: 'Amateur Foundation Radio Licence' },
    { 'Call Sign': '20-Jan', Product: '' },
    { 'Call Sign': 'G0ABC�', Product: '' },
    { 'Call Sign': 'G6 FMU', Product: '' },
    { 'Call Sign': 'G6FMU', Product: '' },
    { 'Call Sign': 'g0jrk', Product: '' },
    { 'Call Sign': '', Product: '' },
  ]);
  fs.writeFileSync(path.join(dir, 'source.jsonl'), serialiseClaimsJsonl(emitLedger(source, REF)));
  return dir;
}

describe.skipIf(!duckDbAvailable())('data-quality rollup fold — fixture ledger', { tags: ['unit'] }, () => {
  it('DetectorMatrix_FoldedFromLedger_RelabelsTheFlagAndStatusClaimCounts', () => {
    // Each detector row is the count of its backing flag/status claim: the
    // Excel-date token, the encoding-failure token, the whitespace token and the
    // stripped-collision twin are one each; lowercase catches BOTH the lowercase
    // core and the Excel-date token (which carries lowercase month letters).
    const dir = fixtureLedgerDir();
    try {
      const fold = foldDataQuality(dir);
      expect(fold.dates).toEqual(['2025-01-01']);
      expect(fold.recordCounts.get('2025-01-01')).toBe(7);
      const count = (detector: string): number | undefined => fold.detectors.get(detector)?.get('2025-01-01')?.count;
      expect(count('excelDateShaped')).toBe(1);
      expect(count('encodingFailure')).toBe(1);
      expect(count('whitespaceBearing')).toBe(1);
      expect(count('postNormalisationDuplicates')).toBe(1);
      expect(count('lowercaseBearing')).toBe(2);
      // The flag registry carries the same figures the matrix relabels.
      expect(fold.flags.get('excel-date-shape')?.get('2025-01-01')).toBe(1);
      expect(fold.flags.get('encoding-failure')?.get('2025-01-01')).toBe(1);
      expect(fold.flags.get('whitespace')?.get('2025-01-01')).toBe(1);
      expect(fold.flags.get('stripped-collision')?.get('2025-01-01')).toBe(1);
      expect(fold.flags.get('lowercase')?.get('2025-01-01')).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyBucket_FoldedFromLedger_RecoveredFromAnchorsCarryingNoParseStatus', () => {
    // The blank callsign carries an @listed anchor but no parse_status claim, so
    // its `empty` count is recovered from the anchor — surfacing in the empty
    // detector row (count 1, sole token the blank), the parse-status table, and
    // never inflating the parsed/unparseable counts.
    const dir = fixtureLedgerDir();
    try {
      const fold = foldDataQuality(dir);
      const empty = fold.detectors.get(EMPTY_DETECTOR_KEY)?.get('2025-01-01');
      expect(empty?.count).toBe(1);
      expect(empty?.examples).toEqual(['']);
      expect(fold.parseStatuses.get('empty')?.get('2025-01-01')).toBe(1);
      expect(fold.parseStatuses.get('parsed')?.get('2025-01-01')).toBe(5);
      expect(fold.parseStatuses.get('unparseable')?.get('2025-01-01')).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DetectorExamples_FoldedFromLedger_ExplodeUnprintablesToMarkersFromTheRawToken', () => {
    // The example tokens fold from the flagged observations' RAW subjects, with
    // the replacement character and the space rendered as verbatim {U+XXXX}
    // markers — the phenomenon the example tables exist to make visible.
    const dir = fixtureLedgerDir();
    try {
      const fold = foldDataQuality(dir);
      expect(fold.detectors.get('encodingFailure')?.get('2025-01-01')?.examples).toEqual(['G0ABC{U+FFFD}']);
      expect(fold.detectors.get('whitespaceBearing')?.get('2025-01-01')?.examples).toEqual(['G6{U+0020}FMU']);
      // lowercase lists both offenders, distinct and lexicographically sorted.
      expect(fold.detectors.get('lowercaseBearing')?.get('2025-01-01')?.examples).toEqual(['20-Jan', 'g0jrk']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyLedger_FoldedFromLedger_YieldsAnEmptyRollupWithoutReachingDuckDb', () => {
    // A ledger directory with no per-source JSONL folds to an empty rollup rather
    // than erroring on a glob that matches nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-quality-fold-empty-'));
    try {
      const fold = foldDataQuality(dir);
      expect(fold.dates).toEqual([]);
      expect(fold.flags.size).toBe(0);
      expect(fold.parseStatuses.size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- The durable equivalence oracle -----------------------------------------
//
// The retirement gate for this report (issue #361): the ledger fold is
// SEMANTICALLY equivalent to the legacy stats computation, and the classification
// resolves to ZERO residual byte divergence. The ofcom-amateur normaliser copies
// the callsign VERBATIM and is row-preserving (normalise.ts), so the ledger parses
// the SAME raw token stats.json's detectors saw; the rollup is open-data-only and
// counts records, so the fold reads the identical parse over the identical rows
// and reproduces the committed golden exactly.
//
// The one classified subtlety (data-quality-fold.ts header): the `lowercase-bearing`
// detector tests ASCII `/[a-z]/` while the backing `lowercase` flag fires on any
// case-difference, so the flag is a strict superset. They coincide on the whole
// current corpus, so the fold reproduces the golden byte-for-byte; a future
// non-ASCII case-bearing token would trip the oracle rather than drift silently.

// The dated open-data column keys, newest-first — mirroring the sweep
// (keysWithStats reversed), the columns the committed report carries.
function openDataColumns(): string[] {
  return listArchiveKeys()
    .sort()
    .filter(key => fs.existsSync(path.join(CONSTANTS.DIRS.archive, key, 'stats.json')))
    .reverse();
}

// The stats.json aggregates over the real archive, keyed by date — the legacy
// data-quality rollup reads from these, so the oracle loads them once.
function loadStatsByKey(): Map<string, EntryStats> {
  const byKey = new Map<string, EntryStats>();
  for (const key of listArchiveKeys().sort()) {
    const p = path.join(CONSTANTS.DIRS.archive, key, 'stats.json');
    if (fs.existsSync(p)) byKey.set(key, JSON.parse(fs.readFileSync(p, 'utf8')) as EntryStats);
  }
  return byKey;
}

describe('data-quality rollup — ledger vs legacy equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: recompute the legacy figures live over the real archive (no
  // DuckDB) and render them. Any drift in either path — beyond a regenerated
  // golden — trips here.
  let columns: string[];
  let statsByKey: Map<string, EntryStats>;
  beforeAll(() => {
    columns = openDataColumns();
    statsByKey = loadStatsByKey();
  }, 600_000);

  it('DataQualityReport_LegacyComputation_ReproducesTheCommittedGolden', () => {
    // The load-bearing equivalence assertion for the legacy side: rendering the
    // live legacy computation is byte-identical to the committed report (the
    // fold's output, guarded by the freshness gate).
    expect(renderDataQualityRollup(legacyDataQuality(columns, statsByKey)))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), DATA_QUALITY_PATH), 'utf8'));
  });
});

// The real-archive fold retirement gate: with the pinned DuckDB CLI present (CI
// always; a bare local checkout skips), materialising the ledger and folding it
// must reproduce the committed golden byte-for-byte — the proof the FOLD (not a
// legacy recompute) produces the numbers, so the report can retire the legacy
// path once Phase C arms it.
describe.skipIf(!duckDbAvailable())('data-quality rollup — real-archive fold retirement gate', { tags: ['data-validity'] }, () => {
  let fold: DataQualityFold;
  beforeAll(() => {
    fold = buildDataQualityFold();
  }, 600_000);

  it('DataQualityReport_WhenFoldedFromLedger_ReproducesTheCommittedGoldenByteForByte', () => {
    expect(renderDataQualityRollup(fold))
      .toBe(fs.readFileSync(path.resolve(process.cwd(), DATA_QUALITY_PATH), 'utf8'));
  });

  it('DataQuality_FoldedNeverInvents_RowsSubsetOfLegacyAndCountsNeverExceed', () => {
    // The never-invents direction: every folded flag/status/detector row is one
    // the legacy path also carries, and no folded count exceeds the legacy count
    // for that (row, date). Equal here (zero divergence); an inversion would mean
    // the fold gained records the legacy path lacks.
    const legacy = legacyDataQuality(openDataColumns(), loadStatsByKey());
    const subset = (folded: Map<string, Map<string, number>>, base: Map<string, Map<string, number>>, kind: string): void => {
      for (const [name, byDate] of folded) {
        expect(base.has(name), `folded ${kind} row absent from legacy: ${name}`).toBe(true);
        for (const [date, count] of byDate) {
          expect(count, `${kind} ${name}/${date}`).toBeLessThanOrEqual(base.get(name)?.get(date) ?? 0);
        }
      }
    };
    subset(fold.flags, legacy.flags, 'flag');
    subset(fold.parseStatuses, legacy.parseStatuses, 'status');
    for (const detector of DETECTOR_KEYS) {
      const foldedByDate = fold.detectors.get(detector) ?? new Map<string, DetectorResult>();
      const legacyByDate = legacy.detectors.get(detector) ?? new Map<string, DetectorResult>();
      for (const [date, result] of foldedByDate) {
        expect(result.count, `detector ${detector}/${date}`).toBeLessThanOrEqual(legacyByDate.get(date)?.count ?? 0);
      }
    }
    // The recovered `empty` status is never dropped where the legacy carries it.
    if (legacy.parseStatuses.has('empty')) {
      expect(fold.parseStatuses.has('empty'), 'fold dropped the recovered empty status').toBe(true);
    }
  });
});
