import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {
  extractWorkbook,
  toCsvBytes,
  extractFileNameFor,
  excelSerialToIso,
  isDateFormatCode,
} from './xlsx-extract.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The mechanical xlsx extractor (issue #139, tier 3): hand-rolled on Node
// built-ins so the extraction arrow of ADR 0004's derivation chain is
// repo-owned and CI-verifiable. Fixtures below build real (stored, i.e.
// uncompressed) zip containers by hand; the golden test at the end
// re-derives every committed extract from the archived workbook bytes -
// which is also the permanent differential test against the openpyxl
// implementation that produced them originally.

// --- Minimal xlsx builder for fixtures ----------------------------------

function storedZip(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBytes, eocd]);
}

interface FixtureSheet {
  name: string;
  cells: string;
}

// Assembles a workbook with the given sheets, optional shared strings and
// one custom number format (id 164) applied by style index 1.
function workbookOf(sheets: FixtureSheet[], options: { sharedStrings?: string[]; customFormat?: string; date1904?: boolean } = {}): Buffer {
  const files: Record<string, string> = {
    'xl/workbook.xml':
      `<workbook>${options.date1904 === true ? '<workbookPr date1904="1"/>' : ''}<sheets>` +
      sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      '</Relationships>',
    'xl/styles.xml':
      '<styleSheet>' +
      (options.customFormat === undefined ? '' : `<numFmts count="1"><numFmt numFmtId="164" formatCode="${options.customFormat}"/></numFmts>`) +
      '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs>' +
      '</styleSheet>',
  };
  if (options.sharedStrings !== undefined) {
    files['xl/sharedStrings.xml'] =
      '<sst>' + options.sharedStrings.map(s => `<si><t>${s}</t></si>`).join('') + '</sst>';
  }
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${sheet.cells}</sheetData></worksheet>`;
  });
  return storedZip(files);
}

describe('xlsx extractor - cell rendering', () => {
  it('XlsxExtract_SharedAndInlineStrings_RenderVerbatim', () => {
    const workbook = workbookOf(
      [{ name: 'Sheet1', cells: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>G6 FMU</t></is></c></row>' }],
      { sharedStrings: ['G0ARC'] },
    );
    const [sheet] = extractWorkbook(workbook);
    expect(sheet.rows).toEqual([['G0ARC', 'G6 FMU']]);
  });

  it('XlsxExtract_DateFormattedSerial_RendersIsoWithMidnightAsDateOnly', () => {
    // 1219 = 1903-05-03 (the register's famous opening date); the second
    // cell carries a one-hour time fraction, a real artefact shape in the
    // Pre-War annex - rendered, never stripped.
    const workbook = workbookOf(
      [{ name: 'Dates', cells: '<row r="1"><c r="A1" s="1"><v>1219</v></c><c r="B1" s="1"><v>32792.0416666666666667</v></c></row>' }],
      { customFormat: 'dd/mm/yyyy' },
    );
    const [sheet] = extractWorkbook(workbook);
    expect(sheet.rows).toEqual([['1903-05-03', '1989-10-11 01:00:00']]);
  });

  it('XlsxExtract_GeneralFormatInteger_RendersPlainDigits', () => {
    const workbook = workbookOf(
      [{ name: 'Numbers', cells: '<row r="1"><c r="A1"><v>6371</v></c></row>' }],
    );
    const [sheet] = extractWorkbook(workbook);
    expect(sheet.rows).toEqual([['6371']]);
  });

  it('XlsxExtract_NonIntegerGeneralNumber_Throws', () => {
    const workbook = workbookOf(
      [{ name: 'Numbers', cells: '<row r="1"><c r="A1"><v>1.5</v></c></row>' }],
    );
    expect(() => extractWorkbook(workbook)).toThrow(/non-integer/);
  });

  it('XlsxExtract_BooleanCell_Throws', () => {
    const workbook = workbookOf(
      [{ name: 'Sheet1', cells: '<row r="1"><c r="A1" t="b"><v>1</v></c></row>' }],
    );
    expect(() => extractWorkbook(workbook)).toThrow(/unsupported cell type "b"/);
  });

  it('XlsxExtract_FormulaCell_Throws', () => {
    // The archive is plain exports; a formula is a new construct deserving
    // review, and its cached value must not be silently taken as data.
    const workbook = workbookOf(
      [{ name: 'Sheet1', cells: '<row r="1"><c r="A1"><f>SUM(B1)</f><v>2</v></c></row>' }],
    );
    expect(() => extractWorkbook(workbook)).toThrow(/formula/);
  });

  it('XlsxExtract_XmlEntities_DecodedInStringsAndAttributes', () => {
    const workbook = workbookOf(
      [{ name: 'Sheet1', cells: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }],
      { sharedStrings: ['A &amp; B &lt;C&gt; &#xa0;'] },
    );
    const [sheet] = extractWorkbook(workbook);
    expect(sheet.rows).toEqual([['A & B <C>  ']]);
  });
});

describe('xlsx extractor - sheet shaping', () => {
  it('XlsxExtract_TrailingDimensionNoise_DroppedButInteriorBlanksKept', () => {
    // A phantom empty trailing column and row (Excel dimension noise) are
    // dropped; the interior blank row is structure and stays.
    const workbook = workbookOf([{
      name: 'Sheet1',
      cells:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c><c r="B1"/></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>Data</t></is></c></row>' +
        '<row r="4"><c r="A4"/><c r="B4"/></row>',
    }]);
    const [sheet] = extractWorkbook(workbook);
    expect(sheet.rows).toEqual([['Title'], [''], ['Data']]);
  });

  it('XlsxExtract_EmptySheet_ReportedNullWithPositionKept', () => {
    const workbook = workbookOf([
      { name: 'Data', cells: '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>' },
      { name: 'Sheet2', cells: '' },
      { name: 'Notes', cells: '<row r="1"><c r="A1" t="inlineStr"><is><t>y</t></is></c></row>' },
    ]);
    const sheets = extractWorkbook(workbook);
    expect(sheets.map(s => [s.position, s.rows === null])).toEqual([[1, false], [2, true], [3, false]]);
    // Sheet numbering keeps workbook position, so names stay honest even
    // when an interior sheet is skipped.
    expect(extractFileNameFor(sheets[2])).toBe('raw-extract-sheet-3-notes.csv');
  });

  it('XlsxExtract_Date1904Workbook_Throws', () => {
    const workbook = workbookOf(
      [{ name: 'Sheet1', cells: '<row r="1"><c r="A1"><v>1</v></c></row>' }],
      { date1904: true },
    );
    expect(() => extractWorkbook(workbook)).toThrow(/1904/);
  });
});

describe('xlsx extractor - CSV framing', () => {
  it('XlsxExtractCsv_SpecialCharacters_QuotedMinimally', () => {
    expect(toCsvBytes([['plain', 'a,b', 'say "hi"', 'two\nlines']]).toString('utf8'))
      .toBe('plain,"a,b","say ""hi""","two\nlines"\n');
  });

  it('XlsxExtractCsv_LoneEmptyCellRow_QuotedSoItRoundTrips', () => {
    // An unquoted lone empty field would read back as a blank line, not a
    // one-cell row (and this matches the committed extracts' framing).
    expect(toCsvBytes([[''], ['a', '']]).toString('utf8')).toBe('""\na,\n');
  });
});

describe('xlsx extractor - date machinery', () => {
  it('ExcelSerialToIso_KnownSerials_MatchCalendar', () => {
    expect(excelSerialToIso(1219)).toBe('1903-05-03');
    expect(excelSerialToIso(43687)).toBe('2019-08-10');
    // 23:00:00 fraction - the re-issue events' timezone ghost shape.
    expect(excelSerialToIso(42522 + 23 / 24)).toBe('2016-06-01 23:00:00');
  });

  it('ExcelSerialToIso_PreLotusBugWindow_Throws', () => {
    // Serials below 61 sit in the 1900 leap-year-bug window; nothing in
    // this archive can produce them, so refuse rather than guess.
    expect(() => excelSerialToIso(59)).toThrow(/range/);
  });

  it('IsDateFormatCode_DateTokensOutsideLiteralsOnly_Detected', () => {
    expect(isDateFormatCode('dd/mm/yyyy')).toBe(true);
    expect(isDateFormatCode('hh:mm:ss')).toBe(true);
    expect(isDateFormatCode('0.00')).toBe(false);
    expect(isDateFormatCode('#,##0')).toBe(false);
    // 'd' inside a quoted literal or bracket is not a date token.
    expect(isDateFormatCode('"days" 0')).toBe(false);
    expect(isDateFormatCode('[Red]0')).toBe(false);
  });
});

// The extraction golden master: every committed raw-extract-sheet-*.csv must
// be reproducible from the archived workbook bytes, byte-for-byte, with no
// extras and none missing. This closes ADR 0004's derivation chain in CI
// (raw -> extract -> normalised) and is the permanent differential test
// against the openpyxl implementation that originally produced the files.
describe('xlsx extractor - archive golden master', () => {
  const foiRoot = path.resolve(import.meta.dirname, '..', '..', 'archive', 'foi');
  const workbookEntries = fs.readdirSync(foiRoot)
    .filter(entry => fs.readdirSync(path.join(foiRoot, entry)).some(f => f.endsWith('.xlsx')));

  it('XlsxExtract_AllArchivedWorkbooks_ReproduceCommittedExtractsByteForByte', { timeout: 60_000 }, () => {
    expect(workbookEntries).toHaveLength(13);
    for (const entry of workbookEntries) {
      const entryDir = path.join(foiRoot, entry);
      const produced = new Set<string>();
      for (const workbook of fs.readdirSync(entryDir).filter(f => f.endsWith('.xlsx'))) {
        for (const sheet of extractWorkbook(fs.readFileSync(path.join(entryDir, workbook)))) {
          if (sheet.rows === null) continue;
          const name = extractFileNameFor(sheet);
          produced.add(name);
          const committed = fs.readFileSync(path.join(entryDir, name));
          expect(toCsvBytes(sheet.rows).equals(committed), `${entry}/${name} must match committed bytes`).toBe(true);
        }
      }
      const committedExtracts = fs.readdirSync(entryDir).filter(f => f.startsWith('raw-extract-sheet-'));
      expect([...produced].sort()).toEqual(committedExtracts.sort());
    }
  });
});
