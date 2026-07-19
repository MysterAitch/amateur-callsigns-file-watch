import { describe, it, expect, vi } from 'vitest';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The claims->canonical-rows fold (build-projection-db) resolves the callsign
// and product columns by NAME (CANONICAL_COLUMNS.indexOf), not by physical
// position (issue #847). To prove that resolution actually tracks the schema,
// this file mocks CANONICAL_COLUMNS into a REORDERED shape - product before
// callsign - the exact change under which a positional r[0]/r[1] read would feed
// the product cell to the callsign parser and vice versa. On the real schema
// callsign IS column 0, so the byte-parity gate cannot catch that mistake; here
// the reorder makes it observable. The components must still derive from the
// TRUE callsign/product columns.
vi.mock('../sources/ofcom-amateur/normalise.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sources/ofcom-amateur/normalise.ts')>();
  const rest = actual.CANONICAL_COLUMNS.filter(column => column !== 'callsign' && column !== 'product');
  return { ...actual, CANONICAL_COLUMNS: ['product', 'callsign', ...rest] };
});

import { projectPublicationFromClaims } from './build-projection-db.ts';
import { CANONICAL_COLUMNS } from '../sources/ofcom-amateur/normalise.ts';
import { LISTED_PREDICATE, type Claim } from './claim.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

const REF = loadReferenceData();

// The @listed anchor per row plus one raw attribute claim per non-empty
// non-subject cell - the multiset the raw emit stores, so the fold is exercised
// on its real input shape.
function claimsFor(key: string, subjectColumn: string, rows: Record<string, string>[]): Claim[] {
  const sourceFile = `opendata/${key}/raw.csv`;
  const claims: Claim[] = [];
  rows.forEach((row, ordinal) => {
    const rawSubject = row[subjectColumn] ?? '';
    const provenance = { sourceFile, ordinal, vintage: key };
    claims.push({ layer: 'raw', rawSubject, predicate: LISTED_PREDICATE, object: '', provenance });
    for (const [column, value] of Object.entries(row)) {
      if (column === subjectColumn || value === '') continue;
      claims.push({ layer: 'raw', rawSubject, predicate: column, object: value, provenance });
    }
  });
  return claims;
}

describe('build-projection-db column resolution under a reordered schema (issue #847)', { tags: ['unit'] }, () => {
  it('CanonicalColumns_UnderThisMock_PlacesProductBeforeCallsign', () => {
    // Guard on the guard: the mock must actually reorder, else the test proves
    // nothing.
    expect(CANONICAL_COLUMNS.indexOf('product')).toBe(0);
    expect(CANONICAL_COLUMNS.indexOf('callsign')).toBe(1);
  });

  it('ProjectPublication_WhenCallsignIsNotColumnZero_DerivesComponentsFromTheCallsignColumnByName', () => {
    const claims = claimsFor('2099-01-01', 'Value__c', [
      { 'Value__c': 'M7TEE', 'Product__c': 'Amateur Radio (Foundation)', 'Status__c': 'Allocated' },
    ]);
    const publication = projectPublicationFromClaims(claims, REF, 'v2025-salesforce');

    // The canonical row follows the reordered schema: product first, callsign
    // second.
    expect(publication.rows[0][0]).toBe('Amateur Radio (Foundation)');
    expect(publication.rows[0][1]).toBe('M7TEE');

    // The component parse must come from the CALLSIGN cell (M7TEE -> suffix TEE,
    // series M7), not from column 0 (the product string), which a positional
    // read would have parsed as an unparseable "callsign".
    const component = publication.components[0];
    expect(component.parseStatus).toBe('parsed');
    expect(component.suffix).toBe('TEE');
    expect(component.prefixSeries).toBe('M7');
  });
});
