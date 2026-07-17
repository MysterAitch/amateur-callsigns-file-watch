import { describe, it, expect } from 'vitest';
import { renderSummary, currentBaseline } from './ci-summary.ts';

const results = {
  numTotalTests: 100,
  numPassedTests: 97,
  numFailedTests: 2,
  numPendingTests: 1,
  numTodoTests: 0,
  testResults: [
    {
      name: 'src/shared/perf.test.ts',
      status: 'failed',
      assertionResults: [
        { fullName: 'PerfReport_WhenDestinationUnwritable_ThrowsAfterStderrBreakdown', status: 'failed' },
        { fullName: 'PerfReport_WhenFlagOff_WritesNothing', status: 'passed' },
      ],
    },
    {
      name: 'src/ci/value-catalogue.test.ts',
      status: 'failed',
      assertionResults: [{ fullName: 'ValueCatalogue_RealArchive_Renders', status: 'failed' }],
    },
  ],
};

const coverage = {
  total: {
    lines: { pct: 31.2 },
    statements: { pct: 31.4 },
    functions: { pct: 25.9 },
    branches: { pct: 27.8 },
  },
};

describe('the CI run summary renderer', { tags: ['unit'] }, () => {
  it('Summary_WithResultsAndCoverage_RendersTotalsAndNamesEveryFailure', () => {
    const md = renderSummary(results, coverage);
    expect(md).toContain('| 100 | 97 | 2 | 1 |');
    expect(md).toContain('PerfReport_WhenDestinationUnwritable_ThrowsAfterStderrBreakdown');
    expect(md).toContain('ValueCatalogue_RealArchive_Renders');
    expect(md).toContain('| 31.2% | 31.4% | 25.9% | 27.8% |');
  });

  it('Summary_WithManyFailures_ListsTwentyThenElides', () => {
    const many = {
      ...results,
      testResults: [
        {
          name: 'src/big.test.ts',
          status: 'failed',
          assertionResults: Array.from({ length: 25 }, (_, i) => ({ fullName: `Case_${i}_Fails`, status: 'failed' })),
        },
      ],
    };
    const md = renderSummary(many, coverage);
    expect(md).toContain('Case_19_Fails');
    expect(md).not.toContain('Case_20_Fails');
    expect(md).toContain('… and 5 more');
  });

  it('Summary_WithMissingInputs_DegradesToExplicitUnavailableLines', () => {
    const md = renderSummary(undefined, undefined);
    expect(md).toContain('Merged test results unavailable');
    expect(md).toContain('Coverage summary unavailable');
  });

  it('Summary_WithAllPassing_OmitsTheFailedSection', () => {
    const passing = { ...results, numFailedTests: 0, testResults: [] };
    const md = renderSummary(passing, coverage);
    expect(md).not.toContain('### Failed');
  });

  it('Summary_WithBaseline_ShowsSignedDeltasForEveryFigure', () => {
    const baseline = {
      sha: 'abcdef0123456789',
      tests: { total: 95, passed: 95, failed: 0, skipped: 0 },
      coverage: { lines: 30.6, statements: 31.4, functions: 26.2, branches: 27.8 },
    };
    const md = renderSummary(results, coverage, baseline);
    expect(md).toContain('vs `abcdef01`');
    expect(md).toContain('| +5 | +2 | +2 | +1 |');
    expect(md).toContain('▲ +0.6pp');
    expect(md).toContain('— ±0pp');
    expect(md).toContain('▼ −0.3pp');
  });

  it('Summary_WithBaselineAndUnchangedCounts_ShowsExplicitZeroDeltas', () => {
    const baseline = {
      sha: 'abcdef0123456789',
      tests: { total: 100, passed: 97, failed: 2, skipped: 1 },
    };
    const md = renderSummary(results, coverage, baseline);
    expect(md).toContain('| ±0 | ±0 | ±0 | ±0 |');
  });

  it('Summary_WithoutBaseline_SaysSoRatherThanOmittingSilently', () => {
    const md = renderSummary(results, coverage);
    expect(md).toContain('No baseline available for comparison');
  });

  it('CurrentBaseline_FromRunOutputs_RecordsShaCountsAndCoverage', () => {
    const b = currentBaseline(results, coverage, 'deadbeefcafe');
    expect(b).toEqual({
      sha: 'deadbeefcafe',
      tests: { total: 100, passed: 97, failed: 2, skipped: 1 },
      coverage: { lines: 31.2, statements: 31.4, functions: 25.9, branches: 27.8 },
    });
  });

  it('CurrentBaseline_WithoutMergedResults_YieldsNothingToUpload', () => {
    expect(currentBaseline(undefined, coverage, 'deadbeef')).toBeUndefined();
  });
});
