/**
 * The forbidden-list family: the three-letter suffixes Ofcom withholds from
 * issue (archive/foi/**). A forbidden list is a DIFFERENT row shape from a
 * register snapshot by design - suffixes, not callsigns - so its subjectKind is
 * 'suffix' and it rides the subject-agnostic raw emit path (emitClaims) only:
 * a suffix is never mis-normalised AS a callsign, and no normalises_to edge or
 * licence_category tier attaches to it.
 *
 * Two source situations, both keyed off the AUTHORED converter binding
 * (FOI_ENTRY_CONVERSIONS, foi-normalise.ts), never re-guessed:
 *   - the standalone disclosure ofcom-2024-12--forbidden-suffixes, whose CSV
 *     carries a 'Name' suffix column AND a 'LastModifiedDate' column - the only
 *     forbidden list any disclosure supplies with per-suffix dated provenance;
 *   - the forbidden sheets riding INSIDE register entries (ofcom-756622,
 *     wdtk-356636, wdtk-596532), each a single suffix column ('NAME'/'Value').
 *     These entries are register-and-forbidden containers: the register family
 *     folds their callsign sheet, this family folds their suffix sheet, so the
 *     two selections are disjoint by conversion, not by entry.
 *
 * The polarity ("these suffixes are forbidden") is carried by the 'forbidden-list'
 * family tag plus each source's provenance (sourceFile + vintage), NOT by a
 * per-row predicate - the raw @listed existence claim means only "this suffix is
 * present in this forbidden disclosure at this vintage", which keeps the raw
 * layer honest. The ever-forbidden UNION, the cross-disclosure diff and the
 * first-known-forbidden derivations are fold-layer work over these per-(suffix,
 * vintage) claims (their reference is src/ci/forbidden-suffix-history.ts), NOT
 * baked into the emit path.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The dataset class marking an entry that carries a forbidden-suffix list. An
// entry declares it whether the list stands alone or rides inside a
// register-and-forbidden container, so it is the entry-level filter for this
// family. A byte-identical as-published duplicate with no authored converter
// binding (converter null) declares the class too but resolves no suffix
// source, and drops out at forbiddenSourcesFor rather than being counted twice.
const FORBIDDEN_LIST_CLASS = 'forbidden-list';

// The normalised output column whose raw source header names the suffix token
// this family keys the ledger off. Its presence (mapped verbatim) is exactly
// what distinguishes a forbidden-suffix sheet from the callsign register sheet
// sharing the same entry.
const SUFFIX_OUTPUT = 'suffix';

export interface ForbiddenEntry {
  entry: string;
  meta: FoiEntryMeta;
}

// The forbidden-list entries: 'forbidden-list' present in datasetClasses.
// Sorted for a stable, reproducible corpus order (listFoiEntryKeys is sorted).
export function forbiddenListEntries(foiDir: string = defaultFoiDir()): ForbiddenEntry[] {
  const entries: ForbiddenEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!meta.datasetClasses.includes(FORBIDDEN_LIST_CLASS)) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// One raw source that carries forbidden-suffix rows, with the raw header that
// names its suffix token and the authored source headers carried into the raw
// layer. Sourced from the converter binding so the raw-file and suffix-column
// choices are never re-guessed here.
export interface ForbiddenSource {
  conversion: FoiSourceConversion;
  suffixColumn: string;
  // The authored source headers projected into the observation set, read from
  // the conversion's column list (only columns the binding actually reads from
  // the source, i.e. source !== null). Reading the columns from the binding
  // rather than every raw header means sheet-level furniture the binding
  // ignored - the constant 'Type' = Forbidden discriminator on wdtk-356636's
  // sheet, recorded once in meta.json, not a per-row assertion - never becomes a
  // bogus attribute claim, while a genuine data column (2024-12's
  // LastModifiedDate) still rides.
  columns: string[];
}

// The forbidden-suffix sources for one entry: each conversion that maps a raw
// header VERBATIM to the suffix output and is parsed as CSV. A register-and-
// forbidden entry's callsign sheet maps 'callsign', not 'suffix', so it drops
// out here (it is the register family's), leaving only the forbidden sheet. The
// markdown-table / preamble shapes are skipped for symmetry with the register
// loader, though no forbidden sheet uses them.
export function forbiddenSourcesFor(meta: FoiEntryMeta): ForbiddenSource[] {
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];

  const sources: ForbiddenSource[] = [];
  for (const conversion of conversions) {
    if (conversion.format === 'markdown-table' || conversion.preamble !== undefined) continue;
    const suffixSpec = conversion.columns.find(column => column.output === SUFFIX_OUTPUT);
    if (suffixSpec === undefined || suffixSpec.source === null || suffixSpec.kind !== 'verbatim') continue;
    const columns = conversion.columns
      .filter(column => column.source !== null)
      .map(column => column.source as string);
    sources.push({ conversion, suffixColumn: suffixSpec.source, columns });
  }
  return sources;
}

// Parse one forbidden-suffix source file into the SourceObservationSet shape,
// verbatim under Ofcom's own headers. The parse options mirror the FOI
// converter's (skip_empty_lines + BOM) and honour the conversion's authored
// encoding (the ofcom-756622 sheet is latin-1), so the suffix tokens this keys
// off are the same rows the committed normalisation was derived from and travel
// verbatim (whitespace/case intact). Duplicate rows are preserved as distinct
// observations by the emit path's ordinal - a data-quality artefact surfaced,
// never deduped (the 2016 sheet lists ZIT twice). The stored sourceFile is
// corpus-unique (foi/<entry>/<file>) so an observation's provenance is
// self-locating.
export function loadForbiddenSource(foiDir: string, entry: string, meta: FoiEntryMeta, source: ForbiddenSource): SourceObservationSet {
  const { conversion, suffixColumn, columns } = source;
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  if (rows.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - a forbidden-suffix source must not be empty`);
  }
  const rawHeaders = Object.keys(rows[0]);
  for (const column of columns) {
    if (!rawHeaders.includes(column)) {
      throw new Error(`${filePath}: authored column "${column}" absent from raw headers (${rawHeaders.join(', ')})`);
    }
  }
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    subjectColumn: suffixColumn,
    rows,
    // No product column: a suffix carries no licence class, so no
    // licence-category tier is derivable (and, being subjectKind 'suffix', the
    // emit path would not derive one regardless).
  };
}

// The forbidden-list family: every forbidden-list FOI entry's suffix-bearing
// verbatim CSV source, each resolved to a loader over the entry's RAW bytes.
// Discovered from the archive's datasetClasses, not a hard-coded list, so a
// newly-classed forbidden disclosure is covered automatically.
export function collectForbiddenListSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of forbiddenListEntries(foiDir)) {
    for (const source of forbiddenSourcesFor(meta)) {
      resolved.push({
        family: 'forbidden-list',
        subjectKind: 'suffix',
        entry,
        jsonlStem: jsonlStem('forbidden', entry, source.conversion.sourceFile),
        load: () => loadForbiddenSource(foiDir, entry, meta, source),
      });
    }
  }
  return resolved;
}

export const forbiddenListCollector: LedgerCollector = {
  family: 'forbidden-list',
  subjectKind: 'suffix',
  collect: roots => collectForbiddenListSources(roots.foiDir),
};
