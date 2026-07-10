/**
 * ofcom-amateur normaliser: maps every known raw header variant onto the
 * canonical schema, so consumers read ONE stable shape across the archive's
 * full history instead of handling Ofcom's per-publication header drift.
 *
 * Canonical schema v1: faithful column mapping plus date normalisation only.
 * Values are otherwise verbatim. Dates become ISO-ordered (yyyy-mm-dd, time
 * kept to the precision the raw supplies). Date columns are a UNION across
 * variants - a column an entry's variant doesn't carry is empty for every row
 * of that entry, and meta.json's headerVariant says which columns are real.
 *
 * Unknown headers fail loudly. A new Ofcom variant is a reviewed code change
 * (extend VARIANTS below with tests), never a guess.
 */

import { parse } from 'csv-parse/sync';
import { parseUkDateTimeDetailed, type ParsedUkDateTime, renderCsv, codepointCompare } from '../../shared/normalise.ts';
import { computeEntryStats, type EntryStats } from '../../shared/stats.ts';
import { errorMessage, type IgnoredRawLine } from '../../shared/utils.ts';
import { parseCallsign, componentsFlagsForRows, componentRowToCells, loadReferenceData, COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION } from './components.ts';

export const NORMALISED_SCHEMA_VERSION = 1;

export const CANONICAL_COLUMNS = [
  'callsign',
  'product',
  'status',
  'type',
  'created_date',
  'last_modified_date',
  'licence_version_last_modified_date',
  'licence_version_original_start_date',
] as const;

type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

const DATE_COLUMNS: ReadonlySet<CanonicalColumn> = new Set([
  'created_date',
  'last_modified_date',
  'licence_version_last_modified_date',
  'licence_version_original_start_date',
] as CanonicalColumn[]);

// Registry of known raw header variants. Keys are the exact raw column names
// (post BOM-strip); values are the canonical columns they populate. Header
// match is exact and order-sensitive - Ofcom's exports are machine-generated,
// so any deviation is a genuinely new variant deserving review.
const VARIANTS: Record<string, Record<string, CanonicalColumn>> = {
  // 2022 opendata export (oldest known variant): three columns only - no
  // product, no dates. Recovered from a prior download (see the 2022-05-30
  // archive entry's reconstructionNotes).
  'v2022-minimal': {
    'Value': 'callsign',
    'Status': 'status',
    'Type': 'type',
  },
  // 2023 opendata export (no Type column; single date with an MMSI-flavoured label).
  'v2023-mmsi': {
    'Value': 'callsign',
    'Status': 'status',
    'Product': 'product',
    'Call Sign MMSI: Last Modified Date': 'last_modified_date',
  },
  // 2025 exports using raw Salesforce API field names.
  'v2025-salesforce': {
    'Value__c': 'callsign',
    'Product__c': 'product',
    'Status__c': 'status',
    'Type__c': 'type',
    'CreatedDate': 'created_date',
    'LastModifiedDate': 'last_modified_date',
  },
  // 2025 export with human-friendly labels (same columns, renamed).
  'v2025-friendly': {
    'Call sign': 'callsign',
    'Product': 'product',
    'Status': 'status',
    'Type': 'type',
    'CreatedDate': 'created_date',
    'LastModifiedDate': 'last_modified_date',
  },
  // 2026 live export: licence-version date columns replace created/modified.
  'v2026-licence-version': {
    'Callsign': 'callsign',
    'Product__c': 'product',
    'Status': 'status',
    'Type__c': 'type',
    'Licence_Version.LastModifiedDate': 'licence_version_last_modified_date',
    'Licence_Version.Original_start_date__c': 'licence_version_original_start_date',
  },
};

export function detectHeaderVariant(headers: string[]): string | undefined {
  for (const [variant, mapping] of Object.entries(VARIANTS)) {
    const expected = Object.keys(mapping);
    if (headers.length === expected.length && headers.every((h, i) => h === expected[i])) {
      return variant;
    }
  }
  return undefined;
}

// Every raw column name that means "callsign", derived from the variant
// registry so a new variant keeps this in sync automatically.
const CALLSIGN_COLUMN_NAMES: ReadonlySet<string> = new Set(
  Object.values(VARIANTS).flatMap(mapping =>
    Object.entries(mapping).filter(([, canonical]) => canonical === 'callsign').map(([raw]) => raw)),
);

// Find the callsign column by NAME regardless of position (issue #4): an
// upstream column reorder must not silently change what sorted derivatives
// are sorted by. Matches through a leading BOM (callers that parse without
// BOM stripping see it on the first header) but returns the ORIGINAL header
// so record access keeps working. Returns undefined when no known callsign
// name is present - the caller decides its fallback and warns.
export function callsignColumnFor(headers: readonly string[]): string | undefined {
  return headers.find(h => CALLSIGN_COLUMN_NAMES.has(h.replace(/^\uFEFF/, '')));
}

export interface ConvertContext {
  // Upper plausibility bound for parsed dates - typically the entry's
  // Ofcom-reported or fetch date. Any raw date beyond it fails the entry.
  referenceDateIso: string;
}

export interface ConvertResult {
  csv: string;
  headerVariant: string;
  schemaVersion: number;
  recordCount: number;
  // The verbatim raw header line(s) - archived in meta.json so the line
  // accounting is fully explicit. Always one element for today's exports;
  // an array so multi-row headers fit without a schema change.
  headerLines: { line: number; content: string }[];
  // Raw lines excluded as non-data (empty when the export is clean) -
  // archived in meta.json so nothing is dropped silently.
  ignoredLines: IgnoredRawLine[];
  // Reviewer evidence for date-order confidence, per canonical date column.
  // Date formats are assumed consistent within a column (they may differ
  // between columns), so one disambiguating value (any component >12)
  // verifies the whole column as day-first; both-<=12 values are covered by
  // their column's verification.
  dateStats: Partial<Record<CanonicalColumn, { disambiguated: number; ambiguous: number }>>;
  // Columns containing dates but no disambiguating value - formally unproven
  // ordering, flagged for the reviewer.
  unverifiedDateColumns: CanonicalColumn[];
  // Data-quality statistics over the canonical rows (issue #46) - archived
  // as stats.json alongside normalised.csv.
  stats: EntryStats;
  // Callsign components + per-row flags (issue #51) - archived as
  // components.csv, joined to normalised.csv by callsign.
  componentsCsv: string;
  componentsSchemaVersion: number;
}

// Plausibility floor: UK wireless licensing began in the early 1900s, and
// Licence_Version.Original_start_date__c genuinely carries twentieth-century
// dates for long-held licences (1989 observed in real data). Anything before
// 1900 indicates corruption, not history.
const MIN_PLAUSIBLE_YEAR = 1900;

// Physical lines of a raw file: split on LF, tolerate CRLF (the terminator
// is serialisation, not content - stripped), and drop the single empty
// element a file-terminating newline produces (it ends the last line, it
// does not start an empty row).
export function physicalLines(rawContent: string): string[] {
  const lines = rawContent.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Validity is SYNTACTIC here, SEMANTIC downstream (ratified 2026-07-08):
// a raw line with the correct column count is a row of the table and goes
// into normalised.csv - including all-empty rows (,,) and rows with no
// callsign, because that is what the raw data provides. Whether a row
// represents a valid callsign with sensible attributes is a semantic
// judgement that belongs to the flag machinery and downstream consumers.
// The ONLY exceptions are:
//   - blank physical lines (not rows at all) - auto-enumerated;
//   - CURATED ignores from meta.json's ignoredLines: syntactically valid
//     lines a human has judged to be export furniture (copyright footers,
//     generated-by stamps). The converter honours them only if they
//     byte-match the raw line; stale curation fails loudly. There is no
//     mechanical predicate that can make this call - explicitness plus PR
//     review is the guard.
export function convertRawCsv(rawContent: string, context: ConvertContext, curatedIgnores: IgnoredRawLine[] = []): ConvertResult {
  const lines = physicalLines(rawContent);
  const ignoredByLine = new Map<number, IgnoredRawLine>();
  for (const curated of curatedIgnores) {
    if (lines[curated.line - 1] !== curated.content) {
      throw new Error(`curated ignoredLines entry for line ${curated.line} does not match raw.csv - meta declares ${JSON.stringify(curated.content)}, raw has ${JSON.stringify(lines[curated.line - 1])}`);
    }
    ignoredByLine.set(curated.line, curated);
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '' && !ignoredByLine.has(i + 1)) {
      ignoredByLine.set(i + 1, { line: i + 1, content: lines[i], reason: 'blank' });
    }
  }

  // Strip ignored lines BEFORE parsing, so the parser's strict column-count
  // checking applies to everything else: a ragged line that is neither
  // blank nor curated fails the whole conversion loudly - the human then
  // decides (new variant, or a new curated ignore).
  const effective = lines.filter((_, index) => !ignoredByLine.has(index + 1)).join('\n') + '\n';
  const records: Record<string, string>[] = parse(effective, { columns: true, bom: true });
  if (records.length === 0) {
    throw new Error('raw CSV parsed to zero records - refusing to normalise an empty publication');
  }

  const headers = Object.keys(records[0]);
  const variant = detectHeaderVariant(headers);
  if (variant === undefined) {
    throw new Error(`unknown raw header variant [${headers.join(', ')}] - extend the variant registry (with tests) to support it`);
  }
  const mapping = VARIANTS[variant];

  const ignoredLines = [...ignoredByLine.values()].sort((a, b) => a.line - b.line);

  // Count invariant - exact arithmetic, no inference: every physical line
  // is exactly one of header / data row / ignored. A mismatch means the
  // one-line-per-record model does not hold (e.g. a quoted multi-line cell)
  // and the enumeration cannot be trusted: fail loudly.
  const headerLineCount = 1;
  if (lines.length - headerLineCount !== records.length + ignoredLines.length) {
    throw new Error(`raw line accounting failed: ${lines.length - headerLineCount} data lines != ${records.length} records + ${ignoredLines.length} ignored - does a quoted cell span lines?`);
  }

  const dateStats: Partial<Record<CanonicalColumn, { disambiguated: number; ambiguous: number }>> = {};
  const rows: string[][] = records.map((record, index) => {
    const canonical: Record<string, string> = {};
    for (const [rawColumn, canonicalColumn] of Object.entries(mapping)) {
      const rawValue = record[rawColumn] ?? '';
      if (DATE_COLUMNS.has(canonicalColumn) && rawValue.trim() !== '') {
        let parsed: ParsedUkDateTime;
        try {
          parsed = parseUkDateTimeDetailed(rawValue);
        } catch (err) {
          throw new Error(`row ${index + 2} (${record[Object.keys(mapping)[0]] ?? '?'}): ${errorMessage(err)}`);
        }
        const datePart = parsed.iso.slice(0, 10);
        if (datePart > context.referenceDateIso) {
          throw new Error(`row ${index + 2}: date "${rawValue}" is in the future relative to ${context.referenceDateIso} - failing plausibility check`);
        }
        if (Number(datePart.slice(0, 4)) < MIN_PLAUSIBLE_YEAR) {
          throw new Error(`row ${index + 2}: date "${rawValue}" predates ${MIN_PLAUSIBLE_YEAR} - failing plausibility check`);
        }
        const stats = (dateStats[canonicalColumn] ??= { disambiguated: 0, ambiguous: 0 });
        if (parsed.ambiguous) stats.ambiguous += 1;
        else stats.disambiguated += 1;
        canonical[canonicalColumn] = parsed.iso;
      } else {
        canonical[canonicalColumn] = rawValue;
      }
    }
    return CANONICAL_COLUMNS.map(c => canonical[c] ?? '');
  });

  // Deterministic order: callsign (codepoint), then the whole row as
  // tie-break so duplicate callsigns still order stably.
  rows.sort((a, b) => codepointCompare(a[0], b[0]) || codepointCompare(a.join('\u0000'), b.join('\u0000')));

  const unverifiedDateColumns = (Object.entries(dateStats) as [CanonicalColumn, { disambiguated: number; ambiguous: number }][])
    .filter(([, s]) => s.disambiguated === 0)
    .map(([column]) => column);

  // Component rows derive from the SAME sorted canonical rows (row order and
  // join order match normalised.csv by construction); column 0 is callsign,
  // column 1 product, per CANONICAL_COLUMNS. The original-start-date column
  // reaches the parser so the date-aware forbidden-suffix-post-2019 flag can
  // be asserted; it is empty on variants that carry no such column, and the
  // parser then honestly declines the flag.
  const originalStartDateIndex = CANONICAL_COLUMNS.indexOf('licence_version_original_start_date');
  const referenceData = loadReferenceData();
  const componentRows = componentsFlagsForRows(rows.map(r => parseCallsign(r[0], r[1], referenceData, r[originalStartDateIndex])));

  return {
    csv: renderCsv([...CANONICAL_COLUMNS], rows),
    headerVariant: variant,
    schemaVersion: NORMALISED_SCHEMA_VERSION,
    recordCount: rows.length,
    headerLines: [{ line: 1, content: lines[0] }],
    ignoredLines,
    dateStats,
    unverifiedDateColumns,
    stats: computeEntryStats(CANONICAL_COLUMNS, rows, DATE_COLUMNS, componentRows),
    componentsCsv: renderCsv([...COMPONENT_COLUMNS], componentRows.map(componentRowToCells)),
    componentsSchemaVersion: COMPONENTS_SCHEMA_VERSION,
  };
}
