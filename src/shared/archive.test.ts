import { describe, it, expect } from 'vitest';
import {
  parseOfcomHumanDate,
  extractOfcomDateFromCommitMessage,
  archiveKeyForDate,
  buildDiffSummary,
} from './archive.ts';

describe('parseOfcomHumanDate', () => {
  it('ParseOfcomHumanDate_WhenGivenTypicalOfcomDate_ReturnsIsoDate', () => {
    expect(parseOfcomHumanDate('23 June 2026')).toBe('2026-06-23');
  });

  it('ParseOfcomHumanDate_WhenGivenSingleDigitDay_ReturnsZeroPaddedIsoDate', () => {
    expect(parseOfcomHumanDate('4 June 2025')).toBe('2025-06-04');
  });

  it('ParseOfcomHumanDate_WhenGivenAnyMonthName_ParsesCorrectly', () => {
    expect(parseOfcomHumanDate('1 January 2020')).toBe('2020-01-01');
    expect(parseOfcomHumanDate('31 December 2025')).toBe('2025-12-31');
  });

  it('ParseOfcomHumanDate_WhenGivenMixedCaseMonth_ParsesCorrectly', () => {
    expect(parseOfcomHumanDate('15 MARCH 2024')).toBe('2024-03-15');
    expect(parseOfcomHumanDate('15 march 2024')).toBe('2024-03-15');
  });

  it('ParseOfcomHumanDate_WhenGivenEmptyOrUndefined_ReturnsUndefined', () => {
    expect(parseOfcomHumanDate(undefined)).toBeUndefined();
    expect(parseOfcomHumanDate(null)).toBeUndefined();
    expect(parseOfcomHumanDate('')).toBeUndefined();
  });

  it('ParseOfcomHumanDate_WhenGivenUnrecognisedFormat_ReturnsUndefined', () => {
    // We refuse to guess - unparseable input is honestly returned as unknown.
    expect(parseOfcomHumanDate('June 23, 2026')).toBeUndefined();
    expect(parseOfcomHumanDate('23/06/2026')).toBeUndefined();
    expect(parseOfcomHumanDate('2026-06-23')).toBeUndefined();
  });

  it('ParseOfcomHumanDate_WhenGivenInvalidMonthName_ReturnsUndefined', () => {
    expect(parseOfcomHumanDate('23 Junuary 2026')).toBeUndefined();
  });

  it('ParseOfcomHumanDate_WhenGivenOutOfRangeDay_ReturnsUndefined', () => {
    expect(parseOfcomHumanDate('0 June 2026')).toBeUndefined();
    expect(parseOfcomHumanDate('32 June 2026')).toBeUndefined();
  });

  it('ParseOfcomHumanDate_WhenGivenSurroundingWhitespace_StillParses', () => {
    expect(parseOfcomHumanDate('  23 June 2026  ')).toBe('2026-06-23');
  });
});

describe('extractOfcomDateFromCommitMessage', () => {
  it('ExtractOfcomDate_WhenCommitMessageMatchesLiveCommitFormat_ReturnsIsoDate', () => {
    const msg = 'Update amateur callsigns CSV (Ofcom updated: 23 June 2026), size: 11.27MB';
    expect(extractOfcomDateFromCommitMessage(msg)).toBe('2026-06-23');
  });

  it('ExtractOfcomDate_WhenCommitMessageHasNoDateMarker_ReturnsUndefined', () => {
    expect(extractOfcomDateFromCommitMessage('Update amateur callsigns CSV file')).toBeUndefined();
  });

  it('ExtractOfcomDate_WhenCommitMessageIsEmpty_ReturnsUndefined', () => {
    expect(extractOfcomDateFromCommitMessage('')).toBeUndefined();
  });

  it('ExtractOfcomDate_WhenMarkerPresentButDateIsUnparseable_ReturnsUndefined', () => {
    const msg = 'Update amateur callsigns CSV (Ofcom updated: gibberish), size: whatever';
    expect(extractOfcomDateFromCommitMessage(msg)).toBeUndefined();
  });
});

describe('archiveKeyForDate', () => {
  it('ArchiveKey_WhenOfcomDateKnown_PrefersOfcomDate', () => {
    expect(archiveKeyForDate('2026-06-23', '2026-07-04')).toBe('2026-06-23');
  });

  it('ArchiveKey_WhenOfcomDateUndefined_FallsBackToProvidedDate', () => {
    expect(archiveKeyForDate(undefined, '2026-07-04')).toBe('2026-07-04');
  });

  it('ArchiveKey_WhenOfcomDateEmptyString_FallsBackToProvidedDate', () => {
    // Empty string is treated as "no Ofcom date" - avoids "" as a directory name.
    expect(archiveKeyForDate('', '2026-07-04')).toBe('2026-07-04');
    expect(archiveKeyForDate('   ', '2026-07-04')).toBe('2026-07-04');
  });
});

describe('buildDiffSummary', () => {
  const currentRecords = [
    { Callsign: 'M0AAA', Product: 'A', Status: 'Active' },
    { Callsign: 'M0BBB', Product: 'A', Status: 'Active' },
    { Callsign: 'M0CCC', Product: 'A', Status: 'Active' },
  ];

  it('BuildDiff_WhenNoPreviousArchiveExists_ReturnsCountOnlySummary', () => {
    const diff = buildDiffSummary(currentRecords, null, undefined);
    expect(diff.currentRecordCount).toBe(3);
    expect(diff.previousRecordCount).toBeUndefined();
    expect(diff.added).toBeUndefined();
    expect(diff.removed).toBeUndefined();
    expect(diff.previousArchiveKey).toBeUndefined();
  });

  it('BuildDiff_WhenIdenticalRecords_ReportsAllUnchanged', () => {
    const diff = buildDiffSummary(currentRecords, currentRecords, '2025-01-01');
    expect(diff.unchanged).toBe(3);
    expect(diff.fieldChanged).toBe(0);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.previousArchiveKey).toBe('2025-01-01');
  });

  it('BuildDiff_WhenRecordFieldsChanged_ReportsFieldChangedCount', () => {
    const previous = [
      { Callsign: 'M0AAA', Product: 'A', Status: 'Active' },
      { Callsign: 'M0BBB', Product: 'A', Status: 'Suspended' }, // status differs
      { Callsign: 'M0CCC', Product: 'A', Status: 'Active' },
    ];
    const diff = buildDiffSummary(currentRecords, previous, 'prev');
    expect(diff.unchanged).toBe(2);
    expect(diff.fieldChanged).toBe(1);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it('BuildDiff_WhenNewCallsignsAppear_ReportsAddedCountAndSamples', () => {
    const previous = [
      { Callsign: 'M0AAA', Product: 'A', Status: 'Active' },
    ];
    const diff = buildDiffSummary(currentRecords, previous, 'prev');
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(diff.sampleAdded).toEqual(['M0BBB', 'M0CCC']);
  });

  it('BuildDiff_WhenCallsignsRemoved_ReportsRemovedCountAndSamples', () => {
    const previous = [
      { Callsign: 'M0AAA', Product: 'A', Status: 'Active' },
      { Callsign: 'M0BBB', Product: 'A', Status: 'Active' },
      { Callsign: 'M0CCC', Product: 'A', Status: 'Active' },
      { Callsign: 'M0DDD', Product: 'A', Status: 'Active' }, // gone
      { Callsign: 'M0EEE', Product: 'A', Status: 'Active' }, // gone
    ];
    const diff = buildDiffSummary(currentRecords, previous, 'prev');
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(2);
    expect(diff.sampleRemoved).toEqual(['M0DDD', 'M0EEE']);
  });

  it('BuildDiff_WhenSampleCountExceedsCap_TruncatesSampleArray', () => {
    const previous = [{ Callsign: 'M0AAA', Product: 'A', Status: 'Active' }];
    const manyAdded = [
      { Callsign: 'A', Product: 'X', Status: 'Y' },
      { Callsign: 'B', Product: 'X', Status: 'Y' },
      { Callsign: 'C', Product: 'X', Status: 'Y' },
      { Callsign: 'D', Product: 'X', Status: 'Y' },
      { Callsign: 'E', Product: 'X', Status: 'Y' },
      { Callsign: 'F', Product: 'X', Status: 'Y' },
      { Callsign: 'G', Product: 'X', Status: 'Y' },
    ];
    const diff = buildDiffSummary(manyAdded, previous, 'prev', 3);
    expect(diff.added).toBe(7); // total count is accurate
    expect(diff.sampleAdded).toHaveLength(3); // samples are capped
  });

  it('BuildDiff_WhenRowsAreReorderedButOtherwiseIdentical_ReportsAllUnchanged', () => {
    // Ofcom's row order is not stable across publications. The semantic diff
    // must NOT report churn just because rows moved.
    const reordered = [
      { Callsign: 'M0CCC', Product: 'A', Status: 'Active' },
      { Callsign: 'M0AAA', Product: 'A', Status: 'Active' },
      { Callsign: 'M0BBB', Product: 'A', Status: 'Active' },
    ];
    const diff = buildDiffSummary(reordered, currentRecords, 'prev');
    expect(diff.unchanged).toBe(3);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.fieldChanged).toBe(0);
  });
});
