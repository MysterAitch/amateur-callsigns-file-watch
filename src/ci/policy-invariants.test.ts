import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyReservationWindow,
  classifyObservation,
  isBeyondFiveYears,
  plusYears,
  foldReservationObservations,
  computeTwoYearReservationFindings,
  computePolicyInvariantsReport,
  renderPolicyInvariantsReport,
  CLASS_ORDER,
  CLASS_GLOSSES,
  POLICY_INVARIANTS,
  TWO_YEAR_RESERVATION_INVARIANT,
  RESERVED_DEFINITION_STATEMENT,
  type ReservationObservation,
  type PolicyInvariantsReport,
} from './policy-invariants.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { EVENT_DATE_RULE, eventDatePredicate, type Claim } from '../v2/claim.ts';

// Issue #863: policy-as-tests, the two-year reservation window. Test names
// follow Subject_Scenario_Outcome. The scenarios are the invariant's
// user-facing guarantees: a stated reservation window is classified against the
// two-year cooling policy, day- and month-keyed vintages are honoured at their
// real precision (a month-keyed assertion cannot decide the fine bands and says
// so), a violation is a flagged candidate never a verdict, and the report cites
// its source statement verbatim.

// --- The pure classifier: day-keyed vintages (single assertion instant) ------

describe('two-year reservation window — day-keyed vintage', { tags: ['unit'] }, () => {
  it('Reservation_EndWithinTwoYearsOfADayKeyedVintage_IsConformant', () => {
    // GB0SNB shape: reserved to just under two years after the assertion.
    expect(classifyReservationWindow('2026-08-09', '2024-09-10')).toBe('conformant');
    // The exact two-year boundary is inclusive (…the two-year period).
    expect(classifyReservationWindow('2026-09-10', '2024-09-10')).toBe('conformant');
    // The assertion day itself: a window ending the day it is asserted is a
    // reservation about to expire — still a valid ≤2-year window.
    expect(classifyReservationWindow('2024-09-10', '2024-09-10')).toBe('conformant');
  });

  it('Reservation_EndMoreThanTwoYearsBeyondADayKeyedVintage_IsLongerThanStated', () => {
    // One day past the two-year boundary is longer-than-stated.
    expect(classifyReservationWindow('2026-09-11', '2024-09-10')).toBe('longer-than-stated');
    // GB2RS shape: a permanent reservation (2099) — a flagged candidate.
    expect(classifyReservationWindow('2099-12-31', '2024-09-10')).toBe('longer-than-stated');
  });

  it('Reservation_EndBeforeADayKeyedVintage_IsShorterThanStated', () => {
    // The retrospective-termination shape: the stated end is already past.
    expect(classifyReservationWindow('2020-01-01', '2024-09-10')).toBe('shorter-than-stated');
    // One day before the vintage still counts as already-closed.
    expect(classifyReservationWindow('2024-09-09', '2024-09-10')).toBe('shorter-than-stated');
  });

  it('Reservation_UnderADayKeyedVintage_IsNeverUndeterminable', () => {
    // A day-keyed vintage is a single assertion instant, so every window
    // classifies cleanly into one of the three substantive classes.
    for (const end of ['2020-01-01', '2024-09-10', '2025-01-01', '2026-09-10', '2027-01-01', '2099-12-31']) {
      expect(classifyReservationWindow(end, '2024-09-10')).not.toBe('undeterminable');
    }
  });
});

// --- The pure classifier: month-keyed vintages (declared-not-proven day) ------

describe('two-year reservation window — month-keyed vintage precision', { tags: ['unit'] }, () => {
  // vintage 2024-09 spans [2024-09-01, 2024-09-30]; conformant-under-all is
  // [2024-09-30, 2026-09-01]; shorter-under-all is < 2024-09-01; longer-under-
  // all is > 2026-09-30; the two residual bands are undeterminable.
  it('Reservation_EndConformantUnderEveryDayOfTheMonth_IsConformant', () => {
    expect(classifyReservationWindow('2025-06-01', '2024-09')).toBe('conformant');
    expect(classifyReservationWindow('2024-09-30', '2024-09')).toBe('conformant');
    expect(classifyReservationWindow('2026-09-01', '2024-09')).toBe('conformant');
  });

  it('Reservation_EndBeforeTheWholeMonth_IsShorterThanStated', () => {
    expect(classifyReservationWindow('2024-08-31', '2024-09')).toBe('shorter-than-stated');
    expect(classifyReservationWindow('2016-12-17', '2024-09')).toBe('shorter-than-stated');
  });

  it('Reservation_EndBeyondTwoYearsFromEveryDayOfTheMonth_IsLongerThanStated', () => {
    expect(classifyReservationWindow('2026-10-01', '2024-09')).toBe('longer-than-stated');
    expect(classifyReservationWindow('2029-06-25', '2024-09')).toBe('longer-than-stated');
  });

  it('Reservation_EndInsideTheMonthItself_IsUndeterminableBecauseTheAssertionDayIsUnknown', () => {
    // An end mid-month could be already-elapsed (asserted later that month) or
    // still-live (asserted earlier) — the month precision cannot decide, so it
    // is reported as undeterminable, never guessed.
    expect(classifyReservationWindow('2024-09-09', '2024-09')).toBe('undeterminable');
    expect(classifyReservationWindow('2024-09-29', '2024-09')).toBe('undeterminable');
  });

  it('Reservation_EndInTheUpperTwoYearBand_IsUndeterminableBetweenConformantAndLonger', () => {
    // (2026-09-01, 2026-09-30]: conformant if asserted late in the month,
    // longer if asserted on the 1st — undeterminable at month precision.
    expect(classifyReservationWindow('2026-09-15', '2024-09')).toBe('undeterminable');
    expect(classifyReservationWindow('2026-09-30', '2024-09')).toBe('undeterminable');
  });
});

// --- Year arithmetic and the beyond-five-years subset ------------------------

describe('two-year window arithmetic', { tags: ['unit'] }, () => {
  it('PlusYears_OrdinaryDate_AddsWholeYears', () => {
    expect(plusYears('2024-09-10', 2)).toBe('2026-09-10');
    expect(plusYears('2024-09-30', 5)).toBe('2029-09-30');
  });

  it('PlusYears_LeapDay_RollsDeterministicallyIntoMarch', () => {
    // A documented, deterministic rounding (Feb 29 + 2y has no leap day).
    expect(plusYears('2024-02-29', 2)).toBe('2026-03-01');
  });

  it('BeyondFiveYears_OnlyTrueWhenTheEndExceedsFiveYearsOfTheVintageLatestDay', () => {
    // GB2RS (2099) is beyond five years; a 2029 window from a 2024-09 vintage
    // is longer-than-stated but NOT beyond five years (5y latest = 2029-09-30).
    expect(isBeyondFiveYears('2099-12-31', '2024-09')).toBe(true);
    expect(isBeyondFiveYears('2029-06-25', '2024-09')).toBe(false);
  });

  it('ClassifyObservation_LongerThanStatedButNotBeyondFive_MarksBeyondFiveFalse', () => {
    const obs: ReservationObservation = { subject: '20HRO', reservedUntil: '2029-06-25', lane: 'foi', dataset: 'd', vintage: '2024-09', nrows: 1 };
    const classified = classifyObservation(obs);
    expect(classified.klass).toBe('longer-than-stated');
    expect(classified.beyondFiveYears).toBe(false);
  });

  it('ClassifyObservation_ConformantWindow_IsNeverMarkedBeyondFive', () => {
    // beyondFiveYears is only ever set on the longer-than-stated class.
    const obs: ReservationObservation = { subject: 'GB0SNB', reservedUntil: '2026-08-09', lane: 'foi', dataset: 'd', vintage: '2024-09', nrows: 1 };
    expect(classifyObservation(obs).beyondFiveYears).toBe(false);
  });
});

// --- The registry is frozen: a new invariant is a reviewed change ------------

describe('the invariant registry is authored and frozen', { tags: ['unit'] }, () => {
  it('ClassVocabulary_IsExactlyTheFourAuthoredClasses_AndEveryClassIsGlossed', () => {
    expect([...CLASS_ORDER]).toEqual(['conformant', 'longer-than-stated', 'shorter-than-stated', 'undeterminable']);
    for (const klass of CLASS_ORDER) {
      expect(CLASS_GLOSSES.get(klass)).toBeTruthy();
    }
    expect(CLASS_GLOSSES.size).toBe(CLASS_ORDER.length);
  });

  it('Registry_ContainsTheTwoYearReservationInvariant_ImplementedAndCitingItsOfcomPrimarySource', () => {
    const inv = POLICY_INVARIANTS.find(i => i.id === 'two-year-reservation-window');
    expect(inv).toBe(TWO_YEAR_RESERVATION_INVARIANT);
    expect(inv?.status).toBe('implemented');
    expect(inv?.source).toBe(RESERVED_DEFINITION_STATEMENT);
    expect(inv?.source.tier).toBe('ofcom-primary');
    // The cited statement is the verbatim Reserved definition, not a paraphrase.
    expect(inv?.source.quote).toContain('used within the past two years');
    expect(inv?.source.quote).toContain('cooling down');
    expect(inv?.source.citation).toContain('756622');
    expect(inv?.source.archivePath).toContain('wdtk-596532');
  });

  it('Registry_ReservesSlotsForTheFurtherInvariants_EachCitedAndMarkedPlanned', () => {
    // The framework names the further invariants the issue inventory lists, so
    // a reader sees the shape the estate is growing into; each carries a
    // citation and is honestly marked not-yet-implemented.
    const ids = POLICY_INVARIANTS.map(i => i.id);
    expect(ids).toContain('generator-format-per-class');
    expect(ids).toContain('forbidden-suffix-exclusions');
    for (const inv of POLICY_INVARIANTS.filter(i => i.status === 'planned')) {
      expect(inv.source.citation).toBeTruthy();
      expect(inv.check).toContain('PLANNED');
    }
  });
});

// --- The fold over a fixture ledger ------------------------------------------

const DAY_VINTAGE = 'foi/2020-10-23/reserved.jsonl';
const MONTH_VINTAGE = 'foi/2024-09/every-radio.csv';

function reservedClaim(sourceFile: string, subject: string, isoDay: string, ordinal: number): Claim {
  return {
    layer: 'derived',
    rawSubject: subject,
    predicate: eventDatePredicate('reserved-until'),
    object: isoDay,
    provenance: { sourceFile, ordinal, vintage: sourceFile.split('/')[1] },
    rule: EVENT_DATE_RULE,
  };
}

describe.skipIf(!duckDbAvailable())('reservation fold over a fixture ledger', { tags: ['unit'] }, () => {
  function writeFixtureLedger(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-invariants-fixture-'));
    let ordinal = 0;
    const at = (sourceFile: string, subject: string, isoDay: string): Claim => reservedClaim(sourceFile, subject, isoDay, ordinal++);
    const claims: Claim[] = [
      // Day-keyed disclosure: one conformant, one longer, one shorter.
      at(DAY_VINTAGE, 'G0CONF', '2022-06-09'),
      at(DAY_VINTAGE, 'G0LONG', '2099-12-31'),
      at(DAY_VINTAGE, 'G0SHORT', '2019-01-01'),
      // Month-keyed disclosure: conformant, longer, beyond-5y, shorter, and an
      // undeterminable mid-month end.
      at(MONTH_VINTAGE, 'M0CONF', '2025-06-01'),
      at(MONTH_VINTAGE, 'M0LONG', '2029-06-25'),
      at(MONTH_VINTAGE, 'GB2RS', '2099-12-31'),
      at(MONTH_VINTAGE, 'M0SHORT', '2016-12-17'),
      at(MONTH_VINTAGE, 'M0UNDET', '2024-09-09'),
      // A decorated raw form cleans to the same key — the fold joins on cleaned.
      at(MONTH_VINTAGE, 'm0conf ', '2025-06-01'),
    ];
    fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
    return dir;
  }

  it('ReservationFold_ExtractsReservedUntilClaims_AndCleansTheSubjectKey', () => {
    const dir = writeFixtureLedger();
    try {
      const rows = foldReservationObservations(dir);
      // M0CONF and its decorated raw form 'm0conf ' aggregate under one subject.
      const m0conf = rows.filter(r => r.subject === 'M0CONF');
      expect(m0conf).toHaveLength(1);
      expect(m0conf[0].nrows).toBe(2);
      expect(rows.every(r => r.subject === r.subject.toUpperCase())).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TwoYearFindings_OverAFixtureLedger_CountEveryClassAndSurfaceTheBeyondFiveInstance', () => {
    const dir = writeFixtureLedger();
    try {
      const f = computeTwoYearReservationFindings(dir);
      const byClass = new Map(f.totals.map(t => [t.klass, t.observations]));
      expect(byClass.get('conformant')).toBe(2); // G0CONF + M0CONF (raw form aggregated)
      expect(byClass.get('longer-than-stated')).toBe(3); // G0LONG + M0LONG + GB2RS
      expect(byClass.get('shorter-than-stated')).toBe(2); // G0SHORT + M0SHORT
      expect(byClass.get('undeterminable')).toBe(1); // M0UNDET
      // The beyond-five-years subset surfaces the permanent reservations only.
      expect(f.beyondFiveYears.map(o => o.subject).sort()).toEqual(['G0LONG', 'GB2RS']);
      // The day-keyed disclosure carries no undeterminable band; the month one does.
      const dayRow = f.breakdown.find(b => b.vintage === '2020-10-23');
      const monthRow = f.breakdown.find(b => b.vintage === '2024-09');
      expect(dayRow?.undeterminable).toBe(0);
      expect(monthRow?.undeterminable).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EmptyClaimsSource_AsInTheReportSweepFixtureContext_FoldsToTheHonestEmptyReport', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-invariants-empty-'));
    try {
      const f = computeTwoYearReservationFindings(dir);
      expect(f.totalObservations).toBe(0);
      expect(f.beyondFiveYears).toEqual([]);
      const md = renderPolicyInvariantsReport(computePolicyInvariantsReport(dir));
      expect(md).toContain('not a clean bill of health');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Rendering ---------------------------------------------------------------

function syntheticReport(): PolicyInvariantsReport {
  return {
    invariants: POLICY_INVARIANTS,
    twoYearReservation: {
      totalObservations: 3,
      totalSubjects: 3,
      totals: [
        { klass: 'conformant', observations: 1, subjects: 1 },
        { klass: 'longer-than-stated', observations: 1, subjects: 1 },
        { klass: 'shorter-than-stated', observations: 1, subjects: 1 },
        { klass: 'undeterminable', observations: 0, subjects: 0 },
      ],
      breakdown: [
        { lane: 'foi', dataset: 'ofcom-2024-09--every-radio-callsign--all-callsigns', vintage: '2024-09', conformant: 1, longerThanStated: 1, shorterThanStated: 1, undeterminable: 0, total: 3 },
      ],
      exemplars: [
        { klass: 'conformant', rows: [{ subject: 'GB0SNB', reservedUntil: '2026-08-09', lane: 'foi', dataset: 'd', vintage: '2024-09', nrows: 1, klass: 'conformant', beyondFiveYears: false }] },
        { klass: 'longer-than-stated', rows: [{ subject: 'GB2RS', reservedUntil: '2099-12-31', lane: 'foi', dataset: 'd', vintage: '2024-09', nrows: 1, klass: 'longer-than-stated', beyondFiveYears: true }] },
        { klass: 'shorter-than-stated', rows: [] },
        { klass: 'undeterminable', rows: [] },
      ],
      beyondFiveYears: [{ subject: 'GB2RS', reservedUntil: '2099-12-31', lane: 'foi', dataset: 'd', vintage: '2024-09', nrows: 1, klass: 'longer-than-stated', beyondFiveYears: true }],
    },
  };
}

describe('policy-invariants report rendering', { tags: ['unit'] }, () => {
  it('Render_CitesTheSourceStatementVerbatim_WithItsArchivePathAndTier', () => {
    const md = renderPolicyInvariantsReport(syntheticReport());
    expect(md).toContain('# Policy-as-tests');
    // The verbatim Reserved definition is quoted, not paraphrased.
    expect(md).toContain('has been used within the past two years');
    expect(md).toContain('after the two-year period has expired');
    expect(md).toContain('archive/foi/wdtk-596532--allocated-reserved-forbidden');
    expect(md).toContain('Ofcom primary');
  });

  it('Render_GlossesEveryClassBesideItsUse_SoTheVocabularyIsNeverBare', () => {
    const md = renderPolicyInvariantsReport(syntheticReport());
    for (const [klass, gloss] of CLASS_GLOSSES) {
      expect(md).toContain(`- **${klass}** — ${gloss}`);
    }
  });

  it('Render_FlagsWithoutVerdicts_AndOffersCandidateExplanations', () => {
    const md = renderPolicyInvariantsReport(syntheticReport());
    expect(md).toContain('**Flags, never verdicts**');
    expect(md).toContain('Candidate explanations, none chosen');
    expect(md).toContain('chooses none');
  });

  it('Render_CrossReferencesIssue568_AsTheBeyondFiveYearsTail', () => {
    const md = renderPolicyInvariantsReport(syntheticReport());
    expect(md).toContain('#568');
    expect(md).toContain('reserved beyond five years');
    // The permanent-reservation instance surfaces, marked beyond 5y.
    expect(md).toContain('`GB2RS`');
    expect(md).toContain('(beyond 5y)');
  });

  it('Render_ListsThePlannedInvariants_AsFrameworkSlots', () => {
    const md = renderPolicyInvariantsReport(syntheticReport());
    expect(md).toContain('## Planned invariants');
    expect(md).toContain('The generator rule-set: format per licence class');
    expect(md).toContain('The forbidden-suffix exclusions');
  });
});
