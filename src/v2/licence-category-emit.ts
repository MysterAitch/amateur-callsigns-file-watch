/**
 * The DERIVED licence-category tier for the v2 claim ledger (issue #361).
 *
 * Beside the verbatim raw product claim (emitted by the raw tier), the ledger
 * carries the canonical category that raw product/licence_class value collapses
 * to, resolved via reference-data/licence-category.csv (normaliseLicenceCategory
 * in components.ts) — the ONE authoritative product->category map, LIFTED whole
 * and never re-derived here, so the tier keeps the map's deliberate distinctions
 * (Temporary Reciprocal vs Full Reciprocal, Club, Special Event) rather than
 * inventing a vocabulary of its own. Both layers coexist, tiered; the derived
 * claim never replaces the verbatim one.
 */

import { normaliseLicenceCategory, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { provenanceFor } from './provenance.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

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
// rather than inventing a vocabulary of its own. It is a reference-table LOOKUP
// (claim-core.ts enumerates it in LOOKUP_RULES so a licence-category claim reads
// out Looked-up, never Computed).
export const LICENCE_CATEGORY_RULE = 'licence-category';

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
    const provenance = provenanceFor(source, ordinal);
    claims.push({ layer: 'derived', rawSubject, predicate: LICENCE_CATEGORY_PREDICATE, object: category, provenance, rule: LICENCE_CATEGORY_RULE });
  });
  return claims;
}
