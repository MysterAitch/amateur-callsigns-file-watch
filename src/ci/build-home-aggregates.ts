#!/usr/bin/env node

/**
 * Pre-renders the statistics page's aggregate blocks - the
 * primary-by-secondary locator matrix and the
 * data-quality-flags-per-publication table - as static HTML injected into
 * the deployed statistics.html.
 *
 * These blocks are deterministic per deploy (they summarise committed
 * data), so statistics.html is FULLY static - no scripts at all, which
 * also makes archived captures of it complete. The home page carries only
 * the interactive lookup. The HTML shapes mirror app.js's renderTable
 * conventions so both pages look alike.
 *
 * Usage: node src/ci/build-home-aggregates.ts <path-to-statistics.html>
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { type EntryStats } from '../shared/stats.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Invisible characters explode to {U+XXXX} markers wherever they sit -
// the same convention as app.js and the reports.
function explode(value: string): string {
  return [...value].map(ch =>
    /[\p{C}\p{Z}]/u.test(ch)
      ? `{U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`
      : ch).join('');
}

// Mirrors app.js renderTable: thead/tbody, 'num' class from numericFrom,
// wrapped in div.overflow.
function tableHtml(headers: string[], rows: (string | number)[][], numericFrom = 1): string {
  const th = headers.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(h)}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${row.map((c, i) => `<td${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('\n');
  return `<div class="overflow"><table><thead><tr>${th}</tr></thead>\n<tbody>${body}</tbody></table></div>`;
}

function readCsv(filePath: string): Record<string, string>[] {
  return parse(fs.readFileSync(filePath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
}

// The data-quality-flags-per-publication table: one column per archived
// dataset (newest first), a records row, then per-flag counts - the same
// pivot app.js built from the datasets/stats_flags tables.
export function renderFlagsTableHtml(): string {
  const keys = listArchiveKeys().sort().reverse();
  const datasets: { key: string; recordCount: number; flags: Record<string, number> }[] = [];
  for (const key of keys) {
    const statsPath = path.join(CONSTANTS.DIRS.archive, key, 'stats.json');
    if (!fs.existsSync(statsPath)) continue;
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as EntryStats;
    datasets.push({ key, recordCount: stats.recordCount, flags: stats.callsignFlags ?? {} });
  }
  const flagNames = [...new Set(datasets.flatMap(d => Object.keys(d.flags)))].sort();
  return tableHtml(
    ['flag', ...datasets.map(d => d.key)],
    [
      ['records', ...datasets.map(d => d.recordCount)],
      ...flagNames.map(flag => [flag, ...datasets.map(d => d.flags[flag] ?? 0)]),
    ],
  );
}

// The primary-by-secondary locator matrix over the LATEST dataset's
// components, with the same elaborations as the dynamic path: reference-
// driven rows/columns (absences visible), ⚠ for observed-but-unreferenced
// locators, · for zero, exclusion caption, and details blocks enumerating
// the small interesting populations.
export function renderRslMatrixHtml(): string {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) throw new Error('no archive entries found');
  const components = readCsv(path.join(CONSTANTS.DIRS.archive, newest, 'components.csv'));

  const refSeries = readCsv(path.join(REFERENCE_DATA_DIR, 'prefix-formats.csv')).map(r => r.prefix);
  const refRsl = readCsv(path.join(REFERENCE_DATA_DIR, 'rsl.csv')).map(r => r.rsl).sort();

  const counts = new Map<string, number>();
  const excluded = new Map<string, number>();
  const excludedExamples = new Map<string, string[]>();
  const bearing: { callsign: string; series: string; rsl: string }[] = [];
  for (const row of components) {
    if (row.parse_status !== 'parsed') {
      excluded.set(row.parse_status, (excluded.get(row.parse_status) ?? 0) + 1);
      const examples = excludedExamples.get(row.parse_status) ?? [];
      examples.push(row.callsign);
      excludedExamples.set(row.parse_status, examples);
      continue;
    }
    counts.set(`${row.prefix_series}|${row.rsl}`, (counts.get(`${row.prefix_series}|${row.rsl}`) ?? 0) + 1);
    if (row.rsl !== '') bearing.push({ callsign: row.callsign, series: row.prefix_series, rsl: row.rsl });
  }

  const observedSeries = [...new Set([...counts.keys()].map(k => k.split('|')[0]))];
  const observedRsl = [...new Set([...counts.keys()].map(k => k.split('|')[1]).filter(r => r !== ''))];
  const seriesRows = [...new Set([...refSeries, ...observedSeries])].sort((a, b) => a.localeCompare(b));
  const unknownRsl = observedRsl.filter(r => !refRsl.includes(r)).sort((a, b) => a.localeCompare(b));
  const columns = [...refRsl, ...unknownRsl, ''];

  const count = (series: string, rsl: string): number => counts.get(`${series}|${rsl}`) ?? 0;
  const quiet = (n: number): string | number => (n === 0 ? '·' : n);
  const rows: (string | number)[][] = seriesRows.map(series => [
    refSeries.includes(series) ? series : `${series} ⚠`,
    ...columns.map(rsl => quiet(count(series, rsl))),
    quiet(columns.reduce((sum, rsl) => sum + count(series, rsl), 0)),
  ]);
  let total = 0;
  for (const n of counts.values()) total += n;
  rows.push([
    'total',
    ...columns.map(rsl => quiet(seriesRows.reduce((sum, s) => sum + count(s, rsl), 0))),
    quiet(total),
  ]);

  const excludedEntries = [...excluded.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const excludedText = excludedEntries.length === 0 ? 'none'
    : excludedEntries.map(([status, n]) => `${n} ${status}`).join(', ');

  const details: string[] = [];
  bearing.sort((a, b) => a.callsign.localeCompare(b.callsign));
  if (bearing.length > 0 && bearing.length <= 50) {
    details.push(`<details><summary>RSL-bearing records (${bearing.length})</summary>`
      + tableHtml(['callsign', 'series', 'RSL'], bearing.map(r => [explode(r.callsign), r.series, r.rsl]), 99)
      + '</details>');
  }
  for (const [status, n] of excludedEntries) {
    if (n === 0 || n > 50) continue;
    const examples = (excludedExamples.get(status) ?? []).sort((a, b) => a.localeCompare(b)).map(explode);
    details.push(`<details><summary>Excluded: ${escapeHtml(status)} (${n})</summary>`
      + `<p class="mono">${escapeHtml(examples.join(', '))}</p></details>`);
  }

  return tableHtml(['series', ...refRsl, ...unknownRsl.map(r => `${r} ⚠`), '(none)', 'total'], rows, 1)
    + `<p class="muted">Excluded from this table: ${escapeHtml(excludedText)}.</p>`
    + details.join('\n');
}

const PLACEHOLDER_TEXT = 'generated at deploy time — build the site to populate';

// Injects both blocks into the deployed statistics.html. Fails loudly if
// the placeholders drift - a silent miss would publish the placeholder
// text instead of the statistics, misleadingly.
export function injectHomeAggregates(statisticsPath: string): void {
  let html = fs.readFileSync(statisticsPath, 'utf8');
  const replacements: [string, string][] = [
    [`<div id="rsl-matrix-table">${PLACEHOLDER_TEXT}</div>`, `<div id="rsl-matrix-table" data-prerendered>${renderRslMatrixHtml()}</div>`],
    [`<div id="flags-table">${PLACEHOLDER_TEXT}</div>`, `<div id="flags-table" data-prerendered>${renderFlagsTableHtml()}</div>`],
  ];
  for (const [placeholder, replacement] of replacements) {
    if (!html.includes(placeholder)) throw new Error(`placeholder not found in ${statisticsPath}: ${placeholder}`);
    html = html.replace(placeholder, replacement);
  }
  fs.writeFileSync(statisticsPath, html);
}

function main(): void {
  const [indexPath] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!indexPath) {
    console.error('usage: node src/ci/build-home-aggregates.ts <path-to-index.html>');
    process.exitCode = 1;
    return;
  }
  injectHomeAggregates(indexPath);
  console.log(`home aggregates pre-rendered into ${indexPath}`);
}

if (import.meta.main) {
  main();
}
