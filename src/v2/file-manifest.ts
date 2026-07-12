/**
 * File-level manifest claims for the v2 claim ledger (issue #434, ADR 0016).
 *
 * A FILE-LEVEL claim describes the source FILE - its verbatim as-published
 * header, which column is the subject, the curated furniture the loader strips -
 * rather than any single observation row. It is the shared infrastructure the
 * fidelity programme (#431/#434) reuses to attest the structural framing the
 * per-row claim stream deliberately omits (the header set/order/exact strings,
 * the subject column's name/position, the footer/blank lines).
 *
 * The convention that keeps a file-level claim unambiguously NOT an observation:
 * its provenance ordinal is the sentinel FILE_LEVEL_ORDINAL (-1). Observations
 * occupy the gap-free range 0..n-1, so -1 can never collide with one, and an
 * ordinal-keyed fold (the @listed existence fold, the reconstruction's gap-free
 * row-count) rejects it with the same 0.. bound it already enforces. Consumers
 * test membership through isFileLevelClaim rather than open-coding the sentinel,
 * so the multiset that folds see stays exactly the observation claims and the
 * #404 no-inflation invariant is untouched (a file-level claim is layer:'raw',
 * carries no rule, and reads out As-published - a header string IS a source byte,
 * not a derivation).
 */

import type { Claim, Provenance, SourceObservationSet } from './claim.ts';

export const FILE_LEVEL_ORDINAL = -1;

// The reserved file-level predicate vocabulary. @column carries the column INDEX
// in the predicate (@column/<index>), NOT a delimiter inside the object, because
// a header may itself contain whitespace or tabs - encoding the index in the
// predicate keeps both the order and the exact string stored facts. @subject
// names the subject column's verbatim header (its index falls out of the @column
// set). @ignored carries one curated/blank line verbatim in its object,
// positioned by its source line on the shared provenance (issue #431/#436).
export const COLUMN_PREDICATE_PREFIX = '@column/';
export const SUBJECT_PREDICATE = '@subject';
export const IGNORED_PREDICATE = '@ignored';

// The predicate encoding a header column at a given zero-based index.
export function columnPredicate(index: number): string {
  return `${COLUMN_PREDICATE_PREFIX}${index}`;
}

// The zero-based column index a @column/<index> predicate encodes, or undefined
// when the predicate is not a column predicate. The strict integer check means a
// stray predicate can never be mistaken for a positioned header.
export function columnIndexOf(predicate: string): number | undefined {
  if (!predicate.startsWith(COLUMN_PREDICATE_PREFIX)) return undefined;
  const rest = predicate.slice(COLUMN_PREDICATE_PREFIX.length);
  if (!/^\d+$/.test(rest)) return undefined;
  return Number(rest);
}

// Whether a claim is a file-level (non-observation) claim - the one test every
// ordinal-keyed fold uses to exclude the manifest stream from the observation
// multiset.
export function isFileLevelClaim(claim: Claim): boolean {
  return claim.provenance.ordinal === FILE_LEVEL_ORDINAL;
}

// Emit the FILE-LEVEL manifest claims for a source (issue #434): the verbatim
// as-published structure the per-row claim stream omits, all layer:'raw' on the
// FILE_LEVEL_ORDINAL sentinel so they never enter the observation multiset. One
// @column/<index> claim per header column (object = the verbatim as-published
// header string, index in the predicate so both order and the exact string are
// stored facts); one @subject claim naming the subject column's verbatim header;
// and one @ignored claim per curated/blank line, object = the verbatim content,
// positioned by its source line on the shared provenance. These read out
// As-published under #404's no-inflation invariant - a header/furniture string
// IS a source byte, not a derivation - and together with emitClaims's per-row
// claims let a reconstruction rebuild the original text from the claim stream
// alone (the reconstruction oracle, src/ci/reconstruction-oracle.ts).
export function emitFileManifestClaims(source: SourceObservationSet): Claim[] {
  const claims: Claim[] = [];
  const headerProvenance = (): Provenance => {
    const provenance: Provenance = { sourceFile: source.sourceFile, ordinal: FILE_LEVEL_ORDINAL, vintage: source.vintage };
    if (source.headerLine !== undefined) provenance.position = { kind: 'csv-line', line: source.headerLine };
    return provenance;
  };
  source.columns.forEach((header, index) => {
    claims.push({ layer: 'raw', rawSubject: '', predicate: columnPredicate(index), object: header, provenance: headerProvenance() });
  });
  claims.push({ layer: 'raw', rawSubject: '', predicate: SUBJECT_PREDICATE, object: source.subjectColumn, provenance: headerProvenance() });
  for (const ignored of source.ignoredLines ?? []) {
    const provenance: Provenance = {
      sourceFile: source.sourceFile,
      ordinal: FILE_LEVEL_ORDINAL,
      vintage: source.vintage,
      position: { kind: 'csv-line', line: ignored.line },
    };
    claims.push({ layer: 'raw', rawSubject: '', predicate: IGNORED_PREDICATE, object: ignored.content, provenance });
  }
  return claims;
}
