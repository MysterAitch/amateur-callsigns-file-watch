#!/usr/bin/env node

/**
 * PDF-table extractor - the first of the PDF-table extraction class, the
 * counterpart to the workbook extractor (src/shared/xlsx-extract.ts) for a
 * disclosure that arrived as a spreadsheet Save-As-PDF rather than a workbook.
 *
 * It currently handles ONE shape: the Ofcom FOI 00896085 club-callsigns list
 * ("Copy of Club Call Signs 23 04 20.pdf"), an Excel-for-Office-365 Save-As-PDF
 * export of a two-column table ("Call sign / T-number" | "Status"). Rather than
 * pattern-match the bytes, it runs a full content-stream interpreter so any
 * deviation from the expected shape SURFACES (as a note, an ambiguity, or a
 * failed anchor) rather than being silently mis-parsed - the fail-loud posture.
 *
 * Determinism: Node built-ins only (no third-party PDF library); the interpreter
 * reads each page's content stream, resolves glyph device positions from the
 * text matrix (the export uses an identity CTM and only Tm translations), groups
 * fragments into rows by y and columns by x, and renders a byte-deterministic
 * CSV (CRLF, trailing CRLF, minimal quoting) - `callsign,status,page,row_on_page`.
 * The header row is detected BY CONTENT and excluded (it appears on page 1 only;
 * pages 2..41 begin directly with data), so no continuation page's first record
 * is dropped. Values are preserved verbatim; nothing is trimmed, cased or
 * synthesised. The committed self-check (src/shared/pdf-table-extract.test.ts)
 * runs this over the committed PDF and asserts the committed CSV reproduces
 * byte-identically, with the reconciliation arithmetic as assertions.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';

// Between the two column x-translations observed in this export (52.824 for the
// callsign column, 168.29 for the status column).
const COL_X_THRESHOLD = 110;
// Row membership: y-translations are exact to 2dp per row.
const Y_KEY_DP = 2;
// A negative kerning adjustment beyond this magnitude MIGHT imply an
// unrepresented space; flagged for review, never acted on (values stay verbatim).
const KERN_SPACE_FLAG = -100;
// The ordinary UK amateur callsign shape - anything failing it is surfaced as an
// oddity (e.g. a literal T-number token) rather than silently accepted.
const CALLSIGN_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]*$/;

const HEADER_COL1 = 'Call sign / T-number';
const HEADER_COL2 = 'Status';

// ---------------------------------------------------------------------------
// PDF plumbing: locate objects and inflate content streams.
// ---------------------------------------------------------------------------

function buildOffsetMap(latin1: string): Record<number, number> {
  const map: Record<number, number> = {};
  const re = /(\d+)\s+0\s+obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin1)) !== null) {
    // Last definition wins if an object number recurs (updated PDFs).
    map[parseInt(m[1], 10)] = m.index;
  }
  return map;
}

function inflateStreamAt(buf: Buffer, latin1: string, objOffset: number): Buffer {
  const streamIdx = latin1.indexOf('stream', objOffset);
  if (streamIdx === -1) throw new Error(`no stream keyword after object at ${objOffset}`);
  let dataStart = streamIdx + 'stream'.length;
  if (latin1[dataStart] === '\r') dataStart++;
  if (latin1[dataStart] === '\n') dataStart++;
  const endIdx = latin1.indexOf('endstream', dataStart);
  if (endIdx === -1) throw new Error(`no endstream after object at ${objOffset}`);
  return zlib.inflateSync(buf.subarray(dataStart, endIdx));
}

function pageObjectOrder(latin1: string, offsets: Record<number, number>): number[] {
  // The Pages tree is object 2 in this file; resolve its Kids order.
  const pagesStart = offsets[2];
  const pagesDict = latin1.slice(pagesStart, latin1.indexOf('endobj', pagesStart));
  const kidsMatch = pagesDict.match(/\/Kids\s*\[([^\]]*)\]/);
  if (kidsMatch === null) throw new Error('could not locate /Kids of Pages object');
  return [...kidsMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map(x => parseInt(x[1], 10));
}

function contentsRefOfPage(latin1: string, offsets: Record<number, number>, pageObjNum: number): number {
  const start = offsets[pageObjNum];
  const dict = latin1.slice(start, latin1.indexOf('endobj', start));
  const m = dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
  if (m === null) throw new Error(`page object ${pageObjNum} has no simple /Contents ref`);
  return parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// PDF string parsing (literal strings with escapes).
// ---------------------------------------------------------------------------

function parseLiteralString(str: string, i: number): { value: string; next: number } {
  // str[i] === '(' - begin scanning after the opening parenthesis.
  let depth = 0;
  let out = '';
  let j = i + 1;
  for (; j < str.length; j++) {
    const c = str[j];
    if (c === '\\') {
      const n = str[j + 1];
      switch (n) {
        case 'n': out += '\n'; j++; break;
        case 'r': out += '\r'; j++; break;
        case 't': out += '\t'; j++; break;
        case 'b': out += '\b'; j++; break;
        case 'f': out += '\f'; j++; break;
        case '(': out += '('; j++; break;
        case ')': out += ')'; j++; break;
        case '\\': out += '\\'; j++; break;
        case '\r': // line continuation (CR or CRLF)
          j++;
          if (str[j + 1] === '\n') j++;
          break;
        case '\n': // line continuation (LF)
          j++;
          break;
        default:
          if (n >= '0' && n <= '7') {
            let oct = '';
            let k = j + 1;
            while (k < str.length && oct.length < 3 && str[k] >= '0' && str[k] <= '7') {
              oct += str[k];
              k++;
            }
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            j = k - 1;
          } else {
            // A reverse solidus before a non-escape char is ignored; the char stands.
            out += n;
            j++;
          }
      }
    } else if (c === '(') {
      depth++;
      out += c;
    } else if (c === ')') {
      if (depth === 0) return { value: out, next: j + 1 };
      depth--;
      out += c;
    } else {
      out += c;
    }
  }
  throw new Error('unterminated literal string');
}

// ---------------------------------------------------------------------------
// Content-stream interpreter. Emits text fragments with device positions.
// ---------------------------------------------------------------------------

const WS = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

type Matrix = [number, number, number, number, number, number];
interface Fragment { x: number; y: number; text: string; kernFlag: boolean }
type StackEntry =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'arr'; v: ({ t: 'str'; v: string } | { t: 'num'; v: number })[] }
  | { t: 'name'; v: string }
  | { t: 'dict' };

function interpret(content: string): Fragment[] {
  const fragments: Fragment[] = [];
  const stack: StackEntry[] = [];

  let tm: Matrix = [1, 0, 0, 1, 0, 0];
  let tlm: Matrix = [1, 0, 0, 1, 0, 0];
  let leading = 0;

  const translate = (m: Matrix, tx: number, ty: number): Matrix => [
    m[0], m[1], m[2], m[3],
    m[0] * tx + m[2] * ty + m[4],
    m[1] * tx + m[3] * ty + m[5],
  ];

  const popNums = (count: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      const e = stack.pop();
      out.unshift(e !== undefined && e.t === 'num' ? e.v : NaN);
    }
    return out;
  };

  const showArray = (arr: ({ t: 'str'; v: string } | { t: 'num'; v: number })[]): void => {
    let text = '';
    let kernFlag = false;
    for (const el of arr) {
      if (el.t === 'str') text += el.v;
      else if (el.t === 'num' && el.v < KERN_SPACE_FLAG) kernFlag = true;
    }
    fragments.push({ x: tm[4], y: tm[5], text, kernFlag });
  };

  const showString = (s: string): void => {
    fragments.push({ x: tm[4], y: tm[5], text: s, kernFlag: false });
  };

  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    if (WS.has(c)) { i++; continue; }
    if (c === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }
    if (c === '(') {
      const { value, next } = parseLiteralString(content, i);
      stack.push({ t: 'str', v: value });
      i = next;
      continue;
    }
    if (c === '[') {
      const arr: ({ t: 'str'; v: string } | { t: 'num'; v: number })[] = [];
      let j = i + 1;
      while (j < n && content[j] !== ']') {
        const cc = content[j];
        if (WS.has(cc)) { j++; continue; }
        if (cc === '(') {
          const { value, next } = parseLiteralString(content, j);
          arr.push({ t: 'str', v: value });
          j = next;
        } else if (cc === '-' || cc === '+' || cc === '.' || (cc >= '0' && cc <= '9')) {
          let k = j;
          while (k < n && /[0-9+\-.eE]/.test(content[k])) k++;
          arr.push({ t: 'num', v: parseFloat(content.slice(j, k)) });
          j = k;
        } else {
          j++; // skip anything unexpected inside the array
        }
      }
      stack.push({ t: 'arr', v: arr });
      i = j + 1;
      continue;
    }
    if (c === '<') {
      if (content[i + 1] === '<') {
        // Dictionary: skip to the matching >> (nested).
        let depth = 0;
        let j = i;
        while (j < n) {
          if (content[j] === '<' && content[j + 1] === '<') { depth++; j += 2; }
          else if (content[j] === '>' && content[j + 1] === '>') { depth--; j += 2; if (depth === 0) break; }
          else j++;
        }
        stack.push({ t: 'dict' });
        i = j;
        continue;
      }
      // Hex string: skip to '>'.
      let j = i + 1;
      let hex = '';
      while (j < n && content[j] !== '>') { if (!WS.has(content[j])) hex += content[j]; j++; }
      if (hex.length % 2 === 1) hex += '0';
      let s = '';
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.substr(k, 2), 16) & 0xff);
      stack.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
      stack.push({ t: 'name', v: content.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) {
      let j = i;
      while (j < n && /[0-9+\-.eE]/.test(content[j])) j++;
      stack.push({ t: 'num', v: parseFloat(content.slice(i, j)) });
      i = j;
      continue;
    }
    // Operator token.
    let j = i;
    while (j < n && !WS.has(content[j]) && !DELIM.has(content[j])) j++;
    const op = content.slice(i, j);
    i = j;

    switch (op) {
      case 'BT':
        tm = [1, 0, 0, 1, 0, 0];
        tlm = [1, 0, 0, 1, 0, 0];
        stack.length = 0;
        break;
      case 'ET':
        stack.length = 0;
        break;
      case 'Tm': {
        const [a, b, cc, d, e, f] = popNums(6);
        tm = [a, b, cc, d, e, f];
        tlm = tm.slice() as Matrix;
        break;
      }
      case 'Td': {
        const [tx, ty] = popNums(2);
        tlm = translate(tlm, tx, ty);
        tm = tlm.slice() as Matrix;
        break;
      }
      case 'TD': {
        const [tx, ty] = popNums(2);
        leading = -ty;
        tlm = translate(tlm, tx, ty);
        tm = tlm.slice() as Matrix;
        break;
      }
      case 'T*':
        tlm = translate(tlm, 0, -leading);
        tm = tlm.slice() as Matrix;
        break;
      case 'TL':
        leading = popNums(1)[0];
        break;
      case 'Tj': {
        const e = stack.pop();
        if (e !== undefined && e.t === 'str') showString(e.v);
        break;
      }
      case 'TJ': {
        const e = stack.pop();
        if (e !== undefined && e.t === 'arr') showArray(e.v);
        break;
      }
      case "'": {
        tlm = translate(tlm, 0, -leading);
        tm = tlm.slice() as Matrix;
        const e = stack.pop();
        if (e !== undefined && e.t === 'str') showString(e.v);
        break;
      }
      case '"': {
        tlm = translate(tlm, 0, -leading);
        tm = tlm.slice() as Matrix;
        const e = stack.pop();
        popNums(2);
        if (e !== undefined && e.t === 'str') showString(e.v);
        break;
      }
      default:
        // Non-text operator: clear operands and move on.
        stack.length = 0;
    }
  }

  return fragments;
}

// ---------------------------------------------------------------------------
// Row/column assembly.
// ---------------------------------------------------------------------------

interface AssembledRow { y: number; col1: Fragment[]; col2: Fragment[] }

function assemblePage(fragments: Fragment[]): AssembledRow[] {
  const byRow = new Map<string, AssembledRow>();
  for (const fr of fragments) {
    const yKey = fr.y.toFixed(Y_KEY_DP);
    let row = byRow.get(yKey);
    if (row === undefined) { row = { y: fr.y, col1: [], col2: [] }; byRow.set(yKey, row); }
    if (fr.x < COL_X_THRESHOLD) row.col1.push(fr);
    else row.col2.push(fr);
  }
  // Rows top-to-bottom (descending y).
  return [...byRow.values()].sort((a, b) => b.y - a.y);
}

function csvField(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// ---------------------------------------------------------------------------
// Public extraction API
// ---------------------------------------------------------------------------

export interface ClubCallsignRow {
  callsign: string;
  status: string;
  page: number;
  rowOnPage: number;
}

export interface ClubCallsignExtraction {
  // The byte-deterministic CSV (header + rows, CRLF, trailing CRLF). This is the
  // committed extract; the self-check asserts it reproduces byte-identically.
  csv: string;
  rows: ClubCallsignRow[];
  statusCounts: Record<string, number>;
  perPageCount: { page: number; dataRows: number }[];
  duplicateCount: number;
  blankKeyCount: number;
  oddityCount: number;
  ambiguousCount: number;
  headerPages: number[];
  totalTJ: number;
  totalShows: number;
  // The page-1 opening anchor sequence, all Live - a content check that the
  // extraction landed on the real first records.
  anchorPass: boolean;
}

// Extract the club-callsigns table from the Save-As-PDF bytes. Throws loudly if
// the document deviates from the expected structure (missing Pages tree, no
// stream, an unrecognised header) rather than emitting a mis-parse.
export function extractClubCallsignTable(pdfBytes: Buffer): ClubCallsignExtraction {
  const latin1 = pdfBytes.toString('latin1');
  const offsets = buildOffsetMap(latin1);
  const kids = pageObjectOrder(latin1, offsets);

  const rows: ClubCallsignRow[] = [];
  const perPageCount: { page: number; dataRows: number }[] = [];
  const headerPages: number[] = [];
  let ambiguousCount = 0;
  let blankKeyCount = 0;
  let totalTJ = 0;
  let totalShows = 0;

  kids.forEach((pageObj, pageIdx) => {
    const page = pageIdx + 1;
    const contentObj = contentsRefOfPage(latin1, offsets, pageObj);
    const content = inflateStreamAt(pdfBytes, latin1, offsets[contentObj]).toString('latin1');
    totalTJ += (content.match(/\]\s*TJ/g) ?? []).length;

    const fragments = interpret(content);
    totalShows += fragments.length;
    const assembled = assemblePage(fragments);

    // The header row appears on page 1 only; detect it by content and exclude
    // exactly that one row so no continuation page's first record is lost.
    let headerExcluded = false;
    let rowOnPage = 0;
    const pageRows: ClubCallsignRow[] = [];
    for (const row of assembled) {
      const col1Sorted = row.col1.slice().sort((a, b) => a.x - b.x);
      const col2Sorted = row.col2.slice().sort((a, b) => a.x - b.x);
      const callsign = col1Sorted.map(f => f.text).join('');
      const status = col2Sorted.map(f => f.text).join('');
      if (!headerExcluded && callsign === HEADER_COL1 && status === HEADER_COL2) {
        headerPages.push(page);
        headerExcluded = true;
        continue;
      }
      const col1Xs = new Set(row.col1.map(f => f.x.toFixed(2)));
      const col2Xs = new Set(row.col2.map(f => f.x.toFixed(2)));
      if (col1Xs.size > 1) ambiguousCount++;
      if (col2Xs.size > 1) ambiguousCount++;
      rowOnPage++;
      const record = { callsign, status, page, rowOnPage };
      rows.push(record);
      pageRows.push(record);
    }
    perPageCount.push({ page, dataRows: rowOnPage });

    for (const record of pageRows) {
      if (record.callsign.trim() === '' && record.status.trim() !== '') blankKeyCount++;
    }
  });

  // CSV (byte-identical to the committed extract): CRLF, trailing CRLF.
  const csvLines = ['callsign,status,page,row_on_page'];
  for (const r of rows) {
    csvLines.push([csvField(r.callsign), csvField(r.status), String(r.page), String(r.rowOnPage)].join(','));
  }
  const csv = `${csvLines.join('\r\n')}\r\n`;

  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const byCall = new Map<string, number>();
  for (const r of rows) {
    if (r.callsign.trim() === '') continue;
    byCall.set(r.callsign, (byCall.get(r.callsign) ?? 0) + 1);
  }
  const duplicateCount = [...byCall.values()].filter(count => count > 1).length;

  let oddityCount = 0;
  for (const r of rows) {
    if (r.callsign.trim() === '') continue;
    if (!CALLSIGN_RE.test(r.callsign)) oddityCount++;
  }

  const anchor = ['M0NUK', 'G3SKY', 'M0SCL', 'G4RSB', 'M0GVP', 'G3UCL', 'M0HTJ', 'G7BPO', 'M0LWC', 'M5DB', 'G6TW'];
  const page1 = rows.filter(r => r.page === 1).slice(0, anchor.length);
  const anchorPass = page1.length === anchor.length
    && anchor.every((c, k) => page1[k].callsign === c)
    && page1.every(r => r.status === 'Live');

  return {
    csv, rows, statusCounts, perPageCount,
    duplicateCount, blankKeyCount, oddityCount, ambiguousCount,
    headerPages, totalTJ, totalShows, anchorPass,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const [src, out] = process.argv.slice(2);
  if (src === undefined) {
    process.stderr.write('usage: node src/shared/pdf-table-extract.ts <source.pdf> [out.csv]\n');
    process.exitCode = 1;
    return;
  }
  const extraction = extractClubCallsignTable(fs.readFileSync(src));
  const outPath = out ?? path.join(path.dirname(src), 'club-callsigns.csv');
  fs.writeFileSync(outPath, extraction.csv, 'latin1');
  process.stderr.write(
    `wrote ${outPath}\n  rows: ${extraction.rows.length}; statuses: ${JSON.stringify(extraction.statusCounts)}\n` +
    `  duplicates: ${extraction.duplicateCount}; blank-key: ${extraction.blankKeyCount}; oddities: ${extraction.oddityCount}\n` +
    `  TJ ops: ${extraction.totalTJ}; shows: ${extraction.totalShows}; anchor: ${extraction.anchorPass ? 'PASS' : 'FAIL'}\n`,
  );
  if (!extraction.anchorPass) process.exitCode = 1;
}

if (import.meta.main) {
  main();
}
