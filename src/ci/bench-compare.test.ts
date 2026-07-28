import { describe, it, expect } from 'vitest';
import { classifyBenchDelta, compareBenchRuns, renderBenchMarkdown, type BenchResult } from './bench-compare.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The question this module answers is "did that change, or is it jitter?", and
// the two ways to get it wrong are opposite and both fatal to its usefulness:
// cry wolf on noise until nobody reads the report, or stay silent through a real
// regression. So significance is decided by the benchmark's OWN margin of error
// rather than by a guessed percentage band - two results differ only when their
// confidence intervals do not overlap - and a second, independent floor on
// effect size stops a statistically real 0.4% change being announced as news.

const result = (name: string, mean: number, rme: number, samples = 500): BenchResult =>
  ({ name, mean, rme, samples, hz: 1000 / mean });

describe('classifyBenchDelta', { tags: ['unit'] }, () => {
  it('Delta_LargeChangeWellOutsideBothErrorBars_IsReportedAsSignificant', () => {
    const c = classifyBenchDelta(result('x', 100, 1), result('x', 160, 1));
    expect(c.direction).toBe('slower');
    expect(c.significant).toBe(true);
  });

  it('Delta_SmallChangeInsideOverlappingErrorBars_IsReportedAsNoise', () => {
    // 100 +/- 5% and 103 +/- 5% overlap: this is jitter, not a finding.
    expect(classifyBenchDelta(result('x', 100, 5), result('x', 103, 5)).significant).toBe(false);
  });

  it('Delta_TinyButStatisticallyCleanChange_IsNotAnnouncedAsAChange', () => {
    // Intervals do NOT overlap (0.01% error bars), yet the effect is 0.4%.
    // Statistical significance is not practical significance; reporting this
    // would bury the real findings in noise-that-happens-to-be-measurable.
    const c = classifyBenchDelta(result('x', 100, 0.01), result('x', 100.4, 0.01));
    expect(c.significant).toBe(false);
  });

  it('Delta_Improvement_IsReportedAsFasterNotMerelyChanged', () => {
    // Improvements matter as much as regressions: an unexplained speed-up
    // usually means the benchmark stopped measuring what it used to.
    expect(classifyBenchDelta(result('x', 200, 1), result('x', 100, 1)).direction).toBe('faster');
  });

  it('Delta_WildlyNoisyCurrentRun_IsNotTrustedEvenWhenTheMeansDiffer', () => {
    // A 40% margin of error means the run itself is unusable; comparing it
    // against anything produces a confident-looking non-result.
    const c = classifyBenchDelta(result('x', 100, 1), result('x', 160, 40));
    expect(c.significant).toBe(false);
    expect(c.reliable).toBe(false);
  });

  it('Delta_TooFewSamples_IsNotTrusted', () => {
    expect(classifyBenchDelta(result('x', 100, 1), result('x', 160, 1, 3)).reliable).toBe(false);
  });
});

describe('compareBenchRuns', { tags: ['unit'] }, () => {
  it('Comparison_BenchmarkAbsentFromBaseline_IsReportedAsNewNotAsARegression', () => {
    const out = compareBenchRuns([result('fresh', 100, 1)], []);
    expect(out[0].direction).toBe('new');
  });

  it('Comparison_BenchmarkRemovedSinceBaseline_IsSurfacedRatherThanSilentlyDropped', () => {
    // A benchmark that vanishes is exactly the failure a stored baseline exists
    // to catch - silence here would let coverage of a hot path disappear unseen.
    const out = compareBenchRuns([], [result('gone', 100, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('missing');
  });

  it('Comparison_UnchangedBenchmark_IsCarriedThroughAsUnchanged', () => {
    const out = compareBenchRuns([result('x', 100, 2)], [result('x', 101, 2)]);
    expect(out[0].direction).toBe('unchanged');
  });
});

describe('renderBenchMarkdown', { tags: ['unit'] }, () => {
  it('Report_OnlyNoise_StatesThatPlainlyInsteadOfRenderingAnAlarmingTable', () => {
    const md = renderBenchMarkdown(compareBenchRuns([result('x', 100, 2)], [result('x', 101, 2)]));
    expect(md.toLowerCase()).toContain('no significant');
  });

  it('Report_SignificantRegression_NamesTheBenchmarkAndTheMultiple', () => {
    const md = renderBenchMarkdown(compareBenchRuns([result('hot-path', 160, 1)], [result('hot-path', 100, 1)]));
    expect(md).toContain('hot-path');
    expect(md).toContain('1.60');
  });

  it('Report_UnreliableRun_CarriesTheWarningIntoTheOutput', () => {
    const md = renderBenchMarkdown(compareBenchRuns([result('x', 160, 40)], [result('x', 100, 1)]));
    expect(md.toLowerCase()).toContain('unreliable');
  });
});
