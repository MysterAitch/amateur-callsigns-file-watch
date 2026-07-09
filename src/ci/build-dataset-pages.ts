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
import { listFoiEntryKeys, readFoiEntryMeta, type FoiEntryMeta, type FoiWitness } from '../shared/foi-archive.ts';
import { renderMarkdown, renderInline } from '../shared/render-markdown.ts';
import { parseFlagRegistry } from './build-sqlite.ts';
import { displaySeries } from './build-home-aggregates.ts';
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

// Short commit identifier for footers; 'dev' outside the deploy workflow.
const BUILD_SHA = (process.env.GITHUB_SHA ?? 'dev').slice(0, 9);
// Deploy provenance (set by the Pages workflow): the commit's own time, the
// build time, and a link to the exact GitHub Actions run that produced this
// deploy - so a reader can trace a page back to its origin. All optional so
// local/dev builds degrade gracefully.
const BUILD_COMMIT_TIME = process.env.BUILD_COMMIT_TIME ?? '';
const BUILD_TIME = process.env.BUILD_TIME ?? '';
const RUN_ID = process.env.GITHUB_RUN_ID ?? '';
const RUN_NUMBER = process.env.GITHUB_RUN_NUMBER ?? '';
const SERVER_URL = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const REPO_SLUG = process.env.GITHUB_REPOSITORY ?? '';

// An ISO timestamp as "9 July 2026 14:32 UTC" (empty in -> empty out).
function formatTimestamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m === null ? '' : `${humanDate(m[1])} ${m[2]} UTC`;
}

// The deploy-provenance clause for the footer: commit time + a link to the
// Actions run that built this page, degrading to just the commit when the
// workflow env vars are absent.
function deployProvenance(): string {
  const commit = `commit <code>${escapeHtml(BUILD_SHA)}</code>${BUILD_COMMIT_TIME !== '' ? ` (committed ${escapeHtml(formatTimestamp(BUILD_COMMIT_TIME))})` : ''}`;
  let via = '';
  if (RUN_ID !== '' && REPO_SLUG !== '') {
    const runLabel = RUN_NUMBER !== '' ? `run #${escapeHtml(RUN_NUMBER)}` : 'the build run';
    via = ` via <a href="${SERVER_URL}/${REPO_SLUG}/actions/runs/${encodeURIComponent(RUN_ID)}">${runLabel}</a>${BUILD_TIME !== '' ? ` (${escapeHtml(formatTimestamp(BUILD_TIME))})` : ''}`;
  } else if (BUILD_TIME !== '') {
    via = ` on ${escapeHtml(formatTimestamp(BUILD_TIME))}`;
  }
  return `Regenerated from ${commit}${via}.`;
}

interface PageOptions {
  metaJsonHref?: string;
  currentNav?: string;
  // Repo-relative path (forward slashes) of what this page presents: a
  // directory for entry pages, a file for rendered documents. Rendered as
  // a footer link to the exact GitHub location - both the way to browse
  // the raw data and the "edit this page" path (GitHub's own edit button
  // takes over from the blob view).
  sourcePath?: string;
}

// One consistent navigation strip on every generated page (no arrow - the
// old "← callsign lookup" wrongly implied where the visitor came from); the
// current page is named but not self-linked.
function navHtml(depthToRoot: number, currentNav?: string): string {
  const rootPath = '../'.repeat(depthToRoot);
  const navItems: [string, string][] = [
    ['Lookup', `${rootPath}index.html`],
    ['Statistics', `${rootPath}statistics.html`],
    ['Explore', `${rootPath}explore.html`],
    ['Dataset index', `${rootPath}datasets/index.html`],
    ['Repository', REPO_URL],
  ];
  return navItems
    .map(([label, href]) => (label === currentNav ? `<strong>${label}</strong>` : `<a href="${href}">${label}</a>`))
    .join(' · ');
}

function footerHtml(metaJsonHref?: string, sourcePath?: string): string {
  // On entry pages the footer's meta.json mention links to THAT entry's
  // meta; elsewhere it stays plain text (a generic link would mislead).
  const metaMention = metaJsonHref === undefined ? '<code>meta.json</code>' : `<a href="${metaJsonHref}"><code>meta.json</code></a>`;
  const isFile = sourcePath !== undefined && /\.[a-z]+$/i.test(sourcePath);
  const sourceLink = sourcePath === undefined ? '' :
    ` <a href="${REPO_URL}/${isFile ? 'blob' : 'tree'}/main/${sourcePath}">${isFile ? 'View or edit this page’s source on GitHub' : 'Browse this entry’s directory on GitHub'}</a>.`;
  return `<p><small>Derived from the committed archive; provenance and integrity hashes live in each entry's ${metaMention}.${sourceLink} ${deployProvenance()} Maintained by Roger Howell (M7TEE).</small></p>`;
}

function htmlPage(title: string, depthToRoot: number, body: string[], options: PageOptions = {}): string {
  const { metaJsonHref, currentNav, sourcePath } = options;
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${PAGE_STYLE}</head>`,
    '<body>',
    `<nav><p>${navHtml(depthToRoot, currentNav)}</p></nav>`,
    ...body,
    footerHtml(metaJsonHref, sourcePath),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Richer, card-based styling for the redesigned entry pages (the static
// half of "variant Q"): theme-aware via prefers-color-scheme, a hero
// column beside an At-a-glance sidebar, deep-linkable :target inspect tabs,
// the fixed-slot download grid, and the Notable coda. Entry pages only;
// the other generated pages keep PAGE_STYLE until the site-wide style pass.
const ENTRY_STYLE = [
  '<style>',
  ':root{--ink:#1a1a1a;--paper:#f6f6f4;--card:#fff;--line:#dcdcd8;--muted:#6b6b6b;--accent:#14506e;--slot:#faf9f6;--good:#3f7d55;--warnbg:#fbeee2;--warnline:#c98a3f;--warnink:#7a3d00;--note:#eef3f4;--bar:#c9d7dc;--marker:#b23}',
  '@media(prefers-color-scheme:dark){:root{--ink:#e6e6e6;--paper:#111;--card:#191919;--line:#333;--muted:#9a9a9a;--accent:#7fbcd9;--slot:#141414;--good:#7fbf97;--warnbg:#2a2016;--warnline:#8a5a1f;--warnink:#e8b877;--note:#15211f;--bar:#2c4048;--marker:#e58}}',
  '*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;color:var(--ink);background:var(--paper);line-height:1.55}',
  '.wrap{max-width:76rem;margin:0 auto;padding:1.4rem 1.2rem 3rem}',
  'nav{font-size:.92rem;color:var(--muted)}nav a{color:var(--accent);text-decoration:none}a{color:var(--accent)}',
  'h1{font-size:1.8rem;margin:.7rem 0 .1rem;line-height:1.15}.subtitle{color:var(--muted);margin:.1rem 0 1rem;font-size:.94rem}.subtitle code{color:var(--muted)}',
  'section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.9rem 1.2rem 1.1rem;margin:0 0 1.05rem}section>h2{font-size:1.02rem;margin:.2rem 0 .7rem}',
  '.notice{display:flex;gap:.5rem;align-items:baseline;font-size:.86rem;color:var(--muted);border:1px solid var(--line);border-left:4px solid var(--good);border-radius:8px;padding:.5rem .8rem;margin:0 0 1.05rem;background:var(--card)}',
  '.notice.warn{border:1px solid var(--warnline);border-left-width:4px;background:var(--warnbg);color:var(--warnink)}.notice b{color:inherit}',
  'details.notice.provenance{display:block}details.notice.provenance summary{cursor:pointer}details.notice.provenance .pdetail{margin-top:.5rem}details.notice.provenance .pdetail p{margin:.35rem 0}',
  '.main-region{display:flex;gap:1.05rem;align-items:flex-start;flex-wrap:wrap}',
  '.col{flex:1 1 26rem;order:1;min-width:0;display:flex;flex-direction:column;gap:1.05rem}.col section{margin:0}.side{flex:0 0 16.5rem;order:2}',
  '.nav-side{flex:0 0 13rem;order:0;font-size:.83rem}',
  '.nav-side h2{font-size:.95rem;margin:.2rem 0 .5rem}',
  '.dlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.35rem}.dlist li{margin:0}',
  '.dlist a{display:block;text-decoration:none;color:inherit}',
  '.dlist a>.dpitch,.dlist a>.dcap,.dcur>.dpitch,.dcur>.dcap{padding-inline:.5rem}',
  '.dlist a,.dcur{padding-block:.35rem;border:1px solid var(--line);border-radius:6px;background:var(--slot)}',
  '.dlist a:hover{border-color:var(--accent)}',
  '.dcur{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}',
  '.dpitch{display:block}.dpitch .src{color:var(--muted);font-weight:400;font-size:.76rem}.dpitch b{font-variant-numeric:tabular-nums}',
  '.gap{color:var(--muted);font-weight:400}',
  '.dcap{display:block;margin-top:.15rem;color:var(--muted);font-size:.76rem;line-height:1.3}',
  '.nav-side details{margin-top:.45rem}.nav-side summary{cursor:pointer;color:var(--muted);font-size:.78rem;padding:.2rem 0}.nav-side details .dlist{margin-top:.35rem}',
  '@media(max-width:48rem){.col{order:2;flex-basis:100%}.side{order:1;flex-basis:100%}.nav-side{order:3;flex-basis:100%}}',
  '.headline{font-size:1.5rem;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}.headline small{font-size:.8rem;font-weight:400;color:var(--muted)}',
  '.bd{margin:.7rem 0 0}.bd h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.7rem 0 .3rem;font-weight:600}',
  '.brow{display:flex;align-items:baseline;gap:.4rem;font-size:.85rem;padding:.14rem 0;position:relative}.brow .lab{flex:1}.brow .lab a{color:var(--accent)}',
  '.brow .pct{color:var(--muted);font-size:.76rem;min-width:2.4rem;text-align:right}.brow b{font-variant-numeric:tabular-nums;font-weight:600;min-width:4rem;text-align:right}',
  '.brow .barbg{position:absolute;left:0;bottom:0;height:2px;background:var(--bar)}',
  '.lvl{color:var(--muted);font-weight:400;font-size:.85em}.prefixscroll{max-height:13rem;overflow-y:auto;margin-right:-.3rem;padding-right:.3rem}',
  '.seriesnav{color:var(--muted);text-decoration:none;font-size:.85em}.seriesnav:hover{color:var(--accent)}',
  '.attr{margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted)}.attr a{color:var(--accent)}.attr div{margin:.15rem 0}.attr b{color:var(--ink)}',
  '.notable{margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--line)}.notable h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 .3rem;font-weight:600}',
  '.notable ul{list-style:none;margin:0;padding:0}.notable li{font-size:.85rem;padding-left:1rem;position:relative;margin:.3rem 0}.notable li::before{content:"›";position:absolute;left:0;color:var(--accent)}.notable .rel{color:var(--muted)}.notable b{color:var(--ink)}',
  '.tablist{display:flex;flex-wrap:wrap;gap:.35rem;margin:.1rem 0 .8rem}.tablist a{font-size:.85rem;padding:.32rem .7rem;border:1px solid var(--line);border-radius:999px;color:var(--muted);text-decoration:none}',
  '.panel{display:none;scroll-margin-top:5rem}.panel:target{display:block}.tabs:not(:has(.panel:target)) .panel.first{display:block}',
  '.panel .lead{font-size:.9rem;color:var(--muted);margin:.1rem 0 .6rem}',
  'table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{text-align:left;padding:.28rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}',
  'code{font-size:.92em}.marker{color:var(--marker)}',
  // Scoped data browser (progressive enhancement)
  '.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0 .5rem}',
  '.chip{font-size:.82rem;padding:.25rem .6rem;border:1px solid var(--line);border-radius:6px;color:var(--muted);cursor:pointer;background:var(--slot)}',
  '.chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}.chip .c{opacity:.7;font-size:.76rem;margin-left:.3rem}',
  '.brow[data-filter-col]{cursor:pointer}.brow[data-filter-col]:hover .lab{text-decoration:underline}',
  '.browser-status{font-size:.83rem;color:var(--muted);margin:.4rem 0}.diffnote{color:var(--accent);font-size:.8rem}',
  // Coordinated browser: pills, toolbar, sortable headers, per-column filters
  '.pills{display:flex;flex-wrap:wrap;gap:.35rem;margin:.4rem 0}.pill{display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;padding:.15rem .5rem;border:1px solid var(--accent);border-radius:999px;color:var(--accent);background:var(--slot)}',
  '.pill.custom{border-style:dashed}.pill button{border:none;background:none;color:inherit;cursor:pointer;font-size:.85rem;padding:0;line-height:1}',
  '.browser-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.5rem 0 .2rem;font-size:.83rem}',
  '.pagesize{width:4.2rem;font:inherit;font-size:.82rem;padding:.15rem .3rem;border:1px solid var(--line);border-radius:5px;background:transparent;color:inherit}',
  'button.pg{font:inherit;font-size:.82rem;padding:.2rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--slot);color:var(--accent);cursor:pointer}button.pg:disabled{opacity:.4;cursor:default}',
  'th.sortable{cursor:pointer;white-space:nowrap}th.sortable:hover{color:var(--accent)}',
  'tr.colfilters th{padding:.15rem .3rem}tr.colfilters input{width:100%;min-width:5rem;font:inherit;font-size:.8rem;padding:.15rem .3rem;border:1px solid var(--line);border-radius:5px;background:transparent;color:inherit}',
  'rect.barfilter,text.tickfilter,.chart tr.explore{cursor:pointer}rect.barfilter:hover,text.tickfilter:hover{fill:var(--ink)}',
  '.examples{margin-top:.5rem}.examples summary{cursor:pointer;color:var(--accent);font-size:.86rem}.exlist{display:flex;flex-direction:column;gap:.25rem;margin-top:.4rem;align-items:flex-start}',
  'button.exq{font:inherit;font-size:.83rem;padding:.2rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--slot);color:var(--accent);cursor:pointer;text-align:left}',
  '.sqlbox{margin-top:.6rem}.sqlbox summary{cursor:pointer;color:var(--accent);font-size:.86rem}',
  '.sqlbox textarea{width:100%;font-family:ui-monospace,monospace;font-size:.85rem;padding:.5rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;margin-top:.4rem}',
  '.sqlbox button.run{font:inherit;font-size:.85rem;padding:.3rem .8rem;margin-top:.4rem;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:#fff;cursor:pointer}',
  '.tier h3{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.6rem 0 .45rem;font-weight:600}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.5rem}',
  '.slot{border:1px solid var(--line);border-radius:9px;padding:.5rem .65rem;background:var(--slot);min-height:3.6rem}.slot .name{font-weight:650}.slot .meta{color:var(--muted);font-size:.77rem}.slot .desc{color:var(--muted);font-size:.78rem;line-height:1.25;margin-top:.15rem}',
  '.slot.empty{border-style:dashed;opacity:.68}.slot.empty .name{color:var(--muted);font-weight:600}.slot.empty .tag{font-size:.74rem;color:var(--muted);font-style:italic}',
  // Distribution charts (accessible static SVG)
  '.chart{margin:0 0 1.1rem}.chart figcaption{font-weight:600;font-size:.92rem;margin:0 0 .3rem}',
  '.chart svg{width:100%;height:auto;max-height:190px;display:block}',
  '.chart details{margin-top:.3rem}.chart summary{cursor:pointer;color:var(--accent);font-size:.84rem}',
  '.chart details table{margin-top:.4rem;max-width:22rem}.chart tr.explore{cursor:pointer}.chart tr.explore:hover td:first-child{text-decoration:underline;color:var(--accent)}',
  '.linkout{display:block;margin:.1rem 0 1.05rem;padding:.7rem 1.1rem;border:1px dashed var(--line);border-radius:12px;font-size:.9rem}',
  'footer{color:var(--muted);font-size:.83rem;margin-top:.6rem;line-height:1.6}footer a{color:var(--accent)}',
  '</style>',
].join('');

// Full HTML for a redesigned entry page (depth 3: datasets/{lane}/{key}/).
function entryPage(title: string, body: string[], options: PageOptions = {}): string {
  const { metaJsonHref, sourcePath } = options;
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${ENTRY_STYLE}</head>`,
    '<body>',
    '<div class="wrap">',
    `<nav>${navHtml(3)}</nav>`,
    ...body,
    footerHtml(metaJsonHref, sourcePath).replace('<p><small>', '<footer>').replace('</small></p>', '</footer>'),
    '</div>',
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


interface SheetsIndicative {
  note?: string;
  sheets: { name: string; approxRows?: number; cols?: string; datasetClass?: string }[];
}

function asSheetsIndicative(value: unknown): SheetsIndicative | undefined {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as SheetsIndicative).sheets)) return undefined;
  return value as SheetsIndicative;
}


// One deterministic zip per entry: every archived file, the
// datapackage.json descriptor, AND the lane's data dictionary (the
// committed authoritative sources, under docs/ inside the zip), so a
// single download carries the data, its provenance/integrity record and
// the vocabulary to interpret it. Zip bytes only change when content
// changes - timestamps are pinned by the writer - so a dictionary edit
// legitimately re-versions every zip that carries it. Returns the zip's
// byte size.
function writeEntryZip(sourceDir: string, targetDir: string, key: string, descriptorJson: string, dictionarySources: string[]): number {
  const entries = fs.readdirSync(sourceDir).sort().map(name => ({
    name,
    data: fs.readFileSync(path.join(sourceDir, name)),
  }));
  entries.push({ name: 'datapackage.json', data: Buffer.from(descriptorJson, 'utf8') });
  for (const source of dictionarySources) {
    entries.push({ name: `docs/${path.basename(source)}`, data: fs.readFileSync(path.join(REPO_ROOT, source)) });
  }
  const zip = buildZip(entries);
  fs.writeFileSync(path.join(targetDir, `${key}.zip`), zip);
  return zip.length;
}

// The lane-appropriate data dictionary: FOI entries carry the FOI schema
// registry; open-data entries carry the normalised schema and the flag
// registry their metrics reference.
const FOI_DICTIONARY_SOURCES = ['docs/foi-schemas.md'];
const OPEN_DATA_DICTIONARY_SOURCES = ['docs/normalised-schema.md', 'reference-data/flags.md'];


// ---- Redesigned entry-page components (variant Q, static half) ----

function noticeStrip(warn: boolean, inner: string): string {
  return `<div class="notice${warn ? ' warn' : ''}"><span>${warn ? '⚠' : 'ⓘ'}</span><span>${inner}</span></div>`;
}

// Reconstructed-provenance notice: keeps the "reconstructed, not first-hand"
// caveat prominent in the always-visible summary, and discloses the entry's
// own reconstructionNotes (and the git commit it was recovered from, when
// known) inline — one click away, rather than sending the reader off to
// fetch meta.json. Notice styling matches noticeStrip; the disclosure is a
// details element (invalid nested inside noticeStrip's span), so it is built
// directly here.
function reconstructionNotice(provenance: string, reconstructionNotes?: string, gitCommitSha?: string): string {
  const caveat = `<em>Provenance: ${escapeHtml(provenance.replace(/-/g, ' '))} — not fetched first-hand by the mirror.</em>`;
  const detail: string[] = [];
  if (reconstructionNotes !== undefined) detail.push(`<p>${escapeHtml(reconstructionNotes)}</p>`);
  if (gitCommitSha !== undefined) detail.push(`<p>Recovered from git commit <code>${escapeHtml(gitCommitSha)}</code>.</p>`);
  detail.push(`<p><small>Full provenance and integrity record in <a href="meta.json">meta.json</a>.</small></p>`);
  return `<details class="notice provenance"><summary><span aria-hidden="true">ⓘ</span> ${caveat}</summary><div class="pdetail">${detail.join('')}</div></details>`;
}

// Coverage / provenance / verified-quality notices as full-width strips
// above the two-column region. Safety information (a coverage-affecting
// quality observation) renders amber.
function coverageNotices(meta: {
  provenance?: string;
  reconstructionNotes?: string;
  gitCommitSha?: string;
  intendedCoverage?: { complete: boolean; scopeNotes?: string };
  qualityObservations?: { statement: string; evidence: string; coverageAffecting?: boolean }[];
}): string[] {
  const out: string[] = [];
  if (meta.provenance !== undefined && meta.provenance !== 'live') {
    out.push(reconstructionNotice(meta.provenance, meta.reconstructionNotes, meta.gitCommitSha));
  }
  if (meta.intendedCoverage?.complete === false) {
    out.push(noticeStrip(true, `<b>Declared-partial publication:</b> ${escapeHtml(meta.intendedCoverage.scopeNotes ?? 'the publisher presented this as a partial dataset')}. Absence of a callsign from this publication is not evidence of anything.`));
  } else if (meta.intendedCoverage?.complete === true) {
    out.push(noticeStrip(false, `Declared <b>complete</b> — the publisher's stated intent, not a verified guarantee. <a href="../../docs/normalised-schema.html">How we read coverage →</a>`));
  }
  for (const o of meta.qualityObservations ?? []) {
    const lead = o.coverageAffecting === true ? '<b>Data-quality caveat (affects coverage):</b> ' : '<b>Data-quality note:</b> ';
    out.push(noticeStrip(o.coverageAffecting === true, `${lead}${escapeHtml(o.statement)} <small>(${escapeHtml(o.evidence)})</small>`));
  }
  return out;
}

interface InspectTab { id: string; label: string; panel: string }

// Deep-linkable :target tabs (pure CSS, hash survives reload). The first
// panel shows by default; the active tab is highlighted via :has().
function inspectTabsHtml(tabs: InspectTab[]): string {
  if (tabs.length === 0) return '';
  const activeRules = tabs.map(t => `.tabs:has(#${t.id}:target) a[href="#${t.id}"]`).join(',')
    + `,.tabs:not(:has(.panel:target)) a[href="#${tabs[0].id}"]`;
  return [
    '<section class="tabs">',
    `<style>${activeRules}{background:var(--accent);color:#fff;border-color:var(--accent)}</style>`,
    '<h2>Inspect a file</h2>',
    `<div class="tablist">${tabs.map(t => `<a href="#${t.id}">${escapeHtml(t.label)}</a>`).join('')}</div>`,
    ...tabs.map((t, i) => `<div class="panel${i === 0 ? ' first' : ''}" id="${t.id}">${t.panel}</div>`),
    '</section>',
  ].join('\n');
}

// A CSV file's own column list, rendered from its header row.
function csvSchemaPanel(filePath: string, rowNote: string): string {
  const fields = csvHeaderFields(filePath);
  if (fields === undefined) return `<p class="lead">${escapeHtml(rowNote)}</p>`;
  return `<p class="lead">${escapeHtml(rowNote)} · ${fields.length} columns.</p><table><tr><th>column</th></tr>${fields.map(f => `<tr><td><code>${escapeHtml(f.name)}</code></td></tr>`).join('')}</table>`;
}

function downloadSlot(name: string, href: string, meta: string, desc: string): string {
  return `<div class="slot"><span class="name"><a href="${href}">${escapeHtml(name)}</a></span> <span class="meta">${escapeHtml(meta)}</span><div class="desc">${escapeHtml(desc)}</div></div>`;
}
function placeholderSlot(name: string, tag: string): string {
  return `<div class="slot empty"><span class="name">${escapeHtml(name)}</span><br><span class="tag">${escapeHtml(tag)}</span></div>`;
}
function downloadTier(title: string, slots: string[]): string {
  return `<div class="tier"><h3>${escapeHtml(title)}</h3><div class="grid">${slots.join('')}</div></div>`;
}

// Vertical breakdown rows with a subtle proportion bar and a de-emphasised
// percentage; the label optionally links (largest = whole; caller supplies).
// Never show a bare empty string as a label/key/header: a blank value is
// itself information (a record the source left empty), so name it. Matches
// the humanising used elsewhere ((blank status), (none), (empty value)).
function humaniseLabel(value: string): string {
  return value === '' ? '(blank)' : value;
}

// Marks a breakdown row / chart element as a filter trigger for the scoped
// browser: clicking toggles this column=value into the shared facet set.
function facetAttr(col: string, value: string): string {
  return ` data-filter-col="${col}" data-filter-val="${escapeHtml(value)}" role="button" tabindex="0"`;
}

function breakdownRows(counts: [string, number][], total: number, linkFor?: (v: string) => string | undefined, rowAttr?: (v: string) => string): string {
  return counts.map(([label, n]) => {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const pctText = pct === 0 && n > 0 ? '<1%' : `${pct}%`;
    const href = linkFor?.(label);
    const shown = escapeHtml(humaniseLabel(label));
    const lab = href === undefined ? shown : `<a href="${href}">${shown}</a>`;
    return `<div class="brow"${rowAttr?.(label) ?? ''}><span class="lab">${lab}</span><span class="pct">${pctText}</span><b>${n.toLocaleString('en-GB')}</b><span class="barbg" style="width:${Math.min(pct, 100)}%"></span></div>`;
  }).join('');
}

// Status and implied-class distributions for an open-data publication,
// read from its normalised.csv (status) and components.csv (implied_class,
// prefix_series). The RSL matrix used to be the components consumer on
// entry pages; it has moved to the statistics home, so this read replaces
// it rather than adding one.
// The forbidden/withheld suffix list's first KNOWN publication: Ofcom's
// August 2019 FOI disclosure (wdtk-596532). A withheld-suffix callsign
// issued on/after this is the "issued while the list existed" case.
const FORBIDDEN_LIST_FIRST_KNOWN = '2019-08-01';

function openDataBreakdowns(sourceDir: string): {
  recordCount: number;
  status: [string, number][];
  impliedClass: [string, number][];
  declared: [string, number][];
  prefixes: [string, number][];
  prefixLevel: Map<string, string>;
  international: number;
  flaggedRows: number;
  forbiddenTotal: number;
  forbiddenSince: number;
} {
  const statusRows = parse(fs.readFileSync(path.join(sourceDir, 'normalised.csv'), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const componentRows = parse(fs.readFileSync(path.join(sourceDir, 'components.csv'), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  // Empty is a distinct, meaningful bucket (a record the source left blank,
  // or an unparseable callsign with no series) - counted as '' and humanised
  // at display, never silently dropped.
  const tally = (rows: Record<string, string>[], column: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) { const v = (r[column] ?? '').trim(); m.set(v, (m.get(v) ?? 0) + 1); }
    return m;
  };
  const prefixLevel = new Map<string, string>();
  for (const r of componentRows) {
    const p = (r.prefix_series ?? '').trim();
    if (p !== '' && !prefixLevel.has(p)) prefixLevel.set(p, (r.implied_class ?? '').trim());
  }
  const flaggedRows = componentRows.filter(r => (r.flags ?? '') !== '').length;
  const international = componentRows.filter(r => (r.callsign ?? '').includes('/')).length;
  // Forbidden-suffix cohort: the whole flagged set, and the subset issued
  // on/after the withheld list's first known publication (Ofcom's August
  // 2019 FOI) - the "issued while the list existed" cases worth inspecting
  // (re-issues and artefacts are innocent explanations; see issue #179).
  const startDateCol = ['licence_version_original_start_date', 'created_date'].find(c => statusRows.some(r => (r[c] ?? '') !== ''));
  const startByCallsign = new Map(statusRows.map(r => [r.callsign, startDateCol === undefined ? '' : (r[startDateCol] ?? '')]));
  let forbiddenTotal = 0; let forbiddenSince = 0;
  for (const r of componentRows) {
    if (!(r.flags ?? '').split(';').includes('forbidden-suffix')) continue;
    forbiddenTotal += 1;
    const d = startByCallsign.get(r.callsign) ?? '';
    if (d !== '' && d >= FORBIDDEN_LIST_FIRST_KNOWN) forbiddenSince += 1;
  }
  const sortDesc = (m: Map<string, number>, n?: number): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  return {
    recordCount: statusRows.length,
    status: sortDesc(tally(statusRows, 'status')),
    impliedClass: sortDesc(tally(componentRows, 'implied_class')),
    declared: sortDesc(tally(statusRows, 'product')),
    prefixes: sortDesc(tally(componentRows, 'prefix_series')),
    prefixLevel,
    international,
    flaggedRows,
    forbiddenTotal,
    forbiddenSince,
  };
}

// A static preview of a CSV's first rows (reads only the head buffer, not
// the whole 158k-row file). Columns with no value in the sample are
// dropped so the preview stays legible.
function csvPreviewTable(filePath: string, sampleSize = 12): string {
  if (!fs.existsSync(filePath)) return '';
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(128 * 1024);
  const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  const lines = buffer.toString('utf8', 0, read).split('\n').filter(l => l.length > 0).slice(0, sampleSize + 1);
  if (lines.length < 2) return '';
  const rows = parse(lines.join('\n'), { columns: true, bom: true }) as Record<string, string>[];
  const headers = Object.keys(rows[0]).filter(h => rows.some(r => (r[h] ?? '') !== ''));
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${headers.map(h => `<td>${escapeHtml(r[h] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// The anomaly-flag table (first-sentence meanings + registry link), used
// in the stats.json inspect panel.
function anomalyFlagsHtml(flags: Record<string, number>): string {
  const registry = new Map(parseFlagRegistry().map(r => [r.flag, r.meaning]));
  const entries = Object.entries(flags).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="lead">No data-quality flags recorded.</p>';
  const rows = entries.map(([flag, count]) => {
    const meaning = (registry.get(flag) ?? '').split(/(?<=\.)\s/, 1)[0];
    return `<tr><td><code>${escapeHtml(flag)}</code></td><td class="n">${count.toLocaleString('en-GB')}</td><td>${renderInline(meaning)} <a href="../../docs/flags.html">registry →</a></td></tr>`;
  }).join('');
  return `<table><tr><th>flag</th><th class="n">rows</th><th>meaning</th></tr>${rows}</table>`;
}

// The At-a-glance sidebar for an open-data publication: headline count,
// status/licence-level breakdowns with bars, largest prefixes (linked to
// their series pages), attribution, and the Notable coda.
function atAGlanceOpenData(sourceDir: string, key: string, previousKey: string | undefined, stats: OpenDataStats, meta: {
  sourceUrl?: string; ofcomReportedUpdateIso?: string; ofcomReportedUpdate?: string; fetchedAt?: string;
  diffSummary?: OpenDataDiffSummary;
}): string {
  const bd = openDataBreakdowns(sourceDir);
  const allocatedCount = bd.status.find(([s]) => s === 'Allocated')?.[1] ?? 0;

  // Notable: computed findings with the drill-downs Roger asked to keep.
  // Row-level filtered links are correct only for the latest publication
  // (the whole-register lookup ≈ this publication); the scoped, per-
  // publication browser in 3b makes them exact for every entry.
  const notable: string[] = [];
  // The forbidden-suffix cohort is the interesting story, not the raw count:
  // two filter links - the whole flagged set, and the narrower "issued while
  // the withheld list existed" subset (the second only when non-empty).
  if (bd.forbiddenTotal > 0) {
    const allSql = `SELECT callsign, cleaned, status, prefix_series, implied_class FROM register_history WHERE dataset = '${key}' AND suffix IN (SELECT suffix FROM ref_forbidden_suffixes) ORDER BY callsign`;
    const sinceSql = `SELECT callsign, status, prefix_series, licence_version_original_start_date AS issued FROM register_history WHERE dataset = '${key}' AND suffix IN (SELECT suffix FROM ref_forbidden_suffixes) AND licence_version_original_start_date >= '${FORBIDDEN_LIST_FIRST_KNOWN}' ORDER BY issued`;
    const sinceLink = bd.forbiddenSince > 0
      ? ` — <a href="#" data-browser-sql="${escapeHtml(sinceSql)}"><b>${bd.forbiddenSince.toLocaleString('en-GB')}</b> issued since the 2019 list</a>, worth a look`
      : '';
    notable.push(`<li><a href="#" data-browser-sql="${escapeHtml(allSql)}"><b>${bd.forbiddenTotal.toLocaleString('en-GB')}</b> withheld-suffix</a> (mostly legacy holders)${sinceLink}.</li>`);
  }
  const topFlag = Object.entries(stats.callsignFlags).sort((a, b) => b[1] - a[1])[0];
  if (topFlag !== undefined && topFlag[0] !== 'forbidden-suffix') notable.push(`<li><b>${topFlag[1].toLocaleString('en-GB')}</b> rows flagged <a href="../../docs/flags.html"><code>${escapeHtml(topFlag[0])}</code></a>.</li>`);
  const unparseable = stats.parseStatuses.unparseable ?? 0;
  if (unparseable > 0) notable.push(`<li><b>${unparseable.toLocaleString('en-GB')}</b> callsign${unparseable === 1 ? '' : 's'} don't parse — likely upstream corruption.</li>`);
  const diff = meta.diffSummary;
  if (diff !== undefined && diff.previousArchiveKey === key && previousKey !== undefined) {
    notable.push(`<li class="rel"><b>Re-fetch:</b> byte-identical to the earlier fetch. Compare with <a href="../${escapeHtml(previousKey)}/index.html">${humanDate(previousKey)}</a>.</li>`);
  } else if (diff !== undefined) {
    notable.push(`<li class="rel"><b>vs <a href="../${escapeHtml(diff.previousArchiveKey)}/index.html">${humanDate(diff.previousArchiveKey)}</a>:</b> ${diff.added.toLocaleString('en-GB')} added, ${diff.removed.toLocaleString('en-GB')} removed, ${diff.fieldChanged.toLocaleString('en-GB')} changed.</li>`);
  }

  const publishedIso = meta.ofcomReportedUpdateIso ?? key;
  // Breakdown row with the shared bar + %; the prefix rows carry a
  // de-emphasised inferred level, the declared-level rows a shortened
  // product. All are click-to-filter facets.
  const bar = (n: number): string => {
    const pct = bd.recordCount > 0 ? Math.round((n / bd.recordCount) * 100) : 0;
    return `<span class="pct">${pct === 0 && n > 0 ? '<1%' : `${pct}%`}</span><b>${n.toLocaleString('en-GB')}</b><span class="barbg" style="width:${Math.min(pct, 100)}%"></span>`;
  };
  const shortProduct = (p: string): string => p === '' ? '(blank)' : p.replace(/^Amateur /, '').replace(/ Radio Licence$/, '');
  // The prefix label FILTERS on click (the row is the facet trigger); the
  // small ↗ is the only link, to the series page (the row handler ignores
  // clicks on <a>). Previously the whole label navigated, surprising anyone
  // expecting a filter.
  const prefixRows = bd.prefixes.map(([p, n]) => {
    const level = bd.prefixLevel.get(p) ?? '';
    const tag = level === '' ? '' : ` <small class="lvl">${escapeHtml(level.toLowerCase())}</small>`;
    return `<div class="brow"${facetAttr('prefix_series', p)}><span class="lab">${escapeHtml(displaySeries(p))}${tag} <a class="seriesnav" href="../../../series/${seriesSlug(p)}.html" title="series page for ${escapeHtml(displaySeries(p))}" aria-label="series page">↗</a></span>${bar(n)}</div>`;
  }).join('');
  const declaredRows = bd.declared.map(([p, n]) => `<div class="brow"${facetAttr('product', p)}><span class="lab">${escapeHtml(shortProduct(p))}</span>${bar(n)}</div>`).join('');
  const intlExpr = "CASE WHEN callsign LIKE '%/%' THEN 'yes' ELSE 'no' END";
  return [
    '<section>',
    '<h2>At a glance</h2>',
    `<div class="headline">${bd.recordCount.toLocaleString('en-GB')} <small>register rows · ${allocatedCount.toLocaleString('en-GB')} allocated</small></div>`,
    bd.status.length > 0 ? `<div class="bd"><h3>Status</h3>${breakdownRows(bd.status, bd.recordCount, undefined, label => facetAttr('status', label))}</div>` : '',
    bd.impliedClass.length > 0 ? `<div class="bd"><h3>Licence level (implied)</h3>${breakdownRows(bd.impliedClass, bd.recordCount, undefined, label => facetAttr('implied_class', label))}</div>` : '',
    bd.declared.length > 0 ? `<div class="bd"><h3>Licence level (declared)</h3>${declaredRows}</div>` : '',
    bd.prefixes.length > 0 ? `<div class="bd"><h3>Prefixes <small class="lvl">— all ${bd.prefixes.length}, with inferred level</small></h3><div class="prefixscroll">${prefixRows}</div><div class="brow"><a href="../../../series/index.html">all series →</a></div></div>` : '',
    bd.international > 0 ? `<div class="bd"><h3>International / visitor</h3><div class="brow" data-filter-expr="${escapeHtml(intlExpr)}" data-filter-val="yes" data-filter-label="international" role="button" tabindex="0"><span class="lab">contain <code>/</code> (e.g. <code>M/</code>) — country lookup planned</span>${bar(bd.international)}</div></div>` : '',
    '<div class="attr">',
    `<div><b>Source</b> · ${meta.sourceUrl !== undefined ? `<a href="${escapeHtml(meta.sourceUrl)}">Ofcom open-data page →</a>` : 'Ofcom open-data page'}</div>`,
    `<div>Published ${escapeHtml(humanDate(publishedIso))}${meta.fetchedAt !== undefined ? ` · fetched ${escapeHtml(humanDate(meta.fetchedAt.slice(0, 10)))}` : ''}</div>`,
    `<div>${bd.flaggedRows.toLocaleString('en-GB')} rows carry a quality flag</div>`,
    '</div>',
    notable.length > 0 ? `<div class="notable"><h3>Notable</h3><ul>${notable.join('')}</ul></div>` : '',
    '</section>',
  ].filter(s => s !== '').join('\n');
}

// An accessible, progressive-enhancement bar chart: the data table IS the
// content (crawlable, screen-reader-native, survives with no SVG); the
// inline SVG is a visual layer over it inside a <figure>. The SVG carries
// role="img" + <title>/<desc> for a spoken summary, a per-bar <title> for
// hover, and text value labels (never colour/height alone). Theme-aware via
// the CSS custom properties; no client JS, no charting dependency (d3 and
// friends belong in the interactive downstream graph layer, not this
// static record).
// facetExpr, when given, is a SQL expression (e.g. CAST(LENGTH(callsign) AS
// TEXT)) that both the bars and the data-table rows carry as a filter
// trigger, so clicking a bar toggles that value into the scoped browser's
// facet set (crossfilter-style coordination). Trusted build-time SQL only.
function svgBarChart(idBase: string, heading: string, summary: string, unit: string, data: [string, number][], facetExpr?: string): string {
  if (data.length === 0) return '';
  const max = Math.max(...data.map(d => d[1]));
  const width = 600; const chartH = 150; const padTop = 12; const padBottom = 28; const gap = data.length > 40 ? 1 : 2;
  const barW = (width - (data.length - 1) * gap) / data.length;
  const labelEvery = data.length <= 14 ? 1 : Math.ceil(data.length / 12);
  const parts = data.map(([label, n], i) => {
    const shown = escapeHtml(humaniseLabel(label));
    const h = max > 0 ? (n / max) * chartH : 0;
    const x = i * (barW + gap);
    const y = padTop + (chartH - h);
    const cx = (x + barW / 2).toFixed(1);
    const value = data.length <= 14 ? `<text x="${cx}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${n.toLocaleString('en-GB')}</text>` : '';
    // Bar and axis tick carry the same facet trigger: in a highly skewed
    // distribution a tiny bar is a near-single-pixel click target, so the
    // label under it keeps the category clickable too.
    const trigger = facetExpr === undefined ? '' : ` role="button" tabindex="0" data-filter-expr="${escapeHtml(facetExpr)}" data-filter-val="${escapeHtml(label)}"`;
    const tick = i % labelEvery === 0 ? `<text x="${cx}" y="${(padTop + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)"${trigger === '' ? '' : ` class="tickfilter"${trigger}`}>${shown}</text>` : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(barW, 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent)"${trigger === '' ? '' : ` class="barfilter"${trigger}`}><title>${shown}: ${n.toLocaleString('en-GB')}</title></rect>${value}${tick}`;
  }).join('');
  // Bars and data-table rows both toggle the value into the scoped browser
  // (crossfilter-style): clicking adds to the current filters, not replaces.
  const tableRows = data.map(([label, n]) => {
    const attrs = facetExpr === undefined ? '' : ` class="explore" role="button" tabindex="0" data-filter-expr="${escapeHtml(facetExpr)}" data-filter-val="${escapeHtml(label)}"`;
    return `<tr${attrs}><td>${escapeHtml(humaniseLabel(label))}</td><td class="n">${n.toLocaleString('en-GB')}</td></tr>`;
  }).join('');
  const exploreHint = facetExpr === undefined ? '' : ' — click a bar or row to filter the browser above';
  return `<figure class="chart"><figcaption>${escapeHtml(heading)}</figcaption>`
    + `<svg viewBox="0 0 ${width} ${padTop + chartH + padBottom}" role="img" aria-labelledby="${idBase}-t ${idBase}-d" preserveAspectRatio="xMidYMid meet">`
    + `<title id="${idBase}-t">${escapeHtml(heading)}</title><desc id="${idBase}-d">${escapeHtml(summary)}</desc>${parts}</svg>`
    + `<details><summary>Data table${exploreHint}</summary><table><tr><th>${escapeHtml(unit)}</th><th class="n">callsigns</th></tr>${tableRows}</table></details></figure>`;
}

// Per-publication distributions computed at build: callsign length, issue
// year (from the best available start-date column), and issuance in the
// trailing 12 months before THIS publication's date (anchored on the
// publication date, not today, so the build stays reproducible), split by
// implied licence level.
function distributions(sourceDir: string, key: string): {
  length: [string, number][];
  suffixLength: [string, number][];
  issueYear: [string, number][];
  recentByClass: [string, number][];
  dateColumn: string | undefined;
} {
  const normRows = parse(fs.readFileSync(path.join(sourceDir, 'normalised.csv'), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const compRows = parse(fs.readFileSync(path.join(sourceDir, 'components.csv'), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const classByCallsign = new Map(compRows.map(r => [r.callsign, r.implied_class]));

  const lengthMap = new Map<number, number>();
  for (const r of normRows) { const len = (r.callsign ?? '').length; if (len > 0) lengthMap.set(len, (lengthMap.get(len) ?? 0) + 1); }
  const length = [...lengthMap.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]): [string, number] => [String(l), n]);

  // Suffix length distinguishes heritage 2-letter callsigns (the G2 series
  // and older G/M holders) from the modern 3-letter allocations.
  const suffixLengthMap = new Map<number, number>();
  for (const r of compRows) { const len = (r.suffix ?? '').length; if (len > 0) suffixLengthMap.set(len, (suffixLengthMap.get(len) ?? 0) + 1); }
  const suffixLength = [...suffixLengthMap.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]): [string, number] => [String(l), n]);

  const dateColumn = ['licence_version_original_start_date', 'created_date'].find(c => normRows.some(r => (r[c] ?? '') !== ''));
  const pubDate = /^\d{4}-\d{2}-\d{2}$/.test(key) ? Date.parse(`${key}T00:00:00Z`) : NaN;
  const cutoff = Number.isNaN(pubDate) ? NaN : pubDate - 365 * 24 * 3600 * 1000;
  const yearMap = new Map<string, number>();
  const recentMap = new Map<string, number>();
  if (dateColumn !== undefined) {
    for (const r of normRows) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r[dateColumn] ?? '');
      if (m === null) continue;
      yearMap.set(m[1], (yearMap.get(m[1]) ?? 0) + 1);
      if (!Number.isNaN(cutoff)) {
        const rowDate = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
        if (rowDate >= cutoff && rowDate <= pubDate) {
          const cls = classByCallsign.get(r.callsign);
          const clsLabel = cls === undefined || cls === '' ? '(unclassified)' : cls;
          recentMap.set(clsLabel, (recentMap.get(clsLabel) ?? 0) + 1);
        }
      }
    }
  }
  const issueYear = [...yearMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, n]): [string, number] => [y, n]);
  const recentByClass = [...recentMap.entries()].sort((a, b) => b[1] - a[1]);
  return { length, suffixLength, issueYear, recentByClass, dateColumn };
}

function distributionsSection(sourceDir: string, key: string): string[] {
  const dist = distributions(sourceDir, key);
  if (dist.length.length === 0 && dist.issueYear.length === 0) return [];
  const dateLabel = dist.dateColumn === 'created_date' ? 'record creation' : 'licence start';
  const recentTotal = dist.recentByClass.reduce((a, b) => a + b[1], 0);
  return [
    '<section><h2>Distributions</h2>',
    dist.length.length > 0 ? svgBarChart('dist-length', 'Callsign length', `Number of callsigns of each length in characters, from ${dist.length[0][0]} to ${dist.length[dist.length.length - 1][0]}.`, 'length (characters)', dist.length, 'CAST(LENGTH(callsign) AS TEXT)') : '',
    dist.suffixLength.length > 0 ? svgBarChart('dist-suffixlen', 'Suffix length', 'Callsigns by suffix length — 2-letter suffixes are heritage (G2 series and older holders), 3-letter the modern allocations.', 'suffix length', dist.suffixLength, 'CAST(LENGTH(suffix) AS TEXT)') : '',
    dist.issueYear.length > 0 && dist.dateColumn !== undefined ? svgBarChart('dist-year', `Issue year (by ${dateLabel})`, `Callsigns by year of ${dateLabel}, from ${dist.issueYear[0][0]} to ${dist.issueYear[dist.issueYear.length - 1][0]}.`, 'year', dist.issueYear, `substr("${dist.dateColumn}", 1, 4)`) : '',
    dist.recentByClass.length > 0 ? `<h3 style="font-size:.92rem;margin:.3rem 0 .4rem">New in the 12 months to ${escapeHtml(humanDate(key))}, by licence level (${recentTotal.toLocaleString('en-GB')} total)</h3>${breakdownRows(dist.recentByClass, recentTotal)}` : '',
    '</section>',
  ].filter(s => s !== '');
}

function buildFoiEntry(outputDir: string, foiDir: string, key: string, summaries: PublicationSummary[], foiEntries: FoiNavEntry[]): { files: CopiedFile[]; meta: FoiEntryMeta; zipBytes: number } {
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

  // Real entry ids get <code> + a link; free-text related notes render as
  // prose - <code>-styling a whole sentence made it read as a dead slug.
  const related = (meta.relatedEntries ?? []).map(rel =>
    `<li>${/^(wdtk|ofcom)-[^\s/]+$/.test(rel.entry) ? `<a href="../${encodeURIComponent(rel.entry)}/index.html"><code>${escapeHtml(rel.entry)}</code></a>` : `<em>${escapeHtml(rel.entry)}</em>`} — ${escapeHtml(rel.relation)}</li>`);

  const descriptor = dataPackage(key, meta.title, files);
  const zipBytes = writeEntryZip(path.join(foiDir, key), targetDir, key, descriptor, FOI_DICTIONARY_SOURCES);
  const sizeMap = new Map(files.map(f => [f.name, formatBytes(f.bytes)]));
  const isDerived = (name: string): boolean => /normalis|extract/i.test(name) || /normalis|extract/i.test(meta.files[name]?.role ?? '');

  // Inspect: a tab per declared file (workbook → its sheets; CSV → column
  // schema; document → role + contents + witnesses), plus meta.json.
  const dataTabs: InspectTab[] = Object.keys(meta.files).map((name, i) => {
    const decl = meta.files[name];
    const indicative = asSheetsIndicative(decl.sheetsIndicative);
    const roleLine = [decl.role, decl.contentsIndicative].filter(Boolean).join(' — ');
    let panel: string;
    if (indicative !== undefined) {
      const rows = indicative.sheets.map(s => `<tr><td>${escapeHtml(s.name)}</td><td class="n">${s.approxRows === undefined ? '—' : `~${s.approxRows.toLocaleString('en-GB')}`}</td><td>${escapeHtml(s.cols ?? '—')}</td><td>${s.datasetClass === undefined ? '—' : `<code>${escapeHtml(s.datasetClass)}</code>`}</td></tr>`).join('');
      panel = `<p class="lead">${escapeHtml(roleLine)}</p><table><tr><th>sheet</th><th class="n">rows</th><th>cols</th><th>class</th></tr>${rows}</table>${indicative.note !== undefined ? `<p class="lead">${escapeHtml(indicative.note)}</p>` : ''}`;
    } else if (name.endsWith('.csv')) {
      panel = csvSchemaPanel(path.join(targetDir, name), roleLine || 'CSV');
    } else {
      // Markdown files are rendered to a readable .md.html sibling; link
      // it as the default view, with the verbatim .md a download away.
      const renderedLink = name.endsWith('.md') && fs.existsSync(path.join(targetDir, `${name}.html`))
        ? ` <a href="${encodeURIComponent(`${name}.html`)}">read the rendered version →</a>` : '';
      panel = `<p class="lead">${escapeHtml(roleLine || 'archived file')}.${renderedLink}</p>`;
    }
    // Witness provenance (recovered-from links) belongs on every file's
    // panel, whatever its type - it is how a reader verifies the source.
    return { id: `i-${i}`, label: name, panel: panel + witnessLinks(decl.witnesses) };
  });
  dataTabs.push({ id: 'i-meta', label: 'meta.json', panel: `<table><tr><th>outcome</th><td>${escapeHtml(meta.outcome)}</td></tr><tr><th>dataset classes</th><td>${meta.datasetClasses.map(c => `<code>${escapeHtml(c)}</code>`).join(', ')}</td></tr><tr><th>data vintage</th><td>${escapeHtml(meta.dataVintage ?? '—')}</td></tr></table>` });

  // Browse the data: preview the largest normalised CSV, if any.
  const previewName = files.filter(f => isDerived(f.name) && f.name.endsWith('.csv')).sort((a, b) => b.bytes - a.bytes)[0]?.name;
  const browseSection = previewName === undefined ? [] : [
    '<section><h2>Browse the data</h2>',
    `<p class="lead">A preview of the <b>normalised</b> extract <code>${escapeHtml(previewName)}</code>; download it for all rows, or inspect the source document below.</p>`,
    csvPreviewTable(path.join(targetDir, previewName)),
    '</section>',
  ];

  // Download grid: source/disclosure vs derived, with the open-data-only
  // slots as "not applicable" placeholders (the lane flip).
  const sourceSlots = files.filter(f => !isDerived(f.name) && f.name !== 'meta.json')
    .map(f => downloadSlot(f.name, encodeURIComponent(f.name), sizeMap.get(f.name) ?? '', meta.files[f.name]?.role ?? ''));
  sourceSlots.push(downloadSlot('meta.json', 'meta.json', sizeMap.get('meta.json') ?? 'JSON', 'provenance, outcome, integrity'));
  const dbName = `foi--${key}.sqlite.gz`;
  const dbSize = sizeOf(path.join(outputDir, 'data', 'datasets', dbName));
  const derivedSlots = files.filter(f => isDerived(f.name)).map(f => downloadSlot(f.name, encodeURIComponent(f.name), sizeMap.get(f.name) ?? '', meta.files[f.name]?.role ?? 'derived'));
  derivedSlots.push(dbSize !== '' ? downloadSlot(dbName, `../../../data/datasets/${encodeURIComponent(dbName)}`, `SQLite${dbSize}`, 'one database, one table per CSV') : placeholderSlot('SQLite', 'built at deploy'));
  derivedSlots.push(downloadSlot(`${key}.zip`, encodeURIComponent(`${key}.zip`), `ZIP ${formatBytes(zipBytes)}`, 'everything + descriptor + dictionary'));
  derivedSlots.push(downloadSlot('datapackage.json', 'datapackage.json', 'Frictionless', 'machine-readable manifest'));

  // At a glance (FOI): outcome, vintage, classes, attribution, notable.
  const totalRows = foiApproxRecords(meta.files);
  const notable: string[] = [];
  if (totalRows > 0) notable.push(`<li><b>~${totalRows.toLocaleString('en-GB')}</b> records across the disclosed sheets.</li>`);
  if (meta.relatedEntries !== undefined && meta.relatedEntries.length > 0) notable.push(`<li><b>${meta.relatedEntries.length}</b> related ${meta.relatedEntries.length === 1 ? 'entry' : 'entries'} — see below.</li>`);
  const atAGlance = [
    '<section><h2>At a glance</h2>',
    `<div class="headline">${escapeHtml(meta.outcome)} <small>FOI outcome</small></div>`,
    `<div class="bd"><h3>Data vintage</h3><div class="brow"><span class="lab">${escapeHtml(meta.dataVintage ?? 'not stated')}</span></div></div>`,
    `<div class="bd"><h3>Dataset classes</h3>${meta.datasetClasses.map(c => `<div class="brow"><span class="lab"><code>${escapeHtml(c)}</code></span></div>`).join('')}</div>`,
    '<div class="attr">',
    meta.requestUrl !== null ? `<div><b>Source</b> · <a href="${escapeHtml(meta.requestUrl)}">request on WhatDoTheyKnow →</a></div>` : '',
    meta.publicationUrl !== undefined ? `<div><a href="${escapeHtml(meta.publicationUrl)}">also published by Ofcom →</a></div>` : '',
    `<div>Requested ${escapeHtml(meta.requestedAt ?? '—')} · responded ${escapeHtml(meta.respondedAt ?? '—')}</div>`,
    '</div>',
    notable.length > 0 ? `<div class="notable"><h3>Notable</h3><ul>${notable.join('')}</ul></div>` : '',
    '</section>',
  ].filter(s => s !== '').join('\n');

  const recoveryNotice = meta.datasetRecovery !== undefined && meta.datasetRecovery !== 'recovered'
    ? [noticeStrip(true, `<b>Dataset ${escapeHtml(meta.datasetRecovery)}:</b> the response data itself is not held in this entry (the correspondence and provenance are). Absence of data here is a recovery state, not evidence about the register.`)]
    : [noticeStrip(false, `Freedom-of-Information disclosure — a point-in-time snapshot, not a live feed.`)];

  const body = [
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p class="subtitle">Freedom-of-Information response from Ofcom, recovered and mirrored. FOI archive entry <code>${escapeHtml(key)}</code> · <a href="datapackage.json">datapackage.json</a>.</p>`,
    ...recoveryNotice,
    '<div class="main-region">',
    datasetNavSidebar(key, summaries, foiEntries),
    '<div class="col">',
    ...browseSection,
    inspectTabsHtml(dataTabs),
    '<section><h2>Get the data</h2>',
    downloadTier('Source & disclosure', sourceSlots),
    downloadTier('Derived & bundles', derivedSlots),
    downloadTier('Not applicable to this entry', [placeholderSlot('raw.csv', 'n/a — source is not a single CSV'), placeholderSlot('components.csv', 'n/a — FOI snapshot, not the parsed register')]),
    '</section>',
    '</div>',
    `<div class="side">${atAGlance}</div>`,
    '</div>',
    related.length > 0 ? `<section><h2>Related entries</h2><ul>${related.join('')}</ul></section>` : '',
  ].filter(s => s !== '');
  fs.writeFileSync(path.join(targetDir, 'index.html'), entryPage(meta.title, body, { metaJsonHref: 'meta.json', sourcePath: `archive/foi/${key}` }));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, meta, zipBytes };
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

// A lean per-publication summary for the dataset-navigation sidebar - the
// headline figures every page compares itself against. Parses normalised.csv
// once (row count + status -> allocated) and reads meta for the known-issues
// / partial-scope signals; deltas are computed at render time relative to
// whichever publication's page is showing.
interface PublicationSummary {
  key: string;
  recordCount: number;
  allocated: number;
  knownIssues: boolean;
  partial: boolean;
}

function publicationSummary(key: string): PublicationSummary {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const rows = parse(fs.readFileSync(path.join(sourceDir, 'normalised.csv'), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  let allocated = 0;
  for (const r of rows) if ((r.status ?? '').trim() === 'Allocated') allocated += 1;
  const meta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta.json'), 'utf8')) as {
    intendedCoverage?: { complete: boolean };
    qualityObservations?: unknown[];
  };
  return {
    key,
    recordCount: rows.length,
    allocated,
    knownIssues: (meta.qualityObservations?.length ?? 0) > 0,
    partial: meta.intendedCoverage?.complete === false,
  };
}

// Whole days from `to` back to `from` (negative = earlier). Both are
// date-shaped archive keys; Date.parse of a YYYY-MM-DD is fixed-input and so
// stays golden-master deterministic.
export function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(from) - Date.parse(to)) / 86_400_000);
}

// A signed "(+1,234; +0.8%)" delta versus the current page's figure, empty
// when identical. The percentage is relative to the current publication (the
// reference), as asked.
export function signedDelta(value: number, reference: number): string {
  const d = value - reference;
  if (d === 0) return '';
  const sign = d > 0 ? '+' : '−';
  const magnitude = Math.abs(d).toLocaleString('en-GB');
  const pct = reference > 0 ? `; ${sign}${Math.abs((d / reference) * 100).toFixed(1)}%` : '';
  return ` (${sign}${magnitude}${pct})`;
}

// A data-bearing FOI disclosure, for the sidebar's second (cross-lane)
// section: the register snapshots and attribute addenda that sit beside the
// open-data timeline. Correspondence-only entries (no dataset) stay in the
// dataset index, not this navigation.
interface FoiNavEntry {
  key: string;
  title: string;
  vintage: string | null;
  classes: string[];
  approxRecords: number;
}

// Approximate record count declared for an FOI entry (summed across the
// disclosed sheets' approxRows). Approximate by nature - it is the publisher's
// indicative figure - so it is always shown with a leading ~.
function foiApproxRecords(files: FoiEntryMeta['files']): number {
  return Object.values(files)
    .flatMap(d => asSheetsIndicative(d.sheetsIndicative)?.sheets ?? [])
    .reduce((a, s) => a + (s.approxRows ?? 0), 0);
}

// The left dataset-navigation sidebar, shared by both lanes so open-data and
// FOI entry pages navigate identically. Every open-data publication is a
// compact elevator pitch - source + ISO date, and (only when viewed FROM an
// open-data page) the day-gap and row/allocated deltas relative to THIS
// publication; from an FOI page the same rows show absolute figures. The
// current entry is marked, not linked. Declared-partial snapshots and the
// data-bearing FOI disclosures follow in their own collapsed sections. Links
// use the lane-uniform ../../{lane}/{key}/ form (every entry page sits two
// levels under datasets/). Opposite side to the At-a-glance panel.
function datasetNavSidebar(currentKey: string, summaries: PublicationSummary[], foiEntries: FoiNavEntry[]): string {
  const onOpenDataPage = /^\d{4}-\d{2}-\d{2}$/.test(currentKey);
  const byNewest = <T extends { key: string }>(a: T, b: T): number => b.key.localeCompare(a.key);
  const current = onOpenDataPage ? summaries.find(s => s.key === currentKey) : undefined;
  // Deltas compare each entry against a full-register baseline: the publication
  // you are on, or - from an FOI page - the latest complete publication. So an
  // FOI's figure reads as a share of the register (e.g. -99.9%, revealing a
  // narrow request), never an absurd inverse against a tiny snapshot. Equal
  // figures (the baseline vs itself) emit no delta.
  const latestComplete = summaries.filter(s => !s.partial).sort(byNewest)[0];
  const refCount = current?.recordCount ?? latestComplete?.recordCount;
  const refAllocated = current?.allocated ?? latestComplete?.allocated;
  const rowDelta = (n: number): string => refCount === undefined ? '' : signedDelta(n, refCount);
  const allocDelta = (n: number): string => refAllocated === undefined ? '' : signedDelta(n, refAllocated);
  const markersOf = (s: PublicationSummary): string => {
    const m: string[] = [];
    if (s.partial) m.push('partial export');
    if (s.knownIssues) m.push('known data issues');
    return m.length > 0 ? ` · ${m.join(' · ')}` : '';
  };
  const item = (s: PublicationSummary): string => {
    const isCurrent = s.key === currentKey;
    const gap = dayGap(s.key, currentKey);
    // The day-gap is date arithmetic, so only meaningful from an open-data page.
    const gapHtml = !onOpenDataPage ? '' : isCurrent ? ' <small class="gap">this page</small>' : ` <small class="gap">(${gap > 0 ? '+' : '−'}${Math.abs(gap)} days)</small>`;
    const caption = `${s.recordCount.toLocaleString('en-GB')} rows${rowDelta(s.recordCount)}, ${s.allocated.toLocaleString('en-GB')} allocated callsigns${allocDelta(s.allocated)}${markersOf(s)}`;
    const inner = `<span class="dpitch"><small class="src">Ofcom open data</small> <b>${escapeHtml(s.key)}</b>${gapHtml}</span><small class="dcap">${escapeHtml(caption)}</small>`;
    return isCurrent
      ? `<li class="dcur" aria-current="page">${inner}</li>`
      : `<li><a href="../../open-data/${escapeHtml(s.key)}/index.html">${inner}</a></li>`;
  };
  // Declared-complete publications (plus the page you are on, even if it is
  // itself partial) are the timeline. Declared-partial snapshots collapse into
  // an expandable section - still browseable, and their delta shows exactly
  // how incomplete they are, but not mistaken for a timeline neighbour.
  const timeline = summaries.filter(s => !s.partial || s.key === currentKey).sort(byNewest);
  const partials = summaries.filter(s => s.partial && s.key !== currentKey).sort(byNewest);
  const partialsBlock = partials.length === 0 ? ''
    : `<details class="partials"><summary>${partials.length} partial export${partials.length === 1 ? '' : 's'}</summary><ol class="dlist">${partials.map(item).join('')}</ol></details>`;
  // FOI disclosures are a different lane (request-keyed, various vintages), so
  // a separate collapsed section ordered by data vintage, newest first. Each
  // shows its ~approximate record count with a delta to the register baseline -
  // the whole point: a narrow request (say, reciprocal calls only) reads far
  // below the register, a full snapshot near it. On an FOI page the current
  // entry is marked and the section starts expanded.
  const foiOnCurrent = !onOpenDataPage && foiEntries.some(e => e.key === currentKey);
  const foiItem = (e: FoiNavEntry): string => {
    const isCurrent = e.key === currentKey;
    const parts: string[] = [];
    if (e.approxRecords > 0) parts.push(`~${e.approxRecords.toLocaleString('en-GB')} records${rowDelta(e.approxRecords)}`);
    parts.push(e.title);
    if (e.classes.length > 0) parts.push(e.classes.join(', '));
    const gapHtml = isCurrent ? ' <small class="gap">this page</small>' : '';
    const inner = `<span class="dpitch"><small class="src">FOI</small> <b>${escapeHtml(e.vintage ?? 'undated')}</b>${gapHtml}</span><small class="dcap">${escapeHtml(parts.join(' · '))}</small>`;
    return isCurrent
      ? `<li class="dcur" aria-current="page">${inner}</li>`
      : `<li><a href="../../foi/${escapeHtml(e.key)}/index.html">${inner}</a></li>`;
  };
  const foiItems = [...foiEntries].sort((a, b) => (b.vintage ?? '').localeCompare(a.vintage ?? '')).map(foiItem).join('');
  const foiBlock = foiItems === '' ? ''
    : `<details class="foi-nav"${foiOnCurrent ? ' open' : ''}><summary>${foiEntries.length} FOI dataset${foiEntries.length === 1 ? '' : 's'}</summary><ol class="dlist">${foiItems}</ol></details>`;
  return `<nav class="nav-side" aria-label="Publications"><h2>Publications</h2><ol class="dlist">${timeline.map(item).join('')}</ol>${partialsBlock}${foiBlock}</nav>`;
}

function buildOpenDataEntry(outputDir: string, key: string, previousKey: string | undefined, summaries: PublicationSummary[], foiEntries: FoiNavEntry[]): { files: CopiedFile[]; zipBytes: number } {
  const sourceDir = path.join(CONSTANTS.DIRS.archive, key);
  const descriptions = new Map<string, string>([
    ['raw.csv', "Ofcom's bytes, verbatim"],
    ['meta.json', 'provenance + shape + diff summary'],
    ['normalised.csv', 'canonical schema derivation — see the data dictionary'],
    ['components.csv', 'per-callsign component decomposition'],
    ['stats.json', 'per-publication statistics and data-quality flags'],
  ]);
  const pageTitle = `Publication of ${humanDate(key)}`;
  const targetDir = path.join(outputDir, 'datasets', 'open-data', key);
  const files = copyEntryFiles(sourceDir, targetDir, descriptions, new Map(), pageTitle);
  const descriptor = dataPackage(key, `Ofcom open-data publication ${key}`, files);
  const zipBytes = writeEntryZip(sourceDir, targetDir, key, descriptor, OPEN_DATA_DICTIONARY_SOURCES);
  const meta = JSON.parse(fs.readFileSync(path.join(sourceDir, 'meta.json'), 'utf8')) as {
    provenance?: string;
    reconstructionNotes?: string;
    gitCommitSha?: string;
    intendedCoverage?: { complete: boolean; scopeNotes?: string };
    qualityObservations?: { statement: string; evidence: string; coverageAffecting?: boolean }[];
    sourceUrl?: string; ofcomReportedUpdateIso?: string; ofcomReportedUpdate?: string; fetchedAt?: string;
    diffSummary?: OpenDataDiffSummary;
    ignoredLines?: { line: number; content: string; reason: string }[];
  };
  const stats = fs.existsSync(path.join(sourceDir, 'stats.json'))
    ? JSON.parse(fs.readFileSync(path.join(sourceDir, 'stats.json'), 'utf8')) as OpenDataStats
    : { recordCount: 0, parseStatuses: {}, callsignFlags: {}, callsignQuality: {} };
  const sizeMap = new Map(files.map(f => [f.name, formatBytes(f.bytes)]));
  const dl = (name: string, meta2: string, desc: string): string => sizeMap.has(name)
    ? downloadSlot(name, encodeURIComponent(name), sizeMap.get(name) ?? meta2, desc) : placeholderSlot(name, 'not present');
  const dbName = `open-data--${key}.sqlite.gz`;
  const dbSize = sizeOf(path.join(outputDir, 'data', 'datasets', dbName));

  // Inspect: per-file schemas (raw included - the source file's own shape).
  const parseStatuses = Object.entries(stats.parseStatuses).sort().map(([s, n]) => `${n.toLocaleString('en-GB')} ${escapeHtml(s)}`).join(' · ');
  const quality = Object.entries(stats.callsignQuality).filter(([, q]) => q.count > 0).sort();
  const qualityHtml = quality.length === 0 ? '' : `<h3 style="font-size:.9rem;margin-top:.8rem">Value-level checks</h3><ul>${quality.map(([check, q]) => {
    const shown = q.examples.slice(0, 5).map(e => (e === '' ? '<em>(empty value)</em>' : `<code>${escapeHtml(e)}</code>`));
    return `<li>${escapeHtml(check)}: ${q.count.toLocaleString('en-GB')}${shown.length > 0 ? ` — e.g. ${shown.join(', ')}` : ''}</li>`;
  }).join('')}</ul>`;
  const tabs: InspectTab[] = [
    { id: 'i-raw', label: 'raw.csv', panel: csvSchemaPanel(path.join(sourceDir, 'raw.csv'), "Ofcom's bytes, verbatim") },
    { id: 'i-norm', label: 'normalised.csv', panel: csvSchemaPanel(path.join(sourceDir, 'normalised.csv'), 'Canonical schema — one stable shape across every publication') },
    { id: 'i-comp', label: 'components.csv', panel: csvSchemaPanel(path.join(sourceDir, 'components.csv'), 'Per-callsign decomposition + join keys') },
    { id: 'i-stats', label: 'stats.json', panel: `<p class="lead">Parse statuses: ${parseStatuses}.</p>${anomalyFlagsHtml(stats.callsignFlags)}${qualityHtml}` },
    { id: 'i-meta', label: 'meta.json', panel: `<table><tr><th>provenance</th><td>${escapeHtml(meta.provenance ?? 'live')}</td></tr><tr><th>declared coverage</th><td>${meta.intendedCoverage === undefined ? '—' : `${meta.intendedCoverage.complete ? 'complete' : 'partial'} (intent, not verified)`}</td></tr></table>` },
  ].filter(t => t.panel !== '');

  const ignored = meta.ignoredLines ?? [];
  const ignoredNote = ignored.length > 0
    ? `<p class="lead">${ignored.length} raw line${ignored.length === 1 ? '' : 's'} excluded as non-data (${[...new Set(ignored.map(l => l.reason))].map(escapeHtml).join('; ')}) — enumerated in <a href="meta.json">meta.json</a>.</p>` : '';

  const related: string[] = [];
  if (previousKey !== undefined) related.push(`<p style="margin:.1rem 0;font-size:.9rem"><b>Chronological:</b> ← <a href="../${escapeHtml(previousKey)}/index.html">Publication of ${humanDate(previousKey)}</a>.</p>`);

  const body = [
    `<h1>${escapeHtml(pageTitle)}</h1>`,
    `<p class="subtitle">Ofcom amateur-radio callsign register, mirrored byte-for-byte. Archive entry <code>${escapeHtml(key)}</code> · <a href="datapackage.json">datapackage.json</a>.</p>`,
    ...coverageNotices(meta),
    '<div class="main-region">',
    datasetNavSidebar(key, summaries, foiEntries),
    '<div class="col">',
    `<section class="browser" data-dataset="${escapeHtml(key)}"><h2>Browse the data</h2>`,
    `<p class="lead">The <b>normalised</b> register — the canonical shape, not the raw file (inspect <code>raw.csv</code> below for that). Showing the first rows of ${stats.recordCount.toLocaleString('en-GB')} (${(summaries.find(s => s.key === key)?.allocated ?? 0).toLocaleString('en-GB')} allocated callsigns); download <code>normalised.csv</code> for all, or query it on the <a href="../../../explore.html">Explore</a> page.</p>`,
    `<div class="browser-static">${csvPreviewTable(path.join(sourceDir, 'normalised.csv'))}</div>`,
    ignoredNote,
    '</section>',
    inspectTabsHtml(tabs),
    ...distributionsSection(sourceDir, key),
    '<section><h2>Get the data</h2>',
    downloadTier('Canonical — most-wanted', [
      dl('normalised.csv', 'CSV', 'canonical schema across all publications'),
      dl('components.csv', 'CSV', 'decomposition + join keys'),
      dl('stats.json', 'JSON', 'counts & quality flags'),
      dl('meta.json', 'JSON', 'provenance & integrity'),
    ]),
    downloadTier('Source & bundles', [
      dl('raw.csv', 'CSV', "Ofcom's bytes, verbatim"),
      dbSize !== '' ? downloadSlot(dbName, `../../../data/datasets/${encodeURIComponent(dbName)}`, `SQLite${dbSize}`, 'one database, one table per CSV') : placeholderSlot('SQLite', 'built at deploy'),
      downloadSlot(`${key}.zip`, encodeURIComponent(`${key}.zip`), `ZIP ${formatBytes(zipBytes)}`, 'everything + descriptor + dictionary'),
      downloadSlot('datapackage.json', 'datapackage.json', 'Frictionless', 'machine-readable manifest with schemas'),
    ]),
    downloadTier('Entry-specific', [
      placeholderSlot('source documents', 'none — open-data is one CSV'),
      placeholderSlot('edges.csv', 'planned — graph export'),
    ]),
    '</section>',
    '</div>',
    '<div class="side">',
    atAGlanceOpenData(sourceDir, key, previousKey, stats, meta),
    '</div>',
    '</div>',
    related.length > 0 ? `<section><h2>Related</h2>${related.join('')}</section>` : '',
    '<a class="linkout" href="../../../statistics.html">Register structure (prefix series × RSL) → on the statistics page (near-constant across publications, not a property of this one).</a>',
    // Progressive enhancement: the scoped data browser queries the master
    // database (filtered to this publication) over range requests. With JS
    // off, the static preview above is the complete, crawlable record.
    '<script src="../../../vendor/index.js"></script>',
    '<script type="module" src="../../../entry-browser.js"></script>',
  ].filter(s => s !== '');
  fs.writeFileSync(path.join(targetDir, 'index.html'), entryPage(pageTitle, body, { metaJsonHref: 'meta.json', sourcePath: `archive/${key}` }));
  fs.writeFileSync(path.join(targetDir, 'datapackage.json'), descriptor);
  return { files, zipBytes };
}

// URL-safe slug for a prefix series. Names are now stored bare (20, M7),
// so this is normally the identity; the # strip stays as a guard for any
// display-form input.
export function seriesSlug(series: string): string {
  return series.replace(/#/g, '');
}

// Precomputed per-series entity pages (the static half of the entity-pages
// plan; callsigns stay dynamic behind ?c= deep links because 158k static
// pages would alone exceed the Pages size cap): reference-data facts plus
// latest-publication derived numbers, one page per prefix series observed
// in the data or named in reference data. Fully static - archived captures
// are complete. Returns the page URLs for the sitemap.
function buildSeriesPages(outputDir: string, baseUrl: string): string[] {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) return [];
  const componentsRows = parse(fs.readFileSync(path.join(CONSTANTS.DIRS.archive, newest, 'components.csv'), 'utf8'),
    { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const normalisedRows = parse(fs.readFileSync(path.join(CONSTANTS.DIRS.archive, newest, 'normalised.csv'), 'utf8'),
    { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  const statusByCallsign = new Map(normalisedRows.map(r => [r.callsign, r.status]));
  const reference = new Map(
    (parse(fs.readFileSync(path.join(REPO_ROOT, 'reference-data', 'prefix-formats.csv'), 'utf8'), { columns: true, bom: true }) as Record<string, string>[])
      .map(r => [r.prefix, r]));

  interface SeriesAccumulator {
    total: number;
    statuses: Map<string, number>;
    rsls: Map<string, number>;
    flags: Map<string, number>;
    examples: string[];
  }
  const bySeries = new Map<string, SeriesAccumulator>();
  for (const row of componentsRows) {
    if (row.parse_status !== 'parsed' || row.prefix_series === '') continue;
    const acc: SeriesAccumulator = bySeries.get(row.prefix_series) ?? { total: 0, statuses: new Map(), rsls: new Map(), flags: new Map(), examples: [] };
    acc.total += 1;
    const status = statusByCallsign.get(row.callsign) ?? '(unknown)';
    acc.statuses.set(status, (acc.statuses.get(status) ?? 0) + 1);
    if (row.rsl !== '') acc.rsls.set(row.rsl, (acc.rsls.get(row.rsl) ?? 0) + 1);
    for (const flag of row.flags === '' ? [] : row.flags.split(';')) acc.flags.set(flag, (acc.flags.get(flag) ?? 0) + 1);
    if (acc.examples.length < 5) acc.examples.push(row.callsign);
    bySeries.set(row.prefix_series, acc);
  }

  const allSeries = [...new Set([...reference.keys(), ...bySeries.keys()])].sort((a, b) => a.localeCompare(b));
  const seriesDir = path.join(outputDir, 'series');
  fs.mkdirSync(seriesDir, { recursive: true });
  const urls: string[] = [];

  // linkFor turns each count into a filtered-lookup link ("which N?"):
  // a return of undefined (synthetic values like "(unknown)") stays plain.
  const countTable = (title: string, counts: Map<string, number>, linkFor?: (value: string) => string | undefined): string[] => {
    if (counts.size === 0) return [];
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return [`<h2>${escapeHtml(title)}</h2>`, '<table>', `<tr><th>value</th><th>rows</th></tr>`,
      ...rows.map(([value, n]) => {
        const count = n.toLocaleString('en-GB');
        const href = linkFor?.(value);
        return `<tr><td>${escapeHtml(value)}</td><td>${href === undefined ? count : `<a href="${href}">${count}</a>`}</td></tr>`;
      }), '</table>'];
  };
  const filterLink = (series: string, param: 'status' | 'flags', value: string): string | undefined =>
    value.startsWith('(') ? undefined : `../index.html?series=${encodeURIComponent(series)}&${param}=${encodeURIComponent(value)}`;

  const indexRows: string[] = [];
  for (const series of allSeries) {
    const slug = seriesSlug(series);
    const ref = reference.get(series);
    const acc = bySeries.get(series);
    const display = displaySeries(series);
    const facts: string[] = [];
    if (ref !== undefined) {
      facts.push(
        '<table>',
        `<tr><th>station level</th><td>${escapeHtml(ref.station_level)}</td></tr>`,
        `<tr><th>issuing status</th><td>${escapeHtml(ref.issuing_status)}</td></tr>`,
        `<tr><th>RSL required</th><td>${escapeHtml(ref.rsl_required)}</td></tr>`,
        ...(ref.notes ? [`<tr><th>notes</th><td>${escapeHtml(ref.notes)}</td></tr>`] : []),
        '</table>',
      );
    } else {
      facts.push('<p>⚠ Observed in the register but absent from <a href="https://github.com/MysterAitch/amateur-callsigns-file-watch/tree/main/reference-data">reference data</a> — an open research item, not an established series.</p>');
    }
    const numbers = acc === undefined
      ? ['<p>No parsed register rows in the latest publication carry this series.</p>']
      : [
        `<p>${acc.total.toLocaleString('en-GB')} parsed register rows in the latest publication (${escapeHtml(newest)}). Counts link to the matching rows in the live lookup.</p>`,
        ...countTable('Status breakdown', acc.statuses, status => filterLink(series, 'status', status)),
        ...countTable('Stored RSL letters', acc.rsls),
        ...countTable('Data-quality flags within this series', acc.flags, flag => filterLink(series, 'flags', flag)),
        `<p>Examples, as stored in the register (the RSL letter, where one applies, is stored separately from the row): ${acc.examples.map(c => `<a href="../index.html?c=${encodeURIComponent(c)}"><code>${escapeHtml(c)}</code></a>`).join(', ')} — each opens the live lookup.</p>`,
      ];
    const body = [
      `<h1>Prefix series ${escapeHtml(display)}</h1>`,
      '<p><code>#</code> marks where the Regional Secondary Locator sits when one is present. Reference facts are hand-curated; numbers derive from the latest archived publication and regenerate on every deploy.</p>',
      ...facts,
      ...numbers,
      '<p>See the <a href="../statistics.html">statistics page</a> for the all-series locator matrix, or <a href="index.html">all series</a>.</p>',
    ];
    fs.writeFileSync(path.join(seriesDir, `${slug}.html`), htmlPage(`Prefix series ${display}`, 1, body, { sourcePath: 'reference-data/prefix-formats.csv' }));
    urls.push(`${baseUrl}/series/${slug}.html`);
    indexRows.push(`<tr><td><a href="${slug}.html"><code>${escapeHtml(display)}</code></a></td><td>${ref === undefined ? '⚠ unreferenced' : escapeHtml(ref.station_level)}</td><td>${ref === undefined ? '—' : escapeHtml(ref.issuing_status)}</td><td>${(acc?.total ?? 0).toLocaleString('en-GB')}</td></tr>`);
  }

  const indexBody = [
    '<h1>Prefix series</h1>',
    `<p>One page per callsign prefix series — hand-curated reference facts joined with numbers derived from the latest archived publication (${escapeHtml(newest)}). <code>#</code> marks the RSL slot.</p>`,
    '<table>',
    '<tr><th>series</th><th>station level</th><th>issuing status</th><th>rows</th></tr>',
    ...indexRows,
    '</table>',
  ];
  fs.writeFileSync(path.join(seriesDir, 'index.html'), htmlPage('Prefix series', 1, indexBody, { sourcePath: 'reference-data/prefix-formats.csv' }));
  urls.unshift(`${baseUrl}/series/index.html`);
  return urls;
}

export function buildDatasetPages(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): DatasetPagesSummary {
  const foiDir = path.join(REPO_ROOT, 'archive', 'foi');
  const openDataKeys = listArchiveKeys().sort();
  const foiKeys = listFoiEntryKeys(foiDir);

  let fileCount = 0;
  let totalBytes = 0;
  const pageUrls: string[] = [`${baseUrl}/datasets/index.html`];

  const openDataRows: string[] = [];
  // The changes-since pointer targets the most recent INTENDED-COMPLETE
  // earlier publication: pointing at a declared-partial truncation would
  // imply ~150k spurious additions (caught in review).
  let lastCompleteKey: string | undefined;
  // Precompute each publication's headline figures once; every entry's
  // navigation sidebar lists them all, with deltas relative to that page.
  const summaries = openDataKeys.map(publicationSummary);
  // The cross-lane FOI section lists only data-bearing disclosures (a dataset
  // to navigate to); correspondence-only entries stay in the dataset index.
  const foiNav: FoiNavEntry[] = foiKeys.map(k => {
    const m = readFoiEntryMeta(foiDir, k);
    return { key: k, title: m.title, vintage: m.dataVintage, classes: m.datasetClasses, approxRecords: foiApproxRecords(m.files) };
  }).filter(e => e.classes.length > 0);
  for (const key of openDataKeys) {
    const { files, zipBytes } = buildOpenDataEntry(outputDir, key, lastCompleteKey, summaries, foiNav);
    const entryMeta = JSON.parse(fs.readFileSync(path.join(CONSTANTS.DIRS.archive, key, 'meta.json'), 'utf8')) as { intendedCoverage?: { complete: boolean } };
    if (entryMeta.intendedCoverage?.complete !== false) lastCompleteKey = key;
    fileCount += files.length;
    totalBytes += files.reduce((sum, f) => sum + f.bytes, 0) + zipBytes;
    pageUrls.push(`${baseUrl}/datasets/open-data/${key}/index.html`);
    openDataRows.push(`<tr><td><a href="open-data/${key}/index.html">Publication of ${humanDate(key)}</a> <code>${key}</code></td><td>${files.length}</td><td>${formatBytes(files.reduce((s, f) => s + f.bytes, 0))}</td></tr>`);
  }

  const foiRows: string[] = [];
  for (const key of foiKeys) {
    const { files, meta, zipBytes } = buildFoiEntry(outputDir, foiDir, key, summaries, foiNav);
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
    { source: 'docs/normalised-schema.md', slug: 'normalised-schema', label: 'Open-data normalised schema', blurb: 'column-by-column definitions of every open-data publication’s <code>normalised.csv</code>, plus the line-accounting contract.' },
    { source: 'docs/foi-schemas.md', slug: 'foi-schemas', label: 'FOI dataset schemas', blurb: 'the dataset-class glossary, row-schema families, registered extension columns, and per-variant conversion detail behind every FOI <code>normalised--*.csv</code>.' },
    { source: 'reference-data/flags.md', slug: 'flags', label: 'Data-quality flag registry', blurb: 'the meaning and grounding of every anomaly flag used in the metrics and the lookup.' },
  ];
  const docsDir = path.join(outputDir, 'datasets', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  for (const doc of dictionaryDocs) {
    let rendered = renderMarkdown(fs.readFileSync(path.join(REPO_ROOT, doc.source), 'utf8'));
    // Cross-references between the dictionary docs are .md links in the
    // repository; on the site the siblings are .html (the .md forms 404ed
    // live). Entry keys named in the docs become links to their pages -
    // the schema tables are the natural jumping-off point to the data.
    for (const sibling of dictionaryDocs) {
      rendered = rendered.replaceAll(`href="${path.basename(sibling.source)}"`, `href="${sibling.slug}.html"`);
    }
    for (const key of foiKeys) {
      rendered = rendered.replaceAll(`<code>${key}</code>`, `<a href="../foi/${encodeURIComponent(key)}/index.html"><code>${key}</code></a>`);
    }
    const docBody = [
      `<p><small>Rendered from <a href="${REPO_URL}/blob/main/${doc.source}">${escapeHtml(doc.source)}</a> in the repository (the authoritative copy).</small></p>`,
      '<hr>',
      rendered,
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
  fs.writeFileSync(path.join(datasetsDir, 'index.html'), htmlPage('Dataset index', 1, indexBody, { currentNav: 'Dataset index', sourcePath: 'archive' }));

  pageUrls.push(...buildSeriesPages(outputDir, baseUrl));

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${baseUrl}/index.html</loc></url>`,
    `<url><loc>${baseUrl}/statistics.html</loc></url>`,
    `<url><loc>${baseUrl}/explore.html</loc></url>`,
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
