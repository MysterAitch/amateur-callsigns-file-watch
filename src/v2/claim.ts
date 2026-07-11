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

import { cleanedCallsign, parseCallsign, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

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

// The full ledger for a source: the raw attribute/existence claims plus the
// derived normalisation edges (as derived claims) for every observation's raw
// subject. This is what a canonical claims.jsonl for the source contains — both
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
  return claims;
}
