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

// The July-2024 and March-2025 disclosure-log register CSVs are served WITHOUT
// a byte-order mark (the October-2024 one carries a BOM); fixtures reproduce
// each framing so the decode path matches the archived bytes.
function utf8Crlf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
}

const sheet1 = conversionFor(WDTK_VARIANT, SHEET_1);
const sheet2 = conversionFor(WDTK_VARIANT, SHEET_2);
const register = conversionFor(OFCOM_VARIANT, REGISTER_20190912);
const forbidden = conversionFor(OFCOM_VARIANT, FORBIDDEN);

// The callsign+product+status disclosure-log register family (2024-2025): one
// shared factory, three registrations differing only in header spelling (and
// the March-2025 CreatedDate column).
const JULY_2024_VARIANT = 'ofcom-2024-07-register';
const OCT_2024_VARIANT = 'ofcom-2024-10-21-register';
const MAR_2025_VARIANT = 'ofcom-2025-03-13-register';
const july2024 = conversionFor(JULY_2024_VARIANT, 'call-signs.csv');
const oct2024 = conversionFor(OCT_2024_VARIANT, 'copy-of-callsigns-21102024.csv');
const mar2025 = conversionFor(MAR_2025_VARIANT, 'call-signs-13mar2025.csv');

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

// The 2023-24 Salesforce-era register exports (three disclosure-log snapshots
// sharing one shape: Value, Status, Product, Type, Call Sign MMSI: Last
// Modified Date). Product maps to licence_class; Type is the constant service
// discriminator and is dropped; the day-first last-modified date is carried as
// the per-callsign provenance these exports uniquely supply.
const VSP_NOV_VARIANT = 'ofcom-2023-11-24-register';
const VSP_JAN_VARIANT = 'ofcom-2024-01-register';
const vspNov = conversionFor(VSP_NOV_VARIANT, 'call-sign-list-241123.csv');
const vspJan = conversionFor(VSP_JAN_VARIANT, 'foi-1734722-amateur-call-signs.csv');
const VSP_HEADER = 'Value,Status,Product,Type,Call Sign MMSI: Last Modified Date';

// The three snapshots are served CRLF/UTF-8, one with a leading BOM; a helper
// reproduces that framing (no BOM by default, opt in for the BOM case).
function vspBytes(rows: string[], withBom = false): Buffer {
  return Buffer.from((withBom ? BOM : '') + rows.join('\r\n') + '\r\n', 'utf8');
}

describe('FOI CSV normaliser - value/status/product register shape (2023-24)', () => {
  it('FoiNormaliser_ValueStatusProductRows_MapToObservationSchemaSortedByCallsign', () => {
    const input = vspBytes([
      VSP_HEADER,
      'M0IVB,Allocated,Amateur Full Radio Licence,Call Sign - Amateur,03/10/2021',
      '20AAA,Reserved,Amateur Intermediate Radio Licence,Call Sign - Amateur,07/07/2017',
    ]);
    const result = convertFoiSource(input, vspNov);
    expect(result.csv).toBe(
      'callsign,status,licence_class,last_modified_date\n' +
      '20AAA,Reserved,Amateur Intermediate Radio Licence,2017-07-07\n' +
      'M0IVB,Allocated,Amateur Full Radio Licence,2021-10-03\n');
    expect(result.recordCount).toBe(2);
  });

  it('FoiNormaliser_ValueStatusProductTypeColumn_DroppedFromOutput', () => {
    // 'Type' is 'Call Sign - Amateur' across the whole export - a service
    // discriminator recorded in meta.json, not a per-row assertion.
    const input = vspBytes([VSP_HEADER, 'M0IVB,Allocated,Amateur Full Radio Licence,Call Sign - Amateur,03/10/2021']);
    expect(convertFoiSource(input, vspNov).csv).not.toContain('Call Sign - Amateur');
  });

  it('FoiNormaliser_ValueStatusProductWithBomHeader_ParsesFirstColumn', () => {
    // The FOI 1734722 export is served with a leading UTF-8 BOM; it must be
    // stripped so the first header is 'Value', not the BOM-prefixed form.
    const input = vspBytes([VSP_HEADER, 'M0ABC,Allocated,Amateur Full Radio Licence,Call Sign - Amateur,03/10/2021'], true);
    expect(convertFoiSource(input, vspJan).csv).toBe(
      'callsign,status,licence_class,last_modified_date\n' +
      'M0ABC,Allocated,Amateur Full Radio Licence,2021-10-03\n');
  });

  it('FoiNormaliser_ValueStatusProductBlankProduct_PreservesEmptyLicenceClass', () => {
    // The reserved pool in the complete register carries a blank Product - the
    // source asserts no product, so licence_class is emptied, never backfilled.
    const input = vspBytes([VSP_HEADER, 'W4WNZ,Reserved,,Call Sign - Amateur,12/08/2016']);
    const result = convertFoiSource(input, vspJan);
    expect(result.csv).toContain('W4WNZ,Reserved,,2016-08-12');
    expect(result.notes.blankCounts['licence_class']).toBe(1);
  });

  it('FoiNormaliser_ValueStatusProductUnexpectedStatus_CarriedVerbatim', () => {
    // Status is carried verbatim - the converter does not gate on a status
    // vocabulary, so an unexpected value is preserved (surfaced by the manual
    // sanity check on ingest, never silently dropped or rewritten).
    const input = vspBytes([VSP_HEADER, 'G9XYZ,Quarantine,Amateur Full Radio Licence,Call Sign - Amateur,03/10/2021']);
    expect(convertFoiSource(input, vspNov).csv).toContain('G9XYZ,Quarantine,');
  });

  it('FoiNormaliser_ValueStatusProductExcelMangledCallsign_CarriedVerbatim', () => {
    // The 24 November list serves Intermediate 20xxx callsigns whose suffix
    // reads as a month AS dates (20APR -> 20-Apr); carried verbatim, never
    // repaired back to a guessed suffix.
    const input = vspBytes([VSP_HEADER, '20-Apr,Allocated,Amateur Intermediate Radio Licence,Call Sign - Amateur,16/03/2023']);
    expect(convertFoiSource(input, vspNov).csv).toContain('20-Apr,Allocated,');
  });

  it('FoiNormaliser_ValueStatusProductLastModifiedAfterVintage_ThrowsPlausibilityFailure', () => {
    // A last-modified date cannot postdate the snapshot vintage (2023-11-24).
    const input = vspBytes([VSP_HEADER, 'G9XYZ,Allocated,Amateur Full Radio Licence,Call Sign - Amateur,25/11/2023']);
    expect(() => convertFoiSource(input, vspNov)).toThrow(/future/i);
  });

  it('FoiNormaliser_ValueStatusProductTrailingNbspCallsign_TrimmedAndCounted', () => {
    // The NBSP trio (2E1HON/G0TQK/G7IWE) carries a trailing non-breaking space
    // in the complete-register export; the trim is the sole canonicalisation
    // and it is counted, never silent.
    const input = vspBytes([VSP_HEADER, `G0TQK${NBSP},Allocated,Amateur Full Radio Licence,Call Sign - Amateur,03/10/2021`]);
    const result = convertFoiSource(input, vspJan);
    expect(result.csv).toContain('G0TQK,Allocated');
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
  });
});

describe('FOI CSV normaliser - callsign+product+status register family', () => {
  it('FoiNormaliser_July2024CallSignSpaceHeader_MapsToObservationSchema', () => {
    // The July-2024 export spells the callsign column 'Call sign' (with a
    // space) and the date column 'Call Sign MMSI: Last Modified Date'; the
    // shared factory pins those exact spellings. Product becomes licence_class
    // verbatim; the constant Type is not carried.
    const input = utf8Crlf([
      'Call sign,Product,Status,Type,Call Sign MMSI: Last Modified Date',
      'M7WKP,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/04/2024',
      'G6KZH,,Reserved,Call Sign - Amateur,12/08/2016',
    ]);
    const result = convertFoiSource(input, july2024);
    expect(result.csv).toBe(
      'callsign,status,licence_class,last_modified_date\n' +
      'G6KZH,Reserved,,2016-08-12\n' +
      'M7WKP,Allocated,Amateur Foundation Radio Licence,2024-04-21\n');
    expect(result.recordCount).toBe(2);
    expect(result.schemaVersion).toBe(FOI_NORMALISED_SCHEMA_VERSION);
  });

  it('FoiNormaliser_October2024BomHeader_DecodedAndMappedByName', () => {
    // The October-2024 export spells the column 'Callsign' (one word) and is
    // served with a UTF-8 BOM; the BOM must be stripped and the header matched.
    const input = utf8BomCrlf([
      'Callsign,Product,Status,Type,Last Modified Date',
      'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/04/2024',
    ]);
    const result = convertFoiSource(input, oct2024);
    expect(result.csv).toBe(
      'callsign,status,licence_class,last_modified_date\n' +
      'M0IVB,Allocated,Amateur Full Radio Licence,2024-04-21\n');
  });

  it('FoiNormaliser_March2025Variant_CarriesCreatedDateColumn', () => {
    // The March-2025 export uniquely adds a CreatedDate column, carried as the
    // registered created_date extension alongside last_modified_date.
    const input = utf8Crlf([
      'Callsign,Product,Status,Type,LastModifiedDate,CreatedDate',
      'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/04/2024,20/01/2019',
    ]);
    const result = convertFoiSource(input, mar2025);
    expect(result.csv).toBe(
      'callsign,status,licence_class,last_modified_date,created_date\n' +
      'M0IVB,Allocated,Amateur Full Radio Licence,2024-04-21,2019-01-20\n');
  });

  it('FoiNormaliser_BlankProduct_PreservedAsEmptyLicenceClass', () => {
    // Product is undisclosed for a large minority of rows (most Reserved and
    // Available callsigns); the blank is data, preserved and counted.
    const input = utf8Crlf([
      'Call sign,Product,Status,Type,Call Sign MMSI: Last Modified Date',
      'G6KZH,,Reserved,Call Sign - Amateur,12/08/2016',
    ]);
    const result = convertFoiSource(input, july2024);
    expect(result.csv).toContain('G6KZH,Reserved,,2016-08-12');
    expect(result.notes.blankCounts['licence_class']).toBe(1);
  });

  it('FoiNormaliser_UnexpectedStatus_CarriedVerbatim', () => {
    // Status carries the source vocabulary verbatim - an unexpected value is
    // preserved, never rejected or canonicalised (the source is the authority).
    const input = utf8Crlf([
      'Call sign,Product,Status,Type,Call Sign MMSI: Last Modified Date',
      'M7ABC,Amateur Foundation Radio Licence,Suspended,Call Sign - Amateur,21/04/2024',
    ]);
    const result = convertFoiSource(input, july2024);
    expect(result.csv).toContain('M7ABC,Suspended,Amateur Foundation Radio Licence,2024-04-21');
  });

  it('FoiNormaliser_ConstantTypeColumn_DroppedFromOutput', () => {
    // 'Type' is 'Call Sign - Amateur' on every row - the service discriminator
    // recorded in meta.json, required-present but not carried per row.
    const input = utf8Crlf([
      'Callsign,Product,Status,Type,LastModifiedDate,CreatedDate',
      'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/04/2024,20/01/2019',
    ]);
    expect(convertFoiSource(input, mar2025).csv).not.toContain('Call Sign - Amateur');
  });

  it('FoiNormaliser_LastModifiedDateAfterVintage_ThrowsPlausibilityFailure', () => {
    // A record last-modified date cannot postdate the snapshot vintage
    // (2024-07-31 for the July-2024 entry's plausibility ceiling).
    const input = utf8Crlf([
      'Call sign,Product,Status,Type,Call Sign MMSI: Last Modified Date',
      'M7WKP,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,01/08/2024',
    ]);
    expect(() => convertFoiSource(input, july2024)).toThrow(/future/i);
  });

  it('FoiNormaliser_FamilyShufflesColumns_MapsByHeaderNameNotPosition', () => {
    // Columns are identified by NAME across the whole family: a source reorder
    // produces identical output.
    const canonical = utf8Crlf([
      'Callsign,Product,Status,Type,LastModifiedDate,CreatedDate',
      'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,21/04/2024,20/01/2019',
    ]);
    const shuffled = utf8Crlf([
      'CreatedDate,Type,Status,Callsign,LastModifiedDate,Product',
      '20/01/2019,Call Sign - Amateur,Allocated,M0IVB,21/04/2024,Amateur Full Radio Licence',
    ]);
    expect(convertFoiSource(shuffled, mar2025).csv).toBe(convertFoiSource(canonical, mar2025).csv);
  });
});

describe('FOI CSV normaliser - 2021 dated register annexes', () => {
  // The two 2021 UKGWA-captured annexes carry the register core extended with
  // typed Reserved to Date / Original Start Date / Licence Type columns. They
  // differ ONLY in the case of two headers, so each binds its own variant.
  const jan = conversionFor('ofcom-2021-01-register', 'raw-extract-sheet-1-callsigns.csv');
  const apr = conversionFor('ofcom-2021-04-register', 'raw-extract-sheet-1-sheet1.csv');

  // Extracts are UTF-8 without BOM and LF-terminated (the xlsx-extract output).
  function utf8Lf(lines: string[]): Buffer {
    return Buffer.from(lines.join('\n') + '\n', 'utf8');
  }

  it('FoiNormaliser_DatedRegisterRows_MapToObservationSchemaWithIsoDatesSortedByCallsign', () => {
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      'M0ABC,Allocated,Call Sign - Amateur,,2020-05-01,Amateur Full Radio Licence',
      'G5XYZ,Reserved,Call Sign - Amateur,2023-01-07,,',
      '20DEF,Available,Call Sign - Amateur,,2019-03-14,Amateur Intermediate Radio Licence',
    ]);
    const result = convertFoiSource(input, jan);
    expect(result.csv).toBe(
      'callsign,status,licence_class,reserved_to_date,original_start_date\n' +
      '20DEF,Available,Amateur Intermediate Radio Licence,,2019-03-14\n' +
      'G5XYZ,Reserved,,2023-01-07,\n' +
      'M0ABC,Allocated,Amateur Full Radio Licence,,2020-05-01\n');
    expect(result.recordCount).toBe(3);
    // The constant Type discriminator is required-present but never carried.
    expect(result.csv).not.toContain('Call Sign - Amateur');
  });

  it('FoiNormaliser_AprilAnnexLowerCaseHeaders_MatchedByTheAprilVariant', () => {
    // The spring-2021 disclosure names its columns 'Original start date' and
    // 'Licence type'; the April variant matches those exact names.
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original start date,Licence type',
      'M0ABC,Allocated,Call Sign - Amateur,,2020-05-01,Amateur Full Radio Licence',
    ]);
    const result = convertFoiSource(input, apr);
    expect(result.csv).toBe(
      'callsign,status,licence_class,reserved_to_date,original_start_date\n' +
      'M0ABC,Allocated,Amateur Full Radio Licence,,2020-05-01\n');
  });

  it('FoiNormaliser_JanuaryHeadersAgainstAprilVariant_ThrowsOnExactNameMismatch', () => {
    // Case is part of the header name: the capitalised January headers are a
    // different shape from the April variant's, and must fail rather than be
    // silently accepted.
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      'M0ABC,Allocated,Call Sign - Amateur,,2020-05-01,Amateur Full Radio Licence',
    ]);
    expect(() => convertFoiSource(input, apr)).toThrow(/Original Start Date|Original start date/);
  });

  it('FoiNormaliser_BlankStatusAndEmptyCallsign_PreservedWithEmptyCallsignSortingFirst', () => {
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      'M0ABC,Allocated,Call Sign - Amateur,,2020-05-01,Amateur Full Radio Licence',
      ',Reserved,Call Sign - Amateur,,,',
      'M0BLK,,Call Sign - Amateur,,,',
    ]);
    const result = convertFoiSource(input, jan);
    // The empty call sign is data (Reserved) and sorts first; the blank status
    // is preserved as an empty field, not dropped.
    expect(result.csv.startsWith('callsign,status,licence_class,reserved_to_date,original_start_date\n,Reserved,,,\n')).toBe(true);
    expect(result.notes.blankCounts['status']).toBe(1);
    expect(result.notes.blankCounts['callsign']).toBe(1);
    expect(result.csv).toContain('M0BLK,,,,\n');
  });

  it('FoiNormaliser_CallsignWithTrailingNbsp_TrimmedAndCounted', () => {
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      `G0TQK${NBSP},Allocated,Call Sign - Amateur,,2019-01-01,Amateur Full Radio Licence`,
    ]);
    const result = convertFoiSource(input, jan);
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
    expect(result.csv).toContain('G0TQK,Allocated,');
    expect(result.csv).not.toContain(NBSP);
  });

  it('FoiNormaliser_OriginalStartDateAfterVintage_ThrowsPlausibilityFailure', () => {
    // The issue date cannot postdate the snapshot vintage (2021-01-29 here).
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      'M0ABC,Allocated,Call Sign - Amateur,,2021-06-01,Amateur Full Radio Licence',
    ]);
    expect(() => convertFoiSource(input, jan)).toThrow(/future/i);
  });

  it('FoiNormaliser_ReservedToDateAfterVintage_Accepted', () => {
    // A reservation EXPIRY legitimately postdates the vintage (futureAllowed).
    const input = utf8Lf([
      'Value,Status,Type,Reserved to Date,Original Start Date,Licence Type',
      'G5XYZ,Reserved,Call Sign - Amateur,2023-01-07,,',
    ]);
    expect(convertFoiSource(input, jan).csv).toContain('2023-01-07');
  });
});

// The April 2024 Salesforce object export (ofcom-2024-04-30): header
// Value__c,Product__c,Status__c,Type__c - the '__c' custom-field suffix. The
// same callsign-observation core as the other register snapshots (Product
// maps to licence_class, the constant Type__c is dropped), decoded latin-1
// for its lone raw-NBSP byte, with no date column.
const SF_VARIANT = 'ofcom-2024-04-30-register';
const sfRegister = conversionFor(SF_VARIANT, 'copy-all-callsigns-30-apr-24.csv');
const SF_HEADER = 'Value__c,Product__c,Status__c,Type__c';

// latin-1 CRLF framing (no BOM), matching the published April 2024 bytes.
function sfBytes(rows: string[]): Buffer {
  return Buffer.from(rows.join('\r\n') + '\r\n', 'latin1');
}

describe('FOI CSV normaliser - Salesforce __c register shape (2024-04)', () => {
  it('FoiNormaliser_SalesforceCcHeader_MapsToObservationSchemaSortedByCallsign', () => {
    const input = sfBytes([
      SF_HEADER,
      'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur',
      '20RLT,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur',
    ]);
    const result = convertFoiSource(input, sfRegister);
    expect(result.csv).toBe(
      'callsign,status,licence_class\n' +
      '20RLT,Allocated,Amateur Intermediate Radio Licence\n' +
      'M0IVB,Allocated,Amateur Full Radio Licence\n');
    expect(result.recordCount).toBe(2);
    expect(result.schemaVersion).toBe(FOI_NORMALISED_SCHEMA_VERSION);
  });

  it('FoiNormaliser_SalesforceCcTypeColumn_DroppedFromOutput', () => {
    // Type__c is 'Call Sign - Amateur' across the whole export - a constant
    // service discriminator recorded in meta.json, not a per-row assertion.
    const input = sfBytes([SF_HEADER, 'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur']);
    expect(convertFoiSource(input, sfRegister).csv).not.toContain('Call Sign - Amateur');
  });

  it('FoiNormaliser_SalesforceCcBlankProduct_PreservesEmptyLicenceClass', () => {
    // The reserved pool carries a blank Product__c - the source asserts no
    // product, so licence_class is emptied, never backfilled.
    const input = sfBytes([SF_HEADER, 'W4WNZ,,Reserved,Call Sign - Amateur']);
    const result = convertFoiSource(input, sfRegister);
    expect(result.csv).toContain('W4WNZ,Reserved,\n');
    expect(result.notes.blankCounts['licence_class']).toBe(1);
  });

  it('FoiNormaliser_SalesforceCcRawLatin1Nbsp_DecodesAndTrimsAndCounts', () => {
    // The published file's single high byte is a lone 0xA0 (latin-1 NBSP)
    // trailing the 'G7IWE' callsign - decoding must go through latin1 or it
    // gains a U+FFFD; the trim is the sole canonicalisation and is counted.
    const input = Buffer.concat([
      Buffer.from(SF_HEADER + '\r\nG7IWE', 'latin1'),
      Buffer.from([0xa0]),
      Buffer.from(',Amateur Full Radio Licence,Allocated,Call Sign - Amateur\r\n', 'latin1'),
    ]);
    const result = convertFoiSource(input, sfRegister);
    expect(result.csv).toContain('G7IWE,Allocated');
    expect(result.csv).not.toContain('�');
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
  });

  it('FoiNormaliser_SalesforceCcExcelMangledCallsign_CarriedVerbatim', () => {
    // Intermediate 20xxx callsigns whose suffix reads as a month are served AS
    // dates (20APR -> 20-Apr); carried verbatim, never repaired to a suffix.
    const input = sfBytes([SF_HEADER, '20-Apr,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur']);
    expect(convertFoiSource(input, sfRegister).csv).toContain('20-Apr,Allocated,');
  });

  it('FoiNormaliser_SalesforceCcOverLengthCallsign_PassesThroughUnfiltered', () => {
    // 'EDUCATIONAL' (11 chars) and 'ENVIRONMENTS' (12) are real over-length
    // allocations; the normaliser never filters by callsign shape.
    const input = sfBytes([
      SF_HEADER,
      'EDUCATIONAL,Special Event Station,Allocated,Call Sign - Amateur',
      'ENVIRONMENTS,Special Event Station,Allocated,Call Sign - Amateur',
    ]);
    const result = convertFoiSource(input, sfRegister);
    expect(result.csv).toContain('EDUCATIONAL,Allocated');
    expect(result.csv).toContain('ENVIRONMENTS,Allocated');
  });
});

// The September 2024 snapshot (ofcom-2024-09): the widest register shape,
// header Created Date,Product,Reserved to Date,Status,Type,Value. Uniquely,
// Type is NOT constant (Call Sign - Amateur AND Call Sign - NoV) and is not
// derivable from Product, so it is carried verbatim as call_sign_type; both
// date columns are day-first (Created Date bounded, Reserved to Date a
// future-allowed expiry).
const SEP_VARIANT = 'ofcom-2024-09-register';
const sepRegister = conversionFor(SEP_VARIANT, 'every-radio-callsign-spreadsheet.csv');
const SEP_HEADER = 'Created Date,Product,Reserved to Date,Status,Type,Value';

// UTF-8 with BOM, CRLF - the published September 2024 framing.
function sepBytes(rows: string[]): Buffer {
  return Buffer.from(BOM + rows.join('\r\n') + '\r\n', 'utf8');
}

describe('FOI CSV normaliser - widest register shape with varying Type (2024-09)', () => {
  it('FoiNormaliser_SeptemberRows_MapToObservationSchemaWithDatesSortedByCallsign', () => {
    const input = sepBytes([
      SEP_HEADER,
      '10/04/2024 15:28,Amateur Full Radio Licence,,Allocated,Call Sign - Amateur,M0IVB',
      '24/07/2016 18:22,Amateur Intermediate Radio Licence,,Reserved,Call Sign - Amateur,20AAA',
    ]);
    const result = convertFoiSource(input, sepRegister);
    expect(result.csv).toBe(
      'callsign,status,licence_class,call_sign_type,created_date,reserved_to_date\n' +
      '20AAA,Reserved,Amateur Intermediate Radio Licence,Call Sign - Amateur,2016-07-24 18:22,\n' +
      'M0IVB,Allocated,Amateur Full Radio Licence,Call Sign - Amateur,2024-04-10 15:28,\n');
    expect(result.recordCount).toBe(2);
  });

  it('FoiNormaliser_SeptemberVaryingType_CarriesNoVDistinctionVerbatim', () => {
    // Type is not constant here and is not derivable from Product (the
    // 'Special Event Station' product appears under both Amateur and NoV), so
    // dropping it would erase the Notice-of-Variation distinction.
    const input = sepBytes([
      SEP_HEADER,
      '01/06/2023 09:00,Special Event Station,,Allocated,Call Sign - NoV,GB100XYZ',
      '01/06/2023 09:00,Special Event Station,,Allocated,Call Sign - Amateur,GB4ABC',
    ]);
    const result = convertFoiSource(input, sepRegister);
    expect(result.csv).toContain('GB100XYZ,Allocated,Special Event Station,Call Sign - NoV,');
    expect(result.csv).toContain('GB4ABC,Allocated,Special Event Station,Call Sign - Amateur,');
  });

  it('FoiNormaliser_SeptemberReservedToDateInFuture_Accepted', () => {
    // Reserved to Date is a reservation EXPIRY; the 2099 "permanent"
    // placeholder legitimately postdates the vintage.
    const input = sepBytes([
      SEP_HEADER,
      '24/07/2016 18:22,Amateur Intermediate Radio Licence,31/12/2099,Reserved,Call Sign - Amateur,20AAA',
    ]);
    expect(convertFoiSource(input, sepRegister).csv).toContain(',2016-07-24 18:22,2099-12-31\n');
  });

  it('FoiNormaliser_SeptemberCreatedDateAfterVintage_ThrowsPlausibilityFailure', () => {
    // The record-creation date cannot postdate the snapshot vintage (bounded
    // by the disclosure-month ceiling 2024-09-30).
    const input = sepBytes([
      SEP_HEADER,
      '01/10/2024 00:00,Amateur Full Radio Licence,,Allocated,Call Sign - Amateur,M0ZZZ',
    ]);
    expect(() => convertFoiSource(input, sepRegister)).toThrow(/future/i);
  });

  it('FoiNormaliser_SeptemberDotAndBlankCallsigns_PreservedAsData', () => {
    // The source asserts a callsign of a single '.' and, separately, an empty
    // Value; both are data, never dropped, and sort first (codepoint order).
    const input = sepBytes([
      SEP_HEADER,
      '10/04/2024 15:28,Amateur Foundation Radio Licence,,Allocated,Call Sign - Amateur,.',
      '11/05/2022 10:53,,,Available,Call Sign - Amateur,',
      '24/07/2016 18:22,Amateur Intermediate Radio Licence,,Reserved,Call Sign - Amateur,20AAA',
    ]);
    const result = convertFoiSource(input, sepRegister);
    expect(result.csv.startsWith(
      'callsign,status,licence_class,call_sign_type,created_date,reserved_to_date\n' +
      ',Available,,Call Sign - Amateur,2022-05-11 10:53,\n' +
      '.,Allocated,Amateur Foundation Radio Licence,Call Sign - Amateur,2024-04-10 15:28,\n')).toBe(true);
    expect(result.notes.blankCounts['callsign']).toBe(1);
  });

  it('FoiNormaliser_SeptemberTrailingNbspCallsign_TrimmedAndCounted', () => {
    // The NBSP quartet (2E1HON/G0TQK/G7IWE/GB2DWM) carries a trailing UTF-8
    // non-breaking space; the trim is the sole canonicalisation and counted.
    const input = sepBytes([
      SEP_HEADER,
      `12/02/2018 13:37,Amateur Full Radio Licence,,Allocated,Call Sign - Amateur,G0TQK${NBSP}`,
    ]);
    const result = convertFoiSource(input, sepRegister);
    expect(result.csv).toContain('G0TQK,Allocated');
    expect(result.notes.nbspCellCount).toBe(1);
    expect(result.notes.trimmedCellCount).toBe(1);
  });

  it('FoiNormaliser_SeptemberInteriorSpaceCallsign_KeptIntact', () => {
    // 'GB GU75LIB' and 'G6 FMU' carry interior spaces - part of the assertion,
    // never trimmed away.
    const input = sepBytes([
      SEP_HEADER,
      '01/06/2023 09:00,Special Event Station,,Allocated,Call Sign - NoV,GB GU75LIB',
    ]);
    const result = convertFoiSource(input, sepRegister);
    expect(result.csv).toContain('GB GU75LIB,Allocated');
    expect(result.notes.trimmedCellCount).toBe(0);
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

  it('FoiArchive_Ofcom20170713Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2017-07-13--all-callsigns', 'ofcom-2017-07-13-register', [135866]);
    // The oldest CSV header shape carries Ofcom's own prefix/suffix
    // decomposition (Prefix, Suffix), required-present but not carried - the
    // normalised projection keeps the register-snapshot core only.
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class');
    // One row asserts a blank callsign with a Reserved status - data, not
    // dropped, and it sorts first under the codepoint order.
    expect(results[0].notes.blankCounts['callsign']).toBe(1);
    expect(results[0].csv.startsWith('callsign,status,licence_class\n,Reserved,\n')).toBe(true);
    // No blank statuses in this snapshot (contrast the 2019 registers).
    expect(results[0].notes.blankCounts['status']).toBeUndefined();
  });

  it('FoiArchive_Ofcom01420046Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-01420046--allocated-reserved-callsigns', 'ofcom-01420046-register', [150181]);
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class');
    // 12 blank statuses in an "allocated and reserved" list - preserved, on
    // the record; the constant Type column is required-present but not carried.
    expect(results[0].notes.blankCounts['status']).toBe(12);
    // The trailing-NBSP trio (G0TQK, G7IWE, 2E1HON) is trimmed, counted here,
    // never silently.
    expect(results[0].notes.nbspCellCount).toBe(3);
    // The ',,' Value (two commas, Reserved) is preserved verbatim - RFC-4180
    // quoted because it contains commas - and sorts first under the codepoint
    // order.
    expect(results[0].csv.startsWith('callsign,status,licence_class\n",,",Reserved,\n')).toBe(true);
    // 'G6 FMU' keeps its interior space (the same anomaly as the 2017 register).
    expect(results[0].csv).toContain('G6 FMU,');
  });

  it('FoiArchive_Ofcom20231124Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2023-11-24--call-sign-list--all-callsigns', 'ofcom-2023-11-24-register', [108922]);
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,last_modified_date');
    // Ten blank statuses - data, preserved on the record.
    expect(results[0].notes.blankCounts['status']).toBe(10);
    // This export carries no NBSP (the December pair matches; the FOI 1734722
    // complete register carries the trailing-NBSP trio).
    expect(results[0].notes.nbspCellCount).toBe(0);
    // Thirteen Excel-mangled 20xxx callsigns are carried verbatim.
    expect(results[0].csv).toContain('20-Apr,Allocated');
  });

  it('FoiArchive_Ofcom20231207Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2023-12-07--open-data-call-sign-list--all-callsigns', 'ofcom-2023-12-07-register', [108992]);
    expect(results[0].notes.blankCounts['status']).toBe(9);
    expect(results[0].notes.nbspCellCount).toBe(0);
    // Unlike the 24 November list, this export carries no Excel date-mangling.
    expect(results[0].csv).not.toContain('20-Apr,');
  });

  it('FoiArchive_Ofcom202401Foi1734722Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2024-01--foi-1734722--all-callsigns', 'ofcom-2024-01-register', [153938]);
    // The complete register carries the reserved pool: 44,860 blank products.
    expect(results[0].notes.blankCounts['licence_class']).toBe(44860);
    expect(results[0].notes.blankCounts['status']).toBe(11);
    // The trailing-NBSP trio (2E1HON/G0TQK/G7IWE) is served here, trimmed.
    expect(results[0].notes.nbspCellCount).toBe(3);
    // A product vocabulary the December lists lack.
    expect(results[0].csv).toContain('Special Event Station');
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

  // The callsign+product+status disclosure-log register family (2024-2025):
  // one shared factory, three snapshots. Each must reproduce its committed
  // normalised file byte-for-byte from the archived raw CSV.
  it('FoiArchive_Ofcom202407Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2024-07--call-signs--all-callsigns', JULY_2024_VARIANT, [155346]);
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,last_modified_date');
    // Product (licence_class) is undisclosed for a large minority - blanks are data.
    expect(results[0].notes.blankCounts['licence_class']).toBe(45001);
    expect(results[0].notes.blankCounts['status']).toBe(11);
    // Excel date-mangled callsigns are carried verbatim, never reconstructed.
    expect(results[0].csv).toContain('\n21-Oct,Allocated,,2024-06-03\n');
  });

  it('FoiArchive_Ofcom20241021Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2024-10-21--callsigns--all-callsigns', OCT_2024_VARIANT, [156278]);
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,last_modified_date');
    expect(results[0].notes.blankCounts['licence_class']).toBe(45062);
    expect(results[0].notes.blankCounts['status']).toBe(12);
    // The trailing-non-breaking-space trio (G7IWE, G0TQK, 2E1HON) is trimmed
    // and counted here, never silently.
    expect(results[0].notes.nbspCellCount).toBe(3);
    expect(results[0].notes.trimmedCellCount).toBe(3);
  });

  it('FoiArchive_Ofcom20250313Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2025-03-13--callsigns--all-callsigns', MAR_2025_VARIANT, [157227]);
    // This snapshot uniquely carries created_date alongside last_modified_date.
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,last_modified_date,created_date');
    expect(results[0].notes.blankCounts['licence_class']).toBe(45149);
    expect(results[0].notes.blankCounts['status']).toBe(14);
    // The over-length reciprocal 'M/TKG 2021' (interior space, Temporary
    // Reciprocal) survives verbatim.
    expect(results[0].csv).toContain('M/TKG 2021,Available,Amateur Temporary Reciprocal Radio Licence');
  });

  it('FoiArchive_Ofcom202101Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2021-01--all-callsigns', 'ofcom-2021-01-register', [146763]);
    // The 2021 annexes extend the register core with the reservation-expiry
    // and original-start (issue) date columns and the licence product.
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,reserved_to_date,original_start_date');
    // Blank statuses (10) are data in an "all call signs" export - preserved.
    expect(results[0].notes.blankCounts['status']).toBe(10);
    // The trailing-NBSP trio (G0TQK, G7IWE, 2E1HON) is trimmed and counted.
    expect(results[0].notes.nbspCellCount).toBe(3);
    // The empty Value (blank call sign, Reserved) sorts first under codepoint
    // order, ahead of the ',,' Value.
    expect(results[0].csv.startsWith('callsign,status,licence_class,reserved_to_date,original_start_date\n,Reserved,,,\n",,",Reserved,,,\n')).toBe(true);
    // 'G6 FMU' keeps its interior space; the source's own product vocabulary
    // (including the Temporary Reciprocal type) is carried verbatim.
    expect(results[0].csv).toContain('G6 FMU,');
    expect(results[0].csv).toContain('Amateur Temporary Reciprocal Radio Licence');
    // A reservation expiry beyond the vintage is legitimate (futureAllowed).
    expect(results[0].csv).toContain(',2023-01-07,');
  });

  it('FoiArchive_Ofcom202104Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    // The spring-2021 sibling: same shape, three months on, differing only in
    // the case of two source headers (matched by exact name via its variant).
    const results = expectEntryReproduced('ofcom-2021-04--all-callsigns', 'ofcom-2021-04-register', [147877]);
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,reserved_to_date,original_start_date');
    expect(results[0].notes.blankCounts['status']).toBe(9);
    expect(results[0].notes.nbspCellCount).toBe(3);
    expect(results[0].csv.startsWith('callsign,status,licence_class,reserved_to_date,original_start_date\n,Reserved,,,\n",,",Reserved,,,\n')).toBe(true);
    expect(results[0].csv).toContain(',2023-04-19,');
  });

  it('FoiArchive_Ofcom20240430Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2024-04-30--copy-all-callsigns--all-callsigns', 'ofcom-2024-04-30-register', [154582]);
    // The Salesforce __c export keeps the callsign-observation core; Type__c
    // is dropped, Product__c becomes licence_class.
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class');
    // The reserved pool carries a blank Product__c (44,777 blank classes); a
    // single blank status is data, on the record.
    expect(results[0].notes.blankCounts['licence_class']).toBe(44777);
    expect(results[0].notes.blankCounts['status']).toBe(1);
    // A single latin-1 raw-NBSP callsign (G7IWE) is decoded, trimmed, counted.
    expect(results[0].notes.nbspCellCount).toBe(1);
    // Excel date-mangling and the over-length educational allocations survive.
    expect(results[0].csv).toContain('20-Apr,Allocated');
    expect(results[0].csv).toContain('EDUCATIONAL,Allocated');
    expect(results[0].csv).toContain('ENVIRONMENTS,Allocated');
  });

  it('FoiArchive_Ofcom202409Entry_ReproducesCommittedNormalisedFilesByteForByte', { timeout: GOLDEN_MASTER_TIMEOUT_MS }, () => {
    const results = expectEntryReproduced('ofcom-2024-09--every-radio-callsign--all-callsigns', 'ofcom-2024-09-register', [159999]);
    // The widest register shape keeps the varying Type as call_sign_type.
    expect(results[0].csv.split('\n', 1)[0]).toBe('callsign,status,licence_class,call_sign_type,created_date,reserved_to_date');
    // Type varies here (unique among register snapshots): the NoV callsigns
    // are carried, not dropped.
    expect(results[0].csv.split('\n').filter(line => line.includes(',Call Sign - NoV,'))).toHaveLength(3951);
    // The reserved pool (45,246 blank classes) and 14 blank statuses are data.
    expect(results[0].notes.blankCounts['licence_class']).toBe(45246);
    expect(results[0].notes.blankCounts['status']).toBe(14);
    // Two blank callsigns and the trailing-NBSP quartet are preserved/trimmed.
    expect(results[0].notes.blankCounts['callsign']).toBe(2);
    expect(results[0].notes.nbspCellCount).toBe(4);
    // The '.' callsign and the mangled numeric 22032024 survive verbatim.
    expect(results[0].csv).toContain('\n.,Allocated,');
    expect(results[0].csv).toContain('22032024,');
    // Interior-space callsign kept; both date columns day-first verified.
    expect(results[0].csv).toContain('GB GU75LIB,');
    expect(results[0].notes.unverifiedDateColumns).toEqual([]);
  });
});
