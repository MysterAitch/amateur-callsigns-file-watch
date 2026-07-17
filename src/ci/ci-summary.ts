/**
 * Render the merged CI test + coverage outcome as GitHub-flavoured markdown
 * for the Actions run summary ($GITHUB_STEP_SUMMARY).
 *
 * Inputs (both produced by the `coverage` job's merge step):
 *  - .vitest-reports/merged-results.json — vitest's json reporter over the
 *    merged blob reports (test totals, per-file results, failure names)
 *  - coverage/coverage-summary.json — istanbul json-summary totals
 *
 * This is meta-reporting about the run, not a data-integrity gate: a missing
 * or unreadable input degrades to an explicit "unavailable" line rather than
 * failing the job, so a summary-rendering problem can never mask or replace
 * the real test verdict (the `tests` aggregator gates on the jobs themselves).
 */

import * as fs from 'fs';

interface AssertionResult { fullName: string; status: string }
interface FileResult { name: string; status: string; assertionResults: AssertionResult[] }
interface MergedResults {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: FileResult[];
}

interface CoverageMetric { pct: number }
interface CoverageSummary {
  total: { lines: CoverageMetric; statements: CoverageMetric; functions: CoverageMetric; branches: CoverageMetric };
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

// The maximum failed-test names listed before eliding — enough to identify a
// broken area at a glance without flooding the summary on a mass failure.
const MAX_FAILURES_LISTED = 20;

export function renderSummary(results: MergedResults | undefined, coverage: CoverageSummary | undefined): string {
  const lines: string[] = ['## Test results', ''];

  if (results === undefined) {
    lines.push('Merged test results unavailable (no readable `merged-results.json`).');
  } else {
    const skipped = results.numPendingTests + results.numTodoTests;
    lines.push('| total | passed | failed | skipped |');
    lines.push('|---:|---:|---:|---:|');
    lines.push(`| ${results.numTotalTests} | ${results.numPassedTests} | ${results.numFailedTests} | ${skipped} |`);
    const failures = results.testResults
      .flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => ({ file: f.name, test: a.fullName })));
    if (failures.length > 0) {
      lines.push('', '### Failed');
      for (const f of failures.slice(0, MAX_FAILURES_LISTED)) {
        lines.push(`- \`${f.test}\` (${f.file})`);
      }
      if (failures.length > MAX_FAILURES_LISTED) {
        lines.push(`- … and ${failures.length - MAX_FAILURES_LISTED} more`);
      }
    }
  }

  lines.push('', '## Coverage (merged)', '');
  if (coverage === undefined) {
    lines.push('Coverage summary unavailable (no readable `coverage-summary.json`).');
  } else {
    const t = coverage.total;
    lines.push('| lines | statements | functions | branches |');
    lines.push('|---:|---:|---:|---:|');
    lines.push(`| ${t.lines.pct}% | ${t.statements.pct}% | ${t.functions.pct}% | ${t.branches.pct}% |`);
  }
  lines.push('');
  return lines.join('\n');
}

// Entry point: print to stdout; the workflow step appends it to the summary.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  const results = readJson<MergedResults>('.vitest-reports/merged-results.json');
  const coverage = readJson<CoverageSummary>('coverage/coverage-summary.json');
  process.stdout.write(renderSummary(results, coverage));
}
