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
 *
 * LOSSLESS-CANONICAL (issue #813 Stage D). The family emits the
 * STRUCTURE-PRESERVING observation set (loadFoiVerbatimCsvSource): the source's
 * VERBATIM header set, every physical column's cell verbatim under its own
 * header, per-row source lines, and repoPath/encoding - so the reconstruction
 * oracle rebuilds each forbidden sheet from the registered claims, exactly as
 * every other registered family. That carries wdtk-356636 sheet 2's constant
 * 'Type' = 'Forbidden' column as raw claims: those cells ARE published bytes
 * (the converter's ignoredColumns entry verifies the constant, it does not
 * un-publish it), and without them the sheet cannot round-trip. The polarity
 * modelling above is unchanged - the forbidden-suffix-history fold reads the
 * @listed anchors plus the binding's authored last-modified column only, so a
 * carried Type cell never masquerades as dated provenance.
 */

import { type SourceObservationSet } from '../claim.ts';
import { parseUkDateTime } from '../../shared/normalise.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import { loadFoiVerbatimCsvSource } from './foi-verbatim-csv.ts';
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

// The normalised output column whose raw source header carries per-suffix dated
// provenance (only the 2024-12 export declares one). The history fold reads the
// date under this authored header by NAME (see ForbiddenSource).
const LAST_MODIFIED_OUTPUT = 'last_modified_date';

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
// names its suffix token and - where the binding declares one - the raw header
// carrying per-suffix dated provenance. Sourced from the converter binding so
// the raw-file, suffix-column and last-modified-column choices are never
// re-guessed here.
export interface ForbiddenSource {
  conversion: FoiSourceConversion;
  suffixColumn: string;
  // The raw header the binding maps to the last_modified_date output (the
  // 2024-12 export's 'LastModifiedDate'), or null when the disclosure carries
  // no dated provenance. The forbidden-suffix-history fold joins @listed to
  // THIS predicate by name (issue #813 Stage D) - never to "whatever raw
  // attribute is present", which would mistake a carried constant column (the
  // wdtk-356636 sheet's 'Type' = 'Forbidden') for a date.
  lastModifiedColumn: string | null;
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
    const lastModifiedSpec = conversion.columns.find(column => column.output === LAST_MODIFIED_OUTPUT);
    sources.push({ conversion, suffixColumn: suffixSpec.source, lastModifiedColumn: lastModifiedSpec?.source ?? null });
  }
  return sources;
}

// Whether a raw cell parses as a UK day-first date under the SAME rule the
// forbidden-suffix-history fold applies (parseUkDateTime, shared/normalise.ts) -
// never a second, drifting copy. A blank cell parses to '' (the raw legitimately
// carries empty date cells) and so is NOT counted as a date; a non-date value
// throws and is likewise not a date. Used only to attest the shape of the
// authored last-modified column, so the fold's own parse stays the sole
// authority on the value.
function looksLikeUkDate(value: string): boolean {
  try {
    return parseUkDateTime(value) !== '';
  } catch {
    return false;
  }
}

// Fail loud when the authored last-modified column NAMES a real header that does
// not actually carry dates (issue #844). The absent-name case already throws
// (the caller's guard); this closes the present-but-WRONG-column gap: a name
// that is a real header yet the wrong column - the carried constant 'Type' =
// 'Forbidden', a text column, or a genuinely date-free column - would join
// cleanly in the fold and silently null every date (blank cells parse to '') or
// mis-read it, caught only by the committed golden. Requiring at least one value
// that parses as a UK date proves the binding still points at a date column, and
// names the source and column on failure so a future drift is located, not
// silent. (A same-shaped WRONG date column - e.g. a created-date - still parses
// and remains the golden's job; this is the cheap shape backstop, not a
// correctness oracle.)
function assertLastModifiedColumnCarriesDates(mirror: SourceObservationSet, column: string): void {
  const values = mirror.rows.map(row => row[column] ?? '');
  if (values.some(looksLikeUkDate)) return;
  const nonBlank = [...new Set(values.filter(value => value.trim() !== ''))].slice(0, 5);
  const sample = nonBlank.length === 0 ? '(all cells blank)' : nonBlank.map(value => JSON.stringify(value)).join(', ');
  throw new Error(`${mirror.sourceFile}: authored last-modified column "${column}" carries non-date values (${sample}) - expected day-first dd/mm/yyyy dates, so joining the forbidden-history dates on it would silently null every date`);
}

// Load one forbidden-suffix source as its lossless structure-preserving mirror
// (issue #813 Stage D): the source's verbatim header set, every physical
// column's cell verbatim under its own header (the wdtk-356636 sheet's constant
// 'Type' column included - a published byte), per-row source lines and
// repoPath/encoding for the reconstruction oracle, with the SUBJECT re-pointed
// at the authored suffix column (the available-pool precedent). The parse
// honours the conversion's authored encoding (the ofcom-756622 sheet is
// latin-1), so the suffix tokens this keys off are the same rows the committed
// normalisation was derived from and travel verbatim (whitespace/case intact).
// Duplicate rows are preserved as distinct observations by the emit path's
// ordinal - a data-quality artefact surfaced, never deduped (the 2016 sheet
// lists ZIT twice). The stored sourceFile is corpus-unique (foi/<entry>/<file>)
// so an observation's provenance is self-locating.
export function loadForbiddenSource(foiDir: string, entry: string, meta: FoiEntryMeta, source: ForbiddenSource): SourceObservationSet {
  const { conversion, suffixColumn } = source;
  const mirror = loadFoiVerbatimCsvSource(foiDir, entry, meta, conversion);
  if (!mirror.columns.includes(suffixColumn)) {
    throw new Error(`${mirror.sourceFile}: authored suffix column "${suffixColumn}" absent from raw header (${mirror.columns.join(', ')})`);
  }
  const lastModifiedColumn = source.lastModifiedColumn;
  if (lastModifiedColumn !== null) {
    if (!mirror.columns.includes(lastModifiedColumn)) {
      throw new Error(`${mirror.sourceFile}: authored last-modified column "${lastModifiedColumn}" absent from raw header (${mirror.columns.join(', ')})`);
    }
    assertLastModifiedColumnCarriesDates(mirror, lastModifiedColumn);
  }
  // No product column: a suffix carries no licence class, so no
  // licence-category tier is derivable (and, being subjectKind 'suffix', the
  // emit path would not derive one regardless).
  return { ...mirror, subjectColumn: suffixColumn };
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
        sourceFile: `foi/${entry}/${source.conversion.sourceFile}`,
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
