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
interface FileResult { name: string; status: string; assertionResults: AssertionResult[]; startTime?: number; endTime?: number }
interface MergedResults {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: FileResult[];
}

interface CoverageMetric { pct: number; total?: number; covered?: number }
interface CoverageMetricSet { lines: CoverageMetric; statements: CoverageMetric; functions: CoverageMetric; branches: CoverageMetric }
// istanbul json-summary: `total` plus one entry per covered file (absolute path).
interface CoverageSummary {
  total: CoverageMetricSet;
  [file: string]: CoverageMetricSet;
}

// The cross-run comparison record: one run's headline figures plus a per-test
// status map, uploaded as a small artefact so later runs can diff against the
// latest main run's copy. The status map is what enables the interesting
// comparisons — tests added/removed by NAME (a net +5 can hide 10 added and 5
// removed) and status transitions (newly failing, newly fixed). A rename
// necessarily appears as one removal plus one addition; the summary says so.
export interface Baseline {
  sha: string;
  tests: { total: number; passed: number; failed: number; skipped: number };
  coverage?: { lines: number; statements: number; functions: number; branches: number };
  // `file::fullName` -> final status ('passed' | 'failed' | 'skipped' | …).
  cases?: Record<string, string>;
  // Fields below are COLLECTED now, RENDERED later: the artefact series must
  // hold the history before duration/slowest/movers/trend features can show
  // it, so recording deliberately precedes any consumer.
  // When and where this baseline was recorded (trend axis + API cross-ref).
  recordedAt?: string;
  runId?: string;
  // Wall-clock test time: the whole merged run and each file's share
  // (duration-delta and slowest-files features).
  durations?: { totalMs: number; byFile: Record<string, number> };
  // Per-directory coverage as [covered, total] pairs per metric — pairs, not
  // percentages, so directories aggregate exactly (per-directory movers).
  coverageByDir?: Record<string, { lines: [number, number]; statements: [number, number]; functions: [number, number]; branches: [number, number] }>;
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

// Flatten the per-file assertion results into the `file::fullName` -> status
// map used for set differences and status transitions.
function caseStatuses(results: MergedResults): Record<string, string> {
  const cases: Record<string, string> = {};
  for (const f of results.testResults) {
    for (const a of f.assertionResults) {
      cases[`${f.name}::${a.fullName}`] = a.status;
    }
  }
  return cases;
}

// Per-file wall-clock durations from the merged results, rounded to whole ms.
// Files without timing fields (older reports) are simply absent.
function fileDurations(results: MergedResults): { totalMs: number; byFile: Record<string, number> } {
  const byFile: Record<string, number> = {};
  let totalMs = 0;
  for (const f of results.testResults) {
    if (f.startTime === undefined || f.endTime === undefined) continue;
    const ms = Math.round(f.endTime - f.startTime);
    byFile[f.name] = ms;
    totalMs += ms;
  }
  return { totalMs, byFile };
}

// Roll the json-summary's per-file entries up to their first two path
// segments (e.g. `src/ci`, `site`), stripping the absolute-root prefix.
// [covered, total] pairs aggregate exactly; percentages would not.
function coverageByDirectory(coverage: CoverageSummary, root: string): Baseline['coverageByDir'] {
  const rollup: NonNullable<Baseline['coverageByDir']> = {};
  const normalisedRoot = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  for (const [file, metrics] of Object.entries(coverage)) {
    if (file === 'total') continue;
    const rel = file.replace(/\\/g, '/').replace(normalisedRoot, '');
    const dirSegments = rel.split('/').slice(0, -1);
    const dir = dirSegments.length === 0 ? '.' : dirSegments.slice(0, 2).join('/');
    const cell = (rollup[dir] ??= { lines: [0, 0], statements: [0, 0], functions: [0, 0], branches: [0, 0] });
    for (const metric of ['lines', 'statements', 'functions', 'branches'] as const) {
      cell[metric][0] += metrics[metric].covered ?? 0;
      cell[metric][1] += metrics[metric].total ?? 0;
    }
  }
  return Object.keys(rollup).length === 0 ? undefined : rollup;
}

export interface BaselineContext { recordedAt?: string; runId?: string; root?: string }

export function currentBaseline(results: MergedResults | undefined, coverage: CoverageSummary | undefined, sha: string, context: BaselineContext = {}): Baseline | undefined {
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
    cases: caseStatuses(results),
    recordedAt: context.recordedAt,
    runId: context.runId,
    durations: fileDurations(results),
    coverageByDir: coverage === undefined ? undefined : coverageByDirectory(coverage, context.root ?? process.cwd()),
  };
}

// A capped bullet list of test-case keys, rendered `fullName` first with the
// file in brackets — the name identifies the scenario, the file locates it.
function caseList(keys: readonly string[], cap: number): string[] {
  const lines = keys.slice(0, cap).map((k) => {
    const sep = k.indexOf('::');
    const file = sep >= 0 ? k.slice(0, sep) : '';
    const test = sep >= 0 ? k.slice(sep + 2) : k;
    return `- \`${test}\`${file === '' ? '' : ` (${file})`}`;
  });
  if (keys.length > cap) lines.push(`- … and ${keys.length - cap} more`);
  return lines;
}

// The set-difference and status-transition sections, only renderable when the
// baseline carries per-test records. A skipped→passed (or passed→skipped)
// change is reported under transitions too: silently un-skipped or newly
// skipped tests are exactly the kind of drift worth a glance.
function caseComparison(current: Record<string, string>, baseline: Record<string, string>): string[] {
  const lines: string[] = [];
  const added = Object.keys(current).filter((k) => !(k in baseline)).sort();
  const removed = Object.keys(baseline).filter((k) => !(k in current)).sort();
  const common = Object.keys(current).filter((k) => k in baseline);
  const newlyFailing = common.filter((k) => current[k] === 'failed' && baseline[k] !== 'failed').sort();
  const newlyFixed = common.filter((k) => current[k] === 'passed' && baseline[k] === 'failed').sort();
  const newlySkipped = common.filter((k) => (current[k] === 'skipped' || current[k] === 'pending' || current[k] === 'todo') && baseline[k] === 'passed').sort();
  const unskipped = common.filter((k) => current[k] === 'passed' && (baseline[k] === 'skipped' || baseline[k] === 'pending' || baseline[k] === 'todo')).sort();

  if (added.length + removed.length > 0) {
    lines.push('', `### Tests added (${added.length}) / removed (${removed.length})`);
    if (added.length > 0 && removed.length > 0) {
      lines.push('_A renamed test appears as one removal plus one addition._');
    }
    if (added.length > 0) { lines.push('', '**Added:**', ...caseList(added, 15)); }
    if (removed.length > 0) { lines.push('', '**Removed:**', ...caseList(removed, 15)); }
  }
  if (newlyFailing.length > 0) {
    lines.push('', `### Newly failing vs baseline (${newlyFailing.length})`, ...caseList(newlyFailing, 20));
  }
  if (newlyFixed.length > 0) {
    lines.push('', `### Fixed vs baseline (${newlyFixed.length})`, ...caseList(newlyFixed, 20));
  }
  if (newlySkipped.length > 0) {
    lines.push('', `### Newly skipped (${newlySkipped.length})`, ...caseList(newlySkipped, 10));
  }
  if (unskipped.length > 0) {
    lines.push('', `### No longer skipped (${unskipped.length})`, ...caseList(unskipped, 10));
  }
  return lines;
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
      if (baseline.cases !== undefined) {
        lines.push(...caseComparison(caseStatuses(results), baseline.cases));
      } else {
        lines.push('', '_The baseline predates per-test records; name-level differences are unavailable for this comparison._');
      }
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
    const record = currentBaseline(results, coverage, process.env.GITHUB_SHA ?? 'unknown', {
      recordedAt: new Date().toISOString(),
      runId: process.env.GITHUB_RUN_ID,
    });
    if (record === undefined) throw new Error('cannot write a baseline: merged results are unavailable');
    fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
  } else {
    const baseline = readJson<Baseline>('.ci-baseline/baseline.json');
    process.stdout.write(renderSummary(results, coverage, baseline));
  }
}
