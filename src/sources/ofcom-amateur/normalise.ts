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
import { errorMessage, verifyIgnoredColumn, type IgnoredRawLine, type IgnoredColumnVerification } from '../../shared/utils.ts';
import { parseCallsign, componentsFlagsForRows, componentRowToCells, loadReferenceData, COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION, type ComponentRow } from './components.ts';
import { type ColumnInterpretation } from '../../v2/claim.ts';

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

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

const DATE_COLUMNS: ReadonlySet<CanonicalColumn> = new Set([
  'created_date',
  'last_modified_date',
  'licence_version_last_modified_date',
  'licence_version_original_start_date',
] as CanonicalColumn[]);

// The per-entry statistics aggregate over canonical rows and their component
// decomposition - the exact computation whose output the sweep archives as
// stats.json. Owned HERE, beside the canonical schema it aggregates, so a
// consumer reproducing stats from another representation of the same rows
// (the claim-ledger projection) derives them through the identical column and
// date-column knowledge rather than a copy that could drift.
export function entryStatsForCanonicalRows(rows: readonly (readonly string[])[], componentRows: readonly ComponentRow[]): EntryStats {
  return computeEntryStats(CANONICAL_COLUMNS, rows, DATE_COLUMNS, componentRows);
}

// Registry of known raw header variants. Keys are the exact raw column names
// (post BOM-strip); values are the canonical columns they populate, or null
// for a column that is required-present but not carried into the normalised
// projection (export padding; the ledger still carries every raw column
// verbatim, so nothing is lost - the FOI lane's ignoredColumns concept).
// Header match is exact and order-sensitive - Ofcom's exports are
// machine-generated, so any deviation is a genuinely new variant deserving
// review.
const VARIANTS: Record<string, Record<string, CanonicalColumn | null>> = {
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
  // The 2025-11-11 web-archived export: the v2026-licence-version columns plus
  // five empty-named trailing padding columns. Parsed via a shape-only
  // raw-extract that fills the empty header names (unknown-1..5) so csv-parse
  // cannot collapse them; the padding columns are required-present but carry
  // no canonical data (empty on all but 29 rows bearing a stray Excel-mangled
  // month token, documented in the entry meta and carried in the ledger).
  'v2026-licence-version-padded': {
    'Callsign': 'callsign',
    'Product__c': 'product',
    'Status': 'status',
    'Type__c': 'type',
    'Licence_Version.LastModifiedDate': 'licence_version_last_modified_date',
    'Licence_Version.Original_start_date__c': 'licence_version_original_start_date',
    'unknown-1': null,
    'unknown-2': null,
    'unknown-3': null,
    'unknown-4': null,
    'unknown-5': null,
  },
  // The same six columns as v2026-licence-version but with ISO dates - the
  // shape a WORKBOOK publication's mechanical extract renders (typed date
  // cells become YYYY-MM-DD[ HH:MM:SS]). Identical headers to the day-first
  // variant, so auto-detection can never choose it: an entry binds it
  // explicitly via meta.json's converter.variant override.
  'v2026-licence-version-iso': {
    'Callsign': 'callsign',
    'Product__c': 'product',
    'Status': 'status',
    'Type__c': 'type',
    'Licence_Version.LastModifiedDate': 'licence_version_last_modified_date',
    'Licence_Version.Original_start_date__c': 'licence_version_original_start_date',
  },
};

// Variants whose date columns arrive ISO (workbook extracts render typed date
// cells as YYYY-MM-DD[ HH:MM:SS]); every other variant's dates are the UK
// day-first CSV rendering.
const ISO_DATE_VARIANTS: ReadonlySet<string> = new Set(['v2026-licence-version-iso']);

// The attested date grammar of an open-data variant's date columns — the same
// single fact interpretOpenDataColumns attests per column, exported so the
// cross-vintage coherency fold (issue #725 S2) can compare two observations'
// attested renderings without re-authoring the variant knowledge.
export function openDataDateFormat(variant?: string): 'DD/MM/YYYY' | 'YYYY-MM-DD' {
  return variant !== undefined && ISO_DATE_VARIANTS.has(variant) ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
}

// VERIFIED declarations for every null-mapped ("ignored") column above (issue
// #577, mirroring the FOI lane's ignoredColumns): every raw header VARIANTS
// maps to null must have an entry here, checked at parse time - a null
// mapping alone is a structural "not carried" note, not a reviewed statement
// of what the column actually contains. The 11 Nov 2025 CSV is the motivating
// case: four of its five padding columns are genuinely empty throughout, but
// the fifth carries a stray Excel-mangled month token on 29 of 159,895 rows -
// a blind ignore-by-null would have dropped that signal without a trace.
const IGNORED_COLUMN_VERIFICATION: Record<string, Record<string, IgnoredColumnVerification>> = {
  'v2026-licence-version-padded': {
    'unknown-1': { kind: 'empty' },
    'unknown-2': { kind: 'empty' },
    'unknown-3': { kind: 'empty' },
    'unknown-4': { kind: 'empty' },
    'unknown-5': {
      kind: 'content-bearing',
      note: '29 of 159,895 rows carry a stray Excel-mangled month token (e.g. "20-Mar") - a spreadsheet artefact of the source export, not a genuine data column; carried verbatim in the raw-keyed claim ledger, never projected into the canonical columns',
    },
  },
};

// Verifies every null-mapped column of `mapping` against its declared
// assertion in IGNORED_COLUMN_VERIFICATION, failing loudly both when a
// declaration is missing (an ignored column must be reviewed before it can
// be ignored, never merely implied by mapping to null) and when the actual
// records contradict it (a column silently starting to vary, or a "constant"
// silently changing, must never be dropped without review). Exported so it
// can be unit-tested directly against a synthetic mapping/records, without
// needing an entry in the real variant registry.
export function verifyIgnoredOpenDataColumns(variant: string, mapping: Readonly<Record<string, CanonicalColumn | null>>, records: readonly Record<string, string>[]): void {
  const declared = IGNORED_COLUMN_VERIFICATION[variant] ?? {};
  for (const [header, canonical] of Object.entries(mapping)) {
    if (canonical !== null) continue;
    const spec = declared[header];
    if (spec === undefined) {
      throw new Error(`variant "${variant}" maps column "${header}" to null (required-present but not carried) with no declared verification in IGNORED_COLUMN_VERIFICATION - a column must be reviewed as empty, constant, or content-bearing before it can be ignored`);
    }
    verifyIgnoredColumn({ column: header, verification: spec }, records, `variant "${variant}"`);
  }
}

// The authored raw->canonical binding for a registered variant, or undefined
// for an unknown name. Lets a consumer that already knows a variant (or has
// detected one from a stored header manifest, e.g. the claim-ledger projection
// in src/v2/build-projection-db.ts) read the same mapping convertRawCsv uses,
// never re-guessing which raw header means what.
export function mappingForVariant(variant: string): Readonly<Record<string, CanonicalColumn | null>> | undefined {
  return VARIANTS[variant];
}

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

// Every raw column name that means "product / licence class", derived from the
// variant registry so a new variant keeps this in sync automatically. A ledger
// consumer (the class-product-mismatch fold, issue #361) reads the raw product
// claim by header without re-guessing which raw header carried the product; the
// oldest v2022-minimal variant declares none, so it contributes nothing.
export const PRODUCT_COLUMN_NAMES: ReadonlySet<string> = new Set(
  Object.values(VARIANTS).flatMap(mapping =>
    Object.entries(mapping).filter(([, canonical]) => canonical === 'product').map(([raw]) => raw)),
);

// Every raw column name that means "status", derived from the variant registry
// so a new variant keeps this in sync automatically. The value catalogue's
// `status` field fold (src/ci/value-catalogue-fold.ts) reads the raw status claim
// by header without re-guessing which raw header carried the status; every
// open-data variant declares one.
export const STATUS_COLUMN_NAMES: ReadonlySet<string> = new Set(
  Object.values(VARIANTS).flatMap(mapping =>
    Object.entries(mapping).filter(([, canonical]) => canonical === 'status').map(([raw]) => raw)),
);

// Every raw open-data column name that carries a canonical DATE column, mapped
// to that canonical, derived from the variant registry so a new variant keeps
// this in sync automatically. The event-time explain arm (issue #725 S1,
// src/v2/explain.ts) resolves which raw header carries a claim's event kind
// through this map - by the authored binding, never by value-matching a cell
// that happens to hold the same day.
export const DATE_COLUMN_CANONICAL_BY_RAW_HEADER: ReadonlyMap<string, CanonicalColumn> = new Map(
  Object.values(VARIANTS).flatMap(mapping =>
    Object.entries(mapping).filter((entry): entry is [string, CanonicalColumn] =>
      entry[1] !== null && DATE_COLUMNS.has(entry[1]))),
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

// The raw header a variant's mapping assigns to a given canonical column, or
// undefined when the variant carries no such column (e.g. the 2022-minimal
// export declares no product). Lets a consumer read the authored raw->canonical
// binding by canonical name without re-deriving which raw header means what.
export function rawColumnForCanonical(
  mapping: Readonly<Record<string, CanonicalColumn | null>>,
  canonical: CanonicalColumn,
): string | undefined {
  return Object.entries(mapping).find(([, target]) => target === canonical)?.[0];
}

// The variant-detected, ignored-line-stripped parse of a raw open-data register
// CSV, under Ofcom's OWN headers - the step shared by convertRawCsv and any
// consumer (e.g. the raw-keyed claim ledger) that must read the same rows the
// committed normalisation was derived from. `records` are keyed by raw header;
// `mapping` is the authored raw->canonical binding for the detected variant, so
// the callsign/product columns are read from the registry, never re-guessed.
export interface ParsedRawRegister {
  records: Record<string, string>[];
  headers: string[];
  variant: string;
  mapping: Readonly<Record<string, CanonicalColumn | null>>;
  headerLines: { line: number; content: string }[];
  ignoredLines: IgnoredRawLine[];
  // The 1-based physical line of each record, parallel to `records` by index -
  // the ordered list of lines that are neither the header nor ignored (issue
  // #431). The same exact line-accounting invariant that guarantees
  // `1 data record = 1 physical line` (asserted below) proves this mapping
  // sound: `dataLineNumbers.length === records.length` by construction, so a
  // consumer (the raw-keyed claim ledger) can attest each observation's source
  // line without re-parsing.
  dataLineNumbers: number[];
}

// Strip the curated + blank non-data lines, parse the remainder under Ofcom's
// headers, detect the header variant, and prove the line accounting - the
// converter-neutral front half of convertRawCsv. Curated ignores are
// byte-verified against the raw content (stale curation fails loudly), and an
// unknown header variant or a broken line count throws rather than guessing:
// the same discipline whether the caller is normalising or emitting claims.
export function parseRawRegister(rawContent: string, curatedIgnores: IgnoredRawLine[] = [], forcedVariant?: string): ParsedRawRegister {
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
  // An entry may bind its variant explicitly (meta.json converter.variant) -
  // the per-dataset override for shapes auto-detection cannot distinguish
  // (e.g. identical headers whose date rendering differs). The override is
  // still verified against the actual headers: a forced variant that does not
  // match the file fails as loudly as an unknown one.
  let variant: string;
  if (forcedVariant !== undefined) {
    const forced = VARIANTS[forcedVariant];
    if (forced === undefined) {
      throw new Error(`converter.variant "${forcedVariant}" is not in the variant registry`);
    }
    const expected = Object.keys(forced);
    if (!(headers.length === expected.length && headers.every((h, i) => h === expected[i]))) {
      throw new Error(`converter.variant "${forcedVariant}" does not match the raw headers [${headers.join(', ')}]`);
    }
    variant = forcedVariant;
  } else {
    const detected = detectHeaderVariant(headers);
    if (detected === undefined) {
      throw new Error(`unknown raw header variant [${headers.join(', ')}] - extend the variant registry (with tests) to support it`);
    }
    variant = detected;
  }
  const mapping = VARIANTS[variant];

  // Every null-mapped ("ignored") column's actual content must match its
  // declared verification (issue #577) - fails loud on the first row that
  // contradicts it, or when a null-mapped column has no declaration at all.
  verifyIgnoredOpenDataColumns(variant, mapping, records);

  const ignoredLines = [...ignoredByLine.values()].sort((a, b) => a.line - b.line);

  // The ordered 1-based physical line of each surviving data line, in the SAME
  // order the parser emitted the records (the stripped `effective` text kept
  // that order), so dataLineNumbers[k] is the source line of records[k].
  const dataLineNumbers: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!ignoredByLine.has(i + 1)) dataLineNumbers.push(i + 1);
  }

  // Count invariant - exact arithmetic, no inference: every physical line
  // is exactly one of header / data row / ignored. A mismatch means the
  // one-line-per-record model does not hold (e.g. a quoted multi-line cell)
  // and the enumeration cannot be trusted: fail loudly. The same arithmetic
  // proves dataLineNumbers lines up with records one-for-one.
  const headerLineCount = 1;
  if (lines.length - headerLineCount !== records.length + ignoredLines.length) {
    throw new Error(`raw line accounting failed: ${lines.length - headerLineCount} data lines != ${records.length} records + ${ignoredLines.length} ignored - does a quoted cell span lines?`);
  }

  return { records, headers, variant, mapping, headerLines: [{ line: 1, content: lines[0] }], ignoredLines, dataLineNumbers };
}

// The open-data lane's inferred interpretation of each column (issue #435), the
// LIFT the open-data half of interpretColumns projects into an @interpretation
// claim. Single-sourced HERE, where the interpretation actually lives: the
// callsign subject is the callsign-token; the product column is an enumerated
// category (the exact-match input to the licence-category tier); every date
// column is parsed strict UK day-first, so its format is DD/MM/YYYY (the fixed
// fact stated in this module's header); status/type and any other column are
// carried as verbatim strings. Indexed 1:1 to `headers` so it aligns with the
// @column manifest. The loader stores the result on the SourceObservationSet, so
// interpretColumns reads it back rather than re-deriving.
export function interpretOpenDataColumns(
  headers: readonly string[],
  mapping: Readonly<Record<string, CanonicalColumn | null>>,
  options: { subjectColumn: string; categoryColumn?: string; variant?: string },
): ColumnInterpretation[] {
  // Date columns attest the format the VARIANT actually carries: the UK
  // day-first CSV rendering for ordinary exports, ISO for workbook extracts
  // (typed date cells rendered YYYY-MM-DD by the mechanical extract). The
  // attestation is load-bearing - the interpretation oracle re-parses every
  // value under it - so it must state the true format, never a default.
  const dateFormat = openDataDateFormat(options.variant);
  return headers.map(header => {
    if (header === options.subjectColumn) return { type: 'callsign-token' };
    if (options.categoryColumn !== undefined && header === options.categoryColumn) return { type: 'enumerated-category' };
    const canonical = mapping[header];
    if (canonical !== undefined && canonical !== null && DATE_COLUMNS.has(canonical)) return { type: 'date', format: dateFormat };
    return { type: 'string' };
  });
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
export function convertRawCsv(rawContent: string, context: ConvertContext, curatedIgnores: IgnoredRawLine[] = [], forcedVariant?: string): ConvertResult {
  const { records, variant, mapping, headerLines, ignoredLines } = parseRawRegister(rawContent, curatedIgnores, forcedVariant);
  const isoDates = ISO_DATE_VARIANTS.has(variant);

  const dateStats: Partial<Record<CanonicalColumn, { disambiguated: number; ambiguous: number }>> = {};
  const rows: string[][] = records.map((record, index) => {
    const canonical: Record<string, string> = {};
    for (const [rawColumn, canonicalColumn] of Object.entries(mapping)) {
      // null-mapped columns are required-present export padding: not carried
      // into the normalised projection (the ledger carries them verbatim).
      if (canonicalColumn === null) continue;
      const rawValue = record[rawColumn] ?? '';
      if (DATE_COLUMNS.has(canonicalColumn) && rawValue.trim() !== '') {
        let parsed: ParsedUkDateTime;
        if (isoDates) {
          // Workbook-extract dates arrive ISO (typed at source, rendered by
          // the mechanical extract) - validated and carried verbatim, with no
          // day-first ordering to disambiguate.
          const trimmed = rawValue.trim();
          const match = /^\d{4}-(\d{2})-(\d{2})( \d{2}:\d{2}:\d{2})?$/.exec(trimmed);
          if (match === null || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) < 1 || Number(match[2]) > 31) {
            throw new Error(`row ${index + 2} (${record[Object.keys(mapping)[0]] ?? '?'}): "${trimmed}" is not a well-formed ISO extract date`);
          }
          parsed = { iso: trimmed, ambiguous: false };
        } else {
          try {
            parsed = parseUkDateTimeDetailed(rawValue);
          } catch (err) {
            throw new Error(`row ${index + 2} (${record[Object.keys(mapping)[0]] ?? '?'}): ${errorMessage(err)}`);
          }
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
  // reaches the parser so the date-aware forbidden-suffix-issued-after-first-known-list
  // flag can be asserted; it is empty on variants that carry no such column, and the
  // parser then honestly declines the flag.
  const originalStartDateIndex = CANONICAL_COLUMNS.indexOf('licence_version_original_start_date');
  const referenceData = loadReferenceData();
  const componentRows = componentsFlagsForRows(rows.map(r => parseCallsign(r[0], r[1], referenceData, r[originalStartDateIndex])));

  return {
    csv: renderCsv([...CANONICAL_COLUMNS], rows),
    headerVariant: variant,
    schemaVersion: NORMALISED_SCHEMA_VERSION,
    recordCount: rows.length,
    headerLines,
    ignoredLines,
    dateStats,
    unverifiedDateColumns,
    stats: entryStatsForCanonicalRows(rows, componentRows),
    componentsCsv: renderCsv([...COMPONENT_COLUMNS], componentRows.map(componentRowToCells)),
    componentsSchemaVersion: COMPONENTS_SCHEMA_VERSION,
  };
}
