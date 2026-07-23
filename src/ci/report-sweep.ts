#!/usr/bin/env node

/**
 * Report sweep (issue #446): regenerate every committed standing report under
 * reports/ from the archive's per-entry derived views and the claim-ledger
 * folds, and emit the coverage markdown the scheduled workflow publishes (the
 * rolling dashboard issue and the review PR body).
 *
 * This is the surviving half of the retired normalise sweep. The DERIVATION
 * half - dispatching raw bytes to a source converter and committing
 * normalised.csv / components.csv / stats.json per entry - retired when the
 * ledger projection became every consumer's derived-file source (#629): the
 * committed derivatives are now a FROZEN equivalence baseline (ADR 0013; the
 * parity gate pins it entry by entry), and a new publication's derived views
 * exist only in the projection, folded from its raw bytes at build time.
 *
 * Reads are therefore mode-aware (src/shared/derived-entries.ts): the
 * scheduled workflow and the golden-master gate build the ledger projection
 * and set BUILDER_PROJECTION_DIR, so every entry - including one newer than
 * the frozen baseline - contributes to the reports; an archive-mode run reads
 * the frozen committed files (complete only while no post-freeze publication
 * exists, which is why the workflows always run projection-fed).
 *
 * Properties retained from the sweep era:
 *  - deterministic, byte-stable regeneration: unchanged inputs rewrite every
 *    report byte-identically, so "no diff => no PR" holds for scheduled runs
 *    and the golden-master drift gate stays honest;
 *  - honest coverage reporting: the returned markdown names every archive
 *    entry's derived state (derived / raw-only), and an entry with a PARTIAL
 *    or unreadable derived view is a loud failure, never a silent skip.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { type ArchiveMeta, errorMessage } from '../shared/utils.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { DIRS } from '../shared/constants.ts';
import { OFCOM_AMATEUR_SOURCE_KEY } from '../sources/ofcom-amateur/constants.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { BUILDER_PROJECTION_DIR_ENV, DERIVED_ENTRY_FILES, derivedEntriesMode, derivedEntryFile, derivedEntryFileExists, derivedEntryFileNamesPresent } from '../shared/derived-entries.ts';
import { buildBuilderProjection } from '../v2/build-builder-projection.ts';
import { compareStats, markUnprintables, type EntryStats } from '../shared/stats.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { writeValueCatalogue } from './value-catalogue.ts';
import { buildQualityReportFold, type PrefixDistributionFold, type MismatchFold, type RegionalIdentifierFold, type CallsignPatternSeriesFold } from './quality-report-fold.ts';
import { buildDataQualityFold, type DataQualityFold } from './data-quality-fold.ts';
import { buildFoiUnkeyableSummary, type FoiUnkeyableSummary } from './foi-unkeyable-fold.ts';
import { writeCrossDatasetInvariants } from './cross-dataset-invariants.ts';
import { writeForbiddenSuffixHistory } from './forbidden-suffix-history.ts';
import { writeEventTimeCoherency } from './event-time-coherency.ts';
import { writeStateAtTReport } from './state-at-t.ts';
import { writePolicyInvariantsReport } from './policy-invariants.ts';
import { writeCuriosityIndex } from './curiosity-index.ts';
import { writeSequenceAnalytics } from './sequence-analytics.ts';
import { writeColumnDrift } from './column-drift.ts';
import { writeSurvivalCohort } from './survival-cohort.ts';
import { writeTimezoneRendering } from './timezone-rendering.ts';
import { writeReprocessingStratification } from './reprocessing-stratification.ts';
import { mdCell } from '../shared/markdown.ts';
import { time, perfReport, perfSnapshot, perfMerge } from '../shared/perf.ts';
import { isMainThread, workerData, parentPort } from 'node:worker_threads';
import { runBounded, runTaskInWorker } from './report-sweep-pool.ts';
import { REPORT_FOLD_THREADS_ENV, REPORT_FOLD_MEMORY_LIMIT_ENV } from '../v2/report-fold.ts';

// mdCell (markdown table-cell sanitiser) is shared with the other report
// generators; re-exported here so existing importers keep their path.
export { mdCell };

export interface ReportSweepReport {
  // One coverage row per archive entry (the dashboard table's data).
  coverageMarkdown: string;
  // Entries whose derived view is unreadable or partial - integrity failures
  // that turn the run red; a raw-only entry is honest coverage, not a failure.
  failed: { key: string; reason: string }[];
}

// One entry's derived-view state for the coverage table: every derived file
// present and readable ('derived'), none present ('raw-only'), or a loud
// failure (partial presence, unreadable stats) recorded on the report.
interface EntryCoverage { key: string; sourceKey: string; state: string; note: string }

function entryCoverage(key: string, failed: ReportSweepReport['failed']): EntryCoverage {
  let sourceKey = '?';
  try {
    const metaPath = path.join(DIRS.archive, key, 'meta.json');
    const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta;
    sourceKey = meta.sourceKey;
  } catch (err) {
    failed.push({ key, reason: `meta.json unreadable: ${errorMessage(err)}` });
    return { key, sourceKey, state: 'FAILED', note: 'meta.json unreadable' };
  }
  const present = derivedEntryFileNamesPresent(key);
  if (present.length === 0) {
    // The ledger lane covers every entry of the open-data register source, so
    // ZERO derived files for one is a loud failure, never "raw-only": either
    // the projection dropped an entry it should have folded (a fold gap), or
    // this is an archive-mode run over a corpus with a post-freeze
    // publication (whose derived views exist only in the projection) - both
    // states must never regenerate reports silently missing a publication.
    // A foreign source with no authored binding is honest raw-only coverage.
    if (sourceKey === OFCOM_AMATEUR_SOURCE_KEY) {
      failed.push({ key, reason: 'no derived view for a ledger-covered source - a projection fold gap, or an archive-mode run over a post-freeze corpus (run with --build-projection / BUILDER_PROJECTION_DIR)' });
      return { key, sourceKey, state: 'FAILED', note: 'no derived view for a ledger-covered source' };
    }
    return { key, sourceKey, state: 'raw-only', note: 'no derived view (no authored converter binding for this source)' };
  }
  if (present.length < DERIVED_ENTRY_FILES.length) {
    const missing = DERIVED_ENTRY_FILES.filter(name => !present.includes(name));
    failed.push({ key, reason: `partial derived view - missing ${missing.join(', ')}` });
    return { key, sourceKey, state: 'FAILED', note: `partial derived view (missing ${missing.join(', ')})` };
  }
  const stats = readStats(key);
  if (stats === undefined) {
    failed.push({ key, reason: 'stats.json is unreadable' });
    return { key, sourceKey, state: 'FAILED', note: 'stats.json unreadable' };
  }
  return { key, sourceKey, state: 'derived', note: `${stats.recordCount} records` };
}

// The independent report generators (issue #929): each is a producer over the
// shared inputs (the ledger projection + the archive) that writes its OWN
// disjoint files under reports/. This list is the single source of truth for
// which reports the sweep regenerates and what each is; the sequential and
// worker-parallel sweep paths differ only in how they SCHEDULE it. `id` is both
// the worker dispatch key and the perf label, so a run's breakdown names every
// generator wherever it ran. Ordering is not an input to any report - the output
// files are disjoint - so concurrency cannot change a single output byte, and
// the golden gate diffs the result to prove it.
interface ReportGeneratorTask { id: string; run: () => void }
const INDEPENDENT_REPORT_TASKS: readonly ReportGeneratorTask[] = [
  // The cross-lane value catalogue (issues #43/#223): every distinct value of
  // the tracked fields across both lanes, so a PR diff flags vocabulary drift
  // and unexpected values.
  { id: 'reports:value-catalogue', run: () => time('reports:value-catalogue', () => writeValueCatalogue()) },
  // The cross-dataset invariant probes (issue #241): available-pool depletion,
  // the still-absent decomposition and the original-issue-date invariant,
  // joining the FOI lane against the register. Its own buildDepletion/
  // buildOverlapMatrix spans are recorded internally, so it is left unwrapped
  // here to keep those figures free of a nesting parent.
  { id: 'reports:cross-dataset-invariants', run: () => writeCrossDatasetInvariants() },
  // The forbidden-suffix history (issues #289/#291): the forbidden list as a
  // first-class dataset category, diffed across every disclosure held, carrying
  // the ever-forbidden union and per-suffix first-known dates.
  { id: 'reports:forbidden-suffix-history', run: () => time('reports:forbidden-suffix-history', () => writeForbiddenSuffixHistory()) },
  // The cross-vintage event-time coherency report (issue #725 S2): the
  // retroactive-revision detector over the S1 event-date claims — mass-update
  // episodes, per-step revision classifications and corroboration depth.
  { id: 'reports:event-time-coherency', run: () => time('reports:event-time-coherency', () => writeEventTimeCoherency()) },
  // The state-at-t reconstruction report (issue #725 S3): the bi-temporal
  // inference engine demonstrated over the real corpus — inference rules,
  // per-kind coverage honesty and the authored worked examples.
  { id: 'reports:state-at-t', run: () => time('reports:state-at-t', () => writeStateAtTReport()) },
  // The policy-as-tests invariants report (issue #863): the regulator's stated
  // rules encoded as executable invariants over the ledger — the two-year
  // reservation window tested against every `reserved-until` claim.
  { id: 'reports:policy-invariants', run: () => time('reports:policy-invariants', () => writePolicyInvariantsReport()) },
  // The per-record curiosity index (issue #866): a reference-free rarity score
  // over the newest publication's records, sorted into the most-unusual-records
  // report with each score's component breakdown.
  { id: 'reports:curiosity-index', run: () => time('reports:curiosity-index', () => writeCuriosityIndex()) },
  // The namespace sequence analytics (issue #864): allocation order (the
  // register's H5), gap structure, issuance-rate curves and a naive
  // series-exhaustion projection per prefix series.
  { id: 'reports:sequence-analytics', run: () => time('reports:sequence-analytics', () => writeSequenceAnalytics()) },
  // The per-column distributional drift report (issue #862): per-vintage
  // fingerprints over every canonical column of the open-data normalised.csvs,
  // and the vintage-over-vintage divergences the thresholds flag.
  { id: 'reports:column-drift', run: () => time('reports:column-drift', () => writeColumnDrift()) },
  // The survival/cohort report (issue #865): the register as a life table over
  // the S1 event claims + open-data snapshot presence — right-censored licence
  // ages, retention by class and era-cohort, and the reservation-cycle picture.
  { id: 'reports:survival-cohort', run: () => time('reports:survival-cohort', () => writeSurvivalCohort()) },
  // The per-source timezone-rendering classification (issue #858): which clock
  // convention each source's date/datetime columns render under, derived by
  // chained pairwise natural experiments over the raw datetime cells.
  { id: 'reports:timezone-rendering', run: () => time('reports:timezone-rendering', () => writeTimezoneRendering()) },
  // The reprocessing-touch series stratification (issue #871): for every
  // inter-snapshot window, the per-series composition of the records touched in
  // that window against the snapshot's own series composition (flags, never
  // verdicts) — e.g. the 2024-10 bulk run largely excludes M7.
  { id: 'reports:reprocessing-stratification', run: () => time('reports:reprocessing-stratification', () => writeReprocessingStratification()) },
];

// Worker-pool width: the runner's core count, but capped, because each
// concurrent generator holds its own DuckDB fold's working set - unbounded fan
// on a many-core host would multiply peak memory (and temp-spill disk) beyond a
// standard runner's headroom, where the sequential sweep only ever held one
// fold's. The cap keeps the win (a standard CI runner is <= this wide anyway)
// while bounding the footprint; REPORT_SWEEP_CONCURRENCY (a positive integer)
// overrides it either way, for a constrained host or a deliberately wider one.
const MAX_REPORT_CONCURRENCY = 4;

// Per-fold memory budget under sweep concurrency (issue #929, following PR
// #951's thread-pinning result). PR #947/#951 both regenerated the golden
// report set in ~37 min at 4-wide concurrency with Σ CPU ~175 min — pinning
// threads=1 per fold (removing the CPU-oversubscription hypothesis) left that
// figure unchanged, which points the remaining 2-3.4x per-fold slowdown at
// memory/IO contention: four concurrent DuckDB CLI processes, each defaulting
// to its own large memory budget, spilling to disk and thrashing the shared
// page cache over the same parquet scans. GitHub-hosted `ubuntu-latest`
// runners (this workflow's runs-on) carry 16 GB RAM; at MAX_REPORT_CONCURRENCY
// (4) folds running simultaneously, capping each at 3 GB uses 12 GB and
// leaves ~4 GB of headroom for Node's own heap, the four worker threads'
// overhead, and the OS page cache the shared parquet scans lean on — tight
// enough to force each fold to bound its spill rather than grab memory
// unchecked, generous enough that 3 GB should comfortably hold one fold's
// working set (the folds ran solo in low seconds pre-#929, well under this).
const CONCURRENT_FOLD_MEMORY_LIMIT = '3GB';

function defaultReportConcurrency(): number {
  const override = process.env.REPORT_SWEEP_CONCURRENCY;
  if (override !== undefined && override !== '') {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.max(1, Math.min(os.availableParallelism(), MAX_REPORT_CONCURRENCY));
}

// Regenerate every committed report and assemble the coverage markdown. The
// change detector is deliberately NOT here: the scheduled workflow's own
// `git status` over reports/ decides whether a PR opens, and the golden gate
// diffs the regeneration against the committed tree - the regeneration only
// has to be deterministic.
//
// Sequential reference path: fold the shared data-quality rollup once, write the
// per-entry quality reports from it, then run every independent generator in
// order. runReportSweepParallel produces byte-identical output by fanning the
// same generators across worker threads; this single-process path is the one the
// unit suites drive (they call it ~30 times), so those runs never spawn a thread
// pool inside the fast test lane (the #375 oversubscription trap).
export function runReportSweep(): ReportSweepReport {
  const failed: ReportSweepReport['failed'] = [];
  const keys = listArchiveKeys().sort();
  const coverageRows = keys.map(key => entryCoverage(key, failed));

  // The data-quality rollup folds from the raw-keyed claim ledger's T1
  // flag/parse-status claims (data-quality-fold.ts, #442). Folded once here so
  // the committed reports/data-quality.md AND the coverage body's flag/status
  // trend tables read the SAME figures (the consistency contract), the corpus
  // scanned a single time rather than per surface.
  const dataQualityFold = time('reports:data-quality-fold', () => buildDataQualityFold());

  // Committed quality reports (issue #46): reports/{key}.md per entry with
  // stats - the durable, diffable, browsable home for the pattern matrix and
  // pairwise comparisons. Reads the shared fold above, so it stays on the
  // folding thread in both sweep paths.
  time('reports:quality-reports', () => writeQualityReports(keys, dataQualityFold));

  for (const task of INDEPENDENT_REPORT_TASKS) task.run();

  return assembleCoverage(keys, coverageRows, dataQualityFold, failed);
}

// Worker-parallel path (issue #929): byte-identical output to runReportSweep,
// but the independent generators fan across worker threads (report-sweep-pool.ts)
// instead of running one after another - the ~54-min sweep critical path was pure
// sequential addition, one generator per analytical wave, with nothing between
// them shared to force an order. The shared data-quality fold and the per-entry
// quality reports that consume it run in THIS thread while the pool churns, so
// the folding thread is a working lane rather than idle. Used by the CLI (the
// golden gate and the scheduled sweep); the unit suites drive the sequential
// path. Determinism is structural - each generator writes a disjoint set of
// files, so scheduling order is not an input to any report - and the golden gate
// diffs the result on every cache miss, proving it per run.
export async function runReportSweepParallel(concurrency: number = defaultReportConcurrency()): Promise<ReportSweepReport> {
  const failed: ReportSweepReport['failed'] = [];
  const keys = listArchiveKeys().sort();
  const coverageRows = keys.map(key => entryCoverage(key, failed));

  // Folded alone before any worker starts, so it keeps DuckDB's default
  // threads=cores — one fold on an otherwise-idle runner should use every core
  // (a solo fold measured ~2.4x faster multi-threaded than at threads=1, #929).
  const dataQualityFold = time('reports:data-quality-fold', () => buildDataQualityFold());

  // Pin every fold in the concurrent region to a single DuckDB thread. Each fold
  // otherwise defaults to threads=cores, so `concurrency` folds at once
  // oversubscribe an N-core runner N-fold and each runs ~2-3x slower (measured on
  // PR #947's parallel golden run); one thread per fold matches the folds to the
  // cores. Set on process.env BEFORE the pool spawns so each worker thread
  // inherits it in its process.env copy, and so it also constrains the
  // main-thread quality-reports fold that runs alongside the pool below.
  const previousFoldThreads = process.env[REPORT_FOLD_THREADS_ENV];
  process.env[REPORT_FOLD_THREADS_ENV] = '1';
  // Pin every fold in the concurrent region to a bounded memory budget too
  // (the sibling lever to threads-pinning: PR #951 measured NO speed-up from
  // threads=1 alone, which revises the contention hypothesis from CPU to
  // memory/IO — see CONCURRENT_FOLD_MEMORY_LIMIT above). Set and restored the
  // same way as the threads pin, for the same reasons.
  const previousFoldMemoryLimit = process.env[REPORT_FOLD_MEMORY_LIMIT_ENV];
  process.env[REPORT_FOLD_MEMORY_LIMIT_ENV] = CONCURRENT_FOLD_MEMORY_LIMIT;
  try {
    // Fan the independent generators across worker threads; each worker is this
    // same module (self-as-worker: see the worker branch at the foot of the
    // file), selecting its generator by id and posting its perf spans back to
    // merge into the one breakdown. Launched BEFORE the main-thread quality
    // reports so the two overlap on the folding thread.
    const workerUrl = new URL(import.meta.url);
    const pool = runBounded(INDEPENDENT_REPORT_TASKS, concurrency, async (task) => {
      const result = await runTaskInWorker(workerUrl, task.id);
      perfMerge(result.perf);
      return result;
    });
    // Observe the pool promise the instant it exists. If the main-thread work
    // below throws before the `await pool`, the function unwinds without awaiting,
    // and a worker that later rejects would otherwise orphan that rejection into
    // an unhandled-rejection race (a second, misleading crash trace). This inert
    // observer settles that branch; the real error still propagates — a worker
    // failure through `await pool`, or the main-thread throw itself. On the happy
    // path the pool resolves and this handler is never invoked.
    pool.catch(() => {});

    time('reports:quality-reports', () => writeQualityReports(keys, dataQualityFold));

    await pool;
  } finally {
    if (previousFoldThreads === undefined) delete process.env[REPORT_FOLD_THREADS_ENV];
    else process.env[REPORT_FOLD_THREADS_ENV] = previousFoldThreads;
    if (previousFoldMemoryLimit === undefined) delete process.env[REPORT_FOLD_MEMORY_LIMIT_ENV];
    else process.env[REPORT_FOLD_MEMORY_LIMIT_ENV] = previousFoldMemoryLimit;
  }

  return assembleCoverage(keys, coverageRows, dataQualityFold, failed);
}

// Assemble the coverage markdown from the per-entry coverage rows and the shared
// data-quality fold: the dashboard table, the newest dataset's RSL matrix, and
// the flag/status trend tables. Shared by both sweep paths so their non-report
// output (the scheduled workflow's dashboard body) is identical too.
function assembleCoverage(
  keys: string[],
  coverageRows: EntryCoverage[],
  dataQualityFold: DataQualityFold,
  failed: ReportSweepReport['failed'],
): ReportSweepReport {
  // The newest dataset's matrix always appears: the coverage body is the
  // does-this-look-right triage surface, and current state belongs on it -
  // when the reports changed because a publication landed, the newest entry
  // IS that publication.
  const newestKey = keys[keys.length - 1];
  const newestBlock: string[] = [];
  if (newestKey !== undefined) {
    const matrix = rslMatrix(newestKey);
    if (matrix !== undefined) {
      newestBlock.push(
        '',
        ...(matrix.unexpectedNote !== ''
          ? [`⚠ ${newestKey} contains locators absent from reference data: ${matrix.unexpectedNote}.`, '']
          : []),
        '<details>',
        `<summary>RSL matrix (current state): ${newestKey}</summary>`,
        '',
        ...matrix.lines,
        '</details>',
      );
    }
  }

  // The flag/status trend tables ride every coverage body (consistency with
  // reports/data-quality.md - the same folded figures, the same tables).
  const flagBlock = dataQualityFold.dates.length === 0 ? [] : [
    '',
    '<details>',
    '<summary>Data-quality flags per dataset</summary>',
    '',
    ...renderFlagStatusTables(dataQualityFold.dates, dataQualityFold.flags, dataQualityFold.parseStatuses),
    '',
    '</details>',
  ];

  const coverageMarkdown = [
    'Derived views read through the archive/projection switch (src/shared/derived-entries.ts): the committed baseline is frozen, and a newer publication folds from its raw bytes in the ledger projection.',
    '',
    '| entry | source | derived view | note |',
    '|---|---|---|---|',
    ...coverageRows.map(row => `| ${row.key} | ${mdCell(row.sourceKey)} | ${row.state} | ${mdCell(row.note)} |`),
    ...newestBlock,
    ...flagBlock,
  ].join('\n');

  return { coverageMarkdown, failed };
}
const REPORTS_DIR = 'reports/entries';

// Read of a derived file, resolved through the archive/projection switch: the
// workflows run projection-fed (BUILDER_PROJECTION_DIR), so a publication
// newer than the frozen committed baseline contributes its statistics too.
// Absence is honest (a raw-only entry); unreadability is surfaced as a run
// failure by entryCoverage above, so this returning undefined never hides an
// integrity problem.
//
// Exported: issue #467's dataset-anomaly-flags module reuses this rather than
// re-deriving the same "which entries have a readable stats.json" logic.
export function readStats(key: string): EntryStats | undefined {
  if (!derivedEntryFileExists(key, 'stats.json')) return undefined;
  const p = derivedEntryFile(key, 'stats.json');
  try {
    return parseJsonObject(fs.readFileSync(p, 'utf8'), p) as EntryStats;
  } catch {
    return undefined;
  }
}

// Chronological window for comparisons, bidirectional so a retrospectively
// inserted entry is judged in both directions - an anomaly can present as a
// discontinuity against successors just as easily as against predecessors.
//
// Each side extends from the nearest neighbour outwards until it contains
// COMPLETE_QUOTA datasets whose intendedCoverage is not declared incomplete
// (hard cap WINDOW_CAP per side). Anomalous publications cluster - the
// truncated dataset published twice in a fortnight crowded a fixed short
// look-back with the anomalies themselves - so the quota guarantees
// legitimate baselines while still showing every incomplete entry passed
// over on the way.
const COMPLETE_QUOTA = 3;
const WINDOW_CAP = 10;

// Exported alongside readStats/windowFor for #467's reuse.
export function isDeclaredIncomplete(key: string): boolean {
  try {
    const metaPath = path.join(DIRS.archive, key, 'meta.json');
    const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta;
    return meta.intendedCoverage?.complete === false;
  } catch {
    return false;
  }
}

// candidates are ordered nearest-first; returns nearest-first.
function takeUntilQuota(candidates: string[]): string[] {
  const taken: string[] = [];
  let complete = 0;
  for (const key of candidates) {
    if (taken.length >= WINDOW_CAP) break;
    taken.push(key);
    if (!isDeclaredIncomplete(key)) complete += 1;
    if (complete >= COMPLETE_QUOTA) break;
  }
  return taken;
}

export function windowFor(key: string, keys: string[]): string[] {
  const index = keys.indexOf(key);
  const before = takeUntilQuota(keys.slice(0, index).reverse()).reverse();
  const after = takeUntilQuota(keys.slice(index + 1));
  return [...before, key, ...after];
}

// Pattern labels: the empty pattern (a blank callsign in the raw) as a bare
// code span would render as two literal backticks, so it gets a marker.
// Whitespace/unprintable characters need no label handling - the taxonomy
// itself renders them as printable {U+XXXX} markers (statsSchemaVersion 2).
function patternLabel(pattern: string): string {
  if (pattern === '') return '_(empty)_';
  return `\`${mdCell(pattern, 40)}\``;
}

// Pattern x dataset matrix over the window: one row per pattern (union across
// the window), one column per dataset, current entry bolded. Absence is '—',
// distinct from a zero count. Every neighbour cell - the records row and the
// pattern rows alike - is annotated with its signed difference from the
// current entry ("this" is the baseline): the arithmetic reviewers would
// otherwise do by hand. Zero deltas stay unannotated (noise, not signal),
// and cells where the current entry lacks the pattern stay plain - the
// em-dash in the current column is the signal there, and a percentage over
// zero is undefined.
function matrixTable(key: string, window: string[], statsByKey: Map<string, EntryStats>): string[] {
  const header = window.map(k => (k === key ? `${k} (this)` : k));
  const patternUnion = new Set<string>();
  for (const k of window) {
    for (const p of Object.keys(statsByKey.get(k)?.callsignPatterns ?? {})) patternUnion.add(p);
  }
  const current = statsByKey.get(key);
  const patterns = [...patternUnion].sort((a, b) => {
    const byCount = (current?.callsignPatterns[b] ?? 0) - (current?.callsignPatterns[a] ?? 0);
    return byCount !== 0 ? byCount : a < b ? -1 : 1;
  });
  const annotated = (k: string, count: number | undefined, currentCount: number | undefined): string => {
    if (count === undefined) return k === key ? '**—**' : '—';
    if (k === key) return `**${count}**`;
    if (currentCount === undefined || currentCount === 0 || count === currentCount) return String(count);
    const diff = count - currentCount;
    const sign = diff >= 0 ? '+' : '';
    const pct = (diff / currentCount) * 100;
    return `${count}<br><small>${sign}${diff} (${sign}${pct.toFixed(1)}%)</small>`;
  };
  const rows = [
    `| pattern | ${header.join(' | ')} |`,
    `|---|${window.map(() => '---:').join('|')}|`,
    `| _records_ | ${window.map(k => annotated(k, statsByKey.get(k)?.recordCount, current?.recordCount)).join(' | ')} |`,
    ...patterns.map(p =>
      `| ${patternLabel(p)} | ${window
        .map(k => annotated(k, statsByKey.get(k)?.callsignPatterns[p], current?.callsignPatterns[p]))
        .join(' | ')} |`),
  ];
  return rows;
}

// One committed report per entry: its own full pattern table, the window
// matrix, and pairwise comparisons. Deterministic (no timestamps, stable
// ordering) so unchanged windows regenerate byte-identically.
function writeQualityReports(keys: string[], dataQuality: DataQualityFold): void {
  const statsByKey = new Map<string, EntryStats>();
  for (const k of keys) {
    const s = readStats(k);
    if (s) statsByKey.set(k, s);
  }
  if (statsByKey.size === 0) return;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const capped = (patterns: string[]): string =>
    patterns.length === 0 ? '—' : patterns.slice(0, 5).map(patternLabel).join(', ') + (patterns.length > 5 ? ` (+${patterns.length - 5} more)` : '');

  for (const [key, stats] of statsByKey) {
    const window = windowFor(key, keys).filter(k => statsByKey.has(k));
    const ownPatterns = Object.entries(stats.callsignPatterns).sort(([pa, ca], [pb, cb]) => (cb - ca) || (pa < pb ? -1 : 1));
    const pairwise = window
      .filter(k => k !== key)
      .map((neighbourKey) => {
        const cmp = compareStats(stats, statsByKey.get(neighbourKey) as EntryStats);
        const direction = neighbourKey < key ? 'before' : 'after';
        return `| ${neighbourKey} (${direction}) | ${statsByKey.get(neighbourKey)?.recordCount} | ${cmp.recordCountDeltaPct >= 0 ? '+' : ''}${cmp.recordCountDeltaPct.toFixed(1)}% | ${capped(cmp.newPatterns)} | ${capped(cmp.lostPatterns)} |`;
      });

    const lines = [
      `# Data-quality report: ${key}`,
      '',
      '<!-- Generated by the report sweep (issue #46); regenerated wholesale, so hand edits are overwritten. -->',
      `${stats.recordCount} records, ${ownPatterns.length} distinct callsign patterns.`,
      '',
      ...patternPartition(ownPatterns),
      '',
      '## Pattern counts across window',
      '',
      ...matrixTable(key, window, statsByKey),
      '',
      ...rslMatrixSection(key),
      '## Pairwise comparison',
      '',
      '| neighbour | records | Δ records | patterns gained vs neighbour | patterns lost vs neighbour |',
      '|---|---:|---:|---|---|',
      ...(pairwise.length > 0 ? pairwise : ['| (no neighbours with stats) | — | — | — | — |']),
      '',
    ];
    fs.writeFileSync(path.join(REPORTS_DIR, `${key}.md`), withCharacterKey(lines).join('\n'));
  }

  const keysWithStats = keys.filter(k => statsByKey.has(k));
  // FOLD (issue #361, migration steps 3/5 + Phase B/C): the prefix-series
  // distribution, the class-product-mismatch table, the regional-identifier
  // distribution and the callsign-pattern time-series all take their numbers from
  // the raw-keyed claim ledger's T1 parse-attribute tier (prefix_series /
  // implied_class / parse_status / rsl / flag, #406+#422) and the callsign-pattern
  // derived claim; the data-quality rollup folds from the same tier's flag /
  // parse-status claims (data-quality-fold.ts, #442), supplied by the caller so the
  // corpus is folded once. Each report's equivalence oracle pins the fold against
  // the committed golden as its retirement gate (#444).
  const fold = buildQualityReportFold();
  // The FOI lane's unkeyable-row addendum (issue #632) folds independently of
  // the claim ledger (foi-unkeyable-fold.ts) - a lightweight pass over the
  // same buildFoiObservations union the callsign-shard build folds.
  const foiUnkeyable = time('reports:foi-unkeyable-fold', () => buildFoiUnkeyableSummary());
  writePatternTimeSeries(fold.callsignPatterns);
  writeQualityRollup(dataQuality, fold.mismatches, foiUnkeyable);
  writeComponentDistributions(fold.prefixes, fold.regionalIdentifiers);
  writeReportsIndex([...keysWithStats].reverse(), statsByKey);
}

// Primary-by-secondary locator matrix (requested in #51 review): prefix
// series down the left, EVERY RSL letter from reference data along the top
// (all-zero rows/columns stay visible - absence is the sparsity signal),
// counts of parsed records at the intersections, with a totals row and
// column. Non-parsed records are excluded and accounted for in the caption.
// The Series × RSL orientation was chosen over its transpose in review.
interface RslMatrix {
  lines: string[];
  // Visible anomaly summary (empty when everything matches reference data) -
  // surfaced OUTSIDE details blocks in PR bodies, where the matrix serves as
  // a does-this-publication-look-right triage aid.
  unexpectedNote: string;
}

// Enumeration cap for the example details blocks: small populations are
// listed in full (the review value is in the rows themselves); larger ones
// are counted in the caption but not enumerated.
const ENUMERATE_LIMIT = 50;

// Curated pattern explanations (reference-data/pattern-formats.csv):
// exact-match rows first, then starts-with prefixes in file order. A
// pattern with no match is honestly unexplained - including any pattern
// carrying {U+XXXX} markers, which by construction never matches. The
// group column routes matches into their table (core vs the numerous
// visitor shapes, kept contained in their own section).
// `verified` gates whether the descriptor is asserted or hedged: `no` marks a
// shape we describe but cannot yet ground in an Ofcom/RSGB citation (the
// contest/special shapes), rendered with a visible _(unverified)_ tag rather
// than stated as fact - epistemic honesty over a confident-sounding guess.
interface PatternFormat { match: string; pattern: string; group: string; verified: string; explanation: string }
let patternFormatsCache: PatternFormat[] | undefined;
function loadPatternFormats(): PatternFormat[] {
  patternFormatsCache ??= parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'reference-data', 'pattern-formats.csv'), 'utf8'),
    { columns: true, skip_empty_lines: true },
  ) as PatternFormat[];
  return patternFormatsCache;
}

function formatFor(pattern: string): PatternFormat | undefined {
  const formats = loadPatternFormats();
  return formats.find(f => f.match === 'exact' && f.pattern === pattern)
    ?? formats.find(f => f.match === 'starts-with' && pattern.startsWith(f.pattern));
}

// The three pattern classes both the per-entry drill-downs and the standing
// report sort into, from one source of truth (reference-data/pattern-formats.csv
// via formatFor): UK core shapes, the visitor family, and everything with no
// curated descriptor - surfaced as unknown, never assumed.
type PatternClass = 'uk' | 'visitor' | 'unknown';
function patternClass(format: PatternFormat | undefined): PatternClass {
  if (format === undefined) return 'unknown';
  return format.group === 'visitor' ? 'visitor' : 'uk';
}

// The descriptor cell shared by every surface: the curated explanation, tagged
// _(unverified)_ when the reference row is not grounded in a citation. A
// pattern with no curated format has no descriptor (the unknown class carries
// none by construction).
function descriptorCell(format: PatternFormat | undefined): string {
  if (format === undefined) return '';
  return format.verified === 'no' ? `${format.explanation} _(unverified)_` : format.explanation;
}

// The callsign-patterns table split three ways: expected core formats
// (curated explanations from reference data), the visitor family (many
// distinct shapes - one per home-callsign form - kept contained in their
// own table), and unexpected formats - the review target.
function patternPartition(ownPatterns: [string, number][]): string[] {
  const matched = ownPatterns.map(([p, c]) => [p, c, formatFor(p)] as const);
  const expected = matched.filter(([, , f]) => f !== undefined && f.group !== 'visitor');
  const visitor = matched.filter(([, , f]) => f?.group === 'visitor');
  const unexpected = matched.filter(([, , f]) => f === undefined);
  const explainedTable = (rows: typeof matched): string[] => [
    '| pattern | count | explanation |',
    '|---|---:|---|',
    ...rows.map(([p, c, f]) => `| ${patternLabel(p)} | ${c} | ${descriptorCell(f)} |`),
  ];
  return [
    '## Callsign patterns',
    '',
    `### Expected formats (${expected.length})`,
    '',
    ...(expected.length === 0 ? ['(none)'] : explainedTable(expected)),
    '',
    `### Visitor formats (${visitor.length})`,
    '',
    ...(visitor.length === 0 ? ['(none)'] : explainedTable(visitor)),
    '',
    `### Unexpected formats (${unexpected.length})`,
    '',
    ...(unexpected.length === 0 ? ['(none)'] : [
      '| pattern | count |',
      '|---|---:|',
      ...unexpected.map(([p, c]) => `| ${patternLabel(p)} | ${c} |`),
    ]),
  ];
}

function rslMatrix(key: string): RslMatrix | undefined {
  // Derived-file read: archive/projection switched, like readStats above.
  if (!derivedEntryFileExists(key, 'components.csv')) return undefined;
  const componentsPath = derivedEntryFile(key, 'components.csv');
  const referenceData = loadReferenceData();
  const rslLetters = [...referenceData.rslLetters].sort();

  const bySeries = new Map<string, Map<string, number>>();
  const excluded = new Map<string, number>();
  const excludedExamples = new Map<string, string[]>();
  const unknownRsl = new Set<string>();
  const rslBearing: { callsign: string; series: string; rsl: string }[] = [];
  for (const r of parseCsvRecords(componentsPath)) {
    if (r.parse_status !== 'parsed') {
      excluded.set(r.parse_status, (excluded.get(r.parse_status) ?? 0) + 1);
      const examples = excludedExamples.get(r.parse_status) ?? [];
      if (examples.length <= ENUMERATE_LIMIT) examples.push(r.callsign);
      excludedExamples.set(r.parse_status, examples);
      continue;
    }
    if (r.rsl !== '' && !rslLetters.includes(r.rsl)) unknownRsl.add(r.rsl);
    if (r.rsl !== '') rslBearing.push({ callsign: r.callsign, series: r.prefix_series, rsl: r.rsl });
    const perRsl = bySeries.get(r.prefix_series) ?? new Map<string, number>();
    const column = r.rsl === '' ? '(none)' : r.rsl;
    perRsl.set(column, (perRsl.get(column) ?? 0) + 1);
    bySeries.set(r.prefix_series, perRsl);
  }
  if (bySeries.size === 0) return undefined;

  const rslColumns = [...rslLetters, ...[...unknownRsl].sort(), '(none)'];
  // Every primary locator is shown too: reference series with no register
  // presence stay visible as all-dot rows - absence is the signal.
  const seriesRows = [...new Set([...referenceData.prefixSeries.keys(), ...bySeries.keys()])].sort();
  // Locators observed in the data but absent from reference data are
  // highlighted on their heading and named in the caption - an unexpected
  // series (M2) or RSL letter (a temporary/special RSL) is a finding.
  const unexpectedSeries = seriesRows.filter(s => !referenceData.prefixSeries.has(s));
  const seriesHeading = (s: string): string => unexpectedSeries.includes(s) ? `\`${s}\` ⚠` : `\`${s}\``;
  const rslHeading = (r: string): string => unknownRsl.has(r) ? `${r} ⚠` : r;
  const unexpectedNote = [
    ...(unexpectedSeries.length > 0 ? [`series ${unexpectedSeries.map(s => `\`${s}\``).join(', ')}`] : []),
    ...(unknownRsl.size > 0 ? [`RSL ${[...unknownRsl].sort().join(', ')}`] : []),
  ].join('; ');
  const count = (series: string, rsl: string): number => bySeries.get(series)?.get(rsl) ?? 0;
  const seriesTotal = (series: string): number => rslColumns.reduce((sum, c) => sum + count(series, c), 0);
  const columnTotal = (rsl: string): number => seriesRows.reduce((sum, s) => sum + count(s, rsl), 0);
  const grandTotal = seriesRows.reduce((sum, s) => sum + seriesTotal(s), 0);
  // Zero cells render as a quiet dot so the populated intersections stand
  // out in an otherwise sparse table.
  const quiet = (n: number): string => n === 0 ? '·' : String(n);
  // Enumerated elaborations: populations small enough to list in full go
  // behind details blocks - the RSL-bearing rows ARE the interesting finds,
  // and excluded values render with exploded {U+XXXX} markers so invisible
  // characters (leading, middle, or trailing) are visible in the list.
  const details: string[] = [];
  if (rslBearing.length > 0 && rslBearing.length <= ENUMERATE_LIMIT) {
    details.push(
      '',
      '<details>',
      `<summary>RSL-bearing records (${rslBearing.length})</summary>`,
      '',
      '| callsign | series | RSL |',
      '|---|---|---|',
      ...rslBearing.map(r => `| \`${mdCell(nameMarkers(markUnprintables(r.callsign)), 40)}\` | \`${r.series}\` | ${r.rsl} |`),
      '',
      '</details>',
    );
  }
  for (const [status, n] of [...excluded.entries()].sort()) {
    const examples = excludedExamples.get(status) ?? [];
    if (n === 0 || n > ENUMERATE_LIMIT) continue;
    details.push(
      '',
      '<details>',
      `<summary>Excluded: ${status} (${n})</summary>`,
      '',
      ...examples.slice(0, ENUMERATE_LIMIT).map(c => `- \`${mdCell(nameMarkers(markUnprintables(c)), 60)}\``),
      '',
      '</details>',
    );
  }

  const lines = [
    '## RSL matrix',
    '',
    'Parsed records by primary locator (prefix series) and Regional',
    'Secondary Locator. Every RSL letter from `reference-data/rsl.csv` is',
    'shown - all-zero rows/columns are the sparsity signal, not noise; `·`',
    'means zero.',
    ...(unexpectedNote === '' ? [] : [
      '',
      `⚠ locators observed in the data but absent from reference data: ${unexpectedNote}.`,
    ]),
    ...(excluded.size === 0 ? [] : [
      '',
      'Excluded from this table:',
      ...[...excluded.entries()].sort().map(([status, n]) => `- ${n} ${status}`),
    ]),
    '',
    `| series | ${rslColumns.map(rslHeading).join(' | ')} | total |`,
    `|---|${rslColumns.map(() => '---:').join('|')}|---:|`,
    ...seriesRows.map(series =>
      `| ${seriesHeading(series)} | ${rslColumns.map(c => quiet(count(series, c))).join(' | ')} | ${quiet(seriesTotal(series))} |`),
    `| **total** | ${rslColumns.map(c => quiet(columnTotal(c))).join(' | ')} | ${quiet(grandTotal)} |`,
    ...details,
    '',
  ];
  return { lines, unexpectedNote };
}

function rslMatrixSection(key: string): string[] {
  return rslMatrix(key)?.lines ?? [];
}

// A distribution table over dated dataset columns: one row per label (sorted the
// same way whichever path supplied the counts), a cell per column defaulting to
// 0 when the label is absent from that dataset. Shared by the prefix and
// regional-identifier tables and by the prefix fold, so the rendered shape is
// identical whichever computed the numbers.
function distributionTable(dates: string[], rows: Map<string, Map<string, number>>, header: string): string[] {
  return [
    `| ${header} | ${dates.join(' | ')} |`,
    `|---|${dates.map(() => '---:').join('|')}|`,
    ...[...rows.keys()].sort().map(row =>
      `| ${row} | ${dates.map(k => rows.get(row)?.get(k) ?? 0).join(' | ')} |`),
  ];
}

// The prefix-series distribution markdown, from the ledger fold's per-label
// per-date counts (quality-report-fold.ts). A pure function of the fold shape, so
// the equivalence oracle renders the committed golden through this same path.
export function renderPrefixDistributions(dates: string[], rows: Map<string, Map<string, number>>): string {
  return [
    '# Prefix-series distributions',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Records per prefix series per dataset (newest leftmost), from',
    '`components.csv`. Non-parsed records appear as their parse status, so',
    'every record lands in exactly one row. Series semantics:',
    '`reference-data/prefix-formats.csv`.',
    '',
    ...distributionTable(dates, rows, 'prefix series'),
    '',
  ].join('\n');
}

// The regional-identifier distribution markdown, from the ledger fold's per-label
// per-date counts (quality-report-fold.ts). The rendered identifier is the
// prefix+RSL combination (GM, MW, 2E, ...), bare 20/21 for RSL-less intermediates,
// and an aggregate for RSL-less G/M cores; a pure function of the fold shape, so
// the equivalence oracle renders the committed golden through this same path.
export function renderRegionalIdentifiers(dates: string[], rows: Map<string, Map<string, number>>): string {
  return [
    '# Regional-identifier distributions',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Parsed records per rendered regional identifier per dataset (newest',
    'leftmost): letter combinations (`GM`, `MW`, ...), digit-led (`2E`,',
    '`2W`, ...), bare `20`/`21` intermediates stored without their',
    'mandatory-in-use RSL, and an aggregate for RSL-less `G`/`M` cores (the',
    'register stores the RSL-less core by design - see',
    '`docs/reference/callsign-structure/`). RSL semantics:',
    '`reference-data/rsl.csv`.',
    '',
    ...distributionTable(dates, rows, 'identifier'),
    '',
  ].join('\n');
}

// Prefix-series and regional-identifier distributions (issue #51). Columns are
// datasets newest leftmost, matching the other rollups.
//
// FOLD, not re-derive (issue #361, migration step 5 + Phase B): both tables' figures
// come from the raw-keyed claim ledger's T1 parse-attribute tier
// (quality-report-fold.ts) — the prefix table from prefix_series/parse_status, the
// regional table from the same joined to the per-record `rsl` claim (#422). The
// equivalence oracle pins the fold against the committed goldens
// (quality-report-fold.test.ts).
function writeComponentDistributions(prefix: PrefixDistributionFold, regional: RegionalIdentifierFold): void {
  // Both reports need at least one dated open-data column; a bare archive with no
  // register-bearing entries writes neither (mirroring the folds' empty return).
  if (regional.dates.length === 0) return;
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'prefixes.md'), renderPrefixDistributions(prefix.dates, prefix.rows));
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'regional-identifiers.md'), renderRegionalIdentifiers(regional.dates, regional.rows));
}

// Overview index for the reports directory (issue #51): headline numbers
// per dataset linking to the per-entry reports and the drill-downs.
function writeReportsIndex(columnsNewestFirst: string[], statsByKey: Map<string, EntryStats>): void {
  const rows = columnsNewestFirst.map((key) => {
    const s = statsByKey.get(key) as EntryStats;
    const flagged = Object.values(s.callsignFlags ?? {}).reduce((a, b) => a + b, 0);
    return `| [${key}](entries/${key}.md) | ${s.recordCount} | ${Object.keys(s.callsignPatterns).length} | ${flagged} |`;
  });
  const lines = [
    '# Reports',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Standing, deterministic views over the archive. Drill-downs:',
    '',
    '- [Callsign patterns](callsign-patterns.md) - full pattern time-series',
    '- [Prefix-series distributions](prefixes.md)',
    '- [Regional-identifier distributions](regional-identifiers.md)',
    '- [Data-quality rollup](data-quality.md) - defect detectors, flags, parse statuses',
    '- [Class-product mismatches](class-product-mismatches.md) - standing table of every affected row',
    '- [Event-time coherency](event-time-coherency.md) - cross-vintage retroactive-revision detector: mass-update episodes, revisions, corroboration',
    '- [State-at-t reconstruction](state-at-t.md) - bi-temporal inference engine: what the corpus can honestly say about a callsign at a date, and under which vintages',
    '- [Policy-as-tests invariants](policy-invariants.md) - the regulator\'s stated rules as executable invariants: the two-year reservation window tested against the held data',
    '- [Curiosity index](curiosity-index.md) - reference-free per-record rarity score: the most unusual records in the newest publication, with each score’s component breakdown',
    '- [Namespace sequence analytics](sequence-analytics.md) - allocation order (H5), gap structure, issuance-rate curves and a naive series-exhaustion projection per prefix series',
    '- [Column distributional drift](column-drift.md) - per-column, per-vintage fingerprints and the vintage-over-vintage divergences they flag',
    '- [Survival and cohort analysis](survival-cohort.md) - the register as a life table: right-censored licence ages, retention by class and era, reservation cycles',
    '- [Timezone-rendering classification](timezone-rendering.md) - which clock convention each source renders dates under, derived by chained natural experiments; unclassifiable sources stay honestly unclassified',
    '- [Reprocessing-touch series stratification](reprocessing-stratification.md) - per inter-snapshot window, how each bulk-reprocessing touch cohort is distributed across callsign series versus the snapshot itself; flags, never verdicts',
    '',
    '| dataset | records | distinct patterns | flag instances |',
    '|---|---:|---:|---:|',
    ...rows,
    '',
    'Per-entry reports (pattern tables, windowed matrices, pairwise',
    'comparisons) live in [entries/](entries/).',
    '',
  ];
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'README.md'), lines.join('\n'));
}

// Human-readable names for characters that appear in patterns and examples
// but are easy to misread in a table: invisibles (shown as {U+XXXX} markers)
// and visually-confusable printables (hyphen vs en dash vs em dash, the
// replacement character). Unlisted codepoints fall back to their U+ label.
const CHARACTER_NAMES: Record<string, string> = {
  '0009': 'character tabulation (tab)',
  '0020': 'space',
  '00A0': 'no-break space',
  '2002': 'en space',
  '2003': 'em space',
  '200B': 'zero width space',
  '200C': 'zero width non-joiner',
  '200D': 'zero width joiner',
  '2010': 'hyphen',
  '2011': 'non-breaking hyphen',
  '2013': 'en dash',
  '2014': 'em dash',
  '2212': 'minus sign',
  'FEFF': 'zero width no-break space (BOM)',
  'FFFD': 'replacement character (encoding failure)',
  '002D': 'hyphen-minus',
  '002F': 'solidus (portable/reciprocal separator)',
  '0023': 'number sign (placeholder notation)',
  '005F': 'low line / underscore (placeholder notation)',
};

function codepointHex(c: string): string {
  return (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}

// Compact human-readable marker names for the reader-selectable "named" table
// views: a pure 1:1 relabelling of {U+XXXX} markers (space and NBSP stay
// distinct), so counts never merge. Unlisted codepoints keep their U+ form.
const SHORT_MARKER_NAMES: Record<string, string> = {
  '0009': 'tab',
  '0020': 'space',
  '00A0': 'nbsp',
  '200B': 'zwsp',
  '200C': 'zwnj',
  '200D': 'zwj',
  'FEFF': 'bom',
};

function nameMarkers(text: string): string {
  return text.replace(/\{U\+([0-9A-F]{4,6})\}/g, (m, hex: string) => `{${SHORT_MARKER_NAMES[hex] ?? `U+${hex}`}}`);
}

// Appends a "Character key" section naming every {U+XXXX} marker and every
// non-alphanumeric character that appears inside the report's code spans -
// raw codepoints stay in the tables for precision; the key supplies the
// legibility (requested in review: space vs NBSP vs tab, dash variants).
function withCharacterKey(lines: string[]): string[] {
  const content = lines.join('\n');
  const seen = new Map<string, string>(); // hex -> display label
  for (const m of content.matchAll(/\{U\+([0-9A-F]{4,6})\}/g)) {
    seen.set(m[1], `\`{U+${m[1]}}\``);
  }
  for (const span of content.matchAll(/`([^`\n]+)`/g)) {
    for (const c of span[1]) {
      if (/[A-Za-z0-9]/.test(c)) continue;
      if ('{}+_'.includes(c) && span[1].includes('{U+')) continue; // marker syntax itself
      seen.set(codepointHex(c), `\`${c}\``);
    }
  }
  if (seen.size === 0) return lines;
  const rows = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([hex, label]) => `| ${label} | U+${hex} | ${CHARACTER_NAMES[hex] ?? '(unnamed)'} |`);
  return [
    ...lines,
    '## Character key',
    '',
    '| appears as | codepoint | name |',
    '|---|---|---|',
    ...rows,
    '',
  ];
}

// Per-publication defect counts (issue #51's quality rollup): one row per
// detector, one column per dataset (newest leftmost), with per-detector
// example values folded behind details blocks. Each detector is grounded in
// a defect class observed in real exports; a class appearing or vanishing
// between publications is a pipeline-change signal in its own right.
//
// FOLD from the raw-keyed claim ledger (data-quality-fold.ts, #442/#444): the
// defect-detector matrix is a RELABELLING of the ledger's T1 flag/parse-status
// claims (excel-date-shape, encoding-failure, whitespace, stripped-collision,
// lowercase, and the recovered `empty` status), the flag and parse-status
// registries fold from those same claims, and the example tables fold from the
// flagged observations' raw subjects (see data-quality-fold.ts for the full
// detector -> claim mapping and the single classified `lowercase` superset
// subtlety). The equivalence oracle pins the fold against the committed golden.
function writeQualityRollup(dataQuality: DataQualityFold, foldedMismatches: MismatchFold, foiUnkeyable: FoiUnkeyableSummary): void {
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'data-quality.md'), renderDataQualityRollup(dataQuality, foiUnkeyable));

  writeMismatchReport(foldedMismatches);
}

// The FOI-lane unkeyable-row addendum (issue #632): the defect-detector
// matrix above is open-data only by design (data-quality-fold.ts's
// OPEN_DATA_LANE), so the FOI lane's share of the same unkeyable-row test the
// callsign-shard build applies (foi-unkeyable-fold.ts) had no committed home.
// Omitted entirely when the FOI archive carries none - the common state for
// any one file, though not for the lane as a whole.
function renderFoiUnkeyableSection(foi: FoiUnkeyableSummary | undefined): string[] {
  if (foi === undefined || foi.total === 0) return [];
  const rowNoun = foi.total === 1 ? 'row' : 'rows';
  const fileNoun = foi.files.length === 1 ? 'file' : 'files';
  return [
    '',
    '## FOI lane',
    '',
    'The defect-detector matrix above is open-data only (one column per',
    'register-snapshot publication) — the FOI lane (`archive/foi/`) carries no',
    'detector matrix of its own. The same unkeyable test the callsign-shard',
    'build applies (a callsign cell that, cleaned, carries no `A-Z0-9/`',
    `character at all - a blank cell, or a token of punctuation alone) finds **${foi.total.toLocaleString('en-GB')}**`,
    `unkeyable ${rowNoun} across **${foi.files.length}** FOI ${fileNoun}. Each is carried in its file's own`,
    'record count and never dropped - it is simply not addressable by',
    'callsign, so it never reaches a callsign-shard entry or lookup.',
    '',
    '| entry | file | unkeyable rows |',
    '|---|---|---:|',
    ...foi.files.map(f => `| \`${f.entry}\` | \`${f.file}\` | ${f.count.toLocaleString('en-GB')} |`),
  ];
}

// The data-quality rollup markdown, rendered from the raw-keyed claim ledger fold
// (data-quality-fold.ts), plus the FOI-lane addendum above (folded separately -
// foi-unkeyable-fold.ts - since it is not open-data/claim-ledger sourced). A
// pure function of its inputs, so the sweep and the equivalence oracle render
// the same fold shape identically - the retirement gate the oracle pins.
export function renderDataQualityRollup(dq: DataQualityFold, foiUnkeyable?: FoiUnkeyableSummary): string {
  const columns = dq.dates;
  const detectorLabels: readonly [string, string][] = [
    ['excelDateShaped', 'Excel-date-shaped callsigns'],
    ['encodingFailure', 'encoding-failure characters'],
    ['whitespaceBearing', 'whitespace/invisible-bearing'],
    ['postNormalisationDuplicates', 'post-normalisation duplicates'],
    ['emptyCallsign', 'empty callsigns'],
    ['lowercaseBearing', 'lowercase-bearing'],
  ];
  const detectorCell = (detectorKey: string, date: string): string => {
    const result = dq.detectors.get(detectorKey)?.get(date);
    return result === undefined ? '—' : String(result.count);
  };
  const countRow = (detectorKey: string, label: string): string =>
    `| ${label} | ${columns.map(k => detectorCell(detectorKey, k)).join(' | ')} |`;

  const exampleSections = detectorLabels.flatMap(([detectorKey, label]) => {
    const rows = columns.flatMap((k) => {
      const result = dq.detectors.get(detectorKey)?.get(k);
      if (result === undefined || result.count === 0) return [];
      const suffix = result.count > result.examples.length ? ` (+${result.count - result.examples.length} more)` : '';
      // Examples use the human-readable marker form - this is the review
      // surface; per-codepoint precision remains in stats.json.
      return [`| ${k} | ${result.examples.map(e => `\`${mdCell(nameMarkers(e), 40)}\``).join(', ')}${suffix} |`];
    });
    if (rows.length === 0) return [];
    return [
      '',
      '<details>',
      `<summary>Examples: ${label}</summary>`,
      '',
      '| dataset | examples |',
      '|---|---|',
      ...rows,
      '',
      '</details>',
    ];
  });

  const recordCell = (k: string): string => {
    const count = dq.recordCounts.get(k);
    return count === undefined ? '—' : String(count);
  };

  const lines = [
    '# Data-quality rollup (callsign defect detectors)',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Automated per-publication counts for defect classes observed in real',
    'exports. Rows are detectors, columns are datasets (newest leftmost).',
    'A class appearing or vanishing between publications is a pipeline-change',
    'signal in its own right.',
    '',
    `| detector | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    `| _records_ | ${columns.map(recordCell).join(' | ')} |`,
    ...detectorLabels.map(([detectorKey, label]) => countRow(detectorKey, label)),
    '',
    ...renderFlagStatusTables(columns, dq.flags, dq.parseStatuses),
    ...exampleSections,
    ...renderFoiUnkeyableSection(foiUnkeyable),
    '',
  ];
  return withCharacterKey(lines).join('\n');
}

// Render the flag and parse-status registries from per-row-name per-date count
// maps (the flag object / status name -> date -> count shape the ledger fold
// produces). One row per name observed anywhere
// (keys sorted so a class appearing or disappearing is a visible trend line), a
// cell per column defaulting to 0 when the name is absent from that dataset -
// exactly the previous inline aggregation, now the single source of truth shared
// by the committed rollup and the sweep PR body (the consistency contract).
function renderFlagStatusTables(columns: string[], flags: Map<string, Map<string, number>>, statuses: Map<string, Map<string, number>>): string[] {
  const rows = (map: Map<string, Map<string, number>>): string[] =>
    [...map.keys()].sort().map(name =>
      `| \`${name}\` | ${columns.map(k => map.get(name)?.get(k) ?? 0).join(' | ')} |`);
  return [
    '## Component-parse flags',
    '',
    'Per-row flags from `components.csv` (vocabulary and semantics:',
    '`reference-data/flags.md` - notably, `forbidden-suffix` is mostly',
    'long-standing allocations, not an anomaly by itself).',
    '',
    `| flag | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...rows(flags),
    '',
    '## Parse statuses',
    '',
    `| status | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...rows(statuses),
  ];
}

// The class-product-mismatch rows are few enough to publish in full: a
// standing, hand-reviewable table of every register row whose prefix-implied
// licence class disagrees with its product column. Causes are unknown -
// plausibly issuance-time input errors, plausibly legitimate arrangements
// not publicly stated (e.g. permission to use a deceased relative's callsign
// at the holder's own licence level) - the table records the discrepancy,
// not a verdict.
// One per-dataset mismatch section's rows, as the ledger fold supplies them
// (quality-report-fold.ts).
export interface MismatchSection { key: string; rows: MismatchRow[] }
export interface MismatchRow { callsign: string; prefixSeries: string; impliedClass: string; product: string }

// Render one per-dataset mismatch section (its `(none)` form when empty), the
// callsign truncated/escaped as a code span and the product truncated/escaped.
function mismatchSection(section: MismatchSection): string[] {
  const rows = section.rows.map(r =>
    `| \`${mdCell(r.callsign, 40)}\` | ${r.prefixSeries} | ${r.impliedClass} | ${mdCell(r.product, 60)} |`);
  return [
    '',
    `## ${section.key} (${rows.length})`,
    '',
    ...(rows.length === 0 ? ['(none)'] : [
      '| callsign | prefix series | implied class | product |',
      '|---|---|---|---|',
      ...rows,
    ]),
  ];
}

// The class-product-mismatch report markdown from its per-dataset sections,
// whichever path supplied them.
export function renderMismatchReport(sections: MismatchSection[]): string {
  const lines = [
    '# Class-product mismatches',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Every register row whose prefix-implied licence class disagrees with its',
    'product column, per dataset (newest first). Causes are unknown: plausibly',
    'issuance-time input errors uncorrected since, plausibly legitimate',
    'arrangements not publicly stated. The table records the discrepancy, not',
    'a verdict.',
    ...sections.flatMap(mismatchSection),
    '',
  ];
  return withCharacterKey(lines).join('\n');
}

// FOLD, not re-derive (issue #361, migration step 5): the sections come from the
// raw-keyed claim ledger's T1 tier — the class-product-mismatch `flag` claim
// joined to the observation's prefix_series / implied_class derived claims and its
// raw product cell. The ofcom-amateur normaliser copies the callsign verbatim and
// is row-preserving, so the fold parses the same token over the same rows and
// reproduces the committed golden (quality-report-fold.test.ts).
function writeMismatchReport(foldedMismatches: MismatchFold): void {
  const sections = foldedMismatches.dates.map(date => ({ key: date, rows: foldedMismatches.byDate.get(date) ?? [] }));
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'class-product-mismatches.md'), renderMismatchReport(sections));
}

// Parse a committed derivative CSV into header-keyed records — the per-entry RSL
// matrix reads components.csv this way.
function parseCsvRecords(filePath: string): Record<string, string>[] {
  return parse(fs.readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

// Full pattern time-series (issue #51's callsign-patterns drill-down): one
// column per dataset - ALL of them, not a window - with plain counts and no
// baseline, so distribution changes over time read directly. Two views: raw
// patterns (per-codepoint precision), and a folded companion where every
// {U+XXXX} marker collapses to a single U class, so the same shape
// contaminated by DIFFERENT whitespace codepoints across eras merges into
// one row (the phenomenon's continuity).
//
// FOLD, not re-derive (issue #361, Phase B): the per-dataset pattern counts come
// from the raw-keyed claim ledger's callsign-pattern derived claim (#422) rather
// than the legacy stats.json tally, supplied as a CallsignPatternSeriesFold. The
// blank-callsign bucket (`_(empty)_`) is recovered from the @listed anchor — the
// tier emits no callsign-pattern claim for an empty token — so no finding is
// dropped. The classification/descriptor logic (formatFor/patternClass), the
// marker-fold transform and the character key are pure functions of the pattern
// STRING, so they render identically whichever source supplied the counts.
export function renderCallsignPatternSeries(series: CallsignPatternSeriesFold): string {
  const { keys } = series;
  const patternsOf = (k: string): Map<string, number> => series.patterns.get(k) ?? new Map<string, number>();
  const recordCell = (k: string): string => {
    const count = series.recordCounts.get(k);
    return count === undefined ? '—' : String(count);
  };
  const foldMarkers = (pattern: string): string => pattern.replace(/\{U\+[0-9A-F]+\}/g, 'U');

  const table = (transform: (pattern: string) => string): string[] => {
    const perKey = new Map<string, Map<string, number>>();
    for (const k of keys) {
      const agg = new Map<string, number>();
      for (const [p, c] of patternsOf(k)) {
        const t = transform(p);
        agg.set(t, (agg.get(t) ?? 0) + c);
      }
      perKey.set(k, agg);
    }
    const union = new Set<string>();
    for (const agg of perKey.values()) for (const p of agg.keys()) union.add(p);
    const newest = perKey.get(keys[keys.length - 1]);
    const patterns = [...union].sort((a, b) => ((newest?.get(b) ?? 0) - (newest?.get(a) ?? 0)) || (a < b ? -1 : 1));
    // Newest dataset on the LEFT: the latest publication is what a reader
    // checks first, and history recedes rightwards.
    const columns = [...keys].reverse();
    return [
      `| pattern | ${columns.join(' | ')} |`,
      `|---|${columns.map(() => '---:').join('|')}|`,
      `| _records_ | ${columns.map(recordCell).join(' | ')} |`,
      ...patterns.map(p => `| ${patternLabel(p)} | ${columns.map(k => perKey.get(k)?.get(p) ?? '—').join(' | ')} |`),
    ];
  };

  // The grouped, descriptor-bearing view of the RAW patterns (per-codepoint
  // precision), partitioned into the same three classes as the per-entry
  // drill-downs from the one source of truth (formatFor). The marker/folded
  // companions below stay flat - their job is codepoint continuity over time,
  // not classification.
  const columns = [...keys].reverse();
  const newest = keys[keys.length - 1];
  const newestCounts = patternsOf(newest);
  const union = new Set<string>();
  for (const k of keys) for (const p of patternsOf(k).keys()) union.add(p);
  const sortByNewest = (a: string, b: string): number =>
    ((newestCounts.get(b) ?? 0) - (newestCounts.get(a) ?? 0)) || (a < b ? -1 : 1);
  const countsFor = (p: string): string =>
    columns.map(k => patternsOf(k).get(p) ?? '—').join(' | ');

  const byClass: Record<PatternClass, string[]> = { uk: [], visitor: [], unknown: [] };
  for (const p of union) byClass[patternClass(formatFor(p))].push(p);
  for (const cls of Object.keys(byClass) as PatternClass[]) byClass[cls].sort(sortByNewest);

  const describedTable = (patterns: string[]): string[] => [
    `| pattern | descriptor | ${columns.join(' | ')} |`,
    `|---|---|${columns.map(() => '---:').join('|')}|`,
    ...patterns.map(p => `| ${patternLabel(p)} | ${descriptorCell(formatFor(p))} | ${countsFor(p)} |`),
  ];
  const plainTable = (patterns: string[]): string[] => [
    `| pattern | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...patterns.map(p => `| ${patternLabel(p)} | ${countsFor(p)} |`),
  ];

  const lines = [
    '# Callsign pattern time-series',
    '',
    '<!-- Generated by the report sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Pattern counts across ALL datasets in archive-key order (no baseline; the',
    'per-entry reports under `entries/` carry windowed views with deltas).',
    'Patterns are grouped by class - UK core shapes, the visitor family, then',
    'unknown/unexpected - with a descriptor for each shape; rows within a group',
    'are sorted by the newest dataset\'s counts.',
    '',
    '## Records per dataset',
    '',
    `| dataset | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    `| _records_ | ${columns.map(recordCell).join(' | ')} |`,
    '',
    '## Patterns by class',
    '',
    'Descriptors are sourced from `reference-data/pattern-formats.csv` (`A` =',
    'letter, `N` = digit). A shape that cannot yet be grounded in an Ofcom/RSGB',
    'citation is tagged _(unverified)_ rather than asserted; any pattern with no',
    'curated descriptor is surfaced as unknown, never bucketed silently.',
    '',
    `### UK patterns (${byClass.uk.length})`,
    '',
    ...(byClass.uk.length === 0 ? ['(none)'] : describedTable(byClass.uk)),
    '',
    `### Visitor patterns (${byClass.visitor.length})`,
    '',
    ...(byClass.visitor.length === 0 ? ['(none)'] : describedTable(byClass.visitor)),
    '',
    `### Unknown / unexpected patterns (${byClass.unknown.length})`,
    '',
    ...(byClass.unknown.length === 0 ? ['(none)'] : plainTable(byClass.unknown)),
    '',
    '<details>',
    '<summary>Raw patterns (per-codepoint precision, ungrouped)</summary>',
    '',
    ...table(p => p),
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Raw patterns (human-readable markers: {nbsp}, {space}, ...)</summary>',
    '',
    ...table(nameMarkers),
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Folded patterns (every {U+XXXX} marker collapsed to U)</summary>',
    '',
    ...table(foldMarkers),
    '',
    '</details>',
    '',
  ];
  return withCharacterKey(lines).join('\n');
}

// Write the callsign-pattern time-series, folding from the ledger's callsign-
// pattern derived claim (quality-report-fold.ts); the equivalence oracle pins the
// fold against the committed golden.
function writePatternTimeSeries(series: CallsignPatternSeriesFold): void {
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'callsign-patterns.md'), renderCallsignPatternSeries(series));
}


async function main(): Promise<void> {
  // --build-projection: build the ledger projection to a scratch directory and
  // run the sweep against it - the projection-fed semantics the workflows use,
  // in one local command (the `npm run regen` path). Without the flag (and
  // without BUILDER_PROJECTION_DIR) the sweep reads the frozen committed
  // derivatives, which is complete only while no post-freeze publication
  // exists - the coverage table names any entry that would be missed.
  let scratchProjection: string | undefined;
  try {
    if (process.argv.includes('--build-projection')) {
      if (derivedEntriesMode() === 'projection') {
        throw new Error(`--build-projection conflicts with an already-set ${BUILDER_PROJECTION_DIR_ENV} - use one or the other`);
      }
      scratchProjection = fs.mkdtempSync(path.join(os.tmpdir(), 'report-sweep-projection-'));
      console.error(`building the ledger projection to ${scratchProjection} ...`);
      buildBuilderProjection(scratchProjection);
      process.env[BUILDER_PROJECTION_DIR_ENV] = scratchProjection;
    }
    // The projection env is now set (in-process), so the worker threads the
    // parallel sweep spawns inherit it in their process.env copy.
    await mainSweep();
  } finally {
    // The scratch projection is cleaned up whatever threw - including the
    // projection build itself (an unauthored binding on a fresh entry), which
    // would otherwise orphan a multi-hundred-MB directory per failed run.
    if (scratchProjection !== undefined) {
      delete process.env[BUILDER_PROJECTION_DIR_ENV];
      fs.rmSync(scratchProjection, { recursive: true, force: true });
    }
  }
}

async function mainSweep(): Promise<void> {
  // The CLI (golden gate + scheduled sweep) runs the worker-parallel path;
  // the unit suites drive the sequential runReportSweep directly.
  const report = await runReportSweepParallel();
  console.log(report.coverageMarkdown);
  console.log('');
  console.log(`entries=${listArchiveKeys().length} failed=${report.failed.length}`);
  for (const f of report.failed) {
    console.error(`FAILED ${f.key}: ${f.reason}`);
  }
  // Self-guarded: prints the profiling breakdown to stderr only under PERF,
  // and writes the JSON per-run report when PERF_JSON names a path. The worker
  // generators' spans were merged back (perfMerge) as each finished, so the
  // breakdown still accounts for every report.
  perfReport({ entrypoint: 'report-sweep' });
  // Emit the coverage for the workflow to consume (rolling issue + PR body).
  // The workflow's other signals are the shell-captured exit code and git
  // status - no GITHUB_OUTPUT channel is written here.
  if (process.env.COVERAGE_MARKDOWN_FILE) {
    fs.writeFileSync(process.env.COVERAGE_MARKDOWN_FILE, report.coverageMarkdown + '\n');
  }
  if (report.failed.length > 0) {
    process.exitCode = 1;
  }
}

// A report generator running in a worker thread (report-sweep-pool.ts fans them
// out): run the single task named in workerData, then post its perf spans back
// for the orchestrator to merge. A thrown error becomes the worker's 'error'
// event, which the pool turns into a rejection naming the task - so a broken
// generator fails the sweep loudly, never a silent missing report.
function runReportTaskAsWorker(): void {
  const { reportTaskId } = workerData as { reportTaskId: string };
  const task = INDEPENDENT_REPORT_TASKS.find(t => t.id === reportTaskId);
  if (task === undefined) throw new Error(`unknown report task '${reportTaskId}'`);
  task.run();
  parentPort?.postMessage({ perf: perfSnapshot() });
}

// isMainThread is the authoritative gate: a worker's entry module is this file
// too, so it must branch to the task runner BEFORE the import.meta.main CLI
// check (which a worker may also satisfy). In the main thread, main() runs only
// when this module IS the process entry point - importing it (the unit suites)
// has no side effect.
if (!isMainThread) {
  runReportTaskAsWorker();
} else if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
