import { describe, it, expect } from 'vitest';
import {
  emitDateFormatMixingClaims,
  emitNormalisationCollisionClaims,
  explainColumnFlag,
  classifyDateShape,
  detectsDateFormatMixing,
  detectNormalisationCollisions,
  columnFlagIndexOf,
  WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG,
  WITHIN_TABLE_DATE_FORMAT_RULE,
  WITHIN_TABLE_NORMALISATION_COLLISION_RULE,
} from './within-table.ts';
import { claimConfidence, type Claim, type SourceObservationSet } from './claim.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// Issue #435 P2/P3: within-table interpretation-consistency passes. Date-format
// mixing is a LOUD, non-fatal doubt flag (ADR 0018); a normalisation collision
// flags two distinct raw values collapsing to one canonical INSIDE one table. The
// scope is structurally within-a-table: cross-file variation is never flagged.

const REF = loadReferenceData();

// A register-shaped source with a callsign subject, an enumerated-category
// product, a verbatim status, and a day-first date column; the caller supplies
// the product/date values under test.
function source(rows: readonly Record<string, string>[]): SourceObservationSet {
  return {
    sourceFile: 'synthetic/within-table.csv',
    vintage: '2026-01-01',
    columns: ['Callsign', 'Product', 'Status', 'CreatedDate'],
    subjectColumn: 'Callsign',
    categoryColumn: 'Product',
    headerLine: 1,
    rows,
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'enumerated-category' },
      { type: 'string' },
      { type: 'date', format: 'DD/MM/YYYY' },
    ],
  };
}

describe('a date column that mixes formats within one table raises a loud, non-fatal flag (P2)', () => {
  it('DateColumn_WhenFormatsMixWithinOneTable_RaisesADoubtFlagWithoutFailingTheBuild', () => {
    // 15/01 forces day-first (day 15 > 12); 01/15 forces month-first (15 in the
    // month slot). The pass SEES the contradiction the strict converter would
    // throw on - and records it as a review candidate rather than aborting.
    const mixed = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '01/15/2019' },
    ]);
    let claims: Claim[] = [];
    // The pass must NOT throw - the loud-flag-not-fatal decision (ADR 0018).
    expect(() => { claims = emitDateFormatMixingClaims(mixed); }).not.toThrow();
    expect(claims).toHaveLength(1);
    expect(claims[0].object).toBe(WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG);
    expect(claims[0].rule).toBe(WITHIN_TABLE_DATE_FORMAT_RULE);
    // The flag positions itself on the CreatedDate column (index 3).
    expect(columnFlagIndexOf(claims[0].predicate)).toBe(3);
  });

  it('DateColumn_WhenSlashAndIsoShapesCoexist_RaisesADoubtFlag', () => {
    const mixed = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '05/03/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '2019-03-05' },
    ]);
    expect(emitDateFormatMixingClaims(mixed)).toHaveLength(1);
  });

  it('DateColumn_WhenUniformlyDayFirst_RaisesNoFlag', () => {
    const uniform = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '20/02/2019' },
    ]);
    expect(emitDateFormatMixingClaims(uniform)).toEqual([]);
  });

  it('DateColumn_WhenUniformlyAmbiguous_RaisesNoFlag', () => {
    // Both components <= 12 throughout: the ordering cannot self-verify, but the
    // column does not MIX - it is uniformly one (unproven) ordering, not a flag.
    const ambiguous = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '05/03/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '03/05/1903' },
    ]);
    expect(emitDateFormatMixingClaims(ambiguous)).toEqual([]);
    expect(classifyDateShape('05/03/2019')).toBe('ambiguous-slash');
    expect(detectsDateFormatMixing(['05/03/2019', '03/05/1903'])).toBe(false);
  });

  it('WithinTableFlag_WhenRaised_ReadsOutComputed', () => {
    const mixed = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '01/15/2019' },
    ]);
    expect(claimConfidence(emitDateFormatMixingClaims(mixed)[0])).toBe('Computed');
  });
});

describe('two distinct raw values collapsing to one canonical inside one table is flagged (P3)', () => {
  it('NormalisationCollision_WhenTwoRawValuesCollapseToOneCanonicalInOneTable_RaisesAFlagNamingTheCanonical', () => {
    const collided = source([
      { Callsign: 'M7TEE', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '16/01/2019' },
    ]);
    const claims = emitNormalisationCollisionClaims(collided, REF);
    expect(claims).toHaveLength(1);
    // ADR 0018: the flag's OBJECT names the canonical it flags.
    expect(claims[0].object).toBe('Full');
    expect(claims[0].rule).toBe(WITHIN_TABLE_NORMALISATION_COLLISION_RULE);
    expect(columnFlagIndexOf(claims[0].predicate)).toBe(1);
    expect(claimConfidence(claims[0])).toBe('Computed');
  });

  it('NormalisationCollision_WhenTheTableUsesOneVocabulary_RaisesNothing', () => {
    const clean = source([
      { Callsign: 'M7TEE', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Amateur Foundation Radio Licence', Status: 'Allocated', CreatedDate: '16/01/2019' },
    ]);
    // Two DIFFERENT canonicals (Full, Foundation), one raw each: no collision.
    expect(emitNormalisationCollisionClaims(clean, REF)).toEqual([]);
  });
});

describe('the within-table scope is enforced structurally: cross-file variation is never a defect', () => {
  it('NormalisationCollision_WhenTheTwoFormsAreInSeparateTables_RaisesNothing', () => {
    // The cross-file scope guard (ADR 0018). Source A uses the short form, source
    // B the long form - the legitimate open-data-vs-FOI drift. Each pass sees ONE
    // source, so neither raises a collision: the candidate set is never built
    // across sources.
    const tableA = source([{ Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' }]);
    const tableB = source([{ Callsign: 'G0ABC', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '16/01/2019' }]);
    expect(emitNormalisationCollisionClaims(tableA, REF)).toEqual([]);
    expect(emitNormalisationCollisionClaims(tableB, REF)).toEqual([]);

    // Only when BOTH forms sit in ONE table does the collision surface.
    const combined = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '16/01/2019' },
    ]);
    expect(emitNormalisationCollisionClaims(combined, REF).map(c => c.object)).toEqual(['Full']);
  });

  it('CollisionDetector_WhenParameterisedOverACanonicaliser_GroupsDistinctRawsByCanonical', () => {
    // The pass is parameterised over (column, canonicaliseFn); a future status
    // canonicalisation reuses it unchanged. Proven with a toy canonicaliser.
    const upper = (raw: string): string | null => (raw === '' ? null : raw.toUpperCase());
    expect(detectNormalisationCollisions(['live', 'Live', 'allocated'], upper)).toEqual([
      { canonical: 'LIVE', rawValues: ['Live', 'live'] },
    ]);
  });
});

describe('a raised flag reconstructs its evidence on read (composition with #433)', () => {
  it('ExplainColumnFlag_WhenGivenADateMixingFlag_ReproducesTheFindingWithEvidence', () => {
    const mixed = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '01/15/2019' },
    ]);
    const [flag] = emitDateFormatMixingClaims(mixed);
    const working = explainColumnFlag(flag, mixed, REF);
    expect(working.result).toBe(WITHIN_TABLE_DATE_FORMAT_MIXING_FLAG);
    // The colliding witnesses deep-link to their source cells (a raw-claim origin).
    expect(working.inputs.length).toBeGreaterThanOrEqual(2);
    expect(working.inputs.every(i => i.origin.kind === 'raw-claim')).toBe(true);
    expect(working.inputs.map(i => i.value)).toEqual(expect.arrayContaining(['15/01/2019', '01/15/2019']));
  });

  it('ExplainColumnFlag_WhenGivenACollisionFlag_ReproducesTheCanonicalAndCollidingRawValues', () => {
    const collided = source([
      { Callsign: 'M7TEE', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '16/01/2019' },
    ]);
    const [flag] = emitNormalisationCollisionClaims(collided, REF);
    const working = explainColumnFlag(flag, collided, REF);
    expect(working.result).toBe('Full');
    expect(working.inputs.map(i => i.value).sort()).toEqual(['Amateur Full Radio Licence', 'Full']);
  });

  it('ExplainColumnFlag_WhenGivenANonFlagPredicate_FailsLoud', () => {
    const bogus: Claim = {
      layer: 'derived', rawSubject: '', predicate: '@interpretation/1', object: 'enumerated-category',
      rule: 'column-interpretation', provenance: { sourceFile: 'synthetic/within-table.csv', ordinal: -1, vintage: '2026-01-01' },
    };
    expect(() => explainColumnFlag(bogus, source([]), REF)).toThrow(/not a @column-flag predicate/);
  });
});
