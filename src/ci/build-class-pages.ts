#!/usr/bin/env node

/**
 * Builds the dataset-class site section (issue #178): one STATIC, crawlable
 * page per dataset class, each listing every archive entry across BOTH
 * collections (Ofcom open data + FOI) that carries the class, headed by the
 * class's own registry prose. The dataset-class chips on the entry pages and
 * the dataset index link here, turning the class vocabulary from decoration
 * into a navigable index.
 *
 * The class vocabulary and its authored definitions are the single source of
 * truth in FOI_DATASET_CLASSES (src/shared/foi-archive.ts) — the same object
 * the FOI meta validator enforces and docs/foi-schemas.md renders — so the
 * page headers and the accepted values can never drift.
 *
 * Class membership. FOI entries declare their classes in meta.json
 * (datasetClasses). Open-data publications carry no such field: they are, by
 * construction, the register state at a vintage — one row per callsign with
 * its status — which is exactly the `register-snapshot` definition, so each is
 * classified as one here. That classification is DECLARED (from the lane's
 * shape), not asserted per publication in its meta, and the page says so.
 *
 * DELIBERATELY NOT COMMITTED, like the rest of the dataset-pages build: derived
 * at deploy time from committed data, deterministic for unchanged inputs (no
 * timestamps), and wired into the site build via buildDatasetPages so no
 * cicd.yaml change is needed. Shared render helpers (nav, breadcrumb, page
 * shell, the a11y skip-link / <main> scaffolding, the shared design tokens)
 * come from site-render.ts so the section reads as one product with the site.
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { listFoiEntryKeys, readFoiEntryMeta, FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import { escapeHtml, humanDate, humaniseLabel, breadcrumbHtml, htmlPage, glossaryTerm, tableCaption, datasetLabel } from './site-render.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';
const FOI_DIR = path.join(REPO_ROOT, 'archive', 'foi');

// Open-data publications carry no datasetClasses field; the lane's shape IS the
// register state at a vintage, so each is classified as this. Declared from the
// lane, not asserted per publication.
export const OPEN_DATA_IMPLICIT_CLASS = 'register-snapshot';

// The class names are already URL-safe kebab-case (register-snapshot,
// available-pool, …), so the slug is the identity; the replace guards any
// future value that might not be.
export function classSlug(cls: string): string {
  return cls.replace(/[^a-z0-9-]/gi, '-');
}

// A dataset-class chip as a link to its per-class page. relToDatasets is the
// relative path from the citing page up to the datasets/ directory ('' from the
// dataset index, '../../' from an entry page two levels below it).
export function classChipLink(cls: string, relToDatasets: string): string {
  return `<a href="${relToDatasets}classes/${classSlug(cls)}.html"><code>${escapeHtml(cls)}</code></a>`;
}

// A member of a class: an archive entry (either lane) that carries it.
interface ClassMember {
  key: string;
  lane: 'open-data' | 'foi';
  title: string;
  // A comparable vintage string (date, month or year); '' when undated, which
  // sorts last.
  vintage: string;
  classes: string[];
}

// Every archive entry across both lanes, with the classes it carries. Open-data
// publications are date-keyed and classified as register-snapshots; FOI entries
// declare their own classes in meta.
function collectMembers(foiDir: string): ClassMember[] {
  const members: ClassMember[] = [];
  for (const key of listArchiveKeys().sort()) {
    members.push({ key, lane: 'open-data', title: `Publication of ${humanDate(key)}`, vintage: key, classes: [OPEN_DATA_IMPLICIT_CLASS] });
  }
  for (const key of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, key);
    members.push({ key, lane: 'foi', title: meta.title, vintage: meta.dataVintage ?? '', classes: meta.datasetClasses });
  }
  return members;
}

// Newest first; undated entries last. A stable tiebreak on key keeps the build
// deterministic (Wayback re-crawls see no churn).
function byVintageDesc(a: ClassMember, b: ClassMember): number {
  if (a.vintage === '' && b.vintage !== '') return 1;
  if (b.vintage === '' && a.vintage !== '') return -1;
  return b.vintage.localeCompare(a.vintage) || a.key.localeCompare(b.key);
}

const LANE_LABEL: Record<ClassMember['lane'], string> = {
  'open-data': 'Ofcom open data',
  'foi': 'FOI',
};

// One per-class page: the class prose as the header, then a table of every
// entry (both lanes) carrying the class, newest first. Depth 2
// (datasets/classes/), so entries are one level up under their lane.
function classPage(cls: string, members: ClassMember[]): string {
  const definition = FOI_DATASET_CLASSES[cls];
  const carrying = members.filter(m => m.classes.includes(cls)).sort(byVintageDesc);
  const openDataCount = carrying.filter(m => m.lane === 'open-data').length;
  const foiCount = carrying.length - openDataCount;

  const rows = carrying.map(m => {
    const href = `../${m.lane}/${encodeURIComponent(m.key)}/index.html`;
    const vintageCell = m.vintage === '' ? '<span style="color:var(--muted)">(undated)</span>' : escapeHtml(humaniseLabel(m.vintage));
    // Sibling class pages live in this same directory, so they link directly
    // by slug (not via classChipLink, whose href is relative to datasets/).
    const otherClasses = m.classes.filter(c => c !== cls);
    const alsoCell = otherClasses.length === 0
      ? '<span style="color:var(--muted)">—</span>'
      : otherClasses.map(c => `<a href="${classSlug(c)}.html"><code>${escapeHtml(c)}</code></a>`).join(', ');
    return `<tr><th scope="row" class="dskey">${datasetLabel(m.title, m.key, { href })}</th><td>${escapeHtml(LANE_LABEL[m.lane])}</td><td>${vintageCell}</td><td>${alsoCell}</td></tr>`;
  });

  const registerSnapshotNote = cls === OPEN_DATA_IMPLICIT_CLASS
    ? `<p>The Ofcom open-data publications carry no ${glossaryTerm('dataset-class', 2, { label: 'dataset-class' })} field of their own: each is, by construction, the register state at a ${glossaryTerm('vintage', 2)}, so it is classified here as a <code>register-snapshot</code>. That classification is <b>declared</b> from the lane’s shape, not asserted in each publication’s <code>meta.json</code>.</p>`
    : '';

  const body = [
    breadcrumbHtml([['Datasets', '../index.html'], ['Dataset classes', 'index.html'], [cls, undefined]]),
    `<h1>Dataset class <code>${escapeHtml(cls)}</code></h1>`,
    definition === undefined
      ? `<p>No registry definition exists for this class; it is listed plainly, by name.</p>`
      : `<p>${escapeHtml(definition)}.</p>`,
    `<p><small>Definition from the dataset-class vocabulary in <a href="../docs/foi-schemas.html">the FOI dataset schemas</a> — the same object the FOI validator enforces. Membership is <b>declared</b> (from each entry’s <code>meta.json</code>, or, for the open-data lane, from its shape), not verified.</small></p>`,
    registerSnapshotNote,
    `<p>${carrying.length} ${carrying.length === 1 ? 'entry' : 'entries'} carry this class — ${openDataCount} open-data, ${foiCount} FOI.</p>`,
    '<table>',
    tableCaption(`Archived entries carrying the ${cls} class`),
    '<thead>',
    `<tr><th scope="col">entry</th><th scope="col">collection</th><th scope="col">${glossaryTerm('vintage', 2, { label: 'vintage' })}</th><th scope="col">${glossaryTerm('dataset-class', 2, { label: 'other classes' })}</th></tr>`,
    '</thead>',
    '<tbody>',
    ...rows,
    '</tbody>',
    '</table>',
    '<p><a href="index.html">All dataset classes →</a></p>',
  ].filter(s => s !== '');
  return htmlPage(`Dataset class ${cls}`, 2, body, { currentNav: 'Dataset index', sourcePath: 'archive' });
}

// The class index: every class in the vocabulary that has at least one entry,
// with its definition and entry count, each linking to its page.
function classIndexPage(present: { cls: string; count: number }[]): string {
  const rows = present.map(({ cls, count }) => {
    const definition = FOI_DATASET_CLASSES[cls];
    return `<tr><th scope="row"><a href="${classSlug(cls)}.html"><code>${escapeHtml(cls)}</code></a></th><td>${definition === undefined ? '<span style="color:var(--muted)">—</span>' : escapeHtml(definition)}</td><td class="n">${count}</td></tr>`;
  });
  const body = [
    breadcrumbHtml([['Datasets', '../index.html'], ['Dataset classes', undefined]]),
    '<h1>Dataset classes</h1>',
    `<p>Every archived dataset carries one or more ${glossaryTerm('dataset-class', 2, { label: 'dataset classes' })} — the entry-level vocabulary that says what kind of data it is (a ${glossaryTerm('register-snapshot', 2, { label: 'register snapshot' })}, an availability pool, a ${glossaryTerm('forbidden-suffix', 2, { label: 'forbidden-suffix' })} list, and so on). Each class below lists every entry that carries it, across both the Ofcom open-data and the FOI collections. The definitions are the authored vocabulary the FOI validator enforces; membership is <b>declared</b>, not verified.</p>`,
    '<table>',
    tableCaption('Dataset classes in the vocabulary, with a definition and entry count'),
    '<thead>',
    `<tr><th scope="col">${glossaryTerm('dataset-class', 2, { label: 'class' })}</th><th scope="col">definition</th><th scope="col" class="n">entries</th></tr>`,
    '</thead>',
    '<tbody>',
    ...rows,
    '</tbody>',
    '</table>',
    '<p><a href="../index.html">← Back to the dataset index</a></p>',
  ];
  return htmlPage('Dataset classes', 2, body, { currentNav: 'Dataset index', sourcePath: 'archive' });
}

// Build the class section under {outputDir}/datasets/classes/. Returns the page
// URLs for the caller's sitemap. Only classes with at least one member get a
// page (defensive: every vocabulary class currently has entries). Deterministic
// for unchanged inputs, like the rest of the dataset-pages build.
export function buildClassPages(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const members = collectMembers(FOI_DIR);
  const dir = path.join(outputDir, 'datasets', 'classes');
  fs.mkdirSync(dir, { recursive: true });
  const urls: string[] = [];

  // Vocabulary order (definition order in FOI_DATASET_CLASSES) is the stable,
  // meaningful order; only emit a page for a class that has members.
  const present: { cls: string; count: number }[] = [];
  for (const cls of Object.keys(FOI_DATASET_CLASSES)) {
    const count = members.filter(m => m.classes.includes(cls)).length;
    if (count === 0) continue;
    present.push({ cls, count });
    fs.writeFileSync(path.join(dir, `${classSlug(cls)}.html`), classPage(cls, members));
    urls.push(`${baseUrl}/datasets/classes/${classSlug(cls)}.html`);
  }

  fs.writeFileSync(path.join(dir, 'index.html'), classIndexPage(present));
  urls.push(`${baseUrl}/datasets/classes/index.html`);
  return urls;
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-class-pages.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const urls = buildClassPages(outputDir, baseUrl);
  console.log(`dataset-class section: ${urls.length} pages`);
}

if (import.meta.main) {
  main();
}
