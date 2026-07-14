import { describe, it, expect } from 'vitest';
import { explain } from './explain.ts';
import {
  emitLedger,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CALLSIGN_PATTERN_PREDICATE,
  CALLSIGN_PATTERN_RULE,
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  STRIPPED_COLLISION_RULE,
  STRIPPED_COLLISION_FLAG,
  FLAG_PREDICATE,
  PARSE_CALLSIGN_RULE,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';

// The working behind a derived claim is RECONSTRUCTED ON READ (issue #433): every
// scenario below builds a real ledger with emitLedger, then asks explain to
// reproduce a claim's object from its inputs alone. The load-bearing property is
// result === object — the shown working demonstrably reproduces the claim — and
// every input origin resolving to something real.

const REF = loadReferenceData();

// A synthetic source whose rows deliberately exercise every derived rule the
// ledger emits: the normalisation edges, the callsign-pattern shape, the parse
// attributes and their flags (including the product- and date-dependent flags),
// the reference-table lookups, and the whole-source stripped-collision.
function fixtureSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/fixture.csv',
    vintage: '2026-01-01',
    columns: ['Call Sign', 'Product', 'Original Start Date'],
    subjectColumn: 'Call Sign',
    categoryColumn: 'Product',
    originalStartDateColumn: 'Original Start Date',
    rows: [
      { 'Call Sign': 'M7TEE', 'Product': 'Amateur Foundation Radio Licence', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'm7tee', 'Product': '', 'Original Start Date': '' },
      { 'Call Sign': 'M0ASS', 'Product': '', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'M7XYZ', 'Product': 'Amateur Full Radio Licence', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'M7TEE ', 'Product': '', 'Original Start Date': '' },
      { 'Call Sign': 'MW7TEE', 'Product': 'Amateur Foundation Radio Licence', 'Original Start Date': '2020-01-01' },
    ],
  };
}

function ledgerFor(source: SourceObservationSet): Claim[] {
  return emitLedger(source, REF);
}

function derivedWithObject(ledger: readonly Claim[], predicate: string, object: string): Claim {
  const found = ledger.find(c => c.layer === 'derived' && c.predicate === predicate && c.object === object);
  if (found === undefined) throw new Error(`fixture is missing a derived ${predicate}=${object} claim`);
  return found;
}

describe('every derived claim in a source reproduces its object from its working', { tags: ['unit'] }, () => {
  it('EveryDerivedClaim_WhenExplained_ReproducesItsObject', () => {
    const ledger = ledgerFor(fixtureSource());
    const derived = ledger.filter(c => c.layer === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    for (const claim of derived) {
      const working = explain(claim, ledger, REF);
      expect(working.result).toBe(claim.object);
    }
  });

  it('EveryDerivedRule_WhenTheFixtureIsBuilt_IsRepresented', () => {
    // A green blanket loop is only meaningful if the fixture genuinely carries
    // every rule; this pins that coverage so a future emit change cannot quietly
    // hollow the loop out.
    const rules = new Set(ledgerFor(fixtureSource()).filter(c => c.layer === 'derived').map(c => c.rule));
    for (const rule of [CLEANED_CALLSIGN_RULE, PLACEHOLDER_FORM_RULE, CALLSIGN_PATTERN_RULE, LICENCE_CATEGORY_RULE, STRIPPED_COLLISION_RULE, PARSE_CALLSIGN_RULE]) {
      expect(rules.has(rule)).toBe(true);
    }
  });
});

describe('the normalisation-edge rules reconstruct from the raw token', { tags: ['unit'] }, () => {
  it('CleanedCallsignClaim_WhenExplained_TracesToTheRawSubjectClaim', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('M7TEE');
    expect(working.confidence).toBe('Computed');
    expect(working.inputs).toHaveLength(1);
    const [input] = working.inputs;
    expect(input.origin).toMatchObject({ kind: 'raw-claim', predicate: LISTED_PREDICATE });
    // The step trace names the upper-casing the cleaning applied.
    expect(working.steps.some(s => /upper-cased/.test(s.detail))).toBe(true);
  });

  it('PlaceholderFormClaim_WhenExplained_ReproducesThePlaceholderViaTheParser', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.rule === PLACEHOLDER_FORM_RULE && c.object === 'M#7TEE');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    expect(explain(claim, ledger, REF).result).toBe('M#7TEE');
  });

  it('CallsignPatternClaim_WhenExplained_ReproducesTheShapeFromTheRawToken', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = derivedWithObject(ledger, CALLSIGN_PATTERN_PREDICATE, 'ANAAA');
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('ANAAA');
    expect(working.rule).toBe(CALLSIGN_PATTERN_RULE);
  });
});

describe('the licence-category rule reconstructs from the product cell and the reference row', { tags: ['unit'] }, () => {
  it('DerivedLicenceCategoryClaim_WhenExplained_ReproducesItsObjectFromTheReferenceRow', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = derivedWithObject(ledger, LICENCE_CATEGORY_PREDICATE, 'Foundation');
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('Foundation');
    expect(working.confidence).toBe('Looked-up');
    const product = working.inputs.find(i => i.role === 'product-cell');
    const row = working.inputs.find(i => i.role === 'category-row');
    expect(product?.value).toBe('Amateur Foundation Radio Licence');
    expect(row?.origin).toMatchObject({ kind: 'reference-row', file: 'licence-category.csv', key: 'Amateur Foundation Radio Licence' });
  });
});

describe('the parse-callsign fan-out reconstructs each attribute and flag', { tags: ['unit'] }, () => {
  it('ParseStatusClaim_WhenExplained_ReproducesTheStatusFromTheToken', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.rule === PARSE_CALLSIGN_RULE && c.predicate === PARSE_STATUS_PREDICATE && c.rawSubject === 'M7TEE');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    expect(explain(claim, ledger, REF).result).toBe('parsed');
  });

  it('ImpliedClassClaim_WhenExplained_ReproducesTheClassFromThePrefixFormatsRow', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.predicate === IMPLIED_CLASS_PREDICATE && c.rawSubject === 'M7TEE');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('Foundation');
    const row = working.inputs.find(i => i.origin.kind === 'reference-row');
    expect(row?.origin).toMatchObject({ file: 'prefix-formats.csv', key: 'M7' });
  });

  it('PrefixSeriesClaim_WhenExplained_ReproducesTheSeriesWithoutAReferenceRow', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.predicate === PREFIX_SERIES_PREDICATE && c.rawSubject === 'M0ASS');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('M0');
    expect(working.inputs.every(i => i.origin.kind === 'raw-claim')).toBe(true);
  });

  it('ForbiddenSuffixFlag_WhenExplained_CarriesTheForbiddenSuffixesReferenceRow', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.predicate === FLAG_PREDICATE && c.object === 'forbidden-suffix' && c.rawSubject === 'M0ASS');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('forbidden-suffix');
    const row = working.inputs.find(i => i.origin.kind === 'reference-row');
    expect(row?.origin).toMatchObject({ file: 'forbidden-suffixes.csv', key: 'ASS' });
  });

  it('TemporalForbiddenFlag_WhenExplained_ConsumesTheOriginalStartDateCell', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.predicate === FLAG_PREDICATE && c.object === 'forbidden-suffix-issued-after-first-known-list' && c.rawSubject === 'M0ASS');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('forbidden-suffix-issued-after-first-known-list');
    const date = working.inputs.find(i => i.role === 'original-start-date');
    expect(date?.value).toBe('2020-01-01');
    expect(date?.origin).toMatchObject({ kind: 'raw-claim', predicate: 'Original Start Date' });
  });

  it('ClassProductMismatchFlag_WhenExplained_ConsumesTheProductCellAndReproducesTheFlag', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.predicate === FLAG_PREDICATE && c.object === 'class-product-mismatch' && c.rawSubject === 'M7XYZ');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('class-product-mismatch');
    const product = working.inputs.find(i => i.role === 'product-cell');
    expect(product?.value).toBe('Amateur Full Radio Licence');
    // Input sufficiency: re-running the parser over ONLY the explained product
    // cell reproduces the flag (the working is not a plausible-looking subset).
    expect(parseCallsign('M7XYZ', product?.value ?? '', REF).flags).toContain('class-product-mismatch');
  });
});

describe('the stripped-collision rule resolves a sibling observation over the source ledger', { tags: ['unit'] }, () => {
  it('StrippedCollisionFlag_WhenExplained_PointsToTheSiblingRowWhoseSubjectIsTheStrippedForm', () => {
    const ledger = ledgerFor(fixtureSource());
    const claim = ledger.find(c => c.rule === STRIPPED_COLLISION_RULE && c.rawSubject === 'M7TEE ');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe(STRIPPED_COLLISION_FLAG);
    const sibling = working.inputs.find(i => i.origin.kind === 'sibling-observation');
    expect(sibling?.value).toBe('M7TEE');
    const origin = sibling?.origin;
    if (origin === undefined || origin.kind !== 'sibling-observation') throw new Error('expected a sibling-observation origin');
    // The resolved sibling is a real @listed observation whose raw subject is the
    // stripped form.
    const resolved = ledger.find(c => c.predicate === LISTED_PREDICATE && c.provenance.ordinal === origin.ordinal);
    expect(resolved?.rawSubject).toBe('M7TEE');
  });
});

describe('explain fails loud on anything it cannot honestly reconstruct', { tags: ['unit'] }, () => {
  it('RawClaim_WhenExplained_ThrowsRatherThanInventingAWorking', () => {
    const ledger = ledgerFor(fixtureSource());
    const raw = ledger.find(c => c.layer === 'raw' && c.predicate === LISTED_PREDICATE);
    expect(raw).toBeDefined();
    if (raw === undefined) return;
    expect(() => explain(raw, ledger, REF)).toThrow(/raw claim/);
  });

  it('DerivedClaimWithAnUnknownRule_WhenExplained_ThrowsAsAnUnexplainableGap', () => {
    const ledger = ledgerFor(fixtureSource());
    const bogus: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: 'mystery', object: 'x', rule: 'no-such-rule',
      provenance: { sourceFile: 'synthetic/fixture.csv', ordinal: 0, vintage: '2026-01-01' },
    };
    expect(() => explain(bogus, [...ledger, bogus], REF)).toThrow(/unknown rule/);
  });

  it('DerivedClaimWithNoRule_WhenExplained_ThrowsAsUnattributable', () => {
    const noRule: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: NORMALISES_TO_PREDICATE, object: 'M7TEE',
      provenance: { sourceFile: 'synthetic/fixture.csv', ordinal: 0, vintage: '2026-01-01' },
    };
    expect(() => explain(noRule, [], REF)).toThrow(/no rule/);
  });
});
