import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeSequenceAnalytics,
  renderSequenceAnalytics,
  SEQUENCE_ANALYTICS_PATH,
  type SequenceAnalytics,
} from './sequence-analytics.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #864: the sequence-analytics engine validated against the committed
// archive's ground truth, and its committed golden pinned byte-for-byte. Test
// names follow Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read, like the other
// data-validity goldens.

describe.skipIf(!duckDbAvailable())('sequence analytics — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let a: SequenceAnalytics;
  beforeAll(() => {
    // One claims source for the whole suite: the shared deploy-time Parquet where
    // the run provides one (CLAIMS_PARQUET), else a one-off full-corpus build.
    handle = acquireClaimsSource();
    a = computeSequenceAnalytics(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  const series = (name: string) => a.series.find(s => s.series === name);

  // --- The committed report is exactly this fold -------------------------

  it('SequenceAnalytics_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), SEQUENCE_ANALYTICS_PATH), 'utf8');
    expect(renderSequenceAnalytics(a)).toBe(golden);
  });

  it('SequenceAnalytics_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderSequenceAnalytics(computeSequenceAnalytics(handle.source))).toBe(renderSequenceAnalytics(a));
  });

  // --- Coverage honesty ----------------------------------------------------

  it('Coverage_OverTheCommittedArchive_StatesTheSlotAndDatedTotalsExactly', () => {
    expect(a.series).toHaveLength(20);
    expect(a.totalSlots).toBe(162_563);
    expect(a.datedSlots).toBe(125_726);
    expect(a.latestAllocDay).toBe('2026-06-11');
  });

  // --- H5: allocation order is NOT strictly sequential ---------------------

  it('AllocationOrder_AcrossEverySeries_IsAtMostBroadlySequentialNeverStrongly', () => {
    // The load-bearing H5 evidence: no series reaches strong sequential issuance
    // (ρ ≥ 0.9). The strongest, G0, only reaches ~0.73 — a broad forward drift,
    // not the clean sequential handout the hypothesis assumed.
    const rhos = a.series.map(s => s.correlation).filter((r): r is number => r !== null);
    const maxRho = Math.max(...rhos);
    expect(maxRho).toBeLessThan(0.75);
    const strongest = a.series.filter(s => s.correlation === maxRho);
    expect(strongest.map(s => s.series)).toEqual(['G0']);
  });

  it('AllocationOrder_TheYoungFullSeriesG0_ShowsTheStrongestForwardDrift', () => {
    const g0 = series('G0');
    expect(g0?.correlation ?? 0).toBeCloseTo(0.729, 2);
    expect(g0?.adjacentMonotonic ?? 0).toBeCloseTo(0.826, 2);
  });

  it('AllocationOrder_TheOldReissueHeavyG2Series_IsReverseOrdered', () => {
    // G2 is a formerly-issued vintage series dominated by reissues to new
    // holders — its dated order runs BACKWARD against the suffix sequence,
    // exactly the pattern reissue would produce.
    const g2 = series('G2');
    expect(g2?.correlation ?? 0).toBeLessThan(0);
    expect(g2?.correlation ?? 0).toBeCloseTo(-0.446, 2);
  });

  // --- The engaging headline: M7 is nearly full ----------------------------

  it('M7_TheActiveFoundationSeries_IsThreeQuartersFullWithANearRunOut', () => {
    const m7 = series('M7');
    expect(m7?.population).toBe(13_721);
    expect(m7?.dated).toBe(13_598);
    // Most M7 slots are dated only by original-start (the 2019 issued disclosure
    // predates most M7 issuance) — the projection leans on the earliest-surviving
    // signal, which is stated in the report.
    expect(m7?.datedIssued).toBe(1_357);
    expect(m7?.projection?.remaining).toBe(3_858);
    expect(m7?.projection?.projectedExhaustionYear).toBe(2029);
  });

  it('M3_TheFirstFoundationSeries_ReadsAsEffectivelyExhausted', () => {
    const m3 = series('M3');
    expect(m3?.projection?.fill ?? 0).toBeGreaterThan(0.9);
    expect(m3?.projection?.remaining ?? 0).toBeLessThan(1_000);
  });

  // --- The surfaced anomaly: the reserved-only M2 prefix -------------------

  it('M2_TheReservedOnlyPrefix_SurfacesAsAKnownUnexpectedSeries', () => {
    // M2 is reserved but never issued; a single M2 slot appears in the corpus and
    // the report flags it as absent from the reference series list — an assumption
    // violated in the open, not silently swallowed.
    const m2 = series('M2');
    expect(m2?.known).toBe(false);
    expect(m2?.population).toBe(1);
    expect(m2?.dated).toBe(0);
  });

  it('Projections_AreConfinedToCurrentlyIssuingSeries', () => {
    const projected = a.series.filter(s => s.projection !== null);
    expect(projected.length, 'no series carried a projection to check').toBeGreaterThan(0);
    for (const s of projected) {
      expect(s.issuingStatus).toBe('currently-issuing');
    }
  });
});
