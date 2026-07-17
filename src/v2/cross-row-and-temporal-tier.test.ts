import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  emitLedger,
  emitStrippedCollisionClaims,
  emitParseAttributeClaims,
  claimConfidence,
  FLAG_PREDICATE,
  PARSE_CALLSIGN_RULE,
  STRIPPED_COLLISION_FLAG,
  STRIPPED_COLLISION_RULE,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { buildLedgerSqlite } from './build-ledger-db.ts';
import { buildCompactLedgerSqlite } from './build-ledger-db-compact.ts';
import {
  loadReferenceData,
  parseCallsign,
  componentsFlagsForRows,
  cleanedCallsign,
  NON_PLAIN_RE,
} from '../sources/ofcom-amateur/components.ts';
import { checkNoInflationClaims } from '../ci/trust-rating.ts';
import { collectOpenDataRegisterSources } from './collectors/open-data-register.ts';
import { DIRS } from '../shared/constants.ts';
import { parse as parseCsv } from 'csv-parse/sync';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the two remaining derived flag signals the reports-fold tail
// (issue #361, Phase B) needs the ledger to emit:
//
//   - stripped-collision: a WITHIN-SOURCE cross-row flag - a raw token whose
//     junk-stripped (NON_PLAIN_RE) form both differs from itself and coexists as
//     its own distinct row in the same publication. It rides a NEW named rule.
//   - forbidden-suffix-issued-after-first-known-list: a per-row TEMPORAL flag
//     parseCallsign already computes; it fires once the emit path threads the
//     source's disclosed original-start-date cell as the parser's 4th argument.
//     It rides the EXISTING parse-callsign rule.
//
// The correctness gate for both is EQUIVALENCE to the lifted logic in
// components.ts (componentsFlagsForRows / parseCallsign), the no-invention
// discipline, and the no-inflation invariant (every claim derived,
// rule-attributed, reads out Computed, traces to a raw basis).

const REF = loadReferenceData();

const SUBJECT = 'Call Sign';
const PRODUCT = 'Product';
const START_DATE = 'Original Start Date';

function sourceOf(rows: readonly Record<string, string>[], columns: readonly string[]): SourceObservationSet {
  return {
    sourceFile: 'fixture/cross-row-temporal/rows.csv',
    vintage: '2024-01',
    columns,
    subjectColumn: SUBJECT,
    rows,
  };
}

function strippedCollisionSubjects(claims: readonly Claim[]): string[] {
  return claims
    .filter(c => c.predicate === FLAG_PREDICATE && c.object === STRIPPED_COLLISION_FLAG)
    .map(c => c.rawSubject)
    .sort();
}

function hasTemporalFlag(claims: readonly Claim[], rawSubject: string): boolean {
  return claims.some(c =>
    c.rawSubject === rawSubject
    && c.predicate === FLAG_PREDICATE
    && c.object === 'forbidden-suffix-issued-after-first-known-list');
}

describe('stripped-collision tier — within-source cross-row equivalence to componentsFlagsForRows', { tags: ['unit'] }, () => {
  it('StrippedCollision_WhenJunkTokenTwinPresent_FlagsTheJunkRowNotTheCleanRow', () => {
    // The documented double-listing: G0TQK and its trailing-NBSP twin both
    // appear. The junk-bearing row flags (its NBSP-stripped form is the clean
    // row); the clean row and an unrelated row do not - mirroring the legacy
    // componentsFlagsForRows exactly.
    const rows = [
      { [SUBJECT]: 'G0TQK ' },
      { [SUBJECT]: 'G0TQK' },
      { [SUBJECT]: 'M7TEE' },
    ];
    const claims = emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]));
    expect(strippedCollisionSubjects(claims)).toEqual(['G0TQK ']);
  });

  it('StrippedCollision_WhenTwoDistinctJunkTokensShareACleanTwin_FlagsBoth', () => {
    // Two distinct raw tokens strip to the same NON_PLAIN_RE key, and that key
    // exists as its own clean row: BOTH junk rows flag (the clean row does not).
    const rows = [
      { [SUBJECT]: 'G6FMU' },
      { [SUBJECT]: 'G6 FMU' },
      { [SUBJECT]: 'G6 FMU' },
    ];
    const claims = emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]));
    expect(strippedCollisionSubjects(claims)).toEqual(['G6 FMU', 'G6 FMU']);
  });

  it('StrippedCollision_WhenStrippedFormAbsentAsItsOwnRow_FlagsNothing', () => {
    // A junk token whose stripped form is NOT present as a distinct row is not a
    // collision - honest silence, never an invented flag.
    const rows = [{ [SUBJECT]: 'G6 FMU' }, { [SUBJECT]: 'M7TEE' }];
    expect(emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]))).toEqual([]);
  });

  it('StrippedCollision_WhenSubjectBlank_FlagsNothing', () => {
    const rows = [{ [SUBJECT]: '' }, { [SUBJECT]: 'M7TEE' }];
    expect(emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]))).toEqual([]);
  });

  it('StrippedCollision_AcrossAMixedFixture_MatchesComponentsFlagsForRowsSubjectForSubject', () => {
    // The strangler equivalence oracle: the ledger's stripped-collision subject
    // set must equal the legacy componentsFlagsForRows output over the same rows,
    // proving the emit LIFTS the pass rather than approximating it.
    const rows = [
      { [SUBJECT]: 'G0TQK ' },
      { [SUBJECT]: 'G0TQK' },
      { [SUBJECT]: 'G7IWE ' },
      { [SUBJECT]: 'G7IWE' },
      { [SUBJECT]: 'M7TEE' },
      { [SUBJECT]: '2E0AAA' },
    ];
    const ledgerSubjects = strippedCollisionSubjects(emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT])));
    const legacy = componentsFlagsForRows(rows.map(r => parseCallsign(r[SUBJECT], '', REF)));
    const legacySubjects = legacy
      .filter(row => row.flags.includes('stripped-collision'))
      .map(row => row.callsign)
      .sort();
    expect(ledgerSubjects).toEqual(legacySubjects);
  });

  it('StrippedCollision_UsesNonPlainReNotCleanedCallsign_KeepingTheHashCharacter', () => {
    // The pitfall the design pins: the collision key is NON_PLAIN_RE
    // ([^A-Za-z0-9/#], which KEEPS '#'), NOT cleanedCallsign (which drops '#'
    // and upper-cases). A '#'-bearing token strips to itself under NON_PLAIN_RE,
    // so it does NOT collide with its '#'-less form - whereas cleanedCallsign
    // would have conflated them. This guards a future refactor from silently
    // substituting one edge for the other.
    expect(NON_PLAIN_RE.source).toBe('[^A-Za-z0-9/#]');
    expect('M/#PT2FM'.replace(NON_PLAIN_RE, '')).toBe('M/#PT2FM');
    expect(cleanedCallsign('M/#PT2FM')).toBe('M/PT2FM');
    const rows = [{ [SUBJECT]: 'M/#PT2FM' }, { [SUBJECT]: 'M/PT2FM' }];
    // No collision under NON_PLAIN_RE, even though cleanedCallsign would collide.
    expect(emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]))).toEqual([]);
  });

  it('StrippedCollision_EveryClaim_IsDerivedRuleAttributedAndReadsOutComputed', () => {
    const rows = [{ [SUBJECT]: 'G0TQK ' }, { [SUBJECT]: 'G0TQK' }];
    const claims = emitStrippedCollisionClaims(sourceOf(rows, [SUBJECT]));
    expect(claims.length).toBe(1);
    for (const claim of claims) {
      expect(claim.layer).toBe('derived');
      expect(claim.rule).toBe(STRIPPED_COLLISION_RULE);
      expect(claim.predicate).toBe(FLAG_PREDICATE);
      expect(claimConfidence(claim)).toBe('Computed');
    }
  });
});

describe('temporal tier — forbidden-suffix-issued-after-first-known-list rides the wired original-start-date', { tags: ['data-validity'] }, () => {
  const columns = [SUBJECT, PRODUCT, START_DATE];

  function withStartDate(rows: readonly Record<string, string>[]): SourceObservationSet {
    return { ...sourceOf(rows, columns), categoryColumn: PRODUCT, originalStartDateColumn: START_DATE };
  }

  it('TemporalFlag_WhenForbiddenSuffixIssuedAfterItsFirstKnownList_Fires', () => {
    // ASS is first known forbidden 2016-07; a 2020 ISO issue post-dates it, so
    // the ledger raises the flag - equivalence to parseCallsign with the 4th arg.
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2020-05-01' }];
    const claims = emitParseAttributeClaims(withStartDate(rows), REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(true);
    // The flag rides the EXISTING parse-callsign rule (no new rule introduced).
    const flagClaim = claims.find(c => c.object === 'forbidden-suffix-issued-after-first-known-list');
    expect(flagClaim?.rule).toBe(PARSE_CALLSIGN_RULE);
    // Equivalence: the ledger flag set matches parseCallsign's own output.
    const parsed = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2020-05-01');
    expect(parsed.flags).toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('TemporalFlag_WhenForbiddenSuffixIssuedBeforeAnyKnownList_DoesNotFire', () => {
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '1980-01-01' }];
    const claims = emitParseAttributeClaims(withStartDate(rows), REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(false);
    // The ordinary forbidden-suffix flag still rides - only the temporal one is withheld.
    expect(claims.some(c => c.object === 'forbidden-suffix')).toBe(true);
  });

  it('TemporalFlag_WhenSourceDisclosesNoStartDateColumn_DoesNotFire', () => {
    // Absent the originalStartDateColumn binding (the reduced Value/Status/Type
    // snapshots), the parser receives '' and honestly withholds the flag.
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence' }];
    const noDate: SourceObservationSet = { ...sourceOf(rows, [SUBJECT, PRODUCT]), categoryColumn: PRODUCT };
    const claims = emitParseAttributeClaims(noDate, REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(false);
    expect(claims.some(c => c.object === 'forbidden-suffix')).toBe(true);
  });

  it('TemporalFlag_WhenRawDateIsOpenDataDayFirstAfterFirstKnown_Fires', () => {
    // The open-data raw renders the date DD/MM/YYYY and travels verbatim into the
    // ledger. 01/05/2020 is 1 May 2020, after ASS's 2016-07 first-known-forbidden
    // month, so the ledger fires the flag - matching the ISO-normalised lane
    // rather than under-firing on the raw rendering (#429 gap).
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '01/05/2020' }];
    const claims = emitParseAttributeClaims(withStartDate(rows), REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(true);
    // Equivalence: the day-first raw judges identically to the ISO rendering.
    const iso = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2020-05-01' }];
    expect(hasTemporalFlag(emitParseAttributeClaims(withStartDate(iso), REF), 'M7ASS')).toBe(true);
  });

  it('TemporalFlag_WhenRawDateIsOpenDataDayFirstBeforeFirstKnown_DoesNotFire', () => {
    // A day-first date BEFORE the suffix's first-known month is the benign
    // long-standing allocation: 01/05/2010 predates ASS's 2016-07 boundary, so
    // no flag - the raw rendering does not create a false positive either.
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '01/05/2010' }];
    const claims = emitParseAttributeClaims(withStartDate(rows), REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(false);
    expect(claims.some(c => c.object === 'forbidden-suffix')).toBe(true);
  });

  it('TemporalFlag_WhenRawDateIsGenuinelyUnparseable_WithholdsTheFlag', () => {
    // A date matching NEITHER known source rendering (here a US month-first-shaped
    // token with an impossible day-first reading) is not coerced: the parser
    // withholds the flag - honest silence, never a guess.
    const rows = [{ [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: 'May 1 2020' }];
    const claims = emitParseAttributeClaims(withStartDate(rows), REF);
    expect(hasTemporalFlag(claims, 'M7ASS')).toBe(false);
    expect(claims.some(c => c.object === 'forbidden-suffix')).toBe(true);
  });

  it('TemporalFlag_WhenSuffixOnlyLateKnownForbidden_KeysOffItsOwnFirstKnownDate', () => {
    // JIZ is first known forbidden only from 2020-12-10: a 2019 issue is NOT the
    // anomaly (before JIZ was known), a 2021 issue IS. The per-suffix date drives
    // this, reproduced faithfully through the ledger.
    const before = withStartDate([{ [SUBJECT]: 'M7JIZ', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2019-01-01' }]);
    const after = withStartDate([{ [SUBJECT]: 'M7JIZ', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2021-01-01' }]);
    expect(hasTemporalFlag(emitParseAttributeClaims(before, REF), 'M7JIZ')).toBe(false);
    expect(hasTemporalFlag(emitParseAttributeClaims(after, REF), 'M7JIZ')).toBe(true);
  });

  it('TemporalFlag_OverRealOpenDataLane_FiresExactlyWhereLegacyComponentsCsvDoes', () => {
    // The legacy-match oracle for #429's gap. On the open-data lane the raw
    // original-start-date renders UK day-first (DD/MM/YYYY), and the ledger reads
    // that raw cell verbatim; the committed components.csv is built from the same
    // rows with the date ISO-normalised first. The temporal flag must therefore
    // fire on EXACTLY the same callsigns through the ledger's raw day-first read
    // as through the normalised (legacy) ISO read - the multiset match below is
    // the proof, computed over the whole real open-data lane. Before this fix the
    // ledger fired ZERO temporal flags here (the ISO-only rule rejected every
    // DD/MM/YYYY date); it now matches the 106 the legacy path carries on the one
    // snapshot whose variant discloses the date column.
    const TEMPORAL = 'forbidden-suffix-issued-after-first-known-list';
    let snapshotsExercised = 0;
    for (const source of collectOpenDataRegisterSources()) {
      const componentsPath = path.join(DIRS.archive, source.entry, 'components.csv');
      if (!fs.existsSync(componentsPath)) continue;
      const componentRows = parseCsv(fs.readFileSync(componentsPath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      // Legacy side: the committed components.csv temporal-flagged callsigns, as a
      // sorted multiset (row-parallel with the raw rows, so multiplicity matters).
      const legacy = componentRows
        .filter(r => (r.flags ?? '').split(';').includes(TEMPORAL))
        .map(r => r.callsign)
        .sort();
      // Ledger side: emit over the RAW bytes (day-first dates travel verbatim).
      const ledger = emitParseAttributeClaims(source.load(), REF)
        .filter(c => c.predicate === FLAG_PREDICATE && c.object === TEMPORAL)
        .map(c => c.rawSubject)
        .sort();
      expect(ledger, `${source.entry}: ledger temporal fires vs legacy components.csv`).toEqual(legacy);
      if (legacy.length > 0) snapshotsExercised += 1;
    }
    // A green result must be non-vacuous: at least one snapshot genuinely raises
    // the flag (the 2026 variant, which discloses the original-start-date column).
    expect(snapshotsExercised, 'no open-data snapshot exercised the temporal flag').toBeGreaterThan(0);
  }, 120_000);
});

describe('both new tiers — the no-inflation invariant (ADR 0014)', { tags: ['unit'] }, () => {
  it('ExtendedLedger_WhenCarryingBothNewFlags_PassesTheTrustRatingNoInflationCheck', () => {
    // A fixture that genuinely raises BOTH new flags, so a green result is
    // meaningful: a collision pair plus a post-list forbidden-suffix issue.
    const columns = [SUBJECT, PRODUCT, START_DATE];
    const rows = [
      { [SUBJECT]: 'G0TQK ', [PRODUCT]: 'Amateur Full Radio Licence', [START_DATE]: '' },
      { [SUBJECT]: 'G0TQK', [PRODUCT]: 'Amateur Full Radio Licence', [START_DATE]: '' },
      { [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2020-05-01' },
    ];
    const source: SourceObservationSet = {
      ...sourceOf(rows, columns),
      categoryColumn: PRODUCT,
      originalStartDateColumn: START_DATE,
    };
    const ledger = emitLedger(source, REF);
    expect(strippedCollisionSubjects(ledger)).toEqual(['G0TQK ']);
    expect(hasTemporalFlag(ledger, 'M7ASS')).toBe(true);
    expect(checkNoInflationClaims(ledger)).toEqual([]);
  });
});

describe('both new tiers — compact-DB parity', { tags: ['unit'] }, () => {
  it('CompactClaimsView_WhenLedgerHasBothNewFlags_ReconstructsThemIdenticallyToFatTable', () => {
    // Both flags are ordinary derived flag claims, so they land as derived_attr
    // rows and reconstruct through the VIEW. Parity asserts the fat table and
    // compact VIEW return an identical multiset for them - no schema change.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-row-temporal-parity-'));
    try {
      const columns = [SUBJECT, PRODUCT, START_DATE];
      const rows = [
        { [SUBJECT]: 'G0TQK ', [PRODUCT]: 'Amateur Full Radio Licence', [START_DATE]: '' },
        { [SUBJECT]: 'G0TQK', [PRODUCT]: 'Amateur Full Radio Licence', [START_DATE]: '' },
        { [SUBJECT]: 'M7ASS', [PRODUCT]: 'Amateur Foundation Radio Licence', [START_DATE]: '2020-05-01' },
      ];
      const source: SourceObservationSet = {
        ...sourceOf(rows, columns),
        categoryColumn: PRODUCT,
        originalStartDateColumn: START_DATE,
      };
      const ledgerDir = path.join(workDir, 'ledger');
      fs.mkdirSync(ledgerDir, { recursive: true });
      fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(emitLedger(source, REF)));

      const fatPath = path.join(workDir, 'fat.sqlite');
      const compactPath = path.join(workDir, 'compact.sqlite.png');
      buildLedgerSqlite(ledgerDir, fatPath);
      const summary = buildCompactLedgerSqlite(ledgerDir, compactPath);
      expect(summary.derivedAttrClaims).toBeGreaterThan(0);

      const flagRows = (file: string, object: string): Record<string, unknown>[] => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          return db.prepare(
            `SELECT layer, raw_subject, predicate, object, IFNULL(rule, '') AS rule, source_file, ordinal
             FROM claims WHERE predicate = ? AND object = ? ORDER BY raw_subject, ordinal`,
          ).all(FLAG_PREDICATE, object) as Record<string, unknown>[];
        } finally {
          db.close();
        }
      };

      for (const object of [STRIPPED_COLLISION_FLAG, 'forbidden-suffix-issued-after-first-known-list']) {
        const fat = flagRows(fatPath, object);
        const compact = flagRows(compactPath, object);
        expect(fat.length, `${object} present in fat build`).toBeGreaterThan(0);
        expect(compact, `${object} parity`).toEqual(fat);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});
