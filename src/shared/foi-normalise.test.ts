import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  convertFoiSource,
  convertFoiEntry,
  conversionFor,
  normalisedFileNameFor,
  slugifyBasename,
  FOI_NORMALISED_SCHEMA_VERSION,
  FOI_ENTRY_CONVERSIONS,
  FOI_ROW_SCHEMA_FAMILIES,
  FOI_EXTENSION_COLUMNS,
} from './foi-normalise.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The FOI normaliser (issue #139, tiers 1-2): deterministic converters for
// the CSV-native FOI entries and for the tables transcribed into committed
// raw-extract-*.md files. Every normalised row is an observation - the
// source's assertion at its vintage, never an inferred complement. Blank
// statuses are preserved (they are data), whitespace (including non-breaking
// spaces) is trimmed and COUNTED rather than silently discarded, and columns
// are identified by header NAME, never by position.

const WDTK_VARIANT = 'wdtk-1180568-csv-pair';
const OFCOM_VARIANT = 'ofcom-756622-register-and-forbidden';
const COUNTS_VARIANT = 'wdtk-184767-counts-table';
const TRANSFERS_VARIANT = 'wdtk-251507-transfers-table';
const COUNTS_EXTRACT = 'raw-extract-number-of-licences-coleman.md';
const TRANSFERS_EXTRACT = 'raw-extract-applicants-old-call-signs.md';
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
    const result = convertFoiSource(input, sheet1);
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
    const result = convertFoiSource(input, sheet1);
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
    const result = convertFoiSource(input, sheet2);
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
    const result = convertFoiSource(input, register);
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
    const result = convertFoiSource(input, forbidden);
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
    expect(convertFoiSource(shuffledOrder, sheet1).csv).toBe(convertFoiSource(canonicalOrder, sheet1).csv);
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
    const result = convertFoiSource(input, register);
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
    const result = convertFoiSource(input, sheet1);
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
    const result = convertFoiSource(input, register);
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
    const result = convertFoiSource(input, sheet1);
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
    const result = convertFoiSource(input, sheet1);
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
    const result = convertFoiSource(input, sheet2);
    expect(result.csv).toContain('",,",Live,Amateur Intermediate Radio Licence');
  });

  it('FoiNormaliser_InteriorWhitespace_KeptIntact', () => {
    // 'G6 FMU' exists in the real register (alongside a separate 'G6FMU').
    // Trimming is ends-only: interior whitespace is part of the assertion.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G6 FMU,Allocated,Full,21/02/2017\r\n', 'latin1');
    const result = convertFoiSource(input, register);
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
    expect(convertFoiSource(crlf, sheet1).csv).toBe(convertFoiSource(lf, sheet1).csv);
    expect(convertFoiSource(lf, sheet1).csv).not.toContain('\r');
  });

  it('FoiNormaliser_SameBytesTwice_ByteIdenticalOutput', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,21/01/2019',
      'G5YTT,Reserved,Call Sign - Amateur,15/10/2029',
    ]);
    expect(convertFoiSource(input, sheet1).csv).toBe(convertFoiSource(input, sheet1).csv);
  });
});

describe('FOI CSV normaliser - header discipline', () => {
  it('FoiNormaliser_MissingExpectedHeader_ThrowsNamingTheMissingHeader', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type', // 'Reserved to Date' absent
      'M0IVB,Allocated,Call Sign - Amateur',
    ]);
    expect(() => convertFoiSource(input, sheet1)).toThrow(/Reserved to Date/);
    expect(() => convertFoiSource(input, sheet1)).toThrow(new RegExp(sheet1.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('FoiNormaliser_UnexpectedExtraHeader_Throws', () => {
    // An unknown column means a genuinely new source shape - a reviewed
    // converter change, never a silent guess.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date,Surprise',
      'M0IVB,Allocated,Call Sign - Amateur,,x',
    ]);
    expect(() => convertFoiSource(input, sheet1)).toThrow(/Surprise/);
  });

  it('FoiNormaliser_RegisterTruncatedDateHeader_MatchedVerbatim', () => {
    // The published file's final header is literally 'Licence Issued Dat'
    // (truncated at source). The converter matches the bytes that exist, so
    // the UNtruncated spelling must be rejected as an unknown shape.
    const untruncated = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Date\r\n' +
      'G4IFJ,Allocated,Full,03/05/1903\r\n', 'latin1');
    expect(() => convertFoiSource(untruncated, register)).toThrow(/Licence Issued Dat/);
  });

  it('FoiNormaliser_ZeroDataRows_Throws', () => {
    const input = utf8BomCrlf(['Value,Status,Type,Reserved to Date']);
    expect(() => convertFoiSource(input, sheet1)).toThrow(/zero/i);
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
    const result = convertFoiSource(input, sheet1);
    expect(result.notes.dateStats['reserved_to_date']).toEqual({ disambiguated: 1, ambiguous: 1 });
    expect(result.notes.unverifiedDateColumns).toEqual([]);
  });

  it('FoiNormaliser_DateColumnWithoutDisambiguatingValue_FlaggedUnverified', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M5TX,Available,Call Sign - Amateur,05/03/2020',
    ]);
    expect(convertFoiSource(input, sheet1).notes.unverifiedDateColumns).toEqual(['reserved_to_date']);
  });

  it('FoiNormaliser_UnparseableDate_ThrowsWithRowContext', () => {
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'M0IVB,Allocated,Call Sign - Amateur,',
      'M5TX,Available,Call Sign - Amateur,not-a-date',
    ]);
    expect(() => convertFoiSource(input, sheet1)).toThrow(/M5TX/);
  });

  it('FoiNormaliser_IssuedDateAfterVintage_ThrowsPlausibilityFailure', () => {
    // Licence issue dates cannot postdate the snapshot's vintage
    // (2019-09-12, from the published filename).
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'M7ZZZ,Allocated,Foundation,13/09/2019\r\n', 'latin1');
    expect(() => convertFoiSource(input, register)).toThrow(/future/i);
  });

  it('FoiNormaliser_ReservedToDateInFuture_Accepted', () => {
    // Reservation EXPIRY dates legitimately extend beyond the snapshot
    // vintage (2029 values exist in the real data) - the future-date
    // plausibility check must not apply to them.
    const input = utf8BomCrlf([
      'Value,Status,Type,Reserved to Date',
      'G5YTT,Reserved,Call Sign - Amateur,15/10/2029',
    ]);
    expect(convertFoiSource(input, sheet1).csv).toContain('2029-10-15');
  });

  it('FoiNormaliser_PreNineteenHundredDate_Throws', () => {
    // 03/05/1903 is real (presumed migration placeholder) and passes; a
    // pre-1900 date indicates corruption, not history.
    const input = Buffer.from(
      'Call Sign,Status,Licence Class,Licence Issued Dat\r\n' +
      'G4IFJ,Allocated,Full,31/12/1899\r\n', 'latin1');
    expect(() => convertFoiSource(input, register)).toThrow(/1900/);
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

// Markdown-table extracts (tier 2): converters parse the tables transcribed
// into the committed raw-extract-*.md files. Same discipline as CSV sources -
// header-name matching, counted trims, fail-loudly on any unexpected shape.
const countsExtract = conversionFor(COUNTS_VARIANT, COUNTS_EXTRACT);
const transfersExtract = conversionFor(TRANSFERS_VARIANT, TRANSFERS_EXTRACT);

// A minimal markdown extract document: prose above and below one table, as
// in the committed raw-extract files (LF endings, UTF-8, no BOM).
function mdExtract(tableLines: string[]): Buffer {
  return Buffer.from(
    '# Raw extract - fixture\n\nProse before the table.\n\n' +
    tableLines.join('\n') +
    '\n\nProse after the table.\n', 'utf8');
}

const COUNTS_HEADER = '| period (1 April – 31 March) | Amateur Radio | Business Radio |';
const TRANSFERS_HEADER = '| Con Id | Licence Number | Call Signs | Licence Product | Status | Title | First_name | Last_name | Start date | Reason |';
const TRANSFERS_SEPARATOR = '|---|---|---|---|---|---|---|---|---|---|';

function transfersRow(conId: string, licenceNumber: string, callsign: string, product: string, startDate: string): string {
  return `| ${conId} | ${licenceNumber} | ${callsign} | ${product} | Live | S40 | S40 | S40 | ${startDate} | Letter of consent provided for transfer |`;
}

describe('FOI markdown-table normaliser - parsing', () => {
  it('FoiNormaliser_MarkdownExtractTable_MapsToAuthoredSchema', () => {
    const input = mdExtract([
      COUNTS_HEADER,
      '|---|---:|---:|',
      '| 2003–2004 | 29,190 | 6,371 |',
      '| 2004–2005 | 167,561 | 6,515 |',
    ]);
    const result = convertFoiSource(input, countsExtract);
    expect(result.csv).toBe(
      'period,amateur_radio_licences_issued,business_radio_licences_issued\n' +
      '2003–2004,29190,6371\n' +
      '2004–2005,167561,6515\n');
    expect(result.recordCount).toBe(2);
    expect(result.schemaVersion).toBe(FOI_NORMALISED_SCHEMA_VERSION);
  });

  it('FoiNormaliser_MarkdownProseWithoutTable_Throws', () => {
    const input = Buffer.from('# Raw extract\n\nOnly prose here, no table.\n', 'utf8');
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/no markdown table/i);
  });

  it('FoiNormaliser_MarkdownWithTwoTables_Throws', () => {
    // Two table blocks means the extract's shape changed - a reviewed
    // converter change, never a guess about which table is the dataset.
    const table = [COUNTS_HEADER, '|---|---:|---:|', '| 2003–2004 | 29,190 | 6,371 |'];
    const input = Buffer.from(
      '# Raw extract\n\n' + table.join('\n') + '\n\nMore prose.\n\n' + table.join('\n') + '\n', 'utf8');
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/2 markdown tables/i);
  });

  it('FoiNormaliser_MarkdownRowWithWrongCellCount_ThrowsWithRowContext', () => {
    const input = mdExtract([
      COUNTS_HEADER,
      '|---|---:|---:|',
      '| 2003–2004 | 29,190 |',
    ]);
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/2003–2004/);
  });

  it('FoiNormaliser_MarkdownHeaderMismatch_Throws', () => {
    // Header discipline applies to markdown tables exactly as to CSVs.
    const input = mdExtract([
      '| period (1 April – 31 March) | Amateur Radio | Marine Radio |',
      '|---|---:|---:|',
      '| 2003–2004 | 29,190 | 6,371 |',
    ]);
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/Business Radio/);
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/Marine Radio/);
  });

  it('FoiNormaliser_MarkdownCellWithTrailingNbsp_TrimmedAndCounted', () => {
    // Table-formatting spaces are structure and are stripped silently; any
    // OTHER edge whitespace (an NBSP carried through transcription) is data
    // hygiene and goes through the counted trim, never a silent one.
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-63D-1492', '1-276079645', `G2CP${NBSP}`, 'Amateur Club Radio Licence', '15/12/2014'),
    ]);
    const result = convertFoiSource(input, transfersExtract);
    expect(result.csv).toContain('G2CP,');
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
  });
});

describe('FOI markdown-table normaliser - counts variant (wdtk-184767)', () => {
  it('FoiNormaliser_ThousandsSeparatedCounts_NormalisedToPlainIntegers', () => {
    const input = mdExtract([
      COUNTS_HEADER,
      '|---|---:|---:|',
      '| 2004–2005 | 167,561 | 6,515 |',
    ]);
    const result = convertFoiSource(input, countsExtract);
    expect(result.csv).toContain('167561');
    expect(result.csv).toContain('6515');
    expect(result.csv).not.toContain('"');
  });

  it('FoiNormaliser_MalformedCount_ThrowsWithRowContext', () => {
    // '29,19' is not a well-formed thousands-separated integer - corruption,
    // not a number to be repaired by stripping commas.
    const input = mdExtract([
      COUNTS_HEADER,
      '|---|---:|---:|',
      '| 2003–2004 | 29,19 | 6,371 |',
    ]);
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/29,19/);
    expect(() => convertFoiSource(input, countsExtract)).toThrow(/2003–2004/);
  });

  it('FoiNormaliser_CountsVariant_PreservesChronologicalSourceOrder', () => {
    // The letter's financial-year order is chronological and meaningful -
    // the converter must not re-sort it.
    const input = mdExtract([
      COUNTS_HEADER,
      '|---|---:|---:|',
      '| 2012–2013 | 28,041 | 4,738 |',
      '| 2003–2004 | 29,190 | 6,371 |',
    ]);
    const result = convertFoiSource(input, countsExtract);
    expect(result.csv.indexOf('2012–2013')).toBeLessThan(result.csv.indexOf('2003–2004'));
  });
});

describe('FOI markdown-table normaliser - transfers variant (wdtk-251507)', () => {
  it('FoiNormaliser_TransfersVariant_EmitsAuthoredReallocatedEvent', () => {
    // The event vocabulary is the covering letter's own word ('applications
    // where an old call sign was reallocated'), authored as a constant.
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-LSY43', '1-278472477', 'G8JC', 'Amateur Club Radio Licence', '28/01/2015'),
    ]);
    const result = convertFoiSource(input, transfersExtract);
    expect(result.csv).toBe(
      'callsign,event,event_date,licence_class,status,reason,licence_number,con_id\n' +
      'G8JC,reallocated,2015-01-28,Amateur Club Radio Licence,Live,Letter of consent provided for transfer,1-278472477,1-LSY43\n');
  });

  it('FoiNormaliser_TransfersVariant_DropsSection40WithheldColumns', () => {
    // Title/First_name/Last_name are 'S40' on every row - the document's
    // marker for names withheld under FOIA s.40. Withholding markers are not
    // data; the columns are required to be present but are not carried.
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-LSY43', '1-278472477', 'G8JC', 'Amateur Club Radio Licence', '28/01/2015'),
    ]);
    expect(convertFoiSource(input, transfersExtract).csv).not.toContain('S40');
  });

  it('FoiNormaliser_TransfersVariant_PreservesNewestFirstSourceOrder', () => {
    // The document presents 'the last 20 applications' newest-first - a
    // meaningful order, preserved.
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-LSY43', '1-278472477', 'G8JC', 'Amateur Club Radio Licence', '28/01/2015'),
      transfersRow('1-62T-1151', '1-214465959', 'G8WQ', 'Amateur Club Radio Licence', '30/07/2012'),
    ]);
    const result = convertFoiSource(input, transfersExtract);
    expect(result.csv.indexOf('G8JC')).toBeLessThan(result.csv.indexOf('G8WQ'));
  });

  it('FoiNormaliser_TransfersStartDateAfterResponseDate_ThrowsPlausibilityFailure', () => {
    // Event dates cannot postdate the response letter (2015-02-27).
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-LSY43', '1-278472477', 'G8JC', 'Amateur Club Radio Licence', '28/02/2015'),
    ]);
    expect(() => convertFoiSource(input, transfersExtract)).toThrow(/future/i);
  });

  it('NormalisedFileName_MarkdownExtractConversion_NamedAfterTheTranscribedDataFile', () => {
    // The output is named for the DATA file the extract transcribes (the
    // PDF), not for the raw-extract-*.md intermediary.
    const input = mdExtract([
      TRANSFERS_HEADER,
      TRANSFERS_SEPARATOR,
      transfersRow('1-LSY43', '1-278472477', 'G8JC', 'Amateur Club Radio Licence', '28/01/2015'),
    ]);
    expect(convertFoiSource(input, transfersExtract).outputFileName).toBe('normalised--applicants-old-call-signs.csv');
    expect(normalisedFileNameFor('Number of licences Coleman.pdf')).toBe('normalised--number-of-licences-coleman.csv');
  });
});

// Workbook extracts (tier 3): converters parse the committed
// raw-extract-sheet-*.csv files produced mechanically by
// src/shared/xlsx-extract.ts. Their dates are already ISO (typed at source, so
// no day-first ambiguity ever existed); some sheets carry preamble rows
// (titles, prefix statements) that are matched verbatim, never skipped
// blindly; and the 2013/14 suffix-shaped lists construct the callsign from
// the sheet's own stated prefix while carrying the suffix verbatim.
const SUFFIX_2013_VARIANT = 'available-suffix-lists-2013-style';
const PREFIX_HEADER_VARIANT = 'wdtk-224333-prefix-suffix-lists';
const TYPED_8COL_VARIANT = 'available-typed-export-8col';
const REGISTER_596532_VARIANT = 'wdtk-596532-register-and-forbidden';
const PREWAR_VARIANT = 'wdtk-238892-prewar-annex';
const REISSUE_VARIANT = 'ofcom-498903-reissue-events';

const foundationSuffixes = conversionFor(SUFFIX_2013_VARIANT, 'raw-extract-sheet-1-foundation.csv');
const prefixHeaderFoundation = conversionFor(PREFIX_HEADER_VARIANT, 'raw-extract-sheet-1-foundation.csv');
const typedFoundation = conversionFor(TYPED_8COL_VARIANT, 'raw-extract-sheet-1-foundation.csv');
const register596532 = conversionFor(REGISTER_596532_VARIANT, 'raw-extract-sheet-1-all-callsigns-on-record.csv');
const prewarCallsigns = conversionFor(PREWAR_VARIANT, 'raw-extract-sheet-1-callsigns.csv');
const reissueEvents = conversionFor(REISSUE_VARIANT, 'raw-extract-sheet-1-sheet1.csv');

// Extract fixtures are plain LF/UTF-8 CSV, as src/shared/xlsx-extract.ts writes.
function extractCsv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

describe('FOI workbook-extract normaliser - suffix-shaped available lists', () => {
  it('FoiNormaliser_SuffixListVariant_ConstructsCallsignFromStatedPrefix', () => {
    // The sheet's own first row asserts the prefix rule ('Foundation =
    // M6aaa') and is matched verbatim as the header; the callsign is the
    // stated prefix plus the listed suffix, and the suffix is also carried
    // verbatim so the source shape survives.
    const input = extractCsv(['Foundation = M6aaa', 'DIR', 'DIQ']);
    const result = convertFoiSource(input, foundationSuffixes);
    expect(result.csv).toBe(
      'callsign,status,licence_class,suffix\n' +
      'M6DIQ,Available,Foundation,DIQ\n' +
      'M6DIR,Available,Foundation,DIR\n');
  });

  it('FoiNormaliser_SuffixListVariant_UnexpectedLabelRow_Throws', () => {
    // A changed label means a changed prefix assertion - reviewed, never
    // silently accepted.
    const input = extractCsv(['Foundation = M7aaa', 'DIQ']);
    expect(() => convertFoiSource(input, foundationSuffixes)).toThrow(/Foundation = M6aaa/);
  });

  it('FoiNormaliser_PrefixHeaderVariant_VerifiesPreambleVerbatim', () => {
    // The 2014-08 lists carry a blank row and a 'Prefix = M6' statement
    // before the 'Suffix' header. The preamble is part of the assertion and
    // is matched cell-for-cell.
    const good = extractCsv(['""', 'Prefix = M6', 'Suffix', 'AAA']);
    expect(convertFoiSource(good, prefixHeaderFoundation).csv).toContain('M6AAA,Available,Foundation,AAA');
    const changedPrefix = extractCsv(['""', 'Prefix = M7', 'Suffix', 'AAA']);
    expect(() => convertFoiSource(changedPrefix, prefixHeaderFoundation)).toThrow(/Prefix = M6/);
    const missingPreamble = extractCsv(['Suffix', 'AAA']);
    expect(() => convertFoiSource(missingPreamble, prefixHeaderFoundation)).toThrow(/preamble/i);
  });

  it('FoiNormaliser_PrefixedColumnWithBlankSuffix_EmitsBlankNotBarePrefix', () => {
    // A blank suffix must not fabricate a callsign equal to the prefix.
    const input = extractCsv(['Foundation = M6aaa', 'DIQ', '""']);
    const result = convertFoiSource(input, foundationSuffixes);
    expect(result.csv).toContain('M6DIQ');
    expect(result.csv).toContain(',Available,Foundation,\n');
    expect(result.csv).not.toContain('M6,');
    expect(result.notes.blankCounts['callsign']).toBe(1);
  });
});

describe('FOI workbook-extract normaliser - typed exports', () => {
  it('FoiNormaliser_TypedExportVariant_MapsByNameAndSortsByCallsign', () => {
    const input = extractCsv([
      'Country,Current Series,Reference,Value,Type,Product,Status,Allocated Flag',
      'M,6,FEU,M6FEU,Call Sign,Amateur Foundation Radio Licence,Available,N',
      'M,6,FEQ,M6FEQ,Call Sign,Amateur Foundation Radio Licence,Available,N',
    ]);
    const result = convertFoiSource(input, typedFoundation);
    expect(result.csv).toBe(
      'callsign,status,licence_class,suffix\n' +
      'M6FEQ,Available,Amateur Foundation Radio Licence,FEQ\n' +
      'M6FEU,Available,Amateur Foundation Radio Licence,FEU\n');
  });

  it('FoiNormaliser_TypedExportMangledDateValue_CarriedVerbatim', () => {
    // The 2015 workbooks genuinely store a few 20xxx callsigns AS dates
    // (Excel mangling at Ofcom's export); the extract renders them ISO and
    // the converter carries the assertion verbatim - never repaired back to
    // a guessed suffix.
    const input = extractCsv([
      'Country,Current Series,Reference,Value,Type,Product,Status,Allocated Flag',
      '2,0,JUN,2015-06-20,Call Sign,Amateur Intermediate Radio Licence,Available,N',
    ]);
    const result = convertFoiSource(input, typedFoundation);
    expect(result.csv).toContain('2015-06-20,Available,Amateur Intermediate Radio Licence,JUN');
  });
});

describe('FOI workbook-extract normaliser - ISO date columns', () => {
  it('FoiNormaliser_IsoDateColumns_PassThroughDateAndDateTime', () => {
    // Extract dates were typed in the workbook - already ISO, no day-first
    // ambiguity ever existed (so no order-evidence stats are collected).
    // The Pre-War annex's stored 01:00:00 times are source artefacts and
    // are carried, not stripped.
    const input = extractCsv([
      '"Callsigns in the ""G"" series allocated prior to WW2 with 2-letter suffixes, which were assigned or re-assigned since 1945. ",',
      ',',
      'Call Sign,Original Start Date',
      'G2AA,1992-10-30',
      'G2AS,1989-10-11 01:00:00',
    ]);
    const result = convertFoiSource(input, prewarCallsigns);
    expect(result.csv).toBe(
      'callsign,original_start_date\n' +
      'G2AA,1992-10-30\n' +
      'G2AS,1989-10-11 01:00:00\n');
    expect(result.notes.dateStats).toEqual({});
  });

  it('FoiNormaliser_IsoDateAfterVintage_ThrowsPlausibilityFailure', () => {
    const input = extractCsv([
      'Original Start Date,Call Sign T-Number',
      '2017-12-23,G7DMN',
    ]);
    expect(() => convertFoiSource(input, reissueEvents)).toThrow(/future/i);
  });

  it('FoiNormaliser_MalformedIsoDate_ThrowsWithRowContext', () => {
    const input = extractCsv([
      'Original Start Date,Call Sign T-Number',
      '2015-13-40,G7DMN',
    ]);
    expect(() => convertFoiSource(input, reissueEvents)).toThrow(/G7DMN/);
  });
});

describe('FOI workbook-extract normaliser - registers and events', () => {
  it('FoiNormaliser_Register596532_PreservesDateAscendingSourceOrder', () => {
    const input = extractCsv([
      'Call Sign,Status,Licence Class,Licence Issued Dat',
      'G4IFJ,Allocated,Full,1903-05-03',
      'G8UYK,Allocated,Full,1904-02-04',
      '2E1AAA,Reserved,Intermediate,',
    ]);
    const result = convertFoiSource(input, register596532);
    expect(result.csv).toBe(
      'callsign,status,licence_class,licence_issued_date\n' +
      'G4IFJ,Allocated,Full,1903-05-03\n' +
      'G8UYK,Allocated,Full,1904-02-04\n' +
      '2E1AAA,Reserved,Intermediate,\n');
  });

  it('FoiNormaliser_ReissueEvents_EmitsAuthoredReissuedEvent', () => {
    const input = extractCsv([
      'Original Start Date,Call Sign T-Number',
      '2010-01-22,G7DMN',
    ]);
    expect(convertFoiSource(input, reissueEvents).csv).toBe(
      'callsign,event,event_date\n' +
      'G7DMN,reissued,2010-01-22\n');
  });
});

// Column-name governance (issue #149 Phase A): every output column of every
// conversion must be core to a row-schema family or registered as an
// extension - converters cannot invent near-duplicate names.
describe('FOI schema governance', () => {
  it('FoiSchemas_EveryConversionOutputColumn_IsFamilyCoreOrRegistered', () => {
    const allowed = new Set<string>([
      ...FOI_ROW_SCHEMA_FAMILIES.flatMap(family => family.coreColumns),
      ...Object.keys(FOI_EXTENSION_COLUMNS),
    ]);
    for (const [variant, conversions] of Object.entries(FOI_ENTRY_CONVERSIONS)) {
      for (const conversion of conversions) {
        for (const column of conversion.columns) {
          expect(
            allowed.has(column.output),
            `variant ${variant}, ${conversion.sourceFile}: output column "${column.output}" is neither family-core nor a registered extension - add a reviewed definition to FOI_EXTENSION_COLUMNS`,
          ).toBe(true);
        }
      }
    }
  });

  it('FoiSchemas_ExtensionFamilyReferences_NameRealFamilies', () => {
    const familyNames = new Set(FOI_ROW_SCHEMA_FAMILIES.map(family => family.name));
    for (const [name, extension] of Object.entries(FOI_EXTENSION_COLUMNS)) {
      expect(extension.families.length, `extension ${name} lists no families`).toBeGreaterThan(0);
      for (const family of extension.families) {
        expect(familyNames.has(family), `extension ${name} references unknown family "${family}"`).toBe(true);
      }
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

  it('FoiArchive_Wdtk184767Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    const entryDir = path.join(repoRoot, 'archive', 'foi', 'wdtk-184767--annual-licence-counts');
    const results = convertFoiEntry(entryDir, COUNTS_VARIANT);
    expect(results.map(r => r.recordCount)).toEqual([10]);
    const committed = fs.readFileSync(path.join(entryDir, results[0].outputFileName), 'utf8');
    expect(results[0].csv).toBe(committed);
  });

  it('FoiArchive_Wdtk251507Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    const entryDir = path.join(repoRoot, 'archive', 'foi', 'wdtk-251507--reissue-policy');
    const results = convertFoiEntry(entryDir, TRANSFERS_VARIANT);
    expect(results.map(r => r.recordCount)).toEqual([20]);
    // Five G2-series transfers - the per-callsign evidence for the
    // heritage/two-letter re-issue cycle.
    const g2Rows = results[0].csv.split('\n').filter(line => line.startsWith('G2'));
    expect(g2Rows).toHaveLength(5);
    const committed = fs.readFileSync(path.join(entryDir, results[0].outputFileName), 'utf8');
    expect(results[0].csv).toBe(committed);
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

  // Tier-3 workbook entries: each converts from its committed
  // raw-extract-sheet-*.csv files and must reproduce the committed
  // normalised files exactly.
  function expectEntryReproduced(entryKey: string, variant: string, recordCounts: number[]) {
    const entryDir = path.join(repoRoot, 'archive', 'foi', entryKey);
    const results = convertFoiEntry(entryDir, variant);
    expect(results.map(r => r.recordCount)).toEqual(recordCounts);
    for (const result of results) {
      const committed = fs.readFileSync(path.join(entryDir, result.outputFileName), 'utf8');
      expect(result.csv).toBe(committed);
    }
    return results;
  }

  it('FoiArchive_Wdtk174341Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-174341--available-callsigns-list', SUFFIX_2013_VARIANT, [9099, 9683, 7864]);
  });

  it('FoiArchive_Wdtk197896Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    // Same export shape as wdtk-174341 six months later - the variant is
    // shared, which is itself an assertion the shapes are identical.
    expectEntryReproduced('wdtk-197896--available-callsigns-list', SUFFIX_2013_VARIANT, [8342, 9413, 7636]);
  });

  it('FoiArchive_Wdtk224333Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-224333--available-callsigns-list', PREFIX_HEADER_VARIANT, [7655, 9056, 7489]);
  });

  it('FoiArchive_Wdtk247308Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-247308--available-callsigns-list', TYPED_8COL_VARIANT, [7003, 8750, 7282]);
  });

  it('FoiArchive_Wdtk261814Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-261814--available-callsigns-list', TYPED_8COL_VARIANT, [6711, 8645, 7229]);
  });

  it('FoiArchive_Wdtk271469Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-271469--available-callsigns-list', 'wdtk-271469-typed-lists', [6498, 8533, 7190]);
  });

  it('FoiArchive_Wdtk294011And299321Entries_ReproduceIdenticalNormalisedFiles', () => {
    // The two disclosures shipped byte-identical workbook exports (the
    // extracts share sha256s); both entries bind the same variant and the
    // normalised outputs must match each other as well as their own
    // committed files.
    const a = expectEntryReproduced('wdtk-294011--available-callsigns-list', 'available-typed-export-7col', [6077, 8365, 7042]);
    const b = expectEntryReproduced('wdtk-299321--available-callsigns-list', 'available-typed-export-7col', [6077, 8365, 7042]);
    expect(a.map(r => r.csv)).toEqual(b.map(r => r.csv));
  });

  it('FoiArchive_Wdtk309076Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    expectEntryReproduced('wdtk-309076--available-callsigns-list', 'wdtk-309076-combined-list', [20737]);
  });

  it('FoiArchive_Wdtk356636Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('wdtk-356636--all-callsigns-plus-forbidden', 'wdtk-356636-register-and-forbidden', [139758, 1466]);
    // The register's blank statuses (9) and blank SF List cells are data.
    expect(results[0].notes.blankCounts['status']).toBe(9);
    // The full status vocabulary survives - including the lone Quarantine.
    expect(results[0].csv).toContain('Quarantine');
  });

  it('FoiArchive_Wdtk596532Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('wdtk-596532--allocated-reserved-forbidden', REGISTER_596532_VARIANT, [141295, 1465]);
    expect(results[0].notes.blankCounts['status']).toBe(6);
  });

  it('FoiArchive_Wdtk238892Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    const results = expectEntryReproduced('wdtk-238892--out-of-sequence-callsigns', PREWAR_VARIANT, [419, 41]);
    // 45 pre-war callsigns appear more than once (multiple assignments) -
    // G2AS among them, once with a stored 01:00:00 time artefact.
    expect(results[0].csv).toContain('G2AS,1989-10-11 01:00:00');
  });

  it('FoiArchive_Ofcom498903Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    const results = expectEntryReproduced('ofcom-498903--reissued-callsigns-since-2010', REISSUE_VARIANT, [113]);
    // 53 events carry stored 23:00:00 times (timezone artefacts in the
    // workbook itself) - carried verbatim, never rounded to a guessed day.
    expect(results[0].csv.split('\n').filter(line => line.includes(' 23:00:00'))).toHaveLength(53);
  });

  it('FoiArchive_Ofcom498906Entry_ReproducesCommittedNormalisedFilesByteForByte', () => {
    // Sibling of 498903: same intake, adviser, response day and export
    // shape - reciprocal-licence issue events rather than re-issues.
    const results = expectEntryReproduced('ofcom-498906--reciprocal-licences-since-2010', 'ofcom-498906-reciprocal-events', [319]);
    expect(results[0].csv).toContain('M0GRT,reciprocal-licence-issued,2010-01-07');
    expect(results[0].csv.split('\n').filter(line => line.includes(' 23:00:00'))).toHaveLength(178);
  });
});
