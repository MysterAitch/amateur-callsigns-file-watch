/**
 * Mechanical xlsx -> CSV extraction for archived FOI workbooks (issue #139,
 * tier 3), per ADR 0004's derivation chain:
 *
 *   raw .xlsx -> raw-extract-sheet-{n}-{slug}.csv (mechanical, committed,
 *   hash-pinned) -> normalised--*.csv (converter, authored binding in
 *   meta.json)
 *
 * This module performs ONLY the first arrow, and is deliberately dumb:
 * every non-empty sheet is written in full - title rows, preamble, blanks
 * and all - and no interpretation happens here. Deciding which row is the
 * header, which columns matter and what they mean is the converter's job
 * (foi-normalise.ts), where it is reviewed and golden-master tested.
 *
 * The reader is hand-rolled on Node built-ins (xlsx is zip + XML;
 * zlib.inflateRawSync does the decompression) so the extraction step is
 * fully owned by the repo, dependency-free, and re-derivable in CI - the
 * test suite reproduces every committed extract from the archived workbook
 * bytes. It reads exactly the SpreadsheetML subset these exports use and
 * throws on anything else (formulas, booleans, floats, rich-text phonetics,
 * 1904-epoch workbooks, ZIP64): a new construct deserves review, never a
 * silent guess. Byte-for-byte equivalence with the openpyxl-produced
 * extracts this replaced is pinned by the golden tests.
 *
 * Determinism and fidelity rules (unchanged from the original extractor):
 *  - Output is UTF-8 without BOM, LF endings, minimal RFC-4180 quoting.
 *  - Cells render by stored type, verbatim: strings untouched (no trimming
 *    - hygiene is counted later, in the converter); integers as plain
 *    digits; date-formatted serials as ISO (date-only at midnight),
 *    including source artefacts like the 2015 exports' '20JUN' cells that
 *    were mangled into dates at Ofcom's export.
 *  - Trailing all-empty rows and columns are Excel dimension noise and are
 *    dropped; leading and interior blanks are structure and are kept.
 *  - Empty sheets are skipped, loudly; sheet numbering keeps the workbook
 *    position so a skipped Sheet2 leaves sheet-1/sheet-3 names honest.
 *
 * Run as a CLI to (re-)extract an entry's workbooks:
 *   node src/shared/xlsx-extract.ts archive/foi/<entry-key> [...]
 * Writes the per-sheet raw-extract CSVs alongside each workbook and prints
 * bytes/sha256 for meta.json's files map.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { createHash } from 'crypto';

// --- Zip container -----------------------------------------------------

interface ZipEntry {
  method: number;
  compressedStart: number;
  compressedSize: number;
  crc32: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

// --- Resource caps (issue #969) ----------------------------------------
// This reader parses UNTRUSTED archived workbooks (a .xlsx is a zip of XML),
// so every otherwise-unbounded step carries an explicit ceiling: a hostile
// archive can be a decompression bomb, a billion-entry grid, or a sharedStrings
// table sized to exhaust memory before a single row is read. Each default sits
// FAR above the largest legitimate archived export (as of 2026 the biggest is
// ~38 MB inflated in total, ~35 MB in its largest part, ~158k shared strings,
// ~840k cells and ~158k rows), so a genuine workbook never trips one while a
// bomb or hostile grid is refused loudly, naming the file/part it tripped on.
// The limits are a parameter (not baked-in constants) so each ceiling is
// exercised by a small synthetic fixture in the tests rather than needing a
// multi-hundred-megabyte one.
export interface XlsxLimits {
  maxPartInflatedBytes: number;   // per zip part
  maxTotalInflatedBytes: number;  // summed across the workbook
  maxSharedStrings: number;       // shared-string table entries
  maxCells: number;               // populated cells across all sheets
  maxRowIndex: number;            // largest 1-based row reference
  maxColumnIndex: number;         // largest 1-based column reference
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  maxPartInflatedBytes: 256 * 1024 * 1024,  // ~7x the largest legit part
  maxTotalInflatedBytes: 512 * 1024 * 1024, // ~13x the largest legit total
  maxSharedStrings: 5_000_000,              // ~30x the largest legit table
  maxCells: 20_000_000,                     // ~24x the largest legit sheet's cell count
  maxRowIndex: 1_048_576,                   // Excel's own worksheet row limit
  maxColumnIndex: 16_384,                   // Excel's own worksheet column limit (column XFD)
};

// Tracks the running inflated-byte total for one workbook so the whole-archive
// ceiling is enforced across parts, not just per part.
interface InflateBudget {
  totalInflated: number;
}

// A .xlsx is trusted to be a plain SpreadsheetML zip; it has no legitimate need
// of a document type definition or entity declarations. Refusing them outright
// keeps the door closed on XXE and billion-laughs entity expansion regardless
// of what the entity decoder does downstream (defence in depth).
function assertNoDoctypeOrEntity(xml: string, partName: string): void {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error(`${partName}: XML declares a DOCTYPE or ENTITY - refused (XXE / entity-expansion guard)`);
  }
}

// Reads the central directory into a name -> entry map. ZIP64 markers throw:
// these workbooks are all far below the 4 GiB thresholds.
function readZipDirectory(bytes: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip: end-of-central-directory signature not found');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archive - extend the reader (with review) if a workbook genuinely needs it');
  }

  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`central directory entry ${i + 1} has a bad signature`);
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`ZIP64 entry "${name}" - extend the reader (with review)`);
    }
    // The local header's own name/extra lengths govern where data starts.
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`local header for "${name}" has a bad signature`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    entries.set(name, {
      method,
      compressedStart: localOffset + 30 + localNameLength + localExtraLength,
      compressedSize,
      crc32: crc,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipFile(bytes: Buffer, entries: Map<string, ZipEntry>, name: string, budget: InflateBudget, limits: XlsxLimits): Buffer {
  const entry = entries.get(name);
  if (entry === undefined) {
    throw new Error(`workbook part missing: ${name} (parts present: ${[...entries.keys()].join(', ')})`);
  }
  const raw = bytes.subarray(entry.compressedStart, entry.compressedStart + entry.compressedSize);
  let data: Buffer;
  if (entry.method === 0) {
    // A stored (uncompressed) part cannot be a decompression bomb, but a
    // hostile archive could still declare a giant stored member; bound it too.
    if (raw.length > limits.maxPartInflatedBytes) {
      throw new Error(`${name}: stored part is ${raw.length} bytes, over the ${limits.maxPartInflatedBytes}-byte per-part cap`);
    }
    data = Buffer.from(raw);
  } else if (entry.method === 8) {
    // maxOutputLength stops inflation the moment it would exceed the per-part
    // cap, so a decompression bomb is refused BEFORE it is materialised in
    // memory rather than after (which would already have OOM'd the run).
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: limits.maxPartInflatedBytes });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new Error(`${name}: inflated part exceeds the ${limits.maxPartInflatedBytes}-byte per-part cap (possible decompression bomb)`);
      }
      throw err;
    }
  } else {
    throw new Error(`${name}: unsupported zip compression method ${entry.method}`);
  }
  budget.totalInflated += data.length;
  if (budget.totalInflated > limits.maxTotalInflatedBytes) {
    throw new Error(`${name}: workbook inflated total exceeds the ${limits.maxTotalInflatedBytes}-byte cap (possible decompression bomb)`);
  }
  const actualCrc = zlib.crc32(data);
  if (actualCrc !== entry.crc32) {
    throw new Error(`${name}: crc32 mismatch (archive corruption?)`);
  }
  return data;
}

// --- Minimal SpreadsheetML parsing --------------------------------------

function decodeXmlText(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (body in named) return named[body];
    throw new Error(`unrecognised XML entity ${whole}`);
  });
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) {
    attributes.set(match[1], decodeXmlText(match[2]));
  }
  return attributes;
}

// Concatenates the <t> runs of a shared-string or inline-string item.
function textOf(itemXml: string, context: string): string {
  if (itemXml.includes('<rPh')) {
    throw new Error(`${context}: phonetic-run rich text encountered - extend the reader (with review)`);
  }
  let text = '';
  for (const match of itemXml.matchAll(/<t(?: [^>]*)?\/>|<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)) {
    text += decodeXmlText(match[1] ?? '');
  }
  return text;
}

// Built-in date/time number formats, plus locale variants (as openpyxl).
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
]);

// A custom format is a date format when, after removing quoted literals,
// bracketed sections and escaped characters, date/time tokens remain.
export function isDateFormatCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmhys]/i.test(stripped);
}

// Excel serial -> ISO, Windows (1900) epoch. Serials below 61 predate the
// Lotus leap-year bug window (Feb 1900) and cannot occur in this archive -
// refuse rather than guess.
export function excelSerialToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial < 61) {
    throw new Error(`date serial ${serial} out of supported range`);
  }
  const days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86400);
  let dayMs = Date.UTC(1899, 11, 30) + days * 86400000;
  if (seconds === 86400) {
    dayMs += 86400000;
    seconds = 0;
  }
  const date = new Date(dayMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const isoDate = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (seconds === 0) return isoDate;
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return `${isoDate} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function columnIndexOf(cellRef: string, context: string): number {
  const match = /^([A-Z]+)\d+$/.exec(cellRef);
  if (match === null) throw new Error(`${context}: unparseable cell reference "${cellRef}"`);
  let index = 0;
  for (const letter of match[1]) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index;
}

export interface ExtractedSheet {
  position: number;
  title: string;
  // null when the sheet has no content (skipped, loudly, by callers).
  rows: string[][] | null;
}

export function extractWorkbook(bytes: Buffer, limits: XlsxLimits = DEFAULT_XLSX_LIMITS): ExtractedSheet[] {
  const zipEntries = readZipDirectory(bytes);
  const budget: InflateBudget = { totalInflated: 0 };
  const readPart = (name: string): string => {
    const xml = readZipFile(bytes, zipEntries, name, budget, limits).toString('utf8');
    assertNoDoctypeOrEntity(xml, name);
    return xml;
  };
  let totalCells = 0;

  const workbookXml = readPart('xl/workbook.xml');
  if (/<workbookPr[^>]*date1904="(?:1|true)"/.test(workbookXml)) {
    throw new Error('1904-epoch workbook - extend the reader (with review)');
  }

  // Sheet order comes from workbook.xml; targets from its relationships.
  const relationships = new Map<string, { target: string; type: string }>();
  for (const match of readPart('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*\/>/g)) {
    const attributes = attributesOf(match[0]);
    const id = attributes.get('Id');
    const target = attributes.get('Target');
    const type = attributes.get('Type');
    if (id === undefined || target === undefined || type === undefined) {
      throw new Error('workbook relationship missing Id/Target/Type');
    }
    relationships.set(id, { target, type });
  }

  const sharedStrings: string[] = [];
  if (zipEntries.has('xl/sharedStrings.xml')) {
    for (const match of readPart('xl/sharedStrings.xml').matchAll(/<si\/>|<si[ >][\s\S]*?<\/si>/g)) {
      sharedStrings.push(textOf(match[0], 'xl/sharedStrings.xml'));
      if (sharedStrings.length > limits.maxSharedStrings) {
        throw new Error(`xl/sharedStrings.xml: shared-string table exceeds the ${limits.maxSharedStrings}-entry cap`);
      }
    }
  }

  // Cell style index -> is-date-format, via cellXfs and any custom numFmts.
  const customFormats = new Map<number, string>();
  let dateStyles = new Set<number>();
  if (zipEntries.has('xl/styles.xml')) {
    const stylesXml = readPart('xl/styles.xml');
    for (const match of stylesXml.matchAll(/<numFmt [^>]*\/>/g)) {
      const attributes = attributesOf(match[0]);
      customFormats.set(Number(attributes.get('numFmtId')), attributes.get('formatCode') ?? '');
    }
    const cellXfsMatch = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (cellXfsMatch !== null) {
      const formatIds = [...cellXfsMatch[1].matchAll(/<xf [^>]*?\/?>/g)]
        .map(m => Number(attributesOf(m[0]).get('numFmtId') ?? '0'));
      dateStyles = new Set(formatIds
        .map((formatId, styleIndex) => ({ formatId, styleIndex }))
        .filter(({ formatId }) => BUILTIN_DATE_FORMAT_IDS.has(formatId) ||
          (customFormats.has(formatId) && isDateFormatCode(customFormats.get(formatId) ?? '')))
        .map(({ styleIndex }) => styleIndex));
    }
  }

  const renderCell = (cellXml: string, sheetTitle: string): string => {
    const tagEnd = cellXml.indexOf('>');
    const attributes = attributesOf(cellXml.slice(0, tagEnd + 1));
    const cellRef = attributes.get('r') ?? '?';
    const context = `sheet ${JSON.stringify(sheetTitle)} cell ${cellRef}`;
    const type = attributes.get('t') ?? 'n';
    if (type === 'e') {
      // A cached spreadsheet formula-error literal (e.g. #REF! from a broken
      // CONCATENATE): a defect the publisher shipped, carried verbatim so it is
      // neither silently parsed as data nor dropped. Downstream the callsign
      // parser flags it `spreadsheet-error-token` (SPREADSHEET_ERROR_TOKENS in
      // src/sources/ofcom-amateur/components.ts; issues #335/#399). The <v>
      // holds the cached token; an error cell lacking one is a genuinely new
      // construct that must surface for review, not be guessed.
      const cachedError = /<v(?: [^>]*)?>([\s\S]*?)<\/v>/.exec(cellXml);
      if (cachedError === null) {
        throw new Error(`${context}: error cell with no cached value - extend the reader (with review)`);
      }
      return decodeXmlText(cachedError[1]);
    }
    if (cellXml.includes('<f')) {
      throw new Error(`${context}: formula cell - extend the reader (with review)`);
    }
    if (type === 'inlineStr') {
      return textOf(cellXml, context);
    }
    const valueMatch = /<v(?: [^>]*)?>([\s\S]*?)<\/v>/.exec(cellXml);
    if (valueMatch === null) return '';
    const value = decodeXmlText(valueMatch[1]);
    if (type === 's') {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
        throw new Error(`${context}: shared string index ${value} out of range`);
      }
      return sharedStrings[index];
    }
    if (type !== 'n') {
      throw new Error(`${context}: unsupported cell type "${type}" - extend the reader (with review)`);
    }
    const styleIndex = Number(attributes.get('s') ?? '0');
    if (dateStyles.has(styleIndex)) {
      return excelSerialToIso(Number(value));
    }
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`${context}: non-integer number "${value}" - extend the rendering rules (with review)`);
    }
    return value;
  };

  const sheetTags = [...workbookXml.matchAll(/<sheet [^>]*\/>/g)];
  if (sheetTags.length === 0) throw new Error('workbook declares no sheets');

  return sheetTags.map((sheetTag, index) => {
    const attributes = attributesOf(sheetTag[0]);
    const title = attributes.get('name');
    const relationshipId = attributes.get('r:id');
    if (title === undefined || relationshipId === undefined) {
      throw new Error(`workbook sheet ${index + 1} missing name or r:id`);
    }
    const relationship = relationships.get(relationshipId);
    if (relationship === undefined || !relationship.type.endsWith('/worksheet')) {
      throw new Error(`sheet ${JSON.stringify(title)}: relationship is not a worksheet - extend the reader (with review)`);
    }
    const target = relationship.target.replace(/^\//, '');
    const sheetXml = readPart(target.startsWith('xl/') ? target : `xl/${target}`);

    // Sparse grid keyed by 1-based row/column from each cell's reference.
    const grid = new Map<number, Map<number, string>>();
    let maxRow = 0;
    let maxColumn = 0;
    for (const rowMatch of sheetXml.matchAll(/<row[^>]*\/>|<row[^>]*>[\s\S]*?<\/row>/g)) {
      for (const cellMatch of rowMatch[0].matchAll(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g)) {
        const cellRef = attributesOf(cellMatch[0].slice(0, cellMatch[0].indexOf('>') + 1)).get('r');
        if (cellRef === undefined) {
          throw new Error(`sheet ${JSON.stringify(title)}: cell without a reference - extend the reader (with review)`);
        }
        const rowIndex = Number(/\d+$/.exec(cellRef)?.[0]);
        const columnIndex = columnIndexOf(cellRef, `sheet ${JSON.stringify(title)}`);
        // Bound the declared grid coordinates: the dense `rows` array below is
        // sized from maxRow/maxColumn, so an out-of-range cell reference (a
        // hostile r="99999999") would otherwise drive an unbounded allocation.
        if (rowIndex > limits.maxRowIndex) {
          throw new Error(`sheet ${JSON.stringify(title)} cell ${cellRef}: row index ${rowIndex} exceeds the ${limits.maxRowIndex}-row cap`);
        }
        if (columnIndex > limits.maxColumnIndex) {
          throw new Error(`sheet ${JSON.stringify(title)} cell ${cellRef}: column index ${columnIndex} exceeds the ${limits.maxColumnIndex}-column cap`);
        }
        totalCells += 1;
        if (totalCells > limits.maxCells) {
          throw new Error(`workbook cell count exceeds the ${limits.maxCells}-cell cap`);
        }
        const rendered = renderCell(cellMatch[0], title);
        maxRow = Math.max(maxRow, rowIndex);
        maxColumn = Math.max(maxColumn, columnIndex);
        let row = grid.get(rowIndex);
        if (row === undefined) grid.set(rowIndex, row = new Map<number, string>());
        row.set(columnIndex, rendered);
      }
    }

    const rows: string[][] = [];
    for (let r = 1; r <= maxRow; r++) {
      const row = grid.get(r);
      rows.push(Array.from({ length: maxColumn }, (_, c) => row?.get(c + 1) ?? ''));
    }
    // Drop trailing all-empty rows, then trailing all-empty columns (Excel
    // dimension noise); leading/interior blanks are structure and stay.
    while (rows.length > 0 && rows[rows.length - 1].every(cell => cell === '')) {
      rows.pop();
    }
    const width = rows.reduce((max, row) => {
      const last = row.reduce((w, cell, i) => (cell === '' ? w : i + 1), 0);
      return Math.max(max, last);
    }, 0);
    if (rows.length === 0 || width === 0) {
      return { position: index + 1, title, rows: null };
    }
    return { position: index + 1, title, rows: rows.map(row => row.slice(0, width)) };
  });
}

// --- CSV rendering (matches the committed extracts' framing exactly) ----

function renderCsvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function toCsvBytes(rows: string[][]): Buffer {
  const lines = rows.map(row =>
    // A lone empty field is quoted so the line round-trips as one empty
    // cell rather than reading back as a blank line.
    row.length === 1 && row[0] === '' ? '""' : row.map(renderCsvField).join(','));
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

export function slugifySheetTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function extractFileNameFor(sheet: ExtractedSheet): string {
  return `raw-extract-sheet-${sheet.position}-${slugifySheetTitle(sheet.title)}.csv`;
}

// --- CLI -----------------------------------------------------------------

function main(): void {
  const entryDirs = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (entryDirs.length === 0) {
    console.error('usage: node src/shared/xlsx-extract.ts <entry-dir> [...]');
    process.exitCode = 1;
    return;
  }
  for (const entryDir of entryDirs) {
    const workbooks = fs.readdirSync(entryDir).filter(f => f.endsWith('.xlsx')).sort();
    if (workbooks.length === 0) {
      throw new Error(`${entryDir}: no .xlsx files found`);
    }
    for (const workbook of workbooks) {
      console.log(`\n=== ${path.join(entryDir, workbook)}`);
      const sheets = extractWorkbook(fs.readFileSync(path.join(entryDir, workbook)));
      for (const sheet of sheets) {
        if (sheet.rows === null) {
          console.log(`  sheet ${sheet.position} (${JSON.stringify(sheet.title)}): empty - skipped`);
          continue;
        }
        const payload = toCsvBytes(sheet.rows);
        const outName = extractFileNameFor(sheet);
        fs.writeFileSync(path.join(entryDir, outName), payload);
        console.log(`  ${outName}`);
        console.log(`    rows: ${sheet.rows.length}, bytes: ${payload.length}, sha256: ${createHash('sha256').update(payload).digest('hex')}`);
      }
    }
  }
}

if (import.meta.main) {
  main();
}
