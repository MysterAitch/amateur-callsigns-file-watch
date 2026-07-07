import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  convertFoiCsv,
  convertFoiEntry,
  conversionFor,
  normalisedFileNameFor,
  slugifyBasename,
  FOI_NORMALISED_SCHEMA_VERSION,
} from './foi-normalise.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The FOI CSV normaliser (issue #139, tier 1): deterministic converters for
// the CSV-native FOI entries. Every normalised row is an observation - the
// source's assertion at its vintage, never an inferred complement. Blank
// statuses are preserved (they are data), whitespace (including non-breaking
// spaces) is trimmed and COUNTED rather than silently discarded, and columns
// are identified by header NAME, never by position.

const WDTK_VARIANT = 'wdtk-1180568-csv-pair';
const OFCOM_VARIANT = 'ofcom-756622-register-and-forbidden';
const SHEET_1 = 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv';
const SHEET_2 = 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 2.csv';
const REGISTER_20190912 = 'allocated-reserved-forbidden-call-sign-foi-20190912.csv';
const FORBIDDEN = 'allocated-reserved-forbidden-call-sign.csv';

// Invisible characters used by fixtures, named so their presence is visible
// in the test source and safe from silent editor normalisation.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);

// The sources are served with a UTF-8 BOM (wdtk sheets) and CRLF endings;
// synthetic fixtures reproduce that framing so the tests exercise the same
// decode path as the archived bytes.
function utf8BomCrlf(lines: string[]): Buffer {
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8');
}

const sheet1 = conversionFor(WDTK_VARIANT, SHEET_1);
const sheet2 = conversionFor(WDTK_VARIANT, SHEET_2);
const register = conversionFor(OFCOM_VARIANT, REGISTER_20190912);
const forbidden = conversionFor(OFCOM_VARIANT, FORBIDDEN);

describe('FOI CSV normaliser - column mapping and row order', () => {
  it('FoiNormaliser_Sheet1Rows_MapToObservationSchemaSortedByCallsign', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M0IVB,Allocated,Call Sign - Amateur,',
      'M5TX,Available,Call Sign - Amateur,21/01/2019',
      'G5YTT,Reserved,Call Sign - Amateur,15/10/2029',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.csv).toBe(
      'callsign,status,licence_class,reserved_to_date\n' +
      'G5YTT,Reserved,,2029-10-15\n' +
      'M0IVB,Allocated,,\n' +
      'M5TX,Available,,2019-01-21\n');
    expect(result.recordCount).toBe(3);
    expect(result.schemaVersion).toBe(FOI_NORMALISED_SCHEMA_VERSION);
  });

  it('FoiNormaliser_Sheet1TypeColumn_DroppedFromOutput', () => {
    // 'Type' is constant ('Call Sign - Amateur') across the whole sheet - a
    // product discriminator recorded in meta.json, not a per-row assertion.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M0IVB,Allocated,Call Sign - Amateur,',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.csv).not.toContain('Call Sign - Amateur');
  });

  it('FoiNormaliser_Sheet2Rows_MapToAttributeSchemaWithVerbatimLicenceType', () => {
    // licence_class carries the source's own vocabulary verbatim ('Amateur
    // Foundation Radio Licence', not a canonicalised 'Foundation').
    const input = utf8BomCrlf([
      'Created Date,Status,Call Sign,Original start date,Licence Type',
      '24/02/2024 00:05,Live,M7MPK,01/08/2019,Amateur Foundation Radio Licence',
      '13/02/2019 08:40,Live,20DLQ,29/05/2015,Amateur Intermediate Radio Licence',
    ]);
    const result = convertFoiCsv(input, sheet2);
    expect(result.csv).toBe(
      'callsign,status,licence_class,created_date,original_start_date\n' +
      '20DLQ,Live,Amateur Intermediate Radio Licence,2019-02-13 08:40,2015-05-29\n' +
      'M7MPK,Live,Amateur Foundation Radio Licence,2024-02-24 00:05,2019-08-01\n');
  });

  it('FoiNormaliser_RegisterVariant_PreservesSourceRowOrder', () => {
    // The 2019-09-12 register is sorted by issued date ascending - a
    // meaningful publication order (the earliest bulk disclosure of
    // per-callsign issue dates) - so the converter must NOT re-sort it.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G4IFJ,Allocated,Full,03/05/1903\r\n' +
      'G8UYK,Allocated,Full,04/02/1904\r\n' +
      '2E1AAA,Reserved,Intermediate,\r\n', 'latin1');
    const result = convertFoiCsv(input, register);
    expect(result.csv).toBe(
      'callsign,status,licence_class,licence_issued_date\n' +
      'G4IFJ,Allocated,Full,1903-05-03\n' +
      'G8UYK,Allocated,Full,1904-02-04\n' +
      '2E1AAA,Reserved,Intermediate,\n');
  });

  it('FoiNormaliser_ForbiddenList_OutputsSortedSuffixColumn', () => {
    // Forbidden entries are three-letter SUFFIXES, not callsigns - a
    // different shape by design (issue #139).
    const input = Buffer.from('NAME\r\nBOG\r\nADS\r\n', 'latin1');
    const result = convertFoiCsv(input, forbidden);
    expect(result.csv).toBe('suffix\nADS\nBOG\n');
  });

  it('FoiNormaliser_ColumnOrderShuffled_MapsByHeaderNameNotPosition', () => {
    // Columns are identified by NAME: a source column reorder must produce
    // identical output (this is the fix for the sort-key vulnerability).
    const canonicalOrder = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,21/01/2019',
    ]);
    const shuffledOrder = utf8BomCrlf([
      'Reserved to Date,Type,Status,Value',
      '21/01/2019,Call Sign - Amateur,Available,M5TX',
    ]);
    expect(convertFoiCsv(shuffledOrder, sheet1).csv).toBe(convertFoiCsv(canonicalOrder, sheet1).csv);
  });
});

describe('FOI CSV normaliser - value preservation', () => {
  it('FoiNormaliser_RegisterCsvWithBlankStatus_PreservesEmptyStatus', () => {
    // Six blank statuses exist in the real 2019 register - they are data
    // (the source asserts the callsign with no status), never dropped or
    // backfilled.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G0DBP,,Full,\r\n' +
      'M0KXY,,Full,\r\n' +
      'G4IFJ,Allocated,Full,03/05/1903\r\n', 'latin1');
    const result = convertFoiCsv(input, register);
    expect(result.csv).toBe(
      'callsign,status,licence_class,licence_issued_date\n' +
      'G0DBP,,Full,\n' +
      'M0KXY,,Full,\n' +
      'G4IFJ,Allocated,Full,1903-05-03\n');
    expect(result.notes.blankCounts['status']).toBe(2);
  });

  it('FoiNormaliser_CallsignWithTrailingNbsp_TrimsAndReportsCount', () => {
    // Three callsigns in the real data carry a trailing non-breaking space
    // (G0TQK, G7IWE, 2E1HON - the same trio in both the 2019 and 2024
    // snapshots). Trimming is the ONLY canonicalisation applied, and it is
    // counted, never silent.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      `G0TQK${NBSP},Allocated,Call Sign - Amateur,`,
      'M0IVB,Allocated,Call Sign - Amateur,',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.csv).toContain('G0TQK,Allocated');
    expect(result.recordCount).toBe(2); // the affected row is kept, not discarded
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
    expect(result.notes.trimmedSamples[0]).toContain('G0TQK');
  });

  it('FoiNormaliser_Latin1RegisterBytesWithRawNbsp_DecodesAndTrims', () => {
    // The published register is Windows-1252/latin-1: the same NBSP trio is
    // a single raw 0xA0 byte, which is NOT valid UTF-8 - decoding must go
    // through latin1 or the callsign gains a U+FFFD replacement character.
    const input = Buffer.concat([
      Buffer.from('Call Sign,Status,Licence Class,Licence Issued Dat\r\nG0TQK', 'latin1'),
      Buffer.from([0xa0]),
      Buffer.from(',Allocated,Full,12/02/2018\r\n', 'latin1'),
    ]);
    const result = convertFoiCsv(input, register);
    expect(result.csv).toContain('G0TQK,Allocated,Full,2018-02-12');
    expect(result.csv).not.toContain('�');
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
  });

  it('FoiNormaliser_SixCharacterCallsign_PassesThroughUnfiltered', () => {
    // 2E1HON is six characters; regional-prefix and reciprocal callsigns
    // (GM0SXQ, M/KNIZ...) are longer still. The normaliser asserts what the
    // source asserts - it never filters by callsign shape.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      '2E1HON,Allocated,Call Sign - Amateur,',
      'M/KNIZ,Allocated,Call Sign - Amateur,',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.csv).toContain('2E1HON,Allocated');
    expect(result.csv).toContain('M/KNIZ,Allocated');
    expect(result.recordCount).toBe(2);
  });

  it('FoiNormaliser_LowercaseCallsign_PreservedVerbatim', () => {
    // 'g0jrk' and '2e1GTD' exist in the real data. The source is not
    // uniformly uppercase, so no case change is invented - the assertion is
    // preserved letter-for-letter.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'g0jrk,Allocated,Call Sign - Amateur,',
      '2e1GTD,Allocated,Call Sign - Amateur,',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.csv).toContain('2e1GTD,Allocated');
    expect(result.csv).toContain('g0jrk,Allocated');
  });

  it('FoiNormaliser_QuotedCallsignContainingCommas_PreservedVerbatim', () => {
    // Real artefact: sheet 2 carries a callsign that is literally ',,' - it
    // survives round-trip through RFC-4180 quoting untouched.
    const input = utf8BomCrlf([
      'Created Date,Status,Call Sign,Original start date,Licence Type',
      '17/06/2024 03:10,Live,",,",19/04/2018,Amateur Intermediate Radio Licence',
    ]);
    const result = convertFoiCsv(input, sheet2);
    expect(result.csv).toContain('",,",Live,Amateur Intermediate Radio Licence');
  });

  it('FoiNormaliser_InteriorWhitespace_KeptIntact', () => {
    // 'G6 FMU' exists in the real register (alongside a separate 'G6FMU').
    // Trimming is ends-only: interior whitespace is part of the assertion.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G6 FMU,Allocated,Full,21/02/2017\r\n', 'latin1');
    const result = convertFoiCsv(input, register);
    expect(result.csv).toContain('G6 FMU,Allocated');
    expect(result.notes.trimmedCellCount).toBe(0);
  });
});

describe('FOI CSV normaliser - determinism', () => {
  it('FoiNormaliser_CrlfAndLfInputs_ProduceIdenticalLfOutput', () => {
    const rows = [
      'Value,Status,Type,Reserved to Date',
      'M0IVB,Allocated,Call Sign - Amateur,',
    ];
    const crlf = utf8BomCrlf(rows);
    const lf = Buffer.from(BOM + rows.join('\n') + '\n', 'utf8');
    expect(convertFoiCsv(crlf, sheet1).csv).toBe(convertFoiCsv(lf, sheet1).csv);
    expect(convertFoiCsv(lf, sheet1).csv).not.toContain('\r');
  });

  it('FoiNormaliser_SameBytesTwice_ByteIdenticalOutput', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,21/01/2019',
      'G5YTT,Reserved,Call Sign - Amateur,15/10/2029',
    ]);
    expect(convertFoiCsv(input, sheet1).csv).toBe(convertFoiCsv(input, sheet1).csv);
  });
});

describe('FOI CSV normaliser - header discipline', () => {
  it('FoiNormaliser_MissingExpectedHeader_ThrowsNamingTheMissingHeader', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type', // 'Reserved to Date' absent
      'M0IVB,Allocated,Call Sign - Amateur',
    ]);
    expect(() => convertFoiCsv(input, sheet1)).toThrow(/Reserved to Date/);
    expect(() => convertFoiCsv(input, sheet1)).toThrow(new RegExp(sheet1.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('FoiNormaliser_UnexpectedExtraHeader_Throws', () => {
    // An unknown column means a genuinely new source shape - a reviewed
    // converter change, never a silent guess.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date,Surprise',
      'M0IVB,Allocated,Call Sign - Amateur,,x',
    ]);
    expect(() => convertFoiCsv(input, sheet1)).toThrow(/Surprise/);
  });

  it('FoiNormaliser_RegisterTruncatedDateHeader_MatchedVerbatim', () => {
    // The published file's final header is literally 'Licence Issued Dat'
    // (truncated at source). The converter matches the bytes that exist, so
    // the UNtruncated spelling must be rejected as an unknown shape.
    const untruncated = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Date\r\n' +
      'G4IFJ,Allocated,Full,03/05/1903\r\n', 'latin1');
    expect(() => convertFoiCsv(untruncated, register)).toThrow(/Licence Issued Dat/);
  });

  it('FoiNormaliser_ZeroDataRows_Throws', () => {
    const input = utf8BomCrlf(['Value,Status,Type,Reserved to Date']);
    expect(() => convertFoiCsv(input, sheet1)).toThrow(/zero/i);
  });
});

describe('FOI CSV normaliser - date handling', () => {
  it('FoiNormaliser_DateColumns_ReportDayFirstEvidence', () => {
    // Day>12 values prove day-first ordering for their column; both-<=12
    // values are ambiguous alone and lean on the column's verified values.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,21/01/2019',
      'G5YTT,Reserved,Call Sign - Amateur,05/03/2020',
    ]);
    const result = convertFoiCsv(input, sheet1);
    expect(result.notes.dateStats['reserved_to_date']).toEqual({ disambiguated: 1, ambiguous: 1 });
    expect(result.notes.unverifiedDateColumns).toEqual([]);
  });

  it('FoiNormaliser_DateColumnWithoutDisambiguatingValue_FlaggedUnverified', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,05/03/2020',
    ]);
    expect(convertFoiCsv(input, sheet1).notes.unverifiedDateColumns).toEqual(['reserved_to_date']);
  });

  it('FoiNormaliser_UnparseableDate_ThrowsWithRowContext', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M0IVB,Allocated,Call Sign - Amateur,',
      'M5TX,Available,Call Sign - Amateur,not-a-date',
    ]);
    expect(() => convertFoiCsv(input, sheet1)).toThrow(/M5TX/);
  });

  it('FoiNormaliser_IssuedDateAfterVintage_ThrowsPlausibilityFailure', () => {
    // Licence issue dates cannot postdate the snapshot's vintage
    // (2019-09-12, from the published filename).
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'M7ZZZ,Allocated,Foundation,13/09/2019\r\n', 'latin1');
    expect(() => convertFoiCsv(input, register)).toThrow(/future/i);
  });

  it('FoiNormaliser_ReservedToDateInFuture_Accepted', () => {
    // Reservation EXPIRY dates legitimately extend beyond the snapshot
    // vintage (2029 values exist in the real data) - the future-date
    // plausibility check must not apply to them.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'G5YTT,Reserved,Call Sign - Amateur,15/10/2029',
    ]);
    expect(convertFoiCsv(input, sheet1).csv).toContain('2029-10-15');
  });

  it('FoiNormaliser_PreNineteenHundredDate_Throws', () => {
    // 03/05/1903 is real (presumed migration placeholder) and passes; a
    // pre-1900 date indicates corruption, not history.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G4IFJ,Allocated,Full,31/12/1899\r\n', 'latin1');
    expect(() => convertFoiCsv(input, register)).toThrow(/1900/);
  });
});

describe('FOI CSV normaliser - output naming', () => {
  it('SlugifyBasename_MixedCaseSpacesAndExtension_ProducesHyphenatedLowerCaseSlug', () => {
    expect(slugifyBasename('FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv'))
      .toBe('foi-1900117-radio-amateur-licence-breakdown-by-duration-held-and-age-sheet-1');
    expect(slugifyBasename('allocated-reserved-forbidden-call-sign.csv'))
      .toBe('allocated-reserved-forbidden-call-sign');
  });

  it('NormalisedFileName_ForEachTierOneSource_MatchesConvention', () => {
    expect(normalisedFileNameFor(SHEET_1))
      .toBe('normalised--foi-1900117-radio-amateur-licence-breakdown-by-duration-held-and-age-sheet-1.csv');
    expect(normalisedFileNameFor(REGISTER_20190912))
      .toBe('normalised--allocated-reserved-forbidden-call-sign-foi-20190912.csv');
  });
});

describe('FOI entry conversion', () => {
  it('FoiEntry_UnknownVariant_ThrowsWithClearMessage', () => {
    expect(() => convertFoiEntry('does-not-matter', 'no-such-variant')).toThrow(/no-such-variant/);
  });

  it('FoiEntry_SourceFileMissing_ThrowsNamingTheFile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-entry-'));
    try {
      expect(() => convertFoiEntry(dir, WDTK_VARIANT)).toThrow(/sheet 1/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FoiEntry_WdtkEntryOnDisk_ConvertsBothSheets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-entry-'));
    try {
      fs.writeFileSync(path.join(dir, SHEET_1), utf8BomCrlf([
        'Value,Status,Type,Reserved to Date',
        'M0IVB,Allocated,Call Sign - Amateur,',
      ]));
      fs.writeFileSync(path.join(dir, SHEET_2), utf8BomCrlf([
        'Created Date,Status,Call Sign,Original start date,Licence Type',
        '13/02/2019 08:40,Live,20DLQ,29/05/2015,Amateur Intermediate Radio Licence',
      ]));
      const results = convertFoiEntry(dir, WDTK_VARIANT);
      expect(results.map(r => r.outputFileName)).toEqual([
        normalisedFileNameFor(SHEET_1),
        normalisedFileNameFor(SHEET_2),
      ]);
      expect(results[0].csv).toContain('M0IVB');
      expect(results[1].csv).toContain('20DLQ');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Golden-master checks against the archived source bytes: the converter must
// reproduce the committed normalised files exactly (re-run policy: outputs
// are byte-deterministic; a diff means the logic changed and the change is
// the review artefact).
describe('FOI archive golden master', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const wdtkDir = path.join(repoRoot, 'archive', 'foi', 'wdtk-1180568--licence-breakdown-duration-age');
  const ofcomDir = path.join(repoRoot, 'archive', 'foi', 'ofcom-756622--published-register-csv');

  // Full-archive reproductions chew through ~260k records; slow shared CI
  // runners need more than the default 5s.
  const GOLDEN_MASTER_TIMEOUT_MS = 30_000;

  it('FoiArchive_Wdtk1180568Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = convertFoiEntry(wdtkDir, WDTK_VARIANT);
    expect(results.map(r => r.recordCount)).toEqual([156256, 103720]);
    // The NBSP trio (G0TQK, G7IWE, 2E1HON) appears in both sheets.
    expect(results.map(r => r.notes.nbspCellCount)).toEqual([3, 3]);
    // Thirteen blank statuses in sheet 1 - preserved, on the record.
    expect(results[0].notes.blankCounts['status']).toBe(13);
    for (const result of results) {
      const committed = fs.readFileSync(path.join(wdtkDir, result.outputFileName), 'utf8');
      expect(result.csv).toBe(committed);
    }
  });

  it('FoiArchive_Ofcom756622Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = convertFoiEntry(ofcomDir, OFCOM_VARIANT);
    expect(results.map(r => r.recordCount)).toEqual([141295, 1465]);
    // Six blank statuses in the published register - preserved, on the record.
    expect(results[0].notes.blankCounts['status']).toBe(6);
    // The register's NBSP trio is raw 0xA0 (latin-1), decoded then trimmed.
    expect(results[0].notes.nbspCellCount).toBe(3);
    for (const result of results) {
      const committed = fs.readFileSync(path.join(ofcomDir, result.outputFileName), 'utf8');
      expect(result.csv).toBe(committed);
    }
  });
});
