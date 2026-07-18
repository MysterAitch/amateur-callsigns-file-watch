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
import { DIRS } from '../shared/constants.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import {
  type EntryStats,
  type StringColumnStats,
  type DateColumnStats,
  type CallsignQuality,
} from '../shared/stats.ts';
import { humanDate, monthYear, humaniseLabel, tableCaption, callsignField, callsignDisplay, prefixSeriesField } from './site-render.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const REFERENCE_DATA_DIR = path.join(REPO_ROOT, 'reference-data');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mirrors app.js renderTable: thead/tbody, 'num' class from numericFrom,
// wrapped in div.overflow. rawHeaders lets a caller pass pre-built header
// HTML (the flags table links its dataset-date columns to entry pages);
// rawColumns does the same for specific body-cell columns by index (the
// matrix links its series rows to their entity pages via the shared
// prefix-series field wrapper, #644; the RSL-bearing details table pre-renders
// both its callsign AND series cells this way).
// rowHeader emits the first cell of each body row as a <th scope="row"> so a
// screen reader can resolve which row (e.g. which prefix series) a data cell
// belongs to - essential for the 2-D locator matrix.
function tableHtml(caption: string, headers: string[], rows: (string | number)[][], numericFrom = 1, rawHeaders = false, rawColumns: ReadonlySet<number> = new Set(), rowHeader = false): string {
  const th = headers.map((h, i) => `<th scope="col"${i >= numericFrom ? ' class="num"' : ''}>${rawHeaders ? h : escapeHtml(h)}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${row.map((c, i) => {
      const numeric = i >= numericFrom;
      let content = rawColumns.has(i) ? String(c) : escapeHtml(String(c));
      // A numeric cell whose content is exactly "0" de-emphasises (issue
      // #731) - fires for a raw or escaped column alike, since escaping a
      // bare zero is a no-op; a pre-built raw fragment (a link, a bar) is
      // never literally the string "0" so this never mismatches one.
      if (numeric && content.trim() === '0') content = `<span class="zero">${content}</span>`;
      const cls = numeric ? ' class="num"' : '';
      return rowHeader && i === 0 ? `<th scope="row"${cls}>${content}</th>` : `<td${cls}>${content}</td>`;
    }).join('')}</tr>`).join('\n');
  return `<div class="overflow"><table>${tableCaption(caption)}<thead><tr>${th}</tr></thead>\n<tbody>${body}</tbody></table></div>`;
}

// A richer sibling of tableHtml for the latest-publication statistics
// blocks: per-column definitions rather than positional booleans, so a
// column can be numeric (right-aligned tabular-nums), carry pre-built raw
// HTML (a monospace pattern cell, a decorative bar), or be a scoped row
// header. Same div.overflow > thead/tbody shape and the same scoped-header
// accessibility as tableHtml, so every table on the page reads alike.
interface ColumnDef {
  label: string;
  num?: boolean;
  raw?: boolean;
  rowHeader?: boolean;
}

function dataTable(caption: string, columns: ColumnDef[], rows: (string | number)[][]): string {
  const th = columns.map(c => `<th scope="col"${c.num ? ' class="num"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${row.map((cell, i) => {
      const c = columns[i];
      let content = c.raw ? String(cell) : escapeHtml(String(cell));
      // See tableHtml above: a numeric cell that is exactly "0" mutes
      // (issue #731), whether raw or escaped.
      if (c.num === true && content.trim() === '0') content = `<span class="zero">${content}</span>`;
      const cls = c.num ? ' class="num"' : '';
      return c.rowHeader ? `<th scope="row"${cls}>${content}</th>` : `<td${cls}>${content}</td>`;
    }).join('')}</tr>`).join('\n');
  return `<div class="overflow"><table>${tableCaption(caption)}<thead><tr>${th}</tr></thead>\n<tbody>${body}</tbody></table></div>`;
}

// A whole-number percentage share, humanised at the extremes: an exact zero
// stays "0%", a non-zero that rounds to nothing becomes "<1%" (never a
// misleading "0%"), and an undefined denominator degrades to an em dash.
function sharePct(n: number, total: number): string {
  if (total <= 0) return '—';
  if (n === 0) return '0%';
  const p = Math.round((n / total) * 100);
  return p === 0 ? '<1%' : `${p}%`;
}

// A fixed-width proportion bar drawn from block glyphs (full ▁ light). It is
// decorative - the count and percentage always sit beside it - so callers
// wrap it aria-hidden; it renders identically on a fully static page and in
// an archived capture, no CSS required.
function asciiBar(value: number, max: number, width = 18): string {
  if (max <= 0 || value <= 0) return '';
  const filled = Math.min(width, Math.max(1, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// The newest open-data publication's parsed stats.json, with its archive key
// (a publication date). All the latest-publication blocks below derive from
// this one file - the same figures stats.json commits, now rendered.
function newestStats(): { key: string; stats: EntryStats } {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) throw new Error('no archive entries found');
  const statsPath = derivedEntryFile(newest, 'stats.json');
  const stats = parseJsonObject(fs.readFileSync(statsPath, 'utf8'), statsPath) as EntryStats;
  return { key: newest, stats };
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
    if (!derivedEntryFileExists(key, 'stats.json')) continue;
    const statsPath = derivedEntryFile(key, 'stats.json');
    const stats = parseJsonObject(fs.readFileSync(statsPath, 'utf8'), statsPath) as EntryStats;
    datasets.push({ key, recordCount: stats.recordCount, flags: stats.callsignFlags ?? {} });
  }
  const flagNames = [...new Set(datasets.flatMap(d => Object.keys(d.flags)))].sort();
  // Each dataset column header links straight to that publication's entry
  // page - the aggregate connects to its provenance in one click.
  return tableHtml(
    'Data-quality flag counts for every archived open-data publication, newest first',
    ['flag', ...datasets.map(d => `<a href="datasets/open-data/${d.key}/index.html">${d.key}</a>`)],
    [
      ['records', ...datasets.map(d => d.recordCount)],
      ...flagNames.map(flag => [flag, ...datasets.map(d => d.flags[flag] ?? 0)]),
    ],
    1,
    true,
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
  const components = readCsv(derivedEntryFile(newest, 'components.csv'));

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
  // Series row labels link to their entity pages via the shared prefix-series
  // field wrapper (#644; statistics.html sits at the site root, so series/ is
  // a sibling directory). Honest here because both describe the LATEST
  // publication; the per-entry historical matrices deliberately stay unlinked.
  const rows: (string | number)[][] = seriesRows.map(series => [
    `${prefixSeriesField(series, { link: { depthToRoot: 0 } })}${refSeries.includes(series) ? '' : ' <abbr title="observed in the register but absent from reference data">⚠</abbr>'}`,
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
    // Each callsign routes through the shared field wrapper (#553) as a
    // register-lookup pill (statistics.html sits at the site root); its odd
    // characters follow the wrapper's shared marking convention. Its series
    // routes through the shared prefix-series field wrapper (#644), unlinked -
    // this row is ABOUT the series column already shown in the matrix above,
    // so a second link to the same page would be redundant, not a new
    // affordance (the same reasoning ./render/licence.ts gives for not
    // auto-linking a value already explained by its section heading).
    details.push(`<details><summary>RSL-bearing records (${bearing.length})</summary>`
      + tableHtml('Records carrying a Regional Secondary Locator in the latest publication', ['callsign', 'series', 'RSL'], bearing.map(r => [callsignField(r.callsign, { lookup: { depthToRoot: 0 } }), prefixSeriesField(r.series), r.rsl]), 99, false, new Set([0, 1]))
      + '</details>');
  }
  for (const [status, n] of excludedEntries) {
    if (n === 0 || n > 50) continue;
    // These enumerations exist to expose the values a parse set aside, so
    // odd-character marking is REQUIRED here and pinned explicitly (the #553
    // drift-guard rule) rather than left to the wrapper's movable default.
    // Deliberately no lookup link: a set-aside value is data to inspect, not
    // a navigation target.
    const examples = (excludedExamples.get(status) ?? []).sort((a, b) => a.localeCompare(b))
      .map(c => callsignField(c, { oddCharacters: 'marked' }));
    details.push(`<details><summary>Excluded: ${escapeHtml(status)} (${n})</summary>`
      + `<p>${examples.join(', ')}</p></details>`);
  }

  return tableHtml('Callsign counts by prefix series and Regional Secondary Locator in the latest publication', ['series', ...refRsl, ...unknownRsl.map(r => `${escapeHtml(r)} <abbr title="observed in the register but absent from reference data">⚠</abbr>`), '(none)', 'total'], rows, 1, true, new Set([0]), true)
    + `<p class="muted">In the series column, # marks where the Regional Secondary Locator sits when one is present; (none) = no RSL letter stored on the row — each series links to its own page. Excluded from this table: ${escapeHtml(excludedText)} (populations over 50 are not enumerated below).</p>`
    + details.join('\n');
}

// Latest publication at a glance: the headline record count, the
// syntactic-emptiness split (recordCount = nonEmptyRecords + emptyRecords),
// the publisher's DECLARED coverage (intent, never independently verified),
// and the parse-status breakdown - a distribution the parser assigns to
// every row, not a bare total.
export function renderLatestProfileHtml(): string {
  const { key, stats } = newestStats();
  const metaPath = path.join(DIRS.archive, key, 'meta.json');
  const meta = fs.existsSync(metaPath)
    ? parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as { intendedCoverage?: { complete?: boolean } }
    : {};
  const complete = meta.intendedCoverage?.complete;
  const coverageText = complete === undefined ? 'not declared'
    : complete ? 'complete — declared by the publisher, not independently verified'
      : 'partial — declared by the publisher';
  const total = stats.recordCount;

  const glance = dataTable(
    'The latest publication at a glance',
    [{ label: 'measure', rowHeader: true }, { label: 'value', raw: true }],
    [
      // Month precision (#551): this headline names ONE publication (the
      // newest), never a list, so there is no disambiguation to earn a full
      // date - the exact key is already the visible link text regardless.
      ['Publication', `<a href="datasets/open-data/${key}/index.html">${escapeHtml(key)}</a> (${escapeHtml(monthYear(key))})`],
      ['Records', total.toLocaleString('en-GB')],
      ['Non-empty records', `${stats.nonEmptyRecords.toLocaleString('en-GB')} (${sharePct(stats.nonEmptyRecords, total)})`],
      ['Empty records', stats.emptyRecords === 0 ? 'none' : `${stats.emptyRecords.toLocaleString('en-GB')} (${sharePct(stats.emptyRecords, total)})`],
      ['Declared coverage', escapeHtml(coverageText)],
    ],
  );

  const statuses = Object.entries(stats.parseStatuses).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maxStatus = Math.max(1, ...statuses.map(([, n]) => n));
  const statusRows: (string | number)[][] = statuses.map(([status, n]) => [
    humaniseLabel(status),
    n.toLocaleString('en-GB'),
    sharePct(n, total),
    `<span class="mono" aria-hidden="true">${asciiBar(n, maxStatus)}</span>`,
  ]);
  const statusTable = dataTable(
    'How the callsign parser classified each record of the latest publication',
    [
      { label: 'parse status', rowHeader: true },
      { label: 'records', num: true },
      { label: 'share', num: true },
      { label: 'distribution', raw: true },
    ],
    statusRows,
  );

  return glance
    + '<h3>Parse-status breakdown</h3>'
    + '<p class="muted">How the callsign parser classified each row of the latest publication. A status other than <code>parsed</code> is a signal, not necessarily an error — <code>visitor</code> covers reciprocal/temporary callsigns the parser recognises but does not decompose.</p>'
    + statusTable;
}

// Column-emptiness and range profile of the latest publication: for every
// column, its distinct non-empty values, how many rows populate it, how many
// leave it empty (with share), and its value range (date span for date
// columns, character-length span otherwise). Distinct counts and ranges
// consider non-empty values only, so a mostly-empty column still reports its
// real range rather than a spurious zero.
export function renderColumnProfilesHtml(): string {
  const { stats } = newestStats();
  const total = stats.recordCount;
  const rows: (string | number)[][] = Object.entries(stats.columns).map(([name, col]) => {
    const empty = col.empty;
    const populated = total - empty;
    let range: string;
    if ('min' in col) {
      const d = col as DateColumnStats;
      range = d.min === '' ? '(never populated)' : `${escapeHtml(humanDate(d.min))} – ${escapeHtml(humanDate(d.max))}`;
    } else {
      const s = col as StringColumnStats;
      range = populated === 0 ? '(never populated)'
        : s.minLength === s.maxLength ? `${s.minLength} chars` : `${s.minLength}–${s.maxLength} chars`;
    }
    return [
      name,
      col.distinct.toLocaleString('en-GB'),
      populated.toLocaleString('en-GB'),
      empty === 0 ? 'none' : `${empty.toLocaleString('en-GB')} (${sharePct(empty, total)})`,
      range,
    ];
  });
  return dataTable(
    'Population and value range of every column in the latest publication',
    [
      { label: 'column', rowHeader: true },
      { label: 'distinct', num: true },
      { label: 'populated', num: true },
      { label: 'empty', num: true },
      { label: 'value range', raw: true },
    ],
    rows,
  ) + '<p class="muted">Distinct counts and ranges consider non-empty values only; the empty column carries emptiness separately. A column empty on every row (e.g. a field this export never carried) shows “(never populated)”.</p>';
}

// Callsign format taxonomy of the latest publication: the callsign column
// abstracted to its shape (A = upper-case letter, a = lower-case, N = digit;
// a space or invisible character becomes an explicit marker), the most common
// shapes ranked, and the full taxonomy folded into a details block so the long
// tail of anomalies stays archived on the static page. The shape strings are
// baked codepoints-only ({U+XXXX}); the friendly name is applied at render
// (#610) via the shared pre-marked translation, so a {U+00A0} shape reads as
// {NBSP} here exactly as it does among the quality examples.
export function renderCallsignTaxonomyHtml(): string {
  const { stats } = newestStats();
  const total = stats.recordCount;
  const patterns = Object.entries(stats.callsignPatterns).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const distinct = patterns.length;
  const TOP = 12;
  const top = patterns.slice(0, TOP);
  const maxTop = Math.max(1, ...top.map(([, n]) => n));

  const topRows: (string | number)[][] = top.map(([pattern, n]) => [
    `<span class="mono">${callsignDisplay(pattern, 'pre-marked')}</span>`,
    n.toLocaleString('en-GB'),
    sharePct(n, total),
    `<span class="mono" aria-hidden="true">${asciiBar(n, maxTop)}</span>`,
  ]);
  const topTable = dataTable(
    'The most common callsign shapes in the latest publication',
    [
      { label: 'shape', rowHeader: true, raw: true },
      { label: 'records', num: true },
      { label: 'share', num: true },
      { label: 'distribution', raw: true },
    ],
    topRows,
  );

  const fullRows: (string | number)[][] = patterns.map(([pattern, n]) => [
    `<span class="mono">${callsignDisplay(pattern, 'pre-marked')}</span>`,
    n.toLocaleString('en-GB'),
    sharePct(n, total),
  ]);
  const fullTable = dataTable(
    'Every callsign shape in the latest publication, with record counts',
    [
      { label: 'shape', rowHeader: true, raw: true },
      { label: 'records', num: true },
      { label: 'share', num: true },
    ],
    fullRows,
  );

  const caption = `<p class="muted">${distinct.toLocaleString('en-GB')} distinct shapes across ${total.toLocaleString('en-GB')} records; the ${TOP} most common are shown. `
    + 'In a shape, <code>A</code> is an upper-case letter, <code>a</code> a lower-case letter and <code>N</code> a digit; a space or invisible character is shown as a named marker where it has a recognised name (<code>{SP}</code>, <code>{NBSP}</code>, <code>{ZWSP}</code>, …) and otherwise as its <code>{U+XXXX}</code> code point, with the exact code point on the marker’s tooltip, so a tab anomaly and a non-breaking-space anomaly stay distinct rows.</p>';
  return caption
    + topTable
    + `<details><summary>Full taxonomy (${distinct.toLocaleString('en-GB')} shapes)</summary>${fullTable}</details>`;
}

// Callsign quality detectors of the latest publication: each heuristic
// detector's hit count and up to five example values (spaces and invisibles
// marked at derivation time as {U+XXXX}, then translated to their friendly
// names at render). These are DETECTED occurrences of a defect shape, not
// verified defects, and a zero is itself a result worth showing.
export function renderCallsignQualityHtml(): string {
  const { stats } = newestStats();
  const q = stats.callsignQuality;
  const detectors: [keyof CallsignQuality, string][] = [
    ['excelDateShaped', 'Spreadsheet-date-shaped (e.g. 20-Apr)'],
    ['encodingFailure', 'Encoding failure (U+FFFD present)'],
    ['whitespaceBearing', 'Whitespace or invisible character present'],
    ['postNormalisationDuplicates', 'Duplicate once junk is stripped'],
    ['lowercaseBearing', 'Lower-case letter present'],
    ['emptyCallsign', 'Empty callsign'],
  ];
  const rows: (string | number)[][] = detectors.map(([detectorKey, label]) => {
    const result = q[detectorKey];
    // Detector examples come from stats.json with their {U+XXXX} markers
    // already applied at derivation time, so the shared field wrapper (#553)
    // is pinned to 'pre-marked': it highlights those markers without
    // re-marking, translating each to its friendly name at the edge (#610)
    // with the exact code point kept on the tooltip. Deliberately no lookup
    // link - a defect shape (a spreadsheet date, an empty value) is not
    // necessarily a resolvable callsign.
    const examples = result.examples.length === 0
      ? '<span class="muted">—</span>'
      : result.examples.map(e => callsignField(e, { oddCharacters: 'pre-marked' })).join(', ');
    return [label, result.count.toLocaleString('en-GB'), examples];
  });
  return dataTable(
    'Callsign-quality detector hit counts for the latest publication',
    [
      { label: 'detector', rowHeader: true },
      { label: 'rows flagged', num: true },
      { label: 'examples', raw: true },
    ],
    rows,
  ) + '<p class="muted">Heuristic detectors run over the callsign column: the counts are detected occurrences of a defect shape, declared but not independently verified against Ofcom, and a zero is a genuine result. Up to five example values are shown per detector, with spaces and invisible characters shown as named markers where recognised (<code>{SP}</code>, <code>{NBSP}</code>, <code>{ZWSP}</code>, …) and otherwise as their <code>{U+XXXX}</code> code point, each marker’s exact code point on its tooltip.</p>';
}

const PLACEHOLDER_TEXT = 'generated at deploy time — build the site to populate';

// Injects both blocks into the deployed statistics.html. Fails loudly if
// the placeholders drift - a silent miss would publish the placeholder
// text instead of the statistics, misleadingly.
export function injectHomeAggregates(statisticsPath: string): void {
  let html = fs.readFileSync(statisticsPath, 'utf8');
  const replacements: [string, string][] = [
    [`<div id="latest-profile-table">${PLACEHOLDER_TEXT}</div>`, `<div id="latest-profile-table" data-prerendered>${renderLatestProfileHtml()}</div>`],
    [`<div id="rsl-matrix-table">${PLACEHOLDER_TEXT}</div>`, `<div id="rsl-matrix-table" data-prerendered>${renderRslMatrixHtml()}</div>`],
    [`<div id="column-profiles-table">${PLACEHOLDER_TEXT}</div>`, `<div id="column-profiles-table" data-prerendered>${renderColumnProfilesHtml()}</div>`],
    [`<div id="callsign-taxonomy-table">${PLACEHOLDER_TEXT}</div>`, `<div id="callsign-taxonomy-table" data-prerendered>${renderCallsignTaxonomyHtml()}</div>`],
    [`<div id="callsign-quality-table">${PLACEHOLDER_TEXT}</div>`, `<div id="callsign-quality-table" data-prerendered>${renderCallsignQualityHtml()}</div>`],
    [`<div id="flags-table">${PLACEHOLDER_TEXT}</div>`, `<div id="flags-table" data-prerendered>${renderFlagsTableHtml()}</div>`],
  ];
  for (const [placeholder, replacement] of replacements) {
    if (!html.includes(placeholder)) throw new Error(`placeholder not found in ${statisticsPath}: ${placeholder}`);
    html = html.replace(placeholder, replacement);
  }
  // Footer build stamp (same convention as the generated dataset pages).
  const sha = (process.env.GITHUB_SHA ?? 'dev').slice(0, 9);
  html = html.replace('<span id="build-sha"></span>', ` from commit <code>${sha}</code>`);
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
