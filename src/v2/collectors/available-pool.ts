/**
 * The available-pool family: FOI entries whose datasetClasses carry
 * 'available-pool' (archive/foi/**) - the 2013-09..2016-01 disclosures of
 * call signs (or bare suffixes) that Ofcom's licensing system reported as
 * available for issue at the disclosure's vintage. Keyed off the AUTHORED
 * converter binding (FOI_ENTRY_CONVERSIONS in foi-normalise.ts), so the raw
 * file and columns are never re-guessed.
 *
 * EPISTEMIC STANDING (load-bearing, never dropped). Ofcom holds NO list of
 * available call signs: the licensing system GENERATES availability on demand
 * (the reference-context "not-held" quartet, e.g. ofcom-518689, states this
 * verbatim). So each row here is a POINT-IN-TIME snapshot of a 2013-2016
 * export, and its vintage carries the whole assertion. A claim in this family
 * is NOT a current-availability assertion and NOT evidence that Ofcom maintains
 * such a list; absence from a later register is NOT availability. The vintage
 * rides on every observation (emitClaims copies the source vintage onto every
 * claim's provenance) precisely so this standing cannot be lost downstream.
 *
 * SUBJECT KIND is 'pool-slot' for BOTH sub-shapes, so the emit path runs the
 * generic raw-only emitClaims (existence + raw attribute claims) and NEVER the
 * callsign normalisation/licence-category derived layer. Sub-shape B's subject
 * is literally a full call sign, but an available-pool row is a DIFFERENT
 * assertion from a register row: tagging it 'pool-slot' keeps it from acquiring
 * register callsign edges or a licence_category tier. Joining pool call signs to
 * register call signs (and prefixing a sub-shape-A suffix into its M6/20/M0 call
 * sign) is DEFERRED fold/derived work, deliberately not built here.
 *
 * TWO sub-shapes, discriminated by the authored callsign column's kind:
 *  - Sub-shape A (2013/14, suffix-shaped; callsign column kind 'prefixed'): the
 *    raw cell is a bare three-letter suffix. The subject is that suffix VERBATIM;
 *    the M6xxx call sign is NOT synthesised here. The sheet's own stated class
 *    and prefix context (the 'Foundation = M6aaa' header, the 'Prefix = M6'
 *    preamble - matched cell-for-cell by the authored binding) ride as the
 *    attributes licence_class and prefix.
 *  - Sub-shape B (2015/16 typed Siebel export; callsign column kind 'verbatim'):
 *    the raw Value cell is a full call sign carried VERBATIM as the subject; the
 *    raw Product cell rides as licence_class and the raw Reference cell as
 *    suffix. Status/Type/Allocated Flag are sheet-level constants (the
 *    availability is the sheet's assertion, not a per-row Status) and are not
 *    carried - carrying a per-row Status='Available' would misstate the model.
 *
 * The family uses a UNIFIED role vocabulary for its attribute predicates
 * (licence_class, suffix, prefix) rather than each sub-shape's own raw header,
 * because the two sub-shapes disclose the same facts under different raw shapes
 * (a header label vs a typed 'Product'/'Reference' column). The attribute VALUES
 * still travel verbatim - only the predicate label is the role name.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The dataset class marking an available-pool disclosure. Selected by class
// (not a hard-coded entry list) so a newly-classed disclosure is covered
// automatically, exactly as the register/addendum families select.
export const AVAILABLE_POOL_CLASS = 'available-pool';

// The normalised output names this family reads from the authored binding.
const CALLSIGN_OUTPUT = 'callsign';
const LICENCE_CLASS_OUTPUT = 'licence_class';
const SUFFIX_OUTPUT = 'suffix';

// The role-vocabulary attribute/subject columns the loaders emit under (see the
// module header: unified across both sub-shapes, values verbatim).
const SUFFIX_COLUMN = 'suffix';
const LICENCE_CLASS_COLUMN = 'licence_class';
const PREFIX_COLUMN = 'prefix';
const CALLSIGN_COLUMN = 'callsign';

export interface AvailablePoolEntry {
  entry: string;
  meta: FoiEntryMeta;
}

// The available-pool entries: 'available-pool' present in datasetClasses.
// Sorted for a stable, reproducible corpus order (listFoiEntryKeys is sorted).
export function availablePoolEntries(foiDir: string = defaultFoiDir()): AvailablePoolEntry[] {
  const entries: AvailablePoolEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!meta.datasetClasses.includes(AVAILABLE_POOL_CLASS)) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// The two source sub-shapes, discriminated by the authored callsign column's
// kind (see the module header). 'suffix' is the 2013/14 suffix-shaped list;
// 'typed' is the 2015/16 typed Siebel export.
export type AvailablePoolSubShape = 'suffix' | 'typed';

export function subShapeOf(conversion: FoiSourceConversion): AvailablePoolSubShape {
  const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
  if (callsignSpec === undefined) {
    throw new Error(`${conversion.sourceFile}: an available-pool conversion must map a callsign column`);
  }
  return callsignSpec.kind === 'prefixed' ? 'suffix' : 'typed';
}

// Parse the raw bytes into rows of cells (position-preserving), honouring an
// authored preamble the same way the FOI converter's explicit-header path does:
// the preamble rows are matched cell-for-cell (a changed preamble is a changed
// assertion, never skipped blindly), the next row is the header, and the rest
// are data. Returns the header and the data rows.
function parseRawRows(filePath: string, conversion: FoiSourceConversion): { header: string[]; dataRows: string[][] } {
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const rows = parse(text, { columns: false, skip_empty_lines: true, bom: true, relax_column_count: true }) as string[][];
  const preamble = conversion.preamble ?? [];
  for (let i = 0; i < preamble.length; i++) {
    const expected = preamble[i];
    const actual = rows[i];
    if (actual === undefined || actual.length !== expected.length || expected.some((cell, j) => actual[j] !== cell)) {
      throw new Error(`${filePath}: preamble row ${i + 1} mismatch - expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? null)}`);
    }
  }
  const header = rows[preamble.length];
  if (header === undefined) {
    throw new Error(`${filePath}: no header row after the preamble`);
  }
  return { header, dataRows: rows.slice(preamble.length + 1) };
}

// The raw column header the given output reads from, from the authored binding;
// throws when the binding does not map it (so a re-shaped source fails loud).
function requiredSourceHeader(conversion: FoiSourceConversion, output: string): string {
  const spec = conversion.columns.find(column => column.output === output && column.source !== null);
  if (spec === undefined || spec.source === null) {
    throw new Error(`${conversion.sourceFile}: authored binding maps no raw header to "${output}"`);
  }
  return spec.source;
}

// Sub-shape A loader: the bare suffix as the verbatim subject, plus the sheet's
// stated class and prefix (authored constants matched cell-for-cell to the
// sheet's own rule) as attributes. The suffix travels as the subject token on
// every emitted claim; licence_class and prefix ride as raw attribute claims.
export function loadSuffixListSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const { header, dataRows } = parseRawRows(filePath, conversion);

  const suffixHeader = requiredSourceHeader(conversion, SUFFIX_OUTPUT);
  const suffixIndex = header.indexOf(suffixHeader);
  if (suffixIndex === -1) {
    throw new Error(`${filePath}: authored suffix column "${suffixHeader}" absent from raw header (${header.join(', ')})`);
  }

  const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
  const prefix = callsignSpec?.prefix ?? '';
  const classSpec = conversion.columns.find(column => column.output === LICENCE_CLASS_OUTPUT);
  const licenceClass = classSpec?.constant ?? '';
  if (prefix === '' || licenceClass === '') {
    throw new Error(`${filePath}: suffix-shaped conversion must state a prefix and a licence class`);
  }

  const rows = dataRows.map(cells => ({
    [SUFFIX_COLUMN]: cells[suffixIndex] ?? '',
    [LICENCE_CLASS_COLUMN]: licenceClass,
    [PREFIX_COLUMN]: prefix,
  }));
  if (rows.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - an available-pool source must not be empty`);
  }
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns: [SUFFIX_COLUMN, LICENCE_CLASS_COLUMN, PREFIX_COLUMN],
    subjectColumn: SUFFIX_COLUMN,
    rows,
  };
}

// Sub-shape B loader: the full call sign (raw Value) as the verbatim subject,
// with the raw Product carried as licence_class and the raw Reference as suffix.
// The other columns (Country/Current Series/Type/Status/Allocated Flag) are
// sheet-level constants required-present but deliberately not carried.
export function loadTypedExportSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const raw = parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  if (raw.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - an available-pool source must not be empty`);
  }
  const rawHeaders = Object.keys(raw[0]);

  const callsignHeader = requiredSourceHeader(conversion, CALLSIGN_OUTPUT);
  const productHeader = requiredSourceHeader(conversion, LICENCE_CLASS_OUTPUT);
  const suffixHeader = requiredSourceHeader(conversion, SUFFIX_OUTPUT);
  for (const wanted of [callsignHeader, productHeader, suffixHeader]) {
    if (!rawHeaders.includes(wanted)) {
      throw new Error(`${filePath}: authored column "${wanted}" absent from raw header (${rawHeaders.join(', ')})`);
    }
  }

  const rows = raw.map(record => ({
    [CALLSIGN_COLUMN]: record[callsignHeader] ?? '',
    [LICENCE_CLASS_COLUMN]: record[productHeader] ?? '',
    [SUFFIX_COLUMN]: record[suffixHeader] ?? '',
  }));
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns: [CALLSIGN_COLUMN, LICENCE_CLASS_COLUMN, SUFFIX_COLUMN],
    subjectColumn: CALLSIGN_COLUMN,
    rows,
  };
}

function loadAvailablePoolSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  return subShapeOf(conversion) === 'suffix'
    ? loadSuffixListSource(foiDir, entry, meta, conversion)
    : loadTypedExportSource(foiDir, entry, meta, conversion);
}

// The available-pool family: every available-pool FOI entry's per-sheet
// sources, each resolved to a loader over the entry's RAW bytes. The sheets are
// read from the authored converter binding, so which raw file and which columns
// are never re-guessed here.
export function collectAvailablePoolSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of availablePoolEntries(foiDir)) {
    const variant = meta.converter?.variant;
    if (variant === undefined || variant === null) continue;
    const conversions = FOI_ENTRY_CONVERSIONS[variant];
    if (conversions === undefined) continue;
    for (const conversion of conversions) {
      resolved.push({
        family: 'available-pool',
        subjectKind: 'pool-slot',
        entry,
        jsonlStem: jsonlStem('available', entry, conversion.sourceFile),
        load: () => loadAvailablePoolSource(foiDir, entry, meta, conversion),
      });
    }
  }
  return resolved;
}

export const availablePoolCollector: LedgerCollector = {
  family: 'available-pool',
  subjectKind: 'pool-slot',
  collect: roots => collectAvailablePoolSources(roots.foiDir),
};
