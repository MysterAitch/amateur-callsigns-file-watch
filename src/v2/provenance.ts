/**
 * Provenance construction for the v2 claim ledger (issue #436, ADR 0015).
 *
 * Where a claim came from is the observation that carries it: the (source_file,
 * ordinal) key plus the as-of vintage, ENRICHED with the observation's precise
 * source position where the loader captured it. These helpers centralise the two
 * ways an emit path builds that key so every path constructs it identically — the
 * bare key for an attribute claim, and the position-enriched key for the @listed
 * anchor that carries the observation's location once for all its claims.
 */

import type { Provenance, SourceObservationSet } from './claim.ts';

// Build the bare provenance for one observation of a source. Centralised so
// every emit path constructs the (sourceFile, ordinal, vintage) key identically.
export function provenanceFor(source: SourceObservationSet, ordinal: number): Provenance {
  return { sourceFile: source.sourceFile, ordinal, vintage: source.vintage };
}

// The provenance for an observation's @listed ANCHOR claim, ENRICHED with its
// source position when the loader captured line numbers (issue #431). Position
// is a property of the observation KEY - every claim of the observation shares
// it - so it is carried ONCE, on the anchor, rather than on each of the ~15
// claims an observation emits: that keeps the (uncommitted) JSONL from doubling
// (a single 160k-row source would otherwise overflow V8's max string length),
// and the compact-DB loader reads the position off the anchor into the single
// observation row regardless. For a CSV source the position is the 1-based
// physical line and the viewAnchor points a deep-link at that same line of the
// real repo file; a source without line numbers yields the bare provenance
// unchanged (legacy behaviour).
export function anchorProvenance(source: SourceObservationSet, ordinal: number): Provenance {
  const provenance = provenanceFor(source, ordinal);
  const line = source.lineNumbers?.[ordinal];
  if (line !== undefined) {
    provenance.position = { kind: 'csv-line', line };
    if (source.repoPath !== undefined) provenance.viewAnchor = { repoPath: source.repoPath, line };
  }
  return provenance;
}
