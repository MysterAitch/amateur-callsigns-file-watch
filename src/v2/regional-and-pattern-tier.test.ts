import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  emitLedger,
  emitParseAttributeClaims,
  emitCallsignPatternClaims,
  RSL_PREDICATE,
  CALLSIGN_PATTERN_PREDICATE,
  CALLSIGN_PATTERN_RULE,
  PARSE_CALLSIGN_RULE,
  claimConfidence,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { serialiseClaimsJsonl, parseClaimsJsonl } from './serialise.ts';
import { buildLedgerSqlite } from './build-ledger-db.ts';
import { buildCompactLedgerSqlite } from './build-ledger-db-compact.ts';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';
import { callsignPattern } from '../shared/stats.ts';
import { checkNoInflationClaims } from '../ci/trust-rating.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the two additive DERIVED tiers of issue #422 (unblocking the
// remaining report folds of #361 Phase B):
//   - rsl             : the Regional Secondary Locator component parseCallsign
//                       splits out of the token, projected as a derived claim so
//                       the regional-identifiers fold can aggregate it.
//   - callsign-pattern: the character-shape taxonomy callsignPattern computes
//                       over the raw token, projected so the callsign-patterns
//                       fold can aggregate it.
// Both are PROJECTIONS of existing derivation functions (parseCallsign /
// callsignPattern), consumed here and never re-derived. The correctness gates
// are: equivalence to those functions, the no-invention discipline (a claim only
// where a value genuinely resolves), the no-inflation invariant (#404), and
// compact-DB parity with the fat one-row-per-claim table.

const REF = loadReferenceData();

// A representative callsign set spanning the resolutions the two tiers must
// project faithfully: a core call bearing an RSL (MW7ABC -> rsl 'W'), a plain
// RSL-less core call (M7ABC -> no rsl), a visitor call bearing a country letter
// (MW/F1ABC -> rsl 'W'), a special-event GB call (no rsl slot), a whitespace-
// damaged token (whose raw pattern must surface the {U+XXXX} marker), and a
// token that does not parse at all (no rsl, yet a genuine character shape).
const RSL_BEARING = 'MW7ABC';
const PLAIN_CALL = 'M7ABC';
const VISITOR_CALL = 'MW/F1ABC';
const SPECIAL_EVENT = 'GB0SES';
// A trailing NON-BREAK SPACE (the documented NBSP artefact): the raw-form pattern
// must surface the {U+00A0} marker the taxonomy exists to expose.
const WHITESPACE_CALL = 'M7TEE ';
const UNPARSEABLE = '12345';

const FIXTURE_ROWS: readonly Record<string, string>[] = [
  { 'Call Sign': RSL_BEARING, Product: 'Amateur Foundation Radio Licence' },
  { 'Call Sign': PLAIN_CALL, Product: 'Amateur Foundation Radio Licence' },
  { 'Call Sign': VISITOR_CALL, Product: '' },
  { 'Call Sign': SPECIAL_EVENT, Product: '' },
  { 'Call Sign': WHITESPACE_CALL, Product: 'Full' },
  { 'Call Sign': UNPARSEABLE, Product: '' },
];

const FIXTURE_SOURCE: SourceObservationSet = {
  sourceFile: 'fixture/regional-and-pattern/rows.csv',
  vintage: '2024-01',
  columns: ['Call Sign', 'Product'],
  subjectColumn: 'Call Sign',
  categoryColumn: 'Product',
  rows: FIXTURE_ROWS,
};

function rslObjectsFor(claims: readonly Claim[], rawSubject: string): string[] {
  return claims
    .filter(c => c.rawSubject === rawSubject && c.predicate === RSL_PREDICATE && c.layer === 'derived')
    .map(c => c.object)
    .sort();
}

function patternObjectsFor(claims: readonly Claim[], rawSubject: string): string[] {
  return claims
    .filter(c => c.rawSubject === rawSubject && c.predicate === CALLSIGN_PATTERN_PREDICATE && c.layer === 'derived')
    .map(c => c.object);
}

describe('rsl tier — equivalence to parseCallsign', () => {
  it('RslClaims_ForEveryCallsign_ProjectExactlyParseCallsignRsl', () => {
    // The tier is a projection of parseCallsign.rsl: for each subject the rsl
    // claim rides iff (and equals) the non-empty rsl the lifted parser resolved.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    for (const row of FIXTURE_ROWS) {
      const subject = row['Call Sign'];
      const parsed = parseCallsign(subject, row.Product, REF);
      const expected = parsed.rsl === '' ? [] : [parsed.rsl];
      expect(rslObjectsFor(claims, subject), `${subject} rsl`).toEqual(expected);
    }
  });

  it('RslClaims_CoreCallWithRegionalLocator_CarryTheLocatorLetter', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(rslObjectsFor(claims, RSL_BEARING)).toEqual(['W']);
    // Every emitted rsl claim is derived and attributed to the one parse rule.
    for (const claim of claims.filter(c => c.predicate === RSL_PREDICATE)) {
      expect(claim.layer).toBe('derived');
      expect(claim.rule).toBe(PARSE_CALLSIGN_RULE);
      expect(claimConfidence(claim)).toBe('Computed');
    }
  });

  it('RslClaims_VisitorCallWithCountryLetter_CarryThatLetter', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(rslObjectsFor(claims, VISITOR_CALL)).toEqual(['W']);
  });

  it('RslClaims_PlainRslLessCall_EmitNoRslClaim', () => {
    // The no-invention discipline: an RSL-less core call resolves no rsl, so none
    // is conjured — mirroring how prefix_series/implied_class skip an absent value.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(rslObjectsFor(claims, PLAIN_CALL)).toEqual([]);
  });

  it('RslClaims_SpecialEventCall_EmitNoRslClaim', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(rslObjectsFor(claims, SPECIAL_EVENT)).toEqual([]);
  });

  it('RslClaims_WhenTokenDoesNotParse_EmitNoRslClaim', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(rslObjectsFor(claims, UNPARSEABLE)).toEqual([]);
  });
});

describe('callsign-pattern tier — equivalence to callsignPattern', () => {
  it('PatternClaims_ForEveryNonEmptyToken_ProjectExactlyCallsignPattern', () => {
    // The tier is a projection of callsignPattern over the RAW token: one claim
    // per non-empty subject, its object the lifted shape verbatim.
    const claims = emitCallsignPatternClaims(FIXTURE_SOURCE);
    for (const row of FIXTURE_ROWS) {
      const subject = row['Call Sign'];
      expect(patternObjectsFor(claims, subject), `${subject} pattern`).toEqual([callsignPattern(subject)]);
    }
  });

  it('PatternClaims_PlainCall_CarryTheUppercaseDigitShape', () => {
    const claims = emitCallsignPatternClaims(FIXTURE_SOURCE);
    expect(patternObjectsFor(claims, PLAIN_CALL)).toEqual(['ANAAA']);
    for (const claim of claims) {
      expect(claim.layer).toBe('derived');
      expect(claim.rule).toBe(CALLSIGN_PATTERN_RULE);
      expect(claimConfidence(claim)).toBe('Computed');
    }
  });

  it('PatternClaims_WhitespaceBearingToken_SurfaceTheCodepointMarkerFromTheRawForm', () => {
    // The tier reads the RAW subject (not the cleaned entity) precisely so the
    // whitespace artefact the taxonomy exists to expose stays visible.
    const claims = emitCallsignPatternClaims(FIXTURE_SOURCE);
    expect(patternObjectsFor(claims, WHITESPACE_CALL)).toEqual(['ANAAA{U+00A0}']);
  });

  it('PatternClaims_UnparseableToken_StillCarryItsCharacterShape', () => {
    // Unlike the parse attributes, a shape is defined for an unparseable token —
    // its characters still map — so it is described, never dropped.
    const claims = emitCallsignPatternClaims(FIXTURE_SOURCE);
    expect(patternObjectsFor(claims, UNPARSEABLE)).toEqual(['NNNNN']);
  });

  it('PatternClaims_WhenSubjectBlank_EmitNothing', () => {
    // A blank anchor row yields the empty pattern, hence no claim — the same
    // silence the parse-attribute tier keeps on an empty subject.
    const blankSource: SourceObservationSet = { ...FIXTURE_SOURCE, rows: [{ 'Call Sign': '', Product: '' }] };
    expect(emitCallsignPatternClaims(blankSource)).toEqual([]);
  });
});

describe('the two tiers — coexist with the existing layers', () => {
  it('Ledger_WhenTiersAdded_KeepRawAndExistingDerivedClaimsUnchanged', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    // The raw layer is untouched.
    expect(ledger.some(c => c.layer === 'raw' && c.rawSubject === RSL_BEARING && c.predicate === '@listed')).toBe(true);
    // The existing derived tiers still ride.
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === 'normalises_to' && c.rawSubject === RSL_BEARING)).toBe(true);
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === 'parse_status' && c.rawSubject === RSL_BEARING)).toBe(true);
    // And the two new tiers are genuinely present.
    expect(ledger.some(c => c.predicate === RSL_PREDICATE)).toBe(true);
    expect(ledger.some(c => c.predicate === CALLSIGN_PATTERN_PREDICATE)).toBe(true);
  });
});

describe('the two tiers — the no-inflation invariant (#404)', () => {
  it('ExtendedLedger_WhenCarryingRslAndPatternClaims_PassesTheNoInflationCheck', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    // The sample genuinely carries both new tiers, so a green result is
    // meaningful: each is derived, rule-attributed, reads out Computed, and
    // traces to a raw basis for its subject in the same source.
    expect(ledger.some(c => c.predicate === RSL_PREDICATE)).toBe(true);
    expect(ledger.some(c => c.predicate === CALLSIGN_PATTERN_PREDICATE)).toBe(true);
    expect(checkNoInflationClaims(ledger)).toEqual([]);
  });
});

describe('the two tiers — serialisation round-trip', () => {
  it('RslAndPatternClaims_WhenSerialisedAndReparsed_SurviveIdentically', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    const reparsed = parseClaimsJsonl(serialiseClaimsJsonl(ledger));
    const ours = (claims: readonly Claim[]): Claim[] =>
      claims.filter(c => c.predicate === RSL_PREDICATE || c.predicate === CALLSIGN_PATTERN_PREDICATE);
    expect(ours(reparsed)).toEqual(ours(ledger));
  });
});

describe('the two tiers — compact-DB parity', () => {
  it('CompactClaimsView_WhenLedgerHasRslAndPatternClaims_ReconstructsThemIdenticallyToFatTable', () => {
    // The compact schema cannot run the derivations in its reconstruction VIEW,
    // so both tiers are stored explicitly (dictionary-encoded) and reconstructed.
    // This asserts parity: the fat table and the compact VIEW return an identical
    // multiset for the two new predicates, so the compact build stays a drop-in.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regional-pattern-parity-'));
    try {
      const ledgerDir = path.join(workDir, 'ledger');
      fs.mkdirSync(ledgerDir, { recursive: true });
      const ledger = emitLedger(FIXTURE_SOURCE, REF);
      fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(ledger));

      const fatPath = path.join(workDir, 'fat.sqlite');
      const compactPath = path.join(workDir, 'compact.sqlite.png');
      buildLedgerSqlite(ledgerDir, fatPath);
      buildCompactLedgerSqlite(ledgerDir, compactPath);

      const rowsFor = (file: string): Record<string, unknown>[] => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          return db.prepare(
            `SELECT layer, raw_subject, cleaned, entity, predicate, object, IFNULL(rule, '') AS rule, source_file, ordinal, vintage
             FROM claims WHERE predicate IN (?, ?) ORDER BY raw_subject, predicate, object`,
          ).all(RSL_PREDICATE, CALLSIGN_PATTERN_PREDICATE) as Record<string, unknown>[];
        } finally {
          db.close();
        }
      };

      const fatRows = rowsFor(fatPath);
      const compactRows = rowsFor(compactPath);
      const expectedCount = ledger.filter(c => c.predicate === RSL_PREDICATE || c.predicate === CALLSIGN_PATTERN_PREDICATE).length;
      expect(fatRows.length).toBe(expectedCount);
      expect(compactRows).toEqual(fatRows);
      // Every reconstructed row is derived and carries the expected rule.
      for (const row of compactRows) {
        expect(row.layer).toBe('derived');
        expect(row.rule).toBe(row.predicate === RSL_PREDICATE ? PARSE_CALLSIGN_RULE : CALLSIGN_PATTERN_RULE);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});
