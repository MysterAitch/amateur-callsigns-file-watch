#!/usr/bin/env node

/**
 * Dataset-level anomaly flags (issue #467).
 *
 * Extends the neighbour-window machinery report-sweep.ts already builds for
 * the per-entry data-quality reports (windowFor/isDeclaredIncomplete/readStats)
 * with a statistical DEVIATION FLAG: does this dataset's record count,
 * status-value distribution, or product-column emptiness sit outside the norm
 * its own neighbour window (the ~10 datasets before and after it) sets?
 *
 * BINDING DESIGN PRINCIPLE (issue #467; see also ADR 0014's no-inflation
 * stance): deviation is a strong signal to FLAG; conformance is NEVER a trust
 * certificate — a corrupted or filtered dataset can still sit inside a trend,
 * so "no flag" here means only "no flag", not "verified good". This module
 * therefore only ever emits FLAGS with their full working (which datasets,
 * what magnitude, candidate innocent explanations left on the table) and never
 * a trust verdict; any trust judgement stays a human curation act (the
 * curation-status axis, issue #155).
 *
 * PUBLISHED, IN PART: every deviation this module flags for a dataset — record
 * count (this module's own calibration case, independently corroborated
 * against docs/source-register.md — see below), per-status share, and
 * product-column emptiness — is surfaced on the /data-status page as a
 * plain-English observation (build-data-status.ts's "Statistical
 * observations" section, via renderPublishedObservation below), linked to a
 * method note on fidelity.html explaining the median/MAD neighbour-window
 * approach. The per-status signal needs the DuckDB-backed fold
 * (foldStatusShares below) and so only fires in a build that has it; the
 * record-count and product-emptiness signals read stats.json directly and run
 * unconditionally. What stays local-only is the developer-facing detail —
 * EVERY dataset's evaluation (flagged or not), the full neighbour window named,
 * and the CLI rendering (renderFlag/renderDatasetAnomalyFlags): run `npm run
 * anomaly-flags` (or `node src/ci/dataset-anomaly-flags.ts` directly) to print
 * it to stdout. Nothing here writes to reports/, and this module is not part of the
 * golden-master drift gate (data-status.html itself is never committed —
 * generated fresh each deploy, so nothing here needs byte-for-byte pinning).
 *
 * Method: a robust (median / median-absolute-deviation) z-score per metric,
 * computed only from neighbours NOT declared as a partial/incomplete
 * publication (a declared-partial neighbour's small counts are already
 * self-explained — see build-interdataset-stats.ts's identical convention —
 * so folding them into the norm would corrupt it rather than describe it).
 * The modified z-score and its conventional |z| > 3.5 outlier threshold follow
 * Iglewicz & Hoaglin, "How to Detect and Handle Outliers" (1993) — a named,
 * citable convention rather than an invented constant.
 *
 * Calibration case: the 2025-11-11 -> 2026-01-14 open-data pair, a real,
 * externally-documented net change (docs/source-register.md) of -9,561
 * Allocated / -3,950 Reserved over about nine weeks. This module's own test
 * suite checks that pair is flagged, with the correct metric and magnitude —
 * the record-count signal fires cleanly for it. The per-status SHARE signal
 * does not independently fire for this particular pair against the current
 * (very small, ~9-dataset) held corpus: one neighbour in the same window
 * (2025-06-04) is itself a severe outlier (a filtered export, flagged
 * separately below), and with only 3-4 declared-complete neighbours on a
 * side its single presence inflates the share metric's MAD enough to blunt
 * the smaller-but-real Allocated/Reserved shift. A future iteration could
 * exclude neighbours already flagged on OTHER metrics before computing a
 * given metric's norm (iterative robust exclusion); left as a documented
 * limitation rather than built now, since the record-count signal already
 * catches this fixture and the corpus is too small to validate an iterative
 * scheme confidently.
 */

import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { foldQuery, duckDbAvailable } from '../v2/report-fold.ts';
import type { EntryStats } from '../shared/stats.ts';
import { readStats, windowFor, isDeclaredIncomplete } from './report-sweep.ts';

// --- Robust statistics -------------------------------------------------

export interface RobustNorm { median: number; mad: number }

function medianOf(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Median and median-absolute-deviation of a neighbour sample. Robust to a
// single wild value in a small sample in a way a mean/stdev pair is not —
// exactly the property needed when the neighbour window itself can contain an
// as-yet-unflagged anomalous publication (the motivating case on issue #467:
// a declared-complete filtered export sitting among otherwise-normal
// neighbours).
export function robustNorm(values: readonly number[]): RobustNorm {
  const sorted = [...values].sort((a, b) => a - b);
  const median = medianOf(sorted);
  const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: medianOf(deviations) };
}

// Iglewicz & Hoaglin's consistency constant, scaling MAD to be comparable
// with a normal distribution's standard deviation.
const MAD_CONSISTENCY_CONSTANT = 0.6745;

// The conventional modified-z-score outlier threshold (Iglewicz & Hoaglin
// 1993). A tuning parameter, deliberately named and exported rather than
// buried, per the issue's own "threshold and window are parameters to tune"
// note.
export const MODIFIED_Z_THRESHOLD = 3.5;

// A neighbourhood with zero spread (every neighbour identical) has no
// meaningful ratio; ±Infinity reads correctly against the threshold check
// (any non-tied value deviates) without a spurious NaN from a 0/0 division.
export function modifiedZ(value: number, norm: RobustNorm): number {
  if (norm.mad === 0) return value === norm.median ? 0 : value > norm.median ? Infinity : -Infinity;
  return (MAD_CONSISTENCY_CONSTANT * (value - norm.median)) / norm.mad;
}

// Below this many neighbour values, no norm is computed at all — "too few
// neighbours to judge" is reported as such, never silently treated as
// "conforms" (which would be a false clean bill of health for, e.g., the very
// first or last dataset ever held).
export const MIN_NEIGHBOURS_FOR_NORM = 2;

export type MetricUnit = 'count' | 'share';

export interface MetricDeviation {
  metric: string;
  unit: MetricUnit;
  value: number;
  neighbourMedian: number;
  neighbourMad: number;
  neighbourCount: number;
  z: number;
  direction: 'above' | 'below';
}

// A practical-significance floor for share metrics: when every neighbour
// shares a near-zero (or near-identical) value, MAD collapses towards zero
// and the modified z-score explodes for an absolute difference of a handful
// of rows in 150,000 — arithmetically an "outlier" but not the "marked
// change" the issue asks this detector to surface. Requiring the raw
// percentage-point gap to clear this floor before the z-score is even
// computed keeps the flag reserved for changes a reader would call marked.
export const MIN_SHARE_DELTA = 0.005;

// The threshold comparison as its own named function (rather than inlined),
// so the boundary itself — inclusive at exactly MODIFIED_Z_THRESHOLD, which
// reads as "conforms" — is directly testable against hand-picked z-values,
// without floating-point noise from reconstructing a boundary value through
// robustNorm/modifiedZ's arithmetic.
export function exceedsThreshold(z: number): boolean {
  return Math.abs(z) > MODIFIED_Z_THRESHOLD;
}

// One metric's deviation check: undefined means "not flagged" (either it
// conforms, or there weren't enough neighbours to judge — insufficientNeighbours
// on the caller's DatasetAnomalyFlag is what distinguishes those two cases).
// minAbsoluteDelta is the practical-significance floor above; zero (the
// default) leaves count metrics governed by the z-score alone.
export function detectDeviation(metric: string, unit: MetricUnit, value: number, neighbourValues: readonly number[], minAbsoluteDelta = 0): MetricDeviation | undefined {
  if (neighbourValues.length < MIN_NEIGHBOURS_FOR_NORM) return undefined;
  const norm = robustNorm(neighbourValues);
  if (Math.abs(value - norm.median) < minAbsoluteDelta) return undefined;
  const z = modifiedZ(value, norm);
  if (!exceedsThreshold(z)) return undefined;
  return { metric, unit, value, neighbourMedian: norm.median, neighbourMad: norm.mad, neighbourCount: neighbourValues.length, z, direction: z > 0 ? 'above' : 'below' };
}

// --- Dataset-level evaluation -------------------------------------------

export interface DatasetWindow {
  key: string;
  // Neighbour keys actually used to compute the norm: the window minus any
  // declared-partial/incomplete publication, which is excluded from the norm
  // (not from the report) so its already-self-explained small counts cannot
  // corrupt the baseline other datasets are judged against.
  before: string[];
  after: string[];
  // Declared-partial neighbours the raw window held but excluded from the
  // norm, kept so the presentation can say so rather than silently narrow.
  excludedPartial: string[];
}

export interface DatasetAnomalyFlag {
  key: string;
  window: DatasetWindow;
  deviations: MetricDeviation[];
  insufficientNeighbours: boolean;
}

export interface DatasetMetricSet {
  recordCount: number;
  // Share (0..1) of records at each status value, e.g. statusShare.Allocated.
  statusShare: Record<string, number>;
  // undefined when the source carried no product column at all (a different
  // fact from "a product column with zero blanks" — see
  // build-interdataset-stats.ts's identical hasProductColumn distinction).
  productEmptyShare: number | undefined;
}

// Evaluate one dataset against a neighbour-metrics map. Pure function of
// already-computed metrics, so it is fully unit-testable with synthetic data —
// the real-archive wiring below is a thin caller.
export function evaluateDataset(key: string, window: DatasetWindow, metrics: DatasetMetricSet, neighbourMetrics: ReadonlyMap<string, DatasetMetricSet>): DatasetAnomalyFlag {
  const neighbourKeys = [...window.before, ...window.after];
  const neighbourList: DatasetMetricSet[] = [];
  for (const k of neighbourKeys) {
    const m = neighbourMetrics.get(k);
    if (m !== undefined) neighbourList.push(m);
  }

  const deviations: MetricDeviation[] = [];

  const recordCountDev = detectDeviation('record count', 'count', metrics.recordCount, neighbourList.map(m => m.recordCount));
  if (recordCountDev !== undefined) deviations.push(recordCountDev);

  const statuses = new Set<string>();
  for (const status of Object.keys(metrics.statusShare)) statuses.add(status);
  for (const neighbour of neighbourList) for (const status of Object.keys(neighbour.statusShare)) statuses.add(status);
  for (const status of [...statuses].sort()) {
    const value = metrics.statusShare[status] ?? 0;
    const neighbourValues = neighbourList.map(m => m.statusShare[status] ?? 0);
    const dev = detectDeviation(`${status} share`, 'share', value, neighbourValues, MIN_SHARE_DELTA);
    if (dev !== undefined) deviations.push(dev);
  }

  if (metrics.productEmptyShare !== undefined) {
    const neighbourValues: number[] = [];
    for (const m of neighbourList) if (m.productEmptyShare !== undefined) neighbourValues.push(m.productEmptyShare);
    const dev = detectDeviation('product-column emptiness', 'share', metrics.productEmptyShare, neighbourValues, MIN_SHARE_DELTA);
    if (dev !== undefined) deviations.push(dev);
  }

  return { key, window, deviations, insufficientNeighbours: neighbourList.length < MIN_NEIGHBOURS_FOR_NORM };
}

// --- Rendering: plain-English caution, no verdict ------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function formatValue(d: MetricDeviation, value: number): string {
  return d.unit === 'share' ? `${(value * 100).toFixed(1)}%` : num(Math.round(value));
}

function describeDeviation(d: MetricDeviation): string {
  const comparative = d.direction === 'above' ? 'higher' : 'lower';
  return `${d.metric} is ${comparative} than its neighbours' norm: ${formatValue(d, d.value)} vs a neighbour median of ${formatValue(d, d.neighbourMedian)} `
    + `(spread ±${formatValue(d, d.neighbourMad)} MAD over ${d.neighbourCount} neighbours, modified z=${d.z === Infinity || d.z === -Infinity ? d.z.toString() : d.z.toFixed(1)})`;
}

// One line per flagged (or explicitly unjudged) dataset, in the issue's own
// presentation template. Always non-adjudicating: a flag names candidate
// innocent explanations rather than asserting a defect, and "conforms" is
// explicitly captioned as not a trust certificate.
export function renderFlag(flag: DatasetAnomalyFlag): string {
  const beforeN = flag.window.before.length;
  const afterN = flag.window.after.length;
  const excludedNote = flag.window.excludedPartial.length > 0
    ? ` (${flag.window.excludedPartial.length} declared-partial neighbour(s) in the window excluded from the norm: ${flag.window.excludedPartial.join(', ')})`
    : '';
  if (flag.insufficientNeighbours) {
    return `${flag.key}: too few neighbours to judge (${beforeN} before, ${afterN} after held)${excludedNote} — no flag, and this is not a clean bill of health either.`;
  }
  if (flag.deviations.length === 0) {
    return `${flag.key}: conforms to the norm of the ${beforeN} before and ${afterN} after it${excludedNote}. Conformance is not a trust certificate — a corrupted or filtered dataset can still sit inside a trend.`;
  }
  const details = flag.deviations.map(describeDeviation).join('; ');
  return `Caution: ${flag.key} doesn't conform to the norms of the ${beforeN} before and ${afterN} after it${excludedNote} — ${details}. `
    + 'Declared, not adjudicated: candidate innocent explanations (a genuine filter change, a partial republish, a real population swing) remain on the table; '
    + 'this flags the discrepancy for a human to examine and draws no trust verdict.';
}

// The reader-facing rendering for the PUBLISHED affordance (issue #467's
// residual: promote the detector's output to something a reader, not just a
// developer, sees). Reuses the SAME evaluated deviations as renderFlag above —
// no maths is reimplemented, only the framing changes — because a published
// reader is owed the same caution a developer already gets: this states a
// statistical deviation from neighbouring publications, NEVER a verdict,
// judgement, or claim that anything is wrong. A dataset with no deviations (or
// too few neighbours to judge) renders NOTHING here — selective disclosure,
// the same convention render/fidelity.ts's flagNudges uses, so the affordance
// never manufactures doubt where no observation exists. Whether and how the
// page states "conformance is not a certificate" for the corpus as a whole is
// the caller's decision (build-data-status.ts), since that framing applies
// once per page, not once per dataset.
export function renderPublishedObservation(flag: DatasetAnomalyFlag): string[] {
  return flag.deviations.map((d) => {
    const zText = d.z === Infinity || d.z === -Infinity ? d.z.toString() : d.z.toFixed(1);
    return `This publication's ${d.metric} deviates from its neighbours' norm (modified z = ${zText}): `
      + `${formatValue(d, d.value)} against a neighbour median of ${formatValue(d, d.neighbourMedian)} `
      + `across ${d.neighbourCount} neighbouring publications. `
      + 'This is an observation, not a judgement — the cause is not adjudicated here; a genuine population swing, '
      + 'a filter change, or a partial republish could equally explain a deviation like this one.';
  });
}

export function renderDatasetAnomalyFlags(flags: readonly DatasetAnomalyFlag[]): string {
  const lines = [
    '# Dataset anomaly flags (issue #467) — EXPERIMENTAL, LOCAL-ONLY, not published',
    '',
    'Deviation from the neighbour window is a signal to flag, never a trust verdict; conformance is not a certificate either. See src/ci/dataset-anomaly-flags.ts.',
    '',
    ...flags.map(f => `- ${renderFlag(f)}`),
  ];
  return lines.join('\n');
}

// Which metrics THIS build's evaluation actually checked — the single source
// of truth the published copy (build-data-status.ts) reads before claiming a
// check ran, so degraded and full builds each state only what they did.
// record count and product-column emptiness read stats.json directly and
// always run; per-status share needs the DuckDB-backed fold (foldStatusShares
// below) and is honestly reported as unchecked when the CLI is unavailable —
// the same gate foldStatusShares itself uses, so this can never drift out of
// step with what computeDatasetAnomalyFlags() actually evaluated.
export interface AnomalyMetricsChecked {
  recordCount: true;
  statusShare: boolean;
  productEmptyShare: true;
}
export function anomalyMetricsChecked(): AnomalyMetricsChecked {
  return { recordCount: true, statusShare: duckDbAvailable(), productEmptyShare: true };
}

// --- Real-archive wiring --------------------------------------------------

interface StatusFoldRow { idx: number; status: string | null; n: number }

// One fold across every readable normalised.csv, grouped by (file, status) —
// far cheaper than one DuckDB invocation per dataset. A dataset missing its
// derived normalised.csv (raw-only) contributes no status shares; its
// recordCount / productEmptyShare (from stats.json, if present) still stand.
//
// Requires the DuckDB CLI (see report-fold.ts); absent it, this returns no
// shares at all rather than failing the whole computation — the record-count
// and product-emptiness signals below read stats.json directly and need no
// engine, so they still stand on their own. This is what lets the build-time
// wiring (build-data-status.ts) degrade to "fewer signals checked" instead of
// "the page fails to build" wherever the CLI happens not to be installed.
function foldStatusShares(keys: readonly string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!duckDbAvailable()) return out;
  const files = keys
    .map(key => ({ key, file: derivedEntryFileExists(key, 'normalised.csv') ? derivedEntryFile(key, 'normalised.csv') : undefined }))
    .filter((e): e is { key: string; file: string } => e.file !== undefined);
  if (files.length === 0) return out;

  const branches = files
    .map((e, index) => `SELECT ${index} AS idx, status FROM read_csv('${e.file.replace(/\\/g, '/')}', header=true, all_varchar=true)`)
    .join('\nUNION ALL\n');
  const sql = `SELECT idx, status, count(*) AS n FROM (${branches}) GROUP BY idx, status ORDER BY idx, status`;
  const rows = foldQuery<StatusFoldRow>(sql);

  const countsByIdx = new Map<number, Record<string, number>>();
  const totalByIdx = new Map<number, number>();
  for (const row of rows) {
    const label = row.status === null || row.status === '' ? '(blank)' : row.status;
    const counts = countsByIdx.get(row.idx) ?? {};
    counts[label] = row.n;
    countsByIdx.set(row.idx, counts);
    totalByIdx.set(row.idx, (totalByIdx.get(row.idx) ?? 0) + row.n);
  }
  files.forEach((e, index) => {
    const counts = countsByIdx.get(index) ?? {};
    const total = totalByIdx.get(index) ?? 0;
    const shares: Record<string, number> = {};
    if (total > 0) for (const [status, n] of Object.entries(counts)) shares[status] = n / total;
    out.set(e.key, shares);
  });
  return out;
}

function metricSetFrom(stats: EntryStats, statusShare: Record<string, number>): DatasetMetricSet {
  const product = stats.columns.product;
  const productEmptyShare = product !== undefined && stats.recordCount > 0 ? product.empty / stats.recordCount : undefined;
  return { recordCount: stats.recordCount, statusShare, productEmptyShare };
}

// Build every dataset's metric set once, then evaluate each against its own
// neighbour window. Excludes declared-partial neighbours from the norm (see
// module doc-comment) and skips flagging a dataset that is itself declared
// partial — its small counts are already self-explained by that declaration,
// so re-flagging them would restate a known fact as a fresh caution.
export function computeDatasetAnomalyFlags(): DatasetAnomalyFlag[] {
  const keys = listArchiveKeys().sort();
  const statsByKey = new Map<string, EntryStats>();
  for (const key of keys) {
    const stats = readStats(key);
    if (stats !== undefined) statsByKey.set(key, stats);
  }
  const shareByKey = foldStatusShares(keys);

  const metricsByKey = new Map<string, DatasetMetricSet>();
  for (const [key, stats] of statsByKey) {
    metricsByKey.set(key, metricSetFrom(stats, shareByKey.get(key) ?? {}));
  }

  const flags: DatasetAnomalyFlag[] = [];
  for (const key of keys) {
    if (isDeclaredIncomplete(key)) continue;
    const metrics = metricsByKey.get(key);
    if (metrics === undefined) continue;

    const rawWindow = windowFor(key, keys).filter(k => k !== key);
    const before = rawWindow.filter(k => k < key);
    const after = rawWindow.filter(k => k > key);
    const excludedPartial = rawWindow.filter(k => isDeclaredIncomplete(k));
    const window: DatasetWindow = {
      key,
      before: before.filter(k => !isDeclaredIncomplete(k)),
      after: after.filter(k => !isDeclaredIncomplete(k)),
      excludedPartial,
    };
    flags.push(evaluateDataset(key, window, metrics, metricsByKey));
  }
  return flags;
}

if (import.meta.main) {
  const flags = computeDatasetAnomalyFlags();
  console.log(renderDatasetAnomalyFlags(flags));
  console.log('');
  console.log(`Local, experimental investigation aid (issue #467) — ${path.basename(import.meta.url)} is not wired into report-sweep or the site.`);
}
