/**
 * The DERIVED callsign-pattern tier for the v2 claim ledger (issue #422).
 *
 * Beside the verbatim raw layer, the ledger carries the character-shape taxonomy
 * of each raw callsign token — uppercase->A, lowercase->a, digit->N, with
 * whitespace/unprintable/invisible characters exploded to explicit {U+XXXX}
 * markers. The shape is computed by callsignPattern (src/shared/stats.ts), the
 * ONE character-shape mapping the stats aggregate already applies to the callsign
 * column, LIFTED whole and CONSUMED here so the tier stays a projection of that
 * function. It is computed from the RAW token (not the cleaned entity) precisely
 * so the whitespace/encoding artefacts the taxonomy exists to surface stay
 * visible.
 */

import { callsignPattern } from '../shared/stats.ts';
import { provenanceFor } from './provenance.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

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
    const provenance = provenanceFor(source, ordinal);
    claims.push({ layer: 'derived', rawSubject, predicate: CALLSIGN_PATTERN_PREDICATE, object: pattern, provenance, rule: CALLSIGN_PATTERN_RULE });
  });
  return claims;
}
