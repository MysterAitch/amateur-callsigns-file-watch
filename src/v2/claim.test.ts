import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import {
  emitClaims,
  LISTED_PREDICATE,
  type SourceObservationSet,
} from './claim.ts';
import { projectNormalised } from './project-normalised.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario throughout is a user re-deriving a published table from the
// claim ledger and expecting the SAME DATA back: same field values per
// observation, independent of CSV quoting and reproduced in source order. The
// oracle is semantic equivalence (a multiset of parsed records), not
// byte-identity — no consumer locks the current serialisation.

const ARCHIVE_DIR = path.resolve(import.meta.dirname, '..', '..', 'archive');

// Load a published CSV (a normalised.csv or a raw-extract) as a source
// observation set. Header order is preserved (csv-parse keeps insertion order),
// so the declared column set reprojects rectangularly.
function loadSource(relativePath: string, subjectColumn: string, vintage: string): SourceObservationSet {
  const content = fs.readFileSync(path.join(ARCHIVE_DIR, relativePath), 'utf8');
  const rows = parse(content, { columns: true, bom: true }) as Record<string, string>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { sourceFile: relativePath, vintage, columns, subjectColumn, rows };
}

// A canonical, order-independent key for one parsed record over a fixed column
// set — the unit of the equivalence multiset.
function recordKey(values: Record<string, string>, columns: readonly string[]): string {
  return JSON.stringify(columns.map(column => [column, values[column] ?? '']));
}

// Multiset of record keys: value -> occurrence count. Two record sets are
// EQUIVALENT when their multisets are equal, regardless of row order or the
// serialisation (quoting) that produced them.
function multiset(records: readonly Record<string, string>[], columns: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = recordKey(record, columns);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false;
  }
  return true;
}

// The two real entries the equivalence oracle covers: a plain callsign-sorted
// register snapshot (8-column canonical schema, with all-blank rows at the top),
// and a FOI disclosure whose callsign column contains an RFC-4180 quoted value
// literally equal to ",," — so a naive split-on-comma parse would corrupt it.
const ENTRIES = [
  {
    label: 'the 2022-05-30 register snapshot',
    relativePath: '2022-05-30/normalised.csv',
    vintage: '2022-05-30',
  },
  {
    label: 'the ofcom-01420046 allocated-and-reserved FOI disclosure',
    relativePath: 'foi/ofcom-01420046--allocated-reserved-callsigns/normalised--sheet-1-report1646659776237.csv',
    vintage: '2022-03-07',
  },
];

describe('claim ledger round-trip on real archive entries', () => {
  for (const entry of ENTRIES) {
    it(`ReprojectedNormalisedCsv_When${entry.relativePath.includes('foi') ? 'QuotedFieldsFoiDisclosure' : 'RegisterSnapshot'}_IsMultisetEquivalentToSource`, () => {
      const source = loadSource(entry.relativePath, 'callsign', entry.vintage);
      expect(source.rows.length).toBeGreaterThan(0);

      const claims = emitClaims(source);
      const projected = projectNormalised(claims, source.columns, 'callsign');

      // Same number of observations round-trips (no row dropped or invented).
      expect(projected.length).toBe(source.rows.length);

      const sourceMultiset = multiset(source.rows, source.columns);
      const projectedMultiset = multiset(projected.map(record => record.values), source.columns);
      expect(multisetsEqual(sourceMultiset, projectedMultiset)).toBe(true);
    });
  }

  it('SourceOrder_WhenReprojected_IsPreservedByStoredOrdinal', () => {
    // The FOI disclosure is callsign-sorted, so the FIRST data row is the
    // quoted ",," value: order fidelity means it reprojects first, not the
    // ledger's own iteration order.
    const source = loadSource(ENTRIES[1].relativePath, 'callsign', ENTRIES[1].vintage);
    const claims = emitClaims(source);
    const projected = projectNormalised(claims, source.columns, 'callsign');
    expect(projected[0].values.callsign).toBe(source.rows[0].callsign);
    expect(projected[projected.length - 1].values.callsign).toBe(source.rows[source.rows.length - 1].callsign);
  });
});

describe('single-column membership lists', () => {
  it('BareMembership_WhenNoAttributes_SurvivesViaExistenceClaim', () => {
    // A one-column roll emits no attribute claims; without the existence
    // predicate the subject would vanish. Assert the observation still
    // round-trips and carries the listing assertion.
    const source: SourceObservationSet = {
      sourceFile: 'synthetic/forbidden-suffix-roll.csv',
      vintage: '2024-12-01',
      columns: ['suffix'],
      subjectColumn: 'suffix',
      rows: [{ suffix: 'SOS' }, { suffix: 'QRZ' }],
    };
    const claims = emitClaims(source);
    expect(claims.every(claim => claim.predicate === LISTED_PREDICATE)).toBe(true);
    const projected = projectNormalised(claims, source.columns, 'suffix');
    expect(projected.map(record => record.values.suffix)).toEqual(['SOS', 'QRZ']);
  });
});
