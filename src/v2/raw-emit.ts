/**
 * The raw-layer emit step for the v2 claim ledger (issue #361).
 *
 * The raw layer is the source-of-record: it asserts, verbatim, exactly what a
 * published source row says and no more. One existence claim anchors each
 * observation (carrying its raw subject and source position), and one attribute
 * claim rides each non-empty non-subject cell. Every derived tier layers on top
 * of this; nothing here is computed by a rule, so a raw claim always reads out
 * As-published.
 */

import { anchorProvenance, provenanceFor } from './provenance.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

// The existence predicate. A single-column list (a bare membership roll) emits
// no attribute claims, so without an explicit existence assertion the subject
// would vanish from the ledger. Listing is itself a claim; it also anchors an
// all-blank row so the observation survives the round-trip.
export const LISTED_PREDICATE = '@listed';

// Emit the raw-layer claims for a source: one existence claim per observation
// (anchoring it, and carrying the raw subject) plus one attribute claim per
// non-empty non-subject cell. Empty cells emit no claim — absence of evidence,
// reprojected as blank — which keeps the ledger sparse without losing the CSV
// round-trip. Order is preserved as the ordinal (row index), a stored fact.
export function emitClaims(source: SourceObservationSet): Claim[] {
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    // The @listed anchor carries the source-position enrichment (issue #431);
    // the attribute claims of the same observation share its (source_file,
    // ordinal) key and so its position - carried once on the anchor, not
    // repeated on every claim.
    claims.push({ layer: 'raw', rawSubject, predicate: LISTED_PREDICATE, object: '', provenance: anchorProvenance(source, ordinal) });
    const provenance = provenanceFor(source, ordinal);
    for (const column of source.columns) {
      if (column === source.subjectColumn) continue;
      const value = row[column] ?? '';
      if (value === '') continue;
      claims.push({ layer: 'raw', rawSubject, predicate: column, object: value, provenance });
    }
  });
  return claims;
}
