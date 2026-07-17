import { describe, it, expect } from 'vitest';
import { renderSummary } from './ci-summary.ts';

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
});
