import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  runInterpretationOracle,
  assertInterpretationOracle,
  collectInterpretedSources,
  checkAttestedFormatReparses,
  checkInterpretationClaimsAgainstCode,
  checkFlagsReproducibleAndComplete,
} from './interpretation-oracle.ts';
import {
  emitInterpretationClaims,
  interpretationPredicate,
  COLUMN_INTERPRETATION_RULE,
  FILE_LEVEL_ORDINAL,
  type Claim,
  type SourceObservationSet,
} from '../v2/claim.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { time, perfReport } from '../shared/perf.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The interpretation-attestation oracle (issue #435, ADR 0018) proves, over the
// REAL corpus, that (1) every attested format re-parses its whole column, (2) no
// stored interpretation drifts from the code, and (3) every within-table flag
// reproduces and is complete. The negative cases below prove the checks CATCH the
// failures they exist for.

const REF = loadReferenceData();

// HOISTED CORPUS LOAD (#1017). Three tests below each called
// collectInterpretedSources() independently, so the whole-corpus load ran THREE
// times for one file - ~51 s of which the loads were the overwhelming majority.
// Loading once in a hook removes the work rather than redistributing it, which
// splitting the file into three would not: each fragment would pay its own load.
//
// SAFE because the value is READ-ONLY here. Every consumer
// (assertInterpretationOracle / runInterpretationOracle / the claim sweep) only
// reads the sources; none mutates them, so sharing one array across the three
// tests cannot make a result depend on execution order. If a future test needs
// to mutate, it must take its own copy rather than quietly reintroduce coupling.
let sources: ReturnType<typeof collectInterpretedSources>;
beforeAll(() => {
  sources = time('interpretation-oracle: collectInterpretedSources (hoisted)', () => collectInterpretedSources());
});
afterAll(() => { perfReport({ entrypoint: 'interpretation-oracle.test' }); });

describe('the interpretation oracle holds over the whole real corpus', { tags: ['data-validity'] }, () => {
  it('EveryInterpretedSource_WhenCheckedAgainstItsData_PassesAllInterpretationSelfChecks', () => {
    const report = time('interpretation-oracle: assertInterpretationOracle', () => assertInterpretationOracle(sources, REF));
    // The corpus genuinely exercises the checks: interpreted sources are present,
    // and both date and enumerated-category columns are among them.
    expect(report.sourcesChecked).toBeGreaterThan(0);
  });

  it('WithinTableFlags_WhenSweptOverTheRealCorpus_AreReportedNotSwallowed', () => {
    // The strict converter rejects mixed dates, so no date flags survive intake -
    // but the report EXPOSES whatever it finds, so within-table mixing is visible
    // data rather than a silent pass.
    const report = time('interpretation-oracle: runInterpretationOracle', () => runInterpretationOracle(sources, REF));
    expect(report.violations).toEqual([]);
    // A durable, checkable statement of the current corpus. The 2024-09 register
    // snapshot genuinely mixes raw product spellings that normalise to the same
    // licence category (the special-event family: plain and NoV spellings fold
    // together per reference-data/licence-category.csv), and the oracle surfaces
    // that mixing rather than swallowing it - resolve AND flag. Any change to
    // this list documents the surprise.
    expect(report.surfacedFlags).toEqual([
      {
        columnHeader: 'Product',
        object: 'Permanent Special Event Station',
        rule: 'within-table-normalisation-collision',
        sourceFile: 'foi/ofcom-2024-09--every-radio-callsign--all-callsigns/every-radio-callsign-spreadsheet.csv',
      },
      {
        columnHeader: 'Product',
        object: 'Special Event Station',
        rule: 'within-table-normalisation-collision',
        sourceFile: 'foi/ofcom-2024-09--every-radio-callsign--all-callsigns/every-radio-callsign-spreadsheet.csv',
      },
    ]);
  });
});

// A constructed source whose CreatedDate column is attested day-first but whose
// data betrays the attestation, and whose Product column collides two vocabularies.
function source(rows: readonly Record<string, string>[]): SourceObservationSet {
  return {
    sourceFile: 'synthetic/oracle.csv',
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

describe('the load-bearing re-parse check catches a wrong or mixed date attestation', { tags: ['unit'] }, () => {
  it('AttestedDayFirstColumn_WhenAValueIsIsoShaped_IsCaught', () => {
    // A YYYY-MM-DD value in a column attested DD/MM/YYYY - the attestation is
    // wrong (or the column mixes). The re-parse check must fail loud.
    const bad = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '2019-01-15' },
    ]);
    const violations = checkAttestedFormatReparses(bad);
    expect(violations.some(v => v.check === 'format-reparses')).toBe(true);
  });

  it('AttestedDayFirstColumn_WhenEveryValueParses_RaisesNothing', () => {
    const good = source([
      { Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '03/05/1903 17:07' },
    ]);
    expect(checkAttestedFormatReparses(good)).toEqual([]);
  });
});

describe('the drift check catches a stored interpretation disagreeing with the code', { tags: ['unit'] }, () => {
  it('StoredInterpretation_WhenItDisagreesWithTheCode_IsCaught', () => {
    const src = source([{ Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' }]);
    // A stale committed claim: the CreatedDate column stored as an integer.
    const stale: Claim[] = emitInterpretationClaims(src).map(c =>
      c.predicate === interpretationPredicate(3)
        ? { ...c, object: 'integer:thousands-separated-integer' }
        : c);
    const violations = checkInterpretationClaimsAgainstCode(src, stale);
    expect(violations.some(v => v.check === 'claim-code-drift' && /stored .* != code/.test(v.detail))).toBe(true);
  });

  it('FreshlyEmittedInterpretation_WhenCheckedAgainstTheCode_NeverDrifts', () => {
    const src = source([{ Callsign: 'M7TEE', Product: 'Full', Status: 'Allocated', CreatedDate: '15/01/2019' }]);
    expect(checkInterpretationClaimsAgainstCode(src, emitInterpretationClaims(src))).toEqual([]);
  });
});

describe('the flag reproducibility + completeness check holds on a constructed collision', { tags: ['unit'] }, () => {
  it('CollidingProductColumn_WhenSwept_RaisesAReproducibleCompleteFlag', () => {
    const collided = source([
      { Callsign: 'M7TEE', Product: 'Amateur Full Radio Licence', Status: 'Allocated', CreatedDate: '15/01/2019' },
      { Callsign: 'G0ABC', Product: 'Full', Status: 'Allocated', CreatedDate: '16/01/2019' },
    ]);
    expect(checkFlagsReproducibleAndComplete(collided, REF)).toEqual([]);
    const report = runInterpretationOracle([collided], REF);
    expect(report.violations).toEqual([]);
    expect(report.surfacedFlags.map(f => f.object)).toContain('Full');
  });
});

describe('the attestation adds only file-level claims across the real corpus', { tags: ['data-validity'] }, () => {
  it('EveryInterpretationClaim_WhenEmittedOverTheCorpus_RidesTheSentinelOrdinalAsDerivedLookedUp', () => {
    for (const src of assertNonEmpty(sources, 'interpreted sources')) {
      for (const claim of emitInterpretationClaims(src)) {
        expect(claim.provenance.ordinal).toBe(FILE_LEVEL_ORDINAL);
        expect(claim.layer).toBe('derived');
        expect(claim.rule).toBe(COLUMN_INTERPRETATION_RULE);
      }
    }
  });
});
