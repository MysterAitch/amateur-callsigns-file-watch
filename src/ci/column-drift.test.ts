import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_DRIFT_PARAMS,
  DRIFT_KIND_GLOSSES,
  CANDIDATE_EXPLANATIONS,
  CHAR_CLASSES,
  detectDrift,
  foldVintageFingerprint,
  renderColumnDrift,
  computeColumnDrift,
  type CharClass,
  type ColumnFingerprint,
  type DriftKind,
  type DriftParams,
  type VintageFingerprint,
} from './column-drift.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #862: per-column, per-vintage distribution fingerprints and the
// vintage-over-vintage divergence detector. Test names follow
// Subject_Scenario_Outcome. The pure detector cases below are the user-facing
// guarantees — a shape change is flagged with a named measure and candidate
// explanations, and no verdict — exercised over hand-built fingerprints so no
// DuckDB is needed; the fold case verifies the SQL fingerprint over a real
// (tiny) normalised.csv.

// A lowered shape floor so small synthetic fixtures trip the shape measures
// the real-corpus default (100) deliberately guards against.
const TEST_PARAMS: DriftParams = { ...DEFAULT_DRIFT_PARAMS, minPopulatedForShape: 4 };

// Build a fingerprint from a value list, computing the counts the SQL fold
// would — so a test states a column's values and the detector sees the same
// shape the corpus fold produces.
function fingerprintOf(vintage: string, column: string, values: readonly string[]): ColumnFingerprint {
  const populated = values.filter(v => v.trim() !== '');
  const nonBlank = populated.map(v => v);
  const classCounts = {} as Record<CharClass, number>;
  const classTest: Record<CharClass, RegExp> = {
    digit: /[0-9]/, upper: /[A-Z]/, lower: /[a-z]/, space: /\s/,
    punct: /[!-/:-@[-`{-~]/, nonascii: /[^\x00-\x7F]/,
  };
  for (const cls of CHAR_CLASSES) classCounts[cls] = nonBlank.filter(v => classTest[cls].test(v)).length;
  const charContain = new Map<string, number>();
  for (const v of nonBlank) {
    for (const ch of new Set(v)) charContain.set(ch, (charContain.get(ch) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const v of nonBlank) counts.set(v, (counts.get(v) ?? 0) + 1);
  const lengths = nonBlank.map(v => v.length);
  return {
    vintage,
    column,
    rows: values.length,
    populated: populated.length,
    blank: values.length - populated.length,
    cardinality: counts.size,
    lengthMin: lengths.length === 0 ? null : Math.min(...lengths),
    lengthMax: lengths.length === 0 ? null : Math.max(...lengths),
    lengthMean: lengths.length === 0 ? null : Number((lengths.reduce((s, n) => s + n, 0) / lengths.length).toFixed(4)),
    classCounts,
    charProfile: [...charContain.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([char, count]) => ({ char, count })),
    topValues: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, DEFAULT_DRIFT_PARAMS.valueHistogramDepth).map(([value, count]) => ({ value, count })),
  };
}

function twoVintages(prev: ColumnFingerprint, cur: ColumnFingerprint): VintageFingerprint[] {
  return [{ vintage: prev.vintage, columns: [prev] }, { vintage: cur.vintage, columns: [cur] }];
}

function kinds(prev: ColumnFingerprint, cur: ColumnFingerprint): DriftKind[] {
  return detectDrift(twoVintages(prev, cur), TEST_PARAMS).map(s => s.kind);
}

describe('column-drift — the pure divergence detector', { tags: ['unit'] }, () => {
  it('Column_WhenPreviouslyBlankGainsValues_FlagsColumnPopulatedOnly', () => {
    const prev = fingerprintOf('v1', 'product', ['', '', '', '', '']);
    const cur = fingerprintOf('v2', 'product', ['Full', 'Foundation', 'Full', 'Club', 'Full']);
    expect(kinds(prev, cur)).toEqual(['column-populated']);
  });

  it('Column_WhenPopulatedBecomesBlank_FlagsColumnEmptiedOnly', () => {
    const prev = fingerprintOf('v1', 'type', ['A', 'A', 'A', 'A', 'A']);
    const cur = fingerprintOf('v2', 'type', ['', '', '', '', '']);
    expect(kinds(prev, cur)).toEqual(['column-emptied']);
  });

  it('BlankShare_WhenACohortOfRowsLosesTheField_FlagsBlankShareShift', () => {
    // A tenth of rows go blank — the blank-product pool shrinking shape.
    const prev = fingerprintOf('v1', 'product', Array.from({ length: 20 }, () => 'Full'));
    const cur = fingerprintOf('v2', 'product', [...Array.from({ length: 18 }, () => 'Full'), '', '']);
    const signals = detectDrift(twoVintages(prev, cur), TEST_PARAMS);
    const blank = signals.find(s => s.kind === 'blank-share-shift');
    expect(blank).toBeDefined();
    expect(blank?.detail).toContain('0.0% -> 10.0%');
  });

  it('Cardinality_WhenDistinctValuesMoreThanDouble_FlagsCardinalityShift', () => {
    const prev = fingerprintOf('v1', 'callsign', ['A', 'A', 'B', 'B', 'A']);
    const cur = fingerprintOf('v2', 'callsign', ['A', 'B', 'C', 'D', 'E', 'F']);
    expect(kinds(prev, cur)).toContain('cardinality-shift');
  });

  it('Length_WhenMeanValueLengthShiftsByAWholeCharacter_FlagsLengthShift', () => {
    // A date-rendering change: bare ISO day to a datetime with a time-of-day.
    const prev = fingerprintOf('v1', 'created_date', ['2016-07-23', '2016-08-12', '2016-08-02', '2018-01-01']);
    const cur = fingerprintOf('v2', 'created_date', ['2016-07-23 16:26', '2016-08-12 09:10', '2016-08-02 11:00', '2018-01-01 00:00']);
    const found = kinds(prev, cur);
    expect(found).toContain('length-shift');
    // The added ':' and space are a char-class shift and characters appearing.
    expect(found).toContain('char-class-shift');
    expect(found).toContain('character-appeared');
  });

  it('Character_WhenACohortEndingInACharacterIsOmitted_FlagsCharacterVanished', () => {
    // The Z-suffix omission shape: every value carrying Z disappears.
    const prev = fingerprintOf('v1', 'callsign', ['M0AAZ', 'M0AAA', 'M0AAB', 'G1ZZZ', 'G1AAA']);
    const cur = fingerprintOf('v2', 'callsign', ['M0AAA', 'M0AAB', 'M0AAC', 'G1AAA', 'G1AAB']);
    const signals = detectDrift(twoVintages(prev, cur), TEST_PARAMS);
    const vanished = signals.find(s => s.kind === 'character-vanished');
    expect(vanished).toBeDefined();
    expect(vanished?.detail).toContain('character `Z`');
    // And when the cohort returns, the character re-appears.
    const back = detectDrift(twoVintages(cur, fingerprintOf('v3', 'callsign', ['M0AAZ', 'G1ZZZ', 'M0AAA', 'M0AAB', 'G1AAA'])), TEST_PARAMS);
    expect(back.some(s => s.kind === 'character-appeared' && s.detail.includes('`Z`'))).toBe(true);
  });

  it('CharacterVanished_WhenAContaminantIsCleaned_RendersNonPrintableAsMarker', () => {
    // A non-breaking space contaminating half the values, then cleaned.
    const prev = fingerprintOf('v1', 'callsign', ['M0AAA ', 'M0AAB ', 'M0AAC', 'M0AAD']);
    const cur = fingerprintOf('v2', 'callsign', ['M0AAA', 'M0AAB', 'M0AAC', 'M0AAD']);
    const vanished = detectDrift(twoVintages(prev, cur), TEST_PARAMS).find(s => s.kind === 'character-vanished');
    expect(vanished?.detail).toContain('U+00A0');
  });

  it('ValueDistribution_WhenCategorySharesReweight_FlagsValueDistributionShift', () => {
    const prev = fingerprintOf('v1', 'status', [...Array.from({ length: 8 }, () => 'Allocated'), 'Reserved', 'Reserved']);
    const cur = fingerprintOf('v2', 'status', [...Array.from({ length: 3 }, () => 'Allocated'), ...Array.from({ length: 7 }, () => 'Reserved')]);
    expect(kinds(prev, cur)).toContain('value-distribution-shift');
  });

  it('NovelValue_WhenANewCategoryAppears_FlagsNovelValueNotRetired', () => {
    const prev = fingerprintOf('v1', 'product', ['Full', 'Full', 'Foundation', 'Foundation', 'Full']);
    const cur = fingerprintOf('v2', 'product', ['Full', 'Foundation', 'Intermediate', 'Intermediate', 'Full']);
    const signals = detectDrift(twoVintages(prev, cur), TEST_PARAMS);
    expect(signals.some(s => s.kind === 'novel-value' && s.detail.includes('Intermediate'))).toBe(true);
    expect(signals.some(s => s.kind === 'retired-value')).toBe(false);
  });

  it('RetiredValue_WhenACategoryWithdraws_FlagsRetiredValue', () => {
    const prev = fingerprintOf('v1', 'product', ['Full', 'Foundation', 'SES', 'SES', 'Full']);
    const cur = fingerprintOf('v2', 'product', ['Full', 'Foundation', 'Full', 'Foundation', 'Full']);
    const signals = detectDrift(twoVintages(prev, cur), TEST_PARAMS);
    expect(signals.some(s => s.kind === 'retired-value' && s.detail.includes('SES'))).toBe(true);
  });

  it('HighCardinalityColumn_WhenValuesTurnOver_DoesNotFlagNovelOrRetiredValues', () => {
    // Fresh callsigns every vintage are the norm above the categorical cap, so
    // per-value novelty must stay silent there (only shape measures apply).
    const prev = fingerprintOf('v1', 'callsign', Array.from({ length: 80 }, (_, i) => `A${i}`));
    const cur = fingerprintOf('v2', 'callsign', Array.from({ length: 80 }, (_, i) => `B${i}`));
    const found = kinds(prev, cur);
    expect(found).not.toContain('novel-value');
    expect(found).not.toContain('retired-value');
    expect(found).not.toContain('value-distribution-shift');
  });

  it('ShapeMeasures_WhenAPopulationIsTiny_StayQuietBelowTheFloor', () => {
    // Below minPopulatedForShape the shape measures do not fire (a majority of
    // a handful of rows is not a distribution) — only coverage/blank signals.
    const prev = fingerprintOf('v1', 'callsign', ['AAAA', 'BBBB', 'CCCC']);
    const cur = fingerprintOf('v2', 'callsign', ['1111', '2222', '3333']);
    const strict: DriftParams = { ...DEFAULT_DRIFT_PARAMS, minPopulatedForShape: 100 };
    expect(detectDrift(twoVintages(prev, cur), strict)).toEqual([]);
  });

  it('SignalOrdering_AcrossColumnsAndVintages_IsTotalAndDeterministic', () => {
    // The detector output order must be stable so the committed report is
    // byte-deterministic: column, then to-vintage, then from-vintage, then
    // kind order, then detail.
    const fps: VintageFingerprint[] = [
      { vintage: 'v1', columns: [fingerprintOf('v1', 'product', ['', '', '', '', '']), fingerprintOf('v1', 'status', ['A', 'A', 'B', 'B', 'A'])] },
      { vintage: 'v2', columns: [fingerprintOf('v2', 'product', ['Full', 'Foundation', 'Full', 'Club', 'Full']), fingerprintOf('v2', 'status', [...Array.from({ length: 4 }, () => 'B'), 'A'])] },
    ];
    const once = detectDrift(fps, TEST_PARAMS);
    const twice = detectDrift(fps, TEST_PARAMS);
    expect(once).toEqual(twice);
    const columns = once.map(s => s.column);
    expect(columns).toEqual([...columns].sort());
  });

  it('Vocabulary_EveryDriftKind_HasAGlossAndCandidateExplanations', () => {
    // Flag-don't-adjudicate is structural: every kind carries a reader-facing
    // gloss and at least two candidate explanations, none a verdict.
    const kindsSeen = new Set<DriftKind>();
    for (const [kind, gloss] of DRIFT_KIND_GLOSSES) {
      kindsSeen.add(kind);
      expect(gloss.length).toBeGreaterThan(10);
      const candidates = CANDIDATE_EXPLANATIONS.get(kind);
      expect(candidates?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
    // Every detector-emittable kind is documented.
    const prev = fingerprintOf('v1', 'product', ['', '', '', '', '']);
    const cur = fingerprintOf('v2', 'product', ['Full', 'Foundation', 'Full', 'Club', 'Full']);
    for (const s of detectDrift(twoVintages(prev, cur), TEST_PARAMS)) expect(kindsSeen.has(s.kind)).toBe(true);
  });

  it('RenderedValue_WhenAValueCarriesABackslashOrEscapedPipe_StaysASingleWellFormedTableCell', () => {
    // A hostile register value — one carrying a lone backslash, and one
    // carrying the sequence `\|` — must not neutralise the table-cell escaping
    // and split a divergence row into phantom cells (the incomplete-
    // sanitisation class the report-sweep mdCell tests guard elsewhere).
    const prev = fingerprintOf('v1', 'product', ['Full', 'Full', 'Foundation', 'Foundation', 'Full']);
    const cur = fingerprintOf('v2', 'product', ['Full', 'Foundation', 'A\\B', 'A\\|B', 'Full']);
    const signals = detectDrift(twoVintages(prev, cur), TEST_PARAMS);
    const report = renderColumnDrift({ params: TEST_PARAMS, fingerprints: twoVintages(prev, cur), signals });

    // The flagged-divergences table (| column | from | to | measure | detail |
    // magnitude |) has six columns, so a well-formed row splits into eight
    // parts on the delimiters once the escaped sequences are removed.
    const cellCount = (row: string): number => row.replace(/\\\\/g, '').replace(/\\\|/g, '').split('|').length;
    // Match the divergence-table rows by their kind CELL (`| novel-value |`),
    // not a bare substring — the parameters table also mentions the term.
    const novelRows = report.split('\n').filter(l => l.includes('| novel-value |'));
    expect(novelRows.length).toBeGreaterThanOrEqual(2);
    for (const row of novelRows) expect(cellCount(row)).toBe(8);

    // The backslash is doubled and the pipe is backslash-escaped; no bare pipe
    // from a value survives to delimit a phantom cell.
    expect(report).toContain('A\\\\B');   // A\B      -> A\\B
    expect(report).toContain('A\\\\\\|B'); // A\|B     -> A\\ then \|  => A\\\|B
    expect(report).not.toContain('`A|B`'); // never an unescaped bare pipe
  });
});

// The SQL fingerprint fold over a real (tiny) normalised.csv — gated on the
// pinned DuckDB CLI, skipped rather than failing where it is absent.
describe.skipIf(!duckDbAvailable())('column-drift — the fingerprint fold', { tags: ['unit'] }, () => {
  const HEADER = 'callsign,product,status,type,created_date,last_modified_date,licence_version_last_modified_date,licence_version_original_start_date';

  function foldCsv(body: string): Map<string, ColumnFingerprint> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'column-drift-fold-'));
    try {
      const file = path.join(dir, 'normalised.csv');
      fs.writeFileSync(file, `${HEADER}\n${body}`);
      const columns = foldVintageFingerprint({ vintage: 'v-test', file });
      return new Map(columns.map(c => [c.column, c]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('Fingerprint_OverANormalisedCsv_CountsPopulatedBlankAndCardinality', () => {
    const fp = foldCsv([
      'M7TEE,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,2025-10-11,2016-07-30',
      'G5ABC,,Available,Call Sign - Amateur,,,2025-10-11,2016-07-31',
      'M0XYZ,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,2026-02-13,2016-07-30',
    ].join('\n'));
    const product = fp.get('product');
    expect(product).toMatchObject({ rows: 3, populated: 2, blank: 1, cardinality: 1 });
    const callsign = fp.get('callsign');
    expect(callsign).toMatchObject({ rows: 3, populated: 3, blank: 0, cardinality: 3 });
    // The mass-update fingerprint: one modification day dominates.
    const lvm = fp.get('licence_version_last_modified_date');
    expect(lvm?.topValues[0]).toEqual({ value: '2025-10-11', count: 2 });
  });

  it('Fingerprint_CharacterProfile_CapturesContainmentPerCharacter', () => {
    const fp = foldCsv([
      'M0AAZ,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,,',
      'M0AAA,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,,',
      'g1abc,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,,',
    ].join('\n'));
    const callsign = fp.get('callsign');
    const zEntry = callsign?.charProfile.find(c => c.char === 'Z');
    expect(zEntry?.count).toBe(1);
    // The lowercase contaminant is counted in the char-class profile.
    expect(callsign?.classCounts.lower).toBe(1);
    expect(callsign?.classCounts.upper).toBe(2);
  });

  it('ComputeColumnDrift_OverTwoSyntheticVintages_FoldsAndFlagsEndToEnd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'column-drift-e2e-'));
    try {
      const files = ['2026-01-01', '2026-02-02'].map(vintage => {
        const file = path.join(dir, `${vintage}.csv`);
        return { vintage, file };
      });
      // v1: every callsign carries a Z; v2: the Z cohort is omitted.
      fs.writeFileSync(files[0].file, `${HEADER}\n` + Array.from({ length: 10 }, (_, i) => `M0AA${i}Z,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,,`).join('\n') + '\n');
      fs.writeFileSync(files[1].file, `${HEADER}\n` + Array.from({ length: 10 }, (_, i) => `M0AA${i}A,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,,,`).join('\n') + '\n');
      const drift = computeColumnDrift(files, { ...DEFAULT_DRIFT_PARAMS, minPopulatedForShape: 4 });
      expect(drift.fingerprints).toHaveLength(2);
      expect(drift.signals.some(s => s.column === 'callsign' && s.kind === 'character-vanished' && s.detail.includes('`Z`'))).toBe(true);
      // The rendered report is non-empty and names the flag.
      expect(renderColumnDrift(drift)).toContain('character-vanished');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
