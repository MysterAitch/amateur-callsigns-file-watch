import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  emitLedger,
  emitParseAttributeClaims,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  RSL_PREDICATE,
  FLAG_PREDICATE,
  PARSE_CALLSIGN_RULE,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { serialiseClaimsJsonl, parseClaimsJsonl } from './serialise.ts';
import { buildLedgerSqlite } from './build-ledger-db.ts';
import { buildCompactLedgerSqlite } from './build-ledger-db-compact.ts';
import { registerSourcesFor, loadRegisterSource } from './collectors/foi-register.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';
import { checkNoInflationClaims } from '../ci/trust-rating.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the T1 PARSE-DERIVED attribute tier (issue #406, enabling the
// reports-fold cutover of #361): beside the verbatim raw layer, the ledger now
// carries the per-callsign attributes parseCallsign COMPUTES from the raw token -
// its prefix series, implied class, parse status, and each raised flag - as
// rule-attributed derived claims. The parse is LIFTED whole from components.ts;
// this tier only PROJECTS its output. The correctness gate is equivalence to
// parseCallsign (never a fresh vocabulary), the no-invention discipline (a claim
// only where the parse yields a value), and the no-inflation invariant (#404 /
// ADR 0014): every T1 claim is derived, rule-attributed, and traces to a raw
// basis, so it can never surface at a trust rating its provenance does not earn.

const REF = loadReferenceData();

// A representative callsign set spanning the parse determinations the tier must
// project faithfully: a Foundation M7, a Full G-call, a lowercase artefact
// (a raised flag), a Foundation call whose disclosed product contradicts its
// implied class (proving the product is CONSUMED by the parse), a special-event
// GB call (prefix series but no implied class), a visitor call (no prefix
// series), and a token that does not parse at all (a status but no series/class,
// and no invented attribute). The subject column is Ofcom's own 'Call Sign'
// header and the product column its 'Product' header.
const FIXTURE_ROWS: readonly Record<string, string>[] = [
  { 'Call Sign': 'M7ABC', Product: 'Amateur Foundation Radio Licence' },
  { 'Call Sign': 'G0XYZ', Product: 'Full' },
  { 'Call Sign': 'm7def', Product: 'Amateur Foundation Radio Licence' },
  { 'Call Sign': 'M7GHI', Product: 'Amateur Full Radio Licence' },
  { 'Call Sign': 'GB0SES', Product: '' },
  { 'Call Sign': 'M/F1ABC', Product: '' },
  { 'Call Sign': '12345', Product: '' },
];

const FIXTURE_SOURCE: SourceObservationSet = {
  sourceFile: 'fixture/parse-attribute/rows.csv',
  vintage: '2024-01',
  columns: ['Call Sign', 'Product'],
  subjectColumn: 'Call Sign',
  categoryColumn: 'Product',
  rows: FIXTURE_ROWS,
};

// The T1 predicates, so a fold can filter the tier out of the full ledger.
const T1_PREDICATES = new Set([PARSE_STATUS_PREDICATE, PREFIX_SERIES_PREDICATE, IMPLIED_CLASS_PREDICATE, FLAG_PREDICATE]);

function t1ClaimsOf(claims: readonly Claim[]): Claim[] {
  return claims.filter(claim => claim.layer === 'derived' && T1_PREDICATES.has(claim.predicate));
}

function claimsFor(claims: readonly Claim[], rawSubject: string): Claim[] {
  return t1ClaimsOf(claims).filter(claim => claim.rawSubject === rawSubject);
}

function objectsFor(claims: readonly Claim[], rawSubject: string, predicate: string): string[] {
  return claimsFor(claims, rawSubject).filter(c => c.predicate === predicate).map(c => c.object).sort();
}

describe('T1 parse-attribute tier — equivalence to parseCallsign', { tags: ['unit'] }, () => {
  it('ParseAttributeClaims_ForEveryCallsign_ProjectExactlyParseCallsignOutput', () => {
    // The whole tier is a projection of parseCallsign, built as an equivalence
    // assertion against the lifted parser (not hard-coded strings): for each
    // subject the emitted claims are precisely {parse_status} ∪ {prefix_series if
    // any} ∪ {implied_class if any} ∪ {one flag per raised flag}, each derived,
    // each attributed to the one named parse rule.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    for (const row of FIXTURE_ROWS) {
      const subject = row['Call Sign'];
      const parsed = parseCallsign(subject, row.Product, REF);

      const expected = new Map<string, string[]>();
      expected.set(PARSE_STATUS_PREDICATE, [parsed.parseStatus]);
      if (parsed.prefixSeries !== '') expected.set(PREFIX_SERIES_PREDICATE, [parsed.prefixSeries]);
      if (parsed.impliedClass !== '') expected.set(IMPLIED_CLASS_PREDICATE, [parsed.impliedClass]);
      if (parsed.flags.length > 0) expected.set(FLAG_PREDICATE, [...parsed.flags].sort());

      for (const [predicate, objects] of expected) {
        expect(objectsFor(claims, subject, predicate), `${subject} ${predicate}`).toEqual(objects);
      }
      // No predicate beyond the expected set was emitted for this subject.
      const emittedPredicates = new Set(claimsFor(claims, subject).map(c => c.predicate));
      expect([...emittedPredicates].sort()).toEqual([...expected.keys()].sort());

      // Every emitted T1 claim is derived and carries the one named parse rule.
      for (const claim of claimsFor(claims, subject)) {
        expect(claim.layer).toBe('derived');
        expect(claim.rule).toBe(PARSE_CALLSIGN_RULE);
      }
    }
  });

  it('ParseAttributeClaims_FoundationM7_CarryParsedStatusPrefixSeriesAndImpliedClass', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'M7ABC', PARSE_STATUS_PREDICATE)).toEqual(['parsed']);
    expect(objectsFor(claims, 'M7ABC', PREFIX_SERIES_PREDICATE)).toEqual(['M7']);
    expect(objectsFor(claims, 'M7ABC', IMPLIED_CLASS_PREDICATE)).toEqual(['Foundation']);
    // A clean Foundation call raises no flag.
    expect(objectsFor(claims, 'M7ABC', FLAG_PREDICATE)).toEqual([]);
  });

  it('ParseAttributeClaims_FullGCall_ImplyTheFullStationClass', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'G0XYZ', PREFIX_SERIES_PREDICATE)).toEqual(['G0']);
    expect(objectsFor(claims, 'G0XYZ', IMPLIED_CLASS_PREDICATE)).toEqual(['Full']);
  });

  it('ParseAttributeClaims_LowercaseToken_SurfaceTheRaisedFlagAsItsOwnClaim', () => {
    // A lowercase artefact is a raised flag; it rides as a distinct flag claim
    // (object = the flag name) so a report folds flagged callsigns by object.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'm7def', FLAG_PREDICATE)).toContain('lowercase');
    // The token still parses, so its series/class ride too.
    expect(objectsFor(claims, 'm7def', PREFIX_SERIES_PREDICATE)).toEqual(['M7']);
  });

  it('ParseAttributeClaims_WhenDisclosedProductContradictsImpliedClass_RaiseTheMismatchFlag', () => {
    // The tier parses WITH the source's disclosed product, so a class-vs-product
    // contradiction the parser detects becomes a real flag claim rather than
    // being invisible — a Foundation M7 call sold under a Full product.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'M7GHI', IMPLIED_CLASS_PREDICATE)).toEqual(['Foundation']);
    expect(objectsFor(claims, 'M7GHI', FLAG_PREDICATE)).toContain('class-product-mismatch');
  });

  it('ParseAttributeClaims_SpecialEventCall_CarryPrefixSeriesButNoImpliedClass', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'GB0SES', PARSE_STATUS_PREDICATE)).toEqual(['special-event']);
    expect(objectsFor(claims, 'GB0SES', PREFIX_SERIES_PREDICATE)).toEqual(['GB']);
    expect(objectsFor(claims, 'GB0SES', IMPLIED_CLASS_PREDICATE)).toEqual([]);
  });

  it('ParseAttributeClaims_VisitorCall_CarryStatusButNoPrefixSeries', () => {
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, 'M/F1ABC', PARSE_STATUS_PREDICATE)).toEqual(['visitor']);
    expect(objectsFor(claims, 'M/F1ABC', PREFIX_SERIES_PREDICATE)).toEqual([]);
    expect(objectsFor(claims, 'M/F1ABC', IMPLIED_CLASS_PREDICATE)).toEqual([]);
  });

  it('ParseAttributeClaims_WhenTokenDoesNotParse_EmitTheStatusButInventNoSeriesOrClass', () => {
    // The no-invention discipline: an unparseable token still gets its honest
    // status, but NO prefix_series / implied_class / flag claim is conjured where
    // the parse yielded no value.
    const claims = emitParseAttributeClaims(FIXTURE_SOURCE, REF);
    expect(objectsFor(claims, '12345', PARSE_STATUS_PREDICATE)).toEqual(['unparseable']);
    expect(claimsFor(claims, '12345').map(c => c.predicate)).toEqual([PARSE_STATUS_PREDICATE]);
  });

  it('ParseAttributeClaims_WhenSubjectBlank_EmitNothing', () => {
    // An all-blank anchor row carries no callsign to parse, so the tier is silent
    // — mirroring how the normalisation edges skip an empty subject.
    const blankSource: SourceObservationSet = {
      ...FIXTURE_SOURCE,
      rows: [{ 'Call Sign': '', Product: '' }],
    };
    expect(emitParseAttributeClaims(blankSource, REF)).toEqual([]);
  });
});

describe('T1 parse-attribute tier — equivalence over a real register snapshot', { tags: ['data-validity'] }, () => {
  it('ParseAttributeClaims_WhenBuiltFromRealSnapshot_ProjectExactlyParseCallsignOverEveryRow', () => {
    // The corpus-scale correctness gate (issue #406), mirroring the
    // licence-category tier's real-snapshot oracle: over a FULL real register the
    // emitted T1 tier must be EQUIVALENT to parseCallsign itself — the same
    // attributes carrying the same values, per observation — never a fresh
    // vocabulary and never drifting from the lifted parser. The equivalence is
    // built from parseCallsign directly (not hard-coded strings), so a green
    // result proves the ledger projection tracks the parser row-for-row.
    // ofcom-2023-12-07 is a full register disclosing both a product and an
    // original-start-date column, so every parse input the emit consumes is
    // present and both extra flags (class-product-mismatch, the temporal
    // forbidden-suffix flag) are reachable.
    const entry = 'ofcom-2023-12-07--open-data-call-sign-list--all-callsigns';
    const meta = readFoiEntryMeta(defaultFoiDir(), entry);
    const source = registerSourcesFor(meta).find(s => s.productColumn !== null);
    expect(source).toBeDefined();
    if (source === undefined) return;

    const observationSet = loadRegisterSource(defaultFoiDir(), entry, meta, source);
    const ledger = emitLedger(observationSet, REF);

    const subjectColumn = observationSet.subjectColumn;
    const productColumn = observationSet.categoryColumn;
    const startDateColumn = observationSet.originalStartDateColumn;

    // Reduce a set of claims to one signature per OBSERVATION, keyed by ordinal —
    // a raw subject can recur across rows but an observation cannot, so keying by
    // ordinal keeps genuine double-listings apart. Each signature is a
    // predicate -> sorted-objects map (flag order is not significant).
    type Signature = Record<number, Record<string, string[]>>;
    const put = (sig: Map<number, Map<string, string[]>>, ordinal: number, predicate: string, object: string): void => {
      const byPred = sig.get(ordinal) ?? new Map<string, string[]>();
      const objects = byPred.get(predicate) ?? [];
      objects.push(object);
      byPred.set(predicate, objects);
      sig.set(ordinal, byPred);
    };
    const canonicalise = (sig: Map<number, Map<string, string[]>>): Signature => {
      const out: Signature = {};
      for (const [ordinal, byPred] of sig) {
        const record: Record<string, string[]> = {};
        for (const [predicate, objects] of byPred) record[predicate] = [...objects].sort();
        out[ordinal] = record;
      }
      return out;
    };

    // ACTUAL: the T1 claims the ledger emitted. The four attribute predicates
    // belong solely to the parse tier, so each MUST carry the one parse rule (a
    // leak would fail loudly here); the flag predicate is SHARED with the
    // stripped-collision tier, so only flag claims attributed to the parse rule
    // are the parse tier's — the rule filter separates them at corpus scale.
    const attributePredicates = new Set([PARSE_STATUS_PREDICATE, PREFIX_SERIES_PREDICATE, IMPLIED_CLASS_PREDICATE, RSL_PREDICATE]);
    const actual = new Map<number, Map<string, string[]>>();
    for (const claim of ledger) {
      if (claim.layer !== 'derived') continue;
      if (attributePredicates.has(claim.predicate)) {
        expect(claim.rule, `${claim.rawSubject} ${claim.predicate}`).toBe(PARSE_CALLSIGN_RULE);
        put(actual, claim.provenance.ordinal, claim.predicate, claim.object);
      } else if (claim.predicate === FLAG_PREDICATE && claim.rule === PARSE_CALLSIGN_RULE) {
        put(actual, claim.provenance.ordinal, claim.predicate, claim.object);
      }
    }

    // EXPECTED: parseCallsign applied directly to every row, with the SAME
    // disclosed product and original-start-date the emit consumes, projected by
    // the SAME no-invention rules (an attribute rides only where the parse yields
    // a non-empty value; one flag claim per raised flag; a blank subject emits
    // nothing). If the two disagree on any observation, the tier has drifted.
    const expected = new Map<number, Map<string, string[]>>();
    observationSet.rows.forEach((row, ordinal) => {
      const rawSubject = row[subjectColumn] ?? '';
      if (rawSubject === '') return;
      const product = productColumn !== undefined ? (row[productColumn] ?? '') : '';
      const originalStartDate = startDateColumn !== undefined ? (row[startDateColumn] ?? '') : '';
      const parsed = parseCallsign(rawSubject, product, REF, originalStartDate);
      put(expected, ordinal, PARSE_STATUS_PREDICATE, parsed.parseStatus);
      if (parsed.prefixSeries !== '') put(expected, ordinal, PREFIX_SERIES_PREDICATE, parsed.prefixSeries);
      if (parsed.impliedClass !== '') put(expected, ordinal, IMPLIED_CLASS_PREDICATE, parsed.impliedClass);
      if (parsed.rsl !== '') put(expected, ordinal, RSL_PREDICATE, parsed.rsl);
      for (const flag of parsed.flags) put(expected, ordinal, FLAG_PREDICATE, flag);
    });

    const expectedCanon = canonicalise(expected);
    expect(canonicalise(actual)).toEqual(expectedCanon);
    // The snapshot genuinely exercised the tier at corpus scale, so equivalence is
    // meaningful rather than vacuously true over an empty set.
    expect(Object.keys(expectedCanon).length).toBeGreaterThan(1000);
  }, 120_000);
});

describe('T1 parse-attribute tier — coexists with the existing layers', { tags: ['unit'] }, () => {
  it('Ledger_WhenT1TierAdded_KeepsRawAndExistingDerivedClaimsUnchanged', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    // The raw layer is untouched: every subject keeps its verbatim @listed anchor
    // and its raw Product claim where non-blank.
    expect(ledger.some(c => c.layer === 'raw' && c.rawSubject === 'M7ABC' && c.predicate === '@listed')).toBe(true);
    expect(ledger.some(c => c.layer === 'raw' && c.rawSubject === 'M7ABC' && c.predicate === 'Product' && c.object === 'Amateur Foundation Radio Licence')).toBe(true);
    // The existing derived tiers still ride beside the new one.
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === 'normalises_to' && c.rawSubject === 'M7ABC')).toBe(true);
    expect(ledger.some(c => c.layer === 'derived' && c.predicate === 'licence_category' && c.rawSubject === 'M7ABC')).toBe(true);
    // And the T1 tier is genuinely present.
    expect(t1ClaimsOf(ledger).length).toBeGreaterThan(0);
  });
});

describe('T1 parse-attribute tier — the no-inflation invariant (ADR 0014)', { tags: ['unit'] }, () => {
  it('ExtendedLedger_WhenCarryingT1Claims_PassesTheTrustRatingNoInflationCheck', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    // The sample genuinely carries T1 derived claims, so a green result is
    // meaningful: every one is derived, rule-attributed, reads out Computed (never
    // As-published), and traces to a raw basis for its subject.
    expect(t1ClaimsOf(ledger).length).toBeGreaterThan(0);
    expect(checkNoInflationClaims(ledger)).toEqual([]);
  });
});

describe('T1 parse-attribute tier — serialisation round-trip', { tags: ['unit'] }, () => {
  it('T1Claims_WhenSerialisedAndReparsed_SurviveIdentically', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    const reparsed = parseClaimsJsonl(serialiseClaimsJsonl(ledger));
    expect(t1ClaimsOf(reparsed)).toEqual(t1ClaimsOf(ledger));
  });
});

describe('T1 parse-attribute tier — compact-DB parity', { tags: ['unit'] }, () => {
  it('CompactClaimsView_WhenLedgerHasT1Claims_ReconstructsThemIdenticallyToFatTable', () => {
    // The compact schema cannot run the parser in its reconstruction VIEW, so the
    // T1 claims are stored explicitly (dictionary-encoded) and reconstructed. This
    // asserts parity: the fat one-row-per-claim table and the compact VIEW return
    // an identical T1 multiset, so the compact build stays a faithful drop-in.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-attribute-parity-'));
    try {
      const ledgerDir = path.join(workDir, 'ledger');
      fs.mkdirSync(ledgerDir, { recursive: true });
      fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(emitLedger(FIXTURE_SOURCE, REF)));

      const fatPath = path.join(workDir, 'fat.sqlite');
      const compactPath = path.join(workDir, 'compact.sqlite.png');
      buildLedgerSqlite(ledgerDir, fatPath);
      const summary = buildCompactLedgerSqlite(ledgerDir, compactPath);
      // The subset genuinely exercised the tier: parse-attribute rows were stored.
      expect(summary.derivedAttrClaims).toBeGreaterThan(0);

      const t1Rows = (file: string): Record<string, unknown>[] => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          return db.prepare(
            `SELECT layer, raw_subject, cleaned, entity, predicate, object, IFNULL(rule, '') AS rule, source_file, ordinal, vintage
             FROM claims WHERE predicate IN (?, ?, ?, ?) ORDER BY raw_subject, predicate, object`,
          ).all(PARSE_STATUS_PREDICATE, PREFIX_SERIES_PREDICATE, IMPLIED_CLASS_PREDICATE, FLAG_PREDICATE) as Record<string, unknown>[];
        } finally {
          db.close();
        }
      };

      const fatT1 = t1Rows(fatPath);
      const compactT1 = t1Rows(compactPath);
      expect(fatT1.length).toBe(t1ClaimsOf(emitLedger(FIXTURE_SOURCE, REF)).length);
      expect(compactT1).toEqual(fatT1);
      // Every reconstructed T1 row is derived and attributed to the parse rule.
      for (const row of compactT1) {
        expect(row.layer).toBe('derived');
        expect(row.rule).toBe(PARSE_CALLSIGN_RULE);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});
