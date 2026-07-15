/**
 * The full-ledger emit orchestrator for the v2 claim ledger (issue #361).
 *
 * emitLedger composes the per-tier emit modules into the canonical claim stream
 * for one source: the raw attribute/existence claims plus every derived tier.
 * Each tier lives in its own module so tier work parallelises; this orchestrator
 * is the ONE place their order of composition is fixed, and the order IS a stored
 * fact of the emitted multiset the equivalence oracles pin.
 */

import { emitClaims } from './raw-emit.ts';
import { edgeToClaim, normalisationEdgesFor } from './normalisation-edges.ts';
import { emitParseAttributeClaims } from './parse-attribute-emit.ts';
import { emitCallsignPatternClaims } from './callsign-pattern-emit.ts';
import { emitStrippedCollisionClaims } from './stripped-collision-emit.ts';
import { emitLicenceCategoryClaims } from './licence-category-emit.ts';
import { provenanceFor } from './provenance.ts';
import type { ReferenceData } from '../sources/ofcom-amateur/components.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

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
    const provenance = provenanceFor(source, ordinal);
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
