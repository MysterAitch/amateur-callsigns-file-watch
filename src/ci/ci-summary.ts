/**
 * Render the merged CI test + coverage outcome as GitHub-flavoured markdown
 * for the Actions run summary ($GITHUB_STEP_SUMMARY).
 *
 * Inputs (produced by the `coverage` job's merge step):
 *  - .vitest-reports/merged-results.json — vitest's json reporter over the
 *    merged blob reports (test totals, per-file results, failure names)
 *  - coverage/coverage-summary.json — istanbul json-summary totals
 *  - .ci-baseline/baseline.json (optional) — the previous main run's totals,
 *    downloaded by the workflow; when present the summary shows signed DELTAS
 *    beside every figure, because the change is more informative than the raw
 *    number. Each run also writes its own baseline for upload (`--write-baseline`).
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

// The cross-run comparison record: one run's headline figures, uploaded as a
// tiny artefact so later runs can diff against the latest main run's copy.
export interface Baseline {
  sha: string;
  tests: { total: number; passed: number; failed: number; skipped: number };
  coverage?: { lines: number; statements: number; functions: number; branches: number };
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

// A signed count delta: "+3", "−2", or "±0" — always shown so an unchanged
// figure reads as deliberately unchanged rather than unreported.
function countDelta(current: number, previous: number): string {
  const d = current - previous;
  if (d > 0) return `+${d}`;
  if (d < 0) return `−${-d}`;
  return '±0';
}

// A signed percentage-point delta with a direction marker, e.g. "▲ +0.6pp".
function pctDelta(current: number, previous: number): string {
  const d = Math.round((current - previous) * 100) / 100;
  if (d > 0) return `▲ +${d}pp`;
  if (d < 0) return `▼ −${-d}pp`;
  return '— ±0pp';
}

export function currentBaseline(results: MergedResults | undefined, coverage: CoverageSummary | undefined, sha: string): Baseline | undefined {
  if (results === undefined) return undefined;
  return {
    sha,
    tests: {
      total: results.numTotalTests,
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      skipped: results.numPendingTests + results.numTodoTests,
    },
    coverage: coverage === undefined ? undefined : {
      lines: coverage.total.lines.pct,
      statements: coverage.total.statements.pct,
      functions: coverage.total.functions.pct,
      branches: coverage.total.branches.pct,
    },
  };
}

export function renderSummary(results: MergedResults | undefined, coverage: CoverageSummary | undefined, baseline?: Baseline): string {
  const lines: string[] = ['## Test results', ''];

  if (results === undefined) {
    lines.push('Merged test results unavailable (no readable `merged-results.json`).');
  } else {
    const skipped = results.numPendingTests + results.numTodoTests;
    if (baseline === undefined) {
      lines.push('| total | passed | failed | skipped |');
      lines.push('|---:|---:|---:|---:|');
      lines.push(`| ${results.numTotalTests} | ${results.numPassedTests} | ${results.numFailedTests} | ${skipped} |`);
      lines.push('', '_No baseline available for comparison (first run, or the baseline artefact has expired)._');
    } else {
      const b = baseline.tests;
      lines.push('| | total | passed | failed | skipped |');
      lines.push('|---|---:|---:|---:|---:|');
      lines.push(`| this run | ${results.numTotalTests} | ${results.numPassedTests} | ${results.numFailedTests} | ${skipped} |`);
      lines.push(`| vs \`${baseline.sha.slice(0, 8)}\` | ${countDelta(results.numTotalTests, b.total)} | ${countDelta(results.numPassedTests, b.passed)} | ${countDelta(results.numFailedTests, b.failed)} | ${countDelta(skipped, b.skipped)} |`);
    }
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
    const bc = baseline?.coverage;
    if (bc === undefined || baseline === undefined) {
      lines.push('| lines | statements | functions | branches |');
      lines.push('|---:|---:|---:|---:|');
      lines.push(`| ${t.lines.pct}% | ${t.statements.pct}% | ${t.functions.pct}% | ${t.branches.pct}% |`);
    } else {
      lines.push('| | lines | statements | functions | branches |');
      lines.push('|---|---:|---:|---:|---:|');
      lines.push(`| this run | ${t.lines.pct}% | ${t.statements.pct}% | ${t.functions.pct}% | ${t.branches.pct}% |`);
      lines.push(`| vs \`${baseline.sha.slice(0, 8)}\` | ${pctDelta(t.lines.pct, bc.lines)} | ${pctDelta(t.statements.pct, bc.statements)} | ${pctDelta(t.functions.pct, bc.functions)} | ${pctDelta(t.branches.pct, bc.branches)} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// Entry point. Default: print the summary markdown to stdout (the workflow
// appends it to $GITHUB_STEP_SUMMARY). `--write-baseline <file>`: write this
// run's baseline JSON instead, for upload as the comparison artefact.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  const results = readJson<MergedResults>('.vitest-reports/merged-results.json');
  const coverage = readJson<CoverageSummary>('coverage/coverage-summary.json');
  const flagIndex = process.argv.indexOf('--write-baseline');
  if (flagIndex >= 0) {
    const dest = process.argv[flagIndex + 1];
    if (dest === undefined) throw new Error('--write-baseline requires a destination path');
    const record = currentBaseline(results, coverage, process.env.GITHUB_SHA ?? 'unknown');
    if (record === undefined) throw new Error('cannot write a baseline: merged results are unavailable');
    fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  } else {
    const baseline = readJson<Baseline>('.ci-baseline/baseline.json');
    process.stdout.write(renderSummary(results, coverage, baseline));
  }
}
