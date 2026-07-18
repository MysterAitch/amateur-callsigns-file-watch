/**
 * v2 claim ledger CORE — the typed model plus the shared vocabulary every tier
 * folds over (issue #361).
 *
 * The inversion: today snapshots are canonical and temporal reasoning is bolted
 * on; here the atom is a CLAIM and every published table becomes a fold over a
 * ledger of claims. This module supplies the STABLE core: the claim/provenance
 * TYPES, the cross-tier predicate/rule vocabulary, and the confidence readout.
 * The per-tier emit steps (raw / normalisation edges / licence-category /
 * callsign-pattern / stripped-collision / parse-attribute) live in companion
 * emit modules that depend on this core; the emitLedger orchestrator composes
 * them; claim.ts re-exports the whole family so the public import surface stays
 * one module. project-normalised.ts supplies the inverse fold; serialise.ts the
 * canonical (JSONL) and derived (N-Quads) serialisations.
 *
 * Three load-bearing decisions, each forced into the open by the round-trip POC
 * on the real corpus (see rebuild design notes / issue #361):
 *
 *  - The canonical unit is an OBSERVATION: one row of one published source,
 *    keyed by (source_file, ordinal). Recurring subjects are real — a single
 *    snapshot lists G0TQK twice — so keying by subject would silently MERGE two
 *    distinct rows and hide a genuine finding. Observation identity keeps them
 *    apart. Source ORDER is a stored fact (the ordinal), not a guessed sort,
 *    because some sources are event lists in source order, not callsign-sorted.
 *
 *  - Each observation carries the RAW subject token VERBATIM. Normalised values
 *    genuinely collide across distinct raw tokens (G0TQK and "G0TQK<NBSP>" both
 *    clean to G0TQK), so the raw token — not the cleaned entity — is what the
 *    ledger stores. The cleaned entity is DERIVED.
 *
 *  - Normalisation is a FIRST-CLASS, rule-attributed edge, never a silent
 *    transform: raw_token --normalises_to--> entity, tagged with the NAMED rule
 *    that produced it (transparency-and-traceability priority zero). The rules
 *    are LIFTED from src/sources/ofcom-amateur/components.ts (cleanedCallsign,
 *    parseCallsign's placeholderForm), never re-derived by eyeball.
 */

import { COLUMN_INTERPRETATION_RULE, type ColumnInterpretation } from './interpretation.ts';
import { LICENCE_CATEGORY_RULE } from './licence-category-emit.ts';
import { AUTHORED_EVENT_RULE } from './issuance-event-emit.ts';

// A claim is either a verbatim source assertion ('raw') or one computed by a
// named rule ('derived'). The layer flag lets a consumer trust raw claims as
// source-of-record and treat derived claims as reproducible opinions.
export type ClaimLayer = 'raw' | 'derived';

// The three normalisation forms of a callsign, in order of derivation:
//   raw (verbatim token) -> cleaned (cleanedCallsign) -> placeholder (RSL-less
//   canonical key). Each edge names the rule that produced it.
export type NormalisationForm = 'cleaned' | 'placeholder';

// The SOURCE-INTRINSIC location of an observation within its original (issue
// #431, ADR 0015). Every field names a coordinate the SOURCE itself defines - a
// physical line, a spreadsheet cell - never one our filesystem produced, so it
// carries no timestamp and can never be confused with a processing artefact.
// `kind` picks the coordinate family; optional so pre-position ledgers still
// parse. Phase P1 builds the `csv-line` arm; the later arms are RESERVED in the
// type so adding them (P2 xlsx, and later PDF/image) is a union arm plus a
// loader, not a model change.
export type SourcePosition =
  // A 1-based physical line in a text CSV source (open-data raw.csv, an FOI
  // raw-extract CSV). Built now (P1).
  | { kind: 'csv-line'; line: number }
  // RESERVED - P2. A 1-based spreadsheet cell in a binary workbook: the sheet
  // number + title, the row and column, and the A1 column letter. The honest
  // source coordinate for an xlsx observation (its viewAnchor points instead at
  // the committed text extract - see ViewAnchor).
  | { kind: 'sheet-cell'; sheet: number; sheetName: string; row: number; column: number; columnRef: string }
  // RESERVED - later. A markdown-table source: the physical line plus the
  // logical table-row index. No such family folds into the register ledger yet.
  | { kind: 'markdown-row'; line: number; tableRow: number }
  // RESERVED - later. No PDF-transcription or image source is ingested today.
  | { kind: 'pdf'; page: number; x: number; y: number }
  | { kind: 'image'; x: number; y: number; w: number; h: number };

// The line-viewable anchor a source deep-link points at (issue #431 §4.5). For a
// TEXT source this is the source file itself; for a BINARY xlsx it is the
// committed text EXTRACT whose line corresponds to the attested sheet-cell (the
// .xlsx is not line-viewable on GitHub). `repoPath` is REPO-RELATIVE (e.g.
// 'archive/foi/<entry>/raw.csv'), which is deliberately NOT the same as
// Provenance.sourceFile - a logical key that drops the 'archive/' prefix (and,
// for the open-data lane, rewrites it to 'opendata/'). The anchor carries the
// REAL repo path so a permalink is buildable (the permalink itself is composed
// on read in P4, never stored).
export interface ViewAnchor {
  repoPath: string;
  line: number;
  endLine?: number;
}

// Where a claim came from: the observation that carries it. (source_file,
// ordinal) is the observation key; vintage is the as-of knowledge time.
// `position`/`viewAnchor` ENRICH the key with the observation's precise source
// location (issue #431) - they are additive (absent on legacy ledgers) and are
// NOT per-observation claims: position is a finer statement of the SAME key, not
// an assertion about the callsign, so it never enters the claim multiset and the
// #404 no-inflation invariant is untouched.
export interface Provenance {
  sourceFile: string;
  ordinal: number;
  vintage: string;
  position?: SourcePosition;
  viewAnchor?: ViewAnchor;
}

// One row of one published source. Identity is (sourceFile, ordinal); the raw
// subject token is carried verbatim (whitespace, case and encoding artefacts
// preserved — they are the raw distinction the cleaned entity discards).
export interface Observation {
  sourceFile: string;
  ordinal: number;
  vintage: string;
  rawSubject: string;
}

// One atomic assertion tied to an observation. `predicate`/`object` carry the
// attribute; `rawSubject` carries the observation's raw subject token so a
// claim is self-describing without a separate observation lookup. Derived
// claims name the `rule` that produced them.
export interface Claim {
  layer: ClaimLayer;
  rawSubject: string;
  predicate: string;
  object: string;
  provenance: Provenance;
  rule?: string;
}

// A rule-attributed normalisation edge: the raw token resolves to an entity by
// a named rule. Serialised as a derived claim, but modelled distinctly because
// it is the JOIN edge every entity-level view folds over.
export interface NormalisationEdge {
  rawToken: string;
  entity: string;
  form: NormalisationForm;
  rule: string;
  provenance: Provenance;
}

// The shared data-quality flag predicate: its OBJECT is the flag name, so a
// report folds "callsigns carrying flag X" by object rather than by a per-flag
// predicate. It is core vocabulary because more than one derived tier raises
// flags through it - the per-token parse-attribute tier (parse-attribute-emit.ts)
// and the whole-source stripped-collision tier (stripped-collision-emit.ts).
export const FLAG_PREDICATE = 'flag';

// The five claim-confidence rungs, best-to-worst, fixed by site/glossary.html
// (the #axes panel). Confidence is a READOUT of source authority × how the
// value was produced, never stored on the claim: it is derived from the claim's
// layer and rule so it cannot drift from what the claim actually is.
export type ClaimConfidence = 'As-published' | 'Computed' | 'Looked-up' | 'Community' | 'Best-guess';

export const CONFIDENCE_ORDER: readonly ClaimConfidence[] = [
  'As-published',
  'Computed',
  'Looked-up',
  'Community',
  'Best-guess',
];

// The named rules that resolve a value from an authored registry/reference table
// (a LOOKUP, the 'Looked-up' rung); every other named derived rule is a
// deterministic COMPUTATION (the 'Computed' rung). The licence-category tier
// resolves via reference-data/licence-category.csv (normaliseLicenceCategory);
// the column-interpretation tier (issue #435) resolves each column's {type,
// format} from our authored column spec (DATE_COLUMNS/VARIANTS, FoiColumnSpec) -
// asserted, not inferred from the data, so it too reads out Looked-up. The
// authored-event tier (issue #813 Stage C2) resolves each issuance row's event
// word from the authored converter binding (FOI_ENTRY_CONVERSIONS), itself pinned
// from the disclosure's covering-letter wording - again asserted, not computed,
// so it reads out Looked-up. The rule names are IMPORTED from the tiers that own
// them so the enumeration stays a single source of truth (a tier renaming its
// rule cannot silently fall out of the lookup set).
const LOOKUP_RULES: ReadonlySet<string> = new Set<string>([LICENCE_CATEGORY_RULE, COLUMN_INTERPRETATION_RULE, AUTHORED_EVENT_RULE]);

// The confidence readout for a claim, from its layer and rule alone:
//   - raw            -> As-published (the verbatim source token, untouched)
//   - derived+lookup  -> Looked-up   (resolved via a reference table)
//   - derived+other   -> Computed    (deterministically derived by a named rule)
// A derived claim NEVER reads out As-published — derivation degrades confidence
// by construction, which is the invariant the trust net enforces. Malformed
// claims (raw carrying a rule, derived missing one) are NOT masked here: this is
// a pure best-effort readout; the structural checks in src/ci/trust-rating.ts
// catch such claims loudly.
export function claimConfidence(claim: Claim): ClaimConfidence {
  if (claim.layer === 'raw') return 'As-published';
  if (claim.rule !== undefined && LOOKUP_RULES.has(claim.rule)) return 'Looked-up';
  return 'Computed';
}

// A parsed set of rows from ONE published source (a normalised.csv OR a
// raw-extract CSV — the emit step is identical, only the subject column name
// differs). Rows are records keyed by column name (csv-parse `columns: true`);
// `columns` preserves header order for faithful reprojection.
export interface SourceObservationSet {
  sourceFile: string;
  vintage: string;
  columns: readonly string[];
  subjectColumn: string;
  rows: readonly Record<string, string>[];
  // The raw header carrying the licence product/class token, when the source
  // declares one. Named so the derived licence-category tier can read the
  // product cell under Ofcom's OWN header (which varies by vintage: 'Product',
  // 'Licence Class', 'SF List', ...); absent when the source discloses no
  // product column, in which case no category claim is derivable.
  categoryColumn?: string;
  // The raw header carrying the call sign's ORIGINAL start (issue) date, when
  // the source declares one, read under Ofcom's OWN header (which varies by
  // vintage: 'Original Start Date', 'Licence_Version.Original_start_date__c',
  // ...). It feeds parseCallsign's temporal
  // `forbidden-suffix-issued-after-first-known-list` flag; absent when the
  // source discloses no such date (the reduced Value/Status/Type snapshots), in
  // which case that flag is honestly never derivable for the source. The RAW
  // cell travels verbatim to the parser, which interprets its known rendering -
  // ISO or the open-data day-first DD/MM/YYYY - for the comparison, and still
  // withholds the flag on a blank or genuinely unparseable date rather than
  // guessing, the conservative silence isAfterFirstKnownForbidden documents.
  originalStartDateColumn?: string;
  // The 1-based physical source line of each row, parallel to `rows` by index
  // (issue #431, P1). Supplied by a CSV-lane loader that captures the line while
  // parsing (open-data via the line-accounting model, FOI via csv-parse's
  // `info`); absent for a source whose loader does not yet attest position, in
  // which case the emit path attaches no position. When present it must be the
  // same length as `rows`.
  lineNumbers?: readonly number[];
  // The REPO-RELATIVE path of the source file (e.g. 'archive/foi/<entry>/<file>'
  // or 'archive/<date>/raw.csv'), the true on-disk path the logical `sourceFile`
  // key abstracts away. Carried so the observation's viewAnchor can point a
  // deep-link at the real file (issue #431 §4.5); absent when the loader supplies
  // no line numbers, since there is then no line-viewable anchor to build.
  repoPath?: string;
  // The curated + enumerated non-data lines the loader stripped before parsing
  // (export footer furniture, interior blank lines), each carried verbatim by
  // its 1-based physical line (issue #434). The file-manifest emit attests these
  // as @ignored file-level claims so a reconstruction can reinstate them
  // positionally; absent/empty for a source that carries no such furniture.
  ignoredLines?: readonly { line: number; content: string }[];
  // The 1-based physical line the verbatim header row occupies (issue #434), so
  // the file-manifest @column/@subject claims can attest the header's source
  // position; absent when the loader does not attest a line for the header.
  headerLine?: number;
  // The text encoding the loader decoded the raw bytes with (issue #434, G6). A
  // fidelity oracle re-reads the ORIGINAL raw file with this encoding so the
  // round-trip compares at DECODED-TEXT level (the encoding itself is not
  // attested as a claim in this phase); absent means the raw bytes are utf-8.
  encoding?: BufferEncoding;
  // The authored per-source EVENT vocabulary (issue #813 Stage C2), when the
  // source is an issuance-events disclosure: the word the converter binding pins
  // from the disclosure's own covering-letter framing ('reissued' /
  // 'reciprocal-licence-issued' / 'reallocated'). An authored word is not a
  // published byte, so it NEVER rides the raw layer: the emit path derives one
  // claim per row under AUTHORED_EVENT_RULE (issuance-event-emit.ts, reading out
  // Looked-up). Absent for every family that pins no event vocabulary.
  authoredEvent?: string;
  // The authored per-column INTERPRETATION (issue #435), parallel to `columns`
  // by index: each column's inferred {type, format} we read it under. Populated
  // by the loader lane that owns the spec (interpretOpenDataColumns for the
  // open-data lane, interpretFoiColumns for the FOI lane) so interpretColumns
  // reads a stored authored fact rather than re-deriving one; absent for a family
  // that attests no interpretation, in which case emitInterpretationClaims emits
  // nothing. When present it must be the same length as `columns`.
  columnInterpretations?: readonly ColumnInterpretation[];
}
