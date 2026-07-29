import { describe, it, expect } from 'vitest';
import {
  robustNorm,
  modifiedZ,
  exceedsThreshold,
  detectDeviation,
  evaluateDataset,
  renderFlag,
  renderDatasetAnomalyFlags,
  renderPublishedObservation,
  computeDatasetAnomalyFlags,
  anomalyMetricsChecked,
  MODIFIED_Z_THRESHOLD,
  MIN_SHARE_DELTA,
  type DatasetMetricSet,
  type DatasetWindow,
  type DatasetAnomalyFlag,
} from './dataset-anomaly-flags.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #467: dataset-level anomaly flags. EXPERIMENTAL / LOCAL-ONLY — not
// wired into report-sweep, so these tests guard the module directly rather
// than a committed report's markdown. Test names follow Subject_Scenario_Outcome.

describe('dataset anomaly flags — robust statistics', { tags: ['unit'] }, () => {
  it('RobustNorm_UniformValues_MedianEqualsValueAndMadZero', () => {
    const norm = robustNorm([10, 10, 10, 10]);
    expect(norm.median).toBe(10);
    expect(norm.mad).toBe(0);
  });

  it('RobustNorm_OddAndEvenSamples_MedianMatchesHandComputation', () => {
    expect(robustNorm([1, 3, 5]).median).toBe(3);
    expect(robustNorm([1, 3, 5, 7]).median).toBe(4);
  });

  it('ModifiedZ_ZeroSpreadNeighbourhoodAndTiedValue_ReturnsZero', () => {
    expect(modifiedZ(10, { median: 10, mad: 0 })).toBe(0);
  });

  it('ModifiedZ_ZeroSpreadNeighbourhoodAndHigherValue_ReturnsPositiveInfinity', () => {
    expect(modifiedZ(11, { median: 10, mad: 0 })).toBe(Infinity);
  });

  it('ModifiedZ_ZeroSpreadNeighbourhoodAndLowerValue_ReturnsNegativeInfinity', () => {
    expect(modifiedZ(9, { median: 10, mad: 0 })).toBe(-Infinity);
  });
});

describe('dataset anomaly flags — detectDeviation', { tags: ['unit'] }, () => {
  it('DetectDeviation_FewerThanMinNeighbours_ReturnsUndefinedRatherThanFlaggingOrClearing', () => {
    // A single neighbour is "too few to judge" — this must not be conflated
    // with "conforms" (undefined here) at the detectDeviation level; the
    // caller distinguishes the two via insufficientNeighbours.
    expect(detectDeviation('record count', 'count', 100, [90])).toBeUndefined();
    expect(detectDeviation('record count', 'count', 100, [])).toBeUndefined();
  });

  it('DetectDeviation_ValueContinuingASteadyTrend_DoesNotFlagALegitimateLargeChange', () => {
    // The window is symmetric (evenly-spaced neighbours before AND after), so
    // a value that continues a smooth linear trend sits near the neighbours'
    // median rather than at an extreme — a large absolute change from any one
    // neighbour, but not a deviation from the NEIGHBOURHOOD's own norm.
    const neighbours = [100_000, 110_000, 130_000, 140_000]; // current would sit at 120,000, the trend's midpoint
    const dev = detectDeviation('record count', 'count', 120_000, neighbours);
    expect(dev).toBeUndefined();
  });

  // The inclusive-at-the-threshold boundary itself, tested directly against
  // hand-picked z-values rather than reconstructed through robustNorm/
  // modifiedZ's floating-point arithmetic (which cannot reliably reproduce an
  // EXACT z of 3.5 — see exceedsThreshold's doc-comment).
  it('ExceedsThreshold_ValueExactlyAtThreshold_ReturnsFalseSoTheDatasetConforms', () => {
    expect(exceedsThreshold(MODIFIED_Z_THRESHOLD)).toBe(false);
    expect(exceedsThreshold(-MODIFIED_Z_THRESHOLD)).toBe(false);
  });

  it('ExceedsThreshold_ValueJustBeyondThreshold_ReturnsTrueSoTheDatasetIsFlagged', () => {
    expect(exceedsThreshold(MODIFIED_Z_THRESHOLD + 0.0001)).toBe(true);
    expect(exceedsThreshold(-MODIFIED_Z_THRESHOLD - 0.0001)).toBe(true);
  });

  it('DetectDeviation_NeighboursProducingAModifiedZWellBeyondThreshold_Flags', () => {
    const neighbours = [98, 99, 100, 101, 102];
    // 130 sits far outside this tight neighbourhood (median 100, mad 1).
    const dev = detectDeviation('record count', 'count', 130, neighbours);
    expect(dev).toBeDefined();
    expect(dev?.direction).toBe('above');
    expect(exceedsThreshold(dev?.z ?? 0)).toBe(true);
  });

  it('DetectDeviation_NeighboursProducingAModifiedZWellWithinThreshold_DoesNotFlag', () => {
    const neighbours = [98, 99, 100, 101, 102];
    // 102 sits comfortably inside the same neighbourhood.
    expect(detectDeviation('record count', 'count', 102, neighbours)).toBeUndefined();
  });

  it('DetectDeviation_ShareMetricBelowPracticalFloor_NotFlaggedDespiteHighZ', () => {
    // Neighbours all sit at a near-zero share with a tiny spread; the current
    // value differs by less than MIN_SHARE_DELTA even though the modified
    // z-score alone would clear the threshold comfortably.
    const neighbours = [0.0001, 0.0001, 0.0002];
    const value = 0.0004;
    const norm = robustNorm(neighbours);
    expect(Math.abs(modifiedZ(value, norm))).toBeGreaterThan(MODIFIED_Z_THRESHOLD);
    expect(detectDeviation('status share', 'share', value, neighbours, MIN_SHARE_DELTA)).toBeUndefined();
  });

  it('DetectDeviation_ShareMetricAboveFloorAndThreshold_Flags', () => {
    const neighbours = [0.66, 0.665, 0.661, 0.663];
    const value = 0.5; // a genuinely marked ~16-point swing
    const dev = detectDeviation('Allocated share', 'share', value, neighbours, MIN_SHARE_DELTA);
    expect(dev).toBeDefined();
    expect(dev?.direction).toBe('below');
  });
});

// --- evaluateDataset: pure, synthetic fixtures --------------------------

function metricSet(recordCount: number, statusShare: Record<string, number>, productEmptyShare: number | undefined): DatasetMetricSet {
  return { recordCount, statusShare, productEmptyShare };
}

function window(before: string[], after: string[], excludedPartial: string[] = []): DatasetWindow {
  return { key: 'current', before, after, excludedPartial };
}

describe('dataset anomaly flags — evaluateDataset', { tags: ['unit'] }, () => {
  it('EvaluateDataset_RecordCountDrop_FlagsBelowDirectionWithNeighbourMagnitude', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b2', metricSet(150_000, { Allocated: 0.6 }, 0.2)],
      ['b1', metricSet(152_000, { Allocated: 0.6 }, 0.2)],
      ['a1', metricSet(151_000, { Allocated: 0.6 }, 0.2)],
      ['a2', metricSet(153_000, { Allocated: 0.6 }, 0.2)],
    ]);
    const flag = evaluateDataset('current', window(['b2', 'b1'], ['a1', 'a2']), metricSet(1_000, { Allocated: 0.6 }, 0.2), neighbours);
    expect(flag.insufficientNeighbours).toBe(false);
    const rc = flag.deviations.find(d => d.metric === 'record count');
    expect(rc).toBeDefined();
    expect(rc?.direction).toBe('below');
    expect(rc?.value).toBe(1_000);
  });

  it('EvaluateDataset_RecordCountSpike_FlagsAboveDirection', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b1', metricSet(150_000, {}, undefined)],
      ['b2', metricSet(151_000, {}, undefined)],
      ['a1', metricSet(149_500, {}, undefined)],
      ['a2', metricSet(150_500, {}, undefined)],
    ]);
    const flag = evaluateDataset('current', window(['b1', 'b2'], ['a1', 'a2']), metricSet(400_000, {}, undefined), neighbours);
    const rc = flag.deviations.find(d => d.metric === 'record count');
    expect(rc?.direction).toBe('above');
  });

  it('EvaluateDataset_NoNeighboursHeld_MarksInsufficientRatherThanConforming', () => {
    const flag = evaluateDataset('current', window([], []), metricSet(100_000, {}, undefined), new Map());
    expect(flag.insufficientNeighbours).toBe(true);
    expect(flag.deviations).toHaveLength(0);
  });

  it('EvaluateDataset_SteadyGrowthAcrossWindow_DoesNotFlagALegitimateLargeChange', () => {
    // A smooth, monotonic rise either side of "current" — current continues
    // the trend rather than departing from it, so no metric should flag even
    // though every absolute figure is a "large change" from any one neighbour.
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b2', metricSet(100_000, {}, undefined)],
      ['b1', metricSet(110_000, {}, undefined)],
      ['a1', metricSet(130_000, {}, undefined)],
      ['a2', metricSet(140_000, {}, undefined)],
    ]);
    const flag = evaluateDataset('current', window(['b2', 'b1'], ['a1', 'a2']), metricSet(120_000, {}, undefined), neighbours);
    expect(flag.deviations).toHaveLength(0);
  });

  it('EvaluateDataset_StatusShareShift_FlagsLicenceTypeDistributionChange', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b1', metricSet(150_000, { Allocated: 0.66, Reserved: 0.34 }, undefined)],
      ['b2', metricSet(150_000, { Allocated: 0.665, Reserved: 0.335 }, undefined)],
      ['a1', metricSet(150_000, { Allocated: 0.661, Reserved: 0.339 }, undefined)],
      ['a2', metricSet(150_000, { Allocated: 0.663, Reserved: 0.337 }, undefined)],
    ]);
    const flag = evaluateDataset('current', window(['b1', 'b2'], ['a1', 'a2']), metricSet(150_000, { Allocated: 0.5, Reserved: 0.5 }, undefined), neighbours);
    const allocatedDev = flag.deviations.find(d => d.metric === 'Allocated share');
    expect(allocatedDev).toBeDefined();
    expect(allocatedDev?.direction).toBe('below');
  });

  it('EvaluateDataset_ProductColumnNormallyPopulatedButEmptyHere_FlagsEmptinessSignal', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b1', metricSet(150_000, {}, 0.28)],
      ['b2', metricSet(150_000, {}, 0.29)],
      ['a1', metricSet(150_000, {}, 0.27)],
      ['a2', metricSet(150_000, {}, 0.285)],
    ]);
    const flag = evaluateDataset('current', window(['b1', 'b2'], ['a1', 'a2']), metricSet(150_000, {}, 1.0), neighbours);
    const dev = flag.deviations.find(d => d.metric === 'product-column emptiness');
    expect(dev).toBeDefined();
    expect(dev?.direction).toBe('above');
  });

  it('EvaluateDataset_ProductColumnNormallyEmptyButPopulatedHere_FlagsOppositeDirection', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b1', metricSet(150_000, {}, 0.0)],
      ['b2', metricSet(150_000, {}, 0.0)],
      ['a1', metricSet(150_000, {}, 0.0)],
      ['a2', metricSet(150_000, {}, 0.0)],
    ]);
    const flag = evaluateDataset('current', window(['b1', 'b2'], ['a1', 'a2']), metricSet(150_000, {}, 0.4), neighbours);
    const dev = flag.deviations.find(d => d.metric === 'product-column emptiness');
    expect(dev).toBeDefined();
    expect(dev?.direction).toBe('above');
  });

  it('EvaluateDataset_NoProductColumnOnCurrentEntry_SkipsEmptinessCheckRatherThanTreatingAsZero', () => {
    const neighbours = new Map<string, DatasetMetricSet>([
      ['b1', metricSet(150_000, {}, 0.28)],
      ['a1', metricSet(150_000, {}, 0.27)],
    ]);
    const flag = evaluateDataset('current', window(['b1'], ['a1']), metricSet(150_000, {}, undefined), neighbours);
    expect(flag.deviations.find(d => d.metric === 'product-column emptiness')).toBeUndefined();
  });
});

// --- Rendering: no adjudication, ever ------------------------------------

describe('dataset anomaly flags — render', { tags: ['unit'] }, () => {
  const conforming: DatasetAnomalyFlag = { key: '2026-06-23', window: window(['a', 'b'], ['c']), deviations: [], insufficientNeighbours: false };
  const insufficient: DatasetAnomalyFlag = { key: '2013-09-06', window: window([], []), deviations: [], insufficientNeighbours: true };
  const flagged: DatasetAnomalyFlag = {
    key: '2026-01-14',
    window: window(['2025-04-08', '2025-06-04'], ['2026-06-23']),
    deviations: [{ metric: 'record count', unit: 'count', value: 146_417, neighbourMedian: 157_873, neighbourMad: 1_234, neighbourCount: 4, z: -6.3, direction: 'below' }],
    insufficientNeighbours: false,
  };

  it('RenderFlag_NoDeviations_StatesConformsButExplicitlyNotACertificate', () => {
    const text = renderFlag(conforming);
    expect(text).toContain('conforms to the norm');
    expect(text).toContain('not a trust certificate');
    expect(text).not.toContain('Caution');
  });

  it('RenderFlag_InsufficientNeighbours_StatesNoFlagAndNotACleanBillOfHealth', () => {
    const text = renderFlag(insufficient);
    expect(text).toContain('too few neighbours to judge');
    expect(text).toContain('not a clean bill of health');
  });

  it('RenderFlag_WithDeviations_UsesCautionTemplateNamesBothWindowSizesAndListsCandidateExplanations', () => {
    const text = renderFlag(flagged);
    expect(text).toContain("Caution: 2026-01-14 doesn't conform to the norms of the 2 before and 1 after it");
    expect(text).toContain('record count is lower than its neighbours\' norm');
    expect(text).toContain('146,417');
    expect(text).toContain('157,873');
    expect(text).toContain('candidate innocent explanations');
    expect(text).toContain('draws no trust verdict');
  });

  it('RenderFlag_EveryOutcome_NeverAssertsTrustworthyOrVerified', () => {
    // Non-adjudication guard: none of the three rendered outcomes may ever
    // assert the dataset itself is good/bad — only that it conforms/does not
    // conform to a neighbour norm.
    for (const text of [renderFlag(conforming), renderFlag(insufficient), renderFlag(flagged)]) {
      expect(text.toLowerCase()).not.toMatch(/\btrustworthy\b|\bverified\b|\bsafe to use\b/);
    }
  });

  it('RenderPublishedObservation_FlaggedDataset_StatesTheDeviationAsAnObservationNotAJudgement', () => {
    // The reader-facing rendering (issue #467's residual): the SAME evaluated
    // deviation, reframed for a published page. Never a verdict.
    const [text] = renderPublishedObservation(flagged);
    expect(text).toContain("This publication's record count deviates from its neighbours' norm");
    expect(text).toContain('modified z = -6.3');
    expect(text).toContain('146,417');
    expect(text).toContain('157,873');
    expect(text).toContain('This is an observation, not a judgement — the cause is not adjudicated here');
  });

  it('RenderPublishedObservation_NoDeviations_RendersNothingRatherThanManufacturingDoubt', () => {
    // Selective disclosure (the render/fidelity.ts flagNudges convention): a
    // conforming or insufficient-neighbours dataset contributes NOTHING to a
    // published list — silence, not a padded "all clear" statement.
    expect(renderPublishedObservation(conforming)).toEqual([]);
    expect(renderPublishedObservation(insufficient)).toEqual([]);
  });

  it('RenderPublishedObservation_EveryOutcome_NeverAssertsAVerdictErrorOrLoweredTrust', () => {
    for (const flag of [conforming, insufficient, flagged]) {
      for (const text of renderPublishedObservation(flag)) {
        expect(text.toLowerCase()).not.toMatch(/\bwrong\b|\berror\b|\bincorrect\b|\bfault\b|\btrustworthy\b|\buntrustworthy\b|\bverified\b|\bsafe to use\b/);
      }
    }
  });

  it('RenderDatasetAnomalyFlags_MultipleFlags_ProducesOneListItemPerDatasetWithHeader', () => {
    const md = renderDatasetAnomalyFlags([conforming, insufficient, flagged]);
    expect(md).toContain('# Dataset anomaly flags (issue #467)');
    expect(md).toContain('EXPERIMENTAL, LOCAL-ONLY, not published');
    expect(md).toContain('- 2026-06-23: conforms');
    expect(md).toContain('- 2013-09-06: too few neighbours');
    expect(md).toContain("- Caution: 2026-01-14 doesn't conform");
  });
});

// The single source of truth build-data-status.ts reads before claiming a
// metric was checked (review fix on the published affordance): record count
// and product-column emptiness read stats.json directly and so are never
// conditional; only the per-status-share flag should track DuckDB
// availability, so the published copy can never claim a check that did not
// run in this build.
describe('dataset anomaly flags — anomalyMetricsChecked', { tags: ['unit'] }, () => {
  it('AnomalyMetricsChecked_AnyEnvironment_RecordCountAndProductEmptyShareAlwaysTrue', () => {
    const checked = anomalyMetricsChecked();
    expect(checked.recordCount).toBe(true);
    expect(checked.productEmptyShare).toBe(true);
  });

  it('AnomalyMetricsChecked_StatusShareFlag_TracksDuckDbAvailabilityExactly', () => {
    expect(anomalyMetricsChecked().statusShare).toBe(duckDbAvailable());
  });
});

// --- Real-archive wiring: the concrete #467/#725 calibration case --------

describe.skipIf(!duckDbAvailable())('dataset anomaly flags — real archive', { tags: ['data-validity'] }, () => {
  it('ComputeDatasetAnomalyFlags_20260114Pair_FlagsRecordCountDropMatchingDocumentedNetChange', () => {
    // docs/source-register.md: 2026-01-14 vs 2025-11-11 is a documented net
    // change of -9,561 Allocated / -3,950 Reserved (-13,478 records overall) —
    // the concrete case issue #725's bi-temporal survey flagged for exactly
    // this kind of detector.
    const flags = computeDatasetAnomalyFlags();
    const flag = flags.find(f => f.key === '2026-01-14');
    expect(flag).toBeDefined();
    expect(flag?.insufficientNeighbours).toBe(false);
    const rc = flag?.deviations.find(d => d.metric === 'record count');
    expect(rc).toBeDefined();
    expect(rc?.direction).toBe('below');
    expect(rc?.value).toBe(146_417);
    const text = renderFlag(flag as DatasetAnomalyFlag);
    expect(text).toContain('Caution: 2026-01-14');
    expect(text).toContain('146,417');
  });

  it('ComputeDatasetAnomalyFlags_KnownFilteredExport20250604_FlagsMultipleSignals', () => {
    // A previously-documented case (build-interdataset-stats.ts's
    // blank-product filter narrative / the ~45,000-record omission): this
    // dataset is declared complete yet is a severe outlier on several
    // independent metrics — a strong real-data check that the detector finds
    // what is already known to be wrong here.
    const flags = computeDatasetAnomalyFlags();
    const flag = flags.find(f => f.key === '2025-06-04');
    expect(flag).toBeDefined();
    expect(flag?.deviations.length).toBeGreaterThanOrEqual(2);
    expect(flag?.deviations.some(d => d.metric === 'record count')).toBe(true);
  });

  it('ComputeDatasetAnomalyFlags_DeclaredPartialPublications_AreNeverFlaggedThemselves', () => {
    // 2025-05-27 and 2025-06-08 are declared-partial (1,074-row) exports —
    // already self-explained by that declaration, so the detector must not
    // re-flag them as a fresh "caution".
    const flags = computeDatasetAnomalyFlags();
    expect(flags.some(f => f.key === '2025-05-27')).toBe(false);
    expect(flags.some(f => f.key === '2025-06-08')).toBe(false);
  });

  it('ComputeDatasetAnomalyFlags_DeclaredPartialNeighbours_AreExcludedFromTheNormButNamedInTheWindow', () => {
    const flags = computeDatasetAnomalyFlags();
    const flag = flags.find(f => f.key === '2026-01-14');
    expect(flag).toBeDefined();
    expect(flag?.window.before).not.toContain('2025-05-27');
    expect(flag?.window.before).not.toContain('2025-06-08');
    expect(flag?.window.excludedPartial).toEqual(expect.arrayContaining(['2025-05-27', '2025-06-08']));
  });

  it('ComputeDatasetAnomalyFlags_EveryRenderedFlag_NeverAssertsTrustworthyOrVerified', () => {
    const flags = assertNonEmpty(computeDatasetAnomalyFlags(), 'dataset anomaly flags');
    for (const flag of flags) {
      const text = renderFlag(flag).toLowerCase();
      expect(text).not.toMatch(/\btrustworthy\b|\bsafe to use\b/);
    }
  });
});
