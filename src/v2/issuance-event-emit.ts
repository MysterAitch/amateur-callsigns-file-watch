/**
 * The DERIVED authored-event tier for the v2 claim ledger (issue #813 Stage C2).
 *
 * An issuance-events disclosure lists dated licensing events, but the event
 * WORD itself ('reissued' / 'reciprocal-licence-issued' / 'reallocated') is not
 * a published table cell: it is the AUTHORED constant the converter binding
 * (FOI_ENTRY_CONVERSIONS, foi-normalise.ts) pins from the disclosure's own
 * covering-letter wording - e.g. ofcom-498906's letter frames its rows as 'call
 * signs associated to Amateur Reciprocal Licences since 2010', and wdtk-251507's
 * letter uses 'reallocated'. An authored word must never present As-published,
 * so the tier emits it as a DERIVED claim with a named rule - one claim per row,
 * beside the row's verbatim raw cells - correcting the mis-presentation the
 * #831 audit confirmed (the old emit carried the constant as a raw claim).
 */

import { provenanceFor } from './provenance.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

// The derived event predicate: the authored classification of what licensing
// event a row records. It deliberately keeps the analytical role name (the
// normalised-CSV vocabulary) because it IS an analytical vocabulary - the raw
// layer carries only the source's own verbatim headers.
export const EVENT_PREDICATE = 'event';

// The named rule for the derived event claims. It attributes each value to the
// authored converter binding (FOI_ENTRY_CONVERSIONS), whose per-source `event`
// constant is taken from the disclosure's own covering-letter wording - an
// authored, reviewed registry entry, never inferred from row content. It is a
// registry LOOKUP (claim-core.ts enumerates it in LOOKUP_RULES so an event
// claim reads out Looked-up, never Computed, the COLUMN_INTERPRETATION_RULE
// precedent): the value is asserted by our authored binding, not computed from
// the published bytes.
export const AUTHORED_EVENT_RULE = 'authored-event-vocabulary';

// The DERIVED event claims for a source: one claim per observation carrying the
// source's authored event constant, tied to the observation's raw subject. A
// source that pins no authored event vocabulary (every non-issuance family)
// emits nothing. The constant is per-source by construction (the binding pins
// one word per disclosure), so every row of the source carries the same object -
// the per-row emission keeps each EVENT joined to its own observation
// (provenance, vintage, position via the anchor) rather than collapsing twenty
// dated events into one file-level assertion.
export function emitAuthoredEventClaims(source: SourceObservationSet): Claim[] {
  const event = source.authoredEvent;
  if (event === undefined) return [];
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    claims.push({ layer: 'derived', rawSubject, predicate: EVENT_PREDICATE, object: event, provenance: provenanceFor(source, ordinal), rule: AUTHORED_EVENT_RULE });
  });
  return claims;
}
