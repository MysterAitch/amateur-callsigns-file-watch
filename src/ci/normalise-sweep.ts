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
import { CONSTANTS, ArchiveMeta, calculateContentHash, saveJsonFileSync } from '../shared/utils';
import { listArchiveKeys } from '../shared/archive';
import { renderStatsJson, compareStats, EntryStats } from '../shared/stats';
import { convertRawCsv, NORMALISED_SCHEMA_VERSION, CANONICAL_COLUMNS, ConvertResult } from '../sources/ofcom-amateur/normalise';

interface SourceConverter {
  schemaVersion: number;
  convert(rawContent: string, referenceDateIso: string): ConvertResult;
}

// Converter registry, keyed by meta.sourceKey. Future sources (FOI xlsx via
// the holding pen, etc.) register here.
const CONVERTERS: Record<string, SourceConverter> = {
  [CONSTANTS.SOURCES.OFCOM_AMATEUR]: {
    schemaVersion: NORMALISED_SCHEMA_VERSION,
    convert: (rawContent, referenceDateIso) => convertRawCsv(rawContent, { referenceDateIso }),
  },
};

// Sanitise arbitrary text (error messages can quote raw CSV content) for use
// inside a one-line markdown table cell. Truncate FIRST, then escape
// backslashes, then pipes, then collapse newlines - truncating escaped output
// could bisect a two-character escape and leave a dangling backslash that
// escapes the closing cell delimiter; and backslashes must be escaped before
// pipes or the pipe-escaping is itself neutralised.
export function mdCell(text: string, maxLength = 160): string {
  return String(text)
    .slice(0, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export interface SweepReport {
  changed: string[];
  upToDate: string[];
  unsupported: string[];
  failed: { key: string; reason: string }[];
  coverageMarkdown: string;
}

export function runNormaliseSweep(): SweepReport {
  const report: SweepReport = { changed: [], upToDate: [], unsupported: [], failed: [], coverageMarkdown: '' };
  const coverageRows: string[] = [];

  for (const key of listArchiveKeys()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    const metaPath = path.join(dir, 'meta.json');
    let meta: ArchiveMeta & { normalised?: { schemaVersion: number; headerVariant: string; statsSchemaVersion?: number } };
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (err: any) {
      report.failed.push({ key, reason: `meta.json unreadable: ${err.message}` });
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
      const result: ConvertResult = converter.convert(raw, referenceDate);

      const outPath = path.join(dir, 'normalised.csv');
      const statsPath = path.join(dir, 'stats.json');
      const statsJson = renderStatsJson(result.stats);
      const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : undefined;
      const existingStats = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, 'utf8') : undefined;
      if (existing === result.csv
        && existingStats === statsJson
        && meta.normalised?.schemaVersion === result.schemaVersion
        && meta.normalised?.statsSchemaVersion === result.stats.statsSchemaVersion) {
        report.upToDate.push(key);
        coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | up to date |`);
        continue;
      }

      fs.writeFileSync(outPath, result.csv);
      fs.writeFileSync(statsPath, statsJson);
      meta.normalised = {
        schemaVersion: result.schemaVersion,
        headerVariant: result.headerVariant,
        statsSchemaVersion: result.stats.statsSchemaVersion,
      };
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
      saveJsonFileSync(metaPath, meta);
      report.changed.push(key);
      const dateNote = result.unverifiedDateColumns.length === 0
        ? 'all date columns day-first-verified'
        : `UNVERIFIED date-order columns: ${result.unverifiedDateColumns.join(', ')}`;
      const partialNote = meta.intendedCoverage?.complete === false ? '; PARTIAL raw coverage (see meta scopeNotes)' : '';
      coverageRows.push(`| ${key} | ${meta.sourceKey} | v${result.schemaVersion} (${result.headerVariant}) | updated this run; ${dateNote}${partialNote} |`);
    } catch (err: any) {
      report.failed.push({ key, reason: err.message });
      coverageRows.push(`| ${key} | ${meta.sourceKey} | FAILED | ${mdCell(err.message)} |`);
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
  writeQualityReports(keys);

  report.coverageMarkdown = [
    `Intended schema version per source: ${Object.entries(CONVERTERS).map(([k, c]) => `\`${k}\` → v${c.schemaVersion}`).join(', ')}`,
    '',
    '| entry | source | achieved | note |',
    '|---|---|---|---|',
    ...coverageRows,
    ...changedEntryMatrixMarkdown(report.changed, keys),
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

// Pattern x dataset matrix over the window: one row per pattern (union across
// the window), one column per dataset, current entry bolded. Absence is '—',
// distinct from a zero count. First row carries record counts.
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
  const cell = (k: string, value: string): string => (k === key ? `**${value}**` : value);
  const rows = [
    `| pattern | ${header.join(' | ')} |`,
    `|---|${window.map(() => '---:').join('|')}|`,
    `| _records_ | ${window.map(k => cell(k, String(statsByKey.get(k)?.recordCount ?? '—'))).join(' | ')} |`,
    ...patterns.map(p =>
      `| \`${mdCell(p, 40)}\` | ${window
        .map(k => {
          const count = statsByKey.get(k)?.callsignPatterns[p];
          return cell(k, count === undefined ? '—' : String(count));
        })
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
    patterns.length === 0 ? '—' : mdCell(patterns.slice(0, 5).map(p => `\`${p}\``).join(', ') + (patterns.length > 5 ? ` (+${patterns.length - 5} more)` : ''), 250);

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
      'Generated by the normalise sweep (issue #46) - do not edit by hand.',
      '',
      `${stats.recordCount} records, ${ownPatterns.length} distinct callsign patterns.`,
      '',
      '## Callsign patterns',
      '',
      '| pattern | count |',
      '|---|---:|',
      ...ownPatterns.map(([p, c]) => `| \`${mdCell(p, 40)}\` | ${c} |`),
      '',
      '## Pattern counts across window',
      '',
      ...matrixTable(key, window, statsByKey),
      '',
      '## Pairwise comparison',
      '',
      '| neighbour | records | Δ records | patterns gained vs neighbour | patterns lost vs neighbour |',
      '|---|---:|---:|---|---|',
      ...(pairwise.length > 0 ? pairwise : ['| (no neighbours with stats) | — | — | — | — |']),
      '',
    ];
    fs.writeFileSync(path.join(REPORTS_DIR, `${key}.md`), lines.join('\n'));
  }
}

// PR-body/dashboard guidance for changed entries: the window matrix folded
// behind a details block per entry (the committed reports/ files carry the
// full report; this is the "in addition" inline view for reviewers).
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
    lines.push(
      '',
      `${key}: see \`reports/${key}.md\` for the full quality report.`,
      '',
      '<details>',
      `<summary>Pattern counts across window: ${key}</summary>`,
      '',
      ...matrixTable(key, window, statsByKey),
      '',
      '</details>',
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

if (require.main === module) {
  main();
}
