/**
 * FOI-lane CSV normalisers (issue #139, tier 1): deterministic converters
 * for the CSV-native FOI entries, per ADR 0004's derivation chain
 * (raw data file -> normalised--<slug>.csv, converter binding authored in
 * the entry's meta.json).
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
  // source does not assert the column at all - it is then emitted empty so
  // the dataset class keeps its stable core schema (issue #139: core
  // columns callsign,status,licence_class for callsign-observation rows).
  source: string | null;
  output: string;
  kind: 'verbatim' | 'date';
  // Date columns describing a validity END (reservation expiries)
  // legitimately postdate the snapshot vintage; issuance/creation dates
  // never do. Only meaningful for kind 'date'.
  futureAllowed?: boolean;
}

export interface FoiCsvConversion {
  // Exact filename of the source data file within the entry directory.
  sourceFile: string;
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
// CSV-native data files.
export const FOI_ENTRY_CONVERSIONS: Record<string, readonly FoiCsvConversion[]> = {
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
};

export function conversionFor(variantName: string, sourceFile: string): FoiCsvConversion {
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

export function convertFoiCsv(bytes: Buffer, conversion: FoiCsvConversion): FoiConvertResult {
  const text = bytes.toString(conversion.encoding);
  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true, bom: true });
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
    outputFileName: normalisedFileNameFor(conversion.sourceFile),
    recordCount: rows.length,
    schemaVersion: FOI_NORMALISED_SCHEMA_VERSION,
    notes,
  };
}

function convertRecord(record: Record<string, string>, index: number, conversion: FoiCsvConversion, notes: FoiConvertNotes): string[] {
  const rowLabel = (): string => {
    const key = conversion.columns.find(c => c.source !== null)?.source;
    return `data row ${index + 1} (${(key === undefined || key === null ? '?' : record[key] ?? '?')})`;
  };

  return conversion.columns.map(column => {
    if (column.source === null) return '';
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
    return convertFoiCsv(fs.readFileSync(sourcePath), conversion);
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
