import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computePolicyInvariantsReport,
  renderPolicyInvariantsReport,
  POLICY_INVARIANTS_PATH,
  type PolicyInvariantsReport,
} from './policy-invariants.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #863: the two-year reservation invariant validated against the
// corpus's RECORDED ground truth. Test names follow Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read — like the other
// data-validity goldens (state-at-t-corpus.test.ts).

describe.skipIf(!duckDbAvailable())('policy invariants — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let report: PolicyInvariantsReport;
  beforeAll(() => {
    handle = acquireClaimsSource();
    report = computePolicyInvariantsReport(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  // --- The committed report is exactly this fold ---------------------------

  it('PolicyInvariantsReport_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), POLICY_INVARIANTS_PATH), 'utf8');
    expect(renderPolicyInvariantsReport(report)).toBe(golden);
  });

  it('PolicyInvariantsReport_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderPolicyInvariantsReport(computePolicyInvariantsReport(handle.source))).toBe(renderPolicyInvariantsReport(report));
  });

  // --- The four-way classification over the committed corpus ---------------

  it('TwoYearReservationWindow_OverTheCommittedArchive_ClassifiesEveryObservationExactly', () => {
    const f = report.twoYearReservation;
    expect(f.totalObservations).toBe(5257);
    expect(f.totalSubjects).toBe(4369);
    const byClass = new Map(f.totals.map(t => [t.klass, t.observations]));
    expect(byClass.get('conformant')).toBe(1582);
    expect(byClass.get('longer-than-stated')).toBe(370);
    expect(byClass.get('shorter-than-stated')).toBe(3240);
    expect(byClass.get('undeterminable')).toBe(65);
    // Every observation lands in exactly one class.
    expect([...byClass.values()].reduce((a, b) => a + b, 0)).toBe(f.totalObservations);
  });

  it('UndeterminableBand_ArisesOnlyFromMonthKeyedDisclosures_TheDayKeyedOnesClassifyCleanly', () => {
    // The vintage-precision honesty: only a MONTH-keyed disclosure (its
    // assertion day unknown within the month) can leave a window undeterminable
    // — every day-keyed disclosure decides each window cleanly. The committed
    // corpus carries both cases (day-keyed 2019-2021 disclosures; month-keyed
    // 2024-09 and 2024-10), so this asserts the property, not one dataset.
    const monthKeyed = /^\d{4}-\d{2}$/;
    const f = report.twoYearReservation;
    for (const b of assertNonEmpty(f.breakdown, 'two-year-reservation breakdown')) {
      if (monthKeyed.test(b.vintage)) {
        expect(b.undeterminable).toBeGreaterThan(0);
      } else {
        expect(b.undeterminable).toBe(0);
      }
    }
  });

  // --- The #568 known instance surfaces ------------------------------------

  it('Issue568KnownInstance_GB2RSReservedTo2099_SurfacesAsTheBeyondFiveYearsTail', () => {
    // #568 records a community-tier observation that callsigns reserved far
    // beyond the two-year window are effectively available again. GB2RS (the
    // RSGB news-broadcast callsign) is reserved to 2099-12-31 in the 2024-09
    // disclosure — a permanent reservation, and the corpus's clearest instance
    // of the phenomenon #568 flagged. It MUST surface in the beyond-five-years
    // subset, flagged as a candidate and adjudicated nowhere.
    const f = report.twoYearReservation;
    const gb2rs = f.beyondFiveYears.find(o => o.subject === 'GB2RS');
    expect(gb2rs).toBeDefined();
    expect(gb2rs?.reservedUntil).toBe('2099-12-31');
    expect(gb2rs?.klass).toBe('longer-than-stated');
    expect(gb2rs?.beyondFiveYears).toBe(true);
  });

  it('ShorterThanStatedCohort_IsTheLargestClass_ReflectingTheRetrospectiveTerminationRecords', () => {
    // The Available-status cohort carries a past reserved-to date recording
    // when a reservation ENDED (state-at-t's reserved-cohort ambiguity), so the
    // shorter-than-stated class is expected to dominate — a cross-check that the
    // classification lands the cohorts where the source semantics predict.
    const f = report.twoYearReservation;
    const shorter = f.totals.find(t => t.klass === 'shorter-than-stated')?.observations ?? 0;
    const others = f.totals.filter(t => t.klass !== 'shorter-than-stated');
    expect(others.length, 'no other classification totals to compare against').toBeGreaterThan(0);
    for (const t of others) {
      expect(shorter).toBeGreaterThan(t.observations);
    }
  });
});
