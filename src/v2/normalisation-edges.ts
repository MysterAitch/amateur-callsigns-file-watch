/**
 * The rule-attributed normalisation-edge tier for the v2 claim ledger (#361).
 *
 * Normalisation is a FIRST-CLASS, rule-attributed edge, never a silent
 * transform: raw_token --normalises_to--> entity, tagged with the NAMED rule
 * that produced it. The edge is the JOIN every entity-level view folds over, so
 * it is modelled distinctly (NormalisationEdge) and serialised as a derived
 * claim. The cleaning and placeholder logic are LIFTED from components.ts —
 * never re-derived here — because a from-scratch reimplementation silently
 * dropped rules once, which is the failure the whole exercise exists to prevent.
 */

import { cleanedCallsign, parseCallsign, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import type { Claim, NormalisationEdge, Provenance } from './claim-core.ts';

// The normalisation-edge predicate.
export const NORMALISES_TO_PREDICATE = 'normalises_to';

// Named rules for the derived normalisation edges, matching the lifted logic in
// components.ts. Naming them (rather than describing them inline) keeps the
// derived claims auditable and the rule set enumerable.
export const CLEANED_CALLSIGN_RULE = 'cleaned-callsign';
export const PLACEHOLDER_FORM_RULE = 'placeholder-form';

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
