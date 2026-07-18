/**
 * The DERIVED authored-binding-role tier for the v2 claim ledger (issue #813
 * Stage D).
 *
 * The available-pool disclosures' raw layer carries the publishers' own verbatim
 * structure and nothing else (issue #813 Stage A). But the ANALYTICAL reading of
 * those cells - "this cell is the SUFFIX", "this sheet's class is Foundation",
 * "the stated prefix is M6" - is authored vocabulary from the converter binding
 * (FOI_ENTRY_CONVERSIONS, foi-normalise.ts), which Stage A deliberately dropped
 * from the raw layer rather than mis-present authored words As-published. This
 * tier restores that role vocabulary WHERE IT BELONGS: as derived claims under a
 * named rule, one claim per (row, role), so a consumer can still ask "which
 * suffixes were available" without re-authoring the binding's reading - while
 * the raw layer stays purely the published bytes.
 *
 * The rule is a registry LOOKUP (claim-core.ts enumerates it in LOOKUP_RULES so
 * a role claim reads out Looked-up, never Computed - the authored-event
 * precedent, Stage C2): each value is either the raw cell the binding reads
 * under a source header, or the binding's authored constant (a sheet-level
 * class, a stated prefix) - asserted by our reviewed binding, not computed from
 * the bytes. Raw-scoped folds provably cannot see these claims (they filter
 * layer='raw'), so restoring the vocabulary moves no committed figure.
 */

import { provenanceFor } from './provenance.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

// The named rule for the derived role claims. It attributes each value to the
// authored converter binding whose column spec assigns the role - the ONE place
// the raw-header-to-role reading is authored and reviewed.
export const AUTHORED_ROLE_RULE = 'authored-binding-role';

// The DERIVED role claims for a source: for each observation, one claim per
// authored role binding whose value is non-empty - the raw cell read under the
// binding's source header, or the binding's authored constant. A source that
// attests no role bindings (every family but available-pool today) emits
// nothing. An empty read emits no claim, mirroring the raw layer's sparsity:
// absence of evidence, never an invented blank assertion.
export function emitAuthoredRoleClaims(source: SourceObservationSet): Claim[] {
  const bindings = source.authoredRoleBindings;
  if (bindings === undefined || bindings.length === 0) return [];
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    const provenance = provenanceFor(source, ordinal);
    for (const binding of bindings) {
      const value = binding.source === null ? (binding.constant ?? '') : (row[binding.source] ?? '');
      if (value === '') continue;
      claims.push({ layer: 'derived', rawSubject, predicate: binding.role, object: value, provenance, rule: AUTHORED_ROLE_RULE });
    }
  });
  return claims;
}
