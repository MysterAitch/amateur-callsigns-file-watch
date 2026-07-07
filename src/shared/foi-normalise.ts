/**
 * FOI-lane normalisers (issue #139, tiers 1-2): deterministic converters for
 * the CSV-native FOI entries and for tables transcribed into committed
 * raw-extract-*.md files, per ADR 0004's derivation chain
 * (raw data file [-> raw-extract-*.md] -> normalised--<slug>.csv, converter
 * binding authored in the entry's meta.json).
 *
 * Principles (issue #139):
 *  - Normalise the source's ASSERTION only, never an inferred complement.
 *    Every output row is an observation: this source, at this vintage,
 *    asserts this callsign has this status. Blank statuses are data and are
 *    preserved as empty strings.
 *  - Canonicalise nothing except trimming leading/trailing whitespace
 *    (including non-breaking spaces), and even that is counted in the
 *    converter's notes rather than applied silently. Case is never changed:
 *    the sources are not uniformly uppercase (g0jrk, 2e1GTD exist) and a
 *    case change would invent an assertion the source did not make.
 *  - Columns are identified by header NAME, never by position - a source
 *    column reorder cannot silently change what a column means or what the
 *    sort key is (the sort-key vulnerability fix).
 *  - Outputs are byte-deterministic: LF endings, UTF-8 without BOM, minimal
 *    RFC-4180 quoting (shared renderCsv), codepoint sorting only where the
 *    source row order is not meaningful.
 *
 * Run as a CLI to regenerate an entry's normalised files:
 *   node src/shared/foi-normalise.ts archive/foi/<entry-key> [...]
 * The entry's meta.json must carry the authored converter binding
 * ({script, variant}); the CLI writes the normalised--*.csv files and prints
 * the notes (trim/NBSP counts, blank counts, day-first date evidence) plus
 * the bytes/sha256 to record in meta.json's files map.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { parseUkDateTimeDetailed, type ParsedUkDateTime, renderCsv, codepointCompare } from './normalise.ts';
import { calculateContentHash, errorMessage } from './utils.ts';

export const FOI_NORMALISED_SCHEMA_VERSION = 1;

// Plausibility floor shared with the open-data lane: UK wireless licensing
// began in the early 1900s (the 2019 register genuinely opens at
// 03/05/1903, a presumed migration placeholder but on the record); anything
// before 1900 indicates corruption, not history.
const MIN_PLAUSIBLE_YEAR = 1900;

export interface FoiColumnSpec {
  // Exact source header this output column reads from, or null when the
  // source does not assert the column at all - it is then emitted empty
  // (or as the authored constant) so the dataset class keeps its stable
  // core schema (issue #139: core columns callsign,status,licence_class
  // for callsign-observation rows; callsign,event_date,event for
  // issuance-events rows).
  source: string | null;
  output: string;
  // 'count' is a strictly-formatted integer (optionally with well-formed
  // thousands separators) emitted as plain digits - the only reshaping is
  // separator removal, validated, never repaired.
  kind: 'verbatim' | 'date' | 'count';
  // Date columns describing a validity END (reservation expiries)
  // legitimately postdate the snapshot vintage; issuance/creation dates
  // never do. Only meaningful for kind 'date'.
  futureAllowed?: boolean;
  // Authored constant emitted when source is null (e.g. the issuance-events
  // 'event' vocabulary, taken from the document's own wording). An
  // authored, reviewed value - never derived from row content.
  constant?: string;
}

export interface FoiSourceConversion {
  // Exact filename of the source file within the entry directory - the raw
  // data file for 'csv' format, or the committed raw-extract-*.md
  // transcription for 'markdown-table' format.
  sourceFile: string;
  // How sourceFile's bytes are parsed into records. Defaults to 'csv'.
  format?: 'csv' | 'markdown-table';
  // For markdown-table conversions: the data file the extract transcribes
  // (the PDF). Names the normalised output, so the derivative is keyed to
  // the disclosed document rather than the transcription intermediary.
  dataFile?: string;
  // Authored decode decision: the wdtk sheets are UTF-8 with BOM; the
  // Ofcom-published register carries raw 0xA0 bytes (Windows-1252/latin-1
  // NBSP) that are not valid UTF-8.
  encoding: 'utf8' | 'latin1';
  // Output column order; sources are matched by header NAME (order-insensitive).
  columns: readonly FoiColumnSpec[];
  // Source columns deliberately not carried into the normalised output.
  // Their presence is still REQUIRED (an absent or extra header means a
  // genuinely new source shape deserving review, never a guess).
  ignoredColumns: readonly string[];
  // 'sorted-by-first-column': source row order carries no meaning, so rows
  // sort by the first output column (codepoint order, whole-row tie-break).
  // 'source-order': the source order is itself meaningful and is preserved.
  rowOrder: 'sorted-by-first-column' | 'source-order';
  orderRationale: string;
  // Upper plausibility bound (inclusive) for date columns without
  // futureAllowed - the entry's data vintage.
  referenceDateIso: string;
}

// Conversion registry, keyed by the variant name authored in each entry's
// meta.json converter binding. One variant covers one entry's set of
// convertible source files (CSV-native data files, or committed
// raw-extract-*.md table transcriptions).
export const FOI_ENTRY_CONVERSIONS: Record<string, readonly FoiSourceConversion[]> = {
  // archive/foi/wdtk-1180568--licence-breakdown-duration-age (FOI 1900117,
  // vintage 2024-10; referenceDateIso is the response date, 2024-10-28).
  'wdtk-1180568-csv-pair': [
    {
      sourceFile: 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Value', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // The sheet asserts no licence class; emitted empty to keep the
        // callsign-observation core schema stable.
        { source: null, output: 'licence_class', kind: 'verbatim' },
        // Reservation EXPIRY - future values are legitimate (2029 observed).
        { source: 'Reserved to Date', output: 'reserved_to_date', kind: 'date', futureAllowed: true },
      ],
      // 'Type' is 'Call Sign - Amateur' on every row - a product
      // discriminator recorded in meta.json's contentsIndicative, not a
      // per-row assertion.
      ignoredColumns: ['Type'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive in no meaningful order; sorted by callsign for diffability',
      referenceDateIso: '2024-10-28',
    },
    {
      sourceFile: 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 2.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // Verbatim source vocabulary ('Amateur Foundation Radio Licence'),
        // never canonicalised to 'Foundation'.
        { source: 'Licence Type', output: 'licence_class', kind: 'verbatim' },
        { source: 'Created Date', output: 'created_date', kind: 'date' },
        { source: 'Original start date', output: 'original_start_date', kind: 'date' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive in no meaningful order; sorted by callsign for diffability (duplicate callsigns are attribute rows for multiple licences and tie-break on the whole row)',
      referenceDateIso: '2024-10-28',
    },
  ],
  // archive/foi/ofcom-756622--published-register-csv (vintage 2019-09-12,
  // from the published filename).
  'ofcom-756622-register-and-forbidden': [
    {
      sourceFile: 'allocated-reserved-forbidden-call-sign-foi-20190912.csv',
      encoding: 'latin1',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Licence Class', output: 'licence_class', kind: 'verbatim' },
        // The source header is literally 'Licence Issued Dat' - truncated
        // in the published file itself; matched verbatim, on the record.
        { source: 'Licence Issued Dat', output: 'licence_issued_date', kind: 'date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are ordered by Licence Issued Date ascending (blank dates last) - a meaningful publication order in the earliest known bulk disclosure of per-callsign issue dates; preserved verbatim',
      referenceDateIso: '2019-09-12',
    },
    {
      sourceFile: 'allocated-reserved-forbidden-call-sign.csv',
      encoding: 'latin1',
      columns: [
        // Three-letter SUFFIXES, not callsigns - the forbidden-list shape
        // (issue #139).
        { source: 'NAME', output: 'suffix', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency)',
      referenceDateIso: '2019-09-12',
    },
  ],
  // archive/foi/wdtk-184767--annual-licence-counts (reference 1-246847147,
  // letter dated 2013-12-11): annual counts of licences ISSUED per financial
  // year, transcribed from the response-letter PDF. Wide shape kept as the
  // letter asserts it - one row per period, both services (consumers filter;
  // the business-radio figures are part of the disclosed assertion).
  'wdtk-184767-counts-table': [
    {
      sourceFile: 'raw-extract-number-of-licences-coleman.md',
      format: 'markdown-table',
      dataFile: 'Number of licences Coleman.pdf',
      encoding: 'utf8',
      columns: [
        // The header's own qualifier '(1 April - 31 March)' defines the
        // period boundaries; the label is carried verbatim rather than
        // expanded into invented start/end dates.
        { source: 'period (1 April – 31 March)', output: 'period', kind: 'verbatim' },
        { source: 'Amateur Radio', output: 'amateur_radio_licences_issued', kind: 'count' },
        { source: 'Business Radio', output: 'business_radio_licences_issued', kind: 'count' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: "the letter's financial-year order is chronological and meaningful; preserved",
      referenceDateIso: '2013-12-11',
    },
  ],
  // archive/foi/wdtk-251507--reissue-policy (reference 1-278731481, letter
  // dated 2015-02-27): the last 20 heritage-callsign reallocations,
  // transcribed from 'applicants old call signs.pdf'. Event vocabulary
  // 'reallocated' is the covering letter's own word. Semantics caveat: the
  // source's Start date is the START DATE OF THE RECEIVING LICENCE, treated
  // here as the reallocation event date.
  'wdtk-251507-transfers-table': [
    {
      sourceFile: 'raw-extract-applicants-old-call-signs.md',
      format: 'markdown-table',
      dataFile: 'applicants old call signs.pdf',
      encoding: 'utf8',
      columns: [
        { source: 'Call Signs', output: 'callsign', kind: 'verbatim' },
        { source: null, output: 'event', kind: 'verbatim', constant: 'reallocated' },
        { source: 'Start date', output: 'event_date', kind: 'date' },
        // Verbatim source vocabulary ('Amateur Club Radio Licence' /
        // 'Amateur Full Radio Licence'), never canonicalised.
        { source: 'Licence Product', output: 'licence_class', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Reason', output: 'reason', kind: 'verbatim' },
        // Siebel-format identifiers, carried for cross-referencing against
        // other snapshots (attribute-addendum value).
        { source: 'Licence Number', output: 'licence_number', kind: 'verbatim' },
        { source: 'Con Id', output: 'con_id', kind: 'verbatim' },
      ],
      // Title/First_name/Last_name are 'S40' on every row - the document's
      // marker for names withheld under FOIA s.40. Withholding markers are
      // not data; presence still required.
      ignoredColumns: ['Title', 'First_name', 'Last_name'],
      rowOrder: 'source-order',
      orderRationale: "the document presents 'the last 20 applications' newest-first; a meaningful order, preserved",
      referenceDateIso: '2015-02-27',
    },
  ],
};

export function conversionFor(variantName: string, sourceFile: string): FoiSourceConversion {
  const conversions = FOI_ENTRY_CONVERSIONS[variantName];
  if (conversions === undefined) {
    throw new Error(`unknown FOI converter variant "${variantName}" - known variants: ${Object.keys(FOI_ENTRY_CONVERSIONS).join(', ')}`);
  }
  const conversion = conversions.find(c => c.sourceFile === sourceFile);
  if (conversion === undefined) {
    throw new Error(`variant "${variantName}" has no conversion for source file "${sourceFile}"`);
  }
  return conversion;
}

// Output naming convention: normalised--<slugified-data-file-basename>.csv.
export function slugifyBasename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalisedFileNameFor(sourceFile: string): string {
  return `normalised--${slugifyBasename(sourceFile)}.csv`;
}

export interface FoiConvertNotes {
  // Cells whose leading/trailing whitespace (including NBSP) was trimmed -
  // counted and sampled, never silent; the rows themselves are kept.
  trimmedCellCount: number;
  trimmedSamples: string[];
  // Cells containing a non-breaking space anywhere before trimming.
  nbspCellCount: number;
  // Post-trim empty values per source-backed output column (blank statuses
  // are data; the counts put them on the record for review). Columns with
  // no blanks are omitted; synthesised always-empty columns are structural
  // and not counted.
  blankCounts: Record<string, number>;
  // Day-first date-order evidence per output date column, as in the
  // open-data lane: one day>12 value verifies its whole column.
  dateStats: Record<string, { disambiguated: number; ambiguous: number }>;
  unverifiedDateColumns: string[];
}

export interface FoiConvertResult {
  csv: string;
  outputFileName: string;
  recordCount: number;
  schemaVersion: number;
  notes: FoiConvertNotes;
}

const TRIMMED_SAMPLE_LIMIT = 20;

// Tie-break separator for whole-row comparison: NUL cannot occur in the
// source cells, so joined rows can never collide across cell boundaries.
const SEP = String.fromCharCode(0);

// The non-breaking space, named so checks read explicitly (an NBSP literal
// is invisible in most editors and vulnerable to silent normalisation).
const NBSP = String.fromCharCode(0xa0);

// Ends-only trim: in JavaScript regexes \s already covers Unicode whitespace
// INCLUDING the non-breaking space. Interior whitespace is part of the
// assertion ('G6 FMU' exists in the register) and is kept.
const EDGE_WHITESPACE_RE = /^\s+|\s+$/g;

// Parses the single markdown table in a raw-extract document. Strict by
// design: exactly one table block, a well-formed separator row, and a cell
// count matching the header on every row - anything else is a new extract
// shape deserving review, never a guess. Cell padding (ASCII space/tab) is
// table FORMATTING and is stripped structurally; any other edge whitespace
// is left for the counted trim so it stays on the record.
function parseMarkdownTable(text: string, sourceFile: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map(line => line.replace(/[ \t]+$/, ''));
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('|')) {
      if (current === null) blocks.push(current = []);
      current.push(line);
    } else {
      current = null;
    }
  }
  if (blocks.length === 0) {
    throw new Error(`${sourceFile}: no markdown table found in the extract`);
  }
  if (blocks.length > 1) {
    throw new Error(`${sourceFile}: ${blocks.length} markdown tables found - expected exactly one (a new extract shape deserves a reviewed converter change)`);
  }
  const [block] = blocks;
  if (block.length < 2 || !/^\|[ :\-|]+\|$/.test(block[1])) {
    throw new Error(`${sourceFile}: markdown table has no separator row after the header`);
  }
  const splitRow = (line: string): string[] => {
    if (!line.endsWith('|')) {
      throw new Error(`${sourceFile}: markdown table row does not end with '|': ${line}`);
    }
    return line.slice(1, -1).split('|').map(cell => cell.replace(/^[ \t]+|[ \t]+$/g, ''));
  };
  const header = splitRow(block[0]);
  if (new Set(header).size !== header.length) {
    throw new Error(`${sourceFile}: markdown table has duplicate header names (${header.join(', ')})`);
  }
  return block.slice(2).map((line, index) => {
    const cells = splitRow(line);
    if (cells.length !== header.length) {
      throw new Error(`${sourceFile}: data row ${index + 1} (${cells[0] ?? '?'}) has ${cells.length} cells - the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
  });
}

export function convertFoiSource(bytes: Buffer, conversion: FoiSourceConversion): FoiConvertResult {
  const text = bytes.toString(conversion.encoding);
  const records: Record<string, string>[] = conversion.format === 'markdown-table'
    ? parseMarkdownTable(text, conversion.sourceFile)
    : parse(text, { columns: true, skip_empty_lines: true, bom: true });
  if (records.length === 0) {
    throw new Error(`${conversion.sourceFile}: parsed to zero data rows - refusing to normalise an empty file`);
  }

  // Header discipline: every expected header present, nothing extra, matched
  // by NAME (order-insensitive). Any deviation is a new source shape and a
  // reviewed converter change, never a guess.
  const actualHeaders = Object.keys(records[0]);
  const expectedHeaders = [
    ...conversion.columns.flatMap(c => (c.source === null ? [] : [c.source])),
    ...conversion.ignoredColumns,
  ];
  for (const expected of expectedHeaders) {
    if (!actualHeaders.includes(expected)) {
      throw new Error(`${conversion.sourceFile}: expected header "${expected}" not found (headers present: ${actualHeaders.join(', ')})`);
    }
  }
  for (const actual of actualHeaders) {
    if (!expectedHeaders.includes(actual)) {
      throw new Error(`${conversion.sourceFile}: unexpected header "${actual}" - extend the conversion registry (with tests) if the source shape has genuinely changed`);
    }
  }

  const notes: FoiConvertNotes = {
    trimmedCellCount: 0,
    trimmedSamples: [],
    nbspCellCount: 0,
    blankCounts: {},
    dateStats: {},
    unverifiedDateColumns: [],
  };

  const rows: string[][] = records.map((record, index) => convertRecord(record, index, conversion, notes));

  if (conversion.rowOrder === 'sorted-by-first-column') {
    // Codepoint order on the first output column, whole-row tie-break so
    // duplicate keys still order deterministically (never localeCompare).
    rows.sort((a, b) => codepointCompare(a[0], b[0]) || codepointCompare(a.join(SEP), b.join(SEP)));
  }

  notes.unverifiedDateColumns = Object.entries(notes.dateStats)
    .filter(([, s]) => s.disambiguated === 0)
    .map(([column]) => column);

  return {
    csv: renderCsv(conversion.columns.map(c => c.output), rows),
    outputFileName: normalisedFileNameFor(conversion.dataFile ?? conversion.sourceFile),
    recordCount: rows.length,
    schemaVersion: FOI_NORMALISED_SCHEMA_VERSION,
    notes,
  };
}

function convertRecord(record: Record<string, string>, index: number, conversion: FoiSourceConversion, notes: FoiConvertNotes): string[] {
  const rowLabel = (): string => {
    const key = conversion.columns.find(c => c.source !== null)?.source;
    return `data row ${index + 1} (${(key === undefined || key === null ? '?' : record[key] ?? '?')})`;
  };

  return conversion.columns.map(column => {
    if (column.source === null) return column.constant ?? '';
    const raw = record[column.source] ?? '';

    if (raw.includes(NBSP)) notes.nbspCellCount += 1;
    const trimmed = raw.replace(EDGE_WHITESPACE_RE, '');
    if (trimmed !== raw) {
      notes.trimmedCellCount += 1;
      if (notes.trimmedSamples.length < TRIMMED_SAMPLE_LIMIT) {
        notes.trimmedSamples.push(`${rowLabel()} ${column.output}: ${JSON.stringify(raw)}`);
      }
    }

    if (column.kind === 'date' && trimmed !== '') {
      let parsed: ParsedUkDateTime;
      try {
        parsed = parseUkDateTimeDetailed(trimmed);
      } catch (err) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: ${errorMessage(err)}`);
      }
      const datePart = parsed.iso.slice(0, 10);
      if (column.futureAllowed !== true && datePart > conversion.referenceDateIso) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: date "${trimmed}" is in the future relative to ${conversion.referenceDateIso} - failing plausibility check`);
      }
      if (Number(datePart.slice(0, 4)) < MIN_PLAUSIBLE_YEAR) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: date "${trimmed}" predates ${MIN_PLAUSIBLE_YEAR} - failing plausibility check`);
      }
      const stats = (notes.dateStats[column.output] ??= { disambiguated: 0, ambiguous: 0 });
      if (parsed.ambiguous) stats.ambiguous += 1;
      else stats.disambiguated += 1;
      return parsed.iso;
    }

    if (column.kind === 'count' && trimmed !== '') {
      // Plain digits, or well-formed thousands separators. Anything else is
      // corruption, not a number to be repaired by stripping commas.
      if (!/^\d+$/.test(trimmed) && !/^\d{1,3}(?:,\d{3})+$/.test(trimmed)) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: "${trimmed}" is not a well-formed integer count`);
      }
      return trimmed.replaceAll(',', '');
    }

    if (trimmed === '') {
      notes.blankCounts[column.output] = (notes.blankCounts[column.output] ?? 0) + 1;
    }
    return trimmed;
  });
}

export function convertFoiEntry(entryDir: string, variantName: string): FoiConvertResult[] {
  const conversions = FOI_ENTRY_CONVERSIONS[variantName];
  if (conversions === undefined) {
    throw new Error(`unknown FOI converter variant "${variantName}" - known variants: ${Object.keys(FOI_ENTRY_CONVERSIONS).join(', ')}`);
  }
  return conversions.map(conversion => {
    const sourcePath = path.join(entryDir, conversion.sourceFile);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source data file missing: ${sourcePath}`);
    }
    return convertFoiSource(fs.readFileSync(sourcePath), conversion);
  });
}

interface FoiEntryMetaConverter {
  converter?: { script?: string; variant?: string } | null;
}

function main(): void {
  const entryDirs = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (entryDirs.length === 0) {
    console.error('usage: node src/shared/foi-normalise.ts <entry-dir> [...]');
    process.exitCode = 1;
    return;
  }
  for (const entryDir of entryDirs) {
    const metaPath = path.join(entryDir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as FoiEntryMetaConverter;
    const variant = meta.converter?.variant;
    if (typeof variant !== 'string') {
      throw new Error(`${metaPath}: no authored converter.variant - author the binding before running the converter`);
    }
    console.log(`\n=== ${entryDir} (variant ${variant})`);
    for (const result of convertFoiEntry(entryDir, variant)) {
      const outPath = path.join(entryDir, result.outputFileName);
      fs.writeFileSync(outPath, result.csv, 'utf8');
      const bytes = Buffer.byteLength(result.csv, 'utf8');
      console.log(`${result.outputFileName}`);
      console.log(`  records: ${result.recordCount}, bytes: ${bytes}, sha256: ${calculateContentHash(result.csv)}`);
      console.log(`  notes: ${JSON.stringify(result.notes, null, 2).replace(/\n/g, '\n  ')}`);
    }
  }
}

if (import.meta.main) {
  main();
}
