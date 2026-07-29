import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeReprocessingStratification,
  renderReprocessingStratification,
  seriesEnrichmentFor,
  seriesGroupShare,
  REPROCESSING_STRATIFICATION_PATH,
  type ReprocessingStratification,
} from './reprocessing-stratification.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #871: the series-stratified reprocessing observation validated against
// the committed corpus's ground truth, and its committed golden pinned
// byte-for-byte. Test names follow Subject_Scenario_Outcome.
//
// The figures asserted exactly are figures of the immutable FOI register
// snapshots (the 2024-07 and 2024-10 exports), so they change only when the
// corpus itself does — exactly when this suite should demand a deliberate
// re-read of the golden.

describe.skipIf(!duckDbAvailable())('reprocessing stratification — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let strat: ReprocessingStratification;
  beforeAll(() => {
    handle = acquireClaimsSource();
    strat = computeReprocessingStratification(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  const enrich = (vintage: string, seriesName: string) =>
    seriesEnrichmentFor(strat, vintage).find(e => e.series === seriesName);

  // --- The committed report is exactly this fold -------------------------

  it('ReprocessingStratification_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), REPROCESSING_STRATIFICATION_PATH), 'utf8');
    expect(renderReprocessingStratification(strat)).toBe(golden);
  });

  it('ReprocessingStratification_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderReprocessingStratification(computeReprocessingStratification(handle.source))).toBe(renderReprocessingStratification(strat));
  });

  // --- The filed finding: the 2024-10 run largely excludes M7 --------------

  it('Cohort2024_10_LargelyExcludesM7_AsFiledOnIssue871', () => {
    // Not a coverage gap: M7 is present in the export (10,854 records) with
    // prior observations available; it is depleted in the touch cohort (~2% of
    // the cohort against ~7% of the export) — the observation that prompted #871.
    const m7 = enrich('2024-10-21', 'M7');
    expect(m7?.baseSubjects).toBe(10_854);
    expect(m7?.cohortSubjects).toBe(983);
    expect(m7?.enrichment).toBe('depleted');
    expect((m7?.baseShare ?? 0) * 100).toBeCloseTo(6.9, 1);
    expect((m7?.cohortShare ?? 0) * 100).toBeCloseTo(2.0, 1);
  });

  it('Cohort2024_10_TotalIsTheFiled49_4kSubjects', () => {
    const window = strat.windows.find(w => w.vintage === '2024-10-21');
    expect(window?.cohortSubjects).toBe(49_427);
  });

  it('Cohort2024_10_OlderGSeriesEnrichedAsABloc_ReproducesTheVerificationDerivation', () => {
    // The verification derivation reported the G-series as a bloc at 52.7% of
    // the cohort vs 48.6% of the export; the pinned convention reproduces it.
    const g = seriesGroupShare(strat, '2024-10-21', s => /^G[0-9]/.test(s));
    expect(g.cohortShare * 100).toBeCloseTo(52.7, 1);
    expect(g.baseShare * 100).toBeCloseTo(48.6, 1);
  });

  // --- The converse cohort: 2024-07 enriches the same series ---------------

  it('Cohort2024_07_EnrichedInTheNewerFoundationSeries_AsTheSpikeDerivationFound', () => {
    // The spike's direction reproduced: M7 and M6 enriched, M0 above parity.
    const m7 = enrich('2024-07', 'M7');
    const m6 = enrich('2024-07', 'M6');
    const m0 = enrich('2024-07', 'M0');
    expect(m7?.baseSubjects).toBe(10_219);
    expect(m7?.cohortSubjects).toBe(7_407);
    expect(m7?.enrichment).toBe('enriched');
    expect(m6?.enrichment).toBe('enriched');
    // M0 is enriched in direction (cohort share exceeds base share) even where
    // its multiple sits just under the enriched threshold.
    expect(m0?.cohortShare ?? 0).toBeGreaterThan(m0?.baseShare ?? 1);
  });

  it('Stratification_2024_07_And_2024_10_MoveM7InOppositeDirections', () => {
    // The headline of #871: the same series is enriched in one run and depleted
    // in the very next — the touches are stratified, and the stratification
    // changes from run to run (not a stable class bias).
    expect(enrich('2024-07', 'M7')?.enrichment).toBe('enriched');
    expect(enrich('2024-10-21', 'M7')?.enrichment).toBe('depleted');
  });

  // --- Non-happy corpus scenarios ------------------------------------------

  it('Republication2023_02_20_RepeatsPredecessorDates_YieldsAnEmptyCohort', () => {
    // The 2023-02-20 open-data snapshot republishes the 2023-01-25 FOI export's
    // dates: nothing falls in its window, so it carries no cohort to stratify.
    const window = strat.windows.find(w => w.vintage === '2023-02-20');
    expect(window?.cohortSubjects).toBe(0);
  });

  it('MassEpisodes_AreDetectedButCoincideWithNoTouchCohortWindow', () => {
    // The S2 detector flags the mass-update episodes (the 2016 migration and the
    // 2025-10 touch); none of the inter-snapshot touch windows overlap them —
    // the reprocessing cohorts are exactly the spread-out mass touches the
    // 21-day S2 window cannot see (issue #872), a coincidence never asserted.
    expect(strat.episodes.length).toBeGreaterThan(0);
    expect(strat.windows.every(w => !w.overlapsEpisode)).toBe(true);
  });

  it('Windows_EveryCohortIsASubsetOfItsBase_AndSharesAreHonestFractions', () => {
    for (const w of assertNonEmpty(strat.windows, 'reprocessing-stratification windows')) {
      expect(w.cohortSubjects).toBeLessThanOrEqual(w.baseSubjects);
      const seriesTotal = strat.rows.filter(r => r.vintage === w.vintage).reduce((sum, r) => sum + r.baseSubjects, 0);
      // The per-series base subjects partition the window's base exactly.
      expect(seriesTotal).toBe(w.baseSubjects);
    }
  });
});
