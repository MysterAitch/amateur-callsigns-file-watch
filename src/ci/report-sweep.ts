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
import { mdCell } from '../shared/markdown.ts';
import { time, perfReport } from '../shared/perf.ts';

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

// Regenerate every committed report and assemble the coverage markdown. The
// change detector is deliberately NOT here: the scheduled workflow's own
// `git status` over reports/ decides whether a PR opens, and the golden gate
// diffs the regeneration against the committed tree - the regeneration only
// has to be deterministic.
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
  // pairwise comparisons. Regenerated wholesale each run; byte-identical
  // regeneration means no git change, so unchanged windows never churn.
  time('reports:quality-reports', () => writeQualityReports(keys, dataQualityFold));

  // The cross-lane value catalogue (issues #43/#223): every distinct value of
  // the tracked fields across both lanes, regenerated and committed here so a
  // PR diff flags vocabulary drift and unexpected values.
  time('reports:value-catalogue', () => writeValueCatalogue());

  // The cross-dataset invariant probes (issue #241): available-pool depletion,
  // the still-absent decomposition and the original-issue-date invariant,
  // joining the FOI lane against the register. Committed so a PR diff is a
  // drift signal. Its own buildDepletion/buildOverlapMatrix spans are recorded
  // internally, so the call is left unwrapped here to keep those figures free
  // of a nesting parent.
  writeCrossDatasetInvariants();

  // The forbidden-suffix history (issues #289/#291): the forbidden list as a
  // first-class dataset category, diffed across every disclosure held and
  // carrying the ever-forbidden union and per-suffix first-known dates.
  // Committed, so a change to the disallowed vocabulary shows up in a PR diff.
  time('reports:forbidden-suffix-history', () => writeForbiddenSuffixHistory());

  // The cross-vintage event-time coherency report (issue #725 S2): the
  // retroactive-revision detector over the S1 event-date claims — mass-update
  // episodes, per-step revision classifications and corroboration depth.
  // Committed so a new vintage shifting the coherency picture is a PR diff.
  time('reports:event-time-coherency', () => writeEventTimeCoherency());

  // The state-at-t reconstruction report (issue #725 S3): the bi-temporal
  // inference engine demonstrated over the real corpus — inference rules,
  // per-kind coverage honesty and the authored worked examples. Committed so
  // a new vintage shifting any answer is a PR diff.
  time('reports:state-at-t', () => writeStateAtTReport());

  // The policy-as-tests invariants report (issue #863): the regulator's stated
  // rules encoded as executable invariants over the ledger — the first being
  // the two-year reservation window (FOI 756622's Reserved definition) tested
  // against every `reserved-until` claim. Committed so a new vintage shifting
  // any policy finding is a PR diff.
  time('reports:policy-invariants', () => writePolicyInvariantsReport());

  // The per-record curiosity index (issue #866): a reference-free rarity score
  // over the newest publication's records, sorted into the most-unusual-records
  // report with each score's component breakdown. Committed, so a publication
  // that shifts which records are unusual shows up in a PR diff. Build side; the
  // reader-facing page follows the #104 conventions.
  time('reports:curiosity-index', () => writeCuriosityIndex());

  // The namespace sequence analytics (issue #864): allocation order (the
  // register's H5), gap structure, issuance-rate curves and a naive
  // series-exhaustion projection per prefix series, folded from the S1
  // allocation-time event claims. Committed so a new vintage shifting the
  // picture is a PR diff.
  time('reports:sequence-analytics', () => writeSequenceAnalytics());

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


function main(): void {
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
    mainSweep();
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

function mainSweep(): void {
  const report = runReportSweep();
  console.log(report.coverageMarkdown);
  console.log('');
  console.log(`entries=${listArchiveKeys().length} failed=${report.failed.length}`);
  for (const f of report.failed) {
    console.error(`FAILED ${f.key}: ${f.reason}`);
  }
  // Self-guarded: prints the profiling breakdown to stderr only under PERF,
  // and writes the JSON per-run report when PERF_JSON names a path.
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

if (import.meta.main) {
  main();
}
