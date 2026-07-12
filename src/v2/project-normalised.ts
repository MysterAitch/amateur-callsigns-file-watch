/**
 * The inverse fold: given the claims for one entry, reproject the
 * normalised-CSV-equivalent record set. This is the projection half of the
 * inversion — "generate table X" stops being bespoke code and becomes "fold the
 * ledger".
 *
 * The oracle is SEMANTIC EQUIVALENCE, not byte-identity (no consumer locks the
 * current bytes): the reprojection reproduces the field VALUES per observation,
 * independent of quoting and — because each record carries its source ordinal —
 * in the source's stored order. It does NOT attempt to reproduce a particular
 * serialisation.
 *
 * Only raw-layer claims fold into the record set. Derived claims (the
 * normalisation edges) describe the entity graph, not the source table, so they
 * are excluded here by construction.
 */

import type { Claim } from './claim.ts';
import { LISTED_PREDICATE, isFileLevelClaim } from './claim.ts';

// A reprojected record: column name -> value, plus the source ordinal that
// fixes its position. Every declared column is present (blank when the source
// asserted nothing), so the record set is rectangular like the source table.
export interface ProjectedRecord {
  ordinal: number;
  values: Record<string, string>;
}

// Fold the raw claims for one source back into an ordered record set. Records
// are grouped by observation ordinal, the subject column filled from the
// observation's raw subject, every other declared column from its attribute
// claim (blank when none). Ordered by ordinal so a source-order list and a
// callsign-sorted register alike reproject in their original order.
export function projectNormalised(claims: readonly Claim[], columns: readonly string[], subjectColumn: string): ProjectedRecord[] {
  const byOrdinal = new Map<number, ProjectedRecord>();

  const recordFor = (ordinal: number): ProjectedRecord => {
    let record = byOrdinal.get(ordinal);
    if (record === undefined) {
      const values: Record<string, string> = {};
      for (const column of columns) values[column] = '';
      record = { ordinal, values };
      byOrdinal.set(ordinal, record);
    }
    return record;
  };

  for (const claim of claims) {
    if (claim.layer !== 'raw') continue;
    // File-level manifest claims (issue #434) describe the source FILE, not a
    // row - they ride the FILE_LEVEL_ORDINAL sentinel, so excluding them here
    // keeps the reprojected record set exactly the observation rows (the
    // row-count/existence invariant is unpolluted when the two streams mix).
    if (isFileLevelClaim(claim)) continue;
    const record = recordFor(claim.provenance.ordinal);
    record.values[subjectColumn] = claim.rawSubject;
    if (claim.predicate === LISTED_PREDICATE) continue;
    if (Object.prototype.hasOwnProperty.call(record.values, claim.predicate)) {
      record.values[claim.predicate] = claim.object;
    }
  }

  return [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal);
}
