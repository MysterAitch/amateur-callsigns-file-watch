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
import { listFoiEntryKeys, readFoiEntryMeta, type FoiEntryMeta } from '../shared/foi-archive.ts';

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

function htmlPage(title: string, depthToRoot: number, body: string[]): string {
  const rootPath = '../'.repeat(depthToRoot);
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${PAGE_STYLE}</head>`,
    '<body>',
    `<p><a href="${rootPath}index.html">← callsign lookup</a> · <a href="${'../'.repeat(depthToRoot - 1) || './'}index.html">dataset index</a> · <a href="${REPO_URL}">repository</a></p>`,
    ...body,
    `<p><small>Derived from the committed archive; provenance and integrity hashes live in each entry's <code>meta.json</code>. Regenerated on every deploy.</small></p>`,
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
}

// Copies every file of an entry directory into the output tree and returns
// the manifest used by both the page and the descriptor.
function copyEntryFiles(sourceDir: string, targetDir: string, descriptions: Map<string, string>, hashes: Map<string, string>): CopiedFile[] {
  fs.mkdirSync(targetDir, { recursive: true });
  return fs.readdirSync(sourceDir).sort().map(name => {
    const sourcePath = path.join(sourceDir, name);
    fs.copyFileSync(sourcePath, path.join(targetDir, name));
    const bytes = fs.statSync(sourcePath).size;
    const schemaFields = name.endsWith('.csv') ? csvHeaderFields(sourcePath) : undefined;
    return { name, bytes, description: descriptions.get(name), sha256: hashes.get(name), schemaFields };
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
    ...files.map(file =>
      `<tr><td><a href="${encodeURIComponent(file.name)}">${escapeHtml(file.name)}</a></td><td>${formatBytes(file.bytes)}</td><td>${escapeHtml(file.description ?? '')}</td></tr>`),
    '</table>',
  ];
}

function buildFoiEntry(outputDir: string, foiDir: string, key: string): { files: CopiedFile[]; meta: FoiEntryMeta } {
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
  const files = copyEntryFiles(path.join(foiDir, key), targetDir, descriptions, hashes);

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

  const body = [
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p>FOI-lane archive entry <code>${escapeHtml(key)}</code>. Machine-readable: <a href="datapackage.json">datapackage.json</a>.</p>`,
    '<table>',
    ...facts,
    '</table>',
    '<h2>Files</h2>',
    ...filesTable(files),
    ...(related.length > 0 ? ['<h2>Related entries</h2>', '<ul>', ...related, '</ul>'] : []),
  ];
  fs.writeFileSync(path.join(targetDir, 'index.html'), htmlPage(meta.title, 3, body));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), dataPackage(key, meta.title, files));
  return { files, meta };
}

function buildOpenDataEntry(outputDir: string, key: string): { files: CopiedFile[] } {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const descriptions = new Map<string, string>([
    ['raw.csv', "Ofcom's bytes, verbatim"],
    ['meta.json', 'provenance + shape + diff summary'],
    ['normalised.csv', 'canonical schema derivation (see normalised-schema.md)'],
    ['components.csv', 'per-callsign component decomposition'],
    ['stats.json', 'per-publication statistics and data-quality flags'],
  ]);
  const targetDir = path.join(outputDir, 'datasets', 'open-data', key);
  const files = copyEntryFiles(sourceDir, targetDir, descriptions, new Map());
  const title = `Ofcom open-data publication ${key}`;
  const body = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>Open-data-lane archive entry <code>${escapeHtml(key)}</code>. Machine-readable: <a href="datapackage.json">datapackage.json</a>.</p>`,
    '<h2>Files</h2>',
    ...filesTable(files),
  ];
  fs.writeFileSync(path.join(targetDir, 'index.html'), htmlPage(title, 3, body));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), dataPackage(key, title, files));
  return { files };
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
    const { files } = buildOpenDataEntry(outputDir, key);
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0);
    pageUrls.push(`${baseUrl}/datasets/open-data/${key}/index.html`);
    openDataRows.push(`<tr><td><a href="open-data/${key}/index.html"><code>${key}</code></a></td><td>${files.length}</td><td>${formatBytes(files.reduce((s, f) => s + f.bytes, 0))}</td></tr>`);
  }

  const foiRows: string[] = [];
  for (const key of foiKeys) {
    const { files, meta } = buildFoiEntry(outputDir, foiDir, key);
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0);
    pageUrls.push(`${baseUrl}/datasets/foi/${key}/index.html`);
    foiRows.push(`<tr><td><a href="foi/${encodeURIComponent(key)}/index.html"><code>${escapeHtml(key)}</code></a></td><td>${escapeHtml(meta.title)}</td><td>${escapeHtml(meta.dataVintage ?? '—')}</td><td>${meta.datasetClasses.map(c => `<code>${escapeHtml(c)}</code>`).join(', ')}</td></tr>`);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`dataset pages would ship ${totalBytes} bytes - over the ${MAX_TOTAL_BYTES} ceiling; revisit what is published before deploying`);
  }

  const indexBody = [
    '<h1>Dataset index</h1>',
    '<p>Every archived dataset in both lanes, with the raw, extract and normalised files published verbatim at stable URLs. Integrity: each entry’s <code>meta.json</code> declares sha256 for every file; each entry ships a <a href="https://datapackage.org/">Frictionless</a> <code>datapackage.json</code>.</p>',
    '<h2>Bulk downloads</h2>',
    '<ul>',
    '<li><a href="../data/foi-observations.csv.gz">foi-observations.csv.gz</a> — the flat union of every callsign-bearing FOI normalised row (one CSV, gzipped; empty cells conflate not-asserted with asserted-blank — the master database keeps them distinct as NULL vs empty string).</li>',
    '<li><a href="../data/master.sqlite.png">master.sqlite.png</a> — one SQLite database of everything: the FOI observations union plus every open-data publication’s normalised rows (<code>register_history</code>). Plain SQLite wearing a .png name (hosting workaround).</li>',
    '<li><code>../data/datasets/{lane}--{key}.sqlite.png</code> — one SQLite database per archive entry, one table per CSV.</li>',
    '</ul>',
    `<h2>Open-data lane (${openDataKeys.length} publications)</h2>`,
    '<table><tr><th>publication</th><th>files</th><th>size</th></tr>',
    ...openDataRows,
    '</table>',
    `<h2>FOI lane (${foiKeys.length} entries)</h2>`,
    '<table><tr><th>entry</th><th>title</th><th>vintage</th><th>dataset classes</th></tr>',
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
