import { describe, it, expect } from 'vitest';
import { computeEntryStats, callsignPattern, renderStatsJson, compareStats } from './stats';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Entry statistics (issue #46) are a pure derivative of the canonical rows:
// a callsign format taxonomy (uppercase→A, lowercase→a, digit→N, everything
// else preserved) plus per-column distributions. They exist to make data
// anomalies visible at a glance and comparable across publications, so
// determinism and stable serialisation are load-bearing.

const HEADER = ['callsign', 'product', 'status', 'type', 'created_date', 'last_modified_date'];
const DATE_COLUMNS = new Set(['created_date', 'last_modified_date']);

const ROWS = [
  ['M7TEE', 'Amateur Foundation Radio Licence', 'Allocated', 'Call Sign - Amateur', '2019-01-20', '2024-04-21'],
  ['G5ABC', '', 'Available', 'Call Sign - Amateur', '2019-01-21', '2019-01-21'],
  ['20DLQ', 'Amateur Intermediate Radio Licence', 'Allocated', 'Call Sign - Amateur', '2015-05-29', '2025-10-11'],
  ['g0jrk', 'Amateur Full Radio Licence', 'Allocated', 'Call Sign - Amateur', '', ''],
  ['M/#PT2FM', 'Amateur Full Radio Licence', 'Allocated', 'Call Sign - Amateur', '2019-01-20 17:07', '2024-08-03 08:22'],
];

describe('computeEntryStats', () => {
  it('CallsignTaxonomy_WhenMixedFormats_MapsCharacterClassesAndPreservesPunctuation', () => {
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(stats.callsignPatterns['ANAAA']).toBe(2); // M7TEE, G5ABC
    expect(stats.callsignPatterns['NNAAA']).toBe(1); // 20DLQ
    expect(stats.callsignPatterns['aNaaa']).toBe(1); // g0jrk lowercase preserved as 'a'
    expect(stats.callsignPatterns['A/#AANAA']).toBe(1); // M/#PT2FM: slash and hash preserved
    expect(Object.keys(stats.callsignPatterns)).toHaveLength(4);
  });

  it('CallsignTaxonomy_WhenWhitespaceOrUnprintable_MarkedPerCodepointDistinctly', () => {
    // Whitespace in a callsign is unambiguously invalid; each offending
    // codepoint appears as a printable {U+XXXX} marker IN the pattern -
    // visible immediately, and space vs NBSP vs tab stay distinct rows.
    // Markers substitute after the letter/digit mappings, so their own
    // letters are never re-mapped.
    expect(callsignPattern('M7 TEE')).toBe('AN{U+0020}AAA');
    expect(callsignPattern('M7TEE\u00A0')).toBe('ANAAA{U+00A0}'); // trailing NBSP (observed live)
    expect(callsignPattern('M7\tTEE')).toBe('AN{U+0009}AAA');
    expect(callsignPattern('M7TEE\u200B')).toBe('ANAAA{U+200B}'); // zero-width space
    expect(callsignPattern('M7 TEE')).not.toBe(callsignPattern('M7\u00A0TEE'));
  });

  it('ColumnStats_WhenStringColumn_ReportsDistinctEmptyAndLengthRangeOverNonEmptyValues', () => {
    // distinct and length range deliberately consider non-empty values only;
    // emptiness is its own counter (a column with many empties would
    // otherwise always report minLength 0, hiding the real value range).
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(stats.columns['product']).toEqual({
      distinct: 3,
      empty: 1,
      minLength: 'Amateur Full Radio Licence'.length,
      maxLength: 'Amateur Intermediate Radio Licence'.length,
    });
  });

  it('ColumnStats_WhenDateColumn_ReportsMinMaxValues', () => {
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(stats.columns['created_date']).toEqual({
      distinct: 4,
      empty: 1,
      min: '2015-05-29',
      max: '2019-01-21',
    });
  });

  it('RecordCount_MatchesRowCount', () => {
    expect(computeEntryStats(HEADER, ROWS, DATE_COLUMNS).recordCount).toBe(5);
  });
});

describe('renderStatsJson', () => {
  it('Serialisation_WhenCalledTwice_ByteIdentical', () => {
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(renderStatsJson(stats)).toBe(renderStatsJson(stats));
  });

  it('Serialisation_WhenPatternCountsShift_KeysStayLexicographicallySorted', () => {
    // Diff stability: pattern keys must not reorder when counts change, or
    // every small shift produces a churny stats.json diff.
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    const keys = Object.keys(JSON.parse(renderStatsJson(stats)).callsignPatterns);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('compareStats', () => {
  it('Comparison_WhenNeighbourDiffers_ReportsRecordCountDeltaAndPatternChanges', () => {
    const a = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    const b = computeEntryStats(HEADER, ROWS.slice(0, 3), DATE_COLUMNS); // drops g0jrk + M/#PT2FM
    const cmp = compareStats(a, b);
    expect(cmp.recordCountDeltaPct).toBeCloseTo(((5 - 3) / 3) * 100, 5);
    expect(cmp.newPatterns).toEqual(['A/#AANAA', 'aNaaa']);
    expect(cmp.lostPatterns).toEqual([]);
  });

  it('Comparison_WhenNeighbourIdentical_ReportsNoChanges', () => {
    const a = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    const cmp = compareStats(a, a);
    expect(cmp.recordCountDeltaPct).toBe(0);
    expect(cmp.newPatterns).toEqual([]);
    expect(cmp.lostPatterns).toEqual([]);
  });
});
