#!/usr/bin/env node

/**
 * Builds the published dataset index for GitHub Pages (issue #149 item 3):
 * a crawlable tree of per-entry pages that link the raw, extract and
 * normalised files themselves - all copied into the deploy artefact with
 * stable URLs - plus a Frictionless datapackage.json descriptor per entry
 * and a sitemap.xml. The index is the Wayback Machine crawl seed: index ->
 * entry pages -> data files, plain anchors throughout, no scripts.
 *
 * DELIBERATELY NOT COMMITTED: like the SQLite database (ADR 0003) this is
 * derived at deploy time from committed data. Output is deterministic for
 * unchanged inputs (no timestamps), so re-crawls only see changes when the
 * data changed.
 *
 * Descriptor choice: Frictionless Data (datapackage.json) over W3C CSVW -
 * one dataset-level JSON with a resources[] list (path, bytes, sha256,
 * description) fits the entry-directory shape directly, and column schemas
 * are derived from each CSV's own header so there is no second source of
 * truth to drift.
 *
 * Usage: node src/ci/build-dataset-pages.ts <output-dir> [base-url]
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { listFoiEntryKeys, readFoiEntryMeta, FOI_DATASET_CLASSES, type FoiEntryMeta, type FoiWitness } from '../shared/foi-archive.ts';
import { renderMarkdown } from '../shared/render-markdown.ts';
import { parseFlagRegistry } from './build-sqlite.ts';
import { parse } from 'csv-parse/sync';
import { buildZip } from '../shared/zip.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';
const REPO_URL = 'https://github.com/MysterAitch/amateur-callsigns-file-watch';

// Hard ceiling well under the GitHub Pages 1 GB site cap - fail loudly
// before a deploy that would silently degrade.
const MAX_TOTAL_BYTES = 900 * 1024 * 1024;

export interface DatasetPagesSummary {
  entryCount: number;
  fileCount: number;
  totalBytes: number;
  pageUrls: string[];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// '2022-05-30' -> '30 May 2022' (deterministic; no locale machinery).
function humanDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match === null) return isoDate;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

// Download links always show a size; navigation links never do - the
// consistent pattern that tells a visitor what a click will do.
function sizeOf(filePath: string): string {
  return fs.existsSync(filePath) ? ` (${formatBytes(fs.statSync(filePath).size)})` : '';
}

// Column names from a CSV's own header row - the honest schema source.
function csvHeaderFields(filePath: string): { name: string; type: string }[] | undefined {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.toString('utf8', 0, read);
    const firstLine = text.split(/\r?\n/, 1)[0]?.replace(/^﻿/, '');
    if (firstLine === undefined || firstLine.length === 0) return undefined;
    // Header rows in this repository's derived CSVs are unquoted; raw
    // sources may not be - a quoted header falls back to no schema rather
    // than a wrong one.
    if (firstLine.includes('"')) return undefined;
    return firstLine.split(',').map(name => ({ name, type: 'string' }));
  } finally {
    fs.closeSync(fd);
  }
}

const PAGE_STYLE = [
  '<style>',
  'body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5}',
  'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.3rem .5rem;text-align:left;vertical-align:top}',
  'code{background:#f4f4f4;padding:0 .2rem}h1,h2{line-height:1.2}',
  '@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}td,th{border-color:#444}code{background:#222}a{color:#8cf}}',
  '</style>',
].join('');

function htmlPage(title: string, depthToRoot: number, body: string[], metaJsonHref?: string): string {
  const rootPath = '../'.repeat(depthToRoot);
  // On entry pages the footer's meta.json mention links to THAT entry's
  // meta; elsewhere it stays plain text (a generic link would mislead).
  const metaMention = metaJsonHref === undefined ? '<code>meta.json</code>' : `<a href="${metaJsonHref}"><code>meta.json</code></a>`;
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${PAGE_STYLE}</head>`,
    '<body>',
    `<p><a href="${rootPath}index.html">← callsign lookup</a> · <a href="${'../'.repeat(depthToRoot - 1) || './'}index.html">dataset index</a> · <a href="${REPO_URL}">repository</a></p>`,
    ...body,
    `<p><small>Derived from the committed archive; provenance and integrity hashes live in each entry's ${metaMention}. Regenerated on every deploy.</small></p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

interface CopiedFile {
  name: string;
  bytes: number;
  description?: string;
  sha256?: string;
  schemaFields?: { name: string; type: string }[];
  // Present for markdown files: the rendered .html sibling written next to
  // the verbatim .md - the browsing default, with the raw file one click
  // away.
  renderedName?: string;
  // Pre-rendered witness links (recovered-from provenance), derived from
  // the entry's meta so page and meta cannot drift.
  witnessHtml?: string;
}

const WITNESS_CHANNEL_NAMES: Record<string, string> = {
  wdtk: 'WhatDoTheyKnow',
  ukgwa: 'UK Government Web Archive',
  ofcom: 'ofcom.org.uk',
};

// "recovered from <channel>, capture/fetched <date>" as a clickable link.
// UKGWA URLs embed the capture timestamp - surface that; otherwise the
// fetch date from the witness record.
function witnessLinks(witnesses: FoiWitness[] | undefined): string {
  if (witnesses === undefined || witnesses.length === 0) return '';
  return witnesses.map(w => {
    const channelName = WITNESS_CHANNEL_NAMES[w.channel] ?? w.channel;
    const capture = /\/ukgwa\/(\d{4})(\d{2})(\d{2})/.exec(w.url);
    const label = capture === null
      ? `${channelName}, fetched ${w.fetchedAt}`
      : `${channelName}, capture ${capture[1]}-${capture[2]}-${capture[3]}`;
    return ` · recovered from <a href="${escapeHtml(w.url)}">${escapeHtml(label)}</a>`;
  }).join('');
}

// Copies every file of an entry directory into the output tree and returns
// the manifest used by both the page and the descriptor. Markdown files
// (correspondence records, PDF transcription extracts) additionally get a
// rendered .html sibling for browsing; the verbatim .md remains the
// published record.
function copyEntryFiles(sourceDir: string, targetDir: string, descriptions: Map<string, string>, hashes: Map<string, string>, entryTitle: string): CopiedFile[] {
  fs.mkdirSync(targetDir, { recursive: true });
  return fs.readdirSync(sourceDir).sort().map(name => {
    const sourcePath = path.join(sourceDir, name);
    fs.copyFileSync(sourcePath, path.join(targetDir, name));
    const bytes = fs.statSync(sourcePath).size;
    const schemaFields = name.endsWith('.csv') ? csvHeaderFields(sourcePath) : undefined;
    let renderedName: string | undefined;
    if (name.endsWith('.md')) {
      renderedName = `${name}.html`;
      const body = [
        `<p><small>Rendered from <a href="${encodeURIComponent(name)}">${escapeHtml(name)}</a> (the verbatim record) — part of <a href="index.html">${escapeHtml(entryTitle)}</a>.</small></p>`,
        '<hr>',
        renderMarkdown(fs.readFileSync(sourcePath, 'utf8')),
      ];
      fs.writeFileSync(path.join(targetDir, renderedName), htmlPage(`${name} — ${entryTitle}`, 3, body));
    }
    return { name, bytes, description: descriptions.get(name), sha256: hashes.get(name), schemaFields, renderedName };
  });
}

function dataPackage(name: string, title: string, files: CopiedFile[]): string {
  return JSON.stringify({
    name,
    title,
    homepage: REPO_URL,
    resources: files.map(file => ({
      name: file.name,
      path: file.name,
      bytes: file.bytes,
      ...(file.sha256 === undefined ? {} : { hash: `sha256:${file.sha256}` }),
      ...(file.description === undefined ? {} : { description: file.description }),
      ...(file.schemaFields === undefined ? {} : { schema: { fields: file.schemaFields } }),
    })),
  }, null, 2) + '\n';
}

function filesTable(files: CopiedFile[]): string[] {
  return [
    '<table>',
    '<tr><th>file</th><th>size</th><th>notes</th></tr>',
    ...files.map(file => {
      // Markdown defaults to the rendered view; the verbatim raw file
      // stays one click away.
      const mainHref = file.renderedName === undefined ? encodeURIComponent(file.name) : encodeURIComponent(file.renderedName);
      const rawLink = file.renderedName === undefined ? '' : ` · <a href="${encodeURIComponent(file.name)}">raw</a>`;
      return `<tr><td><a href="${mainHref}">${escapeHtml(file.name)}</a>${rawLink}</td><td>${formatBytes(file.bytes)}</td><td>${escapeHtml(file.description ?? '')}${file.witnessHtml ?? ''}</td></tr>`;
    }),
    '</table>',
  ];
}

interface SheetsIndicative {
  note?: string;
  sheets: { name: string; approxRows?: number; cols?: string; datasetClass?: string }[];
}

function asSheetsIndicative(value: unknown): SheetsIndicative | undefined {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as SheetsIndicative).sheets)) return undefined;
  return value as SheetsIndicative;
}

// Plain-language summary of what an FOI entry's data IS - the dataset
// classes with their registry prose, and the per-file sheet shapes where
// the meta declares them (workbook attachments). Everything shown is
// already asserted by meta.json; this only presents it.
function foiDataSummarySections(meta: FoiEntryMeta): string[] {
  const html: string[] = [
    '<h2>What this data is</h2>',
    '<ul>',
    ...meta.datasetClasses.map(c => `<li><code>${escapeHtml(c)}</code> — ${escapeHtml(FOI_DATASET_CLASSES[c] ?? '')}</li>`),
    '</ul>',
  ];
  const shapeRows: string[] = [];
  const notes = new Set<string>();
  for (const [name, decl] of Object.entries(meta.files)) {
    const indicative = asSheetsIndicative(decl.sheetsIndicative);
    if (indicative === undefined) continue;
    if (indicative.note !== undefined) notes.add(indicative.note);
    for (const sheet of indicative.sheets) {
      shapeRows.push(`<tr><td><code>${escapeHtml(name)}</code></td><td>${escapeHtml(sheet.name)}</td>`
        + `<td>${sheet.approxRows === undefined ? '—' : `~${sheet.approxRows.toLocaleString('en-GB')}`}</td>`
        + `<td>${escapeHtml(sheet.cols ?? '—')}</td>`
        + `<td>${sheet.datasetClass === undefined ? '—' : `<code>${escapeHtml(sheet.datasetClass)}</code>`}</td></tr>`);
    }
  }
  if (shapeRows.length > 0) {
    html.push(
      '<h3>Sheets (indicative shape)</h3>',
      '<table>',
      '<tr><th>file</th><th>sheet</th><th>rows</th><th>cols</th><th>class</th></tr>',
      ...shapeRows,
      '</table>',
      ...[...notes].map(n => `<p><small>${escapeHtml(n)}</small></p>`),
    );
  }
  return html;
}

// One deterministic zip per entry: every archived file plus the
// datapackage.json descriptor, so a single download carries the data AND
// its provenance/integrity record. Returns the zip's byte size.
function writeEntryZip(sourceDir: string, targetDir: string, key: string, descriptorJson: string): number {
  const entries = fs.readdirSync(sourceDir).sort().map(name => ({
    name,
    data: fs.readFileSync(path.join(sourceDir, name)),
  }));
  entries.push({ name: 'datapackage.json', data: Buffer.from(descriptorJson, 'utf8') });
  const zip = buildZip(entries);
  fs.writeFileSync(path.join(targetDir, `${key}.zip`), zip);
  return zip.length;
}

function entryZipLine(key: string, zipBytes: number): string {
  return `<p>Download everything (all files above plus the descriptor) as one archive: <a href="${encodeURIComponent(`${key}.zip`)}">${escapeHtml(key)}.zip</a> (${formatBytes(zipBytes)}).</p>`;
}

function buildFoiEntry(outputDir: string, foiDir: string, key: string): { files: CopiedFile[]; meta: FoiEntryMeta; zipBytes: number } {
  const meta = readFoiEntryMeta(foiDir, key);
  const descriptions = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const [name, decl] of Object.entries(meta.files)) {
    const parts = [decl.role, decl.contentsIndicative].filter((p): p is string => p !== undefined);
    descriptions.set(name, parts.join(' — '));
    hashes.set(name, decl.sha256);
  }
  descriptions.set('meta.json', 'provenance, outcome, and hash-pinned file declarations');
  const targetDir = path.join(outputDir, 'datasets', 'foi', key);
  const files = copyEntryFiles(path.join(foiDir, key), targetDir, descriptions, hashes, meta.title);
  for (const file of files) {
    file.witnessHtml = witnessLinks(meta.files[file.name]?.witnesses);
  }

  const facts: string[] = [
    `<tr><th>outcome</th><td>${escapeHtml(meta.outcome)}${meta.datasetRecovery === undefined ? '' : ` <em>(dataset ${escapeHtml(meta.datasetRecovery)})</em>`}</td></tr>`,
    `<tr><th>dataset classes</th><td>${meta.datasetClasses.map(c => `<code>${escapeHtml(c)}</code>`).join(', ')}</td></tr>`,
    `<tr><th>data vintage</th><td>${escapeHtml(meta.dataVintage ?? '—')}</td></tr>`,
    `<tr><th>requested / responded</th><td>${escapeHtml(meta.requestedAt ?? 'not stated')} / ${escapeHtml(meta.respondedAt ?? 'not stated')}</td></tr>`,
  ];
  if (meta.requestUrl !== null) facts.push(`<tr><th>request</th><td><a href="${escapeHtml(meta.requestUrl)}">${escapeHtml(meta.requestUrl)}</a></td></tr>`);
  if (meta.publicationUrl !== undefined) facts.push(`<tr><th>published at</th><td><a href="${escapeHtml(meta.publicationUrl)}">${escapeHtml(meta.publicationUrl)}</a></td></tr>`);
  const related = (meta.relatedEntries ?? []).map(rel =>
    `<li>${/^(wdtk|ofcom)-[^\s/]+$/.test(rel.entry) ? `<a href="../${encodeURIComponent(rel.entry)}/index.html"><code>${escapeHtml(rel.entry)}</code></a>` : `<code>${escapeHtml(rel.entry)}</code>`} — ${escapeHtml(rel.relation)}</li>`);

  const descriptor = dataPackage(key, meta.title, files);
  const zipBytes = writeEntryZip(path.join(foiDir, key), targetDir, key, descriptor);
  const body = [
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p>FOI archive entry <code>${escapeHtml(key)}</code>. Machine-readable: <a href="datapackage.json">datapackage.json</a>.</p>`,
    '<table>',
    ...facts,
    '</table>',
    ...foiDataSummarySections(meta),
    '<h2>Files</h2>',
    ...filesTable(files),
    entryZipLine(key, zipBytes),
    ...entryDatabaseLine(outputDir, 'foi', key),
    ...(related.length > 0 ? ['<h2>Related entries</h2>', '<ul>', ...related, '</ul>'] : []),
  ];
  fs.writeFileSync(path.join(targetDir, 'index.html'), htmlPage(meta.title, 3, body, 'meta.json'));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, meta, zipBytes };
}

// The per-entry SQLite database is built earlier in the deploy (the data
// tiers step); when present, offer it from the entry page with its size -
// the download-link pattern. Absent in scratch builds without tiers.
function entryDatabaseLine(outputDir: string, lane: 'foi' | 'open-data', key: string): string[] {
  const dbName = `${lane}--${key}.sqlite.gz`;
  const size = sizeOf(path.join(outputDir, 'data', 'datasets', dbName));
  if (size === '') return [];
  return [`<p>All of this entry's CSV files as one SQLite database: <a href="../../../data/datasets/${encodeURIComponent(dbName)}">${escapeHtml(dbName)}</a>${size}.</p>`];
}

interface OpenDataStats {
  recordCount: number;
  parseStatuses: Record<string, number>;
  callsignFlags: Record<string, number>;
  callsignQuality: Record<string, { count: number; examples: string[] }>;
}

interface OpenDataDiffSummary {
  previousArchiveKey: string;
  previousRecordCount: number;
  unchanged: number;
  fieldChanged: number;
  added: number;
  removed: number;
}

// Prefix-series × RSL matrix with row/column totals, derived from the
// entry's own components.csv (parsed rows only; the exclusions are stated
// beneath the table). Built per entry - the SQLite rsl_matrix covers only
// the latest publication.
function rslMatrixSection(componentsPath: string): string[] {
  if (!fs.existsSync(componentsPath)) return [];
  const rows = parse(fs.readFileSync(componentsPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const counts = new Map<string, Map<string, number>>();
  const excluded = new Map<string, number>();
  const rslSet = new Set<string>();
  for (const row of rows) {
    if (row.parse_status !== 'parsed') {
      excluded.set(row.parse_status, (excluded.get(row.parse_status) ?? 0) + 1);
      continue;
    }
    const series = row.prefix_series;
    const rsl = row.rsl;
    rslSet.add(rsl);
    const seriesCounts = counts.get(series) ?? new Map<string, number>();
    seriesCounts.set(rsl, (seriesCounts.get(rsl) ?? 0) + 1);
    counts.set(series, seriesCounts);
  }
  if (counts.size === 0) return [];
  const rsls = [...rslSet].sort((a, b) => a.localeCompare(b)); // '' (no RSL) sorts first
  const seriesKeys = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const columnTotals = new Map<string, number>();
  const html: string[] = [
    '<h2>Prefix series × Regional Secondary Locator</h2>',
    '<p>Parsed register rows by prefix series and RSL letter as stored in the register (RSLs are rarely stored - regional renderings are usually implicit).</p>',
    '<div style="overflow-x:auto"><table>',
    `<tr><th>series</th>${rsls.map(r => `<th>${r === '' ? '(none)' : escapeHtml(r)}</th>`).join('')}<th>total</th></tr>`,
  ];
  let grandTotal = 0;
  for (const series of seriesKeys) {
    const seriesCounts = counts.get(series) ?? new Map<string, number>();
    let rowTotal = 0;
    const cells = rsls.map(rsl => {
      const n = seriesCounts.get(rsl) ?? 0;
      rowTotal += n;
      columnTotals.set(rsl, (columnTotals.get(rsl) ?? 0) + n);
      return `<td>${n === 0 ? '' : n.toLocaleString('en-GB')}</td>`;
    });
    grandTotal += rowTotal;
    html.push(`<tr><td><code>${escapeHtml(series)}</code></td>${cells.join('')}<td>${rowTotal.toLocaleString('en-GB')}</td></tr>`);
  }
  html.push(`<tr><th>total</th>${rsls.map(rsl => `<th>${(columnTotals.get(rsl) ?? 0).toLocaleString('en-GB')}</th>`).join('')}<th>${grandTotal.toLocaleString('en-GB')}</th></tr>`);
  html.push('</table></div>');
  const exclusions = [...excluded.entries()].sort().map(([status, n]) => `${n.toLocaleString('en-GB')} ${escapeHtml(status)}`);
  if (exclusions.length > 0) html.push(`<p><small>Excluded from the matrix: ${exclusions.join(', ')} rows (shown in the metrics above).</small></p>`);
  return html;
}

// Derived metrics for an open-data publication, from its own stats.json
// (counts, parse statuses, anomaly flags with registry meanings) plus the
// meta-recorded diff against the previous publication - the only
// inter-dataset comparison shown, because the meta itself asserts it.
function openDataMetricsSections(sourceDir: string, key: string): string[] {
  const statsPath = path.join(sourceDir, 'stats.json');
  if (!fs.existsSync(statsPath)) return [];
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')) as OpenDataStats;
  const registry = new Map(parseFlagRegistry().map(r => [r.flag, r.meaning]));

  const statuses = Object.entries(stats.parseStatuses).sort()
    .map(([status, n]) => `${n.toLocaleString('en-GB')} ${escapeHtml(status)}`).join(', ');
  const html: string[] = [
    '<h2>Dataset metrics</h2>',
    `<p>${stats.recordCount.toLocaleString('en-GB')} register rows: ${statuses}.</p>`,
  ];

  const meta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta.json'), 'utf8')) as { diffSummary?: OpenDataDiffSummary };
  const diff = meta.diffSummary;
  if (diff !== undefined) {
    const previous = diff.previousArchiveKey === key
      ? 'the previous fetch of this publication'
      : `the <a href="../${escapeHtml(diff.previousArchiveKey)}/index.html">publication of ${humanDate(diff.previousArchiveKey)}</a>`;
    html.push(`<p>Against ${previous} (${diff.previousRecordCount.toLocaleString('en-GB')} rows, as recorded in this entry's meta.json at archive time): `
      + `${diff.unchanged.toLocaleString('en-GB')} rows unchanged, ${diff.fieldChanged.toLocaleString('en-GB')} changed, `
      + `${diff.added.toLocaleString('en-GB')} added, ${diff.removed.toLocaleString('en-GB')} removed.</p>`);
  }

  const flags = Object.entries(stats.callsignFlags).sort((a, b) => b[1] - a[1]);
  if (flags.length > 0) {
    html.push('<h2>Anomalies</h2>', '<table>', '<tr><th>flag</th><th>rows</th><th>meaning</th></tr>');
    for (const [flag, count] of flags) {
      html.push(`<tr><td><code>${escapeHtml(flag)}</code></td><td>${count.toLocaleString('en-GB')}</td><td>${escapeHtml(registry.get(flag) ?? '')}</td></tr>`);
    }
    html.push('</table>');
  }
  const quality = Object.entries(stats.callsignQuality).filter(([, q]) => q.count > 0).sort();
  if (quality.length > 0) {
    html.push('<h3>Value-level quality checks</h3>', '<ul>');
    for (const [check, q] of quality) {
      const examples = q.examples.length > 0 ? ` — e.g. ${q.examples.slice(0, 5).map(e => `<code>${escapeHtml(e)}</code>`).join(', ')}` : '';
      html.push(`<li>${escapeHtml(check)}: ${q.count.toLocaleString('en-GB')}${examples}</li>`);
    }
    html.push('</ul>');
  }
  return html;
}

function buildOpenDataEntry(outputDir: string, key: string): { files: CopiedFile[]; zipBytes: number } {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const descriptions = new Map<string, string>([
    ['raw.csv', "Ofcom's bytes, verbatim"],
    ['meta.json', 'provenance + shape + diff summary'],
    ['normalised.csv', 'canonical schema derivation (see normalised-schema.md)'],
    ['components.csv', 'per-callsign component decomposition'],
    ['stats.json', 'per-publication statistics and data-quality flags'],
  ]);
  const title = `Ofcom open-data publication ${key}`;
  const targetDir = path.join(outputDir, 'datasets', 'open-data', key);
  const files = copyEntryFiles(sourceDir, targetDir, descriptions, new Map(), title);
  const descriptor = dataPackage(key, title, files);
  const zipBytes = writeEntryZip(sourceDir, targetDir, key, descriptor);
  const body = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>Open-data archive entry <code>${escapeHtml(key)}</code>. Machine-readable: <a href="datapackage.json">datapackage.json</a>.</p>`,
    ...openDataMetricsSections(sourceDir, key),
    ...rslMatrixSection(path.join(sourceDir, 'components.csv')),
    '<h2>Files</h2>',
    ...filesTable(files),
    entryZipLine(key, zipBytes),
    ...entryDatabaseLine(outputDir, 'open-data', key),
  ];
  fs.writeFileSync(path.join(targetDir, 'index.html'), htmlPage(title, 3, body, 'meta.json'));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, zipBytes };
}

export function buildDatasetPages(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): DatasetPagesSummary {
  const foiDir = path.join(REPO_ROOT, 'archive', 'foi');
  const openDataKeys = listArchiveKeys().sort();
  const foiKeys = listFoiEntryKeys(foiDir);

  let fileCount = 0;
  let totalBytes = 0;
  const pageUrls: string[] = [`${baseUrl}/datasets/index.html`];

  const openDataRows: string[] = [];
  for (const key of openDataKeys) {
    const { files, zipBytes } = buildOpenDataEntry(outputDir, key);
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0) + zipBytes;
    pageUrls.push(`${baseUrl}/datasets/open-data/${key}/index.html`);
    openDataRows.push(`<tr><td><a href="open-data/${key}/index.html">Publication of ${humanDate(key)}</a> <code>${key}</code></td><td>${files.length}</td><td>${formatBytes(files.reduce((s, f) => s + f.bytes, 0))}</td></tr>`);
  }

  const foiRows: string[] = [];
  for (const key of foiKeys) {
    const { files, meta, zipBytes } = buildFoiEntry(outputDir, foiDir, key);
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0) + zipBytes;
    pageUrls.push(`${baseUrl}/datasets/foi/${key}/index.html`);
    foiRows.push(`<tr><td><a href="foi/${encodeURIComponent(key)}/index.html">${escapeHtml(meta.title)}</a><br><code>${escapeHtml(key)}</code></td><td>${escapeHtml(meta.dataVintage ?? '—')}</td><td>${meta.datasetClasses.map(c => `<code>${escapeHtml(c)}</code>`).join(', ')}</td></tr>`);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`dataset pages would ship ${totalBytes} bytes - over the ${MAX_TOTAL_BYTES} ceiling; revisit what is published before deploying`);
  }

  // Data dictionary: the repository's schema documentation rendered onto
  // the site so the published datasets are interpretable without the
  // repo. Sources are the committed docs (two of them generated and
  // freshness-tested), rendered with the same markdown renderer as the
  // correspondence records.
  const dictionaryDocs = [
    { source: 'docs/normalised-schema.md', slug: 'normalised-schema', label: 'Open-data normalised schema', blurb: 'column-by-column definitions of every open-data publication’s <code>normalised.csv</code> and <code>components.csv</code>.' },
    { source: 'docs/foi-schemas.md', slug: 'foi-schemas', label: 'FOI dataset schemas', blurb: 'the dataset-class glossary, row-schema families, registered extension columns, and per-variant conversion detail behind every FOI <code>normalised--*.csv</code>.' },
    { source: 'reference-data/flags.md', slug: 'flags', label: 'Data-quality flag registry', blurb: 'the meaning and grounding of every anomaly flag used in the metrics and the lookup.' },
  ];
  const docsDir = path.join(outputDir, 'datasets', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const doc of dictionaryDocs) {
    const docBody = [
      `<p><small>Rendered from <a href="${REPO_URL}/blob/main/${doc.source}">${escapeHtml(doc.source)}</a> in the repository (the authoritative copy).</small></p>`,
      '<hr>',
      renderMarkdown(fs.readFileSync(path.join(REPO_ROOT, doc.source), 'utf8')),
    ];
    fs.writeFileSync(path.join(docsDir, `${doc.slug}.html`), htmlPage(doc.label, 2, docBody));
    pageUrls.push(`${baseUrl}/datasets/docs/${doc.slug}.html`);
  }
  const dictionarySection = [
    '<h2>Data dictionary</h2>',
    '<ul>',
    ...dictionaryDocs.map(doc => `<li><a href="docs/${doc.slug}.html">${escapeHtml(doc.label)}</a> — ${doc.blurb}</li>`),
    '</ul>',
  ];

  const indexBody = [
    '<h1>Dataset index</h1>',
    '<p>Every archived dataset in both collections below, with the raw, extract and normalised files published verbatim at stable URLs. Integrity: each entry’s <code>meta.json</code> declares sha256 for every file; each entry ships a <a href="https://datapackage.org/">Frictionless</a> <code>datapackage.json</code> and a one-click <code>.zip</code> of everything.</p>',
    ...dictionarySection,
    '<h2>Bulk downloads</h2>',
    '<ul>',
    `<li><a href="../data/foi-observations.csv.gz">foi-observations.csv.gz</a>${sizeOf(path.join(outputDir, 'data', 'foi-observations.csv.gz'))} — the flat union of every callsign-bearing FOI normalised row (one CSV, gzipped; empty cells conflate not-asserted with asserted-blank — the master database keeps them distinct as NULL vs empty string).</li>`,
    `<li><a href="../data/master.sqlite.gz">master.sqlite.gz</a>${sizeOf(path.join(outputDir, 'data', 'master.sqlite.gz'))} — one SQLite database of everything: the FOI observations union plus every open-data publication’s normalised rows (<code>register_history</code>).</li>`,
    '<li>One SQLite database per archive entry (one table per CSV), offered with its size from each entry’s own page below.</li>',
    '</ul>',
    '<!-- Reading the source? The site also serves callsigns.sqlite.png and master.sqlite.png: those ARE plain SQLite databases, byte-identical to the honest-named downloads once gunzipped. The .png extension defeats GitHub Pages\' gzip transcoding of Range responses, which corrupts the lookup\'s HTTP range-request reads (sql.js-httpvfs). Use the .sqlite.gz downloads above; the .png files exist for the in-browser lookup. -->',
    '<details><summary>Why do the site’s own database files end in <code>.png</code>?</summary>',
    '<p>The in-browser lookup queries its databases over HTTP <em>range requests</em> without downloading them whole. GitHub Pages gzip-transcodes text-like content types — including their range responses, which corrupts partial reads — but never re-compresses image types, so the databases the site queries live (<code>callsigns.sqlite.png</code>, <code>master.sqlite.png</code>) wear a <code>.png</code> name. They are plain SQLite files, byte-identical to the gzipped downloads above; if you ended up with one, rename it to <code>.sqlite</code> and it will open normally.</p>',
    '</details>',
    `<h2>Ofcom open data (${openDataKeys.length} publications)</h2>`,
    '<p>Ofcom publish the current amateur radio callsign dataset on their',
    '<a href="https://www.ofcom.org.uk/about-ofcom/our-research/opendata">open data page</a> —',
    'but only the current version, with no historical archive. This section preserves a copy of each',
    'publication as obtained at the time, byte-for-byte, so past register states remain checkable.</p>',
    '<table><tr><th>publication</th><th>files</th><th>size</th></tr>',
    ...openDataRows,
    '</table>',
    `<h2>FOI requests and responses (${foiKeys.length} entries)</h2>`,
    '<p>Ofcom is a public body: under the Freedom of Information Act 2000 it must, on request, disclose',
    'information it holds (subject to the Act’s exemptions). Following years of such requests, Ofcom now',
    'publishes point-in-time callsign data periodically — the open data section above. This section archives',
    'amateur-radio FOI requests and responses recovered from Ofcom’s own published responses, the UK',
    'Government Web Archive, and third-party sites such as',
    '<a href="https://www.whatdotheyknow.com/">WhatDoTheyKnow</a> — a decade of register snapshots,',
    'availability lists and issuance records predating the open data page. Where, when and how each file',
    'was retrieved is recorded alongside it: machine-readably in the entry’s hash-pinned <code>meta.json</code>,',
    'and narratively in its correspondence record.</p>',
    '<table><tr><th>entry</th><th>vintage</th><th>dataset classes</th></tr>',
    ...foiRows,
    '</table>',
  ];
  const datasetsDir = path.join(outputDir, 'datasets');
  fs.mkdirSync(datasetsDir, { recursive: true });
  fs.writeFileSync(path.join(datasetsDir, 'index.html'), htmlPage('Dataset index', 1, indexBody));

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${baseUrl}/index.html</loc></url>`,
    ...pageUrls.map(url => `<url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);

  return { entryCount: openDataKeys.length + foiKeys.length, fileCount, totalBytes, pageUrls };
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-dataset-pages.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const summary = buildDatasetPages(outputDir, baseUrl);
  console.log(`dataset pages: ${summary.entryCount} entries, ${summary.fileCount} files, ${formatBytes(summary.totalBytes)} (+ index, descriptors, sitemap)`);
}

if (import.meta.main) {
  main();
}
