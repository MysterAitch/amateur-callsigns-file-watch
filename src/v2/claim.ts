/**
 * v2 claim ledger — the typed seed of the raw-keyed claim model (issue #361).
 *
 * The inversion: today snapshots are canonical and temporal reasoning is bolted
 * on; here the atom is a CLAIM and every published table becomes a fold over a
 * ledger of claims. This module supplies the typed model plus the emit step
 * (published-source rows -> claims). project-normalised.ts supplies the inverse
 * fold; serialise.ts the canonical (JSONL) and derived (N-Quads) serialisations.
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

import { cleanedCallsign, parseCallsign, normaliseLicenceCategory, NON_PLAIN_RE, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { callsignPattern } from '../shared/stats.ts';

// A claim is either a verbatim source assertion ('raw') or one computed by a
// named rule ('derived'). The layer flag lets a consumer trust raw claims as
// source-of-record and treat derived claims as reproducible opinions.
export type ClaimLayer = 'raw' | 'derived';

// The three normalisation forms of a callsign, in order of derivation:
//   raw (verbatim token) -> cleaned (cleanedCallsign) -> placeholder (RSL-less
//   canonical key). Each edge names the rule that produced it.
export type NormalisationForm = 'cleaned' | 'placeholder';

// Where a claim came from: the observation that carries it. (source_file,
// ordinal) is the observation key; vintage is the as-of knowledge time.
export interface Provenance {
  sourceFile: string;
  ordinal: number;
  vintage: string;
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

// The existence predicate. A single-column list (a bare membership roll) emits
// no attribute claims, so without an explicit existence assertion the subject
// would vanish from the ledger. Listing is itself a claim; it also anchors an
// all-blank row so the observation survives the round-trip.
export const LISTED_PREDICATE = '@listed';

// The normalisation-edge predicate.
export const NORMALISES_TO_PREDICATE = 'normalises_to';

// Named rules for the derived normalisation edges, matching the lifted logic in
// components.ts. Naming them (rather than describing them inline) keeps the
// derived claims auditable and the rule set enumerable.
export const CLEANED_CALLSIGN_RULE = 'cleaned-callsign';
export const PLACEHOLDER_FORM_RULE = 'placeholder-form';

// The derived licence-category predicate: the canonical category a raw product/
// licence_class value collapses to. It rides as an ADDITIONAL derived claim
// beside the verbatim raw product claim (both layers coexist, tiered), never
// replacing it - the same source-fidelity discipline the normalisation edges
// follow.
export const LICENCE_CATEGORY_PREDICATE = 'licence_category';

// The named rule for the derived licence-category claims. It attributes the
// derivation to reference-data/licence-category.csv via normaliseLicenceCategory
// (components.ts) - the ONE authoritative product->category map, LIFTED whole
// and never re-derived here, so the tier keeps the map's deliberate
// distinctions (Temporary Reciprocal vs Full Reciprocal, Club, Special Event)
// rather than inventing a vocabulary of its own.
export const LICENCE_CATEGORY_RULE = 'licence-category';

// The T1 PARSE-DERIVED attribute predicates (issue #406). Beside the verbatim
// raw layer, the ledger carries the per-callsign attributes parseCallsign
// COMPUTES from the raw token - its prefix series, implied station class, parse
// status, and each data-quality flag - so entity-level report fields can fold
// from the ledger (each later with its own equivalence oracle, like the
// licence-category tier). The parse output is CONSUMED here, never re-derived:
// the whole tier is a projection of parseCallsign (components.ts) into
// rule-attributed derived claims, so any change to what a callsign parses to is
// owned by components.ts alone.
//
//   - prefix_series : the join key into prefix-formats.csv ('M7', 'G0', '20',
//                     'GB'), emitted only when the parse resolved one.
//   - implied_class : the station level the prefix series implies ('Foundation',
//                     'Full', ...), emitted only when the series is known.
//   - parse_status  : the parser's synthesised determination of the token's
//                     callsign formation ('parsed' / 'visitor' / 'special-event'
//                     / 'unparseable'), present for every non-empty token.
//   - flag          : one claim per raised flag, the closed data-quality
//                     vocabulary (reference-data/flags.md); its OBJECT is the
//                     flag name, so a report folds "callsigns carrying flag X"
//                     by object rather than by a per-flag predicate.
//   - rsl           : the Regional Secondary Locator letter the parse split out
//                     of the token (the 'W' in MW7TEE, the country letter in a
//                     MW/-visitor call), emitted only where the parse resolved a
//                     non-empty one - an RSL-less core call (M7TEE) or a token
//                     that carries no RSL slot (GB special-event) yields none.
//                     Unblocks the regional-identifiers fold (#422).
export const PREFIX_SERIES_PREDICATE = 'prefix_series';
export const IMPLIED_CLASS_PREDICATE = 'implied_class';
export const PARSE_STATUS_PREDICATE = 'parse_status';
export const FLAG_PREDICATE = 'flag';
export const RSL_PREDICATE = 'rsl';

// The one named rule attributing every parse-derived claim to parseCallsign
// (components.ts). A SINGLE rule - not one per attribute - because one
// deterministic computation produces prefix series, implied class, parse status
// and flags together from the same parse; naming it keeps the tier's production
// method a COMPUTATION (never a reference-table lookup, so it reads out Computed,
// never As-published) and its rule set enumerable beside the normalisation and
// licence-category rules.
export const PARSE_CALLSIGN_RULE = 'parse-callsign';

// The DERIVED callsign-pattern predicate (issue #422): the character-shape
// taxonomy of a raw callsign token - uppercase->A, lowercase->a, digit->N, with
// whitespace/unprintable/invisible characters exploded to explicit {U+XXXX}
// markers. It rides beside the verbatim raw layer so the callsign-patterns fold
// (#361 Phase B) can aggregate shapes from the ledger, and it is computed from
// the RAW token (not the cleaned entity) precisely so the whitespace/encoding
// artefacts the taxonomy exists to surface stay visible.
export const CALLSIGN_PATTERN_PREDICATE = 'callsign-pattern';

// The named rule attributing every callsign-pattern claim to callsignPattern
// (src/shared/stats.ts), the ONE character-shape mapping the stats aggregate
// already applies to the callsign column. It is LIFTED whole and CONSUMED here,
// never re-derived, so the tier stays a projection of that function; naming it a
// COMPUTATION (not a reference-table lookup) keeps it reading out Computed.
export const CALLSIGN_PATTERN_RULE = 'callsign-pattern';

// The DERIVED stripped-collision flag object (issue #361, Phase B tail): a raw
// callsign token whose junk-stripped form (NON_PLAIN_RE removed) both DIFFERS
// from the verbatim token and coexists as its OWN distinct row in the SAME
// published source - a confirmed double-listing (the G0TQK trailing-NBSP twin).
// It rides the FLAG_PREDICATE like every other data-quality flag, so a report
// folds "callsigns carrying stripped-collision" by object; its OBJECT is this
// flag name.
export const STRIPPED_COLLISION_FLAG = 'stripped-collision';

// The named rule attributing every stripped-collision claim. Unlike the
// per-token parse flags (PARSE_CALLSIGN_RULE), this flag is a WHOLE-SOURCE
// cross-row computation - it needs the set of every raw subject in the source
// to decide membership - so it is NOT a parseCallsign output and carries its
// own rule, enumerable beside the parse / pattern / licence-category rules. It
// mirrors componentsFlagsForRows (components.ts), LIFTING that module's
// NON_PLAIN_RE rather than re-deriving the plain-alphabet key, and it is a
// COMPUTATION (not a reference-table lookup, absent from LOOKUP_RULES) so it
// reads out Computed.
export const STRIPPED_COLLISION_RULE = 'stripped-collision';

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

// The named rules that resolve a value via a reference table (a LOOKUP, the
// 'Looked-up' rung); every other named derived rule is a deterministic
// COMPUTATION (the 'Computed' rung). Today only the licence-category tier is a
// lookup (reference-data/licence-category.csv, via normaliseLicenceCategory).
const LOOKUP_RULES: ReadonlySet<string> = new Set<string>([LICENCE_CATEGORY_RULE]);

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
  // cell travels verbatim to the parser, which withholds the flag on a blank or
  // NON-ISO date (e.g. an open-data DD/MM/YYYY rendering) rather than guessing -
  // the same conservative silence isAfterFirstKnownForbidden documents.
  originalStartDateColumn?: string;
}

// Emit the raw-layer claims for a source: one existence claim per observation
// (anchoring it, and carrying the raw subject) plus one attribute claim per
// non-empty non-subject cell. Empty cells emit no claim — absence of evidence,
// reprojected as blank — which keeps the ledger sparse without losing the CSV
// round-trip. Order is preserved as the ordinal (row index), a stored fact.
export function emitClaims(source: SourceObservationSet): Claim[] {
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    claims.push({ layer: 'raw', rawSubject, predicate: LISTED_PREDICATE, object: '', provenance });
    for (const column of source.columns) {
      if (column === source.subjectColumn) continue;
      const value = row[column] ?? '';
      if (value === '') continue;
      claims.push({ layer: 'raw', rawSubject, predicate: column, object: value, provenance });
    }
  });
  return claims;
}

// The rule-attributed normalisation edges for one raw token, in derivation
// order: raw -> cleaned (always), then cleaned -> placeholder (only when the
// token parses to a placeholder form). The cleaning and placeholder logic are
// LIFTED from components.ts — never re-derived here — because a from-scratch
// reimplementation silently dropped rules once, which is the failure the whole
// exercise exists to prevent. product is not needed for the placeholder form,
// so an empty product is passed for sources (e.g. reserved-callsign lists) that
// carry no product column.
export function normalisationEdgesFor(rawToken: string, provenance: Provenance, ref: ReferenceData): NormalisationEdge[] {
  const cleaned = cleanedCallsign(rawToken);
  const edges: NormalisationEdge[] = [
    { rawToken, entity: cleaned, form: 'cleaned', rule: CLEANED_CALLSIGN_RULE, provenance },
  ];
  const placeholder = parseCallsign(rawToken, '', ref).placeholderForm;
  if (placeholder !== '') {
    edges.push({ rawToken: cleaned, entity: placeholder, form: 'placeholder', rule: PLACEHOLDER_FORM_RULE, provenance });
  }
  return edges;
}

// A normalisation edge, expressed as a derived claim for the unified JSONL.
export function edgeToClaim(edge: NormalisationEdge): Claim {
  return {
    layer: 'derived',
    rawSubject: edge.rawToken,
    predicate: NORMALISES_TO_PREDICATE,
    object: edge.entity,
    provenance: edge.provenance,
    rule: edge.rule,
  };
}

// The DERIVED licence-category claims for a source: for each observation whose
// product cell maps to a canonical category, one derived claim tying that
// category to the observation's raw subject. The category is computed by
// normaliseLicenceCategory (components.ts) over the RAW product value read under
// the source's own product header — the map is LIFTED, never re-derived. The
// raw product claim is still emitted verbatim by emitClaims, so the raw and
// derived layers coexist (source fidelity, tiered).
//
// A product that maps to no category yields NO claim, faithfully mirroring the
// legacy's null (build-sqlite.ts stores a NULL normalised_licence_category for
// both cases): a genuinely blank product and an unmapped non-blank product both
// return null from normaliseLicenceCategory, so the derived tier neither invents
// a bucket nor over-collapses. An unmapped product stays fully visible in its
// verbatim raw claim — the surprise is surfaced there, never silently dropped.
export function emitLicenceCategoryClaims(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  const categoryColumn = source.categoryColumn;
  if (categoryColumn === undefined) return [];
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const category = normaliseLicenceCategory(row[categoryColumn] ?? '', ref);
    if (category === null) return;
    const rawSubject = row[source.subjectColumn] ?? '';
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    claims.push({ layer: 'derived', rawSubject, predicate: LICENCE_CATEGORY_PREDICATE, object: category, provenance, rule: LICENCE_CATEGORY_RULE });
  });
  return claims;
}

// The DERIVED T1 parse-attribute claims for a source (issue #406): for each
// observation whose raw subject is a callsign token, the per-callsign attributes
// parseCallsign COMPUTES — its prefix series, implied class, parse status and
// each raised flag — projected into rule-attributed derived claims. The parse is
// LIFTED whole from components.ts and CONSUMED here, never re-derived; the token
// is parsed WITH the source's disclosed product (source.categoryColumn) so a
// class-vs-product mismatch the parser detects rides as a real flag claim rather
// than being invisible, and WITH the source's disclosed original start date
// (source.originalStartDateColumn) so the temporal
// forbidden-suffix-issued-after-first-known-list flag - which parseCallsign
// already computes from that date and the per-suffix first-known-forbidden
// reference - rides too. Both extra flags join parsed.flags under the ONE
// parse-callsign rule; no new predicate or rule is introduced for them.
//
// The tier NEVER invents: a claim rides only where the parse actually yields a
// value. parse_status is the sole always-present attribute (every non-empty
// token resolves to one determination), so it is emitted for every observation;
// prefix_series, implied_class and rsl emit only when the parse resolved one (a
// visitor or unparseable token yields neither series nor class; an RSL-less core
// call or a GB special-event token yields no rsl), and a flag claim only for a
// flag actually raised. An empty subject (an all-blank anchor row) yields
// nothing, mirroring how the normalisation edges skip it — there is no callsign
// to parse.
export function emitParseAttributeClaims(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  const claims: Claim[] = [];
  const productColumn = source.categoryColumn;
  const startDateColumn = source.originalStartDateColumn;
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const product = productColumn !== undefined ? (row[productColumn] ?? '') : '';
    // The RAW original-start-date cell (verbatim, under Ofcom's own header) is
    // passed as parseCallsign's fourth argument so the temporal
    // forbidden-suffix-issued-after-first-known-list flag can fire; a source
    // that discloses no such column passes '' and the parser withholds the flag.
    const originalStartDate = startDateColumn !== undefined ? (row[startDateColumn] ?? '') : '';
    const parsed = parseCallsign(rawSubject, product, ref, originalStartDate);
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    const emit = (predicate: string, object: string): void => {
      claims.push({ layer: 'derived', rawSubject, predicate, object, provenance, rule: PARSE_CALLSIGN_RULE });
    };
    emit(PARSE_STATUS_PREDICATE, parsed.parseStatus);
    if (parsed.prefixSeries !== '') emit(PREFIX_SERIES_PREDICATE, parsed.prefixSeries);
    if (parsed.impliedClass !== '') emit(IMPLIED_CLASS_PREDICATE, parsed.impliedClass);
    if (parsed.rsl !== '') emit(RSL_PREDICATE, parsed.rsl);
    for (const flag of parsed.flags) emit(FLAG_PREDICATE, flag);
  });
  return claims;
}

// The DERIVED callsign-pattern claims for a source (issue #422): for each
// observation with a non-empty raw subject, one derived claim carrying the
// character-shape taxonomy of that raw token. The pattern is computed by
// callsignPattern (src/shared/stats.ts) over the RAW subject — the same mapping
// the stats aggregate applies to the callsign column — LIFTED whole and never
// re-derived, so any change to the taxonomy is owned by stats.ts alone.
//
// The tier NEVER invents: callsignPattern of a non-empty token always resolves a
// non-empty shape (every character maps to A/a/N or a {U+XXXX} marker), so a
// claim rides for every non-empty subject; a blank anchor row yields the empty
// pattern and therefore no claim, mirroring the parse-attribute tier's silence
// on an empty subject. Unlike the parse attributes, the shape is defined for an
// UNPARSEABLE token too (its raw characters still have shapes), so — like the
// stats taxonomy — such a token is described, never dropped.
export function emitCallsignPatternClaims(source: SourceObservationSet): Claim[] {
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const pattern = callsignPattern(rawSubject);
    if (pattern === '') return;
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    claims.push({ layer: 'derived', rawSubject, predicate: CALLSIGN_PATTERN_PREDICATE, object: pattern, provenance, rule: CALLSIGN_PATTERN_RULE });
  });
  return claims;
}

// The DERIVED stripped-collision claims for a source (issue #361): a WHOLE-SOURCE
// cross-row pass. For each observation whose raw subject's NON_PLAIN_RE-stripped
// form DIFFERS from the verbatim token and coexists as its OWN distinct raw row
// in the SAME source, one derived flag claim (object stripped-collision). This
// mirrors componentsFlagsForRows (components.ts) EXACTLY: the collision set is
// built over the verbatim raw subjects of THIS source's rows (never cleaned
// entities, never across sources - the legacy scope is one snapshot), and the
// key is the LIFTED NON_PLAIN_RE ([^A-Za-z0-9/#], which KEEPS '#'), deliberately
// NOT cleanedCallsign (which upper-cases and drops '#') - a future refactor must
// not silently substitute one for the other.
//
// The tier NEVER invents: a claim rides only on the JUNK-bearing observation
// whose stripped twin is actually present (the clean twin itself strips to
// itself and is not flagged), so an empty subject, a token with no junk, and a
// token whose stripped form is absent all yield nothing - honest silence.
export function emitStrippedCollisionClaims(source: SourceObservationSet): Claim[] {
  const rawSubjects = new Set<string>(source.rows.map(row => row[source.subjectColumn] ?? ''));
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const stripped = rawSubject.replace(NON_PLAIN_RE, '');
    if (stripped === rawSubject || stripped === '' || !rawSubjects.has(stripped)) return;
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    claims.push({ layer: 'derived', rawSubject, predicate: FLAG_PREDICATE, object: STRIPPED_COLLISION_FLAG, provenance, rule: STRIPPED_COLLISION_RULE });
  });
  return claims;
}

// The full ledger for a source: the raw attribute/existence claims plus the
// derived claims — the normalisation edges for every observation's raw subject,
// the T1 parse-attribute tier (including the rsl attribute), the callsign-pattern
// tier, the whole-source stripped-collision tier, and the canonical
// licence-category tier where the source discloses a product. This is what a canonical claims.jsonl for the source contains — both
// layers in one file, the derived layer reproducible from the raw layer and the
// lifted rules.
export function emitLedger(source: SourceObservationSet, ref: ReferenceData): Claim[] {
  const claims = emitClaims(source);
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    if (rawSubject === '') return;
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
    for (const edge of normalisationEdgesFor(rawSubject, provenance, ref)) {
      claims.push(edgeToClaim(edge));
    }
  });
  for (const claim of emitParseAttributeClaims(source, ref)) claims.push(claim);
  for (const claim of emitCallsignPatternClaims(source)) claims.push(claim);
  for (const claim of emitStrippedCollisionClaims(source)) claims.push(claim);
  for (const claim of emitLicenceCategoryClaims(source, ref)) claims.push(claim);
  return claims;
}
