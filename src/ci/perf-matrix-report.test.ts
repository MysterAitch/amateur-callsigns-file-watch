import { describe, it, expect } from 'vitest';
import {
  summariseArm,
  compareToBaseline,
  computeRatios,
  renderMatrixMarkdown,
  type ArmRun,
  type ArmSummary,
} from './perf-matrix-report.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// This module turns repeated timings into claims. Every defect it can carry is
// a claim that reads as solid and is not - a median computed from one sample, a
// ratio quoted without its spread, a regression reported against a baseline
// measured on different hardware. The suite below is mostly about REFUSING to
// state things, which is the part that is easy to get wrong and impossible to
// notice afterwards.

const runs = (id: string, seconds: number[]): ArmRun[] =>
  seconds.map((s, i) => ({ arm: id, rep: i + 1, elapsedS: s, peakRssKb: 0, status: 0 }));

describe('summariseArm', { tags: ['unit'] }, () => {
  it('Summary_OddNumberOfReps_UsesTheMiddleValueNotTheMean', () => {
    // Median, not mean: one 3x outlier (observed on the real runners) would drag
    // a mean far enough to invent or hide a difference.
    const s = summariseArm(runs('a', [10, 12, 40]));
    expect(s.medianS).toBe(12);
  });

  it('Summary_EvenNumberOfReps_AveragesTheTwoMiddleValues', () => {
    expect(summariseArm(runs('a', [10, 12, 14, 20])).medianS).toBe(13);
  });

  it('Summary_UnsortedInput_StillReportsTheCorrectMedian', () => {
    // The collator reads artefacts in directory order, which is not run order.
    expect(summariseArm(runs('a', [40, 10, 12])).medianS).toBe(12);
  });

  it('Summary_WidelyVaryingReps_ReportsTheSpreadAlongsideTheMedian', () => {
    // The real matrix produced 4.5 and 7.7 minutes on identical configuration.
    // A median that does not carry its spread invites exactly the overconfidence
    // that produced the reading it is correcting.
    const s = summariseArm(runs('a', [270, 462]));
    expect(s.minS).toBe(270);
    expect(s.maxS).toBe(462);
    expect(s.spreadRatio).toBeCloseTo(462 / 270, 3);
  });

  it('Summary_SingleRep_IsFlaggedAsUnreliableRatherThanReportedPlainly', () => {
    const s = summariseArm(runs('a', [300]));
    expect(s.reps).toBe(1);
    expect(s.reliable).toBe(false);
  });

  it('Summary_EnoughRepsAndTightSpread_IsReportedAsReliable', () => {
    expect(summariseArm(runs('a', [300, 305, 298])).reliable).toBe(true);
  });

  it('Summary_EnoughRepsButWildSpread_IsNotReportedAsReliable', () => {
    // Three reps do not rescue a 1.7x spread. Count is not confidence.
    expect(summariseArm(runs('a', [270, 300, 462])).reliable).toBe(false);
  });

  it('Summary_FailedReps_AreExcludedFromTheTimingButRecorded', () => {
    // A crashed arm's elapsed time measures the crash, not the work.
    const withFailure: ArmRun[] = [
      { arm: 'a', rep: 1, elapsedS: 300, peakRssKb: 0, status: 0 },
      { arm: 'a', rep: 2, elapsedS: 12, peakRssKb: 0, status: 1 },
    ];
    const s = summariseArm(withFailure);
    expect(s.medianS).toBe(300);
    expect(s.reps).toBe(1);
    expect(s.failures).toBe(1);
  });

  it('Summary_EveryRepFailed_ReportsNoTimingAtAll', () => {
    const allFailed: ArmRun[] = [{ arm: 'a', rep: 1, elapsedS: 9, peakRssKb: 0, status: 1 }];
    const s = summariseArm(allFailed);
    expect(s.medianS).toBeNull();
    expect(s.reliable).toBe(false);
  });
});

describe('computeRatios', { tags: ['unit'] }, () => {
  const summaries = (input: Record<string, number[]>): ArmSummary[] =>
    Object.entries(input).map(([id, secs]) => summariseArm(runs(id, secs)));

  it('Ratio_VariantAgainstBaseline_ReportsTheMultiple', () => {
    const [r] = computeRatios(
      summaries({ base: [200, 200, 200], variant: [520, 520, 520] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.ratio).toBeCloseTo(2.6, 2);
  });

  it('Ratio_NoisyVariantWhoseRangeStillClearsTheBaseline_IsSettledOnDirection', () => {
    // CORRECTED after the first real run. This case (base 198..205 against a
    // very noisy variant 270..462) originally asserted NOT settled, on the
    // grounds that a 1.7x spread cannot support a confident ratio.
    //
    // That conflated two questions. The variant's MINIMUM sits 32% above the
    // baseline's MAXIMUM, so the effect is unambiguously real - only its
    // magnitude is imprecise. `settled` answers "is this difference real?"; the
    // spread column, rendered in bold when wide, answers "how precisely do we
    // know it?". Answering the first with the second is what marked a genuine
    // 3.18x finding "indicative only".
    const [r] = computeRatios(
      summaries({ base: [200, 205, 198], variant: [270, 462] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(true);
  });

  it('Ratio_NoisyVariantWhoseRangeReachesIntoTheBaseline_IsNotSettled', () => {
    // The concern the test above used to carry, stated correctly: here the
    // variant's noise genuinely could explain the difference, because its range
    // overlaps the baseline's.
    const [r] = computeRatios(
      summaries({ base: [200, 205, 260], variant: [230, 462] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(false);
  });

  it('Ratio_WhenBothSidesAreTight_IsMarkedSettled', () => {
    const [r] = computeRatios(
      summaries({ base: [200, 205, 198], variant: [520, 515, 522] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(true);
  });

  it('Ratio_WhenAnArmIsMissingEntirely_IsOmittedRatherThanGuessed', () => {
    const out = computeRatios(summaries({ base: [200] }), [{ id: 'tax', baseline: 'base', variant: 'absent' }]);
    expect(out).toEqual([]);
  });
});

describe('compareToBaseline', { tags: ['unit'] }, () => {
  const current = [summariseArm(runs('a', [220, 225, 218]))];

  it('BaselineComparison_SignificantSlowdown_IsReportedAsARegression', () => {
    const d = compareToBaseline(current, { recordedAt: '2026-01-01', node: 'v25.0.0', arms: { a: 150 } });
    expect(d[0].direction).toBe('slower');
    expect(d[0].delta).toBeCloseTo(220 / 150, 2);
  });

  it('BaselineComparison_SmallMovement_IsReportedAsNoiseNotAChange', () => {
    // Runner-to-runner variation is routinely 10%+. Calling that a regression
    // trains everyone to ignore the report.
    const d = compareToBaseline(current, { recordedAt: '2026-01-01', node: 'v25.0.0', arms: { a: 215 } });
    expect(d[0].direction).toBe('unchanged');
  });

  it('BaselineComparison_DifferentNodeVersion_StillComparesButSaysSo', () => {
    // The whole point of keeping baselines is to see what a Node upgrade did -
    // so the comparison must still run, while never letting the reader forget
    // the runtime moved underneath it.
    const d = compareToBaseline(current, { recordedAt: '2026-01-01', node: 'v24.0.0', arms: { a: 150 } });
    expect(d[0].comparable).toBe(false);
    expect(d[0].delta).toBeCloseTo(220 / 150, 2);
  });

  it('BaselineComparison_ArmAbsentFromBaseline_IsReportedAsNewNotAsAChange', () => {
    const d = compareToBaseline(current, { recordedAt: '2026-01-01', node: 'v25.0.0', arms: {} });
    expect(d[0].direction).toBe('new');
  });
});

describe('renderMatrixMarkdown', { tags: ['unit'] }, () => {
  it('Report_UnreliableArm_CarriesItsWarningIntoTheRenderedTable', () => {
    // A caveat that exists only in the data and not in the output is a caveat
    // nobody will ever read.
    const md = renderMatrixMarkdown([summariseArm(runs('wild', [270, 462]))], [], []);
    expect(md).toContain('wild');
    expect(md.toLowerCase()).toContain('spread');
  });

  it('Report_NoRunsAtAll_SaysSoRatherThanRenderingAnEmptyTable', () => {
    expect(renderMatrixMarkdown([], [], []).toLowerCase()).toContain('no ');
  });
});

// Added after the mechanism's first real run (#1004) reported "indicative only"
// against a 3.18x effect, because ONE arm spread 1.26x against a fixed 1.25
// threshold. The reliability test was effect-agnostic: a 26% spread genuinely
// prevents resolving a 4% difference and says nothing about a 218% one. That is
// the cry-wolf failure this module exists to avoid, so `settled` now asks
// whether the arms' observed RANGES separate rather than whether each arm is
// tight in isolation.
describe('computeRatios — settled is judged against the effect, not a fixed spread', { tags: ['unit'] }, () => {
  const from = (input: Record<string, number[]>): ArmSummary[] =>
    Object.entries(input).map(([id, secs]) =>
      summariseArm(secs.map((s, i) => ({ arm: id, rep: i + 1, elapsedS: s, peakRssKb: 0, status: 0 }))));

  it('Ratio_HugeEffectDespiteAWideBaseline_IsSettledBecauseTheRangesDoNotOverlap', () => {
    // The real case: pages-nocov 145..182 against pages-v8 484..634. No sample
    // of either arm comes close to the other; disclaiming this is absurd.
    const [r] = computeRatios(
      from({ base: [145, 172, 176, 180, 182], variant: [484, 547, 560, 600, 634] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.ratio).toBeGreaterThan(3);
    expect(r.settled).toBe(true);
  });

  it('Ratio_SmallEffectWithOverlappingRanges_IsNotSettled', () => {
    // pages-istanbul 182..196 against pages-nocov 145..182: the ranges touch, so
    // this sample cannot separate an 8% difference from noise.
    const [r] = computeRatios(
      from({ base: [145, 172, 176, 180, 182], variant: [182, 185, 188, 190, 196] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(false);
  });

  it('Ratio_ControlArmAgainstItsTwin_IsNeverSettled', () => {
    // The control MUST come back unsettled - that is what "no effect" looks
    // like, and a settled control would mean the harness invents differences.
    const [r] = computeRatios(
      from({ base: [145, 172, 176, 180, 182], variant: [143, 170, 174, 179, 182] }),
      [{ id: 'control', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(false);
  });

  it('Ratio_TooFewRepsToSeeARange_IsNotSettledEvenWhenTheMediansDiffer', () => {
    // A single rep per arm has no range at all, so separation is unmeasurable.
    const [r] = computeRatios(
      from({ base: [100], variant: [400] }),
      [{ id: 'tax', baseline: 'base', variant: 'variant' }],
    );
    expect(r.settled).toBe(false);
  });
});
