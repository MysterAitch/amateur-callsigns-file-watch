import { describe, it, expect } from 'vitest';
import {
  emitClaims,
  emitFileManifestClaims,
  emitInterpretationClaims,
  interpretColumns,
  hasColumnInterpretations,
  claimConfidence,
  isFileLevelClaim,
  encodeInterpretation,
  decodeInterpretation,
  interpretationIndexOf,
  interpretationPredicate,
  COLUMN_INTERPRETATION_RULE,
  FILE_LEVEL_ORDINAL,
  type ColumnInterpretation,
  type SourceObservationSet,
} from './claim.ts';
import { emitWithinTableFlagClaims } from './within-table.ts';
import { checkNoInflationClaims } from '../ci/trust-rating.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// Issue #435 attests the INFERRED interpretation of every column (its {type,
// format}) as a file-level DERIVED claim beside the #434 @column header, and
// grounds it in that header under #404. These tests fix the attestation's
// guarantees: the minimal encoding, the Looked-up readout, the file-level
// grounding, and the untouched observation stream.

const REF = loadReferenceData();

// A source that exercises every interpreted type: a callsign subject, an
// enumerated-category product carrying TWO distinct raws that collapse to one
// canonical (Full), a verbatim status, and a day-first date column.
function datedSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/dated.csv',
    vintage: '2026-01-01',
    columns: ['Callsign', 'Product', 'Status', 'CreatedDate'],
    subjectColumn: 'Callsign',
    categoryColumn: 'Product',
    headerLine: 1,
    rows: [
      { Callsign: 'M7TEE', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '03/05/1903' },
    ],
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'enumerated-category' },
      { type: 'string' },
      { type: 'date', format: 'DD/MM/YYYY' },
    ],
  };
}

describe('the interpretation object is the minimal {type, format} encoding', () => {
  it('Interpretation_WhenEncoded_IsTypeOptionallyColonFormat', () => {
    expect(encodeInterpretation({ type: 'callsign-token' })).toBe('callsign-token');
    expect(encodeInterpretation({ type: 'enumerated-category' })).toBe('enumerated-category');
    expect(encodeInterpretation({ type: 'date', format: 'DD/MM/YYYY' })).toBe('date:DD/MM/YYYY');
    expect(encodeInterpretation({ type: 'integer', format: 'thousands-separated-integer' })).toBe('integer:thousands-separated-integer');
  });

  it('Interpretation_WhenRoundTripped_SurvivesDecodeEncode', () => {
    for (const encoded of ['string', 'callsign-token', 'enumerated-category', 'date:DD/MM/YYYY', 'date:YYYY-MM-DD', 'integer:thousands-separated-integer', 'constructed-callsign']) {
      expect(encodeInterpretation(decodeInterpretation(encoded))).toBe(encoded);
    }
  });

  it('Interpretation_WhenObjectCarriesAnUnknownType_DecodeFailsLoud', () => {
    expect(() => decodeInterpretation('quantity:kg')).toThrow(/unknown column-interpretation type/);
  });
});

describe('the attestation rides the file-level manifest as a derived Looked-up claim', () => {
  it('InterpretationClaim_WhenEmitted_IsDerivedLookedUpOnTheSentinelOrdinal', () => {
    const source = datedSource();
    const claims = emitInterpretationClaims(source);
    expect(claims.length).toBe(source.columns.length);
    for (const claim of claims) {
      expect(claim.layer).toBe('derived');
      expect(claim.rule).toBe(COLUMN_INTERPRETATION_RULE);
      expect(claim.rawSubject).toBe('');
      expect(claim.provenance.ordinal).toBe(FILE_LEVEL_ORDINAL);
      expect(isFileLevelClaim(claim)).toBe(true);
      // Looked-up: the reading is asserted from our column spec, not published.
      expect(claimConfidence(claim)).toBe('Looked-up');
    }
  });

  it('InterpretationClaim_WhenEmitted_CarriesTheIndexInThePredicateAndTheReadingInTheObject', () => {
    const source = datedSource();
    const claims = emitInterpretationClaims(source);
    for (let index = 0; index < source.columns.length; index += 1) {
      const claim = claims.find(c => interpretationIndexOf(c.predicate) === index);
      expect(claim, `@interpretation/${index} present`).toBeDefined();
      expect(claim?.predicate).toBe(interpretationPredicate(index));
      expect(claim?.object).toBe(encodeInterpretation(interpretColumns(source)[index]));
    }
    // The date column reads out as day-first; the product as an enumerated category.
    expect(claims[3].object).toBe('date:DD/MM/YYYY');
    expect(claims[1].object).toBe('enumerated-category');
  });

  it('InterpretColumns_WhenTheHintIsAbsent_FailsLoudRatherThanGuessing', () => {
    const noHint: SourceObservationSet = { ...datedSource(), columnInterpretations: undefined };
    expect(hasColumnInterpretations(noHint)).toBe(false);
    expect(emitInterpretationClaims(noHint)).toEqual([]);
    expect(() => interpretColumns(noHint)).toThrow(/no columnInterpretations hint/);
  });

  it('InterpretColumns_WhenTheHintIsMisSized_FailsLoud', () => {
    const ragged: SourceObservationSet = { ...datedSource(), columnInterpretations: [{ type: 'callsign-token' }] as ColumnInterpretation[] };
    expect(() => interpretColumns(ragged)).toThrow(/align 1:1/);
  });
});

describe('the file-level attestation grounds in its @column basis (issue #404 / #435)', () => {
  it('InterpretationClaims_WhenAccompaniedByTheManifest_RaiseNoInflationViolation', () => {
    const source = datedSource();
    const stream = [...emitClaims(source), ...emitFileManifestClaims(source), ...emitInterpretationClaims(source)];
    expect(checkNoInflationClaims(stream)).toEqual([]);
  });

  it('WithinTableFlags_WhenAccompaniedByTheManifest_RaiseNoInflationViolation', () => {
    const source = datedSource();
    const stream = [...emitClaims(source), ...emitFileManifestClaims(source), ...emitWithinTableFlagClaims(source, REF)];
    // The Product column carries a genuine collision (Full + Amateur Full Radio
    // Licence), so a flag IS present - and it still grounds in @column.
    expect(stream.some(c => c.rule === 'within-table-normalisation-collision')).toBe(true);
    expect(checkNoInflationClaims(stream)).toEqual([]);
  });

  it('InterpretationClaim_WhenTheHeaderBasisIsMissing_IsCaughtAsAnInventedColumn', () => {
    // A derived @interpretation with no raw @column/<i> for the same file is an
    // invented column - the P0 grounding must catch it (the manifest is omitted).
    const source = datedSource();
    const stream = [...emitClaims(source), ...emitInterpretationClaims(source)];
    const violations = checkNoInflationClaims(stream);
    expect(violations.some(v => /invented column/.test(v.detail))).toBe(true);
  });
});

describe('the attestation leaves the observation stream untouched', () => {
  it('ObservationStream_WhenTheAttestationIsAdded_GainsOnlyFileLevelClaims', () => {
    const source = datedSource();
    const observations = emitClaims(source);
    // Every added claim rides the sentinel ordinal; none joins the 0..n-1 fold.
    for (const claim of [...emitInterpretationClaims(source), ...emitWithinTableFlagClaims(source, REF)]) {
      expect(isFileLevelClaim(claim)).toBe(true);
    }
    // The observation claims themselves are unchanged by the presence of the hint.
    expect(observations.every(c => c.provenance.ordinal >= 0)).toBe(true);
    expect(observations.some(isFileLevelClaim)).toBe(false);
  });
});
