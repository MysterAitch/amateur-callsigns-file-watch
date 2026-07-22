import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  acquireClaimsSource,
  type ClaimsSourceHandle,
} from './event-time-coherency.ts';
import {
  computeSurvivalCohort,
  renderSurvivalCohort,
  SURVIVAL_COHORT_PATH,
  type SurvivalCohort,
} from './survival-cohort.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #865: the survival/cohort fold validated against the committed archive.
// The committed golden IS this fold's output, so byte-identity is the retirement
// gate; the ground-truth pins record the corpus's actual actuarial shape (the
// censoring dominance, the disjoint-attestation sparsity, the class/era
// retention) so a drift is a deliberate re-read, not silent churn. Figures are
// figures of the immutable committed archive — they move only when a new dataset
// lands. Test names follow Subject_Scenario_Outcome.

describe.skipIf(!duckDbAvailable())('survival/cohort — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let c: SurvivalCohort;
  beforeAll(() => {
    // One claims source for the whole suite: the shared deploy-time Parquet
    // where the run provides one (CLAIMS_PARQUET), else a full-corpus build.
    handle = acquireClaimsSource();
    c = computeSurvivalCohort(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  it('SurvivalCohortReport_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), SURVIVAL_COHORT_PATH), 'utf8');
    expect(renderSurvivalCohort(c)).toBe(golden);
  });

  it('SurvivalCohortFold_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderSurvivalCohort(computeSurvivalCohort(handle.source))).toBe(renderSurvivalCohort(c));
  });

  it('DeclaredCompleteVintages_ExcludeTheTruncatedPartials_LatestIsTheNewestFullExport', () => {
    // The vanished-cohort narrative's discipline: the 1,074-row partials are set
    // aside, so presence is judged only against the full exports.
    expect(c.declaredCompleteVintages).not.toContain('2025-05-27');
    expect(c.declaredCompleteVintages).not.toContain('2025-06-08');
    expect(c.baseVintage).toBe('2022-05-30');
    expect(c.latestVintage).toBe('2026-06-23');
  });

  it('OutcomeTaxonomy_OverTheWholeRegister_IsDominatedByRightCensoredLiveLicences', () => {
    const by = new Map(c.outcomes.map(o => [o.outcome, o.subjects]));
    const total = c.outcomes.reduce((sum, o) => sum + o.subjects, 0);
    expect(total).toBe(162_998);
    // The censoring point: the overwhelming majority are still listed.
    const stillCensored = (by.get('still-listed') ?? 0) + (by.get('cancelled-still-listed') ?? 0);
    expect(stillCensored / total).toBeGreaterThan(0.96);
    expect(by.get('still-listed')).toBe(151_634);
    // Vanished is a small, first-class cohort — evidence-of-absence, never death.
    expect(by.get('vanished')).toBe(3_969);
    expect(by.get('cancelled-and-departed')).toBe(717);
  });

  it('LivingAgeCurve_IsAllRightCensored_WithThePre1977BodyHeldApart', () => {
    const total = c.livingAge.reduce((sum, r) => sum + r.subjects, 0);
    expect(total).toBe(123_854); // every currently-listed start-dated licence
    // The pre-1977 attested-unreliable body is shown apart and never lands in a
    // reliable sub-40-year band (a pre-1977 start is at least ~49 years old).
    const pre1977 = c.livingAge.filter(r => r.era === 'pre-1977');
    expect(pre1977.every(r => r.bucketId === 'e' || r.bucketId === 'f')).toBe(true);
    expect(pre1977.reduce((s, r) => s + r.subjects, 0)).toBe(4_831);
  });

  it('ObservedLifespans_FromDisjointStartAndCancellationDisclosures_AreNearAbsent', () => {
    // The central sparsity finding: 7,397 cancellation dates, but only a handful
    // pair with a strictly-earlier start — the two ends of a life are attested by
    // structurally different disclosures, so complete lifespans barely exist.
    expect(c.observedEnds.cancelSubjects).toBe(7_397);
    expect(c.observedEnds.sameDay).toBe(7_324);
    expect(c.observedEnds.positiveSpan).toBe(6);
    expect(c.observedEnds.spanAtLeastOneYear).toBe(5);
  });

  it('EraCohortRetention_AcrossEveryStartDecade_StaysHighAndCoversTheFullSpan', () => {
    const decades = c.eraCohort.map(r => r.decade);
    expect(decades).toContain('1900s');
    expect(decades).toContain('2020s');
    // The 2020s cohort cannot show a dated cancellation (attestation stops
    // 2020-10-06), so its absentees are vanished by construction, not behaviour.
    const twenties = c.eraCohort.find(r => r.decade === '2020s');
    expect(twenties?.cancelledDeparted).toBe(0);
    expect((twenties?.vanished ?? 0)).toBeGreaterThan(0);
    // Retention is high everywhere the cohort is non-trivial.
    for (const r of c.eraCohort) {
      if (r.subjects >= 1_000) expect(r.stillListed / r.subjects).toBeGreaterThan(0.95);
    }
  });

  it('ClassRetention_ByPrefixImpliedClass_CoversTheThreeUkClassesWithHighSurvival', () => {
    const by = new Map(c.classRetention.map(r => [r.licenceClass, r]));
    for (const cls of ['Full', 'Foundation', 'Intermediate']) {
      const row = by.get(cls);
      expect(row, `class ${cls}`).toBeDefined();
      expect((row?.stillListed ?? 0) / (row?.base ?? 1)).toBeGreaterThan(0.95);
    }
    expect(by.get('Full')?.base).toBe(93_170);
  });

  it('ReservationSummary_OverReservedUntilWindows_FlagsPolicyExceptionsAndReallocation', () => {
    expect(c.reservation.subjects).toBe(4_369);
    // The two-year policy hook (issue #863): a body of windows outrun it.
    expect(c.reservation.overTwoYears).toBe(374);
    expect(c.reservation.overFiveYears).toBe(1); // the shape of issue #568
    // The reserved-cohort ambiguity: many "windows" are retrospective terminations.
    expect(c.reservation.retrospective).toBeGreaterThan(3_000);
    expect(c.reservation.indefinite).toBe(1);
    expect(c.reservation.withLaterStart).toBe(121);
  });
});
