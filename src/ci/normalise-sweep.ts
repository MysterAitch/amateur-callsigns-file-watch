#!/usr/bin/env node

/**
 * Normalise sweep (ADR 0001's final piece): walk every archive entry,
 * dispatch to the entry's source converter by meta.sourceKey, and close the
 * gap between the converter's intended schema version and what each entry
 * has achieved.
 *
 * Properties:
 *  - per-entry independence: one failing entry never blocks the rest, and a
 *    source with no converter yet is reported, not an error;
 *  - true no-ops: byte-identical output touches neither normalised.csv nor
 *    meta.json, so "no diff => no PR" holds for scheduled re-runs;
 *  - honest coverage reporting: the returned markdown table (rendered into
 *    the rolling coverage issue and PR bodies) shows intended-vs-achieved
 *    per entry, including failures and unsupported sources.
 *
 * The workflow wrapper commits whatever changed to a branch and opens a PR;
 * normaliser PRs are always human-reviewed (the cross-entry diff IS the
 * review artefact), never auto-merged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS, type ArchiveMeta, type IgnoredRawLine, calculateContentHash, errorMessage, saveJsonFileSync } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { renderStatsJson, compareStats, markUnprintables, type EntryStats } from '../shared/stats.ts';
import { convertRawCsv, NORMALISED_SCHEMA_VERSION, CANONICAL_COLUMNS, type ConvertResult } from '../sources/ofcom-amateur/normalise.ts';
import { COMPONENT_COLUMNS, loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { writeValueCatalogue } from './value-catalogue.ts';
import { buildQualityReportFold, type PrefixDistributionFold, type MismatchFold, type RegionalIdentifierFold, type CallsignPatternSeriesFold } from './quality-report-fold.ts';
import { writeCrossDatasetInvariants } from './cross-dataset-invariants.ts';
import { writeForbiddenSuffixHistory } from './forbidden-suffix-history.ts';
import { mdCell } from '../shared/markdown.ts';
import { time, perfReport } from '../shared/perf.ts';

interface SourceConverter {
  schemaVersion: number;
  // curatedIgnores: meta.json's hand-curated ignoredLines - an INPUT to
  // conversion (syntactically valid lines a human judged to be export
  // furniture), byte-verified against raw by the converter.
  convert(rawContent: string, referenceDateIso: string, curatedIgnores: IgnoredRawLine[]): ConvertResult;
}

// Converter registry, keyed by meta.sourceKey. Future sources (FOI xlsx via
// the holding pen, etc.) register here.
const CONVERTERS: Record<string, SourceConverter> = {
  [CONSTANTS.SOURCES.OFCOM_AMATEUR]: {
    schemaVersion: NORMALISED_SCHEMA_VERSION,
    convert: (rawContent, referenceDateIso, curatedIgnores) => convertRawCsv(rawContent, { referenceDateIso }, curatedIgnores),
  },
};

// mdCell (markdown table-cell sanitiser) is shared with the other report
// generators; re-exported here so existing importers keep their path.
export { mdCell };

export interface SweepReport {
  changed: string[];
  upToDate: string[];
  unsupported: string[];
  failed: { key: string; reason: string }[];
  coverageMarkdown: string;
}

// ArchiveMeta plus the normalisation declaration this sweep maintains
// (ignoredLines lives on ArchiveMeta itself).
type SweepMeta = ArchiveMeta & {
  normalised?: { schemaVersion: number; headerVariant: string; statsSchemaVersion?: number; componentsSchemaVersion?: number };
};

export function runNormaliseSweep(): SweepReport {
  const report: SweepReport = { changed: [], upToDate: [], unsupported: [], failed: [], coverageMarkdown: '' };
  const coverageRows: string[] = [];

  for (const key of listArchiveKeys()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    const metaPath = path.join(dir, 'meta.json');
    let meta: SweepMeta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SweepMeta;
    } catch (err) {
      report.failed.push({ key, reason: `meta.json unreadable: ${errorMessage(err)}` });
      coverageRows.push(`| ${key} | ? | FAILED | meta.json unreadable |`);
      continue;
    }

    const converter = CONVERTERS[meta.sourceKey];
    if (!converter) {
      report.unsupported.push(key);
      coverageRows.push(`| ${key} | ${meta.sourceKey} | raw-only | no converter for this source yet |`);
      continue;
    }

    // Everything below is inside one try so a single malformed entry (bad
    // meta fields, unreadable raw, converter failure, write error) reports as
    // that entry's failure and never blocks the rest - per-entry independence
    // covers metadata problems, not just converter problems.
    try {
      const referenceDate = meta.ofcomReportedUpdateIso ?? meta.fetchedAt?.slice(0, 10);
      if (!referenceDate) {
        throw new Error('meta.json supplies neither ofcomReportedUpdateIso nor fetchedAt - no plausibility reference date');
      }
      if (typeof meta.files !== 'object' || meta.files === null) {
        throw new Error('meta.json has no files map to declare normalised.csv in');
      }

      const raw = fs.readFileSync(path.join(dir, 'raw.csv'), 'utf8');
      const result: ConvertResult = time('sweep:convert', () => converter.convert(raw, referenceDate, meta.ignoredLines ?? []));

      const outPath = path.join(dir, 'normalised.csv');
      const statsPath = path.join(dir, 'stats.json');
      const componentsPath = path.join(dir, 'components.csv');
      const statsJson = renderStatsJson(result.stats);
      const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : undefined;
      const existingStats = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, 'utf8') : undefined;
      const existingComponents = fs.existsSync(componentsPath) ? fs.readFileSync(componentsPath, 'utf8') : undefined;
      if (existing === result.csv
        && existingStats === statsJson
        && existingComponents === result.componentsCsv
        && meta.normalised?.schemaVersion === result.schemaVersion
        && meta.normalised?.statsSchemaVersion === result.stats.statsSchemaVersion
        && meta.normalised?.componentsSchemaVersion === result.componentsSchemaVersion
        && JSON.stringify(meta.headerLines ?? null) === JSON.stringify(result.headerLines)
        && JSON.stringify(meta.ignoredLines ?? []) === JSON.stringify(result.ignoredLines)) {
        report.upToDate.push(key);
        coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | up to date |`);
        continue;
      }

      time('sweep:write-entry', () => {
        fs.writeFileSync(outPath, result.csv);
        fs.writeFileSync(statsPath, statsJson);
        fs.writeFileSync(componentsPath, result.componentsCsv);
      }, result.recordCount);
      meta.normalised = {
        schemaVersion: result.schemaVersion,
        headerVariant: result.headerVariant,
        statsSchemaVersion: result.stats.statsSchemaVersion,
        componentsSchemaVersion: result.componentsSchemaVersion,
      };
      meta.headerLines = result.headerLines;
      if (result.ignoredLines.length > 0) meta.ignoredLines = result.ignoredLines;
      else delete meta.ignoredLines;
      meta.files['normalised.csv'] = {
        size: Buffer.byteLength(result.csv),
        sha256: calculateContentHash(result.csv),
        format: 'csv',
        columnCount: CANONICAL_COLUMNS.length,
        columnNames: [...CANONICAL_COLUMNS],
        recordCount: result.recordCount,
        sortedBy: 'callsign',
      };
      meta.files['stats.json'] = {
        size: Buffer.byteLength(statsJson),
        sha256: calculateContentHash(statsJson),
        format: 'json',
      };
      meta.files['components.csv'] = {
        size: Buffer.byteLength(result.componentsCsv),
        sha256: calculateContentHash(result.componentsCsv),
        format: 'csv',
        columnCount: COMPONENT_COLUMNS.length,
        columnNames: [...COMPONENT_COLUMNS],
        recordCount: result.recordCount,
        sortedBy: 'callsign',
      };
      saveJsonFileSync(metaPath, meta);
      report.changed.push(key);
      const dateNote = result.unverifiedDateColumns.length === 0
        ? 'all date columns day-first-verified'
        : `UNVERIFIED date-order columns: ${result.unverifiedDateColumns.join(', ')}`;
      const partialNote = meta.intendedCoverage?.complete === false ? '; PARTIAL raw coverage (see meta scopeNotes)' : '';
      coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | updated this run; ${dateNote}${partialNote} |`);
    } catch (err) {
      report.failed.push({ key, reason: errorMessage(err) });
      coverageRows.push(`| ${key} | ${meta.sourceKey} | FAILED | ${mdCell(errorMessage(err))} |`);
    }
  }

  // latest-meta.json mirrors the NEWEST entry's meta byte-for-byte (validated
  // by validateLatestPointers via hash comparison) - if this sweep rewrote
  // the newest entry's meta, the mirror must follow or every derivation PR
  // fails its own data-validation check.
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest !== undefined && report.changed.includes(newest)) {
    fs.copyFileSync(path.join(CONSTANTS.DIRS.archive, newest, 'meta.json'), CONSTANTS.FILES.latestMeta);
  }

  // Committed quality reports (issue #46): reports/{key}.md per entry with
  // stats - the durable, diffable, browsable home for the pattern matrix and
  // pairwise comparisons. Regenerated wholesale each run; byte-identical
  // regeneration means no git change, so unchanged windows never churn.
  time('reports:quality-reports', () => writeQualityReports(keys));

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

  // The newest dataset's matrix always appears, even when no archive entry
  // changed bytes (e.g. a reports-only derivation): the PR body is the
  // does-this-look-right triage surface, and current state belongs on it.
  const newestKey = keys[keys.length - 1];
  const newestBlock: string[] = [];
  if (newestKey !== undefined && !report.changed.includes(newestKey)) {
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

  // The flag/status trend tables ride every sweep PR body (consistency with
  // reports/data-quality.md - same generator, same tables).
  const statsForBody = new Map<string, EntryStats>();
  for (const k of keys) {
    const s = readStats(k);
    if (s) statsForBody.set(k, s);
  }
  const flagBlock = statsForBody.size === 0 ? [] : [
    '',
    '<details>',
    '<summary>Data-quality flags per dataset</summary>',
    '',
    ...flagAggregateTables([...keys].filter(k => statsForBody.has(k)).reverse(), statsForBody),
    '',
    '</details>',
  ];

  report.coverageMarkdown = [
    `Intended schema version per source: ${Object.entries(CONVERTERS).map(([k, c]) => `\`${k}\` → v${c.schemaVersion}`).join(', ')}`,
    '',
    '| entry | source | achieved | note |',
    '|---|---|---|---|',
    ...coverageRows,
    ...changedEntryMatrixMarkdown(report.changed, keys),
    ...newestBlock,
    ...flagBlock,
  ].join('\n');

  return report;
}

// Per-entry reports live under entries/ so future per-dimension drill-downs
// (pattern time-series, prefix/RSL distributions, quality rollups - see the
// follow-up issue) can sit alongside without moving files.
const REPORTS_DIR = 'reports/entries';

function readStats(key: string): EntryStats | undefined {
  const p = path.join(CONSTANTS.DIRS.archive, key, 'stats.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as EntryStats;
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

function isDeclaredIncomplete(key: string): boolean {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(CONSTANTS.DIRS.archive, key, 'meta.json'), 'utf8')) as ArchiveMeta;
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

function windowFor(key: string, keys: string[]): string[] {
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
function writeQualityReports(keys: string[]): void {
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
      '<!-- Generated by the normalise sweep (issue #46); regenerated wholesale, so hand edits are overwritten. -->',
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
  // FOLD (issue #361, migration step 5 + Phase B): the prefix-series distribution,
  // the class-product-mismatch table, the regional-identifier distribution and the
  // callsign-pattern time-series all take their numbers from the raw-keyed claim
  // ledger's T1 parse-attribute tier (prefix_series / implied_class / parse_status
  // / rsl / flag, #406+#422) and the callsign-pattern derived claim. One ledger is
  // materialised here and all four reports fold from it; only the data-quality
  // rollup stays on the legacy stats/components path (it reads callsignQuality
  // detectors the tier does not yet emit — see quality-report-fold.ts / writeQualityRollup).
  const fold = buildQualityReportFold();
  writePatternTimeSeries(keysWithStats, statsByKey, fold.callsignPatterns);
  writeQualityRollup(keysWithStats, statsByKey, fold.mismatches);
  writeComponentDistributions([...keysWithStats].reverse(), fold.prefixes, fold.regionalIdentifiers);
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
  const componentsPath = path.join(CONSTANTS.DIRS.archive, key, 'components.csv');
  if (!fs.existsSync(componentsPath)) return undefined;
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

// The legacy prefix-series distribution, read from components.csv (one row per
// prefix series, non-parsed records under their parse status) — the single
// source of truth for the legacy figures, shared by the fallback path and the
// equivalence oracle's legacy side.
export function legacyPrefixDistribution(columnsNewestFirst: string[]): PrefixDistributionFold {
  const rows = new Map<string, Map<string, number>>();
  const dates: string[] = [];
  const bump = (row: string, key: string): void => {
    const perKey = rows.get(row) ?? new Map<string, number>();
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    rows.set(row, perKey);
  };
  for (const key of columnsNewestFirst) {
    const componentsPath = path.join(CONSTANTS.DIRS.archive, key, 'components.csv');
    if (!fs.existsSync(componentsPath)) continue;
    dates.push(key);
    for (const r of parseCsvRecords(componentsPath)) {
      bump(r.prefix_series !== '' ? `\`${r.prefix_series}\`` : `_(${r.parse_status})_`, key);
    }
  }
  return { dates, rows };
}

// The prefix-series distribution markdown, from whichever source supplied the
// per-label per-date counts (the ledger fold in the sweep, a legacy tally in the
// presentation tests).
export function renderPrefixDistributions(dates: string[], rows: Map<string, Map<string, number>>): string {
  return [
    '# Prefix-series distributions',
    '',
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Records per prefix series per dataset (newest leftmost), from',
    '`components.csv`. Non-parsed records appear as their parse status, so',
    'every record lands in exactly one row. Series semantics:',
    '`reference-data/prefix-formats.csv`.',
    '',
    ...distributionTable(dates, rows, 'prefix series'),
    '',
  ].join('\n');
}

// The legacy regional-identifier distribution, read from components.csv (one row
// per rendered prefix+RSL identifier over PARSED records only) — the single
// source of truth for the legacy figures, shared by the fallback path and the
// equivalence oracle's legacy side. The rendered identifier is the prefix+RSL
// combination (GM, MW, 2E, ...), bare 20/21 for RSL-less intermediates, and an
// aggregate for RSL-less G/M cores (the register stores cores by design).
export function legacyRegionalIdentifierDistribution(columnsNewestFirst: string[]): RegionalIdentifierFold {
  const rows = new Map<string, Map<string, number>>();
  const dates: string[] = [];
  const bump = (row: string, key: string): void => {
    const perKey = rows.get(row) ?? new Map<string, number>();
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    rows.set(row, perKey);
  };
  for (const key of columnsNewestFirst) {
    const componentsPath = path.join(CONSTANTS.DIRS.archive, key, 'components.csv');
    if (!fs.existsSync(componentsPath)) continue;
    dates.push(key);
    for (const r of parseCsvRecords(componentsPath)) {
      if (r.parse_status !== 'parsed') continue;
      if (r.prefix_series.startsWith('2')) {
        // Series names are stored bare (20/21), so the trailing digit is
        // everything after the leading 2.
        bump(r.rsl !== '' ? `\`2${r.rsl}\`` : `\`${r.prefix_series}\` _(bare)_`, key);
      } else if (r.rsl !== '') {
        bump(`\`${r.prefix_series[0]}${r.rsl}\``, key);
      } else {
        bump('_(G/M core, no RSL)_', key);
      }
    }
  }
  return { dates, rows };
}

// The regional-identifier distribution markdown, from whichever source supplied
// the per-label per-date counts (the ledger fold in the sweep, a legacy tally in
// the presentation tests).
export function renderRegionalIdentifiers(dates: string[], rows: Map<string, Map<string, number>>): string {
  return [
    '# Regional-identifier distributions',
    '',
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
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
// FOLD, not re-derive (issue #361, migration step 5 + Phase B): when the folded
// arguments are supplied, both tables' figures come from the raw-keyed claim
// ledger's T1 parse-attribute tier (quality-report-fold.ts) rather than the
// legacy components.csv tally — the prefix table from prefix_series/parse_status,
// the regional table from the same joined to the per-record `rsl` claim (#422).
// Each falls back to its legacy computation (the presentation tests exercise that
// path); the fold reproduces the committed goldens (quality-report-fold.test.ts).
function writeComponentDistributions(columnsNewestFirst: string[], foldedPrefixes?: PrefixDistributionFold, foldedRegional?: RegionalIdentifierFold): void {
  const prefix = foldedPrefixes ?? legacyPrefixDistribution(columnsNewestFirst);
  const regional = foldedRegional ?? legacyRegionalIdentifierDistribution(columnsNewestFirst);
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
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Standing, deterministic views over the archive. Drill-downs:',
    '',
    '- [Callsign patterns](callsign-patterns.md) - full pattern time-series',
    '- [Prefix-series distributions](prefixes.md)',
    '- [Regional-identifier distributions](regional-identifiers.md)',
    '- [Data-quality rollup](data-quality.md) - defect detectors, flags, parse statuses',
    '- [Class-product mismatches](class-product-mismatches.md) - standing table of every affected row',
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
// NOT folded from the ledger yet (issue #361, migration step 5), for two
// reasons. (1) The defect-detector table reads callsignQuality signals the T1
// parse-attribute tier does not emit — the cross-row `postNormalisationDuplicates`
// (the stripped-collision, which needs the whole register in view) and the
// character detectors (excel-date-shape, encoding-failure, whitespace-bearing,
// lowercase-bearing, empty); folding it from T1 alone would silently drop those
// real findings. (2) The Component-parse flags and Parse statuses sub-tables ARE
// T1-derivable, but flagAggregateTables emits them BYTE-IDENTICALLY into the
// sweep PR body too, and that consistency contract means a partial fold of one
// copy would desync the surfaces — so this report migrates wholesale once those
// higher-tier quality signals emit as their own claims, not piecemeal. The
// class-product-mismatch table below IS folded (its flag is a T1 claim).
function writeQualityRollup(keys: string[], statsByKey: Map<string, EntryStats>, foldedMismatches?: MismatchFold): void {
  const columns = [...keys].reverse();
  const detectors = [
    ['excelDateShaped', 'Excel-date-shaped callsigns'],
    ['encodingFailure', 'encoding-failure characters'],
    ['whitespaceBearing', 'whitespace/invisible-bearing'],
    ['postNormalisationDuplicates', 'post-normalisation duplicates'],
    ['emptyCallsign', 'empty callsigns'],
    ['lowercaseBearing', 'lowercase-bearing'],
  ] as const;

  const countRow = (detector: (typeof detectors)[number][0], label: string): string =>
    `| ${label} | ${columns.map(k => statsByKey.get(k)?.callsignQuality?.[detector].count ?? '—').join(' | ')} |`;

  const exampleSections = detectors.flatMap(([detector, label]) => {
    const rows = columns.flatMap((k) => {
      const result = statsByKey.get(k)?.callsignQuality?.[detector];
      if (!result || result.count === 0) return [];
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

  const lines = [
    '# Data-quality rollup (callsign defect detectors)',
    '',
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
    'Automated per-publication counts for defect classes observed in real',
    'exports. Rows are detectors, columns are datasets (newest leftmost).',
    'A class appearing or vanishing between publications is a pipeline-change',
    'signal in its own right.',
    '',
    `| detector | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    `| _records_ | ${columns.map(k => statsByKey.get(k)?.recordCount ?? '—').join(' | ')} |`,
    ...detectors.map(([detector, label]) => countRow(detector, label)),
    '',
    ...flagAggregateTables(columns, statsByKey),
    ...exampleSections,
    '',
  ];
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'data-quality.md'), withCharacterKey(lines).join('\n'));

  writeMismatchReport(columns, foldedMismatches);
}

// Component-parse aggregates (flag vocabulary: reference-data/flags.md):
// one row per flag/status observed anywhere in the archive, so a class
// appearing or disappearing between publications is a visible trend line.
// Shared between the committed rollup and sweep PR bodies - the same table
// on every surface (consistency review).
function flagAggregateTables(columnsNewestFirst: string[], statsByKey: Map<string, EntryStats>): string[] {
  const columns = columnsNewestFirst;
  const unionKeysOf = (pick: (s: EntryStats) => Record<string, number>): string[] =>
    [...new Set(columns.flatMap(k => Object.keys(pick(statsByKey.get(k) as EntryStats) ?? {})))].sort();
  const aggregateRows = (pick: (s: EntryStats) => Record<string, number>): string[] =>
    unionKeysOf(pick).map(name =>
      `| \`${name}\` | ${columns.map(k => pick(statsByKey.get(k) as EntryStats)?.[name] ?? 0).join(' | ')} |`);
  return [
    '## Component-parse flags',
    '',
    'Per-row flags from `components.csv` (vocabulary and semantics:',
    '`reference-data/flags.md` - notably, `forbidden-suffix` is mostly',
    'long-standing allocations, not an anomaly by itself).',
    '',
    `| flag | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...aggregateRows(s => s.callsignFlags ?? {}),
    '',
    '## Parse statuses',
    '',
    `| status | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---:').join('|')}|`,
    ...aggregateRows(s => s.parseStatuses ?? {}),
  ];
}

// The class-product-mismatch rows are few enough to publish in full: a
// standing, hand-reviewable table of every register row whose prefix-implied
// licence class disagrees with its product column. Causes are unknown -
// plausibly issuance-time input errors, plausibly legitimate arrangements
// not publicly stated (e.g. permission to use a deceased relative's callsign
// at the holder's own licence level) - the table records the discrepancy,
// not a verdict.
// One per-dataset mismatch section's rows, in the shape common to the legacy
// computation and the ledger fold (quality-report-fold.ts).
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
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
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

// The legacy per-dataset mismatch sections, read from components.csv joined to
// normalised.csv by callsign — factored out so it is both the fallback for the
// presentation tests and the equivalence oracle's legacy side.
export function legacyMismatchSections(columnsNewestFirst: string[]): MismatchSection[] {
  const sections: MismatchSection[] = [];
  for (const key of columnsNewestFirst) {
    const componentsPath = path.join(CONSTANTS.DIRS.archive, key, 'components.csv');
    const normalisedPath = path.join(CONSTANTS.DIRS.archive, key, 'normalised.csv');
    if (!fs.existsSync(componentsPath) || !fs.existsSync(normalisedPath)) continue;
    const components = parseCsvRecords(componentsPath);
    const productByCallsign = new Map(parseCsvRecords(normalisedPath).map(r => [r.callsign, r.product]));
    const rows = components
      .filter(r => r.flags.split(';').includes('class-product-mismatch'))
      .map(r => ({ callsign: r.callsign, prefixSeries: r.prefix_series, impliedClass: r.implied_class, product: productByCallsign.get(r.callsign) ?? '' }));
    sections.push({ key, rows });
  }
  return sections;
}

// FOLD, not re-derive (issue #361, migration step 5): when `foldedMismatches` is
// supplied, the sections come from the raw-keyed claim ledger's T1 tier — the
// class-product-mismatch `flag` claim joined to the observation's prefix_series /
// implied_class derived claims and its raw product cell — rather than the legacy
// components.csv/normalised.csv join. The ofcom-amateur normaliser copies the
// callsign verbatim and is row-preserving, so the fold parses the same token over
// the same rows and reproduces the committed golden (quality-report-fold.test.ts).
function writeMismatchReport(columnsNewestFirst: string[], foldedMismatches?: MismatchFold): void {
  const sections = foldedMismatches !== undefined
    ? foldedMismatches.dates.map(date => ({ key: date, rows: foldedMismatches.byDate.get(date) ?? [] }))
    : legacyMismatchSections(columnsNewestFirst);
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'class-product-mismatches.md'), renderMismatchReport(sections));
}

function parseCsvRecords(filePath: string): Record<string, string>[] {
  return parse(fs.readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

// The legacy callsign-pattern time-series, read from stats.json's callsignPatterns
// (one bucket per character-shape, per dataset) — the single source of truth for
// the legacy figures, shared by the fallback path (the presentation tests) and
// the equivalence oracle's legacy side. Keys stay CHRONOLOGICAL (oldest-first):
// the renderer reverses to newest-first. recordCount rides straight from stats;
// it equals the sum of the pattern buckets (every row lands in exactly one),
// which is what the fold reconstructs from the @listed anchors.
export function legacyCallsignPatternSeries(keys: string[], statsByKey: Map<string, EntryStats>): CallsignPatternSeriesFold {
  const recordCounts = new Map<string, number>();
  const patterns = new Map<string, Map<string, number>>();
  for (const k of keys) {
    const stats = statsByKey.get(k);
    if (stats === undefined) continue;
    recordCounts.set(k, stats.recordCount);
    patterns.set(k, new Map(Object.entries(stats.callsignPatterns)));
  }
  return { keys: [...keys], recordCounts, patterns };
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
    '<!-- Generated by the normalise sweep (issue #51); regenerated wholesale, so hand edits are overwritten. -->',
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
// pattern claim when supplied and falling back to the legacy stats tally
// otherwise (the presentation tests exercise the fallback).
function writePatternTimeSeries(keys: string[], statsByKey: Map<string, EntryStats>, foldedSeries?: CallsignPatternSeriesFold): void {
  const series = foldedSeries ?? legacyCallsignPatternSeries(keys, statsByKey);
  fs.writeFileSync(path.join(REPORTS_DIR, '..', 'callsign-patterns.md'), renderCallsignPatternSeries(series));
}

// PR-body/dashboard guidance for changed entries: the window matrix and RSL
// matrix folded behind details blocks per entry (the committed reports/
// files carry the full report; this is the "in addition" inline view for
// reviewers triaging whether the proposed dataset/normalisation looks
// valid). Anomaly signals - unexpected locators - stay OUTSIDE the details
// so they are visible without expanding anything.
function changedEntryMatrixMarkdown(changed: string[], keys: string[]): string[] {
  const statsByKey = new Map<string, EntryStats>();
  for (const k of keys) {
    const s = readStats(k);
    if (s) statsByKey.set(k, s);
  }
  const lines: string[] = [];
  for (const key of changed) {
    if (!statsByKey.has(key)) continue;
    const window = windowFor(key, keys).filter(k => statsByKey.has(k));
    const matrix = rslMatrix(key);
    lines.push(
      '',
      `${key}: see \`reports/${key}.md\` for the full quality report.`,
      ...(matrix !== undefined && matrix.unexpectedNote !== ''
        ? ['', `⚠ ${key} contains locators absent from reference data: ${matrix.unexpectedNote}.`]
        : []),
      '',
      '<details>',
      `<summary>Pattern counts across window: ${key}</summary>`,
      '',
      ...matrixTable(key, window, statsByKey),
      '',
      '</details>',
      ...(matrix !== undefined
        ? [
          '',
          '<details>',
          `<summary>RSL matrix: ${key}</summary>`,
          '',
          ...matrix.lines,
          '</details>',
        ]
        : []),
    );
  }
  return lines;
}

function main(): void {
  const report = runNormaliseSweep();
  console.log(report.coverageMarkdown);
  console.log('');
  console.log(`changed=${report.changed.length} upToDate=${report.upToDate.length} unsupported=${report.unsupported.length} failed=${report.failed.length}`);
  for (const f of report.failed) {
    console.error(`FAILED ${f.key}: ${f.reason}`);
  }
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
  // Emit the summary for the workflow to consume (rolling issue + PR body).
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
