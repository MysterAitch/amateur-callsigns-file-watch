import { describe, it, expect } from 'vitest';
import { computeEntryStats, callsignPattern, renderStatsJson, compareStats, type EntryStats } from './stats.ts';
import { parseJsonObject } from './json-shape.ts';

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

describe('computeEntryStats', { tags: ['unit'] }, () => {
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

  it('CallsignQuality_WhenExcelDateShapedValues_Detected', () => {
    // Observed in the 2023-02-20 and 2025-04-08 publications: intermediate
    // callsigns whose suffix is a month abbreviation (20APR, 21FEB, ...)
    // round-tripped through a spreadsheet and came back as rendered dates.
    const rows = [
      ['20-Apr', '', 'Allocated', '', '', ''],
      ['21-Feb', '', 'Allocated', '', '', ''],
      ['20-Zzz', '', 'Allocated', '', '', ''], // not a month - NOT excel-shaped
      ['M7TEE', '', 'Allocated', '', '', ''],
    ];
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.excelDateShaped.count).toBe(2);
    expect(q.excelDateShaped.examples).toEqual(['20-Apr', '21-Feb']);
  });

  it('CallsignQuality_WhenEncodingFailureCharacter_Detected', () => {
    // U+FFFD (the Unicode replacement character) in a callsign is upstream
    // encoding corruption by construction - observed on the same three
    // licences across the 2023-2025 exports.
    const rows = [
      ['G0TQK\uFFFD', '', 'Allocated', '', '', ''],
      ['M7TEE', '', 'Allocated', '', '', ''],
    ];
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.encodingFailure.count).toBe(1);
    // The replacement character renders as its marker in examples, like
    // every other anomalous codepoint (it is category So, which \p{C}\p{Z}
    // misses - the raw glyph was leaking into report tables).
    expect(q.encodingFailure.examples).toEqual(['G0TQK{U+FFFD}']);
  });

  it('CallsignQuality_WhenWhitespaceBearingValues_DetectedWithVisibleExamples', () => {
    const rows = [
      ['G6 FMU', '', 'Allocated', '', '', ''],
      ['2E1HON\u00A0', '', 'Allocated', '', '', ''],
      ['M7TEE', '', 'Allocated', '', '', ''],
    ];
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.whitespaceBearing.count).toBe(2);
    // Examples carry {U+XXXX} markers - visible immediately, no detective work.
    expect(q.whitespaceBearing.examples).toEqual(['2E1HON{U+00A0}', 'G6{U+0020}FMU']);
  });

  it('CallsignQuality_WhenStrippedFormAlsoExistsAsOwnRow_CountedAsDuplicate', () => {
    // Confirmed double-listings in real publications: the junk-stripped form
    // of an anomalous callsign also exists as its own row - the register
    // effectively lists the callsign twice.
    const rows = [
      ['G0TQK', '', 'Allocated', '', '', ''],
      ['G0TQK\u00A0', '', 'Allocated', '', '', ''],
      ['M/EI-8-DJ', '', 'Allocated', '', '', ''],
      ['M/EI8DJ', '', 'Allocated', '', '', ''],
      ['G6 FMU', '', 'Allocated', '', '', ''], // stripped form G6FMU NOT present - no duplicate
      ['M7TEE', '', 'Allocated', '', '', ''],
    ];
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.postNormalisationDuplicates.count).toBe(2);
    expect(q.postNormalisationDuplicates.examples).toEqual(['G0TQK{U+00A0}', 'M/EI-8-DJ']);
  });

  it('CallsignQuality_WhenEmptyOrLowercaseValues_Counted', () => {
    const rows = [
      ['', '', 'Available', '', '', ''],
      ['g0jrk', '', 'Allocated', '', '', ''],
      ['NaNAAA', '', 'Allocated', '', '', ''], // mixed-case counts as lowercase-bearing
      ['M7TEE', '', 'Allocated', '', '', ''],
    ];
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.emptyCallsign.count).toBe(1);
    expect(q.lowercaseBearing.count).toBe(2);
    expect(q.lowercaseBearing.examples).toEqual(['NaNAAA', 'g0jrk']);
  });

  it('CallsignQuality_WhenCleanData_AllDetectorsZeroWithEmptyExamples', () => {
    const q = computeEntryStats(HEADER, ROWS.slice(0, 3), DATE_COLUMNS).callsignQuality;
    expect(q.excelDateShaped).toEqual({ count: 0, examples: [] });
    expect(q.encodingFailure).toEqual({ count: 0, examples: [] });
    expect(q.whitespaceBearing).toEqual({ count: 0, examples: [] });
    expect(q.postNormalisationDuplicates).toEqual({ count: 0, examples: [] });
    expect(q.emptyCallsign).toEqual({ count: 0, examples: [] });
    expect(q.lowercaseBearing).toEqual({ count: 0, examples: [] });
  });

  it('CallsignQuality_WhenManyOffendingValues_ExamplesCappedAndSorted', () => {
    const rows = Array.from({ length: 9 }, (_, i) => [`m${i}abc`, '', 'Allocated', '', '', '']);
    const q = computeEntryStats(HEADER, rows, DATE_COLUMNS).callsignQuality;
    expect(q.lowercaseBearing.count).toBe(9);
    expect(q.lowercaseBearing.examples).toHaveLength(5);
    expect(q.lowercaseBearing.examples).toEqual([...q.lowercaseBearing.examples].sort());
  });

  it('ComponentAggregates_WhenProvided_FlagAndStatusCountsIncluded', () => {
    // Flags and parse statuses aggregate from component rows when supplied
    // (the converter computes both from the same parse) - counts only; the
    // per-row detail lives in components.csv.
    const components = [
      { parseStatus: 'parsed', flags: ['missing-rsl'] },
      { parseStatus: 'parsed', flags: ['missing-rsl', 'forbidden-suffix'] },
      { parseStatus: 'visitor', flags: [] },
    ];
    const stats = computeEntryStats(HEADER, ROWS.slice(0, 3), DATE_COLUMNS, components);
    expect(stats.callsignFlags).toEqual({ 'forbidden-suffix': 1, 'missing-rsl': 2 });
    expect(stats.parseStatuses).toEqual({ parsed: 2, visitor: 1 });
  });

  it('ComponentAggregates_WhenAbsent_EmptyObjects', () => {
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(stats.callsignFlags).toEqual({});
    expect(stats.parseStatuses).toEqual({});
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

describe('renderStatsJson', { tags: ['unit'] }, () => {
  it('Serialisation_WhenCalledTwice_ByteIdentical', () => {
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    expect(renderStatsJson(stats)).toBe(renderStatsJson(stats));
  });

  it('Serialisation_WhenPatternCountsShift_KeysStayLexicographicallySorted', () => {
    // Diff stability: pattern keys must not reorder when counts change, or
    // every small shift produces a churny stats.json diff.
    const stats = computeEntryStats(HEADER, ROWS, DATE_COLUMNS);
    const roundTripped = parseJsonObject(renderStatsJson(stats), 'renderStatsJson output') as EntryStats;
    const keys = Object.keys(roundTripped.callsignPatterns);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('compareStats', { tags: ['unit'] }, () => {
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
