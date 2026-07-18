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
 * LOSSLESS-CANONICAL (issue #813 Stage A). The family emits the
 * STRUCTURE-PRESERVING observation set (loadFoiVerbatimCsvSource): the source's
 * VERBATIM header set in source order, every physical column's cell verbatim
 * under its own header, per-row source lines, and any authored pre-header
 * preamble rows as positioned @ignored furniture. So the main ledger is
 * canonical for these sources - the reconstruction oracle
 * (src/ci/reconstruction-oracle.ts) rebuilds each raw file from the registered
 * claims, and the parallel foi-verbatim-csv mirror no longer covers them. The
 * ONE reprojection on top of the faithful mirror is the SUBJECT column: it is
 * the authored callsign/suffix column (sub-shape A's suffix cell, sub-shape B's
 * raw Value cell), not blindly the first physical column, so the raw subject
 * token every claim carries - the token the value catalogue's `Available`
 * membership bucket counts distinct cleaned keys over - is exactly the token
 * the disclosure lists as available.
 *
 * The ROLE VOCABULARY the family previously reprojected (suffix /
 * licence_class / prefix predicates, synthesising sub-shape A's sheet-level
 * constants onto every row) is DEFERRED derived-fold work (issue #813, Stage
 * D): Stage A emits no analytical claims. Nothing is dropped - the lossless
 * structure still carries every cell the roles derive from (sub-shape B's
 * Product/Reference columns verbatim; sub-shape A's class and prefix as the
 * sheet's own header/preamble text in the file-level manifest) - but the
 * role-named reading of those cells will be re-expressed as a fold over these
 * raw claims, not re-ingested beside them.
 *
 * TWO sub-shapes, discriminated by the authored callsign column's kind:
 *  - Sub-shape A (2013/14, suffix-shaped; callsign column kind 'prefixed'): a
 *    single-column sheet whose header is the sheet's own stated rule
 *    ('Foundation = M6aaa', or a 'Prefix = M6' preamble above a 'Suffix'
 *    header). The raw cell is a bare three-letter suffix, carried VERBATIM as
 *    the subject; the M6xxx call sign is NOT synthesised here.
 *  - Sub-shape B (2015/16 typed Siebel export; callsign column kind 'verbatim'):
 *    the raw Value cell is a full call sign carried VERBATIM as the subject; the
 *    other columns (Country / Current Series / Reference / Type / Product /
 *    Status / Allocated Flag, plus the 2016 export's two empty application-#
 *    columns) ride verbatim under their own headers. The sheet-level Status
 *    column reads 'Available' on every row: it is stored verbatim as what the
 *    export said, while the value catalogue continues to model availability as
 *    FAMILY MEMBERSHIP (these sources are scoped out of the attested-status
 *    fold by field-source-roles.ts), so the sheet's own framing never
 *    masquerades as a register status.
 */

import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import { loadFoiVerbatimCsvSource } from './foi-verbatim-csv.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem, AVAILABLE_POOL_CLASS } from './util.ts';

// Re-exported from util.ts (see the note there): the class string lives in the
// neutral module so the foi-verbatim-csv mirror can scope on it without a cycle.
export { AVAILABLE_POOL_CLASS };

// The normalised output name whose authored binding names the subject column.
const CALLSIGN_OUTPUT = 'callsign';

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

// The raw column header the authored binding reads the callsign/suffix from -
// the subject column of the lossless observation set. Throws when the binding
// maps no raw header to it (so a re-shaped source fails loud).
function subjectHeaderOf(conversion: FoiSourceConversion): string {
  const spec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT && column.source !== null);
  if (spec === undefined || spec.source === null) {
    throw new Error(`${conversion.sourceFile}: authored binding maps no raw header to "${CALLSIGN_OUTPUT}"`);
  }
  return spec.source;
}

// Load one available-pool source as its lossless structure-preserving mirror
// (verbatim headers, physical columns, positioned preamble furniture), with the
// SUBJECT re-pointed at the authored callsign/suffix column so the raw subject
// token is the listed-as-available token, exactly as this family has always
// keyed it. For sub-shape A the authored column IS the single physical column;
// for sub-shape B it is the raw Value column (not the first physical column,
// Country). Either way the header must be present in the parsed source, or the
// shape has changed and the load fails loud.
export function loadAvailablePoolSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const mirror = loadFoiVerbatimCsvSource(foiDir, entry, meta, conversion);
  const subjectColumn = subjectHeaderOf(conversion);
  if (!mirror.columns.includes(subjectColumn)) {
    throw new Error(`${mirror.sourceFile}: authored subject column "${subjectColumn}" absent from raw header (${mirror.columns.join(', ')})`);
  }
  return { ...mirror, subjectColumn };
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
